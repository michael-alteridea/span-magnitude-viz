/**
 * Moteur de rendu du Studio : prépare les données de la frame (agrégation, 4D),
 * puis dessine le cadre éditorial (titre, sous-titre, légende, source, signature)
 * et le graphique, le tout dans un unique <svg> autonome.
 */
import { select } from "d3";
import type { ChartSpec } from "../spec";
import { isBarType, isCartesian, isRadial, isSpecial, chartSize } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import {
  allRows,
  buildModel,
  buildTimeModel,
  interpolatedPoints,
  weightsAt,
  xIsTimeField,
  type CatModel,
  type Model,
  type TimeModel,
} from "../data/model";
import { fontStack, paletteColors, themeFor, type Theme } from "../theme";
import { catExtent, drawCategorical, drawScatter, y2Color, y2Extent } from "./cartesian";
import { drawPie, drawRadialBars, slicesOf } from "./radial";
import type { Domains, DrawCtx, Frame, G, PlotRect, Prepared } from "./context";
import { measure, wrap } from "./text";

export type { Frame, Prepared, PlotRect };

/* ------------------------------------------------------------ préparation */

export interface PrepCache {
  key: string;
  full: Model | null;
  time: TimeModel | null;
  frozen: Domains;
  error: string | null;
  warnings: string[];
}

function validate(spec: ChartSpec, ds: Dataset | null): { error: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!ds || !ds.rows.length) return { error: "Aucune donnée — importez un fichier, collez un tableau ou choisissez un exemple.", warnings };
  const enc = spec.encoding;
  const t = spec.type;
  if (isSpecial(t)) return { error: null, warnings };
  const ys = enc.y.filter((f) => columnOf(ds, f));
  if (enc.aggregate !== "count" && !ys.length) return { error: "Choisissez au moins une mesure numérique pour l'axe Y (valeur).", warnings };
  for (const f of ys) {
    const c = columnOf(ds, f)!;
    if (c.type !== "number" && enc.aggregate !== "count") return { error: `« ${f} » n'est pas numérique : choisissez une mesure, ou l'agrégat « Nombre de lignes ».`, warnings };
  }
  if (t === "scatter") {
    const x = columnOf(ds, enc.x);
    if (!x) return { error: "Le nuage de points a besoin d'un axe X (nombre ou date).", warnings };
  }
  if ((isCartesian(t) || isRadial(t)) && t !== "scatter" && !enc.x && !(isRadial(t) && ys.length > 1)) {
    warnings.push("Sans axe X, toutes les lignes sont agrégées en une seule valeur.");
  }
  if (spec.axes.y.scale === "log") warnings.push("Échelle log : les valeurs ≤ 0 sont ignorées.");
  if (enc.y2 && !columnOf(ds, enc.y2)) return { error: `Colonne introuvable pour l'axe Y secondaire : ${enc.y2}`, warnings };
  return { error: null, warnings };
}

function domainsOf(model: Model, spec: ChartSpec): Domains {
  const stacked = spec.type === "stackedBar" || spec.type === "stackedArea";
  if (model.kind === "cat") {
    const d: Domains = { y: catExtent(model, stacked, spec.style.normalize && stacked), y2: y2Extent(model) };
    if (model.xKind !== "band") {
      const k = model.keys as number[];
      if (k.length) d.x = [Math.min(...k), Math.max(...k)];
    }
    if (isRadial(spec.type)) {
      const sl = slicesOf(model, ["#000"]);
      d.y = [0, Math.max(1e-9, ...sl.map((x) => x.value))];
    }
    return d;
  }
  const xs = model.points.map((p) => p.x).filter((x): x is number => typeof x === "number");
  const ys = model.points.map((p) => p.y);
  const zs = model.points.map((p) => p.size ?? 0);
  return {
    x: xs.length ? [Math.min(...xs), Math.max(...xs)] : undefined,
    y: ys.length ? [Math.min(...ys), Math.max(...ys)] : undefined,
    size: zs.length ? [0, Math.max(...zs)] : undefined,
  };
}

function unionDomain(a: [number, number] | undefined, b: [number, number] | undefined): [number, number] | undefined {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

export function fourDActive(spec: ChartSpec, ds: Dataset | null): boolean {
  return spec.mode.kind === "dynamic" && spec.mode.fourD.enabled && !!columnOf(ds, spec.encoding.time) && !isSpecial(spec.type);
}

/** Calcule (et met en cache) le modèle complet, le modèle temporel et les domaines figés. */
export function prepareCache(spec: ChartSpec, ds: Dataset | null, prev: PrepCache | null, dsVersion: number): PrepCache {
  const key = JSON.stringify([dsVersion, spec.type, spec.encoding, spec.style.sort, spec.style.normalize, spec.mode, spec.axes.x.scale]);
  if (prev && prev.key === key) return prev;
  const { error, warnings } = validate(spec, ds);
  if (error || !ds || isSpecial(spec.type)) return { key, full: null, time: null, frozen: {}, error, warnings };
  const full = buildModel(spec, ds, allRows(ds));
  const time = fourDActive(spec, ds) ? buildTimeModel(spec, ds) : null;
  let frozen: Domains = {};
  if (time && spec.mode.fourD.freezeScales) {
    frozen = domainsOf(full, spec);
    if (spec.mode.fourD.mode === "snapshot" && !xIsTimeField(spec)) {
      let acc: Domains = {};
      const fixedKeys = full.kind === "cat" ? full.keys : undefined;
      const fixedSeries = full.kind === "cat" ? full.series : undefined;
      for (let i = 0; i < time.steps.length; i++) {
        const m = buildModel(spec, ds, weightsAt(ds, time, i, "snapshot"), { fixedKeys, fixedSeries });
        const d = domainsOf(m, spec);
        acc = { y: unionDomain(acc.y, d.y), y2: unionDomain(acc.y2, d.y2), x: unionDomain(acc.x, d.x), size: unionDomain(acc.size, d.size) };
      }
      frozen = { ...frozen, ...acc };
    }
  }
  if (full.kind === "cat" && !full.keys.length) return { key, full, time, frozen, error: "Aucune valeur exploitable avec cet encodage.", warnings };
  if (full.kind === "points" && !full.points.length) return { key, full, time, frozen, error: "Aucun point exploitable (X et Y doivent être renseignés).", warnings };
  if (time && time.steps.length < 2) warnings.push("Le champ temporel n'a qu'une seule valeur : rien à animer.");
  return { key, full, time, frozen, error: null, warnings };
}

export function prepareFrame(spec: ChartSpec, ds: Dataset | null, cache: PrepCache, frame: Frame): Prepared {
  const base: Prepared = { model: cache.full, domains: {}, reveal: null, stamp: null, progress: null, warnings: cache.warnings, error: cache.error };
  if (cache.error || !cache.full || !ds) return base;
  const tm = cache.time;
  if (!tm || frame.timePos == null || tm.steps.length < 2) return base;
  const n = tm.steps.length;
  const pos = Math.max(0, Math.min(n - 1, frame.timePos));
  const out: Prepared = { ...base, domains: cache.frozen, stamp: tm.label(pos), progress: pos / (n - 1) };
  if (xIsTimeField(spec) && cache.full.kind === "cat") {
    out.reveal = pos;
    return out;
  }
  if (spec.type === "scatter" && spec.mode.fourD.mode === "snapshot") {
    out.model = interpolatedPoints(spec, ds, tm, pos);
    return out;
  }
  const rows = weightsAt(ds, tm, pos, spec.mode.fourD.mode);
  const full = cache.full;
  out.model = buildModel(spec, ds, rows, full.kind === "cat" ? { fixedKeys: full.keys, fixedSeries: full.series } : undefined);
  return out;
}

/* ------------------------------------------------------------ légende */

interface LegendItem {
  label: string;
  color: string;
  shape: "square" | "line" | "dot" | "dash";
}

function legendItems(spec: ChartSpec, model: Model | null, colors: string[], neutral: string): LegendItem[] {
  if (!model) return [];
  const t = spec.type;
  if (model.kind === "points") {
    if (model.series.length <= 1 && !spec.encoding.series) return [];
    return model.series.slice(0, 24).map((s, i) => ({ label: s, color: colors[i % colors.length]!, shape: "dot" }));
  }
  if (isRadial(t)) {
    if (spec.style.legend === "auto" || spec.style.legend === "none") return [];
    return slicesOf(model, colors).map((s) => ({ label: s.label, color: s.color, shape: "square" }));
  }
  const items: LegendItem[] = [];
  const shape: LegendItem["shape"] = t === "line" ? "line" : "square";
  if (model.series.length > 1 || spec.encoding.series || (spec.encoding.y2 && model.series.length >= 1))
    model.series.forEach((s, i) => items.push({ label: s, color: colors[i % colors.length]!, shape }));
  if (spec.encoding.y2 && model.y2) {
    const nS = model.series.length;
    const c = y2Color(nS, colors, neutral);
    items.push({ label: `${model.y2Name} (axe droit)`, color: c, shape: isBarType(t) ? "line" : "dash" });
  }
  return items;
}

function drawSwatch(g: G, it: LegendItem, x: number, y: number, s: number, theme: Theme) {
  const sz = 12 * s;
  if (it.shape === "square") g.append("rect").attr("x", x).attr("y", y - sz / 2).attr("width", sz).attr("height", sz).attr("rx", 2.5 * s).attr("fill", it.color);
  else if (it.shape === "dot") g.append("circle").attr("cx", x + sz / 2).attr("cy", y).attr("r", sz / 2).attr("fill", it.color);
  else {
    g.append("line").attr("x1", x - 2 * s).attr("x2", x + sz + 2 * s).attr("y1", y).attr("y2", y).attr("stroke", it.color).attr("stroke-width", 3 * s).attr("stroke-linecap", "round").attr("stroke-dasharray", it.shape === "dash" ? `${4 * s} ${3 * s}` : null);
    g.append("circle").attr("cx", x + sz / 2).attr("cy", y).attr("r", 3 * s).attr("fill", theme.bg).attr("stroke", it.color).attr("stroke-width", 2 * s);
  }
}

/** Légende horizontale (retour à la ligne) ; renvoie la hauteur utilisée. */
function layoutLegendRow(g: G, items: LegendItem[], x: number, y: number, maxW: number, s: number, font: string, theme: Theme, draw: boolean): number {
  const fs = 13 * s;
  const rowH = 22 * s;
  let cx = 0;
  let cy = rowH / 2;
  for (const it of items) {
    const w = 12 * s + 7 * s + Math.min(measure(it.label, fs, font), maxW * 0.6) + 18 * s;
    if (cx > 0 && cx + w > maxW) {
      cx = 0;
      cy += rowH;
    }
    if (draw) {
      drawSwatch(g, it, x + cx, y + cy, s, theme);
      g.append("text").attr("x", x + cx + 19 * s).attr("y", y + cy).attr("dy", "0.35em").attr("font-size", fs).attr("font-family", font).attr("fill", theme.muted).text(it.label);
    }
    cx += w;
  }
  return items.length ? cy + rowH / 2 : 0;
}

/* ------------------------------------------------------------ rendu */

export interface RenderResult {
  plot: PlotRect;
  theme: Theme;
  prepared: Prepared;
  width: number;
  height: number;
}

/**
 * Dessine le graphique complet dans `svgEl` (vidé au préalable).
 * Pour les types spéciaux (film, carte), seul le cadre est dessiné : la zone `plot`
 * est remplie par la bibliothèque span-magnitude.
 */
export function renderChart(svgEl: SVGSVGElement, spec: ChartSpec, ds: Dataset | null, cache: PrepCache, frame: Frame): RenderResult {
  const { width: W, height: H } = chartSize(spec);
  const theme = themeFor(spec);
  const colors = paletteColors(spec, theme);
  const font = fontStack(spec.style.font);
  const s = Math.sqrt(W * H) / Math.sqrt(1200 * 675);
  const prep = prepareFrame(spec, ds, cache, frame);

  const svg = select(svgEl);
  svg.selectAll("*").remove();
  svg
    .attr("xmlns", "http://www.w3.org/2000/svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("font-family", font)
    .attr("role", "img")
    .attr("aria-label", spec.style.title || "Graphique Reporting 4D");
  const root = svg.append("g") as unknown as G;
  root.append("rect").attr("class", "r4d-bg").attr("width", W).attr("height", H).attr("fill", theme.bg);

  const pad = 40 * s;
  let y = pad;
  const innerW = W - pad * 2;

  // ---- titre / sous-titre
  if (spec.style.accentBar) {
    root.append("rect").attr("x", pad).attr("y", y).attr("width", 44 * s).attr("height", 5 * s).attr("rx", 2.5 * s).attr("fill", theme.accent);
    y += 5 * s + 14 * s;
  }
  if (spec.style.title) {
    const ts = 32 * s;
    const lines = wrap(spec.style.title, innerW, ts, font, 700, 2);
    lines.forEach((l, i) => {
      root.append("text").attr("class", "r4d-title").attr("x", pad).attr("y", y + ts * 0.8 + i * ts * 1.15).attr("font-size", ts).attr("font-weight", 700).attr("fill", theme.text).attr("letter-spacing", -0.3 * s).text(l);
    });
    y += lines.length * ts * 1.15 + 4 * s;
  }
  if (spec.style.subtitle) {
    const ss = 17 * s;
    const lines = wrap(spec.style.subtitle, innerW, ss, font, 400, 2);
    lines.forEach((l, i) => root.append("text").attr("class", "r4d-subtitle").attr("x", pad).attr("y", y + ss * 0.85 + i * ss * 1.3).attr("font-size", ss).attr("fill", theme.muted).text(l));
    y += lines.length * ss * 1.3 + 4 * s;
  }

  // ---- pied : source + signature
  const fsz = 12 * s;
  const footY = H - pad * 0.75;
  let footH = 0;
  const brandW = spec.style.brandMark ? measure("REPORTING 4D · alteridea", fsz, font, 700) + 10 * s : 0;
  if (spec.style.source) {
    const lines = wrap(spec.style.source, innerW - brandW - 20 * s, fsz, font, 400, 2);
    lines.forEach((l, i) => root.append("text").attr("class", "r4d-source").attr("x", pad).attr("y", footY - (lines.length - 1 - i) * fsz * 1.3).attr("font-size", fsz).attr("fill", theme.faint).text(l));
    footH = lines.length * fsz * 1.3 + 10 * s;
  }
  if (spec.style.brandMark) {
    const t = root.append("text").attr("class", "r4d-brand").attr("x", W - pad).attr("y", footY).attr("text-anchor", "end").attr("font-size", fsz).attr("font-weight", 700).attr("letter-spacing", 0.6 * s).attr("fill", theme.faint);
    t.append("tspan").text("REPORTING ");
    t.append("tspan").attr("fill", theme.accent).text("4D");
    t.append("tspan").attr("font-weight", 400).text(" · alteridea");
    footH = Math.max(footH, fsz + 10 * s);
  }

  // ---- légende
  const items = legendItems(spec, prep.model, colors, theme.text);
  let legendPos = spec.style.legend === "auto" ? (items.length ? "top" : "none") : spec.style.legend;
  if (!items.length) legendPos = "none";
  let plot: PlotRect;
  const gLegend = root.append("g").attr("class", "r4d-legend");
  y += 12 * s;
  if (legendPos === "top") {
    const h = layoutLegendRow(gLegend, items, pad, y, innerW, s, font, theme, true);
    y += h + 14 * s;
    plot = { x: pad, y, w: innerW, h: H - pad - footH - y };
  } else if (legendPos === "bottom") {
    const h = layoutLegendRow(gLegend, items, pad, 0, innerW, s, font, theme, false);
    const ly = H - pad - footH - h;
    layoutLegendRow(gLegend, items, pad, ly, innerW, s, font, theme, true);
    plot = { x: pad, y: y + 6 * s, w: innerW, h: ly - y - 22 * s };
  } else if (legendPos === "right") {
    const lw = Math.min(innerW * 0.28, Math.max(...items.map((i) => measure(i.label, 13 * s, font))) + 40 * s);
    items.forEach((it, i) => {
      const yy = y + 12 * s + i * 24 * s;
      drawSwatch(gLegend, it, W - pad - lw + 4 * s, yy, s, theme);
      gLegend.append("text").attr("x", W - pad - lw + 23 * s).attr("y", yy).attr("dy", "0.35em").attr("font-size", 13 * s).attr("fill", theme.muted).text(it.label);
    });
    plot = { x: pad, y: y + 6 * s, w: innerW - lw - 16 * s, h: H - pad - footH - y - 6 * s };
  } else {
    plot = { x: pad, y: y + 6 * s, w: innerW, h: H - pad - footH - y - 6 * s };
  }
  plot.h = Math.max(40, plot.h);

  const ctx: DrawCtx = { spec, ds: ds!, theme, colors, font, s, W, H, frame, prep };
  const gChart = root.append("g").attr("class", "r4d-chart") as unknown as G;

  if (isSpecial(spec.type)) return { plot, theme, prepared: prep, width: W, height: H };

  if (prep.error || !prep.model) {
    const msg = prep.error ?? "Encodage incomplet.";
    const lines = wrap(msg, Math.min(plot.w * 0.8, 640 * s), 16 * s, font, 400, 4);
    gChart.append("rect").attr("x", plot.x).attr("y", plot.y).attr("width", plot.w).attr("height", plot.h).attr("rx", 10 * s).attr("fill", "none").attr("stroke", theme.grid).attr("stroke-dasharray", `${6 * s} ${6 * s}`);
    lines.forEach((l, i) => gChart.append("text").attr("class", "r4d-empty").attr("x", plot.x + plot.w / 2).attr("y", plot.y + plot.h / 2 + (i - (lines.length - 1) / 2) * 22 * s).attr("text-anchor", "middle").attr("font-size", 16 * s).attr("fill", theme.muted).text(l));
    return { plot, theme, prepared: prep, width: W, height: H };
  }

  // ---- tampon 4D (filigrane) sous les marques : en haut à droite (zone la plus libre, tri décroissant), en bas pour les circulaires
  if (prep.stamp) {
    const big = Math.min(plot.h * 0.26, 110 * s);
    gChart
      .append("text")
      .attr("class", "r4d-stamp")
      .attr("x", plot.x + plot.w - 8 * s)
      .attr("y", isRadial(spec.type) ? plot.y + plot.h : plot.y + big * 0.82 + 6 * s)
      .attr("text-anchor", "end")
      .attr("font-size", big)
      .attr("font-weight", 700)
      .attr("fill", theme.text)
      .attr("fill-opacity", spec.mode.fourD.stamp ? 0.13 : 0)
      .attr("letter-spacing", -1 * s)
      .text(prep.stamp);
  }

  const model = prep.model;
  if (model.kind === "points") drawScatter(gChart, plot, ctx, model);
  else if (spec.type === "pie" || spec.type === "donut") drawPie(gChart, plot, ctx, model as CatModel, spec.type === "donut");
  else if (spec.type === "radialBar") drawRadialBars(gChart, plot, ctx, model as CatModel);
  else drawCategorical(gChart, plot, ctx, model as CatModel);

  // ---- barre de progression façon pellicule (4D)
  if (prep.progress != null) {
    const by = H - 3 * s;
    root.append("rect").attr("x", 0).attr("y", by).attr("width", W).attr("height", 3 * s).attr("fill", theme.track);
    root.append("rect").attr("class", "r4d-progress").attr("x", 0).attr("y", by).attr("width", W * prep.progress).attr("height", 3 * s).attr("fill", theme.accent);
  }
  return { plot, theme, prepared: prep, width: W, height: H };
}

export { themeFor, paletteColors };
