/**
 * Reporting 4D Studio — spécification de graphique (JSON sérialisable, validée par Zod).
 *
 * Le spec est la seule source de vérité : l'UI le modifie, le moteur de rendu le lit,
 * l'export JSON le sauvegarde tel quel. Toutes les clés ont une valeur par défaut, si bien
 * qu'un spec partiel (ou d'une version antérieure) est complété au chargement.
 *
 * Points d'extension prévus pour la V2 (non implémentés) :
 *  - `style.charterId`   → chartes de marque enregistrées (police, couleurs autorisées / interdites)
 *  - `layers`            → superposition d'un second fichier (chaque couche = dataset + encodage)
 *  - `encoding.marker`   → pictogramme SVG (bibliothèque d'icônes) comme marqueur de points
 *  - `export.formats`    → GIF ; `share` → sauvegarde / partage Firestore
 */
import { z } from "zod";

export const CHART_TYPES = [
  "bar",
  "barH",
  "groupedBar",
  "stackedBar",
  "line",
  "area",
  "stackedArea",
  "scatter",
  "pie",
  "donut",
  "radialBar",
  "film",
  "map",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "Barres",
  barH: "Barres horizontales",
  groupedBar: "Barres groupées",
  stackedBar: "Barres empilées",
  line: "Lignes",
  area: "Aires",
  stackedArea: "Aires empilées",
  scatter: "Nuage de points",
  pie: "Camembert",
  donut: "Donut",
  radialBar: "Arcs radiaux",
  film: "Film 4D (span × magnitude)",
  map: "Carte FR·BE / Europe",
};

export const CHART_FAMILIES: { label: string; types: ChartType[] }[] = [
  { label: "Barres", types: ["bar", "barH", "groupedBar", "stackedBar"] },
  { label: "Lignes & aires", types: ["line", "area", "stackedArea"] },
  { label: "Points", types: ["scatter"] },
  { label: "Circulaires", types: ["pie", "donut", "radialBar"] },
  { label: "Spéciaux", types: ["film", "map"] },
];

export const isCartesian = (t: ChartType) =>
  t === "bar" ||
  t === "barH" ||
  t === "groupedBar" ||
  t === "stackedBar" ||
  t === "line" ||
  t === "area" ||
  t === "stackedArea" ||
  t === "scatter";
export const isBarType = (t: ChartType) =>
  t === "bar" || t === "barH" || t === "groupedBar" || t === "stackedBar";
export const isRadial = (t: ChartType) => t === "pie" || t === "donut" || t === "radialBar";
export const isSpecial = (t: ChartType) => t === "film" || t === "map";

export const AGGREGATES = ["sum", "mean", "count", "min", "max", "last"] as const;
export const AGGREGATE_LABELS: Record<(typeof AGGREGATES)[number], string> = {
  sum: "Somme",
  mean: "Moyenne",
  count: "Nombre de lignes",
  min: "Minimum",
  max: "Maximum",
  last: "Dernière valeur",
};

export const UNITS = ["none", "eur", "keur", "meur", "pct", "k", "M", "custom"] as const;
export type UnitKey = (typeof UNITS)[number];
export const UNIT_LABELS: Record<UnitKey, string> = {
  none: "Aucune",
  eur: "€",
  keur: "k€ (÷ 1 000)",
  meur: "M€ (÷ 1 000 000)",
  pct: "%",
  k: "k (÷ 1 000)",
  M: "M (÷ 1 000 000)",
  custom: "Personnalisée…",
};

export const PALETTE_KEYS = [
  "petrole",
  "petroleMono",
  "petroleGris",
  "alteridea",
  "alterideaMono",
  "rougeGris",
  "vives",
  "froidChaud",
  "or",
  "custom",
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const FONT_KEYS = ["inter", "plex", "grotesk", "barlow", "playfair"] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const SIZE_PRESETS = {
  "16:9": { width: 1200, height: 675 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur hexadécimale attendue (#rrggbb)");
const field = z.string().min(1).nullable().default(null);

export const axisSchema = z.object({
  /** auto = linéaire pour les nombres, temps pour les dates, bandes pour les catégories. */
  scale: z.enum(["auto", "linear", "log", "time"]).default("auto"),
  min: z.number().finite().nullable().default(null),
  max: z.number().finite().nullable().default(null),
  unit: z.enum(UNITS).default("none"),
  unitCustom: z.string().max(12).default(""),
  /** Nombre de décimales ; null = automatique. */
  decimals: z.number().int().min(0).max(4).nullable().default(null),
  title: z.string().max(120).default(""),
  grid: z.boolean().default(true),
  show: z.boolean().default(true),
});
export type AxisSpec = z.infer<typeof axisSchema>;

export const encodingSchema = z.object({
  x: field,
  /** Une ou plusieurs mesures ; plusieurs mesures = plusieurs séries (format « large » d'Excel). */
  y: z.array(z.string().min(1)).max(12).default([]),
  /** Seconde mesure sur un axe Y indépendant (à droite), tracée en ligne. */
  y2: field,
  /** Champ de série / couleur (format « long »). */
  series: field,
  /** Champ temporel pour l'animation 4D. */
  time: field,
  /** Taille des bulles (nuage de points). */
  size: field,
  /** Libellé (nuage de points, film). */
  label: field,
  /** Fin de span (film 4D) — début = x. */
  end: field,
  lat: field,
  lon: field,
  postal: field,
  /** Regroupement des dates de l'axe X (barres / lignes par mois, trimestre…). */
  xGrain: z.enum(["none", "day", "week", "month", "quarter", "year"]).default("none"),
  aggregate: z.enum(AGGREGATES).default("sum"),
  y2Aggregate: z.enum(AGGREGATES).default("mean"),
});
export type EncodingSpec = z.infer<typeof encodingSchema>;

export const modeSchema = z.object({
  kind: z.enum(["static", "dynamic"]).default("static"),
  /** Animation d'entrée (mode dynamique). */
  buildIn: z.boolean().default(true),
  buildInMs: z.number().int().min(200).max(10000).default(1400),
  fourD: z
    .object({
      enabled: z.boolean().default(false),
      /** cumulative = les lignes s'accumulent ; snapshot = valeurs de l'instant (course). */
      mode: z.enum(["cumulative", "snapshot"]).default("cumulative"),
      step: z.enum(["auto", "raw", "day", "week", "month", "quarter", "year"]).default("auto"),
      durationMs: z.number().int().min(1000).max(120000).default(8000),
      loop: z.boolean().default(false),
      /** Grand tampon de date façon film. */
      stamp: z.boolean().default(true),
      /** Échelles figées sur l'étendue complète (évite les sauts). */
      freezeScales: z.boolean().default(true),
    })
    .default({}),
});

export const styleSchema = z.object({
  title: z.string().max(200).default(""),
  subtitle: z.string().max(300).default(""),
  source: z.string().max(300).default(""),
  background: z.enum(["dark", "light", "custom"]).default("dark"),
  backgroundCustom: hex.default("#101418"),
  palette: z.enum(PALETTE_KEYS).default("petrole"),
  paletteCustom: z.array(hex).max(16).default([]),
  font: z.enum(FONT_KEYS).default("inter"),
  size: z
    .object({
      preset: z.enum(["16:9", "1:1", "4:5", "custom"]).default("16:9"),
      width: z.number().int().min(320).max(4000).default(1200),
      height: z.number().int().min(240).max(4000).default(675),
    })
    .default({}),
  legend: z.enum(["auto", "top", "bottom", "right", "none"]).default("auto"),
  valueLabels: z.boolean().default(false),
  curve: z.enum(["linear", "monotone", "step"]).default("monotone"),
  sort: z.enum(["none", "asc", "desc", "alpha"]).default("none"),
  /** Barres groupées / empilées à l'horizontale. */
  horizontal: z.boolean().default(false),
  /** Barres / aires empilées à 100 %. */
  normalize: z.boolean().default(false),
  /** Petit filet d'accent devant le titre (bleu pétrole, ou rouge avec les palettes Alteridea). */
  accentBar: z.boolean().default(true),
  /** Signature « Reporting 4D · alteridea.com » en pied. */
  brandMark: z.boolean().default(true),
  /** Réservé V2 : identifiant de charte de marque. */
  charterId: z.string().nullable().default(null),
});

export const specialSchema = z.object({
  geometry: z.enum(["arc", "bar", "point"]).default("arc"),
  persistence: z.enum(["keep", "ephemeral", "finale"]).default("keep"),
  mapRegion: z.enum(["fr-be", "europe"]).default("fr-be"),
  mapLevel: z.enum(["country", "nuts1", "nuts2", "nuts3"]).default("nuts2"),
  tickers: z.boolean().default(true),
});

export const chartSpecSchema = z.object({
  $schema: z.literal("reporting-4d-studio/spec-v1").default("reporting-4d-studio/spec-v1"),
  version: z.literal(1).default(1),
  type: z.enum(CHART_TYPES).default("bar"),
  encoding: encodingSchema.default({}),
  axes: z
    .object({
      x: axisSchema.default({ grid: false }),
      y: axisSchema.default({}),
      y2: axisSchema.default({ grid: false }),
    })
    .default({}),
  mode: modeSchema.default({}),
  style: styleSchema.default({}),
  special: specialSchema.default({}),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartSpecInput = z.input<typeof chartSpecSchema>;

export function defaultSpec(): ChartSpec {
  return chartSpecSchema.parse({});
}

/** Valide (et complète) un spec inconnu. Renvoie les erreurs en français lisible. */
export function parseSpec(
  raw: unknown
): { ok: true; spec: ChartSpec } | { ok: false; issues: string[] } {
  const r = chartSpecSchema.safeParse(raw ?? {});
  if (r.success) return { ok: true, spec: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`),
  };
}

/** Taille effective (preset ou personnalisée). */
export function chartSize(spec: ChartSpec): { width: number; height: number } {
  const p = spec.style.size.preset;
  if (p === "custom") return { width: spec.style.size.width, height: spec.style.size.height };
  return { ...SIZE_PRESETS[p] };
}

/** Fichier de configuration sauvegardé (spec + données facultatives). */
export const studioFileSchema = z.object({
  kind: z.literal("reporting-4d-studio"),
  version: z.literal(1),
  savedAt: z.string().optional(),
  spec: z.unknown(),
  data: z
    .object({
      name: z.string(),
      rows: z.array(z.record(z.unknown())),
      typeOverrides: z.record(z.enum(["number", "date", "text", "category"])).optional(),
    })
    .nullable()
    .optional(),
  sampleId: z.string().nullable().optional(),
});
export type StudioFile = z.infer<typeof studioFileSchema>;
