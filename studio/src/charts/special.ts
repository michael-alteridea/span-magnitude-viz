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
  type VizHandle,
  type ColumnMapping,
  type TickerState,
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
  const start = dateCols.includes(m.start) ? m.start : dateCols[0] ?? m.start;
  const end = m.end && dateCols.includes(m.end) ? m.end : dateCols.find((c) => c !== start) ?? null;
  const mag = numCols.includes(m.magnitude) ? m.magnitude : numCols[0] ?? null;
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

function isoOf(v: unknown): unknown {
  return typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : v;
}

/** Construit le document span-magnitude (contrat §4) depuis le dataset typé. */
export function buildSpanDocument(spec: ChartSpec, ds: Dataset): { doc: unknown; unit: "date" | "number"; error: string | null } {
  const enc = spec.encoding;
  const startCol = columnOf(ds, enc.x);
  const magCol = columnOf(ds, enc.y[0]);
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
  opts: { animate: boolean; onTick?: (s: TickerState) => void; onComplete?: () => void }
): SpecialMount {
  const { doc, unit, error } = buildSpanDocument(spec, ds);
  const empty: SpecialMount = { handle: null, error, xDomain: null, unit, destroy: () => (host.innerHTML = "") };
  if (error) return empty;
  const parsed = tryParseDocument(doc);
  if (!parsed.ok) return { ...empty, error: "Document invalide : " + parsed.error.issues.slice(0, 3).join(" ; ") };
  const isMap = spec.type === "map";
  if (isMap && !spec.encoding.postal && !(spec.encoding.lat && spec.encoding.lon))
    return { ...empty, error: "Carte : choisissez une colonne « Code postal » (FR/BE) ou « Latitude » + « Longitude »." };
  host.innerHTML = "";
  // Accents de la bibliothèque (compteurs, info-bulle, survol) : bleu pétrole sauf palettes rouges
  host.dataset.scheme = libColorScheme(spec.style.palette);
  const handle = createSpanMagnitudeViz(host, parsed.data, {
    geometry: isMap ? "point" : spec.special.geometry,
    persistence: spec.special.persistence,
    viewMode: isMap ? "map" : "chart",
    mapRegion: spec.special.mapRegion,
    mapLevel: spec.special.mapLevel,
    // Monde : toujours le planisphère entier (Europe : cadrage sur les pays présents)
    mapFit: spec.special.mapRegion === "europe" ? "data" : "region",
    width: Math.round(plot.w),
    height: Math.round(plot.h),
    animate: opts.animate,
    autoplay: opts.animate,
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
  });
  if (!opts.animate) handle.setProgress(1);
  return {
    handle,
    error: null,
    xDomain: parsed.data.xDomain,
    unit,
    destroy: () => {
      handle.destroy();
      host.innerHTML = "";
    },
  };
}
