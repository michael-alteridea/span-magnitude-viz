/**
 * Datanime Studio (moteur Reporting 4D) — spécification de graphique (JSON sérialisable, validée par Zod).
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
  "variance",
  "film",
  "map",
  "drill",
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
  variance: "Écarts (IBCS)",
  film: "Film 4D (span × magnitude)",
  map: "Carte FR·BE / Europe",
  drill: "Exploration guidée (zoom temps · espace)",
};

export const CHART_FAMILIES: { label: string; types: ChartType[] }[] = [
  { label: "Exploration", types: ["drill"] },
  { label: "Barres", types: ["bar", "barH", "groupedBar", "stackedBar"] },
  { label: "Lignes & aires", types: ["line", "area", "stackedArea"] },
  { label: "Points", types: ["scatter"] },
  { label: "Circulaires", types: ["pie", "donut", "radialBar"] },
  { label: "Écarts", types: ["variance"] },
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
export const isVariance = (t: ChartType) => t === "variance";
export const isDrill = (t: ChartType) => t === "drill";

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
  /** N premières catégories (par total), le reste regroupé en « Autres » ; null = toutes. */
  topN: z.number().int().min(1).max(100).nullable().default(null),
  /** Avec topN : regrouper le reste en « Autres ». */
  others: z.boolean().default(true),
  aggregate: z.enum(AGGREGATES).default("sum"),
  y2Aggregate: z.enum(AGGREGATES).default("mean"),
  /**
   * Mode norme : scénario forcé par série (nom de mesure ou valeur de série). Absent = détection
   * automatique d'après le nom (Réel / Budget / N-1 / Prévision) ; « none » = pas un scénario.
   */
  scenarios: z.record(z.enum(["AC", "PY", "PL", "FC", "none"])).default({}),
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
  /**
   * Signature « label qualité » (logo, lien plateforme, date, source) en bas à droite.
   * Ne peut être masquée qu'avec `branding: "pro"` ; aucune option d'interface pour l'instant.
   */
  brandMark: z.boolean().default(true),
  /** QR d'empreinte des données dans le cartouche (masque seulement le QR, jamais le cartouche). */
  authQr: z.boolean().default(true),
  /**
   * Extrémité des barres (étape I) — barres simples (une série) : « icon » = pastille avec icône Phosphor au bout de la
   * barre, « picto » = pictogrammes (isotype, une icône = une unité), « goal » = réalisé (1re mesure) vs objectif
   * (2e mesure) avec repère et pastille atteint / non atteint.
   */
  barCap: z.enum(["none", "icon", "picto", "goal"]).default("none"),
  /** Icône choisie par catégorie (nom Phosphor ; "" = aucune). Catégorie absente : icône automatique d'après son nom. */
  capIcons: z.record(z.string(), z.string().max(40)).default({}),
  /** Barre mise en avant (« mode focus ») : les autres en gris, annotation reliée à la barre, moyenne des autres. */
  focus: z
    .object({
      /** Catégorie mise en avant, « @max » = la plus grande, null = aucune. */
      key: z.string().max(200).nullable().default(null),
      /** Titre de l'annotation ("" = calculé : valeur et part du total). */
      title: z.string().max(120).default(""),
      /** Texte de l'annotation ("" = calculé : comparaison à la moyenne des autres). */
      note: z.string().max(200).default(""),
      /** Ligne « Moyenne des autres ». */
      average: z.boolean().default(true),
    })
    .default({}),
  /** Réservé V2 : identifiant de charte de marque. */
  charterId: z.string().nullable().default(null),
});

export const specialSchema = z.object({
  geometry: z.enum(["arc", "bar", "point"]).default("arc"),
  persistence: z.enum(["keep", "ephemeral", "finale"]).default("keep"),
  mapRegion: z.enum(["fr-be", "europe"]).default("fr-be"),
  // Maille Europe : « country » uniquement ; les anciennes valeurs restent lisibles (affichées en pays).
  mapLevel: z.enum(["country", "nuts1", "nuts2", "nuts3"]).default("country"),
  tickers: z.boolean().default(true),
});

/**
 * Transformations appliquées au jeu de données avant le rendu (dans cet ordre : calculs, puis filtres).
 * Les dates sont en ms UTC ; `ref` (âge) est une date de référence figée, pour un rendu reproductible.
 */
export const FILTER_OPS = ["in", "notIn", "lt", "lte", "gt", "gte", "notNull"] as const;
export const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(FILTER_OPS).default("in"),
  values: z.array(z.string()).max(200).default([]),
  value: z.number().finite().nullable().default(null),
  /** Libellé lisible (« affaires ouvertes », « 2026 »…). */
  label: z.string().max(120).default(""),
});
export type FilterSpec = z.infer<typeof filterSchema>;

export const CALC_OPS = ["mul", "sub", "add", "div", "coalesce", "age", "ageBucket", "monthOfYear", "year", "flag", "regionPostal"] as const;
export type CalcOp = (typeof CALC_OPS)[number];
export const calcSchema = z.object({
  as: z.string().min(1).max(80),
  op: z.enum(CALC_OPS),
  a: z.string().min(1),
  b: z.string().min(1).nullable().default(null),
  /** Facteur appliqué au résultat (ex. 0,01 pour une probabilité en %). */
  scale: z.number().finite().default(1),
  /** Date de référence (ms UTC) pour « age » / « ageBucket ». */
  ref: z.number().finite().nullable().default(null),
  /** Valeurs « vraies » pour « flag » (→ 100, sinon 0). */
  values: z.array(z.string()).max(50).default([]),
});
export type CalcSpec = z.infer<typeof calcSchema>;

export const transformSchema = z.object({
  calculate: z.array(calcSchema).max(8).default([]),
  filters: z.array(filterSchema).max(10).default([]),
});
export type TransformSpec = z.infer<typeof transformSchema>;

/** Graphique d'écarts (IBCS) : mesure 1 = réel, mesure 2 = référence (budget, N-1, prévision). */
export const varianceSchema = z.object({
  /** higher = un écart positif est favorable (ventes) ; lower = défavorable (coûts). */
  polarity: z.enum(["higher", "lower"]).default("higher"),
  /** Barres d'écart en valeur absolue ou relative (%). */
  show: z.enum(["abs", "rel"]).default("abs"),
  /** Ligne « Total » en bas. */
  total: z.boolean().default(true),
});

/**
 * « Mode norme » : notation inspirée d'IBCS® et de la notation ISO 24896 (« Notation for business reporting »).
 * Données en gris (Réel foncé plein, N-1 gris clair, Budget en contour, Prévision hachurée), rouge / vert réservés
 * aux écarts, temps à l'horizontale / structure à la verticale, sous-titre qui · quoi · quand, unités dans le sous-titre.
 */
export const normeSchema = z.object({
  enabled: z.boolean().default(false),
  /** Qui (sous-titre) ; vide = nom du jeu de données. */
  entity: z.string().max(80).default(""),
  /** Quoi (sous-titre) ; vide = déduit de la mesure. */
  measure: z.string().max(80).default(""),
  /** Bascule automatique colonnes (temps) / barres horizontales (structure), avec un avis discret. */
  autoSwitch: z.boolean().default(true),
});
export type NormeSpec = z.infer<typeof normeSchema>;

/**
 * Provenance du jeu de données (empreinte SHA-256, horodatage d'import, dimensions) : alimente le
 * cartouche (« Données importées le … », empreinte) et le QR de vérification. Fixée par le Studio à
 * l'import — voir `provenance.ts` pour les règles d'empreinte.
 */
export const provenanceSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/, "Empreinte SHA-256 attendue (64 caractères hexadécimaux)"),
  kind: z.enum(["file", "paste", "sample", "config"]),
  importedAt: z.string().max(40),
  fileName: z.string().max(260).default(""),
  rows: z.number().int().min(0),
  cols: z.number().int().min(0),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  sheet: z.string().max(200).nullable().default(null),
});
export type ProvenanceSpec = z.infer<typeof provenanceSchema>;

/**
 * Exploration guidée (type « drill ») : zoom dans le temps (trimestres → mois → mois focalisé), puis dans
 * l'espace (carte des régions, historique par région) et par n'importe quelle catégorie (commercial…).
 * `path` est le fil d'Ariane (« Tout › T2 2026 › Juin 2026 › Wallonie ») : étapes « période » (filtre ou
 * mise en avant selon la vue) et « catégorie » (toujours un filtre). Les dates sont en ms UTC.
 */
export const DRILL_GRAINS = ["week", "month", "quarter", "year"] as const;
export type DrillGrain = (typeof DRILL_GRAINS)[number];
export const DRILL_VIEWS = ["periods", "month", "map", "history", "breakdown", "bridge", "compare", "pivot"] as const;
export type DrillView = (typeof DRILL_VIEWS)[number];
export const drillStepSchema = z.object({
  kind: z.enum(["period", "cat"]),
  grain: z.enum(DRILL_GRAINS).nullable().default(null),
  start: z.number().finite().nullable().default(null),
  field: z.string().max(120).nullable().default(null),
  value: z.string().max(200).nullable().default(null),
  label: z.string().max(80).default(""),
});
export type DrillStep = z.infer<typeof drillStepSchema>;
export const drillSchema = z.object({
  /** Colonne date (création, commande…) ; null = première date détectée. */
  date: field,
  /** Mesure additionnée ; null = nombre de lignes. */
  measure: field,
  /** Nom lisible de la mesure (« Pipeline créé ») ; vide = déduit de la colonne. */
  label: z.string().max(80).default(""),
  path: z.array(drillStepSchema).max(8).default([]),
  view: z.enum(DRILL_VIEWS).default("periods"),
  /** Pas de temps de la vue « périodes ». */
  grain: z.enum(DRILL_GRAINS).default("quarter"),
  /** Dimension de la répartition (carte, historique, détail) : région, commercial… */
  by: field,
  /** Nombre de périodes précédentes de la référence (moyenne). */
  compare: z.number().int().min(1).max(12).default(3),
  /**
   * Comparaison de deux versions / scénarios d'une même colonne (« Réel 2025 » → « Budget 2026 ») : la valeur
   * devient l'écart `to − from` (cascade, barres d'écart) ; null = mesure simple.
   */
  version: field,
  from: z.string().max(120).nullable().default(null),
  to: z.string().max(120).nullable().default(null),
  /** Cascade : tri des facteurs par impact, sous-totaux par groupe. */
  sortByImpact: z.boolean().default(true),
  /** Colonne « Revenus / Coûts » : les coûts sont soustraits (résultat = revenus − coûts) ; null = mesure telle quelle. */
  nature: field,
  /** Hiérarchie de la cascade (ligne métier → compte…) : un clic sur un facteur descend d'un niveau. */
  levels: z.array(z.string().min(1).max(120)).max(4).default([]),
  /** « Tableau croisé » (vue « pivot ») : axe X, séries, mesure et graphique. */
  pivot: z
    .object({
      /** Colonne, ou « @month » / « @quarter » / « @year » (pas de temps de la colonne date). */
      x: z.string().max(120).nullable().default(null),
      /** Colonne de séries, « @version » (une série par version) ou null. */
      series: z.string().max(120).nullable().default(null),
      agg: z.enum(["sum", "mean", "count", "delta"]).default("sum"),
      chart: z.enum(["bar", "line", "bridge", "map"]).default("bar"),
    })
    .default({}),
});
export type DrillSpec = z.infer<typeof drillSchema>;

export const NARRATIVE_ROLES = ["context", "tension", "revelation", "recommendation"] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];

/**
 * Couche récit : titres et commentaires calculés. Les textes affichés vivent dans `style.title`,
 * `style.subtitle` et `story.comments` ; les drapeaux `edited` protègent les saisies de l'utilisateur
 * (un changement de données ne les écrase pas, « Régénérer » remet les drapeaux à false).
 */
export const storySchema = z.object({
  /** Génération automatique des textes. */
  auto: z.boolean().default(true),
  edited: z
    .object({
      title: z.boolean().default(false),
      subtitle: z.boolean().default(false),
      comments: z.boolean().default(false),
    })
    .default({}),
  comments: z.array(z.string().max(300)).max(3).default([]),
  /** Commentaires dessinés sur le graphique (colonne « À retenir »). */
  showComments: z.boolean().default(true),
  /** Type d'insight à l'origine du graphique (Explorer) ; null = narration générique. */
  kind: z.string().max(40).nullable().default(null),
  /** Paramètres de l'insight (colonnes de rôle : étape, clôture, compte…). */
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])).default({}),
  /** Empreinte type + encodage + transformations au moment de l'Explorer (narration spécifique tant qu'elle correspond). */
  basis: z.string().max(2000).nullable().default(null),
});
export type StorySpec = z.infer<typeof storySchema>;

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
  transform: transformSchema.default({}),
  variance: varianceSchema.default({}),
  norme: normeSchema.default({}),
  story: storySchema.default({}),
  drill: drillSchema.default({}),
  /** Offre : seule l'offre « pro » peut masquer la signature (avec `style.brandMark: false`). */
  branding: z.enum(["free", "pro"]).default("free"),
  /** Provenance des données affichées (null : aucune donnée, ou empreinte en cours de calcul). */
  provenance: provenanceSchema.nullable().default(null),
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
  /** Histoire : snapshots ordonnés (validés à l'ouverture par `snapshotSchema`). */
  story: z.object({ title: z.string().optional(), snapshots: z.array(z.unknown()) }).optional(),
});
export type StudioFile = z.infer<typeof studioFileSchema>;
