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
import { normeDecimals, scenarioStyle } from "../norme";
import { ellipsize, measure } from "./text";

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

function seriesTitle(ctx: DrawCtx, key: string, label: string, v: string) {
  return `${key ? key + " · " : ""}${label} : ${v}`;
}

/* ===================================================================== */

export function drawCategorical(root: G, rect: PlotRect, ctx: DrawCtx, model: CatModel): void {
  const { spec, theme, s, font, colors, frame, prep } = ctx;
  const t = spec.type;
  const bars = isBarType(t);
  const horizontal = t === "barH" || (bars && spec.style.horizontal && t !== "bar");
  const stacked = t === "stackedBar" || t === "stackedArea";
  const normalize = stacked && spec.style.normalize;
  const grouped = t === "groupedBar" || (t === "bar" && model.series.length > 1) || (t === "barH" && model.series.length > 1);
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
          ga.append("text").attr("x", -10 * s).attr("y", p).attr("dy", "0.35em").attr("text-anchor", "end").text(text);
        } else if (rotate) {
          ga.append("text")
            .attr("transform", `translate(${p},${ph + 10 * s}) rotate(-38)`)
            .attr("text-anchor", "end")
            .attr("dy", "0.35em")
            .text(text);
        } else {
          ga.append("text").attr("x", p).attr("y", ph + 8 * s + fs * 0.8).attr("text-anchor", "middle").text(text);
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
    const labels: { x: number; y: number; text: string; anchor: string; inside: boolean; color: string }[] = [];
    for (let si = 0; si < nS; si++) {
      const color = colors[si % colors.length]!;
      for (let k = 0; k < nK; k++) {
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
        if (stacked) r.attr("stroke", theme.bg).attr("stroke-width", Math.max(0.5, 1 * s));
        const st = scn(si);
        if (st) r.attr("class", `r4d-scn r4d-scn-${st.code}`).attr("data-scenario", st.code).attr("fill", st.fill).attr("stroke", st.stroke).attr("stroke-width", st.stroke === "none" ? 0 : 1.5 * s).attr("rx", 0);
        r.append("title").text(seriesTitle(ctx, model.labels[k]!, model.series[si]!, fmtV(raw)));
        if (spec.style.valueLabels && f >= 1) {
          const valTxt = normalize ? valueFormatter({ unit: "pct", unitCustom: "", decimals: 0 })(b - a) : fmtV(raw);
          if (stacked) {
            const len = Math.abs(pb - pa);
            const tw = measure(valTxt, 11 * s, font);
            if ((horizontal ? len > tw + 8 * s && thick > 12 * s : len > 15 * s && thick > tw + 4 * s))
              labels.push({ x: horizontal ? (pa + pb) / 2 : c0 + thick / 2, y: horizontal ? c0 + thick / 2 : (pa + pb) / 2, text: valTxt, anchor: "middle", inside: true, color });
          } else if (nK * nS <= 60) {
            labels.push(
              horizontal
                ? { x: pb + (raw >= base ? 6 : -6) * s, y: c0 + thick / 2, text: valTxt, anchor: raw >= base ? "start" : "end", inside: false, color }
                : { x: c0 + thick / 2, y: pb + (raw >= base ? -7 : 14) * s, text: valTxt, anchor: "middle", inside: false, color }
            );
          }
        }
      }
    }
    const gl = gm.append("g").attr("class", "r4d-value-labels");
    for (const l of labels) {
      gl.append("text")
        .attr("x", l.x)
        .attr("y", l.y)
        .attr("dy", horizontal || l.inside ? "0.35em" : null)
        .attr("text-anchor", l.anchor)
        .attr("font-size", (l.inside ? 11 : 12) * s)
        .attr("font-weight", 700)
        .attr("font-family", font)
        .attr("fill", l.inside ? "#ffffff" : theme.text)
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
    for (let si = 0; si < nS; si++) {
      const color = colors[si % colors.length]!;
      const pts: [number, number, number][] = [];
      for (let k = 0; k < nK; k++) {
        const raw = model.values[si]![k]!;
        if (stacked) pts.push([xc(k), v(y0[si]![k]!), v(y1[si]![k]!)]);
        else if (Number.isFinite(raw) && (!V.log || raw > 0)) pts.push([xc(k), v(base), v(raw)]);
      }
      if (!pts.length) continue;
      if (t === "area" || t === "stackedArea") {
        const ar = d3area<[number, number, number]>().x((d) => d[0]).y0((d) => d[1]).y1((d) => d[2]).curve(curve);
        gm.append("path").attr("d", ar(pts)).attr("fill", color).attr("fill-opacity", stacked ? 0.88 : 0.22);
      }
      const ln = d3line<[number, number, number]>().x((d) => d[0]).y((d) => d[2]).curve(curve);
      const st = stacked ? null : scn(si);
      const path = gm.append("path")
        .attr("d", ln(pts))
        .attr("fill", "none")
        .attr("stroke", stacked ? theme.bg : st ? st.ink : color)
        .attr("stroke-width", (stacked ? 1.2 : st?.code === "AC" ? 3 : 2.6) * s)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round");
      if (st) path.attr("class", `r4d-scn r4d-scn-${st.code}`).attr("data-scenario", st.code).attr("stroke-dasharray", st.dash ? st.dash.split(" ").map((v) => Number(v) * s).join(" ") : null);
      if (!stacked && pts.length <= 60) {
        model.values[si]!.forEach((raw, k) => {
          if (!Number.isFinite(raw) || (V.log && raw <= 0)) return;
          const st = scn(si);
          gm.append("circle")
            .attr("cx", xc(k))
            .attr("cy", v(raw))
            .attr("r", 3.4 * s)
            .attr("fill", st ? (st.code === "AC" || st.code === "PY" ? st.fill : theme.bg) : color)
            .attr("stroke", st && (st.code === "PL" || st.code === "FC") ? st.ink : theme.bg)
            .attr("stroke-width", 1.5 * s)
            .append("title")
            .text(seriesTitle(ctx, model.labels[k]!, model.series[si]!, fmtV(raw)));
        });
      }
      if (spec.style.valueLabels && !stacked && pts.length <= 24) {
        model.values[si]!.forEach((raw, k) => {
          if (!Number.isFinite(raw)) return;
          gm.append("text").attr("x", xc(k)).attr("y", v(raw) - 9 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(fmtV(raw));
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
          .append("title").text(`${model.labels[k]} · ${model.y2Name} : ${fmt2(model.y2[k]!)}`);
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
  order.forEach((idx, j) => {
    const p = pts[idx]!;
    if (Y.log && p.y <= 0) return;
    const f = stagger(frame.build, j, order.length, 0.6) * p.w;
    if (f <= 0) return;
    const si = Math.max(0, model.series.indexOf(p.series));
    const color = colors[si % colors.length]!;
    const r = (R && p.size != null ? R(Math.max(0, p.size)) : baseR) * Math.min(1, 0.3 + 0.7 * f);
    const cx = xpos(p);
    const cy = Y.scale(p.y) as number;
    gm.append("circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", r)
      .attr("fill", color)
      .attr("fill-opacity", 0.78 * f)
      .attr("stroke", theme.dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)")
      .attr("stroke-opacity", f)
      .attr("stroke-width", 0.8 * s)
      .append("title")
      .text(`${p.label || p.series} · ${spec.encoding.y[0] ?? ""} : ${fmtY(p.y)}`);
    if (showLabels && p.label)
      gm.append("text").attr("x", cx + r + 4 * s).attr("y", cy).attr("dy", "0.35em").attr("font-size", 11.5 * s).attr("font-family", font).attr("fill", theme.text).attr("fill-opacity", f).text(p.label);
  });
}
