/**
 * Film de l'histoire et mode lecture : rejoue les snapshots en plein écran, avec construction animée de chaque
 * graphique (révélation 4D), zoom dans l'élément cliqué quand l'étape suivante prolonge le chemin
 * d'exploration, fondu sinon, et apparition progressive des commentaires « À retenir ».
 *
 * - Film : avance automatique (←/→, espace = lecture/pause, Échap).
 * - Mode lecture (`reading`) : une diapositive par snapshot, au rythme du lecteur — toucher / cliquer
 *   (tiers gauche = précédent), balayage (iPad, téléphone), flèches, points de progression, pause / rejouer,
 *   lien profond par diapositive, format adapté à l'écran (portrait).
 */
import { parseSpec, type ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, renderChart } from "../charts/render";
import type { Snapshot } from "../story/snapshots";
import { ROLE_LABELS } from "../story/snapshots";
import { h, svgIcon, ICONS } from "./dom";

const BUILD_MS = 1300;
const COMMENT_MS = 1100;
const HOLD_MS = 2600;
const ZOOM_MS = 520;
const SWIPE_PX = 50;

const REPLAY_ICON = `<path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const LINK_ICON = `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;

export interface FilmOptions {
  /** Mode lecture (pas d'avance automatique, rejouer, balayage, lien profond, format adapté à l'écran). */
  reading?: boolean;
  /** Diapositive affichée (synchronisation du lien profond). */
  onSlide?: (s: Snapshot, k: number) => void;
  onClose?: () => void;
  /** Lien profond de la diapositive (bouton « Copier le lien »). */
  linkFor?: (s: Snapshot) => string | null;
  copy?: (url: string) => void;
}

/** Format de rendu adapté à la scène (mode lecture) : 16:9 d'origine en paysage, portrait sur téléphone / tablette. */
export function readingSize(stageW: number, stageH: number, viewportW: number): { width: number; height: number; boost: number } | null {
  if (stageW <= 0 || stageH <= 0) return null;
  const aspect = stageW / stageH;
  if (aspect >= 1.4) return null;
  const phone = viewportW < 600;
  const width = phone ? 640 : 1000;
  const height = Math.round(Math.min(width * 1.8, Math.max(width * 0.72, width / aspect)));
  return { width, height, boost: phone ? 1.35 : 1.2 };
}

export class StoryFilm {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private svg: SVGSVGElement;
  private msg: HTMLElement;
  private crumbs: HTMLElement;
  private storyTitle: HTMLElement;
  private counter: HTMLElement;
  private role: HTMLElement;
  private dots: HTMLElement;
  private playBtn: HTMLButtonElement;
  private snaps: Snapshot[] = [];
  private i = 0;
  private playing = true;
  private raf = 0;
  private t0 = 0;
  private pausedAt: number | null = null;
  private loop: (() => void) | null = null;
  private redraw: (() => void) | null = null;
  private timer = 0;
  private busy = false;
  private p0: { x: number; y: number } | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onResize = () => this.resized();
  private resizeTimer = 0;
  private lastSize = "";

  constructor(private datasetFor: (s: Snapshot) => Dataset | null, private o: FilmOptions = {}) {
    const tid = o.reading ? "reader" : "film";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "film-svg");
    this.svg.setAttribute("data-testid", `${tid}-svg`);
    this.msg = h("div", { class: "film-msg", hidden: true, "data-testid": `${tid}-msg` });
    this.stage = h("div", { class: "film-stage", "data-testid": `${tid}-stage` }, this.svg, this.msg);
    this.stage.addEventListener("pointerdown", (e) => (this.p0 = { x: e.clientX, y: e.clientY }));
    this.stage.addEventListener("pointercancel", () => (this.p0 = null));
    this.stage.addEventListener("pointerup", (e) => this.pointerUp(e));
    this.crumbs = h("div", { class: "film-crumbs", "data-testid": `${tid}-crumbs` });
    this.storyTitle = h("span", { class: "film-story", "data-testid": `${tid}-title` });
    this.counter = h("span", { class: "film-counter", "data-testid": `${tid}-counter` });
    this.role = h("span", { class: "film-role", "data-testid": `${tid}-role` });
    this.dots = h("div", { class: "film-dots", "data-testid": `${tid}-dots` });
    const btn = (icon: string, title: string, fn: () => void, testid: string, raw = false) =>
      h("button", { class: "film-btn", type: "button", title, "aria-label": title, "data-testid": testid, html: raw ? `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${icon}</svg>` : svgIcon(icon, 22), onclick: (e: Event) => (e.stopPropagation(), fn()) });
    this.playBtn = btn(ICONS.pause, o.reading ? "Pause / reprise de l'animation (espace)" : "Lecture / pause (espace)", () => this.toggle(), `${tid}-play`) as HTMLButtonElement;
    const top = h("header", { class: "film-top" }, this.role, o.reading ? this.storyTitle : null, this.crumbs, h("span", { class: "spacer" }), this.counter);
    if (o.reading && o.linkFor) top.append(btn(LINK_ICON, "Copier le lien de cette diapositive", () => this.copyLink(), `${tid}-link`, true));
    top.append(btn(ICONS.close, "Fermer (Échap)", () => this.close(), `${tid}-close`));
    const bottom = h("footer", { class: "film-bottom" }, btn(ICONS.prev, "Diapositive précédente (←)", () => this.prev(), `${tid}-prev`), this.playBtn);
    if (o.reading) bottom.append(btn(REPLAY_ICON, "Rejouer l'animation (R)", () => this.replay(), `${tid}-replay`, true));
    bottom.append(btn(ICONS.next, "Diapositive suivante (→)", () => this.next(), `${tid}-next`), this.dots);
    if (o.reading) bottom.append(h("span", { class: "film-help", "data-testid": `${tid}-help` }, "← → naviguer · Espace pause · R rejouer · Début / Fin · Échap fermer"));
    this.root = h(
      "div",
      { class: `film${o.reading ? " reader" : ""}`, hidden: true, role: "dialog", "aria-label": o.reading ? "Mode lecture" : "Film de l'histoire", "data-testid": tid },
      top,
      this.stage,
      bottom
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Index de la diapositive affichée. */
  get index(): number {
    return this.i;
  }

  get current(): Snapshot | null {
    return this.snaps[this.i] ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  open(snaps: Snapshot[], start = 0, title = ""): void {
    if (!snaps.length) return;
    this.snaps = snaps;
    this.i = Math.max(0, Math.min(snaps.length - 1, start));
    this.root.hidden = false;
    if (this.o.reading) document.body.classList.add("reading-open");
    this.root.classList.remove("has-msg");
    this.msg.hidden = true;
    this.svg.style.display = "";
    this.storyTitle.textContent = title;
    this.storyTitle.title = title;
    this.setPlaying(true);
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.onResize);
    this.dots.replaceChildren(...snaps.map((s, k) => h("button", { class: "film-dot", type: "button", title: s.title || s.name, "aria-label": `Diapositive ${k + 1}`, onclick: (e: Event) => (e.stopPropagation(), this.go(k, false)) })));
    this.go(this.i, false, true);
  }

  /** Message plein écran (histoire introuvable sur cet appareil…). */
  showMessage(title: string, body: string, actions: { label: string; href?: string; onclick?: () => void }[] = []): void {
    this.stop();
    this.snaps = [];
    this.root.hidden = false;
    if (this.o.reading) document.body.classList.add("reading-open");
    this.svg.style.display = "none";
    this.counter.textContent = "";
    this.role.textContent = "";
    this.crumbs.replaceChildren();
    this.dots.replaceChildren();
    this.storyTitle.textContent = "";
    this.msg.hidden = false;
    this.root.classList.add("has-msg");
    this.msg.replaceChildren(
      h("h2", null, title),
      h("p", null, body),
      h("div", { class: "film-msg-acts" }, ...actions.map((a) => (a.href ? h("a", { class: "btn btn-accent", href: a.href }, a.label) : h("button", { class: "btn", type: "button", onclick: (e: Event) => (e.stopPropagation(), a.onclick?.()) }, a.label))))
    );
    document.addEventListener("keydown", this.onKey);
  }

  close(): void {
    if (this.root.hidden) return;
    this.stop();
    this.root.hidden = true;
    if (this.o.reading) document.body.classList.remove("reading-open");
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onResize);
    this.o.onClose?.();
  }

  private key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") this.close();
    else if (e.key === "ArrowRight" || e.key === "PageDown" || (this.o.reading && e.key === "ArrowDown")) this.next();
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || (this.o.reading && e.key === "ArrowUp")) this.prev();
    else if (e.code === "Space") this.toggle();
    else if (this.o.reading && (e.key === "r" || e.key === "R")) this.replay();
    else if (this.o.reading && e.key === "Home") this.goTo(0);
    else if (this.o.reading && e.key === "End") this.goTo(this.snaps.length - 1);
    else return;
    e.preventDefault();
  }

  private pointerUp(e: PointerEvent): void {
    const p0 = this.p0;
    this.p0 = null;
    if (!p0 || !this.snaps.length) return;
    if ((e.target as Element | null)?.closest?.("a")) return;
    const dx = e.clientX - p0.x;
    const dy = e.clientY - p0.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) this.next();
      else this.prev();
      return;
    }
    if (Math.hypot(dx, dy) > 12) return;
    const r = this.stage.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) this.prev();
    else this.next();
  }

  private setPlaying(on: boolean): void {
    this.playing = on;
    this.playBtn.classList.toggle("paused", !on);
    this.playBtn.innerHTML = svgIcon(on ? ICONS.pause : ICONS.play, 22);
  }

  /** Pause : fige l'animation (et l'avance automatique du film) ; reprise là où elle s'était arrêtée. */
  toggle(): void {
    if (!this.snaps.length) return;
    if (this.playing) {
      this.setPlaying(false);
      this.pausedAt = performance.now() - this.t0;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
    } else {
      this.setPlaying(true);
      if (this.pausedAt !== null) {
        this.t0 = performance.now() - this.pausedAt;
        this.pausedAt = null;
        if (this.loop) this.loop();
        else this.schedule();
      } else if (!this.loop) this.schedule();
    }
  }

  /** Rejoue la construction de la diapositive courante. */
  replay(): void {
    const s = this.snaps[this.i];
    if (!s || this.busy) return;
    this.stop();
    this.setPlaying(true);
    this.show(s);
  }

  goTo(k: number): void {
    if (this.busy || !this.snaps.length) return;
    const n = Math.max(0, Math.min(this.snaps.length - 1, k));
    if (n !== this.i) this.go(n, n === this.i + 1);
  }

  next(): void {
    if (this.busy || !this.snaps.length) return;
    if (this.i < this.snaps.length - 1) this.go(this.i + 1, true);
    else if (!this.o.reading) this.close();
  }

  prev(): void {
    if (this.busy || this.i === 0) return;
    this.go(this.i - 1, false);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.loop = null;
  }

  /** Cible du zoom : élément du graphique courant correspondant à la nouvelle étape du chemin. */
  private zoomTarget(from: Snapshot, to: Snapshot): Element | null {
    const a = from.spec as Partial<ChartSpec>;
    const b = to.spec as Partial<ChartSpec>;
    if (a?.type !== "drill" || b?.type !== "drill" || !a.drill || !b.drill) return null;
    const pa = a.drill.path;
    const pb = b.drill.path;
    if (pb.length !== pa.length + 1 || !pa.every((s, k) => JSON.stringify(s) === JSON.stringify(pb[k]))) return null;
    const step = pb[pb.length - 1]!;
    if (step.kind === "period") return this.svg.querySelector(`[data-drill-key="${step.start}"] .r4d-drill-mark`);
    return [...this.svg.querySelectorAll(`[data-drill-kind="cat"]`)].find((el) => el.getAttribute("data-drill-value") === step.value) ?? null;
  }

  private go(k: number, forward: boolean, first = false): void {
    this.stop();
    const from = first ? undefined : this.snaps[this.i];
    const to = this.snaps[k]!;
    const target = forward && from ? this.zoomTarget(from, to) : null;
    this.i = k;
    // en lecture, changer de diapositive relance l'animation ; le film garde son état lecture / pause (avance auto)
    if (this.o.reading) this.setPlaying(true);
    this.pausedAt = null;
    [...this.dots.children].forEach((d, j) => d.classList.toggle("on", j === k));
    if (target) {
      // zoom dans l'élément cliqué, puis construction de l'étape suivante
      const vb = this.svg.viewBox.baseVal;
      const bb = (target as SVGGraphicsElement).getBBox();
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      const kx = Math.min(4, vb.width / Math.max(40, bb.width * 2.2));
      this.busy = true;
      this.svg.style.transformOrigin = `${(cx / vb.width) * 100}% ${(cy / vb.height) * 100}%`;
      this.svg.style.transition = `transform ${ZOOM_MS}ms cubic-bezier(.5,0,.75,0), opacity ${ZOOM_MS}ms ease-in`;
      this.svg.style.transform = `scale(${kx})`;
      this.svg.style.opacity = "0";
      this.timer = window.setTimeout(() => {
        this.svg.style.transition = "none";
        this.svg.style.transform = "";
        this.busy = false;
        this.show(to);
        this.svg.style.opacity = "1";
      }, ZOOM_MS);
      return;
    }
    this.svg.style.transition = "opacity 260ms ease";
    this.svg.style.opacity = "0";
    this.busy = true;
    this.timer = window.setTimeout(() => {
      this.busy = false;
      this.show(to);
      this.svg.style.opacity = "1";
    }, from && from !== to ? 260 : 0);
  }

  /** Spec affichée : titre, sous-titre et commentaires du snapshot ; format adapté à l'écran en mode lecture. */
  private specOf(s: Snapshot, base: ChartSpec): { spec: ChartSpec; boost: number | undefined } {
    let style = { ...base.style, title: s.title, subtitle: s.subtitle };
    let boost: number | undefined;
    if (this.o.reading) {
      const r = this.stage.getBoundingClientRect();
      const fit = readingSize(r.width - 16, r.height - 8, Math.min(window.innerWidth, window.visualViewport?.width ?? Infinity));
      this.lastSize = fit ? `${fit.width}x${fit.height}` : "";
      if (fit) {
        style = { ...style, size: { ...style.size, preset: "custom" as const, width: fit.width, height: fit.height } };
        boost = fit.boost;
      }
    }
    return { spec: { ...base, style, story: { ...base.story, comments: s.comments, showComments: true } }, boost };
  }

  private show(s: Snapshot): void {
    const k = this.i;
    this.counter.textContent = `${k + 1} / ${this.snaps.length}`;
    this.role.textContent = ROLE_LABELS[s.role].toUpperCase();
    const path = (s.path ?? []).length > 1 ? s.path! : [];
    this.crumbs.replaceChildren(...path.map((p, j) => h("span", { class: j === path.length - 1 ? "current" : "" }, j ? `› ${p}` : p)));
    [...this.dots.children].forEach((d, j) => d.classList.toggle("on", j === k));
    this.o.onSlide?.(s, k);
    const parsed = parseSpec(s.spec);
    const ds = parsed.ok ? this.datasetFor(s) : null;
    this.redraw = null;
    if (!parsed.ok || !ds) {
      // repli : rendu conservé
      this.svg.removeAttribute("viewBox");
      this.svg.innerHTML = "";
      const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
      img.setAttribute("href", s.thumb ?? "");
      img.setAttribute("width", String(s.width));
      img.setAttribute("height", String(s.height));
      this.svg.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
      this.svg.append(img);
      this.loop = null;
      this.schedule();
      return;
    }
    let { spec, boost } = this.specOf(s, parsed.spec);
    let cache = prepareCache(spec, ds, null, -1);
    const all = spec.story.comments;
    const total = BUILD_MS + all.length * COMMENT_MS;
    const now = s.generatedAt ? new Date(s.generatedAt) : new Date();
    const draw = (t: number) => {
      const build = Math.min(1, t / BUILD_MS);
      const shown = Math.max(0, Math.min(all.length, Math.floor((t - BUILD_MS * 0.7) / COMMENT_MS) + 1));
      renderChart(this.svg, { ...spec, story: { ...spec.story, comments: all.slice(0, shown) } }, ds, cache, { build, timePos: null }, { now, textBoost: boost });
      this.svg.removeAttribute("width");
      this.svg.removeAttribute("height");
    };
    this.redraw = () => {
      ({ spec, boost } = this.specOf(s, parsed.spec));
      cache = prepareCache(spec, ds, null, -1);
      draw(this.pausedAt ?? performance.now() - this.t0);
    };
    this.t0 = performance.now();
    this.pausedAt = null;
    const frame = () => {
      const t = this.pausedAt ?? performance.now() - this.t0;
      draw(t);
      if (this.pausedAt !== null) return;
      if (t < total) this.raf = requestAnimationFrame(frame);
      else {
        this.loop = null;
        this.schedule();
      }
    };
    this.loop = frame;
    frame();
  }

  private resized(): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      if (!this.isOpen || !this.o.reading || !this.redraw) return;
      const before = this.lastSize;
      const r = this.stage.getBoundingClientRect();
      const fit = readingSize(r.width - 16, r.height - 8, Math.min(window.innerWidth, window.visualViewport?.width ?? Infinity));
      if ((fit ? `${fit.width}x${fit.height}` : "") !== before) this.redraw();
    }, 120);
  }

  private copyLink(): void {
    const s = this.snaps[this.i];
    const url = s ? this.o.linkFor?.(s) : null;
    if (url) this.o.copy?.(url);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.playing || this.o.reading) return;
    this.timer = window.setTimeout(() => {
      if (this.i < this.snaps.length - 1) this.go(this.i + 1, true);
      else this.setPlaying(false);
    }, HOLD_MS);
  }

  /** Tests : avance immédiate à la fin de l'animation courante. */
  finishNow(): void {
    this.t0 = -1e9;
    if (this.pausedAt !== null) {
      this.pausedAt = 1e9;
      this.redraw?.();
    }
  }
}
