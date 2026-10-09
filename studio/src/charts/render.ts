/**
 * Moteur de rendu du Studio : prépare les données de la frame (agrégation, 4D),
 * puis dessine le cadre éditorial (titre, sous-titre, légende, source, signature)
 * et le graphique, le tout dans un unique <svg> autonome.
 */
import { elemKey, markColor, seriesKey } from "./overrides";
import { groupIcons } from "./pointIcons";
import { drawIcon } from "./icons";
import { select } from "d3";
import type { ChartSpec } from "../spec";
import { isBarType, isCartesian, isDrill, isRadial, isSpecial, isVariance, chartSize } from "../spec";
import { buildDrillModel, type DrillCtx, type DrillModel } from "../data/drill";
import { drawDrill, drillLegend } from "./drill";
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
import { ellipsize, measure, wrap } from "./text";
import { effectiveDataset } from "../data/transform";
import { buildVarianceModel, type VarianceModel } from "../data/variance";
import { drawVariance, refLabelOf, refStyleFor } from "./variance";
import { normeAdvice, normeInk, scaleKey, scenarioOf, scenarioStyle, SCENARIO_NAMES } from "../norme";
import { PRODUCT_LABEL, showSignature } from "../brand";
import { drawCartouche, layoutCartouche } from "./cartouche";

export type { Frame, Prepared, PlotRect };

/* ------------------------------------------------------------ préparation */

export interface PrepCache {
  key: string;
  variance?: VarianceModel | null;
  drill?: { model: DrillModel; ctx: DrillCtx } | null;
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
  if (isSpecial(t) || isDrill(t)) return { error: null, warnings };
  if (isVariance(t)) {
    const ys2 = enc.y.filter((f) => columnOf(ds, f)?.type === "number");
    if (ys2.length < 2) return { error: "Le graphique d'écarts compare deux mesures : choisissez le réel (Y1) puis la référence — budget, N-1 ou prévision (Y2).", warnings };
    return { error: null, warnings };
  }
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
  return spec.mode.kind === "dynamic" && spec.mode.fourD.enabled && !!columnOf(ds, spec.encoding.time) && !isSpecial(spec.type) && !isVariance(spec.type) && !isDrill(spec.type);
}

/** Calcule (et met en cache) le modèle complet, le modèle temporel et les domaines figés. */
export function prepareCache(spec: ChartSpec, rawDs: Dataset | null, prev: PrepCache | null, dsVersion: number): PrepCache {
  const key = JSON.stringify([dsVersion, spec.type, spec.encoding, spec.style.sort, spec.style.normalize, spec.style.horizontal, spec.mode, spec.axes.x.scale, spec.transform, spec.dataset ?? null, spec.variance, spec.norme.enabled, spec.norme.autoSwitch, spec.type === "drill" ? spec.drill : null]);
  if (prev && prev.key === key) return prev;
  const ds = rawDs ? effectiveDataset(spec, rawDs) : null;
  const { error, warnings } = validate(spec, ds);
  if (spec.norme.enabled) {
    const adv = normeAdvice(spec, ds);
    if (adv?.soft) warnings.push(adv.notice);
  }
  if (error || !ds || isSpecial(spec.type)) return { key, full: null, time: null, frozen: {}, error, warnings };
  if (isDrill(spec.type)) {
    const { model, ctx, error: e } = buildDrillModel(spec, rawDs);
    if (!model || !ctx) return { key, full: null, time: null, frozen: {}, error: e ?? "Exploration impossible avec ces données.", warnings, drill: null };
    return { key, full: null, time: null, frozen: {}, error: null, warnings, drill: { model, ctx } };
  }
  if (isVariance(spec.type)) {
    const vm = buildVarianceModel(spec, ds);
    if (!vm || !vm.keys.length) return { key, full: null, time: null, frozen: {}, error: "Aucune ligne où le réel et la référence sont tous deux renseignés.", warnings, variance: null };
    if (vm.coverage < 0.999 && vm.coverage > 0) warnings.push(`Écarts calculés sur les lignes où les deux scénarios sont renseignés (${Math.round(vm.coverage * 100)} % des lignes avec réel).`);
    return { key, full: null, time: null, frozen: {}, error: null, warnings, variance: vm };
  }
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

/**
 * Maximum de l'axe des valeurs d'un graphique (échelles communes de l'histoire / du PowerPoint) ;
 * null si le type n'a pas d'échelle comparable.
 */
export function valueMaxOf(spec: ChartSpec, rawDs: Dataset | null): number | null {
  if (!rawDs || isDrill(spec.type) || !scaleKey(spec)) return null;
  const cache = prepareCache(spec, rawDs, null, -1);
  if (cache.error) return null;
  const vm = cache.variance;
  if (vm) {
    const v = [...vm.actual, ...vm.ref].filter(Number.isFinite);
    return v.length ? Math.max(...v) : null;
  }
  const full = cache.full;
  if (!full || full.kind !== "cat") return null;
  const stacked = spec.type === "stackedBar" || spec.type === "stackedArea";
  return catExtent(full, stacked, false)[1];
}

export function prepareFrame(spec: ChartSpec, rawDs: Dataset | null, cache: PrepCache, frame: Frame): Prepared {
  const ds = rawDs ? effectiveDataset(spec, rawDs) : null;
  const base: Prepared = { model: cache.full, domains: {}, reveal: null, stamp: null, progress: null, warnings: cache.warnings, error: cache.error, variance: cache.variance ?? null, drill: cache.drill ?? null };
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
  shape: "square" | "line" | "dot" | "dash" | "outline" | "hatch";
  /** Nuage de points en icônes : pictogramme du groupe (légende des icônes). */
  icon?: string | null;
}

function legendItems(spec: ChartSpec, model: Model | null, colors: string[], neutral: string, vm?: VarianceModel | null, theme?: Theme): LegendItem[] {
  const norme = spec.norme.enabled;
  if (vm && isVariance(spec.type)) {
    const st = refStyleFor(vm.refName, norme, spec.encoding.scenarios);
    const ink = normeInk(theme ?? { dark: true });
    const tag = (n: string) => {
      const c = norme ? scenarioOf(n, spec.encoding.scenarios) : null;
      return c ? ` (${c})` : "";
    };
    return [
      { label: vm.actualName.replace(/\s*\(.*\)\s*$/, "") + tag(vm.actualName), color: norme ? ink.ac : colors[0]!, shape: "square" },
      { label: refLabelOf(vm.refName) + tag(vm.refName), color: st === "grey" ? (norme ? ink.py : theme?.dark ? "#52525b" : "#c4c4c8") : norme ? ink.ac : neutral, shape: st === "grey" ? "square" : st },
    ];
  }
  if (!model) return [];
  const t = spec.type;
  if (norme && model.kind === "cat" && theme && !isRadial(t)) {
    const codes = model.series.map((s) => scenarioOf(s, spec.encoding.scenarios));
    if (codes.some(Boolean)) {
      const lineLike = t === "line" || t === "area" || t === "stackedArea";
      return model.series.map((s, i) => {
        const c = codes[i];
        if (!c) return { label: s, color: colors[i % colors.length]!, shape: lineLike ? "line" : "square" };
        const st = scenarioStyle(c, theme);
        const label = `${s.replace(/\s*\(.*\)\s*$/, "") || SCENARIO_NAMES[c]} (${c})`;
        if (lineLike) return { label, color: st.ink, shape: c === "PL" || c === "FC" ? "dash" : "line" };
        return { label, color: st.ink, shape: c === "PL" ? "outline" : c === "FC" ? "hatch" : "square" };
      });
    }
  }
  if (model.kind === "points") {
    if (model.series.length <= 1 && !spec.encoding.series) return [];
    const icons = groupIcons(spec, model.series);
    return model.series.slice(0, 24).map((s, i) => ({ label: s, color: markColor(spec, colors[i % colors.length]!, null, seriesKey(s)), shape: "dot", icon: icons[i] ?? null }));
  }
  if (isRadial(t)) {
    if (spec.style.legend === "auto" || spec.style.legend === "none") return [];
    return slicesOf(model, colors).map((s) => ({ label: s.label, color: markColor(spec, s.color, elemKey(s.label), null), shape: "square" }));
  }
  // Objectif (étape I) : réalisé en barres, objectif en repère
  if ((t === "bar" || t === "barH") && spec.style.barCap === "goal" && model.kind === "cat" && model.series.length >= 2 && !spec.encoding.series && !norme)
    return [
      { label: model.series[0]!, color: colors[0]!, shape: "square" },
      { label: model.series[1]!, color: neutral, shape: "line" },
    ];
  const items: LegendItem[] = [];
  const shape: LegendItem["shape"] = t === "line" ? "line" : "square";
  if (model.series.length > 1 || spec.encoding.series || (spec.encoding.y2 && model.series.length >= 1))
    model.series.forEach((s, i) => items.push({ label: s, color: markColor(spec, colors[i % colors.length]!, null, seriesKey(s)), shape }));
  if (spec.encoding.y2 && model.y2) {
    const nS = model.series.length;
    const c = y2Color(nS, colors, neutral);
    items.push({ label: `${model.y2Name} (axe droit)`, color: c, shape: isBarType(t) ? "line" : "dash" });
  }
  return items;
}

function drawSwatch(g: G, it: LegendItem, x: number, y: number, s: number, theme: Theme) {
  const sz = 12 * s;
  if (it.icon && drawIcon(g, it.icon, x + sz / 2, y, 16 * s, it.color, "r4d-legend-icon", true)) return;
  if (it.shape === "outline" || it.shape === "hatch") {
    g.append("rect").attr("x", x + 0.75 * s).attr("y", y - sz / 2 + 0.75 * s).attr("width", sz - 1.5 * s).attr("height", sz - 1.5 * s).attr("rx", 1.5 * s).attr("fill", "none").attr("stroke", it.color).attr("stroke-width", 1.5 * s);
    if (it.shape === "hatch") for (let k = 1; k <= 2; k++) g.append("line").attr("x1", x + (k * sz) / 3).attr("y1", y + sz / 2 - 1.5 * s).attr("x2", x + (k * sz) / 3 + sz / 4).attr("y2", y - sz / 2 + 1.5 * s).attr("stroke", it.color).attr("stroke-width", 1.4 * s);
  } else if (it.shape === "square") g.append("rect").attr("x", x).attr("y", y - sz / 2).attr("width", sz).attr("height", sz).attr("rx", 2.5 * s).attr("fill", it.color);
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
  /** Zone de la signature (coordonnées SVG), pour les contrôles et l'export. */
  cartouche: PlotRect | null;
}

/** Agrandissement des textes et marges des images de diapositive / snapshot. */
export const BARE_TEXT_BOOST = 1.3;

export interface RenderOptions {
  /** Sans titre, sous-titre, commentaires ni filet (image de diapositive / snapshot). */
  bare?: boolean;
  /** Vignette : rien que le graphique (Explorer, bandeau Histoire). */
  thumb?: boolean;
  /** Date de génération affichée (défaut : maintenant). */
  now?: Date;
  /** Échelle commune (histoire, PowerPoint) : maximum de l'axe des valeurs. */
  sharedMax?: number | null;
  /** Indicateur d'échelle (bas gauche) : échelle commune, ou différente des autres graphiques de même mesure. */
  scaleNote?: string | null;
  /** Agrandissement des textes imposé (page participant sur téléphone) ; défaut : BARE_TEXT_BOOST en mode bare. */
  textBoost?: number;
  /** QR du cartouche pointant vers ce lien (mode lecture) au lieu de la vérification de l'empreinte. */
  qrUrl?: string | null;
  /**
   * Toutes les puces « À retenir » qui apparaîtront (film, mode lecture) : la colonne ou le bandeau est
   * mis en page pour elles dès la première image, alors que `spec.story.comments` n'en contient encore
   * qu'une partie — le graphique est d'emblée à sa taille finale, sans saut.
   */
  commentsAll?: string[];
}

/**
 * Dessine le graphique complet dans `svgEl` (vidé au préalable).
 * Pour les types spéciaux (film, carte), seul le cadre est dessiné : la zone `plot`
 * est remplie par la bibliothèque span-magnitude.
 */
export function renderChart(svgEl: SVGSVGElement, spec: ChartSpec, rawDs: Dataset | null, cache: PrepCache, frame: Frame, opts: RenderOptions = {}): RenderResult {
  const ds = rawDs ? effectiveDataset(spec, rawDs) : null;
  const { width: W, height: H } = chartSize(spec);
  const theme = themeFor(spec);
  const colors = paletteColors(spec, theme);
  const font = fontStack(spec.style.font);
  // Image de diapositive (bare) : textes agrandis de 30 % pour rester lisibles une fois l'image réduite dans le PowerPoint
  const s = opts.thumb ? Math.max(0.5, Math.sqrt(W * H) / Math.sqrt(1200 * 675)) : (Math.sqrt(W * H) / Math.sqrt(1200 * 675)) * (opts.textBoost ?? (opts.bare ? BARE_TEXT_BOOST : 1));
  const prep = prepareFrame(spec, ds, cache, frame);
  const chrome = !opts.thumb;
  const texts = chrome && !opts.bare;

  const svg = select(svgEl);
  svg.selectAll("*").remove();
  svg
    .attr("xmlns", "http://www.w3.org/2000/svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("font-family", font)
    .attr("role", "img")
    .attr("aria-label", spec.style.title || `Graphique ${PRODUCT_LABEL}`);
  const root = svg.append("g") as unknown as G;
  root.append("rect").attr("class", "r4d-bg").attr("width", W).attr("height", H).attr("fill", theme.bg);

  const pad = (opts.thumb ? 14 : 40) * s;
  let y = pad;
  const innerW = W - pad * 2;

  // ---- titre / sous-titre
  if (texts && spec.style.accentBar) {
    root.append("rect").attr("class", "r4d-accent").attr("x", pad).attr("y", y).attr("width", 44 * s).attr("height", 5 * s).attr("rx", 2.5 * s).attr("fill", theme.accent);
    y += 5 * s + 14 * s;
  }
  if (texts && spec.style.title) {
    const ts = 32 * s;
    // format portrait (mode lecture sur téléphone / tablette) : le titre d'action garde toute sa phrase
    const lines = wrap(spec.style.title, innerW, ts, font, 700, H > W * 1.5 ? 5 : H > W ? 4 : 2);
    lines.forEach((l, i) => {
      root.append("text").attr("class", "r4d-title").attr("data-r4d-edit", "title").attr("x", pad).attr("y", y + ts * 0.8 + i * ts * 1.15).attr("font-size", ts).attr("font-weight", 700).attr("fill", theme.text).attr("letter-spacing", -0.3 * s).text(l);
    });
    y += lines.length * ts * 1.15 + 4 * s;
  }
  if (texts && spec.style.subtitle) {
    const ss = 17 * s;
    const lines = wrap(spec.style.subtitle, innerW, ss, font, 400, 2);
    lines.forEach((l, i) => root.append("text").attr("class", "r4d-subtitle").attr("data-r4d-edit", "subtitle").attr("x", pad).attr("y", y + ss * 0.85 + i * ss * 1.3).attr("font-size", ss).attr("fill", theme.muted).text(l));
    y += lines.length * ss * 1.3 + 4 * s;
  }

  // ---- commentaires « À retenir » : colonne à droite en paysage, bandeau en bas sinon.
  // La place est réservée dès qu'on sait qu'il y aura des commentaires (`showComments` +
  // `commentsAll` / commentaires non vides) : le graphique ne saute plus quand les puces
  // apparaissent (film, mode lecture, snapshots).
  const clean = (l: string[]) => (texts && spec.story.showComments ? l.map((c) => c.trim()).filter(Boolean).slice(0, 3) : []);
  const comments = clean(spec.story.comments);
  // mise en page calculée sur les commentaires à venir : colonne / bandeau et retours à la ligne identiques à chaque image
  const planned = opts.commentsAll ? clean(opts.commentsAll) : comments;
  const layoutComments = planned.length >= comments.length ? planned : comments;
  const sideComments = layoutComments.length > 0 && W / H >= 1.3;
  const colW = Math.max(220 * s, Math.min(innerW * 0.28, 340 * s));

  // ---- pied : cartouche Datanime (logo, lien, dates, source, empreinte, QR d'empreinte des données)
  // Sous la colonne « À retenir » quand elle existe (le graphique garde toute sa hauteur), sinon sur toute la largeur.
  let footH = 0;
  let colFootH = 0;
  let cartouche: PlotRect | null = null;
  if (chrome) {
    if (showSignature(spec)) {
      const lay = layoutCartouche(spec, s, font, opts.now ?? new Date(), opts.qrUrl ?? null);
      const x0 = W - pad - lay.w;
      const y0 = H - pad * 0.55 - lay.h;
      cartouche = drawCartouche(root, theme, lay, x0, y0);
      const reserve = H - y0 - pad + 10 * s;
      if (sideComments && !opts.scaleNote && lay.w <= colW + 14 * s) colFootH = reserve;
      else footH = reserve;
    } else if (spec.style.source) {
      const fsz = 12 * s;
      const lines = wrap(spec.style.source, innerW, fsz, font, 400, 2);
      const footY = H - pad * 0.75;
      lines.forEach((l, i) => root.append("text").attr("class", "r4d-source").attr("x", pad).attr("y", footY - (lines.length - 1 - i) * fsz * 1.3).attr("font-size", fsz).attr("fill", theme.faint).text(l));
      footH = lines.length * fsz * 1.3 + 10 * s;
    }
  }

  let contentW = innerW;
  const gCom = root.append("g").attr("class", "r4d-comments");
  if (sideComments || layoutComments.length) {
    const head = "À RETENIR";
    const hs = 12 * s;
    if (sideComments) {
      const x0 = W - pad - colW;
      const fs = 15 * s;
      const colBottom = H - pad - footH - colFootH;
      let cy = y + 16 * s;
      gCom.append("line").attr("x1", x0 - 16 * s).attr("x2", x0 - 16 * s).attr("y1", y + 6 * s).attr("y2", colFootH ? colBottom - 4 * s : H - pad - footH).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
      if (comments.length) {
        gCom.append("text").attr("class", "r4d-comments-head").attr("x", x0).attr("y", cy).attr("font-size", hs).attr("font-weight", 700).attr("letter-spacing", 1 * s).attr("fill", theme.accent).text(head);
        cy += 22 * s;
        const maxH = colBottom - cy;
        const maxLines = Math.max(2, Math.floor(maxH / Math.max(1, layoutComments.length) / (fs * 1.35)) - 1);
        comments.forEach((c, i) => {
          const g = gCom.append("g").attr("class", "r4d-comment").attr("data-index", i).attr("data-r4d-edit", `comment:${i}`);
          const lines = wrap(c, colW - 16 * s, fs, font, 400, Math.min(7, maxLines));
          g.append("rect").attr("x", x0).attr("y", cy + fs * 0.32 - 3.5 * s).attr("width", 7 * s).attr("height", 7 * s).attr("rx", 1.5 * s).attr("fill", theme.accent);
          lines.forEach((l, k) => g.append("text").attr("x", x0 + 16 * s).attr("y", cy + fs * 0.32 + k * fs * 1.35).attr("dy", "0.35em").attr("font-size", fs).attr("fill", theme.text).text(l));
          cy += lines.length * fs * 1.35 + 14 * s;
        });
      }
      contentW = innerW - colW - 32 * s;
    } else {
      const fs = 14 * s;
      const blocks = comments.map((c) => wrap(c, innerW - 16 * s, fs, font, 400, 2));
      const plannedBlocks = layoutComments.map((c) => wrap(c, innerW - 16 * s, fs, font, 400, 2));
      const bh = 20 * s + plannedBlocks.reduce((a, b) => a + b.length * fs * 1.3 + 8 * s, 0);
      let cy = H - pad - footH - bh + 4 * s;
      gCom.append("line").attr("x1", pad).attr("x2", W - pad).attr("y1", cy - 6 * s).attr("y2", cy - 6 * s).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
      if (comments.length) gCom.append("text").attr("class", "r4d-comments-head").attr("x", pad).attr("y", cy + hs * 0.6).attr("font-size", hs).attr("font-weight", 700).attr("letter-spacing", 1 * s).attr("fill", theme.accent).text(head);
      cy += 20 * s;
      blocks.forEach((lines, i) => {
        const g = gCom.append("g").attr("class", "r4d-comment").attr("data-index", i).attr("data-r4d-edit", `comment:${i}`);
        g.append("rect").attr("x", pad).attr("y", cy + fs * 0.32 - 3 * s).attr("width", 6 * s).attr("height", 6 * s).attr("rx", 1.5 * s).attr("fill", theme.accent);
        lines.forEach((l, k) => g.append("text").attr("x", pad + 14 * s).attr("y", cy + fs * 0.32 + k * fs * 1.3).attr("dy", "0.35em").attr("font-size", fs).attr("fill", theme.text).text(l));
        cy += lines.length * fs * 1.3 + 8 * s;
      });
      footH += bh + 10 * s;
    }
  }

  // ---- légende
  const items: LegendItem[] = !chrome ? [] : prep.drill ? drillLegend(prep.drill.model, { spec, ds: ds!, theme, colors, font, s, W, H, frame, prep }) : legendItems(spec, prep.model, colors, theme.text, prep.variance, theme);
  let legendPos = spec.style.legend === "auto" ? (items.length ? "top" : "none") : spec.style.legend;
  if (!items.length) legendPos = "none";
  let plot: PlotRect;
  const gLegend = root.append("g").attr("class", "r4d-legend");
  y += (opts.thumb ? 0 : 12) * s;
  if (legendPos === "top") {
    const h = layoutLegendRow(gLegend, items, pad, y, contentW, s, font, theme, true);
    y += h + 14 * s;
    plot = { x: pad, y, w: contentW, h: H - pad - footH - y };
  } else if (legendPos === "bottom") {
    const h = layoutLegendRow(gLegend, items, pad, 0, contentW, s, font, theme, false);
    const ly = H - pad - footH - h;
    layoutLegendRow(gLegend, items, pad, ly, contentW, s, font, theme, true);
    plot = { x: pad, y: y + 6 * s, w: contentW, h: ly - y - 22 * s };
  } else if (legendPos === "right") {
    const lw = Math.min(contentW * 0.28, Math.max(...items.map((i) => measure(i.label, 13 * s, font))) + 40 * s);
    const lx = pad + contentW - lw;
    items.forEach((it, i) => {
      const yy = y + 12 * s + i * 24 * s;
      drawSwatch(gLegend, it, lx + 4 * s, yy, s, theme);
      gLegend.append("text").attr("x", lx + 23 * s).attr("y", yy).attr("dy", "0.35em").attr("font-size", 13 * s).attr("fill", theme.muted).text(it.label);
    });
    plot = { x: pad, y: y + 6 * s, w: contentW - lw - 16 * s, h: H - pad - footH - y - 6 * s };
  } else {
    plot = { x: pad, y: y + 6 * s, w: contentW, h: H - pad - footH - y - 6 * s };
  }
  plot.h = Math.max(40, plot.h);

  const ctx: DrawCtx = { spec, ds: ds!, theme, colors, font, s, W, H, frame, prep, sharedMax: opts.sharedMax ?? null };
  if (opts.scaleNote && chrome) {
    // Indicateur d'échelle (IBCS) : pastille + texte, en bas à gauche (la signature occupe le bas droit)
    const gi = root.append("g").attr("class", "r4d-scale-indicator").attr("data-r4d", "scale");
    const fy = H - pad * 0.62;
    gi.append("rect").attr("x", pad).attr("y", fy - 9 * s).attr("width", 14 * s).attr("height", 9 * s).attr("fill", "none").attr("stroke", theme.accent).attr("stroke-width", 1.4 * s);
    gi.append("line").attr("x1", pad + 3 * s).attr("x2", pad + 11 * s).attr("y1", fy - 4.5 * s).attr("y2", fy - 4.5 * s).attr("stroke", theme.accent).attr("stroke-width", 1.4 * s);
    gi.append("text").attr("x", pad + 20 * s).attr("y", fy).attr("font-size", 11.5 * s).attr("fill", theme.muted).text(opts.scaleNote);
  }
  const gChart = root.append("g").attr("class", "r4d-chart") as unknown as G;
  const result = (): RenderResult => ({ plot, theme, prepared: prep, width: W, height: H, cartouche });

  if (isSpecial(spec.type)) return result();

  if (prep.error || (!prep.model && !prep.variance && !prep.drill)) {
    const msg = prep.error ?? "Encodage incomplet.";
    const lines = wrap(msg, Math.min(plot.w * 0.8, 640 * s), 16 * s, font, 400, 4);
    gChart.append("rect").attr("x", plot.x).attr("y", plot.y).attr("width", plot.w).attr("height", plot.h).attr("rx", 10 * s).attr("fill", "none").attr("stroke", theme.grid).attr("stroke-dasharray", `${6 * s} ${6 * s}`);
    lines.forEach((l, i) => gChart.append("text").attr("class", "r4d-empty").attr("x", plot.x + plot.w / 2).attr("y", plot.y + plot.h / 2 + (i - (lines.length - 1) / 2) * 22 * s).attr("text-anchor", "middle").attr("font-size", 16 * s).attr("fill", theme.muted).text(l));
    return result();
  }

  if (prep.variance) {
    drawVariance(gChart, plot, ctx, prep.variance);
    return result();
  }
  if (prep.drill) {
    drawDrill(gChart, plot, ctx, prep.drill.model, prep.drill.ctx);
    return result();
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

  const model = prep.model!;
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
  return result();
}

export { themeFor, paletteColors };
