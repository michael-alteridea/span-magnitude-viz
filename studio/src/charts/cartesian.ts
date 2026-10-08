/**
 * Graphiques cartésiens en SVG pur (D3) : barres (verticales, horizontales, groupées, empilées),
 * lignes, aires (empilées ou non), nuage de points ; axe Y secondaire indépendant.
 */
import {
  area as d3area,
  axisBottom,
  axisLeft,
  axisRight,
  curveLinear,
  curveMonotoneX,
  curveStepAfter,
  line as d3line,
  scaleBand,
  scaleLinear,
  scaleLog,
  scalePoint,
  scaleSqrt,
  scaleUtc,
  type Axis,
  type ScaleLinear,
  type ScaleLogarithmic,
  type ScaleTime,
} from "d3";
import type { AxisSpec } from "../spec";
import { isBarType } from "../spec";
import type { CatModel, PointModel } from "../data/model";
import { valueFormatter, timeTickFormat, unitSuffix } from "../format";
import { clamp01, easeOut, stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { canOverlapScenarios, drawScenarioBars, hatchPattern, normeActive, seriesScenarios } from "./norme";
import { rows as tipRows, shareRow, tip, type TipData } from "./tip";
import { SCENARIO_NAMES } from "../norme";
import { normeDecimals, scenarioStyle } from "../norme";
import { ellipsize, measure, wrap } from "./text";
import { barDeco, focusTexts, pictoUnit } from "./barDeco";
import { drawCallout, easeInOut, focusGrey, focusProgress, makeCallout, mixHex, placeCallout, pointKey, resolveFocus, type Rect } from "./focus";
import { categoryIcon, drawIcon } from "./icons";
import { groupIcons, pointIconSize } from "./pointIcons";
import { VARIANCE_NEG, VARIANCE_POS } from "../theme";
import { isGood } from "../norme";

type ValueScale = ScaleLinear<number, number> | ScaleLogarithmic<number, number>;

function curveOf(c: string) {
  return c === "linear" ? curveLinear : c === "step" ? curveStepAfter : curveMonotoneX;
}

/** Échelle de valeurs (linéaire ou log) avec bornes auto / manuelles. */
export function valueScale(axis: AxisSpec, extent: [number, number], range: [number, number], includeZero: boolean): { scale: ValueScale; log: boolean; dropped: boolean } {
  let [lo, hi] = extent;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  if (axis.scale === "log") {
    const dropped = lo <= 0;
    let min = axis.min != null && axis.min > 0 ? axis.min : lo > 0 ? lo : Math.max(hi / 1000, 1e-6);
    let max = axis.max != null && axis.max > 0 ? axis.max : hi > 0 ? hi : 10;
    if (max <= min) max = min * 10;
    const sc = scaleLog().domain([min, max]).range(range).clamp(true);
    if (axis.min == null || axis.max == null) {
      const n = sc.copy().nice().domain() as [number, number];
      sc.domain([axis.min ?? n[0], axis.max ?? n[1]]);
    }
    return { scale: sc, log: true, dropped };
  }
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) hi = lo + 1;
  const sc = scaleLinear().domain([lo, hi]).range(range);
  if (axis.min == null || axis.max == null) {
    const n = sc.copy().nice().domain() as [number, number];
    sc.domain([axis.min ?? n[0], axis.max ?? n[1]]);
  } else sc.domain([axis.min, axis.max]);
  if (axis.min != null || axis.max != null) sc.clamp(true);
  return { scale: sc, log: false, dropped: false };
}

function logTicks(sc: ScaleLogarithmic<number, number>, approx: number): number[] {
  let t = sc.ticks();
  if (t.length > approx * 1.6) t = t.filter((v) => [1, 2, 5].includes(Math.round(v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9)))));
  if (t.length > approx * 1.6) t = t.filter((v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
  return t;
}

function ticksFor(sc: ValueScale, log: boolean, n: number): number[] {
  return log ? logTicks(sc as ScaleLogarithmic<number, number>, n) : (sc as ScaleLinear<number, number>).ticks(n);
}

function styleAxis(sel: G, ctx: DrawCtx, hideDomain = false) {
  const { theme, s, font } = ctx;
  sel.selectAll<SVGTextElement, unknown>("text").attr("fill", theme.muted).attr("font-size", 13 * s).attr("font-family", font);
  sel.selectAll<SVGLineElement, unknown>("line").attr("stroke", theme.axis);
  sel.select<SVGPathElement>(".domain").attr("stroke", theme.axis).attr("display", hideDomain ? "none" : null);
}

function stepOf(ticks: number[]): number {
  return ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : Math.abs(ticks[0] ?? 1);
}

/** Valeurs empilées par clé (divergentes : positifs vers le haut, négatifs vers le bas). */
export function stackValues(values: number[][], normalize: boolean): { y0: number[][]; y1: number[][] } {
  const nS = values.length;
  const nK = values[0]?.length ?? 0;
  const y0 = values.map(() => new Array<number>(nK).fill(0));
  const y1 = values.map(() => new Array<number>(nK).fill(0));
  for (let k = 0; k < nK; k++) {
    let total = 0;
    if (normalize) for (let s = 0; s < nS; s++) total += Math.abs(Number.isFinite(values[s]![k]!) ? values[s]![k]! : 0);
    let pos = 0;
    let neg = 0;
    for (let s = 0; s < nS; s++) {
      let v = values[s]![k]!;
      if (!Number.isFinite(v)) v = 0;
      if (normalize) v = total > 0 ? (v / total) * 100 : 0;
      if (v >= 0) {
        y0[s]![k] = pos;
        pos += v;
        y1[s]![k] = pos;
      } else {
        y0[s]![k] = neg;
        neg += v;
        y1[s]![k] = neg;
      }
    }
  }
  return { y0, y1 };
}

/** Étendue des valeurs d'un modèle catégoriel selon le type (empilé ou non). */
export function catExtent(model: CatModel, stacked: boolean, normalize: boolean): [number, number] {
  if (stacked) {
    if (normalize) return [0, 100];
    const { y0, y1 } = stackValues(model.values, false);
    let lo = 0;
    let hi = 0;
    for (const arr of [...y0, ...y1]) for (const v of arr) (lo = Math.min(lo, v), hi = Math.max(hi, v));
    return [lo, hi];
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of model.values) for (const v of row) if (Number.isFinite(v)) (lo = Math.min(lo, v), hi = Math.max(hi, v));
  if (lo === Infinity) return [0, 1];
  return [lo, hi];
}

export function y2Extent(model: CatModel): [number, number] | undefined {
  if (!model.y2) return undefined;
  const v = model.y2.filter(Number.isFinite);
  if (!v.length) return undefined;
  return [Math.min(...v), Math.max(...v)];
}

/** Infobulle d'une valeur (catégorie × série) : valeur, part de la série, part de la catégorie (empilé / groupé). */
function cellTip(model: CatModel, k: number, si: number, v: string, code: string | null): TipData {
  const raw = model.values[si]![k]!;
  const nS = model.series.length;
  const serTot = model.values[si]!.reduce((a, x) => a + (Number.isFinite(x) && x > 0 ? x : 0), 0);
  const catTot = model.values.reduce((a, row) => a + (Number.isFinite(row[k]!) && row[k]! > 0 ? row[k]! : 0), 0);
  const scn = code ? (SCENARIO_NAMES as Record<string, string>)[code] : null;
  const ser = model.series[si]!;
  return {
    t: model.labels[k]!,
    sub: nS > 1 || scn ? [ser, scn && scn !== ser ? scn : null].filter(Boolean).join(" · ") : undefined,
    v,
    rows: tipRows(shareRow(raw, serTot, nS > 1 ? `Part de « ${ser} »` : "Part du total"), nS > 1 && !code ? shareRow(raw, catTot, `Part de « ${model.labels[k]} »`) : null),
  };
}

/* ===================================================================== */

export function drawCategorical(root: G, rect: PlotRect, ctx: DrawCtx, model: CatModel): void {
  const { spec, theme, s, font, colors, frame, prep } = ctx;
  const t = spec.type;
  const bars = isBarType(t);
  const horizontal = t === "barH" || (bars && spec.style.horizontal && t !== "bar");
  const stacked = t === "stackedBar" || t === "stackedArea";
  const normalize = stacked && spec.style.normalize;
  let grouped = t === "groupedBar" || (t === "bar" && model.series.length > 1) || (t === "barH" && model.series.length > 1);
  const nK = model.keys.length;
  const nS = model.series.length;
  const yAxis: AxisSpec = normalize ? { ...spec.axes.y, unit: "pct", min: 0, max: 100, scale: "linear" } : spec.axes.y;
  const xAxis = spec.axes.x;
  const fs = 13 * s;
  const build = frame.build;
  const reveal = prep.reveal;
  // ---- mode norme : scénarios (réel, N-1, budget, prévision) superposés + bandeau d'écarts
  const norme = normeActive(ctx);
  const codes = norme ? seriesScenarios(ctx, model) : [];
  if (norme && bars && !stacked && !normalize && canOverlapScenarios(codes)) {
    drawScenarioBars(root, rect, ctx, model, codes);
    return;
  }

  // ---- étendues
  let ext = prep.domains.y && !normalize ? prep.domains.y : catExtent(model, stacked, normalize);
  if (ctx.sharedMax != null && !normalize && spec.axes.y.max == null) ext = [Math.min(0, ext[0]), Math.max(ext[1], ctx.sharedMax)];

  // ---- barres racontées (étape I) : icône, pictogrammes, objectif, barre mise en avant + annotation
  const deco = barDeco(spec, model, bars && !stacked && !normalize && !norme);
  const goal = deco.cap === "goal";
  if (goal) grouped = false;
  const focusK = deco.focusK;
  const lenEst = horizontal ? rect.w * 0.78 : rect.h * 0.8;
  const bandEst = (((horizontal ? rect.h : rect.w) * 0.85) / Math.max(1, nK)) * 0.76;
  const capEst = Math.max(9 * s, Math.min(18 * s, bandEst * 0.34));
  const fmtDeco = valueFormatter(yAxis);
  const callFs = 14.5 * s;
  const noteFs = 12 * s;
  const callPad = 12 * s;
  let callout: { title: string[]; note: string[]; w: number; h: number; icon: string | null; avg: number | null } | null = null;
  if (focusK != null) {
    const label = model.labels[focusK] ?? "";
    const vals = model.values[0] ?? [];
    // moyennes, min / max, dernières valeurs et taux (« 65,4 % ») ne s'additionnent pas : pas de « part du total »
    const additive = (spec.encoding.aggregate === "sum" || spec.encoding.aggregate === "count") && !/%\s*$/.test(fmtDeco(1));
    const tx = focusTexts(label, vals[focusK] ?? 0, vals, focusK, fmtDeco, spec.style.focus, additive);
    const icon = deco.icons[focusK] ?? categoryIcon(label, spec.style.capIcons);
    const iconW = icon ? 34 * s : 0;
    const maxW = horizontal ? lenEst * 0.44 : Math.min(rect.w * 0.52, 480 * s);
    const inner = Math.max(80 * s, maxW - 2 * callPad - iconW);
    // lignes équilibrées : plus petite largeur qui garde le même nombre de lignes (pas de mot orphelin)
    const balanced = (t: string, fs: number, wt: number, maxL: number) => {
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
    };
    // cadre étroit (Reel vertical, téléphone) : une ligne de plus plutôt qu'un titre tronqué
    const title = balanced(tx.title, callFs, 700, inner < 160 * s ? 3 : 2);
    const note = tx.note ? balanced(tx.note, noteFs, 400, inner < 160 * s ? 4 : 3) : [];
    const w = Math.max(...title.map((l) => measure(l, callFs, font, 700)), ...note.map((l) => measure(l, noteFs, font)), 60 * s) + 2 * callPad + iconW;
    const h = 2 * callPad + title.length * callFs * 1.2 + (note.length ? 5 * s + note.length * noteFs * 1.35 : 0);
    callout = { title, note, w, h, icon, avg: tx.avg };
  }
  let reserve = 0;
  if (deco.cap === "icon" || goal) reserve = horizontal ? capEst * 2 + 64 * s : capEst + 18 * s;
  if (deco.cap === "picto") reserve = horizontal ? 110 * s : 28 * s;
  // barres horizontales : l'étiquette de valeur de la plus grande barre doit aussi tenir avant l'annotation
  const labelRoom = horizontal && callout && spec.style.valueLabels ? measure(fmtDeco(ext[1]), 13.5 * s, font, 700) + 12 * s : 0;
  if (callout && !horizontal) reserve = Math.max(reserve, callout.h + 30 * s + reserve);
  const growable = spec.axes.y.max == null && ext[1] > 0 && !ctx.sharedMax;
  const ext0 = ext[1];
  if (reserve > 0 && growable) ext = [ext[0], ext0 / Math.max(0.4, 1 - reserve / lenEst)];
  if (callout && horizontal && growable) {
    // barres horizontales : l'annotation se place à droite, à hauteur des barres les plus courtes (au plus près de la
    // barre mise en avant) ; l'axe n'est prolongé que de ce qu'il faut pour que ces barres et leurs étiquettes passent avant elle
    const free = lenEst - callout.w - labelRoom - (deco.cap === "icon" || goal ? capEst * 2 + 16 * s : 0) - 16 * s;
    const win = calloutWindow(model.values[0] ?? [], focusK ?? 0, Math.ceil(callout.h / Math.max(1, (rect.h * 0.86) / Math.max(1, nK))));
    const need = free > lenEst * 0.2 ? (win.max * lenEst) / free : Infinity;
    const fallback = ext0 / Math.max(0.4, 1 - (callout.w + labelRoom + 40 * s) / lenEst);
    ext = [ext[0], Math.max(ext[1], Math.min(fallback, Math.max(ext0, need)))];
  }
  const includeZero = bars || t === "area" || t === "stackedArea";
  const hasY2 = !!model.y2 && spec.encoding.y2 != null;
  const y2ext = prep.domains.y2 ?? y2Extent(model) ?? [0, 1];

  // ---- marges d'axes (mesurées)
  const valueLen = horizontal ? rect.w : rect.h;
  const nTicks = Math.max(2, Math.round(valueLen / ((horizontal ? 120 : 56) * s)));
  const probe = valueScale(yAxis, ext, [0, 1], includeZero);
  const yTicks = ticksFor(probe.scale, probe.log, nTicks);
  // Mode norme : unité dans le sous-titre (pas sur chaque graduation), décimales identiques partout
  const yFmt = norme
    ? valueFormatter({ ...yAxis, decimals: yAxis.decimals ?? (normalize ? 0 : normeDecimals(yAxis)) }, probe.log ? undefined : stepOf(yTicks), { suffix: normalize })
    : valueFormatter(yAxis, probe.log ? undefined : stepOf(yTicks));
  const y2probe = hasY2 ? valueScale(spec.axes.y2, y2ext, [0, 1], false) : null;
  const y2Ticks = y2probe ? ticksFor(y2probe.scale, y2probe.log, nTicks) : [];
  const y2Fmt = valueFormatter(spec.axes.y2, y2probe && !y2probe.log ? stepOf(y2Ticks) : undefined);

  const titleRow = (yAxis.title || (hasY2 && spec.axes.y2.title)) && yAxis.show ? 22 * s : 0;
  const xTitleH = xAxis.title && xAxis.show ? 24 * s : 0;

  let left: number;
  let right = 6 * s;
  let bottom: number;
  let rotate = false;
  const continuousX = model.xKind !== "band";

  if (horizontal) {
    const catW = Math.min(rect.w * 0.34, Math.max(...model.labels.map((l) => measure(l, fs, font)), 10) + 12 * s);
    left = xAxis.show ? catW : 8 * s;
    bottom = (yAxis.show ? fs + 14 * s : 6 * s) + xTitleH;
    right = Math.max(right, measure(yFmt(ext[1]), fs, font) / 2);
  } else {
    left = yAxis.show ? Math.max(...yTicks.map((v) => measure(yFmt(v), fs, font)), 10) + 12 * s : 8 * s;
    if (hasY2 && spec.axes.y2.show) right = Math.max(...y2Ticks.map((v) => measure(y2Fmt(v), fs, font)), 10) + 12 * s;
    const plotW = rect.w - left - right;
    let labelH = fs + 14 * s;
    if (!continuousX && xAxis.show) {
      const band = plotW / Math.max(1, nK);
      const maxLab = Math.max(...model.labels.map((l) => measure(l, fs, font)), 0);
      if (maxLab > band * 0.95 && nK > 1) {
        rotate = true;
        labelH = Math.min(rect.h * 0.3, maxLab * 0.62 + fs + 12 * s);
      }
    }
    bottom = (xAxis.show ? labelH : 6 * s) + xTitleH;
  }

  const px = rect.x + left;
  const py = rect.y + titleRow;
  const pw = Math.max(20, rect.w - left - right);
  const ph = Math.max(20, rect.h - titleRow - bottom);
  const g = root.append("g").attr("transform", `translate(${px},${py})`);

  // ---- échelles
  const vRange: [number, number] = horizontal ? [0, pw] : [ph, 0];
  const V = valueScale(yAxis, ext, vRange, includeZero);
  const vs = V.scale;
  const base = V.log ? (vs.domain()[0] as number) : Math.max(vs.domain()[0] as number, Math.min(0, vs.domain()[1] as number));
  const v = (x: number) => vs(V.log ? Math.max(x, vs.domain()[0] as number) : x) as number;

  const catLen = horizontal ? ph : pw;
  const band = scaleBand<number>()
    .domain(model.keys.map((_, i) => i))
    .range([0, catLen])
    .paddingInner(bars ? (nK > 40 ? 0.08 : 0.22) : 0)
    .paddingOuter(bars ? 0.12 : 0);
  let xc: (i: number) => number; // centre de la clé
  let xTime: ScaleTime<number, number> | null = null;
  let xLin: ValueScale | null = null;
  if (!bars && model.xKind === "time") {
    const keysN = model.keys as number[];
    const dom = prep.domains.x ?? [Math.min(...keysN), Math.max(...keysN)];
    xTime = scaleUtc<number, number>().domain([new Date(dom[0]), new Date(dom[1] === dom[0] ? dom[0] + 86400000 : dom[1])]).range([0, pw]);
    xc = (i) => xTime!(new Date(keysN[i]!));
  } else if (!bars && model.xKind === "linear") {
    const keysN = model.keys as number[];
    const dom = prep.domains.x ?? ([Math.min(...keysN), Math.max(...keysN)] as [number, number]);
    xLin = valueScale(xAxis, dom, [0, pw], false).scale;
    xc = (i) => xLin!(keysN[i]!) as number;
  } else if (!bars) {
    const pt = scalePoint<number>().domain(model.keys.map((_, i) => i)).range([0, pw]).padding(0.5);
    xc = (i) => pt(i)!;
  } else {
    xc = (i) => band(i)! + band.bandwidth() / 2;
  }

  // ---- grille + axes
  const gGrid = g.append("g").attr("class", "r4d-grid");
  if (yAxis.grid) {
    for (const tv of yTicks.filter((tv) => tv >= Math.min(...(vs.domain() as number[])) && tv <= Math.max(...(vs.domain() as number[])))) {
      const p = v(tv);
      if (horizontal) gGrid.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph);
      else gGrid.append("line").attr("x1", 0).attr("x2", pw).attr("y1", p).attr("y2", p);
    }
  }
  if (xAxis.grid) {
    if (continuousX && (xTime || xLin)) {
      const tk = xTime ? xTime.ticks(Math.max(2, Math.round(pw / (110 * s)))).map((d) => xTime!(d)) : ticksFor(xLin!, xAxis.scale === "log", Math.round(pw / (110 * s))).map((d) => xLin!(d) as number);
      for (const p of tk) gGrid.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph);
    } else {
      for (let i = 0; i < nK; i++) {
        const p = xc(i);
        if (horizontal) gGrid.append("line").attr("x1", 0).attr("x2", pw).attr("y1", p).attr("y2", p);
        else gGrid.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph);
      }
    }
  }
  gGrid.selectAll("line").attr("stroke", theme.grid).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");

  // Axe des valeurs
  if (yAxis.show) {
    const ax = (horizontal ? axisBottom(vs) : axisLeft(vs)) as Axis<number>;
    ax.tickValues(yTicks.filter((tv) => tv >= Math.min(...(vs.domain() as number[])) - 1e-9 && tv <= Math.max(...(vs.domain() as number[])) + 1e-9)).tickFormat((d) => yFmt(Number(d))).tickSize(0).tickPadding(8 * s);
    const ga = g.append("g").attr("class", "r4d-axis r4d-axis-y");
    if (horizontal) ga.attr("transform", `translate(0,${ph})`);
    ga.call(ax as never);
    styleAxis(ga, ctx, true);
  }
  // Ligne de base
  if (bars || includeZero) {
    const p = v(base);
    const bl = horizontal ? g.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph) : g.append("line").attr("x1", 0).attr("x2", pw).attr("y1", p).attr("y2", p);
    bl.attr("stroke", theme.axis).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");
  }
  // Axe des catégories / X
  if (xAxis.show) {
    const ga = g.append("g").attr("class", "r4d-axis r4d-axis-x");
    if (continuousX && xTime) {
      const tk = xTime.ticks(Math.max(2, Math.round(pw / (110 * s))));
      ga.attr("transform", `translate(0,${ph})`).call(axisBottom(xTime).tickValues(tk).tickFormat((d, i) => timeTickFormat(d as Date, i)).tickSizeOuter(0).tickSizeInner(5 * s).tickPadding(6 * s) as never);
    } else if (continuousX && xLin) {
      const tk = ticksFor(xLin, xAxis.scale === "log", Math.max(2, Math.round(pw / (110 * s))));
      const f = valueFormatter(xAxis, xAxis.scale === "log" ? undefined : stepOf(tk));
      ga.attr("transform", `translate(0,${ph})`).call((axisBottom(xLin) as Axis<number>).tickValues(tk).tickFormat((d) => f(Number(d))).tickSizeOuter(0).tickSizeInner(5 * s).tickPadding(6 * s) as never);
    } else {
      // étiquettes de catégories (éclaircies si trop nombreuses)
      const maxLabels = Math.max(2, Math.floor(catLen / ((horizontal ? 18 : rotate ? 18 : 60) * s)));
      const every = Math.max(1, Math.ceil(nK / maxLabels));
      const labW = horizontal ? left - 12 * s : rotate ? (bottom - xTitleH) * 1.5 : catLen / nK;
      model.labels.forEach((lab, i) => {
        if (i % every !== 0 && i !== nK - 1) return;
        if (i % every !== 0 && i === nK - 1 && every > 1) return;
        const p = xc(i);
        const text = ellipsize(lab, Math.max(labW, 30 * s), fs, font);
        if (horizontal) {
          ga.append("text").attr("x", -10 * s).attr("y", p).attr("dy", "0.35em").attr("text-anchor", "end").attr("data-k", i).text(text);
        } else if (rotate) {
          ga.append("text")
            .attr("transform", `translate(${p},${ph + 10 * s}) rotate(-38)`)
            .attr("text-anchor", "end")
            .attr("dy", "0.35em")
            .attr("data-k", i)
            .text(text);
        } else {
          ga.append("text").attr("x", p).attr("y", ph + 8 * s + fs * 0.8).attr("text-anchor", "middle").attr("data-k", i).text(text);
        }
      });
      ga.selectAll("text").attr("fill", theme.muted).attr("font-size", fs).attr("font-family", font);
    }
    if (continuousX) styleAxis(ga, ctx);
    if (xAxis.title) {
      g.append("text")
        .attr("x", horizontal ? -left + 2 : pw / 2)
        .attr("y", horizontal ? -10 * s : ph + bottom - 6 * s)
        .attr("text-anchor", horizontal ? "start" : "middle")
        .attr("fill", theme.muted)
        .attr("font-size", fs)
        .attr("font-weight", 700)
        .attr("font-family", font)
        .text(xAxis.title);
    }
  }
  if (yAxis.show && yAxis.title) {
    if (horizontal)
      g.append("text").attr("x", pw).attr("y", ph + bottom - 6 * s).attr("text-anchor", "end").attr("fill", theme.muted).attr("font-size", fs).attr("font-weight", 700).attr("font-family", font).text(yAxis.title);
    else
      g.append("text").attr("x", -left).attr("y", -12 * s).attr("fill", theme.muted).attr("font-size", fs).attr("font-weight", 700).attr("font-family", font).text(yAxis.title);
  }

  // ---- marques
  const gm = g.append("g").attr("class", "r4d-marks");
  const fmtV = norme ? yFmt : valueFormatter(yAxis);
  // Mode norme : style de notation par série (réel plein, N-1 gris, budget contour, prévision hachurée)
  const hatchUrl = norme && codes.includes("FC") ? hatchPattern(gm, scenarioStyle("AC", theme).ink, s) : "";
  const scn = (si: number) => (norme && codes[si] ? scenarioStyle(codes[si]!, theme, hatchUrl) : null);
  const revealFactor = (i: number) => {
    if (reveal == null) return 1;
    if (i <= Math.floor(reveal)) return 1;
    if (i === Math.floor(reveal) + 1) return reveal - Math.floor(reveal);
    return 0;
  };

  if (bars) {
    const { y0, y1 } = stacked ? stackValues(model.values, normalize) : { y0: [], y1: [] };
    const inner = scaleBand<number>()
      .domain(model.series.map((_, i) => i))
      .range([0, band.bandwidth()])
      .paddingInner(grouped && nS > 1 ? 0.08 : 0);
    const labels: { x: number; y: number; text: string; anchor: string; inside: boolean; color: string; bold?: boolean }[] = [];
    const greyFocus = focusGrey(theme);
    const bft = focusK != null ? easeInOut(focusProgress(frame)) : 0;
    const placed: { k: number; c0: number; thick: number; pa: number; pb: number; raw: number; full: boolean; color: string }[] = [];
    const capR = (thick: number) => Math.max(8 * s, Math.min(18 * s, thick * 0.34));
    for (let si = 0; si < (goal ? 1 : nS); si++) {
      const baseColor = colors[si % colors.length]!;
      for (let k = 0; k < nK; k++) {
        const color = focusK != null && k !== focusK ? mixHex(baseColor, greyFocus, bft) : baseColor;
        const raw = model.values[si]![k]!;
        if (!Number.isFinite(raw)) continue;
        const f = stagger(build, k, nK) * revealFactor(k);
        if (f <= 0) continue;
        let a: number;
        let b: number;
        if (stacked) {
          a = y0[si]![k]!;
          b = y1[si]![k]!;
          const sh = a + (b - a) * f;
          b = sh;
          a = y0[si]![k]! * f;
          b = a + (y1[si]![k]! - y0[si]![k]!) * f;
        } else {
          a = base;
          b = V.log ? Math.exp(Math.log(Math.max(base, 1e-12)) + (Math.log(Math.max(raw, 1e-12)) - Math.log(Math.max(base, 1e-12))) * f) : base + (raw - base) * f;
          if (V.log && raw <= 0) continue;
        }
        const pa = v(a);
        const pb = v(b);
        const off = grouped && !stacked ? inner(si)! : 0;
        const thick = grouped && !stacked ? inner.bandwidth() : band.bandwidth();
        const c0 = band(k)! + off;
        const rx = Math.min(3 * s, thick / 6);
        const r = horizontal
          ? gm.append("rect").attr("x", Math.min(pa, pb)).attr("y", c0).attr("width", Math.abs(pb - pa)).attr("height", thick)
          : gm.append("rect").attr("x", c0).attr("y", Math.min(pa, pb)).attr("width", thick).attr("height", Math.abs(pb - pa));
        r.attr("fill", color).attr("rx", stacked ? 0 : rx);
        if (deco.cap === "picto") r.attr("fill-opacity", 0.1);
        if (focusK === k) r.attr("class", "r4d-focus-bar");
        if (!grouped && nS === 1) r.attr("data-focus-key", model.labels[k]!);
        if (deco.cap !== "none" || focusK != null) placed.push({ k, c0, thick, pa, pb, raw, full: f >= 1, color });
        if (stacked) r.attr("stroke", theme.bg).attr("stroke-width", Math.max(0.5, 1 * s));
        const st = scn(si);
        if (st) r.attr("class", `r4d-scn r4d-scn-${st.code}`).attr("data-scenario", st.code).attr("fill", st.fill).attr("stroke", st.stroke).attr("stroke-width", st.stroke === "none" ? 0 : 1.5 * s).attr("rx", 0);
        tip(r, cellTip(model, k, si, fmtV(raw), st?.code ?? null));
        if (spec.style.valueLabels && f >= 1) {
          const valTxt = normalize ? valueFormatter({ unit: "pct", unitCustom: "", decimals: 0 })(b - a) : fmtV(raw);
          if (stacked) {
            const len = Math.abs(pb - pa);
            const tw = measure(valTxt, 11 * s, font);
            if ((horizontal ? len > tw + 8 * s && thick > 12 * s : len > 15 * s && thick > tw + 4 * s))
              labels.push({ x: horizontal ? (pa + pb) / 2 : c0 + thick / 2, y: horizontal ? c0 + thick / 2 : (pa + pb) / 2, text: valTxt, anchor: "middle", inside: true, color });
          } else if (nK * nS <= 60) {
            const hasCap = (deco.cap === "icon" && !!deco.icons[k]) || (goal && Number.isFinite(model.values[1]?.[k] ?? NaN));
            const off = hasCap ? capR(thick) + 3 * s : deco.cap === "picto" ? 5 * s : 0;
            const tv = goal ? model.values[1]?.[k] : undefined;
            const text = goal && tv && Number.isFinite(tv) && tv > 0 ? `${valTxt} · ${Math.round((raw / tv) * 100)} %` : valTxt;
            const len = Math.abs(pb - pa);
            if (focusK != null && k !== focusK && !hasCap && len > (horizontal ? measure(valTxt, 11 * s, font) + 12 * s : 22 * s) && thick > (horizontal ? 13 * s : measure(valTxt, 11 * s, font) + 4 * s))
              // mode focus : valeurs des autres barres dans la barre (gris), la barre mise en avant garde la sienne au-dessus
              labels.push(horizontal ? { x: pb - 6 * s, y: c0 + thick / 2, text, anchor: "end", inside: true, color } : { x: c0 + thick / 2, y: pb + 14 * s, text, anchor: "middle", inside: true, color });
            else if (goal && tv != null && Number.isFinite(tv) && raw >= base && tv >= base) {
              // objectif : l'étiquette passe au-delà du repère s'il dépasse la barre (pas de trait sur le texte)
              const tp = v(tv);
              labels.push(
                horizontal
                  ? { x: Math.max(pb + off, tp + 3 * s) + 6 * s, y: c0 + thick / 2, text, anchor: "start", inside: false, color }
                  : { x: c0 + thick / 2, y: Math.min(pb - off, tp - 3 * s) - 7 * s, text, anchor: "middle", inside: false, color }
              );
            } else
              labels.push(
                horizontal
                  ? { x: pb + (raw >= base ? 6 * s + off : -6 * s - off), y: c0 + thick / 2, text, anchor: raw >= base ? "start" : "end", inside: false, color, bold: focusK === k }
                  : { x: c0 + thick / 2, y: pb + (raw >= base ? -7 * s - off : 14 * s + off), text, anchor: "middle", inside: false, color, bold: focusK === k }
              );
          }
        }
      }
    }
    if (placed.length) drawBarDeco(gm, g, { ctx, deco, placed, horizontal, capR, v, base, pw, ph, fmt: fmtDeco, model, callout, callFs, noteFs, callPad });
    const gl = gm.append("g").attr("class", "r4d-value-labels");
    for (const l of labels) {
      gl.append("text")
        .attr("x", l.x)
        .attr("y", l.y)
        .attr("dy", horizontal || l.inside ? "0.35em" : null)
        .attr("text-anchor", l.anchor)
        .attr("font-size", (l.inside ? 11 : l.bold ? 13.5 : 12) * s)
        .attr("font-weight", 700)
        .attr("font-family", font)
        .attr("fill", l.inside ? (!theme.dark && l.color === "#c4c4c8" ? "#27272a" : "#ffffff") : theme.text)
        .attr("font-weight", 700)
        .text(l.text);
    }
  } else {
    // lignes / aires
    const curve = curveOf(spec.style.curve);
    const { y0, y1 } = stacked ? stackValues(model.values, normalize) : { y0: [], y1: [] };
    const clipId = `r4d-clip-${Math.random().toString(36).slice(2, 8)}`;
    let clipW = pw;
    if (reveal != null) {
      const i0 = Math.floor(reveal);
      const fr = reveal - i0;
      const xa = xc(Math.min(i0, nK - 1));
      const xb = i0 + 1 < nK ? xc(i0 + 1) : xa;
      clipW = xa + (xb - xa) * fr + 1;
    }
    clipW *= easeOut(build);
    if (build >= 1 && reveal == null) clipW = pw + 60 * s;
    g.append("clipPath").attr("id", clipId).append("rect").attr("x", -10 * s).attr("y", -20 * s).attr("width", Math.max(0, clipW + 10 * s)).attr("height", ph + 40 * s);
    gm.attr("clip-path", `url(#${clipId})`);
    // mise en avant (étape L) : une série (plusieurs séries) ou un point (série unique)
    const lastOf = (row: number[]) => {
      for (let k = row.length - 1; k >= 0; k--) if (Number.isFinite(row[k]!)) return k;
      return -1;
    };
    const lkind = norme ? null : nS > 1 ? "series" : "linePoint";
    const lfk = lkind === "series" ? resolveFocus(spec.style.focus.key, model.series, model.values.map((row) => row[lastOf(row)] ?? NaN)) : lkind === "linePoint" ? resolveFocus(spec.style.focus.key, model.labels, model.values[0] ?? []) : null;
    const lft = lfk != null ? easeInOut(focusProgress(frame)) : 0;
    const lgrey = focusGrey(theme);
    const lboxes: Rect[] = [];
    for (let si = 0; si < nS; si++) {
      const color0 = colors[si % colors.length]!;
      const color = lkind === "series" && lfk != null && si !== lfk ? mixHex(color0, lgrey, lft) : color0;
      const pts: [number, number, number][] = [];
      for (let k = 0; k < nK; k++) {
        const raw = model.values[si]![k]!;
        if (stacked) pts.push([xc(k), v(y0[si]![k]!), v(y1[si]![k]!)]);
        else if (Number.isFinite(raw) && (!V.log || raw > 0)) pts.push([xc(k), v(base), v(raw)]);
      }
      if (!pts.length) continue;
      if (t === "area" || t === "stackedArea") {
        const ar = d3area<[number, number, number]>().x((d) => d[0]).y0((d) => d[1]).y1((d) => d[2]).curve(curve);
        gm.append("path").attr("d", ar(pts)).attr("fill", color).attr("fill-opacity", stacked ? 0.88 : 0.22).attr("data-focus-key", lkind === "series" ? model.series[si]! : null);
      }
      const ln = d3line<[number, number, number]>().x((d) => d[0]).y((d) => d[2]).curve(curve);
      const st = stacked ? null : scn(si);
      const path = gm.append("path")
        .attr("d", ln(pts))
        .attr("fill", "none")
        .attr("stroke", stacked ? theme.bg : st ? st.ink : color)
        .attr("stroke-width", (stacked ? 1.2 : st?.code === "AC" ? 3 : 2.6) * s + (lkind === "series" && si === lfk && !stacked ? 1.2 * s * lft : 0))
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round");
      if (lkind === "series") path.attr("data-focus-key", model.series[si]!).attr("class", si === lfk ? "r4d-focus-series" : null);
      if (st) path.attr("class", `r4d-scn r4d-scn-${st.code}`).attr("data-scenario", st.code).attr("stroke-dasharray", st.dash ? st.dash.split(" ").map((v) => Number(v) * s).join(" ") : null);
      if (!stacked && pts.length <= 60) {
        model.values[si]!.forEach((raw, k) => {
          if (!Number.isFinite(raw) || (V.log && raw <= 0)) return;
          const st = scn(si);
          const dimP = lkind === "linePoint" && lfk != null && k !== lfk ? 1 - 0.7 * lft : 1;
          if (lfk != null) lboxes.push({ x: xc(k) - 6 * s, y: v(raw) - 6 * s, w: 12 * s, h: 12 * s });
          gm.append("circle")
            .attr("data-focus-key", lkind === "series" ? model.series[si]! : model.labels[k]!)
            .attr("opacity", dimP < 1 ? dimP : null)
            .attr("cx", xc(k))
            .attr("cy", v(raw))
            .attr("r", 3.4 * s)
            .attr("fill", st ? (st.code === "AC" || st.code === "PY" ? st.fill : theme.bg) : color)
            .attr("stroke", st && (st.code === "PL" || st.code === "FC") ? st.ink : theme.bg)
            .attr("stroke-width", 1.5 * s)
            .call((c) => tip(c, cellTip(model, k, si, fmtV(raw), st?.code ?? null)));
        });
      }
      if (spec.style.valueLabels && !stacked && pts.length <= 24) {
        model.values[si]!.forEach((raw, k) => {
          if (!Number.isFinite(raw)) return;
          const tv = fmtV(raw);
          const dimL = lfk != null && ((lkind === "series" && si !== lfk) || (lkind === "linePoint" && k !== lfk)) ? 1 - 0.6 * lft : 1;
          if (lfk != null) lboxes.push({ x: xc(k) - measure(tv, 11 * s, font, 700) / 2, y: v(raw) - 20 * s, w: measure(tv, 11 * s, font, 700), h: 14 * s });
          gm.append("text").attr("x", xc(k)).attr("y", v(raw) - 9 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).attr("opacity", dimL < 1 ? dimL : null).text(tv);
        });
      }
    }
    if (lfk != null && lft > 0 && build >= 1 && (reveal == null || reveal >= nK - 1)) {
      // point d'ancrage : le point choisi (série unique) ou le dernier point de la série choisie
      const si = lkind === "series" ? lfk : 0;
      const row = model.values[si]!;
      const k = lkind === "series" ? lastOf(row) : lfk;
      const raw = row[k] ?? NaN;
      if (k >= 0 && Number.isFinite(raw)) {
        const px = xc(k);
        const py = stacked ? v(y1[si]![k]!) : v(raw);
        const accent = theme.dark ? "#3FA7C4" : "#0E6E8C";
        const halo = 10 * s;
        if (lkind === "linePoint") {
          g.append("circle").attr("class", "r4d-focus-halo").attr("pointer-events", "none").attr("cx", px).attr("cy", py).attr("r", halo).attr("fill", accent).attr("fill-opacity", 0.16 * lft).attr("stroke", accent).attr("stroke-width", 2 * s).attr("stroke-opacity", lft);
        }
        const fmtA = valueFormatter(yAxis);
        const additive = (spec.encoding.aggregate === "sum" || spec.encoding.aggregate === "count") && !/%\s*$/.test(fmtA(1));
        const tx =
          lkind === "series"
            ? focusTexts(`${model.series[si]!} (${model.labels[k]!})`, raw, model.values.map((r) => r[k] ?? NaN), si, fmtA, spec.style.focus, additive)
            : focusTexts(model.labels[k]!, raw, row, k, fmtA, spec.style.focus, false);
        const call = makeCallout(tx, s, font, Math.min(pw * 0.42, 300 * s));
        const target = { x: px - halo, y: py - halo, w: 2 * halo, h: 2 * halo };
        // la bulle évite aussi le tracé de la série mise en avant (points intermédiaires des segments)
        const yAt = (j: number) => (stacked ? v(y1[si]![j]!) : v(row[j] ?? NaN));
        const seg: Rect[] = [];
        for (let j = 0; j + 1 < nK; j++) {
          const ya = yAt(j);
          const yb = yAt(j + 1);
          if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
          for (const f of [0.25, 0.5, 0.75]) seg.push({ x: xc(j) + (xc(j + 1) - xc(j)) * f - 4 * s, y: ya + (yb - ya) * f - 4 * s, w: 8 * s, h: 8 * s });
        }
        const box = placeCallout(call, target, { x: 0, y: 0, w: pw, h: ph }, [...lboxes, ...seg], 22 * s);
        const to = { x: px + Math.sign(box.x + box.w / 2 - px || 1) * halo * 0.7, y: py + Math.sign(box.y + box.h / 2 - py || 1) * halo * 0.7 };
        drawCallout(g, call, box, to, { theme, s, font }, lft);
      }
    }
    // aires empilées (ou séries trop longues pour des marqueurs) : colonne invisible par catégorie, toutes les séries
    if ((stacked || nK > 60) && build >= 1 && reveal == null && !horizontal) {
      const gh = g.append("g").attr("class", "r4d-hits");
      const half = (k: number) => (nK > 1 ? Math.abs(xc(Math.min(k + 1, nK - 1)) - xc(Math.max(k - 1, 0))) / (k === 0 || k === nK - 1 ? 2 : 4) : pw / 2);
      for (let k = 0; k < nK; k++) {
        const vals = model.values.map((row) => row[k]!);
        const tot = vals.reduce((a, x) => a + (Number.isFinite(x) && x > 0 ? x : 0), 0);
        const x0 = Math.max(0, xc(k) - half(k));
        const x1 = Math.min(pw, xc(k) + half(k));
        const rowsK = model.series.map((name, si) => (Number.isFinite(vals[si]!) ? { k: name, v: `${fmtV(vals[si]!)}${tot > 0 && vals[si]! >= 0 && nS > 1 ? ` · ${shareRow(vals[si]!, tot)!.v}` : ""}` } : null));
        tip(gh.append("rect").attr("class", "r4d-hit").attr("x", x0).attr("y", 0).attr("width", Math.max(1, x1 - x0)).attr("height", ph).attr("fill", "transparent"), {
          t: model.labels[k]!,
          sub: nS > 1 ? "Total (toutes séries)" : model.series[0],
          v: fmtV(nS > 1 ? tot : vals[0]!),
          rows: tipRows(...rowsK),
        });
      }
    }
  }

  // ---- axe Y secondaire (ligne)
  if (hasY2 && model.y2 && y2probe) {
    const Y2 = valueScale(spec.axes.y2, y2ext, horizontal ? [0, pw] : [ph, 0], false);
    const y2col = y2Color(nS, colors, theme.text);
    if (spec.axes.y2.show && !horizontal) {
      const ga = g.append("g").attr("class", "r4d-axis r4d-axis-y2").attr("transform", `translate(${pw},0)`);
      const ax = (axisRight(Y2.scale) as Axis<number>)
        .tickValues(y2Ticks.filter((tv) => tv >= Math.min(...(Y2.scale.domain() as number[])) - 1e-9 && tv <= Math.max(...(Y2.scale.domain() as number[])) + 1e-9))
        .tickFormat((d) => y2Fmt(Number(d)))
        .tickSize(0)
        .tickPadding(8 * s);
      ga.call(ax as never);
      styleAxis(ga, ctx, true);
      ga.selectAll("text").attr("fill", y2col);
      if (spec.axes.y2.grid) {
        for (const tv of y2Ticks) g.insert("line", ".r4d-marks").attr("x1", 0).attr("x2", pw).attr("y1", Y2.scale(tv) as number).attr("y2", Y2.scale(tv) as number).attr("stroke", theme.grid).attr("stroke-dasharray", `${3 * s} ${3 * s}`);
      }
      if (spec.axes.y2.title)
        g.append("text").attr("x", pw + right).attr("y", -12 * s).attr("text-anchor", "end").attr("fill", y2col).attr("font-size", fs).attr("font-weight", 700).attr("font-family", font).text(spec.axes.y2.title);
    }
    const pts: [number, number, number][] = [];
    model.y2.forEach((val, k) => {
      if (!Number.isFinite(val) || (Y2.log && val <= 0)) return;
      const f = Math.min(stagger(build, k, nK), revealFactor(k) > 0 ? 1 : 0);
      if (f <= 0) return;
      pts.push([xc(k), Y2.scale(val) as number, k]);
    });
    const gy2 = g.append("g").attr("class", "r4d-y2");
    if (pts.length) {
      const ln = d3line<[number, number, number]>().x((d) => (horizontal ? d[1] : d[0])).y((d) => (horizontal ? d[0] : d[1])).curve(curveOf(spec.style.curve));
      gy2.append("path").attr("d", ln(pts)).attr("fill", "none").attr("stroke", y2col).attr("stroke-width", 2.4 * s).attr("stroke-dasharray", bars ? null : `${7 * s} ${4 * s}`).attr("stroke-linejoin", "round");
      const fmt2 = valueFormatter(spec.axes.y2);
      for (const [x, y, k] of pts) {
        gy2.append("circle").attr("cx", horizontal ? y : x).attr("cy", horizontal ? x : y).attr("r", 4 * s).attr("fill", theme.bg).attr("stroke", y2col).attr("stroke-width", 2 * s)
          .call((c) => tip(c, { t: model.labels[k]!, sub: model.y2Name, v: fmt2(model.y2![k]!) }));
      }
    }
  }
  void unitSuffix;
  void clamp01;
}

/* ===================================================================== */

/** Couleur de la série de l'axe Y secondaire : 2e couleur de la palette s'il n'y a qu'une série, sinon neutre (évite les doublons). */
export function y2Color(nSeries: number, colors: string[], neutral: string): string {
  if (nSeries <= 1) return colors.length > 1 ? colors[1]! : colors[0]!;
  return nSeries < colors.length - 1 ? colors[nSeries]! : neutral;
}

export function drawScatter(root: G, rect: PlotRect, ctx: DrawCtx, model: PointModel): void {
  const { spec, theme, s, font, colors, frame, prep } = ctx;
  const fs = 13 * s;
  const xAxis = spec.axes.x;
  const yAxis = spec.axes.y;
  const pts = model.points;
  const ys = pts.map((p) => p.y);
  const yExt: [number, number] = prep.domains.y ?? (ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1]);
  const nTicks = Math.max(2, Math.round(rect.h / (56 * s)));
  const probe = valueScale(yAxis, yExt, [0, 1], false);
  const yTicks = ticksFor(probe.scale, probe.log, nTicks);
  // Mode norme : unité dans le sous-titre (pas sur chaque graduation), décimales identiques partout
  const norme = normeActive(ctx);
  const yFmt = norme
    ? valueFormatter({ ...yAxis, decimals: yAxis.decimals ?? normeDecimals(yAxis) }, probe.log ? undefined : stepOf(yTicks), { suffix: false })
    : valueFormatter(yAxis, probe.log ? undefined : stepOf(yTicks));
  const titleRow = yAxis.title && yAxis.show ? 22 * s : 0;
  const left = yAxis.show ? Math.max(...yTicks.map((v) => measure(yFmt(v), fs, font)), 10) + 12 * s : 8 * s;
  const bottom = (xAxis.show ? fs + 14 * s : 6 * s) + (xAxis.title && xAxis.show ? 24 * s : 0);
  const right = 14 * s;
  const pw = Math.max(20, rect.w - left - right);
  const ph = Math.max(20, rect.h - titleRow - bottom);
  const g = root.append("g").attr("transform", `translate(${rect.x + left},${rect.y + titleRow})`);

  const Y = valueScale(yAxis, yExt, [ph, 0], false);
  let xpos: (p: { x: number | string }) => number;
  let xAxisGen: Axis<never> | null = null;
  let xGridTicks: number[] = [];
  if (model.xKind === "band") {
    const sc = scalePoint<string>().domain(model.xCategories).range([0, pw]).padding(0.5);
    xpos = (p) => sc(String(p.x)) ?? 0;
    xAxisGen = axisBottom(sc).tickSizeOuter(0) as unknown as Axis<never>;
    xGridTicks = model.xCategories.map((c) => sc(c)!);
  } else if (model.xKind === "time") {
    const xs = pts.map((p) => p.x as number);
    const dom = prep.domains.x ?? (xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1]);
    const sc = scaleUtc().domain([new Date(dom[0]), new Date(dom[1] === dom[0] ? dom[0] + 86400000 : dom[1])]).range([0, pw]).nice();
    xpos = (p) => sc(new Date(p.x as number));
    const tk = sc.ticks(Math.max(2, Math.round(pw / (110 * s))));
    xAxisGen = axisBottom(sc).tickValues(tk).tickFormat((d, i) => timeTickFormat(d as Date, i)) as unknown as Axis<never>;
    xGridTicks = tk.map((d) => sc(d));
  } else {
    const xs = pts.map((p) => p.x as number);
    const dom = prep.domains.x ?? ((xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1]) as [number, number]);
    const X = valueScale(xAxis, dom, [0, pw], false);
    xpos = (p) => X.scale(X.log ? Math.max(p.x as number, X.scale.domain()[0] as number) : (p.x as number)) as number;
    const tk = ticksFor(X.scale, X.log, Math.max(2, Math.round(pw / (110 * s))));
    const f = valueFormatter(xAxis, X.log ? undefined : stepOf(tk));
    xAxisGen = (axisBottom(X.scale) as Axis<number>).tickValues(tk).tickFormat((d) => f(Number(d))) as unknown as Axis<never>;
    xGridTicks = tk.map((d) => X.scale(d) as number);
  }

  const gGrid = g.append("g").attr("class", "r4d-grid");
  if (yAxis.grid) for (const tv of yTicks) gGrid.append("line").attr("x1", 0).attr("x2", pw).attr("y1", Y.scale(tv) as number).attr("y2", Y.scale(tv) as number);
  if (xAxis.grid) for (const p of xGridTicks) gGrid.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph);
  gGrid.selectAll("line").attr("stroke", theme.grid).attr("shape-rendering", "crispEdges");

  if (yAxis.show) {
    const ga = g.append("g").attr("class", "r4d-axis r4d-axis-y").call((axisLeft(Y.scale) as Axis<number>).tickValues(yTicks).tickFormat((d) => yFmt(Number(d))).tickSize(0).tickPadding(8 * s) as never);
    styleAxis(ga, ctx, true);
    if (yAxis.title) g.append("text").attr("x", -left).attr("y", -12 * s).attr("fill", theme.muted).attr("font-size", fs).attr("font-weight", 700).attr("font-family", font).text(yAxis.title);
  }
  if (xAxis.show && xAxisGen) {
    const ga = g.append("g").attr("class", "r4d-axis r4d-axis-x").attr("transform", `translate(0,${ph})`).call(xAxisGen.tickSizeInner(5 * s).tickPadding(6 * s) as never);
    styleAxis(ga, ctx);
    if (xAxis.title) g.append("text").attr("x", pw / 2).attr("y", ph + bottom - 6 * s).attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-size", fs).attr("font-weight", 700).attr("font-family", font).text(xAxis.title);
  }

  const sizes = pts.map((p) => p.size).filter((v): v is number => v != null && v > 0);
  const sizeDom = prep.domains.size ?? (sizes.length ? [0, Math.max(...sizes)] : null);
  const R = sizeDom ? scaleSqrt().domain([0, sizeDom[1] || 1]).range([2.5 * s, 30 * s]) : null;
  const baseR = (pts.length > 400 ? 3.2 : pts.length > 120 ? 4.5 : 6.5) * s;
  const fmtY = valueFormatter(yAxis);
  const gm = g.append("g").attr("class", "r4d-marks");
  const order = [...pts.keys()].sort((a, b) => (pts[b]!.size ?? 0) - (pts[a]!.size ?? 0));
  const showLabels = pts.length <= 30 && spec.encoding.label;
  // mise en avant (étape L) : halo autour du point choisi, les autres s'estompent, libellé + bulle reliée
  const fk = resolveFocus(spec.style.focus.key, pts.map(pointKey), pts.map((p) => (Y.log && p.y <= 0 ? NaN : p.y)));
  const ft = fk != null ? easeInOut(focusProgress(frame)) : 0;
  const dimK = 1 - 0.75 * ft;
  const boxes: Rect[] = [];
  let fp: { cx: number; cy: number; r: number; color: string; f: number } | null = null;
  // « Forme des points » : ronds, une icône, ou une icône par groupe (« Couleur par »)
  const icons = groupIcons(spec, model.series);
  const grey = focusGrey(theme);
  order.forEach((idx, j) => {
    const p = pts[idx]!;
    if (Y.log && p.y <= 0) return;
    const f = stagger(frame.build, j, order.length, 0.6) * p.w;
    if (f <= 0) return;
    const si = Math.max(0, model.series.indexOf(p.series));
    const color = colors[si % colors.length]!;
    const r0 = (R && p.size != null ? R(Math.max(0, p.size)) : baseR) * Math.min(1, 0.3 + 0.7 * f);
    const icon = icons[si] ?? null;
    const r = icon ? pointIconSize(r0, s) / 2 : r0;
    const cx = xpos(p);
    const cy = Y.scale(p.y) as number;
    const isF = fk === idx;
    const dim = fk != null && !isF ? dimK : 1;
    if (fk != null) boxes.push({ x: cx - r - 2 * s, y: cy - r - 2 * s, w: 2 * r + 4 * s, h: 2 * r + 4 * s });
    if (isF) fp = { cx, cy, r, color, f };
    const tipData: TipData = { t: p.label || p.series, sub: p.label && model.series.length > 1 ? p.series : undefined, v: fmtY(p.y), rows: tipRows(spec.encoding.x ? { k: spec.encoding.x, v: typeof p.x === "number" ? (model.xKind === "time" ? new Date(p.x).toLocaleDateString("fr-FR") : p.x.toLocaleString("fr-FR")) : p.x } : null, spec.encoding.y[0] ? { k: spec.encoding.y[0], v: fmtY(p.y) } : null, p.size != null && spec.encoding.size ? { k: spec.encoding.size, v: p.size.toLocaleString("fr-FR") } : null) };
    if (icon) {
      // icône : couleur du groupe ; mise en avant : les autres passent au gris
      const col = fk != null && !isF ? mixHex(color, grey, ft) : color;
      const ig = drawIcon(gm, icon, cx, cy, 2 * r, col, isF ? "r4d-point-icon r4d-focus-point" : "r4d-point-icon", true);
      if (ig) {
        ig.attr("data-focus-key", pointKey(p)).attr("opacity", f * (fk != null && !isF ? 1 - 0.3 * ft : 1));
        ig.insert("rect", ":first-child").attr("width", 256).attr("height", 256).attr("fill", "transparent");
        ig.select("path").attr("stroke", theme.bg).attr("stroke-width", (1.2 * s * 256) / (2 * r)).attr("paint-order", "stroke");
        ig.call((c) => tip(c as never, tipData));
      }
    } else
      gm.append("circle")
        .attr("class", isF ? "r4d-focus-point" : null)
        .attr("data-focus-key", pointKey(p))
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", r)
        .attr("fill", color)
        .attr("fill-opacity", 0.78 * f * dim)
        .attr("stroke", theme.dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)")
        .attr("stroke-opacity", f * dim)
        .attr("stroke-width", 0.8 * s)
        .call((c) => tip(c, tipData));
    if (showLabels && p.label && !(isF && ft > 0)) {
      gm.append("text").attr("x", cx + r + 4 * s).attr("y", cy).attr("dy", "0.35em").attr("font-size", 11.5 * s).attr("font-family", font).attr("fill", theme.text).attr("fill-opacity", f * dim).text(p.label);
      if (fk != null) boxes.push({ x: cx + r + 4 * s, y: cy - 8 * s, w: measure(p.label, 11.5 * s, font), h: 16 * s });
    }
  });
  const fpt = fp as { cx: number; cy: number; r: number; color: string; f: number } | null;
  if (fk != null && fpt && ft > 0) {
    const p = pts[fk]!;
    const accent = theme.dark ? "#3FA7C4" : "#0E6E8C";
    const halo = fpt.r + 7 * s;
    const gf = g.append("g").attr("class", "r4d-focus-halo").attr("pointer-events", "none");
    gf.append("circle").attr("cx", fpt.cx).attr("cy", fpt.cy).attr("r", halo).attr("fill", accent).attr("fill-opacity", 0.16 * ft).attr("stroke", accent).attr("stroke-width", 2 * s).attr("stroke-opacity", ft);
    const name = p.label || p.series || p.key;
    const lx = fpt.cx + halo + 5 * s;
    const lw = measure(name, 13 * s, font, 700);
    const right = lx + lw <= pw;
    gf.append("text").attr("class", "r4d-focus-label").attr("x", right ? lx : fpt.cx - halo - 5 * s).attr("y", fpt.cy).attr("dy", "0.35em").attr("text-anchor", right ? "start" : "end").attr("font-size", 13 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).attr("fill-opacity", ft).text(name);
    if (fpt.f >= 1) {
      const lab = { x: right ? lx : fpt.cx - halo - 5 * s - lw, y: fpt.cy - 9 * s, w: lw, h: 18 * s };
      const call = makeCallout(focusTexts(name, p.y, pts.map((q) => q.y), fk, fmtY, spec.style.focus, false), s, font, Math.min(pw * 0.42, 300 * s));
      const target = { x: fpt.cx - halo, y: fpt.cy - halo, w: 2 * halo, h: 2 * halo };
      const box = placeCallout(call, target, { x: 0, y: 0, w: pw, h: ph }, [...boxes, lab], 22 * s);
      const to = { x: fpt.cx + Math.sign(box.x + box.w / 2 - fpt.cx || 1) * halo * 0.7, y: fpt.cy + Math.sign(box.y + box.h / 2 - fpt.cy || 1) * halo * 0.7 };
      drawCallout(g, call, box, to, { theme, s, font }, ft);
    }
  }
}

/* ------------------------------------------------------------------ barres racontées (étape I) */

interface DecoArgs {
  ctx: DrawCtx;
  deco: import("./barDeco").BarDeco;
  placed: { k: number; c0: number; thick: number; pa: number; pb: number; raw: number; full: boolean; color: string }[];
  horizontal: boolean;
  capR: (thick: number) => number;
  v: (x: number) => number;
  base: number;
  pw: number;
  ph: number;
  fmt: (v: number) => string;
  model: CatModel;
  callout: { title: string[]; note: string[]; w: number; h: number; icon: string | null; avg: number | null } | null;
  callFs: number;
  noteFs: number;
  callPad: number;
}

/**
 * Fenêtre de `rows` barres consécutives où poser l'annotation (barres horizontales) : la plus petite valeur maximale,
 * puis la plus proche de la barre mise en avant.
 */
export function calloutWindow(values: number[], focusK: number, rows: number): { start: number; max: number } {
  const v = values.map((x) => (Number.isFinite(x) ? Math.max(0, x) : 0));
  const r = Math.max(1, Math.min(v.length, rows));
  let best = { start: 0, max: Infinity, d: Infinity };
  for (let w = 0; w + r <= v.length; w++) {
    const m = Math.max(...v.slice(w, w + r));
    const d = Math.abs(w + r / 2 - (focusK + 0.5));
    if (m < best.max * 0.97 || (m <= best.max * 1.03 && d < best.d)) best = { start: w, max: Math.min(m, best.max), d };
  }
  return { start: best.start, max: Number.isFinite(best.max) ? best.max : 0 };
}

/** Pictogrammes, pastilles d'icône, repères d'objectif (sous les étiquettes), puis annotation et moyenne (au-dessus). */
function drawBarDeco(gm: G, g: G, a: DecoArgs): void {
  const { ctx, deco, placed, horizontal: hz, capR, v, base, pw, ph, fmt, model } = a;
  const { theme, s, font, spec } = ctx;
  const gd = gm.append("g").attr("class", "r4d-bar-deco");
  const at = (p: { c0: number; thick: number }, along: number) => (hz ? { x: along, y: p.c0 + p.thick / 2 } : { x: p.c0 + p.thick / 2, y: along });

  if (deco.cap === "picto") {
    const max = Math.max(...placed.map((p) => p.raw), 0);
    const thick = placed[0]?.thick ?? 20 * s;
    const lenMax = Math.abs(v(max) - v(base));
    // isotype : icônes pleines, jointives, de taille fixe ; l'unité (1, 2 ou 5 × 10ⁿ) en découle
    const want = Math.max(10 * s, Math.min(thick * 0.82, 30 * s));
    const target = Math.max(3, Math.min(24, Math.floor(lenMax / (want * 1.12))));
    const u = pictoUnit(max - base, target);
    const step = Math.abs(v(base + u) - v(base));
    const size = Math.min(want, step * 0.92);
    const uid = Math.random().toString(36).slice(2, 8);
    const one = (gg: G, icon: string | null, cx: number, cy: number, color: string) => {
      if (icon) drawIcon(gg, icon, cx, cy, size, color, "r4d-picto", true);
      else gg.append("circle").attr("class", "r4d-picto").attr("cx", cx).attr("cy", cy).attr("r", size * 0.38).attr("fill", color);
    };
    for (const p of placed) {
      const n = (p.raw - base) / u;
      if (!(n > 0)) continue;
      const icon = deco.icons[p.k] ?? null;
      for (let j = 0; j < Math.ceil(n - 1e-6); j++) {
        const c = at(p, v(base + (j + 0.5) * u));
        const frac = Math.min(1, n - j);
        if (frac < 0.12) continue; // reste trop petit pour être lisible : la barre pâle porte la valeur exacte
        if (frac >= 0.999) one(gd, icon, c.x, c.y, p.color);
        else {
          // dernière icône coupée à la valeur exacte (sens de lecture)
          const id = `r4d-pc-${uid}-${p.k}`;
          const lo = hz ? c.x - size / 2 : c.y + size / 2;
          const cut = lo + (hz ? size * frac : -size * frac);
          gd.append("clipPath").attr("id", id).append("rect").attr("x", hz ? lo : c.x - size).attr("y", hz ? c.y - size : cut).attr("width", hz ? size * frac : size * 2).attr("height", hz ? size * 2 : size * frac);
          one(gd.append("g").attr("clip-path", `url(#${id})`), icon, c.x, c.y, p.color);
        }
      }
    }
    // clé : « ● = 10 k€ » en haut à droite du tracé
    const keyIcon = deco.icons.find(Boolean) ?? null;
    const txt = `= ${fmt(u)}`;
    const kfs = 12 * s;
    const kw = measure(txt, kfs, font, 700);
    const gk = g.append("g").attr("class", "r4d-picto-key");
    const kx = pw - kw;
    const ky = hz ? ph - 10 * s : 10 * s;
    if (keyIcon) drawIcon(gk, keyIcon, kx - 12 * s, ky, 16 * s, theme.text, "r4d-picto", true);
    else gk.append("circle").attr("cx", kx - 12 * s).attr("cy", ky).attr("r", 5.5 * s).attr("fill", theme.text);
    gk.append("text").attr("x", kx).attr("y", ky).attr("dy", "0.35em").attr("font-size", kfs).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(txt);
  }

  if (deco.cap === "icon" || deco.cap === "goal") {
    for (const p of placed) {
      if (!p.full) continue;
      const r = capR(p.thick);
      const c = at(p, p.pb);
      if (deco.cap === "goal") {
        const tv = model.values[1]?.[p.k];
        if (tv == null || !Number.isFinite(tv)) continue;
        const good = isGood(p.raw - tv, spec.variance.polarity === "lower");
        const col = good ? VARIANCE_POS : VARIANCE_NEG;
        const tp = v(tv);
        const m = hz
          ? gd.append("line").attr("x1", tp).attr("x2", tp).attr("y1", p.c0 - 4 * s).attr("y2", p.c0 + p.thick + 4 * s)
          : gd.append("line").attr("x1", p.c0 - 4 * s).attr("x2", p.c0 + p.thick + 4 * s).attr("y1", tp).attr("y2", tp);
        m.attr("class", "r4d-goal-mark").attr("stroke", theme.text).attr("stroke-width", 2.5 * s).attr("stroke-linecap", "round");
        tip(m, { t: model.labels[p.k] ?? "", sub: model.series[1] ?? "Objectif", v: fmt(tv), rows: [] } as TipData);
        const gc = gd.append("g").attr("class", "r4d-cap r4d-goal-cap").attr("data-goal", good ? "atteint" : "manque");
        gc.append("circle").attr("cx", c.x).attr("cy", c.y).attr("r", r).attr("fill", col).attr("stroke", theme.bg).attr("stroke-width", 1.5 * s);
        drawIcon(gc, good ? "check" : "warning", c.x, c.y, r * 1.15, "#ffffff");
      } else {
        const icon = deco.icons[p.k];
        if (!icon) continue;
        const gc = gd.append("g").attr("class", "r4d-cap");
        gc.append("circle").attr("cx", c.x).attr("cy", c.y).attr("r", r).attr("fill", theme.bg).attr("stroke", p.color).attr("stroke-width", 2 * s);
        drawIcon(gc, icon, c.x, c.y, r * 1.15, p.color === "#4a4a52" || p.color === "#c4c4c8" ? theme.muted : p.color);
      }
    }
  }

  // ---- barre mise en avant : libellé de catégorie en gras, moyenne des autres, annotation reliée
  const fp = deco.focusK != null ? placed.find((p) => p.k === deco.focusK) : undefined;
  if (!fp) return;
  g.selectAll<SVGTextElement, unknown>(`.r4d-axis-x text[data-k="${fp.k}"]`).attr("fill", theme.text).attr("font-weight", 700);
  const co = a.callout;
  if (!co || !fp.full) return;
  const accent = theme.dark ? "#3FA7C4" : "#0E6E8C";
  const fo = focusProgress(ctx.frame);
  if (fo <= 0) return;
  if (spec.style.focus.average && co.avg != null && Number.isFinite(co.avg)) {
    // trait derrière les barres (lisible dans les intervalles, jamais sur une étiquette), libellé devant
    const gl = g.insert("g", ".r4d-marks").attr("class", "r4d-avg r4d-avg-line").attr("opacity", fo < 1 ? fo : null);
    const ga = g.append("g").attr("class", "r4d-avg").attr("opacity", fo < 1 ? fo : null);
    const p = v(co.avg);
    const ln = hz ? gl.append("line").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", ph) : gl.append("line").attr("x1", 0).attr("x2", pw).attr("y1", p).attr("y2", p);
    ln.attr("stroke", theme.muted).attr("stroke-width", 1.2 * s).attr("stroke-dasharray", `${5 * s} ${4 * s}`);
    const lab = `Moyenne des autres : ${fmt(co.avg)}`;
    const lfs = 11.5 * s;
    if (hz) ga.append("text").attr("x", p + 5 * s).attr("y", -6 * s).attr("font-size", lfs).attr("font-family", font).attr("fill", theme.muted).text(lab);
    else {
      // au-dessus de la ligne, sauf si une barre (autre que la mise en avant) dépasse sous l'étiquette
      const lw = measure(lab, lfs, font);
      const clash = placed.some((q) => q.k !== fp.k && q.c0 + q.thick > pw - lw - 4 * s && Math.min(q.pa, q.pb) < p - 2 * s);
      ga.append("text").attr("x", pw).attr("y", clash ? p + 15 * s : p - 6 * s).attr("text-anchor", "end").attr("font-size", lfs).attr("font-family", font).attr("fill", theme.muted).text(lab);
    }
  }
  const gc = g.append("g").attr("class", "r4d-callout").attr("opacity", fo < 1 ? fo : null);
  const end = at(fp, fp.pb);
  let bx: number;
  let by: number;
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  const gap = 26 * s;
  if (!hz) {
    by = 4 * s;
    const right = fp.c0 + fp.thick + gap;
    const left = fp.c0 - gap - co.w;
    if (right + co.w <= pw) {
      bx = right;
      from = { x: bx, y: by + co.h / 2 };
      to = { x: fp.c0 + fp.thick + 3 * s, y: Math.max(end.y + 12 * s, by + co.h + 6 * s) };
    } else if (left >= 0) {
      bx = left;
      from = { x: bx + co.w, y: by + co.h / 2 };
      to = { x: fp.c0 - 3 * s, y: Math.max(end.y + 12 * s, by + co.h + 6 * s) };
    } else {
      bx = Math.max(0, Math.min(pw - co.w, end.x - co.w / 2));
      from = { x: end.x, y: by + co.h };
      to = { x: end.x, y: end.y - 26 * s };
    }
  } else {
    bx = pw - co.w;
    const lw = spec.style.valueLabels ? measure(fmt(fp.raw), 13.5 * s, font, 700) + 10 * s : 0;
    // hauteur : à côté de la barre mise en avant si la place le permet, sinon à hauteur des barres plus courtes
    const hasCap = deco.cap === "icon" || deco.cap === "goal";
    const reach = (q: (typeof placed)[number]) => Math.max(q.pa, q.pb) + (hasCap ? 2 * capR(q.thick) + 10 * s : 0) + (spec.style.valueLabels ? measure(fmt(q.raw), 13.5 * s, font, 700) + 10 * s : 0);
    const fits = (y: number) => placed.every((q) => q.c0 + q.thick < y - 2 * s || q.c0 > y + co.h + 2 * s || reach(q) <= bx - 12 * s);
    const cands = [end.y - co.h / 2, ...placed.flatMap((q) => [q.c0, q.c0 + q.thick - co.h])].map((y) => Math.max(0, Math.min(ph - co.h, y)));
    const ok = cands.filter(fits).sort((p, q) => Math.abs(p + co.h / 2 - end.y) - Math.abs(q + co.h / 2 - end.y));
    by = ok.length ? ok[0] : Math.max(0, Math.min(ph - co.h, end.y - co.h / 2));
    const tipX = end.x + 8 * s + lw;
    if (by > fp.c0 + fp.thick + 2 * s || by + co.h < fp.c0 - 2 * s) {
      // annotation au-dessous (ou au-dessus) de la barre : le lien part du bord du cadre vers l'étiquette de valeur
      const below = by > fp.c0;
      to = { x: Math.min(tipX - lw / 2, pw - 6 * s), y: below ? fp.c0 + fp.thick + 4 * s : fp.c0 - 4 * s };
      from = { x: Math.max(bx + 16 * s, Math.min(bx + co.w - 16 * s, to.x)), y: below ? by : by + co.h };
    } else {
      from = { x: bx, y: by + co.h / 2 };
      // le lien vise la fin de l'étiquette de valeur (jamais par-dessus le chiffre)
      to = { x: tipX, y: end.y };
    }
  }
  if (Math.hypot(to.x - from.x, to.y - from.y) > 8 * s) {
    const mid = hz ? { x: (from.x + to.x) / 2, y: from.y } : { x: to.x, y: from.y };
    gc.append("path")
      .attr("class", "r4d-callout-link")
      .attr("d", `M${from.x},${from.y} Q${mid.x},${mid.y} ${to.x},${to.y}`)
      .attr("fill", "none")
      .attr("stroke", accent)
      .attr("stroke-width", 2 * s);
    gc.append("circle").attr("cx", to.x).attr("cy", to.y).attr("r", 3.5 * s).attr("fill", accent);
  }
  gc.append("rect").attr("x", bx).attr("y", by).attr("width", co.w).attr("height", co.h).attr("rx", 10 * s).attr("fill", theme.dark ? "#0c2a33" : "#eef6f9").attr("stroke", accent).attr("stroke-width", 1.5 * s);
  let tx = bx + a.callPad;
  if (co.icon) {
    drawIcon(gc, co.icon, tx + 11 * s, by + a.callPad + a.callFs * 0.6, 22 * s, accent);
    tx += 34 * s;
  }
  co.title.forEach((l, i) =>
    gc.append("text").attr("class", "r4d-callout-title").attr("x", tx).attr("y", by + a.callPad + a.callFs * 0.85 + i * a.callFs * 1.2).attr("font-size", a.callFs).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(l)
  );
  const ny = by + a.callPad + co.title.length * a.callFs * 1.2 + 5 * s;
  co.note.forEach((l, i) =>
    gc.append("text").attr("class", "r4d-callout-note").attr("x", tx).attr("y", ny + a.noteFs * 0.9 + i * a.noteFs * 1.35).attr("font-size", a.noteFs).attr("font-family", font).attr("fill", theme.muted).text(l)
  );
}
