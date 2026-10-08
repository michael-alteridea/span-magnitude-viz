/**
 * Rendu de l'exploration guidée (type « drill ») : périodes (trimestres / mois), mois jour par jour,
 * carte choroplèthe des régions (NUTS 1, échelle en km, légende), historique par région (petits multiples
 * à échelle commune) et détail par catégorie. Les éléments cliquables portent data-drill-* : la prévisualisation
 * les transforme en zoom / focus. Rouge et vert sont réservés aux écarts.
 */
import { geoDistance, geoMercator, geoPath, scaleBand, scaleLinear, type GeoPermissibleObjects } from "d3";
import { europeCountryBorders, europeLayer } from "span-magnitude-viz/geo/europe";
import type { BreakdownModel, BridgeItem, BridgeModel, CompareModel, DrillCtx, DrillModel, HistoryModel, MonthModel, PeriodsModel, PivotModel } from "../data/drill";
import { grainLabel } from "../data/drill";
import { VARIANCE_NEG, VARIANCE_POS, normeInk } from "../theme";
import { stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure, wrap } from "./text";
import { fmtOf, type Fmt } from "../story/drillStory";
import { formatInt, formatSignedPct, NBSP } from "../story/fr";
import { hatchPattern } from "./norme";
import { regionByNuts } from "../data/regions";

const LIGHT = "#3FA7C4";
const DARK = "#08465A";

interface Ink {
  strong: string;
  soft: string;
  ctx: string;
  ghost: string;
  text: string;
  muted: string;
  neg: string;
  pos: string;
  halo: string;
}

function inkOf(ctx: DrawCtx): Ink {
  const { theme, spec } = ctx;
  if (spec.norme.enabled) {
    const n = normeInk(theme);
    return { strong: n.ac, soft: n.muted, ctx: n.py, ghost: n.ac, text: theme.text, muted: theme.muted, neg: VARIANCE_NEG, pos: VARIANCE_POS, halo: theme.bg };
  }
  const strong = ctx.colors[0] ?? theme.accent;
  return { strong, soft: LIGHT, ctx: theme.dark ? "#3f3f46" : "#d4d9dc", ghost: theme.dark ? "#e4e4e7" : DARK, text: theme.text, muted: theme.muted, neg: VARIANCE_NEG, pos: VARIANCE_POS, halo: theme.bg };
}

const pctTxt = (r: number) => formatSignedPct(r, Math.abs(r) < 0.1 ? 1 : 0);
/** Couleur d'écart : rouge / vert au-delà de ±3 % (en deçà : stable, gris). */
const varColor = (ink: Ink, r: number) => (Math.abs(r) < 0.03 ? ink.muted : r < 0 ? ink.neg : ink.pos);

/** Éléments de légende (dessinés par le cadre) selon la vue. */
export function drillLegend(m: DrillModel | null, ctx: DrawCtx): { label: string; color: string; shape: "square" | "line" | "dash" | "outline" }[] {
  if (!m) return [];
  const ink = inkOf(ctx);
  switch (m.view) {
    case "periods": {
      const out: { label: string; color: string; shape: "square" | "line" | "dash" | "outline" }[] = [];
      if (m.focus != null) out.push({ label: m.bars[m.focus]!.label.replace(/^./, (c) => c.toLocaleUpperCase("fr-FR")), color: ink.strong, shape: "square" });
      if (m.zoomLabel) out.push({ label: m.zoomLabel, color: ink.soft, shape: "square" }, { label: "Contexte", color: ink.ctx, shape: "square" });
      if (m.focus != null && m.bars[m.focus]!.ref != null) out.push({ label: m.refLabel, color: ink.ghost, shape: "outline" });
      return out;
    }
    case "month":
      return [
        { label: grainLabel(m.start, m.grain, true), color: ink.strong, shape: "line" },
        { label: m.refLabel.replace(/^moy\./, "Rythme moyen"), color: ink.muted, shape: "dash" },
      ];
    case "breakdown":
      return m.refTotal != null ? [{ label: m.periodLabel ? m.periodLabel.replace(/^./, (c) => c.toLocaleUpperCase("fr-FR")) : "Valeur", color: ink.strong, shape: "square" }, { label: m.refLabel, color: ink.ghost, shape: "outline" }] : [];
    case "history":
      return m.focus != null
        ? [
            { label: grainLabel(m.keys[m.focus]!, m.grain, true), color: ink.strong, shape: "square" },
            { label: "Autres mois", color: ink.soft, shape: "square" },
            ...(m.seasonal ? [{ label: `${MONTH_LONG[m.seasonal.month]} (saisonnier)`, color: ink.ctx, shape: "square" as const }] : []),
            { label: m.refLabel, color: ink.ghost, shape: "dash" as const },
          ]
        : [];
    case "bridge":
      return [
        { label: m.fromLabel, color: GREY_TOTAL(ctx), shape: "square" },
        ...(m.groupField ? [{ label: "Sous-total", color: ink.soft, shape: "square" as const }] : []),
        { label: m.toLabel, color: ink.strong, shape: "square" },
        { label: "Hausse", color: ink.pos, shape: "square" },
        { label: "Baisse", color: ink.neg, shape: "square" },
      ];
    case "compare":
      return [
        { label: m.fromLabel, color: ctx.spec.norme.enabled ? normeInk(ctx.theme).py : GREY_TOTAL(ctx), shape: "square" },
        { label: m.toLabel, color: ctx.spec.norme.enabled ? normeInk(ctx.theme).ac : ink.strong, shape: ctx.spec.norme.enabled ? "outline" : "square" },
        { label: "Écart favorable", color: ink.pos, shape: "square" },
        { label: "Écart défavorable", color: ink.neg, shape: "square" },
      ];
    case "pivot": {
      if (m.isDelta && m.series.length === 1) return [{ label: "Hausse", color: ink.pos, shape: "square" }, { label: "Baisse", color: ink.neg, shape: "square" }];
      const cols = pivotColors(ctx, m);
      return m.series.length > 1 ? m.series.map((se, i) => ({ label: se.key, color: cols[i]!, shape: m.chart === "line" ? ("line" as const) : ("square" as const) })) : [];
    }
    default:
      return [];
  }
}

export function drawDrill(root: G, rect: PlotRect, ctx: DrawCtx, m: DrillModel, dctx: DrillCtx): void {
  const f = fmtOf(dctx);
  const g = root.append("g").attr("class", `r4d-drill r4d-drill-${m.view}`).attr("data-drill-view", m.view) as unknown as G;
  if (m.view === "periods") drawPeriods(g, rect, ctx, m, f);
  else if (m.view === "month") drawMonth(g, rect, ctx, m, f);
  else if (m.view === "map") drawMap(g, rect, ctx, m, f);
  else if (m.view === "history") drawHistory(g, rect, ctx, m, f);
  else if (m.view === "bridge") drawBridge(g, rect, ctx, m, f);
  else if (m.view === "compare") drawCompare(g, rect, ctx, m, f);
  else if (m.view === "pivot") drawPivot(g, rect, ctx, m, f);
  else drawBreakdown(g, rect, ctx, m, f);
}

function haloText(g: G, x: number, y: number, txt: string, fs: number, fill: string, ink: Ink, opts: { anchor?: string; weight?: number; cls?: string } = {}) {
  const t = g
    .append("text")
    .attr("class", opts.cls ?? null)
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", opts.anchor ?? "middle")
    .attr("font-size", fs)
    .attr("font-weight", opts.weight ?? 400)
    .attr("fill", fill)
    .attr("paint-order", "stroke")
    .attr("stroke", ink.halo)
    .attr("stroke-width", fs * 0.28)
    .attr("stroke-linejoin", "round")
    .text(txt);
  return t;
}

/* ------------------------------------------------------------------ périodes */

function drawPeriods(g: G, r: PlotRect, ctx: DrawCtx, m: PeriodsModel, f: Fmt) {
  const { s, font, frame } = ctx;
  const ink = inkOf(ctx);
  const n = m.bars.length;
  const tickH = 40 * s;
  const top = 34 * s;
  const plotH = r.h - tickH - top;
  const max = Math.max(1e-9, ...m.bars.map((b) => Math.max(b.value, b.ref ?? 0)));
  const callout = m.focus != null && (m.bars[m.focus]!.ref ?? 0) > 0;
  const y = scaleLinear().domain([0, Math.max(ctx.sharedMax ?? 0, max * (callout ? 1.3 : 1.08))]).range([r.y + top + plotH, r.y + top]);
  const x = scaleBand<number>().domain(m.bars.map((b) => b.key)).range([r.x, r.x + r.w]).paddingInner(n > 12 ? 0.18 : 0.28).paddingOuter(0.12);
  const bw = x.bandwidth();
  const base = y(0);
  const hatch = hatchPattern(g, ink.soft, s);
  // pas de grille : chaque barre porte sa valeur
  g.append("line").attr("x1", r.x).attr("x2", r.x + r.w).attr("y1", base).attr("y2", base).attr("stroke", ctx.theme.axis).attr("stroke-width", 1.2 * s);
  const fs = Math.min(15 * s, Math.max(10 * s, bw * 0.3));
  m.bars.forEach((b, i) => {
    const p = stagger(frame.build, i, n);
    const x0 = x(b.key)!;
    const isF = m.focus === i;
    const fill = b.partial ? hatch : isF ? ink.strong : b.highlight || !m.zoomLabel ? (m.focus == null || m.focusKind === "focus" ? (isF ? ink.strong : ink.soft) : ink.soft) : ink.ctx;
    const bar = g
      .append("g")
      .attr("class", "r4d-drill-bar r4d-drill-hit")
      .attr("data-drill-kind", "period")
      .attr("data-drill-key", String(b.key))
      .attr("data-drill-grain", m.grain)
      .attr("data-focus", isF ? "1" : null)
      .style("cursor", "pointer");
    bar.append("rect").attr("class", "r4d-drill-hitbox").attr("x", x0 - (x.step() - bw) / 2).attr("y", r.y).attr("width", x.step()).attr("height", r.h).attr("fill", "transparent");
    const v = b.value * p;
    bar.append("rect").attr("class", "r4d-drill-mark").attr("x", x0).attr("y", y(v)).attr("width", bw).attr("height", Math.max(0, base - y(v))).attr("rx", Math.min(4 * s, bw / 6)).attr("fill", fill).attr("stroke", b.partial ? ink.soft : "none").attr("stroke-width", 1.2 * s);
    // libellé de valeur
    const yl = isF && b.ref != null && b.ref > b.value ? y(b.ref) : y(v);
    if (p > 0.6 && bw > 16 * s) bar.append("text").attr("x", x0 + bw / 2).attr("y", yl - 7 * s).attr("text-anchor", "middle").attr("font-size", fs).attr("font-weight", isF ? 700 : 500).attr("fill", isF ? ink.text : ink.muted).attr("fill-opacity", Math.min(1, (p - 0.6) / 0.4)).text(f.v(b.value));
    // graduations : 2 lignes
    const yt = base + 16 * s;
    bar.append("text").attr("x", x0 + bw / 2).attr("y", yt).attr("text-anchor", "middle").attr("font-size", 13 * s).attr("font-weight", isF ? 700 : 400).attr("fill", isF ? ink.text : ink.muted).text(b.tick);
    const showYear = i === 0 || b.year !== m.bars[i - 1]!.year;
    if (showYear || isF) bar.append("text").attr("x", x0 + bw / 2).attr("y", yt + 16 * s).attr("text-anchor", "middle").attr("font-size", 11.5 * s).attr("fill", ctx.theme.faint).text(b.partial ? "en cours" : b.year);
  });
  // repère de la référence de la barre mise en avant + écart
  if (m.focus != null) {
    const b = m.bars[m.focus]!;
    const ref = b.ref;
    const p = stagger(frame.build, m.focus, n);
    if (ref != null && ref > 0 && p > 0.5) {
      const x0 = x(b.key)!;
      const yr = y(ref);
      const op = Math.min(1, (p - 0.5) / 0.4);
      const gr = g.append("g").attr("class", "r4d-drill-ref").attr("opacity", op);
      gr.append("rect").attr("x", x0 - 3 * s).attr("y", yr).attr("width", bw + 6 * s).attr("height", Math.max(0, base - yr)).attr("fill", "none").attr("stroke", ink.ghost).attr("stroke-width", 1.6 * s).attr("stroke-dasharray", `${5 * s} ${3 * s}`).attr("rx", 3 * s);
      const rr = b.value / ref - 1;
      // encadré en haut de la zone (au-dessus de toutes les barres), relié au repère par un filet
      const l1 = `${pctTxt(rr)} (${f.sv(b.value - ref)})`;
      const l2 = `vs ${m.refLabel} : ${f.v(ref)}`;
      const wA = Math.max(measure(l1, 17 * s, font, 700), measure(l2, 12.5 * s, font)) + 4 * s;
      const cx = x0 + bw / 2;
      const left = Math.max(r.x, Math.min(r.x + r.w - wA, cx - wA / 2));
      const ya = r.y + 6 * s;
      gr.append("text").attr("class", "r4d-drill-delta").attr("x", left + wA / 2).attr("y", ya + 14 * s).attr("text-anchor", "middle").attr("font-size", 17 * s).attr("font-weight", 700).attr("fill", varColor(ink, rr)).text(l1);
      gr.append("text").attr("x", left + wA / 2).attr("y", ya + 32 * s).attr("text-anchor", "middle").attr("font-size", 12.5 * s).attr("fill", ink.muted).text(l2);
      const yTop = Math.min(yr, y(b.value)) - 26 * s;
      if (yTop > ya + 42 * s) gr.append("line").attr("x1", cx).attr("x2", cx).attr("y1", ya + 40 * s).attr("y2", yTop).attr("stroke", ink.muted).attr("stroke-width", 1 * s);
    }
  }
}

/* ------------------------------------------------------------------ mois jour par jour */

function drawMonth(g: G, r: PlotRect, ctx: DrawCtx, m: MonthModel, f: Fmt) {
  const { s, frame } = ctx;
  const ink = inkOf(ctx);
  const weekH = 54 * s;
  const tickH = 24 * s;
  const right = 120 * s;
  const plot = { x: r.x + 4 * s, y: r.y + 10 * s, w: r.w - right, h: r.h - weekH - tickH - 10 * s };
  const max = Math.max(1e-9, m.refTotal, m.curTotal) * 1.08;
  const x = scaleLinear().domain([1, m.days]).range([plot.x, plot.x + plot.w]);
  const y = scaleLinear().domain([0, max]).range([plot.y + plot.h, plot.y]);
  for (const t of y.ticks(4)) {
    g.append("line").attr("x1", plot.x).attr("x2", plot.x + plot.w).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", t === 0 ? ctx.theme.axis : ctx.theme.grid).attr("stroke-width", (t === 0 ? 1.2 : 1) * s);
    if (t) g.append("text").attr("x", plot.x).attr("y", y(t) - 4 * s).attr("font-size", 11 * s).attr("fill", ctx.theme.faint).text(f.v(t));
  }
  // semaines
  m.weeks.forEach((w, i) => {
    const xa = x(w.from) - (i ? 0 : 0);
    const xb = x(Math.min(w.to, m.days));
    if (i) g.append("line").attr("x1", x(w.from - 0.5)).attr("x2", x(w.from - 0.5)).attr("y1", plot.y).attr("y2", plot.y + plot.h + weekH + tickH).attr("stroke", ctx.theme.grid).attr("stroke-dasharray", `${2 * s} ${3 * s}`);
    const rr = w.ref > 0 ? w.cur / w.ref - 1 : 0;
    const cx = (xa + xb) / 2;
    const yw = plot.y + plot.h + tickH + 18 * s;
    g.append("text").attr("x", cx).attr("y", yw).attr("text-anchor", "middle").attr("font-size", 12 * s).attr("fill", ink.muted).text(`${w.from}–${w.to}${NBSP}${MONTH_ABBR[new Date(m.start).getUTCMonth()]}`);
    g.append("text").attr("class", "r4d-drill-week").attr("x", cx).attr("y", yw + 20 * s).attr("text-anchor", "middle").attr("font-size", 15 * s).attr("font-weight", 700).attr("fill", varColor(ink, rr)).text(`${f.sv(w.cur - w.ref)} · ${pctTxt(rr)}`);
  });
  for (const d of [1, 5, 10, 15, 20, 25, m.days]) {
    if (d > m.days) continue;
    g.append("text").attr("x", x(d)).attr("y", plot.y + plot.h + 16 * s).attr("text-anchor", "middle").attr("font-size", 11.5 * s).attr("fill", ctx.theme.faint).text(String(d));
  }
  const lineOf = (vals: (number | null)[], upto: number) => {
    let d = "";
    for (let i = 0; i < vals.length && i < upto; i++) {
      const v = vals[i];
      if (v == null) break;
      d += `${d ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`;
    }
    return d;
  };
  const upto = Math.max(1, Math.round(m.days * Math.min(1, frame.build * 1.15)));
  // écart (aire entre les deux courbes)
  let area = "";
  const lastCur = m.cur.reduce<number>((a, v, i) => (v != null ? i : a), -1);
  const lim = Math.min(lastCur + 1, upto);
  if (lim > 1) {
    for (let i = 0; i < lim; i++) area += `${area ? "L" : "M"}${x(i + 1).toFixed(1)},${y(m.cur[i]!).toFixed(1)}`;
    for (let i = lim - 1; i >= 0; i--) area += `L${x(i + 1).toFixed(1)},${y(m.ref[i]!).toFixed(1)}`;
    const neg = m.curTotal < m.refTotal;
    g.append("path").attr("d", area + "Z").attr("fill", neg ? ink.neg : ink.pos).attr("fill-opacity", 0.1);
  }
  g.append("path").attr("class", "r4d-drill-ref").attr("d", lineOf(m.ref, upto)).attr("fill", "none").attr("stroke", ink.muted).attr("stroke-width", 2.4 * s).attr("stroke-dasharray", `${7 * s} ${5 * s}`);
  g.append("path").attr("class", "r4d-drill-mark").attr("d", lineOf(m.cur, upto)).attr("fill", "none").attr("stroke", ink.strong).attr("stroke-width", 3.6 * s).attr("stroke-linejoin", "round");
  if (frame.build >= 0.85 && lastCur >= 0) {
    const xe = x(lastCur + 1);
    const yc = y(m.cur[lastCur]!);
    const yr = y(m.ref[lastCur]!);
    g.append("circle").attr("cx", xe).attr("cy", yc).attr("r", 5 * s).attr("fill", ink.strong);
    g.append("circle").attr("cx", xe).attr("cy", yr).attr("r", 4 * s).attr("fill", ctx.theme.bg).attr("stroke", ink.muted).attr("stroke-width", 2 * s);
    const lx = xe + 12 * s;
    let ya = yr;
    let yb = yc;
    if (Math.abs(yb - ya) < 34 * s) {
      const mid = (ya + yb) / 2;
      ya = mid - 17 * s;
      yb = mid + 17 * s;
      if (yc < yr) [ya, yb] = [yb, ya];
    }
    g.append("text").attr("x", lx).attr("y", ya + 5 * s).attr("font-size", 13 * s).attr("fill", ink.muted).text(f.v(m.refTotal));
    g.append("text").attr("x", lx).attr("y", yb + 5 * s).attr("font-size", 15 * s).attr("font-weight", 700).attr("fill", ink.text).text(f.v(m.curTotal));
    const gap = m.curTotal - m.refTotal;
    const rr = m.refTotal ? gap / m.refTotal : 0;
    const xm = lx;
    const ym = (yc + yr) / 2;
    if (Math.abs(yc - yr) > 70 * s) {
      g.append("line").attr("x1", xe).attr("x2", xe).attr("y1", Math.min(yc, yr) + 8 * s).attr("y2", Math.max(yc, yr) - 8 * s).attr("stroke", varColor(ink, rr)).attr("stroke-width", 2 * s);
      g.append("text").attr("class", "r4d-drill-delta").attr("x", xm).attr("y", ym + 5 * s).attr("font-size", 16 * s).attr("font-weight", 700).attr("fill", varColor(ink, rr)).text(`${f.sv(gap)} · ${pctTxt(rr)}`);
    } else {
      g.append("text").attr("class", "r4d-drill-delta").attr("x", xm).attr("y", Math.max(yc, yr) + 40 * s).attr("font-size", 16 * s).attr("font-weight", 700).attr("fill", varColor(ink, rr)).text(`${f.sv(gap)} · ${pctTxt(rr)}`);
    }
  }
}

const MONTH_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MONTH_ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/* ------------------------------------------------------------------ carte */

/** Barre d'échelle : longueur « ronde » en km et largeur en pixels (≈ 22 % de la largeur max). */
function scaleBarOf(proj: ReturnType<typeof geoMercator>, x: number, y: number, maxPx: number): { km: number; px: number } | null {
  const a = proj.invert?.([x, y]);
  const b = proj.invert?.([x + maxPx, y]);
  if (!a || !b) return null;
  const kmMax = geoDistance(a, b) * 6371.0088;
  const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  let km = NICE[0]!;
  for (const n of NICE) if (n <= kmMax) km = n;
  return { km, px: (maxPx * km) / kmMax };
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function drawMap(g: G, r: PlotRect, ctx: DrawCtx, m: BreakdownModel, f: Fmt) {
  const { s, frame, font, theme } = ctx;
  const ink = inkOf(ctx);
  const layer = europeLayer("nuts1");
  const byId = new Map(layer.features.map((ft) => [ft.properties.id, ft]));
  const matched = m.stats.filter((st) => st.nuts && byId.has(st.nuts));
  const legendW = 160 * s;
  const mapR = { x: r.x + legendW, y: r.y, w: r.w - legendW, h: r.h };
  if (!matched.length) {
    g.append("text").attr("x", r.x + r.w / 2).attr("y", r.y + r.h / 2).attr("text-anchor", "middle").attr("font-size", 16 * s).attr("fill", theme.muted).text(`Aucune valeur de « ${m.field} » reconnue comme région (NUTS 1).`);
    return;
  }
  const fc = { type: "FeatureCollection", features: matched.map((st) => byId.get(st.nuts!)!) } as unknown as GeoJSON.FeatureCollection;
  const proj = geoMercator().fitExtent(
    [
      [mapR.x + 30 * s, mapR.y + 34 * s],
      [mapR.x + mapR.w - 120 * s, mapR.y + mapR.h - 40 * s],
    ],
    fc as GeoPermissibleObjects,
  );
  const path = geoPath(proj);
  const clipId = `r4d-drill-clip-${Math.random().toString(36).slice(2, 8)}`;
  g.append("defs").append("clipPath").attr("id", clipId).append("rect").attr("x", mapR.x).attr("y", mapR.y).attr("width", mapR.w).attr("height", mapR.h).attr("rx", 8 * s);
  const gm = g.append("g").attr("clip-path", `url(#${clipId})`);
  gm.append("rect").attr("x", mapR.x).attr("y", mapR.y).attr("width", mapR.w).attr("height", mapR.h).attr("rx", 8 * s).attr("fill", theme.dark ? "#1b2730" : "#eef4f6");
  const matchedIds = new Set(matched.map((st) => st.nuts!));
  // voisins en gris
  for (const ft of layer.features) {
    if (matchedIds.has(ft.properties.id)) continue;
    const b = path.bounds(ft as unknown as GeoPermissibleObjects);
    if (b[1][0] < mapR.x || b[0][0] > mapR.x + mapR.w || b[1][1] < mapR.y || b[0][1] > mapR.y + mapR.h) continue;
    gm.append("path").attr("d", path(ft as unknown as GeoPermissibleObjects)).attr("fill", theme.dark ? "#2a2f35" : "#e3e6e8").attr("stroke", theme.bg).attr("stroke-width", 0.8 * s);
  }
  const vmax = Math.max(1e-9, ...matched.map((st) => st.value));
  const lo = theme.dark ? "#1e3a44" : "#d8edf3";
  const hi = ctx.spec.norme.enabled ? normeInk(theme).ac : DARK;
  const colorOf = (v: number) => mix(lo, hi, Math.pow(Math.max(0, v) / vmax, 0.85));
  const std = m.standout != null ? m.stats[m.standout] : null;
  const p = frame.build;
  matched.forEach((st, i) => {
    const ft = byId.get(st.nuts!)!;
    const q = stagger(p, i, matched.length);
    gm.append("path")
      .attr("class", "r4d-drill-region r4d-drill-hit")
      .attr("data-drill-kind", "cat")
      .attr("data-drill-field", m.field)
      .attr("data-drill-value", st.key)
      .attr("d", path(ft as unknown as GeoPermissibleObjects))
      .attr("fill", q >= 1 ? colorOf(st.value) : mix(lo, colorOf(st.value), q))
      .attr("stroke", theme.bg)
      .attr("stroke-width", 1.4 * s)
      .style("cursor", "pointer");
  });
  const borders = europeCountryBorders("nuts1");
  if (borders) gm.append("path").attr("d", path(borders as unknown as GeoPermissibleObjects)).attr("fill", "none").attr("stroke", theme.dark ? "#71717a" : "#8a9399").attr("stroke-width", 1.3 * s).attr("stroke-dasharray", `${4 * s} ${2.5 * s}`);
  if (std && std.nuts && byId.has(std.nuts) && p > 0.6) gm.append("path").attr("class", "r4d-drill-standout").attr("d", path(byId.get(std.nuts)! as unknown as GeoPermissibleObjects)).attr("fill", "none").attr("stroke", ink.text).attr("stroke-width", 3 * s).attr("stroke-linejoin", "round").attr("pointer-events", "none");
  // étiquettes : nom, valeur, écart vs référence ; petites régions → étiquette déportée à droite avec filet
  if (p > 0.55) {
    const op = Math.min(1, (p - 0.55) / 0.35);
    const gl = g.append("g").attr("class", "r4d-drill-labels").attr("opacity", op).attr("pointer-events", "none");
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const items = matched.map((st) => {
      const ft = byId.get(st.nuts!)!;
      const area = path.area(ft as unknown as GeoPermissibleObjects);
      const c = path.centroid(ft as unknown as GeoPermissibleObjects);
      return { st, area, c };
    });
    items.sort((a, b) => b.area - a.area);
    const matchedRight = path.bounds(fc as GeoPermissibleObjects)[1][0];
    for (const it of items) {
      const { st } = it;
      const small = it.area < 5200 * s * s;
      const rr = st.ref != null && st.ref > 0 ? st.value / st.ref - 1 : null;
      const lines: { t: string; fs: number; w: number; fill: string }[] = [
        { t: st.key, fs: 14 * s, w: 700, fill: ink.text },
        { t: f.v(st.value), fs: 15 * s, w: 700, fill: ink.text },
      ];
      if (m.versions && st.ref != null && st.ref !== 0) {
        const rv = (st.value - st.ref) / Math.abs(st.ref);
        lines.push({ t: `${f.sv(st.value - st.ref)} · ${pctTxt(rv)}`, fs: 13.5 * s, w: 700, fill: varColor(ink, rv) });
      } else if (rr != null) lines.push({ t: pctTxt(rr), fs: 14 * s, w: 700, fill: varColor(ink, rr) });
      const bw = Math.max(...lines.map((l) => measure(l.t, l.fs, font, l.w))) + 16 * s;
      const bh = lines.length * 17 * s + 10 * s;
      let bx = it.c[0] - bw / 2;
      let by = it.c[1] - bh / 2;
      if (small) {
        // petite région (Bruxelles) : étiquette déportée à l'est, hors des grandes régions
        bx = Math.max(it.c[0] + 70 * s, matchedRight + 16 * s);
        by = it.c[1] - bh / 2 - 30 * s;
      }
      // grande région dont l'étiquette couvrirait une petite région (Flandre / Bruxelles) : on la remonte
      if (!small)
        for (const o of items) {
          if (o === it || o.area >= 5200 * s * s) continue;
          const [ox, oy] = o.c;
          if (ox > bx - 10 * s && ox < bx + bw + 10 * s && oy > by - 10 * s && oy < by + bh + 10 * s) by = oy - bh - 14 * s;
        }
      // évite les chevauchements simples (décalage vertical)
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((q) => bx < q.x + q.w && bx + bw > q.x && by < q.y + q.h && by + bh > q.y);
        if (!hit) break;
        by = small ? hit.y - bh - 6 * s : hit.y + hit.h + 6 * s;
      }
      by = Math.max(mapR.y + 6 * s, Math.min(mapR.y + mapR.h - bh - 6 * s, by));
      bx = Math.max(mapR.x + 6 * s, Math.min(mapR.x + mapR.w - bw - 6 * s, bx));
      placed.push({ x: bx, y: by, w: bw, h: bh });
      if (small) {
        gl.append("line").attr("x1", it.c[0]).attr("y1", it.c[1]).attr("x2", bx).attr("y2", Math.max(by + 8 * s, Math.min(by + bh - 8 * s, it.c[1]))).attr("stroke", ink.text).attr("stroke-width", 1.2 * s);
        gl.append("circle").attr("cx", it.c[0]).attr("cy", it.c[1]).attr("r", 3 * s).attr("fill", ink.text);
      }
      gl.append("rect").attr("x", bx).attr("y", by).attr("width", bw).attr("height", bh).attr("rx", 6 * s).attr("fill", theme.bg).attr("fill-opacity", 0.9).attr("stroke", st === std ? ink.text : theme.grid).attr("stroke-width", (st === std ? 1.6 : 1) * s);
      lines.forEach((l, k) => gl.append("text").attr("x", bx + bw / 2).attr("y", by + 5 * s + (k + 0.8) * 17 * s).attr("text-anchor", "middle").attr("font-size", l.fs).attr("font-weight", l.w).attr("fill", l.fill).text(l.t));
    }
  }
  // légende (dégradé) + référence + échelle
  const lx = r.x;
  let ly = r.y + 8 * s;
  const lg = g.append("g").attr("class", "r4d-drill-map-legend");
  lg.append("text").attr("x", lx).attr("y", ly + 12 * s).attr("font-size", 13 * s).attr("font-weight", 700).attr("fill", ink.text).text(ellipsize(f.Measure, legendW - 16 * s, 13 * s, font, 700));
  if (m.periodLabel) lg.append("text").attr("x", lx).attr("y", ly + 30 * s).attr("font-size", 12.5 * s).attr("fill", ink.muted).text(m.periodLabel);
  ly += 44 * s;
  const gradId = `r4d-drill-grad-${Math.random().toString(36).slice(2, 8)}`;
  const grad = lg.append("defs").append("linearGradient").attr("id", gradId).attr("x1", 0).attr("x2", 0).attr("y1", 1).attr("y2", 0);
  for (let k = 0; k <= 4; k++) grad.append("stop").attr("offset", `${k * 25}%`).attr("stop-color", colorOf((vmax * k) / 4));
  const rampH = Math.min(150 * s, r.h * 0.4);
  lg.append("rect").attr("x", lx).attr("y", ly).attr("width", 16 * s).attr("height", rampH).attr("rx", 3 * s).attr("fill", `url(#${gradId})`);
  lg.append("text").attr("x", lx + 24 * s).attr("y", ly + 10 * s).attr("font-size", 12 * s).attr("fill", ink.muted).text(f.v(vmax));
  lg.append("text").attr("x", lx + 24 * s).attr("y", ly + rampH).attr("font-size", 12 * s).attr("fill", ink.muted).text(f.v(0));
  ly += rampH + 26 * s;
  if (m.refTotal != null) {
    const txt = ["% : écart vs", m.refLabel, `Total : ${f.v(m.total)} (${pctTxt(m.delta! / (m.refTotal || 1))})`];
    txt.forEach((t, k) => lg.append("text").attr("x", lx).attr("y", ly + k * 17 * s + (k === 2 ? 6 * s : 0)).attr("font-size", 12 * s).attr("fill", k === 2 ? varColor(ink, m.delta! / (m.refTotal || 1)) : ink.muted).attr("font-weight", k === 2 ? 700 : 400).text(ellipsize(t, legendW - 10 * s, 12 * s, font)));
    ly += 64 * s;
  }
  if (m.unmatched.length) lg.append("text").attr("x", lx).attr("y", ly).attr("font-size", 11.5 * s).attr("fill", ink.muted).text(ellipsize(`Non cartographié : ${m.unmatched.join(", ")}`, legendW - 10 * s, 11.5 * s, font));
  // barre d'échelle (km), en bas à gauche de la carte
  const sbY = mapR.y + mapR.h - 18 * s;
  const sbX = mapR.x + 16 * s;
  const sb = scaleBarOf(proj, sbX, sbY, Math.min(180 * s, mapR.w * 0.25));
  if (sb) {
    const gs = g.append("g").attr("class", "r4d-scalebar").attr("data-km", sb.km);
    gs.append("rect").attr("x", sbX - 6 * s).attr("y", sbY - 22 * s).attr("width", sb.px + 12 * s + 40 * s).attr("height", 30 * s).attr("rx", 4 * s).attr("fill", theme.bg).attr("fill-opacity", 0.85);
    gs.append("rect").attr("x", sbX).attr("y", sbY - 4 * s).attr("width", sb.px / 2).attr("height", 5 * s).attr("fill", ink.text);
    gs.append("rect").attr("x", sbX + sb.px / 2).attr("y", sbY - 4 * s).attr("width", sb.px / 2).attr("height", 5 * s).attr("fill", theme.bg).attr("stroke", ink.text).attr("stroke-width", 1 * s);
    gs.append("text").attr("x", sbX).attr("y", sbY - 9 * s).attr("font-size", 11 * s).attr("fill", ink.text).text("0");
    gs.append("text").attr("x", sbX + sb.px).attr("y", sbY - 9 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("fill", ink.text).text(`${formatInt(sb.km)}${NBSP}km`);
  }
  void regionByNuts;
}

/* ------------------------------------------------------------------ historique (petits multiples) */

function drawHistory(g: G, r: PlotRect, ctx: DrawCtx, m: HistoryModel, f: Fmt) {
  const { s, frame, font, theme } = ctx;
  const ink = inkOf(ctx);
  const n = m.series.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const gapX = 22 * s;
  const gapY = 16 * s;
  const cw = (r.w - gapX * (cols - 1)) / cols;
  const ch = (r.h - gapY * (rows - 1)) / rows;
  const hatch = hatchPattern(g, ink.soft, s);
  m.series.forEach((se, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = row === rows - 1 ? ((cols - inRow) * (cw + gapX)) / 2 : 0;
    const px = r.x + offset + (i % cols) * (cw + gapX);
    const py = r.y + row * (ch + gapY);
    const isStd = m.standout === i;
    const gp = g.append("g").attr("class", "r4d-drill-panel r4d-drill-hit").attr("data-drill-kind", "cat").attr("data-drill-field", m.field).attr("data-drill-value", se.key).style("cursor", "pointer");
    gp.append("rect").attr("x", px).attr("y", py).attr("width", cw).attr("height", ch).attr("rx", 8 * s).attr("fill", isStd ? (theme.dark ? "#16262d" : "#f2f8fa") : "transparent").attr("stroke", isStd ? ink.text : theme.grid).attr("stroke-width", (isStd ? 1.6 : 1) * s);
    const head = 40 * s;
    gp.append("text").attr("x", px + 12 * s).attr("y", py + 22 * s).attr("font-size", 15 * s).attr("font-weight", 700).attr("fill", ink.text).text(ellipsize(se.key, cw * 0.6, 15 * s, font, 700));
    if (se.focusRatio != null && m.focus != null) {
      gp.append("text").attr("class", "r4d-drill-delta").attr("x", px + cw - 12 * s).attr("y", py + 22 * s).attr("text-anchor", "end").attr("font-size", 15 * s).attr("font-weight", 700).attr("fill", varColor(ink, se.focusRatio)).text(pctTxt(se.focusRatio));
      gp.append("text").attr("x", px + cw - 12 * s).attr("y", py + 37 * s).attr("text-anchor", "end").attr("font-size", 10.5 * s).attr("fill", ink.muted).text(`${MONTH_ABBR[new Date(m.keys[m.focus]!).getUTCMonth()]} vs ${m.refLabel.replace(/^moy\. /, "")}`);
    }
    const inner = { x: px + 10 * s, y: py + head + 6 * s, w: cw - 20 * s, h: ch - head - 30 * s };
    const x = scaleBand<number>().domain(m.keys).range([inner.x, inner.x + inner.w]).paddingInner(0.2);
    const y = scaleLinear().domain([0, m.max * 1.05]).range([inner.y + inner.h, inner.y]);
    const bw = x.bandwidth();
    gp.append("line").attr("x1", inner.x).attr("x2", inner.x + inner.w).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
    const seasonalKeys = new Set(m.seasonal?.keys ?? []);
    se.values.forEach((v, k) => {
      const q = stagger(frame.build, k, se.values.length, 0.6);
      const isF = m.focus === k;
      const fill = m.partial[k] ? hatch : isF ? ink.strong : seasonalKeys.has(m.keys[k]!) ? ink.ctx : ink.soft;
      gp.append("rect").attr("class", isF ? "r4d-drill-mark r4d-drill-focus" : "r4d-drill-mark").attr("x", x(m.keys[k]!)!).attr("y", y(v * q)).attr("width", bw).attr("height", Math.max(0, y(0) - y(v * q))).attr("fill", fill).attr("rx", Math.min(2 * s, bw / 4));
    });
    if (m.focus != null && se.focusRef != null) {
      const xf = x(m.keys[m.focus]!)!;
      gp.append("line").attr("x1", xf - 3 * s).attr("x2", xf + bw + 3 * s).attr("y1", y(se.focusRef)).attr("y2", y(se.focusRef)).attr("stroke", ink.ghost).attr("stroke-width", 1.6 * s).attr("stroke-dasharray", `${3 * s} ${2 * s}`);
    }
    // graduations : premier mois, mois focalisé, dernier mois, août (saisonnalité)
    const tickIdx = new Set<number>([0, m.keys.length - 1]);
    if (m.focus != null) tickIdx.add(m.focus);
    const yt = inner.y + inner.h + 14 * s;
    const placedX: number[] = [];
    [...tickIdx].sort((a, b) => (a === m.focus ? -1 : b === m.focus ? 1 : a - b)).forEach((k) => {
      const t = m.ticks[k]!;
      const cx = x(m.keys[k]!)! + bw / 2;
      if (placedX.some((px2) => Math.abs(px2 - cx) < 46 * s)) return;
      placedX.push(cx);
      gp.append("text").attr("x", cx).attr("y", yt).attr("text-anchor", "middle").attr("font-size", 10.5 * s).attr("font-weight", k === m.focus ? 700 : 400).attr("fill", k === m.focus ? ink.text : theme.faint).text(`${t.tick} ${t.year.slice(-2)}`);
    });
  });
  if (m.seasonal) {
    // note en bas à droite du dernier panneau vide (ou en pied)
    void f;
  }
}

/* ------------------------------------------------------------------ détail par catégorie */

function drawBreakdown(g: G, r: PlotRect, ctx: DrawCtx, m: BreakdownModel, f: Fmt) {
  const { s, frame, font, theme } = ctx;
  const ink = inkOf(ctx);
  const n = m.stats.length;
  const rowH = Math.min(70 * s, r.h / Math.max(1, n));
  const labelW = Math.min(r.w * 0.24, Math.max(...m.stats.map((st) => measure(st.key, 15 * s, font, 700))) + 18 * s);
  const right = 250 * s;
  const x0 = r.x + labelW;
  const max = Math.max(1e-9, ...m.stats.map((st) => Math.max(st.value, st.ref ?? 0)));
  const min = Math.min(0, ...m.stats.map((st) => Math.min(st.value, st.ref ?? 0)));
  const xr = scaleLinear().domain([min * 1.04, max * 1.04]).range([x0, r.x + r.w - right]);
  const x = (v: number) => xr(v);
  const xz = xr(0);
  const top = r.y + 14 * s + Math.max(0, (r.h - 14 * s - rowH * n) / 2) * 0.5;
  g.append("line").attr("x1", xz).attr("x2", xz).attr("y1", top).attr("y2", top + rowH * n).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  const hasRef = m.refTotal != null;
  if (hasRef) {
    g.append("text").attr("x", r.x + r.w - right + 16 * s).attr("y", top - 6 * s).attr("font-size", 11 * s).attr("fill", theme.faint).text(m.versions ? `écart ${m.periodLabel} vs ${m.refLabel}` : `écart vs ${m.refLabel}`);
  }
  m.stats.forEach((st, i) => {
    const q = stagger(frame.build, i, n);
    const yc = top + i * rowH + rowH / 2;
    const isStd = m.standout === i;
    const bh = Math.min(26 * s, rowH * 0.5);
    const gr = g.append("g").attr("class", "r4d-drill-row r4d-drill-hit").attr("data-drill-kind", "cat").attr("data-drill-field", m.field).attr("data-drill-value", st.key).style("cursor", st.key.startsWith("Autres (") ? "default" : "pointer");
    gr.append("rect").attr("x", r.x).attr("y", yc - rowH / 2).attr("width", r.w).attr("height", rowH).attr("fill", isStd ? (theme.dark ? "#16262d" : "#f2f8fa") : "transparent").attr("rx", 6 * s);
    gr.append("text").attr("x", x0 - 10 * s).attr("y", yc).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", 15 * s).attr("font-weight", isStd ? 700 : 500).attr("fill", ink.text).text(ellipsize(st.key, labelW - 14 * s, 15 * s, font, 700));
    const xv = x(st.value * q);
    gr.append("rect").attr("class", "r4d-drill-mark").attr("x", Math.min(xz, xv)).attr("y", yc - bh / 2).attr("width", Math.abs(xv - xz)).attr("height", bh).attr("rx", 3 * s).attr("fill", isStd ? ink.strong : ink.soft);
    if (st.ref != null && st.ref !== 0) gr.append("rect").attr("class", "r4d-drill-ref").attr("x", Math.min(xz, x(st.ref))).attr("y", yc - bh / 2 - 4 * s).attr("width", Math.abs(x(st.ref) - xz)).attr("height", bh + 8 * s).attr("rx", 3 * s).attr("fill", "none").attr("stroke", ink.ghost).attr("stroke-width", 1.5 * s).attr("stroke-dasharray", `${5 * s} ${3 * s}`).attr("opacity", q);
    if (q > 0.6) {
      const end = Math.max(x(st.value), st.ref != null ? x(st.ref) : xz, xz);
      gr.append("text").attr("x", end + 8 * s).attr("y", yc).attr("dy", "0.35em").attr("font-size", 14 * s).attr("font-weight", 700).attr("fill", ink.text).text(f.v(st.value));
      const cntTxt = m.versions ? `${m.refLabel} : ${f.v(st.ref ?? 0)}` : st.refCount != null ? `${formatInt(st.count)} ${st.count < 2 ? f.item.sg : f.item.pl} (moy. ${formatInt(Math.round(st.refCount))})` : `${formatInt(st.count)} ${st.count < 2 ? f.item.sg : f.item.pl}`;
      if (hasRef && st.ref != null && (st.ref > 0 || (m.versions && st.ref !== 0))) {
        const rr = m.versions ? (st.value - st.ref) / Math.abs(st.ref) : st.value / st.ref - 1;
        gr.append("text").attr("class", "r4d-drill-delta").attr("x", r.x + r.w - right + 16 * s).attr("y", yc - 7 * s).attr("font-size", 15 * s).attr("font-weight", 700).attr("fill", varColor(ink, rr)).text(`${f.sv(st.value - st.ref)} · ${pctTxt(rr)}`);
        gr.append("text").attr("x", r.x + r.w - right + 16 * s).attr("y", yc + 12 * s).attr("font-size", 12 * s).attr("fill", ink.muted).text(cntTxt);
      } else gr.append("text").attr("x", r.x + r.w - right + 16 * s).attr("y", yc).attr("dy", "0.35em").attr("font-size", 12.5 * s).attr("fill", ink.muted).text(cntTxt);
    }
  });
}

/* ------------------------------------------------------------------ cascade (réel → budget) */

const GREY_TOTAL = (ctx: DrawCtx) => (ctx.spec.norme.enabled ? normeInk(ctx.theme).py : ctx.theme.dark ? "#6b7780" : "#9AA6AD");

function drawBridge(g: G, r: PlotRect, ctx: DrawCtx, m: BridgeModel, f: Fmt) {
  const { s, frame, font, theme } = ctx;
  const ink = inkOf(ctx);
  const n = m.items.length;
  const grouped = !!m.groupField;
  const lineH = 15 * s;
  const tickH = 3 * lineH + 10 * s + (grouped ? 30 * s : 0);
  const top = 30 * s;
  const plotH = r.h - tickH - top;
  const lo = Math.min(0, ...m.items.map((it) => Math.min(it.y0, it.y1)));
  const hi = Math.max(1e-9, ...m.items.map((it) => Math.max(it.y0, it.y1)));
  const y = scaleLinear().domain([lo, hi * 1.1]).range([r.y + top + plotH, r.y + top]);
  const x = scaleBand<number>().domain(m.items.map((_, i) => i)).range([r.x, r.x + r.w]).paddingInner(0.3).paddingOuter(0.1);
  const bw = x.bandwidth();
  const base = y(0);
  g.append("line").attr("x1", r.x).attr("x2", r.x + r.w).attr("y1", base).attr("y2", base).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  const fs = Math.min(15 * s, Math.max(11 * s, bw * 0.17));
  const totalFill = (it: BridgeItem) => (it.kind === "start" ? GREY_TOTAL(ctx) : it.kind === "subtotal" ? ink.soft : ink.strong);
  const small = (v: number) => Math.abs(v) < Math.abs(m.start || 1) * 0.0005;
  m.items.forEach((it, i) => {
    const p = stagger(frame.build, i, n, 0.55);
    const x0 = x(i)!;
    const isDelta = it.kind === "delta";
    const clickable = isDelta && !it.key.startsWith("Autres (");
    const gi = g
      .append("g")
      .attr("class", `r4d-drill-bridge-item r4d-drill-bridge-${it.kind}${clickable ? " r4d-drill-hit" : ""}`)
      .attr("data-key", it.key)
      .attr("data-drill-kind", clickable ? "cat" : null)
      .attr("data-drill-field", clickable ? m.field : null)
      .attr("data-drill-value", clickable ? it.key : null)
      .style("cursor", clickable ? "pointer" : "default");
    if (clickable) gi.append("rect").attr("class", "r4d-drill-hitbox").attr("x", x0 - (x.step() - bw) / 2).attr("y", r.y).attr("width", x.step()).attr("height", r.h).attr("fill", "transparent");
    let ya: number;
    let yb: number;
    let fill: string;
    if (isDelta) {
      const v1 = it.y0 + (it.y1 - it.y0) * p;
      ya = y(Math.max(it.y0, v1));
      yb = y(Math.min(it.y0, v1));
      fill = small(it.value) ? ink.muted : it.value > 0 ? ink.pos : ink.neg;
    } else {
      ya = y(Math.max(0, it.value * p));
      yb = y(Math.min(0, it.value * p));
      fill = totalFill(it);
    }
    gi.append("rect").attr("class", "r4d-drill-mark").attr("x", x0).attr("y", ya).attr("width", bw).attr("height", Math.max(isDelta ? 1.5 * s : 0, yb - ya)).attr("rx", Math.min(3 * s, bw / 8)).attr("fill", fill);
    // libellé signé (facteurs) ou niveau (totaux)
    if (p > 0.7) {
      const op = Math.min(1, (p - 0.7) / 0.3);
      const txt = isDelta ? f.sv(it.value) : f.v(it.value);
      const below = isDelta && it.value < 0;
      const yl = below ? yb + fs + 4 * s : ya - 7 * s;
      gi.append("text").attr("class", isDelta ? "r4d-drill-delta" : null).attr("x", x0 + bw / 2).attr("y", yl).attr("text-anchor", "middle").attr("font-size", fs).attr("font-weight", 700).attr("fill", isDelta ? (small(it.value) ? ink.muted : it.value > 0 ? ink.pos : ink.neg) : ink.text).attr("fill-opacity", op).text(txt);
    }
    // catégorie (2 à 3 lignes)
    const lines = wrap(it.label, x.step() - 6 * s, 12.5 * s, font, isDelta ? 500 : 700, 3);
    lines.forEach((ln, k) => gi.append("text").attr("x", x0 + bw / 2).attr("y", base + 18 * s + k * lineH).attr("text-anchor", "middle").attr("font-size", 12.5 * s).attr("font-weight", isDelta ? 500 : 700).attr("fill", isDelta ? ink.text : ink.text).text(ln));
  });
  // connecteurs : du haut (ou du bas) de chaque marche au départ de la suivante
  if (frame.build > 0.4) {
    const op = Math.min(1, (frame.build - 0.4) / 0.4);
    const gc = g.append("g").attr("class", "r4d-drill-connectors").attr("opacity", op).attr("pointer-events", "none");
    for (let i = 0; i < n - 1; i++) {
      const lvl = m.items[i]!.y1;
      const xa = x(i)! + bw;
      const xb = x(i + 1)!;
      gc.append("line").attr("x1", xa).attr("x2", xb).attr("y1", y(lvl)).attr("y2", y(lvl)).attr("stroke", theme.dark ? "#71717a" : "#8a9399").attr("stroke-width", 1 * s).attr("stroke-dasharray", `${3 * s} ${2 * s}`);
    }
  }
  // groupes (Revenus / Coûts) : accolade sous les libellés
  if (grouped) {
    const gy = base + 18 * s + 3 * lineH + 4 * s;
    const groups = [...new Set(m.items.filter((it) => it.kind === "delta").map((it) => it.group))];
    for (const gname of groups) {
      const idx = m.items.map((it, i) => (it.kind === "delta" && it.group === gname ? i : -1)).filter((i) => i >= 0);
      if (!idx.length || !gname) continue;
      const xa = x(idx[0]!)!;
      const xb = x(idx[idx.length - 1]!)! + bw;
      g.append("path").attr("d", `M${xa},${gy}v${5 * s}H${xb}v${-5 * s}`).attr("fill", "none").attr("stroke", ink.muted).attr("stroke-width", 1.2 * s);
      g.append("text").attr("x", (xa + xb) / 2).attr("y", gy + 22 * s).attr("text-anchor", "middle").attr("font-size", 12.5 * s).attr("font-weight", 700).attr("fill", ink.muted).attr("letter-spacing", 0.6 * s).text(gname.toLocaleUpperCase("fr-FR"));
    }
  }
}

/* ------------------------------------------------------------------ mois : version vs version + écarts */

function drawCompare(g: G, r0: PlotRect, ctx: DrawCtx, m: CompareModel, f: Fmt) {
  let r = r0;
  const { s, frame, theme } = ctx;
  const ink = inkOf(ctx);
  const right = 150 * s;
  const gut = 52 * s;
  r = { ...r, x: r.x + gut, w: r.w - gut };
  const W = r.w - right;
  const tickH = 22 * s;
  const varH = Math.max(90 * s, (r.h - tickH) * 0.34);
  const gap = 18 * s;
  const mainH = r.h - tickH - varH - gap;
  const x = scaleBand<number>().domain(m.months.map((x0) => x0.key)).range([r.x, r.x + W]).paddingInner(0.22).paddingOuter(0.06);
  const bw = x.bandwidth();
  const max = Math.max(1e-9, ...m.months.map((x0) => Math.max(x0.from ?? 0, x0.to ?? 0)));
  const y = scaleLinear().domain([0, max * 1.08]).range([r.y + mainH, r.y + 8 * s]);
  const norme = ctx.spec.norme.enabled;
  const fromFill = norme ? normeInk(theme).py : GREY_TOTAL(ctx);
  const toFill = ink.strong;
  g.append("line").attr("x1", r.x).attr("x2", r.x + W).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  for (const t of y.ticks(4)) {
    if (!t) continue;
    g.append("line").attr("x1", r.x).attr("x2", r.x + W).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
    g.append("text").attr("x", r.x - 8 * s).attr("y", y(t)).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", 11.5 * s).attr("fill", theme.faint).text(compact(t, { ...f, sv: f.v }));
  }
  const dmax = Math.max(0, ...m.months.map((x0) => x0.delta ?? 0));
  const dmin = Math.min(0, ...m.months.map((x0) => x0.delta ?? 0));
  const span = Math.max(1e-9, dmax - dmin);
  const vy0 = r.y + mainH + tickH + gap + 14 * s;
  const yv = scaleLinear().domain([dmin - (dmin < 0 ? span * 0.28 : 0), dmax + (dmax > 0 ? span * 0.28 : 0)]).range([vy0 + varH - 14 * s, vy0]);
  const good = (d: number) => (m.costOnly ? d < 0 : d > 0);
  const tiny = (d: number) => Math.abs(d) < Math.abs(m.fromTotal / 12) * 0.03;
  m.months.forEach((mo, i) => {
    const p = stagger(frame.build, i, 12, 0.5);
    const x0 = x(mo.key)!;
    const half = bw * 0.5;
    if (mo.from != null) g.append("rect").attr("class", "r4d-drill-ref").attr("x", x0).attr("y", y(mo.from * p)).attr("width", half - 1 * s).attr("height", Math.max(0, y(0) - y(mo.from * p))).attr("fill", fromFill).attr("rx", 2 * s);
    if (mo.to != null) {
      const rc = g.append("rect").attr("class", "r4d-drill-mark").attr("x", x0 + half + 1 * s).attr("y", y(mo.to * p)).attr("width", half - 1 * s).attr("height", Math.max(0, y(0) - y(mo.to * p))).attr("rx", 2 * s);
      if (norme) rc.attr("fill", theme.bg).attr("stroke", normeInk(theme).ac).attr("stroke-width", 1.4 * s);
      else rc.attr("fill", toFill);
    }
    g.append("text").attr("x", x0 + bw / 2).attr("y", y(0) + 16 * s).attr("text-anchor", "middle").attr("font-size", 12.5 * s).attr("font-weight", m.breakAt === i ? 700 : 400).attr("fill", m.breakAt === i ? ink.text : ink.muted).text(mo.tick);
    // écart du mois
    if (mo.delta != null) {
      const d = mo.delta * p;
      const col = tiny(mo.delta) ? ink.muted : good(mo.delta) ? ink.pos : ink.neg;
      g.append("rect").attr("class", "r4d-drill-var").attr("x", x0 + bw * 0.12).attr("y", Math.min(yv(0), yv(d))).attr("width", bw * 0.76).attr("height", Math.max(1 * s, Math.abs(yv(d) - yv(0)))).attr("fill", col).attr("rx", 2 * s);
      if (p > 0.8) {
        const below = mo.delta < 0;
        g.append("text").attr("x", x0 + bw / 2).attr("y", below ? yv(d) + 14 * s : yv(d) - 5 * s).attr("text-anchor", "middle").attr("font-size", 11.5 * s).attr("font-weight", 700).attr("fill", col).text(compact(mo.delta, f));
      }
    }
  });
  g.append("line").attr("x1", r.x).attr("x2", r.x + W).attr("y1", yv(0)).attr("y2", yv(0)).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
  g.append("text").attr("x", r.x).attr("y", vy0 - 10 * s).attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", ink.muted).text(`Écart ${m.toLabel} vs ${m.fromLabel}${m.costOnly ? " (coûts : une hausse est défavorable)" : ""}`);
  // rupture
  if (m.breakAt != null && frame.build > 0.85) {
    const xb = x(m.breakAt)! - (x.step() - bw) / 2;
    g.append("line").attr("class", "r4d-drill-break").attr("x1", xb).attr("x2", xb).attr("y1", r.y + 4 * s).attr("y2", vy0 + varH).attr("stroke", ink.text).attr("stroke-width", 1.4 * s).attr("stroke-dasharray", `${5 * s} ${3 * s}`);
    g.append("text").attr("x", xb + 6 * s).attr("y", r.y + 14 * s).attr("font-size", 12.5 * s).attr("font-weight", 700).attr("fill", ink.text).text(`à partir de ${MONTH_LONG[m.breakAt]!.toLocaleLowerCase("fr-FR")}`);
  }
  // totaux à droite
  if (frame.build > 0.6) {
    const tx = r.x + W + 22 * s;
    const op = Math.min(1, (frame.build - 0.6) / 0.3);
    const gt = g.append("g").attr("opacity", op);
    const rr = m.fromTotal ? m.delta / Math.abs(m.fromTotal) : 0;
    const col = Math.abs(rr) < 0.005 ? ink.muted : good(m.delta) ? ink.pos : ink.neg;
    const rows: [string, string, string, number][] = [
      [m.fromLabel, f.v(m.fromTotal), ink.muted, 400],
      [m.toLabel, f.v(m.toTotal), ink.text, 700],
      ["Écart", `${f.sv(m.delta)}`, col, 700],
      ["", pctTxt(rr), col, 700],
      ["1er semestre", f.sv(m.h1), ink.muted, 400],
      ["2nd semestre", f.sv(m.h2), ink.muted, 400],
    ];
    let yy = r.y + 24 * s;
    rows.forEach(([a, b, c, w], k) => {
      if (k === 4) yy += 14 * s;
      if (a) gt.append("text").attr("x", tx).attr("y", yy).attr("font-size", 12 * s).attr("fill", ink.muted).text(a);
      gt.append("text").attr("x", tx).attr("y", yy + (a ? 19 * s : 0)).attr("font-size", 17 * s).attr("font-weight", w).attr("fill", c).text(b);
      yy += a ? 46 * s : 26 * s;
    });
  }
}

/** Montant court pour les petites étiquettes (+55 k€, −0,4 M€). */
function compact(v: number, f: Fmt): string {
  return f.sv(v).replace(/(\d)[\u202f\u00a0 ](\d{3})(?!\d)/g, "$1$2");
}

/* ------------------------------------------------------------------ tableau croisé */

function pivotColors(ctx: DrawCtx, m: PivotModel): string[] {
  const ink = inkOf(ctx);
  if (m.seriesField === "@version") return [GREY_TOTAL(ctx), ink.strong];
  if (m.series.length === 1) return [ink.strong];
  return m.series.map((_, i) => ctx.colors[i % ctx.colors.length]!);
}

function drawPivot(g: G, r: PlotRect, ctx: DrawCtx, m: PivotModel, f: Fmt) {
  const { s, frame, font, theme } = ctx;
  const ink = inkOf(ctx);
  const cols = pivotColors(ctx, m);
  const lineH = 14 * s;
  const tickH = (m.xIsTime ? 1 : 2) * lineH + 14 * s;
  const top = 18 * s;
  const plotH = r.h - tickH - top;
  const vals = m.series.flatMap((x) => x.values.filter((v): v is number => v != null));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals, 1e-9);
  const pad = (hi - lo) * 0.12;
  const y = scaleLinear().domain([lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0]).range([r.y + top + plotH, r.y + top]);
  // Marge gauche : graduations alignées à droite, hors des barres
  const gx = 56 * s;
  const x = scaleBand<number>().domain(m.keys.map((_, i) => i)).range([r.x + gx, r.x + r.w]).paddingInner(m.chart === "line" ? 0 : 0.25).paddingOuter(m.chart === "line" ? 0.3 : 0.08);
  const bw = x.bandwidth();
  const y0 = y(0);
  for (const t of y.ticks(4)) {
    if (!t) continue;
    g.append("line").attr("x1", r.x + gx).attr("x2", r.x + r.w).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
    g.append("text").attr("x", r.x + gx - 6 * s).attr("y", y(t) + 4 * s).attr("text-anchor", "end").attr("font-size", 11.5 * s).attr("fill", theme.faint).text(compact(t, f));
  }
  const ns = m.series.length;
  const totalBars = ns * m.keys.length;
  const labels = m.chart === "bar" && totalBars <= 28;
  // Étiquettes de valeur : toutes si les barres sont assez larges, sinon les 2 séries qui pèsent le plus
  const subW = (x.bandwidth() / Math.max(1, ns)) * 0.88;
  const labelled = new Set(subW >= 44 * s ? m.series.map((se) => se.key) : [...m.series].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 2).map((se) => se.key));
  const tickY = r.y + top + plotH + 18 * s;
  m.keys.forEach((k, i) => {
    const x0 = x(i)!;
    const cat = m.catValues[i];
    const gk = g.append("g").attr("class", `r4d-drill-pivot-key${cat ? " r4d-drill-hit" : ""}`).attr("data-drill-kind", cat && !cat.startsWith("Autres (") ? "cat" : null).attr("data-drill-field", cat ? m.x : null).attr("data-drill-value", cat).style("cursor", cat ? "pointer" : "default");
    if (cat) gk.append("rect").attr("class", "r4d-drill-hitbox").attr("x", x0 - (x.step() - bw) / 2).attr("y", r.y).attr("width", x.step()).attr("height", r.h).attr("fill", "transparent");
    const lines = m.xIsTime ? [k] : wrap(k, x.step() - 4 * s, 12 * s, font, 500, 2);
    lines.forEach((ln, j) => gk.append("text").attr("x", x0 + bw / 2).attr("y", tickY + j * lineH).attr("text-anchor", "middle").attr("font-size", 12 * s).attr("fill", ink.text).text(ln));
    if (m.chart !== "bar") return;
    const sub = bw / ns;
    m.series.forEach((se, j) => {
      const v = se.values[i];
      if (v == null) return;
      const p = stagger(frame.build, i * ns + j, totalBars, 0.5);
      const vv = v * p;
      const fill = m.isDelta && ns === 1 ? (Math.abs(v) < 1e-9 ? ink.muted : v > 0 ? ink.pos : ink.neg) : cols[j]!;
      gk.append("rect").attr("class", "r4d-drill-mark").attr("x", x0 + j * sub + sub * 0.06).attr("y", Math.min(y(vv), y0)).attr("width", sub * 0.88).attr("height", Math.max(0, Math.abs(y(vv) - y0))).attr("rx", Math.min(2.5 * s, sub / 6)).attr("fill", fill);
      if (labels && p > 0.8 && sub > 22 * s && labelled.has(se.key)) {
        const fsz = Math.min(12.5 * s, Math.max(10.5 * s, sub * 0.24));
        gk.append("text").attr("x", x0 + j * sub + sub / 2).attr("y", v < 0 ? y(vv) + fsz + 3 * s : y(vv) - 5 * s).attr("text-anchor", "middle").attr("font-size", fsz).attr("font-weight", 600).attr("fill", m.isDelta && ns === 1 ? fill : ink.text).text(compact(v, m.isDelta ? f : { ...f, sv: f.v }));
      }
    });
  });
  g.append("line").attr("x1", r.x + gx).attr("x2", r.x + r.w).attr("y1", y0).attr("y2", y0).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  if (m.chart === "line") {
    const upto = Math.max(1, Math.round(m.keys.length * Math.min(1, frame.build * 1.1)));
    m.series.forEach((se, j) => {
      let d = "";
      se.values.forEach((v, i) => {
        if (v == null || i >= upto) return;
        d += `${d ? "L" : "M"}${(x(i)! + bw / 2).toFixed(1)},${y(v).toFixed(1)}`;
      });
      g.append("path").attr("class", "r4d-drill-mark").attr("d", d).attr("fill", "none").attr("stroke", cols[j]!).attr("stroke-width", 3 * s).attr("stroke-linejoin", "round");
      se.values.forEach((v, i) => v != null && i < upto && g.append("circle").attr("cx", x(i)! + bw / 2).attr("cy", y(v)).attr("r", 3.5 * s).attr("fill", cols[j]!));
      const li = Math.min(upto, se.values.length) - 1;
      const lv = se.values[li];
      if (frame.build > 0.9 && lv != null && ns <= 6) haloText(g, x(li)! + bw / 2 + 8 * s, y(lv) + 4 * s, f.v(lv), 12.5 * s, cols[j]!, ink, { anchor: "start", weight: 700 });
    });
  }
}
