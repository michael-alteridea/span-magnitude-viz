/**
 * Gain cumulé avec retour sur investissement : courbe du cumul, rouge sous zéro, vert après le point mort,
 * repère et libellé du délai de retour (« Rentabilisé en 13,6 mois »).
 */
import { area, curveMonotoneX, line, scaleLinear } from "d3";
import { duration as fmtDuration } from "../format";
import { anim, compose, makeCtx, niceDomain, ticks, type ChartOptions, type Ctx } from "../frame";
import { esc, fit, tag, textWidth } from "../svg";
import type { Theme } from "../theme";

export interface GainPoint {
  /** Libellé de la période (« M1 », « janv. 2027 »…). */
  label: string;
  /** Flux net de la période (gains − coûts), ou cumul si data.cumulative. */
  value: number;
}

export interface CumulativeGainData {
  points: GainPoint[];
  /** Les valeurs sont déjà cumulées (faux par défaut : flux par période). */
  cumulative?: boolean;
  /** Unité de période pour le délai de retour (« mois » par défaut). */
  periodUnit?: string;
  /** Libellé du retour (sinon « Rentabilisé en … »). */
  paybackLabel?: string;
}

export interface Payback {
  /** Cumul à la fin de chaque période. */
  cum: number[];
  /** Index de la première période où le cumul repasse à zéro ou au-dessus (null : jamais). */
  index: number | null;
  /** Délai de retour en périodes, interpolé (ex. 13,6). */
  periods: number | null;
  /** Position sur l'axe (index fractionnaire) du passage à zéro. */
  x: number | null;
  /** Creux de trésorerie (cumul le plus bas) et son index. */
  trough: { value: number; index: number };
}

/** Cumul et délai de retour (interpolation linéaire du passage à zéro). */
export function computePayback(values: number[], cumulative = false): Payback {
  const cum: number[] = [];
  let s = 0;
  for (const v of values) {
    const x = Number.isFinite(v) ? v : 0;
    s = cumulative ? x : s + x;
    cum.push(s);
  }
  let trough = { value: Infinity, index: 0 };
  cum.forEach((v, i) => {
    if (v < trough.value) trough = { value: v, index: i };
  });
  if (!cum.length) trough = { value: 0, index: 0 };
  let index: number | null = null;
  let periods: number | null = null;
  let x: number | null = null;
  let wasNeg = false;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i]! < 0) wasNeg = true;
    else if (wasNeg) {
      index = i;
      const prev = i > 0 ? cum[i - 1]! : 0;
      const frac = cum[i]! === prev ? 0 : -prev / (cum[i]! - prev);
      x = i - 1 + frac;
      periods = i + frac;
      break;
    }
  }
  return { cum, index, periods, x, trough };
}

function plotSvg(data: CumulativeGainData, c: Ctx) {
  return (box: { x: number; y: number; w: number; h: number }) => {
    const { t, k, fmt, id } = c;
    const pts = (data.points ?? []).filter((p) => p && typeof p.label === "string");
    const n = pts.length;
    const pb = computePayback(pts.map((p) => p.value), !!data.cumulative);
    const unit = data.periodUnit ?? "mois";
    if (n < 2) return { svg: tag("text", { x: box.x, y: box.y + 20, fill: t.grey, "font-size": 13 }, "Pas assez de périodes"), summary: "Pas assez de périodes" };
    const fs = 11 * k;
    const [lo, hi] = niceDomain(pb.cum, box.h < 220 ? 4 : 5);
    const yTicks = ticks(lo, hi, box.h < 220 ? 4 : 5);
    const axisW = Math.max(...yTicks.map((v) => textWidth(c.fmt(v), fs))) + 8;
    const left = box.x + axisW;
    const right = box.x + box.w - Math.min(64, box.w * 0.1);
    const top = box.y + 30 * k;
    const bottom = box.y + box.h - 22 * k;
    const x = scaleLinear().domain([0, n - 1]).range([left, right]);
    const y = scaleLinear().domain([lo, hi]).range([bottom, top]);
    const y0 = y(0);
    const parts: string[] = [];
    // grille + axe des valeurs
    for (const v of yTicks) {
      parts.push(tag("line", { x1: left, x2: box.x + box.w, y1: y(v), y2: y(v), stroke: t.grey, "stroke-opacity": v === 0 ? 0.9 : 0.22, "stroke-width": v === 0 ? 1.2 : 1 }));
      parts.push(tag("text", { x: left - 6, y: y(v) + fs * 0.35, "text-anchor": "end", "font-size": fs, fill: t.grey }, esc(fmt(v))));
    }
    // axe des périodes : 2 à 8 libellés répartis
    const maxLab = Math.max(2, Math.min(8, Math.floor((right - left) / (textWidth(pts[0]!.label, fs) + 18))));
    const step = Math.max(1, Math.ceil((n - 1) / (maxLab - 1)));
    for (let i = 0; i < n; i += step) parts.push(tag("text", { x: x(i), y: bottom + 16 * k, "text-anchor": "middle", "font-size": fs, fill: t.grey }, esc(pts[i]!.label)));
    if ((n - 1) % step !== 0 && (n - 1) - Math.floor((n - 1) / step) * step >= step / 2) parts.push(tag("text", { x: x(n - 1), y: bottom + 16 * k, "text-anchor": "middle", "font-size": fs, fill: t.grey }, esc(pts[n - 1]!.label)));
    // courbe : zones sous / au-dessus de zéro découpées par deux clipPath
    const xy = pb.cum.map((v, i) => [x(i), y(v)] as [number, number]);
    const ln = line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX)(xy) ?? "";
    const ar = area<[number, number]>().x((d) => d[0]).y0(y0).y1((d) => d[1]).curve(curveMonotoneX)(xy) ?? "";
    const neg = `${id}-neg`, pos = `${id}-pos`, rev = `${id}-rev`;
    const defs =
      tag("clipPath", { id: neg }, tag("rect", { x: box.x, y: y0, width: box.w, height: Math.max(0, bottom - y0 + 4) })) +
      tag("clipPath", { id: pos }, tag("rect", { x: box.x, y: top - 8, width: box.w, height: Math.max(0, y0 - top + 8) })) +
      tag("clipPath", { id: rev }, tag("rect", { class: "ac-reveal", x: left - 4, y: box.y, width: right - left + 8, height: box.h, ...anim("wipe", 0, 0.62) }));
    const series = (clip: string, col: string) =>
      tag("g", { "clip-path": `url(#${clip})` }, tag("path", { class: "ac-area", d: ar, fill: col, "fill-opacity": 0.16 }) + tag("path", { class: "ac-line", d: ln, fill: "none", stroke: col, "stroke-width": 2.6 * k, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    parts.push(tag("g", { class: "ac-series", "clip-path": `url(#${rev})` }, series(neg, t.negative) + series(pos, t.positive)));
    // creux de trésorerie
    const summary: string[] = [];
    if (pb.trough.value < 0) {
      const tx = x(pb.trough.index), ty = y(pb.trough.value);
      const lab = `Creux : ${fmt(pb.trough.value)}`;
      const lw = textWidth(lab, fs, true);
      const lx = Math.max(left + lw / 2, Math.min(right - lw / 2, tx));
      parts.push(tag("g", { class: "ac-trough", ...anim("fade", 0.35, 0.2) }, tag("circle", { cx: tx, cy: ty, r: 3.5 * k, fill: t.negative }) + tag("text", { x: lx, y: Math.min(bottom - 4, ty + 17 * k), "text-anchor": "middle", "font-size": fs, "font-weight": 600, fill: t.negative }, esc(lab))));
      summary.push(`creux de ${fmt(pb.trough.value)} en ${pts[pb.trough.index]!.label}`);
    }
    // retour sur investissement
    if (pb.x != null && pb.periods != null) {
      const px = x(pb.x);
      const lab = data.paybackLabel ?? `Rentabilisé en ${fmtDuration(pb.periods, unit, pb.periods < 10 ? 1 : 0)}`;
      const lfs = 12.5 * k;
      const lw = textWidth(lab, lfs, true) + 16;
      const bx = Math.max(left, Math.min(box.x + box.w - lw, px - lw / 2));
      const by = box.y + 2;
      parts.push(
        tag(
          "g",
          { class: "ac-payback", ...anim("fade", 0.6, 0.25) },
          tag("line", { x1: px, x2: px, y1: by + 24 * k, y2: y0, stroke: t.text, "stroke-opacity": 0.55, "stroke-dasharray": "3 3", "stroke-width": 1 }) +
            tag("circle", { cx: px, cy: y0, r: 5 * k, fill: t.bg === "transparent" ? "#ffffff" : t.bg, stroke: t.positive, "stroke-width": 2.4 }) +
            tag("rect", { x: bx, y: by, width: lw, height: 22 * k, rx: 11 * k, fill: t.primary }) +
            tag("text", { x: bx + lw / 2, y: by + 15 * k, "text-anchor": "middle", "font-size": lfs, "font-weight": 700, fill: "#ffffff" }, esc(fit(lab, lfs, box.w - 16, true)))
        )
      );
      summary.push(`${lab.charAt(0).toLowerCase()}${lab.slice(1)} (${pts[pb.index!]!.label})`);
    } else summary.push(pb.cum[n - 1]! < 0 ? "pas de retour sur la période" : "gain positif dès le départ");
    // valeur finale
    const last = pb.cum[n - 1]!;
    const endCol = last < 0 ? t.negative : t.positive;
    parts.push(tag("text", { class: "ac-end", x: x(n - 1) + 6, y: y(last) + fs * 0.35, "font-size": 13 * k, "font-weight": 700, fill: endCol, ...anim("fade", 0.62, 0.2) }, esc(fmt(last, true))));
    summary.push(`cumul final ${fmt(last, true)} en ${pts[n - 1]!.label}`);
    return { svg: tag("g", { class: "ac-plot" }, parts.join("")), defs, summary: `Gain cumulé sur ${n} périodes : ${summary.join(", ")}.` };
  };
}

export function toSVG(data: CumulativeGainData, options: ChartOptions = {}, theme?: Theme): string {
  const c = makeCtx("gain", data, options, theme);
  return compose("gain", c, plotSvg(data, c));
}

/** Lignes du tableau accessible (période, flux, cumul). */
export function tableRows(data: CumulativeGainData, options: ChartOptions = {}): { head: string[]; rows: string[][] } {
  const fmt = makeCtx("gain", data, options).fmt;
  const pb = computePayback(data.points.map((p) => p.value), !!data.cumulative);
  return {
    head: ["Période", data.cumulative ? "Cumul" : "Flux net", "Cumul"],
    rows: data.points.map((p, i) => [p.label, fmt(p.value, !data.cumulative), fmt(pb.cum[i]!, true)]),
  };
}
