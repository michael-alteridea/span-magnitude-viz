/**
 * Zone centrale : scène SVG mise à l'échelle, lecteur (lecture / pause / curseur) pour
 * l'animation d'entrée et la 4D, montage des types spéciaux (film, carte).
 */
import type { Store, ChangeKind } from "../state";
import { chartSize, isSpecial } from "../spec";
import { fourDActive, prepareCache, renderChart, type PrepCache, type RenderResult } from "../charts/render";
import { effectiveDataset } from "../data/transform";
import type { Frame, PlotRect } from "../charts/context";
import { ensureFont, fontStack } from "../theme";
import { composeSvg } from "../export";
import { h, svgIcon, ICONS } from "./dom";
import { formatDate } from "../format";
import type { SpecialMount } from "../charts/special";

type PlayMode = "none" | "build" | "4d" | "special";

export class Preview {
  readonly root: HTMLElement;
  private store: Store;
  private wrap: HTMLElement;
  private box: HTMLElement;
  private stage: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly specialHost: HTMLElement;
  private overlay: HTMLElement;
  private status: HTMLElement;
  private bar: HTMLElement;
  private playBtn: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private timeLabel: HTMLElement;
  private speedSel: HTMLSelectElement;

  private cache: PrepCache | null = null;
  last: RenderResult | null = null;
  private special: SpecialMount | null = null;
  private specialKey = "";
  private restartKey = "";
  private scale = 1;

  private mode: PlayMode = "none";
  private playing = false;
  private t = 0;
  private raf = 0;
  private lastTs = 0;
  private speed = 1;
  private scrubbing = false;
  /** Écouteurs externes (ex. bouton d'export vidéo). */
  onModeChange: ((mode: PlayMode) => void) | null = null;

  constructor(store: Store) {
    this.store = store;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "r4d-svg");
    this.svg.setAttribute("data-testid", "chart-svg");
    this.specialHost = h("div", { class: "r4d-special-host", "data-testid": "special-host" });
    this.overlay = h("div", { class: "r4d-special-error" });
    this.stage = h("div", { class: "stage" }, this.svg, this.specialHost, this.overlay);
    this.box = h("div", { class: "stage-box" }, this.stage);
    this.wrap = h("div", { class: "stage-wrap" }, this.box);
    this.playBtn = h("button", { class: "icon-btn play", title: "Lecture / pause (espace)", "data-testid": "play", html: svgIcon(ICONS.play, 18), onclick: () => this.toggle() });
    const restart = h("button", { class: "icon-btn", title: "Rejouer depuis le début", "data-testid": "restart", html: svgIcon(ICONS.restart, 18), onclick: () => this.restart(true) });
    this.scrub = h("input", { type: "range", min: "0", max: "1000", value: "1000", class: "scrubber", "aria-label": "Position de l'animation", "data-testid": "scrubber" });
    this.scrub.addEventListener("input", () => this.onScrub());
    this.paintScrub();
    this.scrub.addEventListener("pointerdown", () => (this.scrubbing = true));
    this.scrub.addEventListener("pointerup", () => (this.scrubbing = false));
    this.timeLabel = h("span", { class: "time-label", "data-testid": "time-label" }, "");
    this.speedSel = h(
      "select",
      { class: "speed", title: "Vitesse", onchange: () => (this.speed = Number(this.speedSel.value)) },
      ...[0.5, 1, 1.5, 2, 4].map((v) => h("option", { value: String(v), selected: v === 1 }, `${String(v).replace(".", ",")}×`))
    );
    this.bar = h("div", { class: "player", "data-testid": "player" }, this.playBtn, restart, this.scrub, this.timeLabel, this.speedSel);
    this.status = h("div", { class: "status", "data-testid": "status" });
    this.root = h("div", { class: "preview" }, this.wrap, this.bar, this.status);
    new ResizeObserver(() => this.fit()).observe(this.wrap);
    this.svg.addEventListener("dblclick", (e) => this.onEditRequest(e));
    // Exploration guidée : clic (ou toucher) sur une barre, une région, une ligne → zoom / focus
    this.svg.addEventListener("click", (e) => {
      const el = (e.target as Element | null)?.closest?.("[data-drill-kind]");
      if (el && this.onDrill) {
        e.preventDefault();
        this.onDrill(el);
      }
    });
    document.addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) && this.mode !== "none") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /* ----------------------------------------------------------------- état */

  private computeMode(): PlayMode {
    const { spec, ds } = this.store.state;
    if (spec.mode.kind === "static" || !ds) return "none";
    if (isSpecial(spec.type)) return "special";
    if (fourDActive(spec, ds) && (this.cache?.time?.steps.length ?? 0) >= 2) return "4d";
    if (spec.mode.buildIn) return "build";
    return "none";
  }

  private duration(): number {
    const spec = this.store.state.spec;
    return this.mode === "4d" ? spec.mode.fourD.durationMs : spec.mode.buildInMs;
  }

  frameAt(p: number): Frame {
    const n = this.cache?.time?.steps.length ?? 0;
    if (this.mode === "build") return { build: p, timePos: null };
    if (this.mode === "4d") return { build: 1, timePos: p * Math.max(0, n - 1) };
    return { build: 1, timePos: null };
  }

  get playMode(): PlayMode {
    return this.mode;
  }

  /** Appelé à chaque changement du store. */
  async update(kinds: Set<ChangeKind>): Promise<void> {
    const { spec, ds, dsVersion } = this.store.state;
    await ensureFont(spec.style.font);
    this.stage.style.setProperty("--chart-font", fontStack(spec.style.font));
    this.cache = prepareCache(spec, ds, this.cache, dsVersion);
    const prevMode = this.mode;
    this.mode = this.computeMode();
    if (prevMode !== this.mode) this.onModeChange?.(this.mode);
    this.bar.classList.toggle("hidden", this.mode === "none");
    const rk = JSON.stringify([dsVersion, spec.type, spec.encoding, spec.mode, this.mode, spec.type === "drill" ? spec.drill : null]);
    const restartNeeded = rk !== this.restartKey;
    this.restartKey = rk;
    if (restartNeeded && this.mode !== "none" && this.mode !== "special") {
      this.restart(true);
      return;
    }
    if (this.mode === "none") this.stop();
    this.draw();
    void kinds;
  }

  private draw(): void {
    const { spec, ds } = this.store.state;
    const p = this.mode === "none" ? 1 : Math.min(1, this.t / this.duration());
    const frame = this.frameAt(this.mode === "special" ? 1 : p);
    this.last = renderChart(this.svg, spec, ds, this.cache!, frame);
    this.fit();
    this.syncSpecial();
    if (this.mode !== "special") {
      if (!this.scrubbing) this.setScrub(p);
      this.timeLabel.textContent = this.mode === "4d" ? this.last.prepared.stamp ?? "" : this.mode === "build" ? "Entrée" : "";
    }
    const warn = [...(this.last.prepared.warnings ?? [])];
    this.status.textContent = warn.join(" · ");
    this.status.classList.toggle("hidden", !warn.length);
  }

  private fit(): void {
    const spec = this.store.state.spec;
    const { width: W, height: H } = chartSize(spec);
    const r = this.wrap.getBoundingClientRect();
    const k = Math.max(0.05, Math.min((r.width - 32) / W, (r.height - 32) / H, 1.6));
    this.scale = k;
    this.stage.style.width = `${W}px`;
    this.stage.style.height = `${H}px`;
    this.stage.style.transform = `scale(${k})`;
    this.box.style.width = `${W * k}px`;
    this.box.style.height = `${H * k}px`;
  }

  /* -------------------------------------------------------- types spéciaux */

  private async syncSpecial(): Promise<void> {
    const { spec, ds, dsVersion } = this.store.state;
    const plot = this.last?.plot;
    if (!isSpecial(spec.type) || !ds || !plot) {
      if (this.special) {
        this.special.destroy();
        this.special = null;
        this.specialKey = "";
      }
      this.specialHost.style.display = "none";
      this.overlay.style.display = "none";
      return;
    }
    const key = JSON.stringify([dsVersion, spec.type, spec.encoding, spec.transform, spec.special, spec.mode.kind, spec.mode.fourD.durationMs, spec.style.palette, spec.style.background, spec.style.backgroundCustom, Math.round(plot.w), Math.round(plot.h)]);
    Object.assign(this.specialHost.style, { display: "block", left: `${plot.x}px`, top: `${plot.y}px`, width: `${plot.w}px`, height: `${plot.h}px` });
    if (key === this.specialKey) return;
    this.specialKey = key;
    this.special?.destroy();
    this.special = null;
    const mod = await import("../charts/special");
    if (key !== this.specialKey) return;
    const animate = spec.mode.kind === "dynamic";
    const theme = this.last!.theme;
    const m = mod.mountSpecial(this.specialHost, spec, effectiveDataset(spec, ds), plot, theme, {
      animate,
      onTick: (st) => {
        if (!this.scrubbing) this.setScrub(st.progress);
        this.timeLabel.textContent = this.specialLabel(st.progress);
      },
      onComplete: () => {
        this.playing = false;
        this.syncPlayBtn();
      },
    });
    this.special = m;
    this.overlay.textContent = m.error ?? "";
    this.overlay.style.display = m.error ? "flex" : "none";
    Object.assign(this.overlay.style, { left: `${plot.x}px`, top: `${plot.y}px`, width: `${plot.w}px`, height: `${plot.h}px` });
    this.playing = animate && !m.error;
    this.syncPlayBtn();
  }

  private specialLabel(p: number): string {
    const d = this.special?.xDomain;
    if (!d) return "";
    const v = d[0] + (d[1] - d[0]) * p;
    return this.special?.unit === "date" ? formatDate(v, "month") : String(Math.round(v));
  }

  /* --------------------------------------------------------------- lecteur */

  private syncPlayBtn() {
    this.playBtn.innerHTML = svgIcon(this.playing ? ICONS.pause : ICONS.play, 18);
    this.playBtn.classList.toggle("is-playing", this.playing);
  }

  private loop = (ts: number) => {
    if (!this.playing) return;
    if (!this.lastTs) this.lastTs = ts;
    const dt = Math.min(100, ts - this.lastTs);
    this.lastTs = ts;
    this.t += dt * this.speed;
    const dur = this.duration();
    if (this.t >= dur) {
      if (this.mode === "4d" && this.store.state.spec.mode.fourD.loop) this.t = 0;
      else {
        this.t = dur;
        this.playing = false;
        this.syncPlayBtn();
      }
    }
    this.draw();
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  };

  play(): void {
    if (this.mode === "none") return;
    if (this.mode === "special") {
      this.special?.handle?.play();
      this.playing = true;
      this.syncPlayBtn();
      return;
    }
    if (this.t >= this.duration()) this.t = 0;
    this.playing = true;
    this.lastTs = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.syncPlayBtn();
  }

  pause(): void {
    if (this.mode === "special") this.special?.handle?.pause();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncPlayBtn();
  }

  private stop(): void {
    this.pause();
    this.t = 0;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(play: boolean): void {
    if (this.mode === "special") {
      this.special?.handle?.reset();
      if (play) this.play();
      return;
    }
    cancelAnimationFrame(this.raf);
    this.t = 0;
    this.draw();
    if (play) this.play();
  }

  /** Positionne l'animation (0..1) et met en pause. */
  seek(p: number): void {
    this.pause();
    if (this.mode === "special") {
      this.special?.handle?.setProgress(p);
      return;
    }
    this.t = p * this.duration();
    this.draw();
  }

  private onScrub(): void {
    this.paintScrub();
    this.seek(Number(this.scrub.value) / 1000);
  }

  /** Position du curseur (0 → 1) + remplissage pétrole de la partie parcourue. */
  private setScrub(p: number): void {
    this.scrub.value = String(Math.round(p * 1000));
    this.paintScrub();
  }

  private paintScrub(): void {
    this.scrub.style.setProperty("--pct", `${Number(this.scrub.value) / 10}%`);
  }

  /* ---------------------------------------------------------------- export */

  async currentSvg(): Promise<string> {
    const { spec } = this.store.state;
    if (!this.last) this.draw();
    return composeSvg({ svg: this.svg, spec, plot: this.last!.plot, specialHost: isSpecial(spec.type) ? this.specialHost : null });
  }

  /**
   * SVG « nu » pour les snapshots / diapositives : graphique + signature, sans titre, sous-titre
   * ni commentaires (portés par la diapositive), polices non embarquées (ré-embarquées à l'export).
   */
  async bareSvg(): Promise<string> {
    const { spec, ds } = this.store.state;
    if (!this.last) this.draw();
    const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const res = renderChart(tmp, spec, ds, this.cache!, { build: 1, timePos: this.mode === "4d" ? this.frameAt(1).timePos : null }, { bare: true });
    return composeSvg({ svg: tmp, spec, plot: res.plot, specialHost: isSpecial(spec.type) ? this.specialHost : null, embedFonts: false });
  }

  /** Rendu complet en fin d'animation (vignettes de snapshot), sans toucher à la lecture en cours. */
  async finalSvg(): Promise<string> {
    const { spec, ds } = this.store.state;
    if (!this.last) this.draw();
    if (this.mode === "none" || this.mode === "special") return this.currentSvg();
    const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const res = renderChart(tmp, spec, ds, this.cache!, this.frameAt(1));
    return composeSvg({ svg: tmp, spec, plot: res.plot, specialHost: null });
  }

  /** Clic sur un élément d'exploration (data-drill-*) : branché par main. */
  onDrill: ((el: Element) => void) | null = null;

  /* ------------------------------------------------------- édition directe */

  /** Callback d'édition (titre, sous-titre, commentaire i) : branché par main. */
  onEditText: ((field: string, value: string) => void) | null = null;

  private onEditRequest(e: MouseEvent): void {
    const target = (e.target as Element | null)?.closest?.("[data-r4d-edit]");
    if (!target) return;
    const field = target.getAttribute("data-r4d-edit")!;
    this.openEditor(field);
  }

  /** Ouvre l'éditeur en place (zone de texte superposée au texte du graphique). */
  openEditor(field: string): HTMLTextAreaElement | null {
    const spec = this.store.state.spec;
    const sel = field.startsWith("comment:") ? `[data-r4d-edit="${field}"]` : `[data-r4d-edit="${field}"]`;
    const nodes = [...this.svg.querySelectorAll(sel)];
    if (!nodes.length) return null;
    const rects = nodes.map((n) => n.getBoundingClientRect());
    const box = this.stage.getBoundingClientRect();
    const left = Math.min(...rects.map((r) => r.left)) - box.left;
    const top = Math.min(...rects.map((r) => r.top)) - box.top;
    const right = Math.max(...rects.map((r) => r.right)) - box.left;
    const bottom = Math.max(...rects.map((r) => r.bottom)) - box.top;
    const k = this.scale || 1;
    const value = field === "title" ? spec.style.title : field === "subtitle" ? spec.style.subtitle : spec.story.comments[Number(field.split(":")[1])] ?? "";
    const fs = parseFloat(nodes[0]!.getAttribute("font-size") ?? (nodes[0]!.querySelector("text")?.getAttribute("font-size") ?? "16"));
    this.stage.querySelector(".r4d-inline-editor")?.remove();
    const { width: W } = chartSize(spec);
    const ta = h("textarea", { class: "r4d-inline-editor", "data-testid": "inline-editor", spellcheck: "true", maxlength: field === "title" ? "200" : "300" });
    ta.value = value;
    const lx = left / k;
    Object.assign(ta.style, {
      left: `${lx - 6}px`,
      top: `${top / k - 6}px`,
      width: `${Math.max(240, Math.min(W - lx - 10, Math.max(right - left, 200) / k + 40))}px`,
      height: `${Math.max(fs * 1.6, (bottom - top) / k + 16)}px`,
      fontSize: `${fs}px`,
      fontWeight: field === "title" ? "700" : "400",
    });
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const v = ta.value.replace(/\s*\n\s*/g, " ").trim();
      ta.remove();
      if (commit && v !== value) this.onEditText?.(field, v);
    };
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
      ev.stopPropagation();
    });
    ta.addEventListener("blur", () => finish(true));
    this.stage.appendChild(ta);
    ta.focus();
    ta.select();
    return ta;
  }

  /** SVG d'une frame à la progression p (export vidéo). */
  async svgAt(p: number): Promise<string> {
    const { spec, ds } = this.store.state;
    if (this.mode === "special") {
      this.special?.handle?.setProgress(p);
      return this.currentSvg();
    }
    const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const res = renderChart(tmp, spec, ds, this.cache!, this.frameAt(this.mode === "none" ? 1 : p));
    return composeSvg({ svg: tmp, spec, plot: res.plot });
  }

  /** Durée de l'animation exportée (ms). */
  exportDuration(): number {
    if (this.mode === "special") return this.store.state.spec.mode.fourD.durationMs;
    return this.mode === "none" ? 1000 : this.duration();
  }

  setRecording(on: boolean): void {
    this.root.classList.toggle("r4d-recording", on);
    if (on) this.pause();
  }

  get plotRect(): PlotRect | null {
    return this.last?.plot ?? null;
  }
  get currentScale(): number {
    return this.scale;
  }
}
