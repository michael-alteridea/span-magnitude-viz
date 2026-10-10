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
import { clearZoom, diveIn, dominantFill, easeOut, emergeMs, foldOut, markForStep, paintCollapse, paintVeil, pathDelta, reducedMotion, zoomEnabled } from "./drillZoom";
import type { PlotRect } from "../charts/context";
import { ChartTooltip } from "./tooltip";
import { isSpecial, parseSpec, type ChartSpec, type DrillStep } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, renderChart } from "../charts/render";
import { SpecialLayer, loadSpecialModule, specialModule } from "../charts/specialFrame";
import type { Snapshot } from "../story/snapshots";
import { ROLE_LABELS } from "../story/snapshots";
import { h, svgIcon, ICONS } from "./dom";
import { focusDelta } from "../charts/focus";
import { elementNotes } from "../story/elementNotes";
import { bulletsDuration, bulletsShownAt } from "../story/bulletReveal";
import { LOGO_ANIM_S, logoAnimMarkup } from "../brand";

let introSeq = 0;
/** Introduction du logo animé : jamais avec « réduire les animations », ni sous automate (tests), sauf demande explicite. */
export function introEnabled(): boolean {
  // DOM de test sans matchMedia (rendu en Node) : pas d'introduction
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" || reducedMotion()) return false;
  let forced = false;
  try {
    forced = localStorage.getItem("datanime:intro") === "1";
  } catch {
    /* stockage indisponible */
  }
  return forced || !(typeof navigator !== "undefined" && navigator.webdriver);
}

const BUILD_MS = 1300;
/** Transition « mise en avant » (étape L) : grisé, part tirée, halo et bulle. */
const FOCUS_MS = 1000;
const HOLD_MS = 2600;
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
  /** Introduction (logo C15 animé, ~4 s, passée d'un toucher) avant la première diapositive. */
  private intro: HTMLElement;
  private introTimer = 0;
  private introDone: (() => void) | null = null;
  private onResize = () => this.resized();
  private resizeTimer = 0;
  private lastSize = "";
  /** Zone du graphique du dernier rendu (transition « zoom dans la marque »). */
  private plot: PlotRect | null = null;
  private fx: { kind: "emerge"; fill: string; t0: number; ms: number } | { kind: "collapse"; step: DrillStep; t0: number; ms: number } | null = null;
  /** Jeton d'annulation des transitions (fermeture, navigation rapide). */
  private seq = 0;
  private finishPending = false;
  /** Carte / film de la bibliothèque (types spéciaux) : rendu hors champ recopié dans la zone du graphique. */
  private special = new SpecialLayer();

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
    // Mode lecture : infobulles des marques (un toucher sur une marque l'affiche sans changer de diapositive) ; jamais dans le film
    if (o.reading) new ChartTooltip(this.stage, { swallowTap: true, tapToPreview: false, hints: false });
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
    this.intro = h("div", { class: "film-intro", hidden: true, role: "button", tabindex: "0", "aria-label": "Passer l'introduction", title: "Toucher pour passer", "data-testid": `${tid}-intro` });
    this.intro.addEventListener("pointerdown", (e) => (e.stopPropagation(), e.preventDefault(), this.endIntro(true)));
    this.intro.addEventListener("click", (e) => e.stopPropagation());
    this.root = h(
      "div",
      { class: `film${o.reading ? " reader" : ""}`, hidden: true, role: "dialog", "aria-label": o.reading ? "Mode lecture" : "Film de la séquence", "data-testid": tid },
      top,
      this.stage,
      bottom,
      this.intro
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
    if (introEnabled()) this.startIntro(() => this.go(this.i, false, true));
    else this.go(this.i, false, true);
  }

  /** L'introduction est-elle à l'écran ? */
  get introShown(): boolean {
    return !this.intro.hidden;
  }

  private startIntro(done: () => void): void {
    this.endIntro(false);
    this.introDone = done;
    this.svg.style.opacity = "0";
    this.intro.innerHTML = `${logoAnimMarkup("dark", `fi${++introSeq}`, { cls: "film-intro-logo" })}<span class="film-intro-hint">Toucher pour passer</span>`;
    this.intro.hidden = false;
    this.introTimer = window.setTimeout(() => this.endIntro(true), LOGO_ANIM_S * 1000 + 250);
  }

  /** Termine l'introduction ; `run` : enchaîne sur la première diapositive. */
  private endIntro(run: boolean): void {
    clearTimeout(this.introTimer);
    const done = this.introDone;
    this.introDone = null;
    if (this.intro.hidden) return;
    this.intro.hidden = true;
    this.intro.replaceChildren();
    this.svg.style.opacity = "1";
    if (run && done) done();
  }

  /** Message plein écran (histoire introuvable sur cet appareil…). */
  showMessage(title: string, body: string, actions: { label: string; href?: string; onclick?: () => void }[] = []): void {
    this.endIntro(false);
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
    this.endIntro(false);
    this.stop();
    this.root.hidden = true;
    if (this.o.reading) document.body.classList.remove("reading-open");
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onResize);
    this.special.dispose();
    this.o.onClose?.();
  }

  private key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "Escape" && this.introShown) {
      // pendant l'introduction, toute touche la passe (sans autre effet)
      e.preventDefault();
      this.endIntro(true);
      return;
    }
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
      // pause pendant une transition « zoom dans la marque » : la diapositive suivante s'affichera complète, figée
      if (this.busy) this.finishPending = true;
      this.pausedAt = performance.now() - this.t0;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
      this.special.pauseLive();
    } else {
      this.setPlaying(true);
      if (this.pausedAt !== null) {
        this.t0 = performance.now() - this.pausedAt;
        this.pausedAt = null;
        if (this.loop) this.loop();
        else this.schedule();
        this.special.resumeLive();
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
    this.seq++;
    this.busy = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.loop = null;
  }

  /** Étape d'exploration qui relie deux diapositives parent / enfant (descente ou remontée), sinon null. */
  private drillDelta(from: Snapshot, to: Snapshot): { dir: "in" | "out"; step: DrillStep } | null {
    const a = from.spec as Partial<ChartSpec>;
    const b = to.spec as Partial<ChartSpec>;
    if (a?.type !== "drill" || b?.type !== "drill" || !a.drill || !b.drill) return null;
    return pathDelta(a.drill.path, b.drill.path);
  }

  private go(k: number, forward: boolean, first = false): void {
    if (this.introShown) {
      // navigation (point, lien profond) pendant l'introduction : on la coupe et on montre directement la diapositive
      this.endIntro(false);
      first = true;
    }
    this.stop();
    const from = first ? undefined : this.snaps[this.i];
    const to = this.snaps[k]!;
    const delta = from && from !== to ? this.drillDelta(from, to) : null;
    void forward;
    this.i = k;
    // en lecture, changer de diapositive relance l'animation ; le film garde son état lecture / pause (avance auto)
    if (this.o.reading) this.setPlaying(true);
    this.pausedAt = null;
    [...this.dots.children].forEach((d, j) => d.classList.toggle("on", j === k));
    this.svg.style.transition = "none";
    this.svg.style.opacity = "1";
    const plot = this.plot;
    if (delta && plot && zoomEnabled()) {
      // « zoom dans la marque » : descente (la marque remplit le graphique, l'enfant en émerge) ou remontée
      const seq = this.seq;
      this.busy = true;
      void (async () => {
        if (delta.dir === "in") {
          const el = markForStep(this.svg, delta.step);
          const fill = el ? await diveIn(this.svg, el, plot) : dominantFill(this.svg);
          this.fx = { kind: "emerge", fill, t0: 0, ms: emergeMs() };
        } else {
          await foldOut(this.svg, plot, dominantFill(this.svg));
          this.fx = { kind: "collapse", step: delta.step, t0: 0, ms: emergeMs() };
        }
        if (seq !== this.seq) return;
        this.busy = false;
        this.show(to, delta.dir === "out");
      })();
      return;
    }
    this.fx = null;
    if (!from || from === to) {
      this.show(to);
      return;
    }
    // même graphique, seule la mise en avant change : pas de fondu, le grisé et la bulle s'animent
    const fdir = focusDelta(from.spec, to.spec);
    if (fdir && !reducedMotion()) {
      this.show(to, true, { dir: fdir, from: from.spec });
      return;
    }
    this.svg.style.transition = "opacity 260ms ease";
    this.svg.style.opacity = "0";
    this.busy = true;
    this.timer = window.setTimeout(() => {
      this.busy = false;
      this.svg.style.transition = "none";
      this.show(to);
      this.svg.style.opacity = "1";
    }, reducedMotion() ? 0 : 260);
  }

  /** Phase 2 de la transition, peinte par-dessus chaque image : voile d'émergence ou marque parente qui rétrécit. */
  private paintFx(): void {
    const fx = this.fx;
    const plot = this.plot;
    if (!fx || !plot) return;
    if (!fx.t0) fx.t0 = performance.now();
    const t = Math.min(1, (performance.now() - fx.t0) / fx.ms);
    if (t >= 1) {
      this.fx = null;
      clearZoom(this.svg);
      return;
    }
    if (fx.kind === "emerge") paintVeil(this.svg, plot, fx.fill, 0.92 * (1 - easeOut(t)), "emerge");
    else paintCollapse(this.svg, markForStep(this.svg, fx.step), plot, t);
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

  /** `built` : graphique d'emblée complet (remontée : la marque d'origine doit être à sa place). */
  private show(s: Snapshot, built = false, focusFx: { dir: "in" | "out"; from: unknown } | null = null): void {
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
      this.plot = null;
      this.fx = null;
      this.finishPending = false;
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
    // type spécial (carte, film) : la bibliothèque est chargée à la demande ; la diapositive est redessinée une fois prête
    const special = isSpecial(parsed.spec.type);
    if (special && !specialModule()) {
      const seq = this.seq;
      void loadSpecialModule().then(() => {
        if (seq === this.seq && this.isOpen && this.snaps[this.i] === s) this.show(s, built, focusFx);
      });
    }
    let { spec, boost } = this.specOf(s, parsed.spec);
    // sortie de mise en avant : le graphique part de l'état mis en avant du snapshot précédent
    const outFocus = focusFx?.dir === "out" ? (focusFx.from as Partial<ChartSpec>)?.style?.focus : undefined;
    const withFocus = (sp: ChartSpec): ChartSpec => (outFocus ? { ...sp, style: { ...sp.style, focus: outFocus } } : sp);
    let cache = prepareCache(spec, ds, null, -1);
    const all = spec.story.comments;
    // toutes les puces arrivent une à une : générales (3 au plus) puis puces colorées par élément
    const nBullets = all.map((c) => c.trim()).filter(Boolean).slice(0, 3).length + elementNotes(spec, ds).length;
    const fms = focusFx ? FOCUS_MS : 0;
    // 4D : même glissement que dans le studio (position continue entre deux années, pas un saut)
    const nSteps = cache.time?.steps.length ?? 0;
    const d4 = nSteps >= 2 ? spec.mode.fourD.durationMs : 0;
    const timeAt = (t: number): number | null => (d4 ? Math.min(nSteps - 1, Math.max(0, t / d4) * (nSteps - 1)) : null);
    // carte / film qui évolue : la révélation dure le temps du film (durée 4D), pas seulement la construction
    const sd = special && spec.mode.kind === "dynamic" && !reducedMotion() ? spec.mode.fourD.durationMs : 0;
    const start = d4 ? d4 * 0.85 : sd ? sd * 0.85 : BUILD_MS * 0.7 + fms * 0.6;
    const total = Math.max(BUILD_MS + fms, d4 + 600, sd + 600, start + bulletsDuration(nBullets));
    this.svg.toggleAttribute("data-focus-anim", !!focusFx);
    const now = s.generatedAt ? new Date(s.generatedAt) : new Date();
    const draw = (t: number) => {
      const build = d4 ? 1 : Math.min(1, t / BUILD_MS);
      const shown = bulletsShownAt(t, nBullets, start);
      const fp = focusFx ? Math.max(0, Math.min(1, (t - BUILD_MS) / FOCUS_MS)) : 1;
      const out = focusFx?.dir === "out" && fp < 1;
      const base = this.o.reading ? { ...spec, style: { ...spec.style, authQr: false } } : spec;
      const sp = out ? withFocus(base) : base;
      const focus = focusFx ? (focusFx.dir === "in" ? fp : 1 - fp) : undefined;
      const res = renderChart(this.svg, sp, ds, cache, { build, timePos: timeAt(t), ...(focus !== undefined && (focusFx!.dir === "in" || out) ? { focus } : {}) }, { now, textBoost: boost, commentsAll: all, bulletsShown: shown });
      // carte / film : copie dans le cadre (tests, export). En lecture, un film qui évolue joue en vrai par-dessus.
      const live = special && !!this.o.reading && sp.mode.kind === "dynamic" && !reducedMotion();
      if (special && !live) this.special.paint(this.svg, sp, ds, res.plot, res.theme, sp.mode.kind === "dynamic" ? (sd ? Math.min(1, t / sd) : build) : 1);
      if (live) this.placeLive(sp, ds, res.plot, res.theme);
      this.svg.setAttribute("data-bullets", `${shown}/${nBullets}`);
      if (d4) this.svg.setAttribute("data-time-step", `${timeAt(t)! + 1}/${nSteps}`);
      else this.svg.removeAttribute("data-time-step");
      this.svg.setAttribute("data-focus-progress", focusFx ? fp.toFixed(2) : "1");
      this.svg.removeAttribute("width");
      this.svg.removeAttribute("height");
      this.plot = res.plot;
      this.paintFx();
    };
    this.redraw = () => {
      ({ spec, boost } = this.specOf(s, parsed.spec));
      cache = prepareCache(spec, ds, null, -1);
      draw(this.pausedAt ?? performance.now() - this.t0);
    };
    const done = this.finishPending;
    this.finishPending = false;
    this.t0 = done ? performance.now() - total : performance.now() - (built ? BUILD_MS : 0);
    if (done) this.fx = null;
    this.pausedAt = null;
    const frame = () => {
      const t = this.pausedAt ?? performance.now() - this.t0;
      draw(t);
      if (this.pausedAt !== null) return;
      if (t < total || this.fx) this.raf = requestAnimationFrame(frame);
      else {
        this.loop = null;
        this.schedule();
      }
    };
    this.loop = frame;
    // mis en pause pendant la transition : image finale, figée
    if (done && !this.playing) this.pausedAt = total;
    frame();
  }

  /** Pose le film réel (même moteur que le studio) sur la zone du graphique. */
  private placeLive(spec: ChartSpec, ds: Dataset, plot: PlotRect, theme: import("../theme").Theme): void {
    const vb = this.svg.viewBox.baseVal;
    const svgR = this.svg.getBoundingClientRect();
    const stageR = this.stage.getBoundingClientRect();
    if (!vb.width || !svgR.width) return;
    const sx = svgR.width / vb.width;
    const sy = svgR.height / vb.height;
    const box = {
      left: svgR.left - stageR.left + plot.x * sx,
      top: svgR.top - stageR.top + plot.y * sy,
      width: plot.w * sx,
      height: plot.h * sy,
    };
    if (this.stage.querySelector("[data-testid=special-live-host]")) return;
    this.stage.style.position = "relative";
    this.special.playLive(this.stage, spec, ds, plot, theme, box);
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
    // transition « zoom dans la marque » en cours : la diapositive suivante s'affichera d'emblée complète
    if (this.busy) this.finishPending = true;
    this.fx = null;
    this.t0 = -1e9;
    if (this.pausedAt !== null) {
      this.pausedAt = 1e9;
      this.redraw?.();
    }
  }
}
