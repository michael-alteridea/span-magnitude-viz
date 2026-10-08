/**
 * Graphique d'écarts normé IBCS / ISO 24896 :
 *  - réel en aplat, référence selon le scénario (budget = contour, N-1 = gris plein, prévision = hachuré) ;
 *  - écarts absolus en barres, relatifs en épingles ; rouge = défavorable, vert = favorable (seul usage de ces couleurs).
 * Catégories → barres horizontales (valeurs | écarts) ; périodes → colonnes (écarts au-dessus, valeurs dessous).
 */
import { scaleBand, scaleLinear } from "d3";
import type { VarianceModel } from "../data/variance";
import { isFavourable } from "../data/variance";
import { valueFormatter } from "../format";
import { VARIANCE_NEG, VARIANCE_POS } from "../theme";
import { stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure } from "./text";
import { formatSignedAmount, formatSignedPct } from "../story/fr";
import { normeDeltaFormatter, normeFormatter, normeInk, scenarioOf, type ScenarioOverrides } from "../norme";
import { hatchPattern } from "./norme";
import { rows as tipRows, tip, toneGood, type TipData } from "./tip";

/** Écarts : montants compacts par valeur (« −320 k€ », « +1,2 M€ »), sinon format de l'axe signé. */
function deltaFormatter(axis: Parameters<typeof valueFormatter>[0]): (v: number) => string {
  if (axis.unit === "eur" || axis.unit === "keur" || axis.unit === "meur") return (v) => formatSignedAmount(v);
  const f = valueFormatter(axis);
  return (v) => (v > 0 ? "+" : "") + f(v).replace(/^-/, "\u2212");
}

export type RefStyle = "outline" | "grey" | "hatch";

/** Style de la référence ; en mode norme, d'après le scénario détecté ou forcé dans les encodages. */
export function refStyleFor(name: string, norme: boolean, overrides: ScenarioOverrides = {}): RefStyle {
  if (!norme) return refStyleOf(name);
  const c = scenarioOf(name, overrides);
  return c === "PY" ? "grey" : c === "FC" ? "hatch" : "outline";
}

export function refStyleOf(name: string): RefStyle {
  if (/n\s*-\s*1|\bpy\b|prior|pr[ée]c[ée]dent|last year/i.test(name)) return "grey";
  if (/pr[ée]vision|forecast|atterrissage|landing|\bfc\b/i.test(name)) return "hatch";
  return "outline";
}

export function refLabelOf(name: string): string {
  const s = refStyleOf(name);
  if (s === "grey") return "N-1";
  if (s === "hatch") return "Prévision";
  if (/budget|plan|objectif|target/i.test(name)) return "Budget";
  return name.replace(/\s*\(.*\)\s*$/, "");
}

function refFill(g: G, ctx: DrawCtx, style: RefStyle): { fill: string; stroke: string; dash: string | null } {
  const { theme, s } = ctx;
  const norme = !!ctx.spec.norme?.enabled;
  const ink = normeInk(theme);
  if (style === "grey") return { fill: norme ? ink.py : theme.dark ? "#52525b" : "#c4c4c8", stroke: "none", dash: null };
  if (style === "hatch") {
    const col = norme ? ink.ac : theme.muted;
    return { fill: hatchPattern(g, col, s), stroke: col, dash: null };
  }
  return { fill: "none", stroke: norme ? ink.ac : theme.text, dash: null };
}

/** Formats : mode norme = sans unité (dans le sous-titre), décimales unifiées. */
function formatters(ctx: DrawCtx) {
  const axis = ctx.spec.axes.y;
  if (ctx.spec.norme?.enabled) return { fmt: normeFormatter(axis), fmtD: normeDeltaFormatter(axis) };
  return { fmt: valueFormatter(axis), fmtD: deltaFormatter(axis) };
}

/** Infobulle d'une ligne d'écart : valeur, référence, écart absolu et relatif coloré selon le sens favorable. */
function rowTip(label: string, actName: string, refName: string, a: number, b: number, d: number, r: number, good: boolean, fmt: (v: number) => string, fmtD: (v: number) => string): TipData {
  return {
    t: label,
    sub: actName,
    v: fmt(a),
    rows: tipRows(
      Number.isFinite(b) ? { k: refName, v: fmt(b) } : null,
      Number.isFinite(d) ? { k: `Écart vs ${refName}`, v: `${fmtD(d)}${Number.isFinite(r) ? ` · ${formatSignedPct(r)}` : ""}`, tone: d === 0 ? "neutral" : toneGood(good) } : null,
    ),
  };
}

/** Épingle d'écart relatif : aiguille + point. */
function pin(g: G, x1: number, y1: number, x2: number, y2: number, col: string, s: number, good: boolean) /* → point (infobulle) */ {
  g.append("line").attr("class", "r4d-variance-needle").attr("x1", x1).attr("x2", x2).attr("y1", y1).attr("y2", y2).attr("stroke", col).attr("stroke-width", 2.4 * s);
  return g.append("circle").attr("class", "r4d-variance-bar r4d-variance-pin").attr("cx", x2).attr("cy", y2).attr("r", 5 * s).attr("fill", col).attr("data-favourable", good ? "1" : "0");
}

export function drawVariance(root: G, rect: PlotRect, ctx: DrawCtx, vm: VarianceModel): void {
  if (vm.xKind === "time") drawColumns(root, rect, ctx, vm);
  else drawRows(root, rect, ctx, vm);
}

/* ---------------------------------------------------------------- catégories */

function drawRows(root: G, rect: PlotRect, ctx: DrawCtx, vm: VarianceModel) {
  const { spec, theme, s, font, colors, frame } = ctx;
  const pol = spec.variance.polarity;
  const rel = spec.variance.show === "rel";
  const { fmt, fmtD } = formatters(ctx);
  const fs = 13 * s;
  const rows = vm.labels.map((l, i) => ({ l, a: vm.actual[i]!, b: vm.ref[i]!, d: vm.delta[i]!, r: vm.rel[i]!, total: false }));
  if (spec.variance.total && rows.length > 1) rows.push({ l: "Total", a: vm.total.actual, b: vm.total.ref, d: vm.total.delta, r: vm.total.rel, total: true });
  const n = rows.length;
  const headH = 26 * s;
  const labW = Math.min(rect.w * 0.26, Math.max(...rows.map((r) => measure(r.l, fs, font, r.total ? 700 : 400))) + 14 * s);
  const avail = rect.w - labW;
  const p1w = avail * 0.44;
  const gap = 28 * s;
  const p2x = rect.x + labW + p1w + gap;
  const p2w = avail - p1w - gap;
  const g = root.append("g").attr("class", "r4d-variance r4d-marks");
  const bandH = Math.min((rect.h - headH) / n, 52 * s);
  const band = scaleBand<number>().domain(rows.map((_, i) => i)).range([rect.y + headH, rect.y + headH + bandH * n]).paddingInner(0.28).paddingOuter(0.1);
  // en-têtes de colonnes
  const refName = refLabelOf(vm.refName);
  const actName = vm.actualName.replace(/\s*\(.*\)\s*$/, "");
  const head = (x: number, t: string, anchor = "start") => g.append("text").attr("class", "r4d-variance-head").attr("x", x).attr("y", rect.y + 14 * s).attr("text-anchor", anchor).attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", theme.muted).attr("letter-spacing", 0.4 * s).text(t);
  head(rect.x + labW, `${actName} · ${refName}`.toUpperCase());
  head(p2x, (rel ? `Δ ${refName} %` : `Δ ${refName}`).toUpperCase());

  // panneau valeurs (réel vs référence)
  const vmax = Math.max(1e-9, ...rows.filter((r) => !r.total || n === 1).map((r) => Math.max(r.a, r.b)), ctx.sharedMax ?? 0);
  const totalScale = rows.some((r) => r.total);
  const xs = scaleLinear().domain([0, vmax]).range([0, p1w - 70 * s]);
  const xsTotal = totalScale ? scaleLinear().domain([0, Math.max(vm.total.actual, vm.total.ref, 1e-9)]).range([0, p1w - 70 * s]) : xs;
  const norme = !!spec.norme?.enabled;
  const rs = refFill(g, ctx, refStyleFor(vm.refName, norme, spec.encoding.scenarios));
  const actColor = norme ? normeInk(theme).ac : colors[0]!;
  // panneau écarts
  const dv = rows.map((r) => (rel ? r.r * 100 : r.d)).filter(Number.isFinite);
  const dNonTot = rows.filter((r) => !r.total).map((r) => (rel ? r.r * 100 : r.d)).filter(Number.isFinite);
  const dmax = Math.max(1e-9, ...dNonTot.map(Math.abs), ...(rel ? dv.map(Math.abs) : []));
  const hasNeg = dv.some((v) => v < 0);
  const hasPos = dv.some((v) => v > 0);
  const labelRoom = 96 * s;
  const lo = hasNeg ? -dmax : 0;
  const hi = hasPos ? dmax : 0;
  const ds = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([p2x + (hasNeg ? labelRoom : 0), p2x + p2w - (hasPos ? labelRoom : 0)]);
  const zero = ds(0);
  g.append("line").attr("x1", zero).attr("x2", zero).attr("y1", rect.y + headH - 4 * s).attr("y2", band(n - 1)! + band.bandwidth() + 4 * s).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);

  rows.forEach((r, i) => {
    const y = band(i)!;
    const h = band.bandwidth();
    const f = stagger(frame.build, i, n);
    if (r.total) g.append("line").attr("x1", rect.x).attr("x2", rect.x + rect.w).attr("y1", y - band.step() * 0.14).attr("y2", y - band.step() * 0.14).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
    g.append("text").attr("class", "r4d-variance-label").attr("x", rect.x + labW - 12 * s).attr("y", y + h / 2).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", fs).attr("font-weight", r.total ? 700 : 400).attr("fill", theme.text).text(ellipsize(r.l, labW - 14 * s, fs, font));
    const sc = r.total ? xsTotal : xs;
    const x0 = rect.x + labW;
    // référence (derrière, décalée)
    const off = h * 0.22;
    const rb = g.append("rect").attr("x", x0 + off * 0.0).attr("y", y + off).attr("width", Math.max(0, sc(r.b) * f)).attr("height", h - off).attr("fill", rs.fill).attr("stroke", rs.stroke).attr("stroke-width", rs.stroke === "none" ? 0 : 1.4 * s);
    tip(rb, rowTip(r.l, actName, refName, r.a, r.b, r.d, r.r, isFavourable(r.d, pol), fmt, fmtD));
    const ab = g.append("rect").attr("class", "r4d-variance-actual").attr("x", x0).attr("y", y).attr("width", Math.max(0, sc(r.a) * f)).attr("height", h - off).attr("fill", actColor);
    tip(ab, rowTip(r.l, actName, refName, r.a, r.b, r.d, r.r, isFavourable(r.d, pol), fmt, fmtD));
    if (f >= 1) g.append("text").attr("x", x0 + Math.max(sc(r.a), sc(r.b)) + 6 * s).attr("y", y + (h - off) / 2).attr("dy", "0.35em").attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", theme.text).text(fmt(r.a));
    // écart
    const v = rel ? r.r * 100 : r.d;
    if (!Number.isFinite(v)) return;
    const good = isFavourable(r.d, pol);
    const col = good ? VARIANCE_POS : VARIANCE_NEG;
    const xv = ds(Math.max(lo, Math.min(hi, v)) * f);
    if (rel) {
      tip(pin(g, zero, y + h / 2, xv, y + h / 2, col, s, good), rowTip(r.l, actName, refName, r.a, r.b, r.d, r.r, good, fmt, fmtD));
    } else {
      g.append("rect").attr("class", "r4d-variance-bar").attr("x", Math.min(zero, xv)).attr("y", y + h * 0.12).attr("width", Math.abs(xv - zero)).attr("height", h * 0.76).attr("fill", col).attr("opacity", r.total ? 1 : 0.92).attr("data-favourable", good ? "1" : "0").call((c) => tip(c, rowTip(r.l, actName, refName, r.a, r.b, r.d, r.r, good, fmt, fmtD)));
    }
    if (f >= 1) {
      const txt = rel ? formatSignedPct(r.r) : `${fmtD(r.d)}  ${Number.isFinite(r.r) ? formatSignedPct(r.r) : ""}`;
      const right = v >= 0;
      g.append("text").attr("class", "r4d-variance-value").attr("x", xv + (right ? 7 : -7) * s).attr("y", y + h / 2).attr("dy", "0.35em").attr("text-anchor", right ? "start" : "end").attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", col).text(txt.trim());
    }
  });
}

/* ---------------------------------------------------------------- périodes */

function drawColumns(root: G, rect: PlotRect, ctx: DrawCtx, vm: VarianceModel) {
  const { spec, theme, s, font, colors, frame } = ctx;
  const pol = spec.variance.polarity;
  const rel = spec.variance.show === "rel";
  const { fmt, fmtD } = formatters(ctx);
  const n = vm.keys.length;
  const fs = 12.5 * s;
  const g = root.append("g").attr("class", "r4d-variance r4d-marks");
  const leftW = 92 * s;
  const x = scaleBand<number>().domain(vm.keys.map((_, i) => i)).range([rect.x + leftW, rect.x + rect.w]).paddingInner(0.3).paddingOuter(0.1);
  const labH = fs + 16 * s;
  const topH = (rect.h - labH) * 0.36;
  const gapH = 18 * s;
  const botY = rect.y + topH + gapH;
  const botH = rect.h - topH - gapH - labH;
  const refName = refLabelOf(vm.refName);
  const actName = vm.actualName.replace(/\s*\(.*\)\s*$/, "");
  const head = (y: number, t: string) => g.append("text").attr("class", "r4d-variance-head").attr("x", rect.x).attr("y", y).attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", theme.muted).text(t);
  head(rect.y + 14 * s, (rel ? `Δ ${refName} %` : `Δ ${refName}`).toUpperCase());
  head(botY + 14 * s, actName.toUpperCase());
  g.append("text").attr("x", rect.x).attr("y", botY + 30 * s).attr("font-size", 12 * s).attr("fill", theme.faint).text(`vs ${refName}`);
  // écarts
  const dv = vm.keys.map((_, i) => (rel ? vm.rel[i]! * 100 : vm.delta[i]!));
  const dmax = Math.max(1e-9, ...dv.filter(Number.isFinite).map(Math.abs));
  const dlo = dv.some((v) => v < 0) ? -dmax : 0;
  const dhi = dv.some((v) => v > 0) ? dmax : 0;
  const pad = 18 * s;
  const yD = scaleLinear().domain([dlo, dhi === dlo ? dlo + 1 : dhi]).range([rect.y + topH - (dlo < 0 ? pad : 0), rect.y + 22 * s + (dhi > 0 ? pad : 0)]);
  const z = yD(0);
  g.append("line").attr("x1", rect.x + leftW).attr("x2", rect.x + rect.w).attr("y1", z).attr("y2", z).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  // valeurs
  const vmax = Math.max(1e-9, ...vm.actual, ...vm.ref, ctx.sharedMax ?? 0);
  const yV = scaleLinear().domain([0, vmax]).range([botY + botH, botY + 22 * s]);
  g.append("line").attr("x1", rect.x + leftW).attr("x2", rect.x + rect.w).attr("y1", yV(0)).attr("y2", yV(0)).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
  const norme = !!spec.norme?.enabled;
  const rs = refFill(g, ctx, refStyleFor(vm.refName, norme, spec.encoding.scenarios));
  const actColor = norme ? normeInk(theme).ac : colors[0]!;
  const bw = x.bandwidth();
  const showLabels = n <= 14;
  vm.keys.forEach((_, i) => {
    const f = stagger(frame.build, i, n);
    const cx = x(i)!;
    const a = vm.actual[i]!;
    const b = vm.ref[i]!;
    const off = bw * 0.22;
    g.append("rect").attr("x", cx + off).attr("y", yV(b * f)).attr("width", bw - off).attr("height", Math.max(0, yV(0) - yV(b * f))).attr("fill", rs.fill).attr("stroke", rs.stroke).attr("stroke-width", rs.stroke === "none" ? 0 : 1.3 * s).call((c) => tip(c, rowTip(vm.labels[i]!, actName, refName, a, b, vm.delta[i]!, vm.rel[i]!, isFavourable(vm.delta[i]!, pol), fmt, fmtD)));
    g.append("rect").attr("class", "r4d-variance-actual").attr("x", cx).attr("y", yV(a * f)).attr("width", bw - off).attr("height", Math.max(0, yV(0) - yV(a * f))).attr("fill", actColor).call((c) => tip(c, rowTip(vm.labels[i]!, actName, refName, a, b, vm.delta[i]!, vm.rel[i]!, isFavourable(vm.delta[i]!, pol), fmt, fmtD)));
    if (showLabels && f >= 1 && bw > 30 * s) g.append("text").attr("x", cx + (bw - off) / 2).attr("y", yV(Math.max(a, b)) - 6 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("font-weight", 700).attr("fill", theme.text).text(fmt(a));
    const v = dv[i]!;
    if (Number.isFinite(v)) {
      const good = isFavourable(vm.delta[i]!, pol);
      const col = good ? VARIANCE_POS : VARIANCE_NEG;
      const yv = yD(v * f);
      if (rel) {
        tip(pin(g, cx + bw / 2, z, cx + bw / 2, yv, col, s, good), rowTip(vm.labels[i]!, actName, refName, a, b, vm.delta[i]!, vm.rel[i]!, good, fmt, fmtD));
      } else {
        g.append("rect").attr("class", "r4d-variance-bar").attr("x", cx + bw * 0.1).attr("y", Math.min(z, yv)).attr("width", bw * 0.8).attr("height", Math.abs(yv - z)).attr("fill", col).call((c) => tip(c, rowTip(vm.labels[i]!, actName, refName, a, b, vm.delta[i]!, vm.rel[i]!, good, fmt, fmtD)));
      }
      if (showLabels && f >= 1) {
        const t = rel ? formatSignedPct(vm.rel[i]!) : fmtD(vm.delta[i]!);
        g.append("text").attr("class", "r4d-variance-value").attr("x", cx + bw / 2).attr("y", v >= 0 ? yv - 6 * s : yv + 14 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("font-weight", 700).attr("fill", col).text(t);
      }
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((rect.w - leftW) / (64 * s)))));
    if (i % every === 0) g.append("text").attr("x", cx + bw / 2).attr("y", rect.y + rect.h - 6 * s).attr("text-anchor", "middle").attr("font-size", fs).attr("fill", theme.muted).text(ellipsize(vm.labels[i]!, Math.max(40 * s, x.step() * every), fs, font));
  });
}
