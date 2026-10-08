/**
 * Avant / après en barres horizontales : « avant » en gris, « après » dans la couleur principale,
 * écart en vert s'il va dans le bon sens (better), en rouge sinon.
 */
import { scaleLinear } from "d3";
import { percent } from "../format";
import { anim, compose, makeCtx, niceDomain, type ChartOptions, type Ctx } from "../frame";
import { esc, tag, textWidth, wrap } from "../svg";
import type { Theme } from "../theme";

export interface BeforeAfterItem {
  label: string;
  before: number;
  after: number;
}

export interface BeforeAfterData {
  items: BeforeAfterItem[];
  beforeLabel?: string;
  afterLabel?: string;
  /** Sens de l'amélioration : « lower » (coûts, délais : baisser est mieux) ou « higher » (défaut). */
  better?: "lower" | "higher";
}

export interface BeforeAfterDelta {
  diff: number;
  /** Variation relative (null si avant = 0). */
  ratio: number | null;
  /** L'écart va dans le bon sens. */
  improved: boolean;
}

export function delta(it: BeforeAfterItem, better: "lower" | "higher" = "higher"): BeforeAfterDelta {
  const diff = it.after - it.before;
  const ratio = it.before !== 0 ? diff / Math.abs(it.before) : null;
  return { diff, ratio, improved: diff === 0 ? true : better === "lower" ? diff < 0 : diff > 0 };
}

function plotSvg(data: BeforeAfterData, c: Ctx) {
  return (box: { x: number; y: number; w: number; h: number }) => {
    const { t, k, fmt } = c;
    const items = (data.items ?? []).filter((d) => d && typeof d.label === "string");
    const n = items.length;
    if (!n) return { svg: "", summary: "Aucun élément" };
    const better = data.better ?? "higher";
    const bl = data.beforeLabel ?? "Avant";
    const al = data.afterLabel ?? "Après";
    const fs = 12 * k;
    const parts: string[] = [];
    // légende
    const lg = (x: number, col: string, lab: string) => tag("rect", { x, y: box.y + 1, width: 12 * k, height: 12 * k, rx: 2, fill: col }) + tag("text", { x: x + 17 * k, y: box.y + 11 * k, "font-size": fs, fill: t.text }, esc(lab));
    parts.push(tag("g", { class: "ac-legend" }, lg(box.x, t.grey, bl) + lg(box.x + textWidth(bl, fs) + 40 * k, t.primary, al)));
    const top = box.y + 26 * k;
    const labW = Math.min(box.w * 0.3, Math.max(...items.map((d) => textWidth(d.label, fs))) + 10);
    const dTexts = items.map((d) => {
      const dl = delta(d, better);
      return dl.ratio != null ? percent(dl.ratio, { signed: true, decimals: Math.abs(dl.ratio) < 0.1 ? 1 : 0 }) : fmt(dl.diff, true);
    });
    const dW = Math.max(...dTexts.map((s) => textWidth(s, 13 * k, true))) + 14;
    const valW = Math.max(...items.flatMap((d) => [textWidth(fmt(d.before), 11 * k), textWidth(fmt(d.after), 11 * k, true)])) + 10;
    const x0 = box.x + labW;
    const x1 = box.x + box.w - dW - valW;
    const [lo, hi] = niceDomain(items.flatMap((d) => [d.before, d.after]), 4);
    const x = scaleLinear().domain([lo, hi]).range([x0, x1]);
    const xz = x(0);
    const rowH = Math.min(64 * k, (box.y + box.h - top) / n);
    const bh = Math.max(6, Math.min(18 * k, rowH * 0.3));
    const slot = 0.8 / n;
    const summary: string[] = [];
    items.forEach((d, i) => {
      const ry = top + i * rowH;
      const cy = ry + rowH / 2;
      const lines = wrap(d.label, fs, labW - 8, 2);
      lines.forEach((l, j) => parts.push(tag("text", { class: "ac-label", x: box.x, y: cy + fs * 0.35 + (j - (lines.length - 1) / 2) * fs * 1.15, "font-size": fs, "font-weight": 600, fill: t.text }, esc(l))));
      const b = (v: number, yy: number, col: string, cls: string, t0: number, bold: boolean) => {
        const xa = x(v);
        const xs = Math.min(xz, xa);
        const w = Math.max(1, Math.abs(xa - xz));
        return (
          tag("rect", { class: `ac-bar ${cls}`, x: xs, y: yy, width: w, height: bh, rx: Math.min(3, bh / 3), fill: col, ...anim("gx", t0, slot * 1.5, xz) }) +
          tag("text", { class: "ac-value", x: v >= 0 ? xs + w + 5 : xs - 5, y: yy + bh / 2 + 4 * k, "text-anchor": v >= 0 ? "start" : "end", "font-size": 11 * k, "font-weight": bold ? 700 : 400, fill: bold ? t.text : t.grey, ...anim("fade", t0 + slot, 0.15) }, esc(fmt(v)))
        );
      };
      const t0 = i * slot;
      parts.push(b(d.before, cy - bh - 2, t.grey, "ac-before", t0, false));
      parts.push(b(d.after, cy + 2, t.primary, "ac-after", t0 + slot * 0.35, true));
      const dl = delta(d, better);
      const col = dl.diff === 0 ? t.grey : dl.improved ? t.positive : t.negative;
      parts.push(tag("text", { class: `ac-delta ${dl.improved ? "ac-up" : "ac-down"}`, x: box.x + box.w, y: cy + 4.5 * k, "text-anchor": "end", "font-size": 13 * k, "font-weight": 700, fill: col, ...anim("fade", t0 + slot * 1.6, 0.18) }, esc(dTexts[i]!)));
      if (i < n - 1) parts.push(tag("line", { x1: box.x, x2: box.x + box.w, y1: ry + rowH, y2: ry + rowH, stroke: t.grey, "stroke-opacity": 0.18 }));
      summary.push(`${d.label} : ${fmt(d.before)} → ${fmt(d.after)} (${dTexts[i]})`);
    });
    parts.push(tag("line", { x1: xz, x2: xz, y1: top - 4, y2: top + n * rowH, stroke: t.grey, "stroke-opacity": 0.6 }));
    return { svg: tag("g", { class: "ac-plot" }, parts.join("")), summary: `${bl} / ${al} : ${summary.join(" ; ")}.` };
  };
}

/** Hauteur par défaut : suit le nombre de lignes (≈ 58 px par élément). */
export function defaultBeforeAfterHeight(data: BeforeAfterData, options: ChartOptions = {}): number {
  const n = Math.max(1, (data.items ?? []).length);
  const head = (options.title ? 34 : 0) + (options.subtitle ? 22 : 0) + (options.title || options.subtitle ? 8 : 0);
  return Math.round(Math.max(240, 60 + head + n * 58 + (options.cartouche ? 76 : 0)));
}

export function toSVG(data: BeforeAfterData, options: ChartOptions = {}, theme?: Theme): string {
  const c = makeCtx("avant-apres", data, { ...options, height: options.height ?? defaultBeforeAfterHeight(data, options) }, theme);
  return compose("avant-apres", c, plotSvg(data, c));
}

export function tableRows(data: BeforeAfterData, options: ChartOptions = {}): { head: string[]; rows: string[][] } {
  const fmt = makeCtx("avant-apres", data, options).fmt;
  return {
    head: ["Élément", data.beforeLabel ?? "Avant", data.afterLabel ?? "Après", "Écart"],
    rows: data.items.map((d) => {
      const dl = delta(d, data.better);
      return [d.label, fmt(d.before), fmt(d.after), dl.ratio != null ? percent(dl.ratio, { signed: true, decimals: 1 }) : fmt(dl.diff, true)];
    }),
  };
}
