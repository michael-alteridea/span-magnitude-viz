/**
 * Mise en avant généralisée (étape L) : une marque choisie — barre, part de camembert ou de donut, arc radial,
 * point (nuage, courbe), série (courbes, aires) ou région (carte) — reste en couleur, les autres passent en gris
 * (ou s'estompent), une annotation reliée la commente. Logique pure (testée) + tracé de la bulle en SVG.
 *
 * L'effet suit `frame.focus` (0 → 1, 1 par défaut) : le film, le mode lecture et le Reel l'animent quand deux
 * snapshots consécutifs ne diffèrent que par la mise en avant (graphique simple → graphique mis en avant).
 */
import type { ChartSpec } from "../spec";
import type { Model } from "../data/model";
import type { Theme } from "../theme";
import type { Frame, G } from "./context";
import { measure, wrap } from "./text";

/** Nature de la marque mise en avant selon le type de graphique (null : pas de mise en avant possible). */
export type FocusKind = "bar" | "slice" | "arc" | "point" | "series" | "linePoint" | "region";

export const FOCUS_LABELS: Record<FocusKind, { row: string; hint: string; auto: string }> = {
  bar: { row: "Barre mise en avant", hint: "Les autres barres passent en gris", auto: "La plus grande (auto)" },
  slice: { row: "Part mise en avant", hint: "La part se détache, les autres passent en gris", auto: "La plus grande (auto)" },
  arc: { row: "Arc mis en avant", hint: "Les autres arcs passent en gris", auto: "Le plus grand (auto)" },
  point: { row: "Point mis en avant", hint: "Halo autour du point, les autres s'estompent", auto: "La valeur la plus haute (auto)" },
  linePoint: { row: "Point mis en avant", hint: "Halo autour du point, les autres s'estompent", auto: "La valeur la plus haute (auto)" },
  series: { row: "Série mise en avant", hint: "Les autres séries passent en gris", auto: "La plus haute à la fin (auto)" },
  region: { row: "Région mise en avant", hint: "Les autres régions passent en gris, l'échelle reste visible", auto: "La plus grande (auto)" },
};

/** Nature de la mise en avant pour une spec (et le nombre de séries du modèle, pour les courbes). */
export function focusKindOf(spec: Pick<ChartSpec, "type" | "norme">, nSeries = 1, drillView: string | null = null): FocusKind | null {
  const t = spec.type;
  if (t === "drill") return drillView === "map" ? "region" : null;
  if (spec.norme.enabled) return null;
  if (t === "bar" || t === "barH") return nSeries === 1 ? "bar" : null;
  if (t === "pie" || t === "donut") return "slice";
  if (t === "radialBar") return "arc";
  if (t === "scatter") return "point";
  if (t === "line" || t === "area" || t === "stackedArea") return nSeries > 1 ? "series" : "linePoint";
  return null;
}

/** Indice de la marque mise en avant : « @max » = la plus grande valeur, sinon le nom exact ; null si absent. */
export function resolveFocus(key: string | null | undefined, names: readonly string[], values: readonly number[]): number | null {
  if (!key) return null;
  if (key === "@max") {
    let best = -Infinity;
    let k: number | null = null;
    values.forEach((v, i) => {
      if (Number.isFinite(v) && v > best) {
        best = v;
        k = i;
      }
    });
    return k;
  }
  const i = names.indexOf(key);
  return i >= 0 ? i : null;
}

/** Progression de la mise en avant (0 = graphique simple, 1 = mis en avant). */
export function focusProgress(frame: Pick<Frame, "focus">): number {
  const f = frame.focus;
  return f == null || !Number.isFinite(f) ? 1 : Math.max(0, Math.min(1, f));
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Gris des marques non mises en avant (mêmes valeurs que les barres de l'étape I). */
export function focusGrey(theme: Pick<Theme, "dark">): string {
  return theme.dark ? "#4a4a52" : "#c4c4c8";
}

function hexOf(c: string): [number, number, number] | null {
  const t = c.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (m3) return [parseInt(m3[1]! + m3[1], 16), parseInt(m3[2]! + m3[2], 16), parseInt(m3[3]! + m3[3], 16)];
  const m6 = /^#([0-9a-f]{6})$/i.exec(t);
  if (m6) {
    const n = parseInt(m6[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

/** Mélange de deux couleurs #RRGGBB (t = 0 → a, 1 → b) ; couleur non hexadécimale : bascule à mi-parcours. */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = hexOf(a);
  const pb = hexOf(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  return "#" + pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Liste des éléments proposables (Récit › Mise en avant) d'après le modèle préparé. */
export function focusChoices(kind: FocusKind | null, model: Model | null, regions: string[] = []): string[] {
  if (!kind) return [];
  if (kind === "region") return regions;
  if (!model) return [];
  if (model.kind === "points") {
    const seen = new Set<string>();
    for (const p of model.points) {
      const k = pointKey(p);
      if (k) seen.add(k);
      if (seen.size >= 200) break;
    }
    return [...seen];
  }
  if (kind === "series") return [...model.series];
  return [...model.labels];
}

/** Clé d'un point de nuage : son libellé, sinon son identifiant. */
export function pointKey(p: { label: string; key: string }): string {
  return p.label || p.key;
}

/* ------------------------------------------------------------------ deux snapshots : simple → mis en avant */

function withoutFocus(spec: unknown): string {
  const s = structuredCloneSafe(spec) as { style?: Record<string, unknown>; story?: unknown } | null;
  if (!s || typeof s !== "object") return "";
  if (s.style) {
    delete s.style.focus;
    delete s.style.title;
    delete s.style.subtitle;
  }
  delete s.story;
  return stableJson(s);
}

function structuredCloneSafe(v: unknown): unknown {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function focusOf(spec: unknown): { key: string | null; title: string; note: string } {
  const f = (spec as { style?: { focus?: { key?: unknown; title?: unknown; note?: unknown } } })?.style?.focus;
  return { key: typeof f?.key === "string" && f.key ? f.key : null, title: typeof f?.title === "string" ? f.title : "", note: typeof f?.note === "string" ? f.note : "" };
}

/**
 * Deux snapshots consécutifs qui ne diffèrent que par la mise en avant (et les textes) : « in » quand la seconde
 * met en avant (ou change d'élément), « out » quand elle revient au graphique simple ; null sinon.
 */
/** Même graphique, à la mise en avant (et aux titres / commentaires) près. */
export function sameExceptFocus(a: unknown, b: unknown): boolean {
  return !!a && !!b && withoutFocus(a) === withoutFocus(b);
}

export function focusDelta(a: unknown, b: unknown): "in" | "out" | null {
  if (!a || !b) return null;
  const fa = focusOf(a);
  const fb = focusOf(b);
  if (fa.key === fb.key && fa.title === fb.title && fa.note === fb.note) return null;
  if (withoutFocus(a) !== withoutFocus(b)) return null;
  if (fb.key && fa.key !== fb.key) return "in";
  if (fb.key && fa.key === fb.key) return null;
  return fa.key && !fb.key ? "out" : null;
}

/* ------------------------------------------------------------------ bulle d'annotation */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Callout {
  title: string[];
  note: string[];
  w: number;
  h: number;
  fs: number;
  noteFs: number;
  pad: number;
}

/** Lignes équilibrées : plus petite largeur qui garde le même nombre de lignes (pas de mot orphelin). */
function balanced(t: string, inner: number, fs: number, font: string, wt: number, maxL: number): string[] {
  const ref = wrap(t, inner, fs, font, wt, maxL);
  if (ref.length < 2) return ref;
  let lo = inner * 0.4;
  let hi = inner;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const tryL = wrap(t, mid, fs, font, wt, maxL);
    if (tryL.length === ref.length && tryL.join(" ") === ref.join(" ")) hi = mid;
    else lo = mid;
  }
  return wrap(t, hi, fs, font, wt, maxL);
}

/** Mesure de la bulle (titre en gras, note en gris) pour une largeur maximale. */
export function makeCallout(texts: { title: string; note: string }, s: number, font: string, maxW: number): Callout {
  const fs = 14.5 * s;
  const noteFs = 12 * s;
  const pad = 12 * s;
  const inner = Math.max(80 * s, maxW - 2 * pad);
  const narrow = inner < 160 * s;
  const title = balanced(texts.title, inner, fs, font, 700, narrow ? 4 : 2);
  const note = texts.note ? balanced(texts.note, inner, noteFs, font, 400, narrow ? 4 : 3) : [];
  const w = Math.max(...title.map((l) => measure(l, fs, font, 700)), ...note.map((l) => measure(l, noteFs, font)), 60 * s) + 2 * pad;
  const h = 2 * pad + title.length * fs * 1.2 + (note.length ? 5 * s + note.length * noteFs * 1.35 : 0);
  return { title, note, w, h, fs, noteFs, pad };
}

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Position de la bulle autour de la marque `target` : à droite, à gauche, au-dessus, au-dessous (puis décalées),
 * dans `bounds`, en évitant la marque et les `obstacles` (autres marques, étiquettes) ; la plus proche à recouvrement égal.
 */
export function placeCallout(c: { w: number; h: number }, target: Rect, bounds: Rect, obstacles: Rect[], gap: number): Rect {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const cands: { x: number; y: number; pen: number }[] = [];
  const ys = [cy - c.h / 2, target.y - c.h * 0.15, target.y + target.h - c.h * 0.85, cy - c.h - gap, cy + gap];
  const xs = [cx - c.w / 2, target.x - c.w * 0.15, target.x + target.w - c.w * 0.85, cx - c.w - gap, cx + gap];
  for (const y of ys) {
    cands.push({ x: target.x + target.w + gap, y, pen: 0 });
    cands.push({ x: target.x - gap - c.w, y, pen: 1 });
  }
  for (const x of xs) {
    cands.push({ x, y: target.y - gap - c.h, pen: 2 });
    cands.push({ x, y: target.y + target.h + gap, pen: 3 });
  }
  let best: { r: Rect; score: number } | null = null;
  for (const k of cands) {
    const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - c.w, k.x));
    const y = Math.max(bounds.y, Math.min(bounds.y + bounds.h - c.h, k.y));
    const r = { x, y, w: c.w, h: c.h };
    const shifted = Math.abs(x - k.x) + Math.abs(y - k.y);
    let score = overlap(r, target) * 40 + shifted * 0.5 + k.pen * 4;
    for (const o of obstacles) score += overlap(r, o) * 6;
    const dx = Math.max(0, Math.max(r.x - (target.x + target.w), target.x - (r.x + r.w)));
    const dy = Math.max(0, Math.max(r.y - (target.y + target.h), target.y - (r.y + r.h)));
    score += Math.hypot(dx, dy) * 2;
    if (!best || score < best.score) best = { r, score };
  }
  return best!.r;
}

/** Point du bord de la bulle le plus proche de `to` (départ du filet). */
export function edgePoint(box: Rect, to: { x: number; y: number }, inset: number): { x: number; y: number } {
  const x = Math.max(box.x + inset, Math.min(box.x + box.w - inset, to.x));
  const y = Math.max(box.y + inset, Math.min(box.y + box.h - inset, to.y));
  const dl = Math.abs(to.x - box.x);
  const dr = Math.abs(to.x - (box.x + box.w));
  const dt = Math.abs(to.y - box.y);
  const db = Math.abs(to.y - (box.y + box.h));
  const inX = to.x >= box.x && to.x <= box.x + box.w;
  const inY = to.y >= box.y && to.y <= box.y + box.h;
  if (inY && !inX) return { x: dl < dr ? box.x : box.x + box.w, y };
  if (inX && !inY) return { x, y: dt < db ? box.y : box.y + box.h };
  // en diagonale : bord horizontal ou vertical selon l'écart dominant
  const hzGap = to.x < box.x ? box.x - to.x : to.x - (box.x + box.w);
  const vtGap = to.y < box.y ? box.y - to.y : to.y - (box.y + box.h);
  if (hzGap >= vtGap) return { x: to.x < box.x ? box.x : box.x + box.w, y };
  return { x, y: to.y < box.y ? box.y : box.y + box.h };
}

export interface CalloutInk {
  theme: Theme;
  s: number;
  font: string;
}

/** Bulle reliée (filet courbe + pastille sur la marque), apparition progressive selon `t`. */
export function drawCallout(g: G, c: Callout, box: Rect, to: { x: number; y: number } | null, ink: CalloutInk, t = 1): void {
  if (t <= 0) return;
  const { theme, s, font } = ink;
  const accent = theme.dark ? "#3FA7C4" : "#0E6E8C";
  const lift = (1 - t) * 8 * s;
  const gc = g.append("g").attr("class", "r4d-callout").attr("opacity", t).attr("transform", lift ? `translate(0,${lift.toFixed(2)})` : null);
  if (to) {
    const from = edgePoint(box, to, 14 * s);
    if (Math.hypot(to.x - from.x, to.y - from.y) > 8 * s) {
      const horizontalStart = from.x === box.x || from.x === box.x + box.w;
      const mid = horizontalStart ? { x: (from.x + to.x) / 2, y: from.y } : { x: from.x, y: (from.y + to.y) / 2 };
      gc.append("path")
        .attr("class", "r4d-callout-link")
        .attr("d", `M${from.x},${from.y} Q${mid.x},${mid.y} ${to.x},${to.y}`)
        .attr("fill", "none")
        .attr("stroke", accent)
        .attr("stroke-width", 2 * s);
      gc.append("circle").attr("cx", to.x).attr("cy", to.y).attr("r", 3.5 * s).attr("fill", accent);
    }
  }
  gc.append("rect").attr("x", box.x).attr("y", box.y).attr("width", c.w).attr("height", c.h).attr("rx", 10 * s).attr("fill", theme.dark ? "#0c2a33" : "#eef6f9").attr("stroke", accent).attr("stroke-width", 1.5 * s);
  const tx = box.x + c.pad;
  c.title.forEach((l, i) =>
    gc.append("text").attr("class", "r4d-callout-title").attr("x", tx).attr("y", box.y + c.pad + c.fs * 0.85 + i * c.fs * 1.2).attr("font-size", c.fs).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(l)
  );
  const ny = box.y + c.pad + c.title.length * c.fs * 1.2 + 5 * s;
  c.note.forEach((l, i) =>
    gc.append("text").attr("class", "r4d-callout-note").attr("x", tx).attr("y", ny + c.noteFs * 0.9 + i * c.noteFs * 1.35).attr("font-size", c.noteFs).attr("font-family", font).attr("fill", theme.muted).text(l)
  );
}
