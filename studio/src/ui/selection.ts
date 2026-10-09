/**
 * Sélection par touchers successifs (série A des maquettes « dataset-flow ») : Page › Graphique › Série (toutes les
 * barres) › un élément › son libellé.
 *  - Toucher un objet situé DANS la sélection courante (même endroit ou non) descend d'un niveau vers lui :
 *    graphique → série de la barre touchée → cette barre → son libellé.
 *  - Toucher un objet HORS de la sélection courante le sélectionne directement, au même niveau (une autre barre
 *    quand une barre est choisie, une autre série quand une série est choisie) ; toucher le fond du graphique
 *    revient au graphique, toucher hors du graphique revient à la page. Échap ou « ↑ » remonte d'un niveau.
 *  - Double-clic ou double-toucher sur une marque : directement au niveau « élément » (cette barre, cette part…).
 * Repères : cadre pointillé pétrole (objet courant), parent en pointillé discret, pastille fil d'Ariane près de
 * l'objet, anneau de toucher numéroté. Les marques portent `data-sel` (mark | label | series), `data-sel-key`
 * (« e:… »), `data-sel-series` (« s:… ») et `data-sel-name` (voir charts/overrides.ts).
 */
import { h } from "./dom";
import type { ChartType } from "../spec";

export type SelLevel = "page" | "chart" | "series" | "mark" | "label";
export const SEL_LEVELS: SelLevel[] = ["page", "chart", "series", "mark", "label"];

export interface Sel {
  level: SelLevel;
  /** Clé d'élément (« e:… ») pour mark / label. */
  ek: string | null;
  /** Clé de série (« s:… ») pour series / mark / label. */
  sk: string | null;
  /** Nom lisible de l'élément (« Belgique »). */
  name: string;
}

export interface SelHost {
  svg: SVGSVGElement;
  box: HTMLElement;
  /** Zone de tracé du dernier rendu (coordonnées SVG) ; null pour les types sans zone. */
  plot(): { x: number; y: number; w: number; h: number } | null;
  scale(): number;
  chartType(): ChartType;
}

const ORD = ["1ᵉʳ", "2ᵉ", "3ᵉ", "4ᵉ", "5ᵉ"];

export const seriesNameOf = (sk: string | null): string => (sk ? sk.replace(/^s:/, "") : "");

/** Libellés de niveau selon le type de graphique (« Barres », « Barre », « Part »…). */
export function levelNames(t: ChartType): { series: string; mark: string; marks: string } {
  if (t === "pie" || t === "donut") return { series: "Parts", mark: "Part", marks: "parts" };
  if (t === "radialBar") return { series: "Arcs", mark: "Arc", marks: "arcs" };
  if (t === "scatter") return { series: "Points", mark: "Point", marks: "points" };
  if (t === "line" || t === "area" || t === "stackedArea") return { series: "Série", mark: "Point", marks: "points" };
  return { series: "Barres", mark: "Barre", marks: "barres" };
}

export function crumbs(sel: Sel | null, t: ChartType): string[] {
  if (!sel) return [];
  const n = levelNames(t);
  const out = ["Page"];
  const i = SEL_LEVELS.indexOf(sel.level);
  if (i >= 1) out.push("Graphique");
  if (i >= 2) {
    const sn = seriesNameOf(sel.sk);
    out.push(n.series === "Série" && sn ? sn : n.series);
  }
  if (i >= 3) out.push(sel.name || n.mark);
  if (i >= 4) out.push("Libellé");
  return out;
}

export const same = (a: Sel | null, b: Sel | null): boolean => !!a && !!b && a.level === b.level && (a.ek ?? null) === (b.ek ?? null) && (a.sk ?? null) === (b.sk ?? null);

/** Double-toucher : deux touchers à moins de 320 ms et 24 px l'un de l'autre (ou `detail` ≥ 2 du navigateur). */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 24;

/**
 * Le toucher courant termine-t-il un double-clic / double-toucher ? Compteur du navigateur (`detail` ≥ 2) ou, hors
 * souris, deux touchers rapprochés (< 320 ms, < 24 px) : Safari sur iPad ne compte pas les touchers (`detail` reste
 * à 1, `pointerType` parfois absent). À la souris, le compteur du navigateur fait foi.
 */
export function isDouble(prev: { x: number; y: number; t: number } | null, x: number, y: number, now: number, detail = 1, pointerType?: string): boolean {
  if (detail >= 2) return true;
  if (pointerType === "mouse") return false;
  return !!prev && now - prev.t >= 0 && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX;
}

/**
 * Transition d'un toucher. `chain` = objets sous le pointeur, de la page au plus fin ; `hit` = niveau de l'objet
 * réellement touché (« mark » pour une barre, « label » pour un libellé, « chart » pour le fond…).
 *  - pas de sélection : la page ;
 *  - double-toucher sur une marque : cette marque (niveau « élément ») ;
 *  - l'objet courant est sous le pointeur : un niveau plus bas, vers l'objet touché ;
 *  - sinon : l'objet touché au niveau courant (ou au niveau de ce qui a été touché, s'il est moins profond).
 */
export function nextSelection(cur: Sel | null, chain: Sel[], hit: SelLevel, double = false): Sel | null {
  if (!chain.length) return cur;
  const mark = chain.find((c) => c.level === "mark");
  if (double && mark) return mark;
  if (!cur) return chain[0]!;
  const i = chain.findIndex((c) => same(c, cur));
  if (i >= 0) return chain[Math.min(i + 1, chain.length - 1)]!;
  const want = Math.min(SEL_LEVELS.indexOf(cur.level), SEL_LEVELS.indexOf(hit));
  let best = chain[0]!;
  for (const c of chain) if (SEL_LEVELS.indexOf(c.level) <= want) best = c;
  return best;
}

const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));

export class Selection {
  sel: Sel | null = null;
  private host: SelHost;
  private layer: HTMLElement;
  private frame: HTMLElement;
  private parentFrame: HTMLElement;
  private chip: HTMLElement;
  private ring: HTMLElement;
  private ringTimer = 0;
  private listeners: ((s: Sel | null) => void)[] = [];
  private lastTap: { x: number; y: number; t: number } | null = null;
  /** Le dernier clic est passé par la sélection (pas par la mise en avant, l'exploration ou un autre geste). */
  lastTapped = false;
  /** Désactivée (mode lecture, enregistrement). */
  enabled = true;

  constructor(host: SelHost) {
    this.host = host;
    this.frame = h("div", { class: "sel-frame", "data-testid": "sel-frame", hidden: true });
    this.parentFrame = h("div", { class: "sel-frame sel-parent", "data-testid": "sel-parent", hidden: true });
    this.chip = h("div", { class: "sel-chip", "data-testid": "sel-chip", hidden: true });
    this.ring = h("div", { class: "sel-ring", "data-testid": "sel-ring", hidden: true });
    this.layer = h("div", { class: "sel-layer", "aria-hidden": "true" }, this.parentFrame, this.frame, this.ring, this.chip);
    host.box.append(this.layer);
  }

  onChange(fn: (s: Sel | null) => void): void {
    this.listeners.push(fn);
  }

  set(next: Sel | null): void {
    const changed = !same(next, this.sel) || (next?.name ?? "") !== (this.sel?.name ?? "");
    this.sel = next;
    this.paint();
    if (changed) for (const fn of this.listeners) fn(next);
  }

  clear(): void {
    this.set(null);
  }

  /** Niveau parent (Échap, « ↑ », toucher ailleurs) ; depuis la page : plus de sélection. */
  up(): void {
    const s = this.sel;
    if (!s) return;
    this.set(this.parentOf(s));
  }

  parentOf(s: Sel): Sel | null {
    if (s.level === "label") return { ...s, level: "mark" };
    if (s.level === "mark") return { level: "series", ek: null, sk: s.sk, name: seriesNameOf(s.sk) };
    if (s.level === "series") return { level: "chart", ek: null, sk: null, name: "" };
    if (s.level === "chart") return { level: "page", ek: null, sk: null, name: "" };
    return null;
  }

  /** Chaîne des objets sous le toucher, de la page à l'objet le plus fin. */
  chainAt(target: Element | null, clientX: number, clientY: number): Sel[] {
    return this.probe(target, clientX, clientY).chain;
  }

  /** Chaîne sous le pointeur + niveau de l'objet réellement touché. */
  probe(target: Element | null, clientX: number, clientY: number, tolerance = 0): { chain: Sel[]; hit: SelLevel } {
    const chain: Sel[] = [{ level: "page", ek: null, sk: null, name: "" }];
    const svg = this.host.svg;
    let el = target?.closest?.("[data-sel]") ?? null;
    if (!el || !svg.contains(el))
      el = (typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(clientX, clientY) : []).find((n) => svg.contains(n) && n.matches("[data-sel]")) ?? null;
    if (!el && tolerance > 0) el = this.nearSmallMark(clientX, clientY, tolerance);
    const inPlot = this.inPlot(clientX, clientY);
    if (!el && !inPlot) return { chain, hit: "page" };
    chain.push({ level: "chart", ek: null, sk: null, name: "" });
    if (!el) return { chain, hit: "chart" };
    const role = el.getAttribute("data-sel");
    const ek = el.getAttribute("data-sel-key");
    const sk = el.getAttribute("data-sel-series");
    const name = el.getAttribute("data-sel-name") ?? "";
    if (sk) chain.push({ level: "series", ek: null, sk, name: seriesNameOf(sk) });
    if (role === "series" || !ek) return { chain, hit: sk ? "series" : "chart" };
    chain.push({ level: "mark", ek, sk, name });
    chain.push({ level: "label", ek, sk, name });
    return { chain, hit: role === "label" ? "label" : "mark" };
  }

  /**
   * Petites marques (points d'une courbe ou d'un nuage, quelques pixels) : au doigt, la plus proche à moins de
   * `r` px compte comme touchée. Les barres et les parts (plus grandes) ne sont pas concernées.
   */
  private nearSmallMark(x: number, y: number, r: number): Element | null {
    let best: Element | null = null;
    let bd = r;
    for (const m of this.host.svg.querySelectorAll('[data-sel="mark"]')) {
      const b = m.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      if (Math.min(b.width, b.height) > 16) continue;
      const dx = Math.max(b.left - x, 0, x - b.right);
      const dy = Math.max(b.top - y, 0, y - b.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private inPlot(x: number, y: number): boolean {
    const p = this.host.plot();
    if (!p) return false;
    const r = this.host.svg.getBoundingClientRect();
    const k = this.host.scale();
    const px = (x - r.left) / k;
    const py = (y - r.top) / k;
    return px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h;
  }

  /**
   * Un toucher (voir `nextSelection`). `opts.detail` : compteur de clics du navigateur (2 = double-clic) ;
   * `opts.pointerType` : « touch » active aussi la détection du double-toucher par le temps et la distance.
   */
  tap(target: Element | null, clientX: number, clientY: number, opts: { detail?: number; pointerType?: string; now?: number } = {}): Sel | null {
    this.lastTapped = this.enabled;
    if (!this.enabled) return this.sel;
    const { chain, hit } = this.probe(target, clientX, clientY, opts.pointerType === "touch" ? 14 : 6);
    const now = opts.now ?? performance.now();
    const prev = this.lastTap;
    this.lastTap = { x: clientX, y: clientY, t: now };
    const double = isDouble(prev, clientX, clientY, now, opts.detail ?? 1, opts.pointerType);
    // un double-toucher ne compte qu'une fois (le suivant repart d'un toucher simple)
    if (double) this.lastTap = null;
    const next = nextSelection(this.sel, chain, hit, double);
    this.set(next);
    this.showRing(clientX, clientY);
    return next;
  }

  /**
   * Filet de sécurité de l'évènement `dblclick` : quel que soit le niveau atteint par les deux clics simples qui le
   * précèdent, l'état final est l'élément sous le pointeur (barre, part, point). Sans marque sous le pointeur : rien.
   */
  dblTap(target: Element | null, clientX: number, clientY: number, pointerType?: string): Sel | null {
    if (!this.enabled || !this.lastTapped) return this.sel;
    const { chain } = this.probe(target, clientX, clientY, pointerType === "touch" ? 14 : 6);
    const mark = chain.find((c) => c.level === "mark");
    if (!mark) return this.sel;
    this.lastTap = null;
    if (!same(this.sel, mark)) {
      this.set(mark);
      this.showRing(clientX, clientY);
    }
    return mark;
  }

  private showRing(x: number, y: number): void {
    const s = this.sel;
    if (!s) {
      this.ring.hidden = true;
      return;
    }
    const b = this.host.box.getBoundingClientRect();
    this.ring.style.left = `${x - b.left}px`;
    this.ring.style.top = `${y - b.top}px`;
    this.ring.dataset.n = ORD[SEL_LEVELS.indexOf(s.level)] ?? "";
    this.ring.hidden = false;
    this.ring.classList.remove("sel-ring-on");
    void this.ring.offsetWidth;
    this.ring.classList.add("sel-ring-on");
    window.clearTimeout(this.ringTimer);
    this.ringTimer = window.setTimeout(() => (this.ring.hidden = true), 1600);
  }

  /** Éléments SVG de l'objet sélectionné. */
  elementsOf(s: Sel): Element[] {
    const svg = this.host.svg;
    if (s.level === "label") {
      const l = [...svg.querySelectorAll(`[data-sel="label"][data-sel-key="${esc(s.ek ?? "")}"]`)];
      return l.length ? l : this.elementsOf({ ...s, level: "mark" });
    }
    if (s.level === "mark") return [...svg.querySelectorAll(`[data-sel="mark"][data-sel-key="${esc(s.ek ?? "")}"]`)];
    if (s.level === "series") return [...svg.querySelectorAll(`[data-sel="mark"][data-sel-series="${esc(s.sk ?? "")}"], [data-sel="series"][data-sel-series="${esc(s.sk ?? "")}"]`)];
    return [];
  }

  /** L'objet existe-t-il encore après un nouveau rendu ? */
  exists(s: Sel): boolean {
    if (s.level === "page") return true;
    if (s.level === "chart") return !!this.host.plot();
    return this.elementsOf(s).length > 0;
  }

  private rectOf(s: Sel): { x: number; y: number; w: number; h: number } | null {
    const b = this.host.box.getBoundingClientRect();
    if (s.level === "page") {
      const r = this.host.svg.getBoundingClientRect();
      return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
    }
    if (s.level === "chart") {
      const p = this.host.plot();
      if (!p) return null;
      const r = this.host.svg.getBoundingClientRect();
      const k = this.host.scale();
      return { x: r.left - b.left + p.x * k, y: r.top - b.top + p.y * k, w: p.w * k, h: p.h * k };
    }
    const els = this.elementsOf(s);
    if (!els.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    if (!Number.isFinite(x0)) return null;
    return { x: x0 - b.left, y: y0 - b.top, w: x1 - x0, h: y1 - y0 };
  }

  /** Repeint les repères (après chaque rendu, redimensionnement, changement de sélection). */
  paint(): void {
    let s = this.sel;
    // l'objet a disparu (type changé, filtre) : on remonte jusqu'à un niveau qui existe
    while (s && !this.exists(s)) s = this.parentOf(s);
    if (s !== this.sel) {
      this.set(s);
      return;
    }
    const place = (el: HTMLElement, r: { x: number; y: number; w: number; h: number } | null, pad: number) => {
      el.hidden = !r;
      if (!r) return;
      el.style.left = `${r.x - pad}px`;
      el.style.top = `${r.y - pad}px`;
      el.style.width = `${r.w + 2 * pad}px`;
      el.style.height = `${r.h + 2 * pad}px`;
    };
    if (!s || !this.enabled) {
      for (const el of [this.frame, this.parentFrame, this.chip]) el.hidden = true;
      this.layer.dataset.level = "";
      return;
    }
    this.layer.dataset.level = s.level;
    const r = this.rectOf(s);
    place(this.frame, r, s.level === "page" ? 3 : 4);
    const p = this.parentOf(s);
    place(this.parentFrame, p && p.level !== "page" ? this.rectOf(p) : null, 8);
    const c = crumbs(s, this.host.chartType());
    this.chip.replaceChildren(...c.flatMap((t, i) => [i ? h("span", { class: "sel-sep" }, "›") : null, h(i === c.length - 1 ? "b" : "span", null, t)].filter(Boolean) as HTMLElement[]));
    this.chip.hidden = !r;
    if (r) {
      // pastille au-dessus de l'objet (dedans s'il touche le haut)
      const top = r.y - 30 < 0 ? r.y + 6 : r.y - 30;
      const bw = this.host.box.clientWidth;
      this.chip.style.maxWidth = `${Math.max(120, bw - 8)}px`;
      const cw = this.chip.offsetWidth;
      this.chip.style.left = `${Math.max(4, Math.min(r.x, bw - cw - 4))}px`;
      this.chip.style.top = `${top}px`;
    }
  }
}
