/**
 * Cascade d'investissement : chaque poste part du niveau atteint par le précédent (gain en vert, coût en rouge),
 * sous-totaux et barre de total dans la couleur principale, liaisons en pointillé.
 */
import { scaleBand, scaleLinear } from "d3";
import { anim, compose, makeCtx, niceDomain, ticks, type ChartOptions, type Ctx } from "../frame";
import { esc, tag, textWidth, wrap } from "../svg";
import type { Theme } from "../theme";

export interface WaterfallItem {
  label: string;
  /** Variation (positive = gain, négative = coût). Ignorée pour un sous-total. */
  value: number;
  /** « subtotal » : barre pleine depuis zéro jusqu'au cumul atteint. */
  kind?: "subtotal";
}

export interface WaterfallData {
  items: WaterfallItem[];
  /** Libellé de la barre de total (« Total » par défaut) ; false = pas de barre de total. */
  total?: string | false;
}

export interface WaterfallBar {
  label: string;
  kind: "delta" | "subtotal" | "total";
  value: number;
  /** Niveau de départ et d'arrivée de la barre. */
  from: number;
  to: number;
}

/** Barres de la cascade (niveaux de départ / arrivée), total ajouté en fin. */
export function waterfallBars(data: WaterfallData): WaterfallBar[] {
  const out: WaterfallBar[] = [];
  let run = 0;
  for (const it of data.items ?? []) {
    if (!it || typeof it.label !== "string") continue;
    if (it.kind === "subtotal") out.push({ label: it.label, kind: "subtotal", value: run, from: 0, to: run });
    else {
      const v = Number.isFinite(it.value) ? it.value : 0;
      out.push({ label: it.label, kind: "delta", value: v, from: run, to: run + v });
      run += v;
    }
  }
  if (data.total !== false) out.push({ label: typeof data.total === "string" && data.total ? data.total : "Total", kind: "total", value: run, from: 0, to: run });
  return out;
}

/** Coupe (avec trait d'union) les mots trop longs pour la largeur d'une colonne — dernier recours en petit écran. */
export function hyphenate(label: string, size: number, room: number, bold = false): string {
  return label
    .split(/\s+/)
    .map((w) => {
      if (textWidth(w, size, bold) <= room || w.length < 6) return w;
      const out: string[] = [];
      let cur = "";
      for (const ch of w) {
        if (cur.length >= 3 && textWidth(`${cur}${ch}-`, size, bold) > room) {
          out.push(`${cur}-`);
          cur = "";
        }
        cur += ch;
      }
      if (cur.length < 3 && out.length) {
        // reste trop court (« es ») : on recoupe la fin pour garder au moins 3 lettres de chaque côté
        const prev = out.pop()!.slice(0, -1);
        const need = 3 - cur.length;
        out.push(`${prev.slice(0, prev.length - need)}-`, prev.slice(prev.length - need) + cur);
      } else out.push(cur);
      return out.join(" ");
    })
    .join(" ");
}

function plotSvg(data: WaterfallData, c: Ctx) {
  return (box: { x: number; y: number; w: number; h: number }) => {
    const { t, k, fmt } = c;
    const bars = waterfallBars(data);
    const n = bars.length;
    if (!n) return { svg: "", summary: "Aucun poste" };
    const fs = 11 * k;
    const [lo, hi] = niceDomain(bars.flatMap((b) => [b.from, b.to]), 5);
    const yTicks = ticks(lo, hi, 5);
    const axisW = Math.max(...yTicks.map((v) => textWidth(fmt(v), fs))) + 8;
    const left = box.x + axisW;
    const right = box.x + box.w;
    const xb = scaleBand<number>().domain(bars.map((_, i) => i)).range([left, right]).paddingInner(0.28).paddingOuter(0.12);
    const bw = xb.bandwidth();
    // libellés : police réduite (jusqu'à 8,5 px) pour que le mot le plus long tienne, puis 4 lignes au plus
    const room = xb.step() - 4;
    const longest = Math.max(...bars.flatMap((b) => b.label.split(/\s+/).map((w) => textWidth(w, fs, b.kind !== "delta"))));
    const lfs = Math.max(8, Math.min(fs, ((fs * room) / Math.max(1, longest)) * 0.97));
    const labLines = bars.map((b) => wrap(hyphenate(b.label, lfs, room, b.kind !== "delta"), lfs, room, 4, b.kind !== "delta"));
    const labH = Math.max(...labLines.map((l) => l.length)) * lfs * 1.2 + 8;
    const top = box.y + 18 * k;
    const bottom = box.y + box.h - labH;
    const y = scaleLinear().domain([lo, hi]).range([bottom, top]);
    const parts: string[] = [];
    for (const v of yTicks) {
      parts.push(tag("line", { x1: left, x2: right, y1: y(v), y2: y(v), stroke: t.grey, "stroke-opacity": v === 0 ? 0.9 : 0.22, "stroke-width": v === 0 ? 1.2 : 1 }));
      parts.push(tag("text", { x: left - 6, y: y(v) + fs * 0.35, "text-anchor": "end", "font-size": fs, fill: t.grey }, esc(fmt(v))));
    }
    const slot = 0.8 / n;
    bars.forEach((b, i) => {
      const x0 = xb(i)!;
      const ya = y(b.from), yb = y(b.to);
      const yTop = Math.min(ya, yb);
      const h = Math.max(1, Math.abs(yb - ya));
      const col = b.kind === "delta" ? (b.value < 0 ? t.negative : t.positive) : t.primary;
      const t0 = i * slot;
      // la barre pousse depuis son niveau de départ
      parts.push(tag("rect", { class: `ac-bar ac-${b.kind}`, x: x0, y: yTop, width: bw, height: h, rx: Math.min(3, bw / 6), fill: col, ...anim("gy", t0, slot * 1.4, ya) }));
      const above = b.kind === "delta" ? b.value >= 0 : b.to >= 0;
      const vy = above ? yTop - 6 : yTop + h + fs + 4;
      const vfs = (b.kind === "total" ? 13 : 12) * k;
      parts.push(tag("text", { class: "ac-value", x: x0 + bw / 2, y: vy, "text-anchor": "middle", "font-size": vfs, "font-weight": b.kind === "delta" ? 600 : 700, fill: b.kind === "delta" ? col : t.text, ...anim("fade", t0 + slot, 0.15) }, esc(fmt(b.kind === "delta" ? b.value : b.to, b.kind === "delta"))));
      labLines[i]!.forEach((l, j) => parts.push(tag("text", { class: "ac-label", x: x0 + bw / 2, y: bottom + 14 * k + j * lfs * 1.2, "text-anchor": "middle", "font-size": lfs, "font-weight": b.kind === "delta" ? 400 : 700, fill: t.text }, esc(l))));
      // liaison vers la barre suivante
      if (i < n - 1) {
        const lvl = y(b.to);
        parts.push(tag("line", { class: "ac-link", x1: x0 + bw, x2: xb(i + 1)!, y1: lvl, y2: lvl, stroke: t.grey, "stroke-dasharray": "3 3", "stroke-width": 1, ...anim("fade", t0 + slot, 0.1) }));
      }
    });
    const deltas = bars.filter((b) => b.kind === "delta");
    const gains = deltas.filter((b) => b.value > 0).reduce((s, b) => s + b.value, 0);
    const costs = deltas.filter((b) => b.value < 0).reduce((s, b) => s + b.value, 0);
    const last = bars[n - 1]!;
    const summary = `Cascade de ${deltas.length} postes : gains ${fmt(gains, true)}, coûts ${fmt(costs, true)}, ${last.kind === "total" ? `${last.label.toLowerCase()} ${fmt(last.to, true)}` : `cumul ${fmt(last.to, true)}`}.`;
    return { svg: tag("g", { class: "ac-plot" }, parts.join("")), summary };
  };
}

export function toSVG(data: WaterfallData, options: ChartOptions = {}, theme?: Theme): string {
  const c = makeCtx("cascade", data, options, theme);
  return compose("cascade", c, plotSvg(data, c));
}

export function tableRows(data: WaterfallData, options: ChartOptions = {}): { head: string[]; rows: string[][] } {
  const fmt = makeCtx("cascade", data, options).fmt;
  return { head: ["Poste", "Montant", "Cumul"], rows: waterfallBars(data).map((b) => [b.label, b.kind === "delta" ? fmt(b.value, true) : fmt(b.to), fmt(b.to, true)]) };
}
