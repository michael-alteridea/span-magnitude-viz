/** Span unit: ISO dates or plain numbers. */
export type SpanUnit = "date" | "number";

export type GeometryMode = "arc" | "bar" | "lane";

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
}

export interface VizOptions {
  /** Geometry mode. Default from document.defaults or "arc". */
  geometry?: GeometryMode;
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  animate?: boolean;
  autoplay?: boolean;
  durationMs?: number;
  /** First k marks animate slowly with labels. Default 2. */
  slowFirst?: number;
  tickers?: boolean | TickerKind[];
  /** Dark storytelling theme. */
  theme?: "dark" | "light";
  /** Cohort to show; null = all. */
  cohortFilter?: string | null;
  /** Split: selected cohort above axis, rest below (mirror). */
  mirrorSplit?: boolean;
  /** Cohort used as "A" when mirrorSplit is true. */
  mirrorCohort?: string | null;
  colorScheme?: string;
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
  setFilter(opts: { cohort?: string | null; mirrorSplit?: boolean; mirrorCohort?: string | null }): void;
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
