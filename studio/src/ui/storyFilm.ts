/**
 * Film de l'histoire : rejoue les snapshots en plein écran, avec construction animée de chaque graphique
 * (révélation 4D), zoom dans l'élément cliqué quand l'étape suivante prolonge le chemin d'exploration,
 * fondu sinon, et apparition progressive des commentaires « À retenir ».
 * Commandes : ←/→, espace (lecture/pause), Échap ; toucher l'image = étape suivante.
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

export class StoryFilm {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private svg: SVGSVGElement;
  private crumbs: HTMLElement;
  private counter: HTMLElement;
  private role: HTMLElement;
  private dots: HTMLElement;
  private playBtn: HTMLButtonElement;
  private snaps: Snapshot[] = [];
  private i = 0;
  private playing = true;
  private raf = 0;
  private t0 = 0;
  private timer = 0;
  private busy = false;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(private datasetFor: (s: Snapshot) => Dataset | null) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "film-svg");
    this.svg.setAttribute("data-testid", "film-svg");
    this.stage = h("div", { class: "film-stage", "data-testid": "film-stage", onclick: () => this.next() }, this.svg);
    this.crumbs = h("div", { class: "film-crumbs", "data-testid": "film-crumbs" });
    this.counter = h("span", { class: "film-counter", "data-testid": "film-counter" });
    this.role = h("span", { class: "film-role" });
    this.dots = h("div", { class: "film-dots" });
    const btn = (icon: string, title: string, fn: () => void, testid: string) => h("button", { class: "film-btn", type: "button", title, "aria-label": title, "data-testid": testid, html: svgIcon(icon, 22), onclick: (e: Event) => (e.stopPropagation(), fn()) });
    this.playBtn = btn(ICONS.pause, "Lecture / pause (espace)", () => this.toggle(), "film-play") as HTMLButtonElement;
    this.root = h(
      "div",
      { class: "film", hidden: true, role: "dialog", "aria-label": "Film de l'histoire", "data-testid": "film" },
      h("header", { class: "film-top" }, this.role, this.crumbs, h("span", { class: "spacer" }), this.counter, btn(ICONS.close, "Fermer (Échap)", () => this.close(), "film-close")),
      this.stage,
      h("footer", { class: "film-bottom" }, btn(ICONS.prev, "Étape précédente (←)", () => this.prev(), "film-prev"), this.playBtn, btn(ICONS.next, "Étape suivante (→)", () => this.next(), "film-next"), this.dots)
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(snaps: Snapshot[], start = 0): void {
    if (!snaps.length) return;
    this.snaps = snaps;
    this.root.hidden = false;
    this.playing = true;
    this.playBtn.innerHTML = svgIcon(ICONS.pause, 22);
    document.addEventListener("keydown", this.onKey);
    this.dots.replaceChildren(...snaps.map((s, k) => h("button", { class: "film-dot", type: "button", title: s.title || s.name, "aria-label": `Étape ${k + 1}`, onclick: (e: Event) => (e.stopPropagation(), this.go(k, false)) })));
    this.go(start, false);
  }

  close(): void {
    this.stop();
    this.root.hidden = true;
    document.removeEventListener("keydown", this.onKey);
  }

  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") this.close();
    else if (e.key === "ArrowRight" || e.key === "PageDown") this.next();
    else if (e.key === "ArrowLeft" || e.key === "PageUp") this.prev();
    else if (e.code === "Space") this.toggle();
    else return;
    e.preventDefault();
  }

  private toggle(): void {
    this.playing = !this.playing;
    this.playBtn.classList.toggle("paused", !this.playing);
    this.playBtn.innerHTML = svgIcon(this.playing ? ICONS.pause : ICONS.play, 22);
    if (this.playing) this.schedule();
    else clearTimeout(this.timer);
  }

  next(): void {
    if (this.busy) return;
    if (this.i < this.snaps.length - 1) this.go(this.i + 1, true);
    else this.close();
  }

  prev(): void {
    if (this.busy || this.i === 0) return;
    this.go(this.i - 1, false);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
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

  private go(k: number, forward: boolean): void {
    this.stop();
    const from = this.snaps[this.i];
    const to = this.snaps[k]!;
    const target = forward && from ? this.zoomTarget(from, to) : null;
    this.i = k;
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

  private show(s: Snapshot): void {
    const k = this.i;
    this.counter.textContent = `${k + 1} / ${this.snaps.length}`;
    this.role.textContent = ROLE_LABELS[s.role].toUpperCase();
    const path = s.path ?? [];
    this.crumbs.replaceChildren(...path.map((p, j) => h("span", { class: j === path.length - 1 ? "current" : "" }, j ? `› ${p}` : p)));
    [...this.dots.children].forEach((d, j) => d.classList.toggle("on", j === k));
    const parsed = parseSpec(s.spec);
    const ds = parsed.ok ? this.datasetFor(s) : null;
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
      this.schedule();
      return;
    }
    const spec: ChartSpec = { ...parsed.spec, style: { ...parsed.spec.style, title: s.title, subtitle: s.subtitle }, story: { ...parsed.spec.story, comments: s.comments, showComments: true } };
    const cache = prepareCache(spec, ds, null, -1);
    const all = spec.story.comments;
    const total = BUILD_MS + all.length * COMMENT_MS;
    const now = s.generatedAt ? new Date(s.generatedAt) : new Date();
    this.t0 = performance.now();
    const frame = () => {
      const t = performance.now() - this.t0;
      const build = Math.min(1, t / BUILD_MS);
      const shown = Math.max(0, Math.min(all.length, Math.floor((t - BUILD_MS * 0.7) / COMMENT_MS) + 1));
      renderChart(this.svg, { ...spec, story: { ...spec.story, comments: all.slice(0, shown) } }, ds, cache, { build, timePos: null }, { now });
      this.svg.removeAttribute("width");
      this.svg.removeAttribute("height");
      if (t < total) this.raf = requestAnimationFrame(frame);
      else this.schedule();
    };
    frame();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.playing) return;
    this.timer = window.setTimeout(() => {
      if (this.i < this.snaps.length - 1) this.go(this.i + 1, true);
      else this.playing = false;
    }, HOLD_MS);
  }

  /** Tests : avance immédiate à la fin de l'animation courante. */
  finishNow(): void {
    this.t0 = -1e9;
  }
}
