/**
 * Types « spéciaux » : le film 4D (span × magnitude, moteur Reporting 4D) et la carte FR·BE / Europe,
 * rendus par la bibliothèque span-magnitude-viz dans la zone de tracé du cadre Studio.
 * Chargé à la demande (import dynamique) : la bibliothèque embarque les fonds de carte.
 */
import {
  createSpanMagnitudeViz,
  tryParseDocument,
  resolveInitialMapping,
  analyzeColumns,
  burundiProvinceByName,
  type VizHandle,
  type ColumnMapping,
  type TickerState,
  type MapZoom,
} from "span-magnitude-viz";
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import { libColorScheme, type Theme } from "../theme";
import type { PlotRect } from "./context";
import { rowsToDocument } from "span-magnitude-viz/fileImport";

export interface SpecialMount {
  handle: VizHandle | null;
  error: string | null;
  /** Domaine temporel du film (ms) pour le libellé du lecteur. */
  xDomain: [number, number] | null;
  unit: "date" | "number";
  /** Carte sans colonne de date : rendu statique, pas d'axe temporel ni de lecture. */
  timeless: boolean;
  destroy(): void;
}

/** Complète l'encodage spécial à partir des colonnes (mapping deviné de la bibliothèque). */
export function suggestSpecialEncoding(ds: Dataset): Partial<ChartSpec["encoding"]> {
  const rows = ds.raw.slice(0, 1000);
  const analyses = analyzeColumns(rows);
  const cols = ds.columns.map((c) => c.name);
  const m = resolveInitialMapping(cols, analyses);
  const dateCols = ds.columns.filter((c) => c.type === "date").map((c) => c.name);
  const numCols = ds.columns.filter((c) => c.type === "number" && !c.idLike).map((c) => c.name);
  const mag = numCols.includes(m.magnitude) ? m.magnitude : numCols[0] ?? null;
  // Sans colonne de date : début numérique (≠ magnitude) seulement, sinon aucun (la carte s'en passe)
  const numStart = m.start && m.start !== mag && ds.columns.some((c) => c.name === m.start && c.type === "number") ? m.start : null;
  const start = dateCols.includes(m.start) ? m.start : dateCols[0] ?? numStart;
  const end = m.end && dateCols.includes(m.end) ? m.end : dateCols.find((c) => c !== start) ?? null;
  return {
    x: start ?? null,
    end,
    y: mag ? [mag] : [],
    series: m.group && columnOf(ds, m.group)?.type === "category" ? m.group : ds.columns.find((c) => c.type === "category" && c.cardinality <= 12)?.name ?? null,
    label: m.label ?? null,
    lat: m.lat ?? null,
    lon: m.lon ?? null,
    postal: m.postal ?? ds.columns.find((c) => /postal|zip|^cp$/i.test(c.name))?.name ?? null,
  };
}

/**
 * Fond Burundi : colonne de noms de province (texte / catégorie) dont le plus de valeurs distinctes
 * correspondent à une province (noms courts « Buja », « Karusi »… ou officiels), sinon null.
 */
export function burundiPlaceColumn(ds: Dataset): string | null {
  let best: string | null = null;
  let bestHits = 0;
  for (const c of ds.columns) {
    if (c.type === "number" || c.type === "date") continue;
    const seen = new Set<string>();
    let hits = 0;
    for (const r of ds.rows.slice(0, 2000)) {
      const v = r[c.name];
      if (v == null || v === "") continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      if (burundiProvinceByName(s)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = c.name;
    }
  }
  return best;
}

function isoOf(v: unknown): unknown {
  return typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : v;
}

/** Construit le document span-magnitude (contrat §4) depuis le dataset typé. */
/** Colonne interne de la carte sans date (toutes les lignes au même instant ; absente du dataset). */
const TIMELESS_COL = "\u0000sans-date";

export function buildSpanDocument(
  spec: ChartSpec,
  ds: Dataset
): { doc: unknown; unit: "date" | "number"; error: string | null; timeless: boolean } {
  const r = buildSpanDocumentInner(spec, ds);
  return { ...r, timeless: r.timeless ?? false };
}

function buildSpanDocumentInner(spec: ChartSpec, ds: Dataset): { doc: unknown; unit: "date" | "number"; error: string | null; timeless?: boolean } {
  const enc = spec.encoding;
  const magCol = columnOf(ds, enc.y[0]);
  // Carte sans date : « Début » vide (ou colonne ni date ni nombre) → carte statique, sans axe temporel
  const x0 = columnOf(ds, enc.x);
  if (spec.type === "map" && (!x0 || (x0.type !== "date" && x0.type !== "number"))) {
    if (!magCol || magCol.type !== "number") return { doc: null, unit: "number", error: "Film / carte : choisissez une magnitude numérique (axe Y).", timeless: true };
    return buildTimelessMap(spec, ds, magCol.name);
  }
  const startCol = x0;
  if (!startCol) return { doc: null, unit: "date", error: "Film / carte : choisissez la colonne de début (axe X, date ou nombre)." };
  if (!magCol || magCol.type !== "number") return { doc: null, unit: "date", error: "Film / carte : choisissez une magnitude numérique (axe Y)." };
  const unit: "date" | "number" = startCol.type === "date" ? "date" : "number";
  if (unit === "number" && startCol.type !== "number") return { doc: null, unit, error: "Le début doit être une date ou un nombre." };
  const endCol = columnOf(ds, enc.end) ?? startCol;
  // Lignes normalisées : dates ISO, nombres propres (la bibliothèque attend ces formats)
  const rows = ds.rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of ds.columns) o[c.name] = c.type === "date" ? isoOf(r[c.name]) : r[c.name];
    return o;
  });
  const mapping: ColumnMapping = {
    start: startCol.name,
    end: endCol.name,
    magnitude: magCol.name,
    group: enc.series ?? null,
    label: enc.label ?? null,
    lat: enc.lat ?? null,
    lon: enc.lon ?? null,
    postal: enc.postal ?? null,
    meta: ds.columns
      .map((c) => c.name)
      .filter((n) => ![startCol.name, endCol.name, magCol.name, enc.series, enc.label, enc.lat, enc.lon, enc.postal].includes(n))
      .slice(0, 6),
  };
  // Fond Burundi : jointure par nom de province (colonne détectée → meta.place) ; autres fonds inchangés
  if (spec.type === "map" && spec.special.mapRegion === "burundi") mapping.place = burundiPlaceColumn(ds);
  const doc = rowsToDocument(rows, {
    unit,
    mapping,
    title: "",
    magnitudeLabel: magnitudeUnitOf(spec, magCol.name) ? magCol.name.replace(/\s*\((?:€|k€|m€|eur|euros?)\)\s*$/i, "") : magCol.name,
    spanLabel: endCol === startCol ? startCol.name : `${startCol.name} → ${endCol.name}`,
    countLabel: countLabelOf(spec),
  });
  // Garde-fou : fin ≥ début (inversions fréquentes dans les exports)
  const marks = (doc as { marks: { span: { start: string | number; end: string | number } }[] }).marks;
  for (const m of marks) {
    if (String(m.span.end) < String(m.span.start) && unit === "date") m.span.end = m.span.start;
    if (unit === "number" && Number(m.span.end) < Number(m.span.start)) m.span.end = m.span.start;
  }
  if (!marks.length) return { doc: null, unit, error: "Aucune ligne exploitable (début, fin et magnitude doivent être renseignés)." };
  return { doc, unit, error: null };
}

/** Carte sans date : chaque ligne placée (nom, code postal ou lat/lon), toutes au même instant. */
function buildTimelessMap(spec: ChartSpec, ds: Dataset, mag: string): { doc: unknown; unit: "number"; error: string | null; timeless: true } {
  const enc = spec.encoding;
  const rows = ds.rows.map((r) => {
    const o: Record<string, unknown> = { [TIMELESS_COL]: 0 };
    for (const c of ds.columns) o[c.name] = c.type === "date" ? isoOf(r[c.name]) : r[c.name];
    return o;
  });
  const mapping: ColumnMapping = {
    start: TIMELESS_COL,
    end: TIMELESS_COL,
    magnitude: mag,
    group: enc.series ?? null,
    label: enc.label ?? null,
    lat: enc.lat ?? null,
    lon: enc.lon ?? null,
    postal: enc.postal ?? null,
    meta: ds.columns
      .map((c) => c.name)
      .filter((n) => ![mag, enc.series, enc.label, enc.lat, enc.lon, enc.postal].includes(n))
      .slice(0, 6),
  };
  if (spec.special.mapRegion === "burundi") mapping.place = burundiPlaceColumn(ds);
  const doc = rowsToDocument(rows, {
    unit: "number",
    mapping,
    title: "",
    magnitudeLabel: magnitudeUnitOf(spec, mag) ? mag.replace(/\s*\((?:€|k€|m€|eur|euros?)\)\s*$/i, "") : mag,
    spanLabel: "",
    countLabel: countLabelOf(spec),
  });
  if (!(doc as { marks: unknown[] }).marks.length) return { doc: null, unit: "number", error: "Aucune ligne exploitable (la magnitude doit être renseignée).", timeless: true };
  return { doc, unit: "number", error: null, timeless: true };
}

function magName(spec: ChartSpec): string {
  return spec.encoding.y[0] ?? "";
}

/** Unité des compteurs : € si l'axe ou la colonne est monétaire, unité libre sinon. */
export function magnitudeUnitOf(spec: Pick<ChartSpec, "axes">, column: string): string {
  const u = spec.axes.y.unit;
  if (u === "eur" || u === "keur" || u === "meur" || /€|\beur\b|euros?\b/i.test(column)) return "€";
  if (u === "custom") return spec.axes.y.unitCustom.trim();
  return "";
}

/** Libellé du compteur d'éléments : « Affaires » pour un pipeline, sinon nom des libellés. */
function countLabelOf(spec: ChartSpec): string {
  const l = spec.encoding.label ?? "";
  if (/opportunit|affaire|deal/i.test(l)) return "Affaires";
  return "Éléments";
}

export function mountSpecial(
  host: HTMLElement,
  spec: ChartSpec,
  ds: Dataset,
  plot: PlotRect,
  theme: Theme,
  opts: {
    animate: boolean;
    onTick?: (s: TickerState) => void;
    onComplete?: () => void;
    /** Carte : zoom interactif (aperçu du Studio ; vue seulement, hors spec, exports en cadre entier). */
    zoom?: boolean;
    onMapZoom?: (z: MapZoom) => void;
  }
): SpecialMount {
  const { doc, unit, error, timeless } = buildSpanDocument(spec, ds);
  const empty: SpecialMount = { handle: null, error, xDomain: null, unit, timeless, destroy: () => (host.innerHTML = "") };
  if (error) return empty;
  const parsed = tryParseDocument(doc);
  if (!parsed.ok) return { ...empty, error: "Document invalide : " + parsed.error.issues.slice(0, 3).join(" ; ") };
  const isMap = spec.type === "map";
  const burundi = isMap && spec.special.mapRegion === "burundi";
  if (burundi && !(spec.encoding.lat && spec.encoding.lon) && !burundiPlaceColumn(ds))
    return { ...empty, error: "Carte du Burundi : il faut une colonne de noms de province (Gitega, Buja, Buja rural, Karusi… ou noms officiels) ou « Latitude » + « Longitude »." };
  if (isMap && !burundi && !spec.encoding.postal && !(spec.encoding.lat && spec.encoding.lon))
    return { ...empty, error: "Carte : choisissez une colonne « Code postal » (FR/BE) ou « Latitude » + « Longitude »." };
  host.innerHTML = "";
  // Accents de la bibliothèque (compteurs, info-bulle, survol) : bleu pétrole sauf palettes rouges
  host.dataset.scheme = libColorScheme(spec.style.palette);
  const handle = createSpanMagnitudeViz(host, parsed.data, {
    geometry: isMap ? "point" : spec.special.geometry,
    persistence: spec.special.persistence,
    viewMode: isMap ? "map" : "chart",
    mapRegion: spec.special.mapRegion,
    mapMark: spec.special.mapMark,
    mapScale: spec.special.mapScale,
    mapReveal: spec.special.mapReveal,
    mapScaleMin: spec.special.mapScaleMin,
    mapScaleMax: spec.special.mapScaleMax,
    mapLevel: spec.special.mapLevel,
    // Monde et Burundi : toujours le fond entier (Europe : cadrage sur les pays présents)
    mapFit: spec.special.mapRegion === "europe" ? "data" : "region",
    width: Math.round(plot.w),
    height: Math.round(plot.h),
    animate: opts.animate && (!timeless || spec.special.mapReveal === "sequence"),
    autoplay: opts.animate && (!timeless || spec.special.mapReveal === "sequence"),
    durationMs: spec.mode.fourD.durationMs,
    theme: theme.dark ? "dark" : "light",
    // Compteur « somme » sans objet pour un taux ou une part (%) : masqué sur la carte
    tickers: spec.special.tickers && !(isMap && (spec.axes.y.unit === "pct" || /%|\bpart\b|\btaux\b/i.test(magName(spec)))),
    facetSummary: false,
    colorScheme: libColorScheme(spec.style.palette),
    colorBy: spec.encoding.series ? "group" : "magnitude",
    // Compteurs, info-bulle et graduations au format français (10,6 M€, févr. 2025)
    locale: "fr",
    magnitudeUnit: magnitudeUnitOf(spec, magName(spec)),
    cascadeSpeed: "normal",
    onTick: opts.onTick,
    onComplete: opts.onComplete,
    mapZoom: isMap && !!opts.zoom,
    onMapZoom: opts.onMapZoom,
  });
  if (!opts.animate || (timeless && spec.special.mapReveal !== "sequence")) handle.setProgress(1);
  return {
    handle,
    error: null,
    xDomain: timeless ? null : parsed.data.xDomain,
    unit,
    timeless,
    destroy: () => {
      handle.destroy();
      host.innerHTML = "";
    },
  };
}
