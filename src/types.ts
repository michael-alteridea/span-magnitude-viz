/** Span unit: ISO dates or plain numbers. */
export type SpanUnit = "date" | "number";

export type GeometryMode = "arc" | "bar" | "lane" | "point";

/** How marks remain after their reveal window. */
export type PersistenceMode = "keep" | "ephemeral" | "finale";

/** Chart (span×magnitude) vs France/Belgium geographic map. */
export type ViewMode = "chart" | "map";

/** Basemap extent for `viewMode: "map"`: legacy France+Belgium or Europe. */
export type MapRegion = "fr-be" | "europe";
/** Region granularity for the European basemap / choropleth. */
export type MapLevel = "country" | "nuts1" | "nuts2" | "nuts3";

/** Color marks by category or continuous field. */
export type ColorByField =
  | "group"
  | "cohort"
  | "magnitude"
  | "span"
  | `meta.${string}`;

export type TickerKind = "count" | "magnitudeSum" | "spanSum";

export interface SpanEndpoints {
  start: string | number;
  end: string | number;
}

export interface SpanMark {
  id: string;
  span: SpanEndpoints;
  magnitude: number;
  label?: string;
  revealAt?: string | number;
  cohort?: string | number;
  group?: string;
  meta?: Record<string, unknown>;
}

export interface SpanMagnitudeDefaults {
  geometry?: GeometryMode;
  colorScheme?: string;
  animate?: boolean;
  tickers?: TickerKind[];
}

export interface SpanMagnitudeDocument {
  version: 1;
  unit: SpanUnit;
  marks: SpanMark[];
  title?: string;
  description?: string;
  magnitudeLabel?: string;
  spanLabel?: string;
  countLabel?: string;
  defaults?: SpanMagnitudeDefaults;
}

/** Normalized mark with numeric endpoints (ms for dates). */
export interface NormalizedMark {
  id: string;
  label: string;
  start: number;
  end: number;
  spanLength: number;
  magnitude: number;
  revealAt: number;
  cohort: string;
  group: string;
  meta: Record<string, unknown>;
  raw: SpanMark;
}

export interface NormalizedDocument {
  version: 1;
  unit: SpanUnit;
  title: string;
  description: string;
  magnitudeLabel: string;
  spanLabel: string;
  countLabel: string;
  defaults: Required<SpanMagnitudeDefaults>;
  marks: NormalizedMark[];
  xDomain: [number, number];
  magnitudeMax: number;
  cohorts: string[];
  groups: string[];
}

export interface LayoutMark {
  mark: NormalizedMark;
  x0: number;
  x1: number;
  yBase: number;
  bulge: number;
  strokeWidth: number;
  barHeight: number;
  color: string;
  side: 1 | -1;
  pathD: string;
  bar: { x: number; y: number; width: number; height: number };
  /** Dot geometry (span midpoint + vertical jitter). */
  point: { cx: number; cy: number; r: number; strokeWidth: number };
}

export interface VizOptions {
  /** Geometry mode. Default from document.defaults or "arc". */
  geometry?: GeometryMode;
  /**
   * Post-reveal persistence. Default `"keep"`.
   * - `keep` — marks stay after reveal
   * - `ephemeral` — fade out after each mark’s reveal window
   * - `finale` — ephemeral during the film, then all reappear at the end as a cloud
   */
  persistence?: PersistenceMode;
  /**
   * Point magnitude encoding when `geometry === "point"`.
   * `"radius"` (default) sizes the dot by magnitude; `"stroke"` uses a fixed radius
   * and encodes magnitude in stroke width.
   */
  pointStyle?: "radius" | "stroke";
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
  autoplay?: boolean;
  durationMs?: number;
  /** First k marks animate slowly with labels. Default 2. */
  slowFirst?: number;
  tickers?: boolean | TickerKind[];
  /**
   * Number / date locale for tickers, tooltip and axis ticks. Default `"en"`
   * (`10.6M`, `2025-02`); `"fr"` → `10,6 M€`, `févr. 2025` (narrow no-break spaces).
   */
  locale?: "en" | "fr";
  /** Unit appended to magnitudes in tickers and tooltip (e.g. `"€"`). */
  magnitudeUnit?: string;
  /** Custom magnitude formatter (overrides `locale` / `magnitudeUnit`). */
  formatMagnitude?: (v: number) => string;
  /** Dark storytelling theme. */
  theme?: "dark" | "light";
  /** Cohort to show; null = all. */
  cohortFilter?: string | null;
  /** Split: selected cohort above axis, rest below (mirror). */
  mirrorSplit?: boolean;
  /** Cohort used as "A" when mirrorSplit is true. */
  mirrorCohort?: string | null;
  colorScheme?: string;
  /**
   * Color marks by field. Categorical: group/cohort/meta.* → Alteridea reds
   * (or mixed cool when many categories). Continuous: magnitude/span/numeric
   * meta → cold→hot (blue→green→yellow→red). Default `"group"`.
   */
  colorBy?: ColorByField | string | null;
  /**
   * Film-motion reveal: fraction of timeline reserved for slow first marks (0–0.5).
   * Default 0.28. Higher = slower open.
   */
  slowOpen?: number;
  /**
   * Cascade density after the slow open. `"fast"` packs more marks later with
   * shorter per-mark windows; `"slow"` spreads them. Default `"normal"`.
   */
  cascadeSpeed?: "slow" | "normal" | "fast";
  /** Per-mark entrance scale/opacity. Default true (honours prefers-reduced-motion). */
  entrance?: boolean;
  /** Arc↔bar morph / crossfade duration in ms. Default 550. */
  morphDurationMs?: number;
  /**
   * Facet / breakdown axis for the summary strip below the chart.
   * Built-ins: `"year"`, `"cohort"`, `"group"`; also `"meta.<key>"` for discovered meta fields.
   * Default: `"year"` when unit is date, else `"cohort"` / `"group"` when useful.
   */
  facetBy?: string | null;
  /** Facet summary strip (averages + quartile mini-arcs). Default true. */
  facetSummary?: boolean;
  /** Alias for enabling the facet summary strip (`facetSummary !== false`). Default true. */
  yearSummary?: boolean;
  /**
   * Display mode. `"chart"` (default) = span×magnitude geometries;
   * `"map"` = France+Belgium SVG basemap with geocoded dots (lat/lon or postal in meta).
   */
  viewMode?: ViewMode;
  /**
   * Basemap for the map view. `"fr-be"` (default) = France départements + Belgian
   * provinces; `"europe"` = Europe (Natural Earth countries, public domain).
   */
  mapRegion?: MapRegion;
  /** Europe only: basemap level. Only `"country"` is drawn; legacy `"nuts*"` values are read as `"country"`. */
  mapLevel?: MapLevel;
  /**
   * Europe only: `"region"` (default) frames the whole of Europe;
   * `"data"` zooms to the regions that contain geocoded points.
   */
  mapFit?: "region" | "data";
  /** At late film / finale, paint region fills by revealed magnitude (Alteridea reds). Default true. */
  mapChoropleth?: boolean;
  /** Soft radial heatmap blobs under dots at finale. Default true. */
  mapHeatmap?: boolean;
  onHover?: (mark: NormalizedMark | null, event?: MouseEvent) => void;
  onSelect?: (mark: NormalizedMark | null) => void;
  onTick?: (state: TickerState) => void;
  onComplete?: () => void;
}

export interface TickerState {
  count: number;
  magnitudeSum: number;
  spanSum: number;
  progress: number;
}

export interface VizHandle {
  play(): void;
  pause(): void;
  reset(): void;
  setGeometry(mode: GeometryMode): void;
  setPersistence(mode: PersistenceMode): void;
  setColorBy(colorBy: ColorByField | string | null): void;
  setColorScheme(scheme: string): void;
  setFilter(opts: { cohort?: string | null; mirrorSplit?: boolean; mirrorCohort?: string | null }): void;
  setFacetBy(facetBy: string | null): void;
  setViewMode(mode: ViewMode): void;
  /** Switch basemap region / level / framing (map view). */
  setMap(opts: { region?: MapRegion; level?: MapLevel; fit?: "region" | "data" }): void;
  setProgress(t: number): void;
  getState(): TickerState;
  destroy(): void;
  update(doc: SpanMagnitudeDocument | NormalizedDocument, options?: Partial<VizOptions>): void;
}

export class ParseError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("\n"));
    this.name = "ParseError";
    this.issues = issues;
  }
}
