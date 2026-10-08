/**
 * Vignettes de l'Explorer : mini-graphiques dessinés pour la petite taille — la forme des données
 * et un ou deux libellés lisibles (chiffre clé + repère), sans axes ni graduations.
 * La carte (choroplèthe FR/BE) et le film (image du film 4D) sont de vrais aperçus, pas des icônes.
 */
import { arc as d3arc, area as d3area, curveMonotoneX, line as d3line, pie as d3pie, scaleLinear, scaleSqrt } from "d3";
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import { allRows, buildCatModel, buildPointModel } from "../data/model";
import { buildVarianceModel, isFavourable } from "../data/variance";
import { effectiveDataset } from "../data/transform";
import { paletteColors, themeFor, VARIANCE_NEG, VARIANCE_POS } from "../theme";
import { capitalize, clip, count, formatAmount, formatGrowth, formatMeasure, formatNumber, formatPct, formatRatio, formatSignedMeasure, formatSignedPct, monthIndexLong, nounOf } from "../story/fr";
import type { Insight } from "../story/insights";

import { MINI_COLORS, MINI_H, MINI_W, miniSvg, svgAdd } from "./miniBase";

const C = MINI_COLORS;
const PAD = 12;
/** Haut de la zone graphique (sous le chiffre clé). */
const TOP = 54;

/** Chiffre clé (gros) + repère (petit), en haut à gauche ou à droite. */
export function callout(svg: SVGSVGElement, value: string, label: string, anchor: "start" | "end" = "start"): void {
  const x = anchor === "start" ? PAD : MINI_W - PAD;
  const g = svgAdd(svg, "g", { class: "mini-callout", "text-anchor": anchor });
  svgAdd(g, "text", { x, y: 26, "font-size": 20, "font-weight": 700, fill: C.text, "letter-spacing": -0.2 }, clip(value, 22));
  if (label) svgAdd(g, "text", { x, y: 44, "font-size": 12.5, fill: C.label }, clip(label, 40));
}

type MU = "eur" | "pct" | "count" | "plain";
function unitOf(spec: ChartSpec, field: string | undefined): MU {
  if (spec.encoding.aggregate === "count") return "count";
  const u = spec.axes.y.unit;
  if (u === "pct" || (field && /%/.test(field))) return "pct";
  if (u === "eur" || u === "keur" || u === "meur" || (field && /€/.test(field))) return "eur";
  return "plain";
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Chiffre clé + repère selon le type de constat (repris des faits calculés par l'analyse). */
function keyFigure(ins: Insight, eff: Dataset): { value: string; label: string } {
  const f = ins.analysis.facts;
  const spec = ins.spec;
  const u = unitOf(spec, spec.encoding.y[0]);
  const noun = spec.encoding.x ? nounOf(spec.encoding.x) : { sg: "élément", pl: "éléments", f: false };
  switch (ins.kind) {
    case "concentration":
      return { value: formatPct(num(f.share)), label: `sur ${num(f.n) === 1 ? "1 seul" : num(f.n)} ${num(f.n) === 1 ? noun.sg : noun.pl}` };
    case "ranking":
      return { value: formatMeasure(num(f.bestValue), u), label: `${str(f.best)} en tête` };
    case "pipelineSlipping":
      return { value: formatAmount(num(f.amount)), label: `${count(num(f.deals), "affaire", "affaires")} en retard` };
    case "pipelineCloseMonth":
      return { value: formatPct(num(f.peakShare)), label: `à signer en ${str(f.peakMonth)}` };
    case "pipelineAging":
      return { value: formatPct(num(f.share)), label: `ouvert depuis plus de ${num(f.thresholdDays) >= 180 ? "6" : "3"} mois` };
    case "pipelineConversion":
      return { value: formatPct(num(f.winRate)), label: "de taux de transformation" };
    case "pipelineWeighted":
      return { value: formatAmount(num(f.weighted)), label: `pondérés sur ${formatAmount(num(f.open))}` };
    case "trend": {
      const confident = f.confidence !== "faible";
      return confident ? { value: formatGrowth(num(f.growth)), label: "sur un an" } : { value: "Irrégulier", label: `${formatGrowth(num(f.growth))} brut, à confirmer` };
    }
    case "seasonality":
      return { value: capitalize(monthIndexLong(num(f.peakMonth) - 1)), label: `${formatRatio(num(f.peakIndex))} un mois moyen` };
    case "outlier":
      return { value: formatPct(num(f.share)), label: `du total sur ${count(num(f.count), "valeur hors norme", "valeurs hors norme")}` };
    case "correlation":
      return { value: `r = ${formatNumber(num(f.r), 2)}`, label: count(num(f.n), "point") };
    case "variance": {
      const vu = unitOf(spec, spec.encoding.y[0]);
      return { value: formatSignedMeasure(num(f.delta), vu === "plain" ? "eur" : vu), label: `${formatSignedPct(num(f.rel))} ${/N-1/.test(spec.encoding.y[1] ?? "") ? "sur N-1" : "vs budget"}` };
    }
    case "geo":
      return { value: formatPct(num(f.share)), label: `${clip(str(f.top), 22)} en tête` };
    default:
      return { value: formatMeasure(num(f.total), u), label: count(eff.rows.length, "ligne", "lignes") };
  }
}

/* ------------------------------------------------------------------ barres */

function drawBars(svg: SVGSVGElement, ins: Insight, eff: Dataset): boolean {
  const spec = ins.spec;
  const m = buildCatModel(spec, eff, allRows(eff));
  if (!m.keys.length) return false;
  const grouped = spec.type === "groupedBar" && m.series.length >= 2;
  const stacked = spec.type === "stackedBar";
  let items = m.keys.map((_, k) => {
    const parts = m.values.map((row) => (Number.isFinite(row[k]!) ? row[k]! : 0));
    return { label: m.labels[k]!, parts, total: grouped ? parts[0]! : parts.reduce((a, b) => a + b, 0), inner: grouped ? parts[1]! : NaN };
  });
  const ordered = m.xKind === "band" && spec.style.sort === "desc";
  if (ordered) {
    const others = items.filter((i) => /^autres/i.test(i.label));
    items = [...items.filter((i) => !/^autres/i.test(i.label)).sort((a, b) => b.total - a.total), ...others];
  }
  items = items.slice(0, 14);
  const max = Math.max(...items.map((i) => Math.max(i.total, 0)), 1e-9);
  const x0 = PAD;
  const w = MINI_W - PAD * 2;
  const bw = w / items.length;
  const gap = Math.min(6, bw * 0.28);
  const baseY = MINI_H - 12;
  const h = baseY - TOP - 4;
  // Mise en avant : premiers N (concentration), meilleur (classement), pic (mois / tranches)
  const nTop = ins.kind === "concentration" ? Math.max(1, num(ins.analysis.facts.n) || 1) : 1;
  const peakIdx = items.reduce((bi, it, i) => (it.total > items[bi]!.total ? i : bi), 0);
  const isHot = (i: number) => (ordered ? i < nTop : i === peakIdx);
  const colors = stacked ? [C.accent, C.soft, "#1B8BA8", "#C3E4EE", "#0E6E8C", "#5FB8D1"] : [];
  items.forEach((it, i) => {
    const x = x0 + i * bw + gap / 2;
    const bwi = Math.max(1.5, bw - gap);
    if (stacked) {
      let y = baseY;
      it.parts.forEach((p, s) => {
        if (!(p > 0)) return;
        const ph = (p / max) * h;
        y -= ph;
        svgAdd(svg, "rect", { x, y, width: bwi, height: ph, fill: colors[s % colors.length]!, opacity: isHot(i) ? 1 : 0.55 });
      });
      return;
    }
    const bh = (Math.max(0, it.total) / max) * h;
    svgAdd(svg, "rect", { x, y: baseY - bh, width: bwi, height: Math.max(1, bh), rx: Math.min(3, bwi / 3), fill: grouped ? C.muted2 : isHot(i) ? C.accent : C.muted });
    if (grouped && it.inner > 0) {
      const ih = (it.inner / max) * h;
      svgAdd(svg, "rect", { x: x + bwi * 0.18, y: baseY - ih, width: bwi * 0.64, height: ih, rx: Math.min(3, bwi / 4), fill: C.accent });
    }
  });
  svgAdd(svg, "line", { x1: x0, x2: MINI_W - PAD, y1: baseY + 0.5, y2: baseY + 0.5, stroke: C.base, "stroke-width": 1 });
  // Repère sous la barre mise en avant quand il y a peu de barres (sinon le chiffre clé suffit)
  const hot = ordered ? 0 : peakIdx;
  if (items.length <= 8) {
    const cx = x0 + hot * bw + bw / 2;
    const anchor = cx < 60 ? "start" : cx > MINI_W - 60 ? "end" : "middle";
    const tx = anchor === "start" ? x0 + hot * bw + gap / 2 : anchor === "end" ? x0 + (hot + 1) * bw - gap / 2 : cx;
    const hotBar = items[hot]!;
    const by = baseY - (Math.max(0, hotBar.total) / max) * h;
    if (by > TOP + 18) svgAdd(svg, "text", { x: tx, y: by - 6, "text-anchor": anchor, "font-size": 12, "font-weight": 600, fill: C.soft }, clip(hotBar.label, 20));
  }
  return true;
}

/* ------------------------------------------------------------------ séries temporelles */

function drawLine(svg: SVGSVGElement, ins: Insight, eff: Dataset): boolean {
  const spec = ins.spec;
  const m = buildCatModel(spec, eff, allRows(eff));
  if (m.keys.length < 2) return false;
  const seasonal = ins.kind === "seasonality" || (m.series.length > 1 && m.xKind === "band");
  const series = seasonal ? m.values.map((row) => row.map((v) => (Number.isFinite(v) ? v : NaN))) : [m.keys.map((_, k) => m.values.reduce((s, row) => s + (Number.isFinite(row[k]!) ? row[k]! : 0), 0))];
  const all = series.flat().filter(Number.isFinite);
  if (!all.length) return false;
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all);
  const x = scaleLinear().domain([0, m.keys.length - 1]).range([PAD + 2, MINI_W - PAD - 2]);
  const y = scaleLinear().domain([lo, hi || 1]).range([MINI_H - 12, TOP + 4]);
  const ln = d3line<number>().defined((v) => Number.isFinite(v)).x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX);
  if (!seasonal) {
    const s = series[0]!;
    const id = `mg${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgAdd(svg, "defs");
    const grad = svgAdd(defs, "linearGradient", { id, x1: 0, x2: 0, y1: 0, y2: 1 });
    svgAdd(grad, "stop", { offset: "0%", "stop-color": C.accent, "stop-opacity": 0.35 });
    svgAdd(grad, "stop", { offset: "100%", "stop-color": C.accent, "stop-opacity": 0 });
    const ar = d3area<number>().defined((v) => Number.isFinite(v)).x((_, i) => x(i)).y0(y(lo)).y1((v) => y(v)).curve(curveMonotoneX);
    svgAdd(svg, "path", { d: ar(s) ?? "", fill: `url(#${id})` });
    svgAdd(svg, "path", { d: ln(s) ?? "", fill: "none", stroke: C.accent, "stroke-width": 2.4, "stroke-linejoin": "round" });
    const li = s.length - 1;
    svgAdd(svg, "circle", { cx: x(li), cy: y(s[li]!), r: 3.5, fill: C.text, stroke: C.accent, "stroke-width": 2 });
    svgAdd(svg, "text", { x: x(li) - 6, y: Math.max(TOP + 10, y(s[li]!) - 8), "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: C.soft }, m.labels[li] ?? "");
  } else {
    series.forEach((s, i) => {
      const last = i === series.length - 1;
      svgAdd(svg, "path", { d: ln(s) ?? "", fill: "none", stroke: last ? C.accent : C.muted2, "stroke-width": last ? 2.4 : 1.6, "stroke-linejoin": "round" });
    });
    // Repère sur le mois de pic
    const pk = num(ins.analysis.facts.peakMonth) - 1;
    if (pk >= 0 && pk < m.keys.length) {
      const ref = series.map((s) => s[pk]!).filter(Number.isFinite);
      const v = ref.length ? Math.max(...ref) : NaN;
      if (Number.isFinite(v)) svgAdd(svg, "circle", { cx: x(pk), cy: y(v), r: 4, fill: C.text, stroke: C.accent, "stroke-width": 2 });
    }
  }
  return true;
}

/* ------------------------------------------------------------------ nuages de points */

function drawScatter(svg: SVGSVGElement, ins: Insight, eff: Dataset): boolean {
  const pm = buildPointModel(ins.spec, eff, allRows(eff));
  const pts = pm.points.filter((p) => typeof p.x === "number" && Number.isFinite(p.y));
  if (pts.length < 3) return false;
  const xs = pts.map((p) => p.x as number);
  const ys = pts.map((p) => p.y);
  const outlier = ins.kind === "outlier";
  const fence = num(ins.analysis.facts.fence);
  const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).range([PAD + 4, MINI_W - PAD - 4]);
  const y = (outlier ? scaleSqrt() : scaleLinear()).domain([Math.min(0, ...ys), Math.max(...ys)]).range([MINI_H - 12, TOP + 4]);
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  for (const p of sorted) {
    const hot = outlier ? p.y > fence : false;
    svgAdd(svg, "circle", { cx: x(p.x as number), cy: y(p.y), r: hot ? 4 : outlier ? 2 : 3.2, fill: hot ? C.accent : outlier ? C.muted2 : C.accent, opacity: hot ? 1 : outlier ? 0.9 : 0.85 });
  }
  if (!outlier) {
    // Droite de tendance (corrélation)
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) (sxy += (xs[i]! - mx) * (ys[i]! - my)), (sxx += (xs[i]! - mx) ** 2);
    const b = sxx ? sxy / sxx : 0;
    const [d0, d1] = x.domain() as [number, number];
    svgAdd(svg, "line", { x1: x(d0), x2: x(d1), y1: y(my + b * (d0 - mx)), y2: y(my + b * (d1 - mx)), stroke: C.soft, "stroke-width": 1.6, "stroke-dasharray": "5 4" });
  } else if (Number.isFinite(fence)) {
    svgAdd(svg, "line", { x1: PAD, x2: MINI_W - PAD, y1: y(fence), y2: y(fence), stroke: C.soft, "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 });
  }
  return true;
}

/* ------------------------------------------------------------------ écarts (IBCS) */

function drawVariance(svg: SVGSVGElement, ins: Insight, eff: Dataset): boolean {
  const vm = buildVarianceModel(ins.spec, eff);
  if (!vm || !vm.keys.length) return false;
  const pol = ins.spec.variance.polarity;
  const items = vm.keys.map((_, i) => ({ l: vm.labels[i]!, d: vm.delta[i]! })).filter((p) => Number.isFinite(p.d));
  if (!items.length) return false;
  const maxAbs = Math.max(...items.map((p) => Math.abs(p.d)), 1e-9);
  if (vm.xKind === "time") {
    const bw = (MINI_W - PAD * 2) / items.length;
    const mid = (TOP + MINI_H - 12) / 2 + 4;
    const h = (MINI_H - 12 - TOP) / 2;
    items.forEach((p, i) => {
      const bh = (Math.abs(p.d) / maxAbs) * h;
      svgAdd(svg, "rect", { x: PAD + i * bw + 2, y: p.d >= 0 ? mid - bh : mid, width: Math.max(1.5, bw - 4), height: Math.max(1, bh), fill: isFavourable(p.d, pol) ? VARIANCE_POS : VARIANCE_NEG });
    });
    svgAdd(svg, "line", { x1: PAD, x2: MINI_W - PAD, y1: mid, y2: mid, stroke: C.label, "stroke-width": 1 });
    return true;
  }
  const rows = [...items].sort((a, b) => a.d - b.d).slice(0, 6);
  const rh = Math.min(17, (MINI_H - 10 - TOP) / rows.length);
  const zero = MINI_W * 0.56;
  const half = MINI_W - PAD - zero;
  rows.forEach((p, i) => {
    const y0 = TOP + 2 + i * rh;
    const bw = (Math.abs(p.d) / maxAbs) * half;
    svgAdd(svg, "rect", { x: p.d >= 0 ? zero : zero - bw, y: y0 + 2, width: Math.max(1, bw), height: rh - 5, rx: 2, fill: isFavourable(p.d, pol) ? VARIANCE_POS : VARIANCE_NEG });
  });
  svgAdd(svg, "line", { x1: zero, x2: zero, y1: TOP, y2: TOP + rows.length * rh + 2, stroke: C.label, "stroke-width": 1 });
  // Un seul repère : l'élément le plus défavorable (ou le plus favorable si aucun ne l'est)
  const worst = rows.find((p) => !isFavourable(p.d, pol)) ?? rows[rows.length - 1]!;
  const wi = rows.indexOf(worst);
  const wbw = (Math.abs(worst.d) / maxAbs) * half;
  const name = clip(worst.l, 22);
  const tw = name.length * 6.6; // largeur approximative à 12 px
  const leftEnd = worst.d < 0 ? zero - wbw - 6 : zero - 6;
  // À gauche de la barre si la place suffit, sinon à droite de l'axe zéro (jamais rogné)
  const fits = leftEnd - tw >= PAD;
  svgAdd(svg, "text", { x: fits ? leftEnd : zero + 6, y: TOP + 2 + wi * rh + rh / 2 + 4, "text-anchor": fits ? "end" : "start", "font-size": 12, "font-weight": 600, fill: C.text }, name);
  return true;
}

/* ------------------------------------------------------------------ parts */

function drawPie(svg: SVGSVGElement, ins: Insight, eff: Dataset): boolean {
  const m = buildCatModel(ins.spec, eff, allRows(eff));
  const vals = m.keys.map((_, k) => m.values.reduce((s, row) => s + (Number.isFinite(row[k]!) ? Math.max(0, row[k]!) : 0), 0));
  if (!vals.some((v) => v > 0)) return false;
  const colors = paletteColors(ins.spec, themeFor(ins.spec));
  const arcs = d3pie<number>().sort(null)(vals);
  const r = (MINI_H - TOP + 30) / 2;
  const g = svgAdd(svg, "g", { transform: `translate(${MINI_W - PAD - r},${MINI_H / 2 + 6})` });
  const a = d3arc<(typeof arcs)[number]>().innerRadius(ins.spec.type === "donut" ? r * 0.58 : 0).outerRadius(r).padAngle(0.012);
  arcs.forEach((d, i) => svgAdd(g, "path", { d: a(d) ?? "", fill: colors[i % colors.length]! }));
  return true;
}

/* ------------------------------------------------------------------ film 4D */

/** Image du film 4D : un arc par ligne (début → fin, hauteur ∝ montant), compteurs au format français. */
export function drawFilm(svg: SVGSVGElement, spec: ChartSpec, eff: Dataset): boolean {
  const enc = spec.encoding;
  const s = enc.x;
  const e = enc.end ?? enc.x;
  const mag = enc.y[0];
  if (!s || !mag) return false;
  const rows = eff.rows.map((r) => ({ a: num(r[s]), b: num(r[e!]), v: num(r[mag]), g: str(enc.series ? r[enc.series] : "") })).filter((r) => Number.isFinite(r.a) && Number.isFinite(r.v) && r.v > 0);
  if (!rows.length) return false;
  for (const r of rows) if (!Number.isFinite(r.b) || r.b < r.a) r.b = r.a;
  const lo = Math.min(...rows.map((r) => r.a));
  const hi = Math.max(...rows.map((r) => r.b));
  const vmax = Math.max(...rows.map((r) => r.v));
  const x = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([PAD + 4, MINI_W - PAD - 4]);
  const base = MINI_H - 16;
  const hmax = base - TOP;
  const colors = paletteColors(spec, themeFor(spec));
  const groups = [...new Set(rows.map((r) => r.g))];
  const ordered = [...rows].sort((p, q) => q.v - p.v);
  for (const r of ordered) {
    const x0 = x(r.a);
    const x1 = Math.max(x0 + 1.5, x(r.b));
    const ry = Math.sqrt(r.v / vmax) * hmax;
    const rx = (x1 - x0) / 2;
    svgAdd(svg, "path", { d: `M${x0.toFixed(1)},${base} A${rx.toFixed(1)},${ry.toFixed(1)} 0 0 1 ${x1.toFixed(1)},${base}`, fill: "none", stroke: colors[groups.indexOf(r.g) % colors.length]!, "stroke-width": 1, opacity: 0.55 });
  }
  svgAdd(svg, "line", { x1: PAD, x2: MINI_W - PAD, y1: base + 0.5, y2: base + 0.5, stroke: C.label, "stroke-width": 1, opacity: 0.6 });
  const total = rows.reduce((a, r) => a + r.v, 0);
  const lab = enc.label && /opportunit|affaire|deal/i.test(enc.label) ? ["affaire", "affaires"] : ["élément", "éléments"];
  const cur = spec.axes.y.unit === "eur" || spec.axes.y.unit === "keur" || spec.axes.y.unit === "meur" || /€/.test(mag);
  callout(svg, count(rows.length, lab[0]!, lab[1]!), "", "start");
  callout(svg, cur ? formatAmount(total) : formatMeasure(total, "plain"), "", "end");
  return true;
}

/* ------------------------------------------------------------------ entrée */

/**
 * Vignette d'un constat. Synchrone ; la carte est complétée de façon asynchrone (fond de carte
 * chargé à la demande) : la vignette porte alors `data-loading` jusqu'au dessin.
 */
export function miniThumbnail(ins: Insight, ds: Dataset): SVGSVGElement {
  const spec = ins.spec;
  const svg = miniSvg(ins.analysis.title);
  const eff = effectiveDataset(spec, ds);
  const kf = keyFigure(ins, eff);
  if (spec.type === "map") {
    svg.setAttribute("data-loading", "1");
    svgAdd(svg, "rect", { x: MINI_W * 0.42, y: 14, width: MINI_W * 0.54, height: MINI_H - 28, rx: 8, fill: "#111518" });
    callout(svg, kf.value, kf.label);
    void import("../charts/miniMap")
      .then((mod) => mod.drawMiniMap(svg, spec, eff))
      .catch(() => svgAdd(svg, "text", { x: MINI_W * 0.69, y: MINI_H / 2, "text-anchor": "middle", "font-size": 12, fill: C.label }, "Carte indisponible"))
      .finally(() => svg.removeAttribute("data-loading"));
    return svg;
  }
  if (spec.type === "film") {
    if (!drawFilm(svg, spec, eff)) throw new Error("film vide");
    return svg;
  }
  let ok = false;
  const xType = columnOf(eff, spec.encoding.x)?.type;
  if (spec.type === "variance") ok = drawVariance(svg, ins, eff);
  else if (spec.type === "scatter") ok = drawScatter(svg, ins, eff);
  else if (spec.type === "pie" || spec.type === "donut") ok = drawPie(svg, ins, eff);
  else if ((spec.type === "line" || spec.type === "area" || spec.type === "stackedArea") && (xType === "date" || ins.kind === "seasonality")) ok = drawLine(svg, ins, eff);
  else ok = drawBars(svg, ins, eff);
  if (!ok) throw new Error("aperçu vide");
  callout(svg, kf.value, kf.label);
  return svg;
}
