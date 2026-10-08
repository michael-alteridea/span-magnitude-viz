/**
 * Transition sémantique « zoom dans la marque » (exploration guidée) :
 *
 * - descente : la marque cliquée (barre, part, arc, région, marche de cascade…) grandit jusqu'à remplir la
 *   zone du graphique pendant que le reste s'efface, puis le graphique enfant émerge de cette empreinte
 *   (voile de la couleur du parent qui se dissout pendant que les barres enfants poussent) ;
 * - remontée : l'enfant se replie dans un voile de la couleur du parent, puis ce voile rétrécit jusqu'à la
 *   marque d'origine dans le graphique parent pendant que le reste réapparaît.
 *
 * ~800 ms au total (380 ms + 420 ms), courbes adoucies ; `prefers-reduced-motion` : aucune animation.
 * Utilisé par l'aperçu du Studio, le film de l'histoire et le mode lecture. SVG pur (aucune dépendance).
 */
import type { PlotRect } from "../charts/context";

export const DIVE_MS = 380;
export const EMERGE_MS = 420;
const SVGNS = "http://www.w3.org/2000/svg";

/** Facteur de ralenti (tests, captures à mi-transition) : 1 = normal. */
let slow = 1;
export function setZoomSlowdown(k: number): void {
  slow = Math.max(0.1, Math.min(20, k || 1));
}
export const diveMs = (): number => DIVE_MS * slow;
export const emergeMs = (): number => EMERGE_MS * slow;

/** Désactivation explicite (tests) ; `prefers-reduced-motion` désactive aussi la transition. */
let enabled = true;
export function setZoomEnabled(on: boolean): void {
  enabled = on;
}
export function zoomEnabled(): boolean {
  return enabled && !reducedMotion();
}

/** Descente / remontée déclenchée par l'utilisateur (clic, fil d'Ariane, retour) : à consommer dans la seconde. */
let armedAt = -Infinity;
export function armDrillZoom(): void {
  armedAt = performance.now();
}
export function consumeDrillZoom(): boolean {
  const ok = performance.now() - armedAt < 1500;
  armedAt = -Infinity;
  return ok;
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Élément graphique représentant la marque d'un élément cliquable (la barre d'une ligne, pas son libellé). */
export function markShape(el: Element): SVGGraphicsElement {
  const tag = el.tagName.toLowerCase();
  if (tag === "rect" || tag === "path" || tag === "circle" || tag === "polygon") return el as SVGGraphicsElement;
  // petit multiple : c'est le panneau entier qui plonge
  if (el.classList.contains("r4d-drill-panel")) return el as SVGGraphicsElement;
  const pref = el.querySelector(".r4d-drill-mark, .r4d-drill-region");
  if (pref) return pref as SVGGraphicsElement;
  let best: SVGGraphicsElement | null = null;
  let area = -1;
  for (const c of el.querySelectorAll("rect, path, circle, polygon")) {
    const g = c as SVGGraphicsElement;
    let a = 0;
    try {
      const b = g.getBBox();
      a = b.width * b.height;
    } catch {
      a = 0;
    }
    if (a > area) {
      area = a;
      best = g;
    }
  }
  return best ?? (el as SVGGraphicsElement);
}

/** Couleur de remplissage effective d'une marque (repli : pétrole). */
export function markFill(el: Element): string {
  const f = el.getAttribute("fill") ?? (typeof getComputedStyle !== "undefined" ? getComputedStyle(el).fill : "");
  return f && f !== "none" && !/^url\(/.test(f) ? f : "#0E6E8C";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bboxOf(el: SVGGraphicsElement): Box | null {
  try {
    const b = el.getBBox();
    if (!(b.width > 0 && b.height > 0)) return null;
    // coordonnées de la racine du SVG (les marques peuvent être dans des groupes translatés)
    const svg = el.ownerSVGElement;
    const ctm = el.getCTM();
    const sc = svg?.getCTM();
    const m = ctm && sc ? sc.inverse().multiply(ctm) : null;
    if (!m) return { x: b.x, y: b.y, w: b.width, h: b.height };
    const p = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    const a = p(b.x, b.y);
    const c = p(b.x + b.width, b.y + b.height);
    return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
  } catch {
    return null;
  }
}

/** Transformation qui amène la boîte `b` sur la zone `p` (non uniforme pour une barre, uniforme sinon). */
function fitTransform(b: Box, p: PlotRect, rectLike: boolean, t: number): string {
  let sx = p.w / b.w;
  let sy = p.h / b.h;
  if (!rectLike) sx = sy = Math.min(sx, sy);
  const tx = p.x + (p.w - b.w * sx) / 2;
  const ty = p.y + (p.h - b.h * sy) / 2;
  const k = (a: number, z: number) => a + (z - a) * t;
  const S = { x: k(1, sx), y: k(1, sy) };
  const T = { x: k(b.x, tx), y: k(b.y, ty) };
  return `translate(${T.x.toFixed(2)} ${T.y.toFixed(2)}) scale(${S.x.toFixed(4)} ${S.y.toFixed(4)}) translate(${(-b.x).toFixed(2)} ${(-b.y).toFixed(2)})`;
}

function rootGroup(svg: SVGSVGElement): SVGGElement | null {
  return [...svg.children].find((c) => c.tagName.toLowerCase() === "g" && !c.classList.contains("r4d-zoom-layer")) as SVGGElement | null;
}

/** Estompe tout le graphique sauf son fond (`v` = 1 : opaque ; null : état normal). */
function fade(svg: SVGSVGElement, v: number | null): void {
  const root = rootGroup(svg);
  if (!root) return;
  for (const c of root.children) if (!c.classList.contains("r4d-bg")) (c as SVGElement).style.opacity = v === null ? "" : v.toFixed(3);
}

function layer(svg: SVGSVGElement): SVGGElement {
  let g = svg.querySelector(":scope > g.r4d-zoom-layer") as SVGGElement | null;
  if (!g) {
    g = document.createElementNS(SVGNS, "g") as SVGGElement;
    g.setAttribute("class", "r4d-zoom-layer");
    g.setAttribute("pointer-events", "none");
    g.setAttribute("data-testid", "zoom-layer");
    svg.append(g);
  }
  return g;
}

function anim(ms: number, step: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      step(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    tick();
  });
}

const isRectLike = (el: Element): boolean => el.tagName.toLowerCase() === "rect";

/** Prépare une copie de la marque dans le calque de zoom (null si la marque n'a pas d'empreinte). */
function cloneMark(svg: SVGSVGElement, target: Element): { clone: SVGGraphicsElement; box: Box; rect: boolean; fill: string } | null {
  const shape = markShape(target);
  const box = bboxOf(shape);
  if (!box) return null;
  const clone = shape.cloneNode(true) as SVGGraphicsElement;
  // copie inerte : ni cible d'exploration, ni marque comptée par les infobulles / tests
  for (const n of [clone, ...clone.querySelectorAll("*")]) {
    for (const a of ["class", "data-drill-kind", "data-drill-key", "data-drill-value", "data-drill-field", "data-focus", "data-r4d-tip", "tabindex", "role"]) n.removeAttribute(a);
  }
  clone.removeAttribute("transform");
  clone.setAttribute("class", "r4d-zoom-mark");
  clone.setAttribute("aria-hidden", "true");
  layer(svg).replaceChildren(clone);
  return { clone, box, rect: isRectLike(shape), fill: markFill(shape) };
}

/**
 * Descente, phase 1 : la marque grandit jusqu'à remplir `plot`, le reste s'efface.
 * Renvoie la couleur de la marque (voile de la phase 2). Le calque reste en place jusqu'au rendu suivant.
 */
export async function diveIn(svg: SVGSVGElement, target: Element, plot: PlotRect): Promise<string> {
  const fill = markFill(markShape(target));
  if (!zoomEnabled()) return fill;
  const c = cloneMark(svg, target);
  if (!c) return fill;
  svg.setAttribute("data-zoom", "in");
  await anim(diveMs(), (t) => {
    const e = easeInOut(t);
    c.clone.setAttribute("transform", fitTransform(c.box, plot, c.rect, e));
    fade(svg, 1 - 0.92 * e);
  });
  return fill;
}

/** Voile (émergence de l'enfant, repli avant remontée) : rectangle de la couleur du parent sur la zone du graphique. */
export function paintVeil(svg: SVGSVGElement, plot: PlotRect, fill: string, alpha: number, phase: "emerge" | "fold"): void {
  const r = document.createElementNS(SVGNS, "rect");
  r.setAttribute("class", "r4d-zoom-veil");
  r.setAttribute("x", String(plot.x));
  r.setAttribute("y", String(plot.y));
  r.setAttribute("width", String(plot.w));
  r.setAttribute("height", String(plot.h));
  r.setAttribute("rx", "6");
  r.setAttribute("fill", fill);
  r.setAttribute("fill-opacity", Math.max(0, Math.min(1, alpha)).toFixed(3));
  layer(svg).replaceChildren(r);
  svg.setAttribute("data-zoom", phase);
}

/** Remontée, phase 1 : l'enfant se replie dans un voile de la couleur du parent (le reste s'efface). */
export async function foldOut(svg: SVGSVGElement, plot: PlotRect, fill: string): Promise<void> {
  if (!zoomEnabled()) return;
  await anim(diveMs(), (t) => {
    const e = easeInOut(t);
    paintVeil(svg, plot, fill, 0.92 * e, "fold");
    fade(svg, 1 - 0.92 * e);
  });
}

/**
 * Remontée, phase 2 (une image) : dans le graphique parent fraîchement rendu, la marque d'origine part de la
 * zone entière (e = 0) et rétrécit jusqu'à sa place (e = 1) pendant que le reste réapparaît.
 */
export function paintCollapse(svg: SVGSVGElement, target: Element | null, plot: PlotRect, t: number): void {
  const e = easeInOut(Math.max(0, Math.min(1, t)));
  fade(svg, 0.08 + 0.92 * e);
  const c = target ? cloneMark(svg, target) : null;
  if (c) c.clone.setAttribute("transform", fitTransform(c.box, plot, c.rect, 1 - e));
  svg.setAttribute("data-zoom", "out");
}

/** Retire le calque de zoom et rétablit l'opacité. */
export function clearZoom(svg: SVGSVGElement): void {
  fade(svg, null);
  svg.querySelector(":scope > g.r4d-zoom-layer")?.remove();
  svg.removeAttribute("data-zoom");
}

/** Couleur dominante des marques d'un rendu (voile de repli). */
export function dominantFill(svg: SVGSVGElement): string {
  for (const q of [".r4d-drill-mark.r4d-drill-focus", "[data-focus='1'] .r4d-drill-mark", ".r4d-drill-region[data-focus='1']"]) {
    const m = svg.querySelector(q);
    if (m) return markFill(m);
  }
  return "#0E6E8C";
}

/** Étape d'exploration ajoutée (descente) ou retirée (remontée) entre deux chemins, sinon null. */
export function pathDelta<S>(a: S[], b: S[]): { dir: "in" | "out"; step: S } | null {
  const same = (x: S[], y: S[], n: number) => x.slice(0, n).every((s, k) => JSON.stringify(s) === JSON.stringify(y[k]));
  if (b.length === a.length + 1 && same(a, b, a.length)) return { dir: "in", step: b[b.length - 1]! };
  if (a.length === b.length + 1 && same(b, a, b.length)) return { dir: "out", step: a[a.length - 1]! };
  return null;
}

/** Marque correspondant à une étape d'exploration dans un rendu (période : barre ; catégorie : région, ligne, marche…). */
export function markForStep(svg: SVGSVGElement, step: { kind: string; start?: number | null; value?: string | null }): Element | null {
  if (step.kind === "period") return svg.querySelector(`[data-drill-key="${step.start}"] .r4d-drill-mark`) ?? svg.querySelector(`[data-drill-kind="period"][data-drill-key="${step.start}"]`);
  return [...svg.querySelectorAll(`[data-drill-kind="cat"]`)].find((el) => el.getAttribute("data-drill-value") === step.value) ?? null;
}

/**
 * Descente, phase 1, en une image (Reel : rendu déterministe) : la marque grandit jusqu'à remplir `plot`
 * à la progression t ∈ [0, 1], le reste s'efface. Renvoie la couleur de la marque.
 */
export function paintDive(svg: SVGSVGElement, target: Element, plot: PlotRect, t: number): string {
  const fill = markFill(markShape(target));
  const c = cloneMark(svg, target);
  if (!c) return fill;
  const e = easeInOut(Math.max(0, Math.min(1, t)));
  c.clone.setAttribute("transform", fitTransform(c.box, plot, c.rect, e));
  fade(svg, 1 - 0.92 * e);
  svg.setAttribute("data-zoom", "in");
  return fill;
}

/** Remontée, phase 1, en une image (Reel) : l'enfant se replie dans un voile de la couleur du parent. */
export function paintFold(svg: SVGSVGElement, plot: PlotRect, fill: string, t: number): void {
  const e = easeInOut(Math.max(0, Math.min(1, t)));
  paintVeil(svg, plot, fill, 0.92 * e, "fold");
  fade(svg, 1 - 0.92 * e);
}
