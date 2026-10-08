import { scaleSqrt } from "d3";
import { arcPath, formatMagnitude } from "./layout.js";
import type { NormalizedDocument, NormalizedMark, SpanUnit } from "./types.js";

export interface FacetQuartileArc {
  span: number;
  magnitude: number;
}

export interface FacetSummaryRow {
  /** Bucket key (year number as string, cohort, group, meta value, …). */
  key: string;
  label: string;
  count: number;
  avgSpan: number;
  avgMagnitude: number;
  quartiles: [FacetQuartileArc, FacetQuartileArc, FacetQuartileArc];
}

export interface FacetAxis {
  key: string;
  /** Short bilingual / display label for UI. */
  label: string;
  kind: "builtin" | "meta";
}

export interface FacetSummaryElements {
  root: HTMLElement;
}

export type YearQuartileArc = FacetQuartileArc;
export type YearSummaryRow = FacetSummaryRow & { year: number };
export type YearSummaryElements = FacetSummaryElements;

export interface FacetSummaryDomOptions {
  facetBy?: string | null;
  onFacetChange?: (facetBy: string) => void;
  /** Show the "Décliner par / Break down by" picker. Default true. */
  showPicker?: boolean;
}

/** Linear-interpolated quantile on a sorted numeric array (R-7 style). */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const clamped = Math.min(1, Math.max(0, p));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const t = idx - lo;
  return sorted[lo]! * (1 - t) + sorted[hi]! * t;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function parseCohortYear(cohort: string): number | null {
  if (/^\d{4}$/.test(cohort)) {
    const y = Number(cohort);
    if (y >= 1000 && y <= 9999) return y;
  }
  return null;
}

function utcYear(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

function sameUtcDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function axisDisplay(key: string): { fr: string; en: string; column: string } {
  switch (key) {
    case "year":
      return { fr: "année", en: "year", column: "Année / Year" };
    case "cohort":
      return { fr: "cohorte", en: "cohort", column: "Cohorte / Cohort" };
    case "group":
      return { fr: "groupe", en: "group", column: "Groupe / Group" };
    default:
      break;
  }
  if (key.startsWith("meta.")) {
    const name = key.slice(5);
    return { fr: name, en: name, column: name };
  }
  return { fr: key, en: key, column: key };
}

function axisOptionLabel(axis: FacetAxis): string {
  switch (axis.key) {
    case "year":
      return "Année / Year";
    case "cohort":
      return "Cohorte / Cohort";
    case "group":
      return "Groupe / Group";
    default:
      return axis.kind === "meta" ? `meta.${axis.label}` : axis.label;
  }
}

/**
 * Calendar / bucket years a mark contributes to.
 * - date: every overlapping calendar year; zero-length → start (or revealAt); plus cohort year if 4-digit
 * - number: floored revealAt (or start)
 */
export function yearsForMark(mark: NormalizedMark, unit: SpanUnit): number[] {
  if (unit === "number") {
    const v = Number.isFinite(mark.revealAt) ? mark.revealAt : mark.start;
    return [Math.floor(v)];
  }

  const years = new Set<number>();
  const startOk = Number.isFinite(mark.start);
  const endOk = Number.isFinite(mark.end);

  if (startOk && endOk) {
    const zeroLen =
      mark.spanLength === 0 ||
      mark.start === mark.end ||
      sameUtcDay(mark.start, mark.end);
    if (zeroLen) {
      years.add(utcYear(mark.start));
    } else {
      const y0 = utcYear(mark.start);
      const y1 = utcYear(mark.end);
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      for (let y = lo; y <= hi; y++) years.add(y);
    }
  } else {
    const t = Number.isFinite(mark.revealAt)
      ? mark.revealAt
      : startOk
        ? mark.start
        : mark.end;
    if (Number.isFinite(t)) years.add(utcYear(t));
  }

  const cohortYear = parseCohortYear(mark.cohort);
  if (cohortYear != null) years.add(cohortYear);

  return [...years];
}

/**
 * Keys a mark contributes to for a given facet axis.
 * Year facets may return multiple keys (calendar overlap); others usually one.
 */
export function keysForMark(
  mark: NormalizedMark,
  facetBy: string,
  unit: SpanUnit
): string[] {
  if (facetBy === "year") {
    return yearsForMark(mark, unit).map(String);
  }
  if (facetBy === "cohort") {
    return mark.cohort ? [mark.cohort] : [];
  }
  if (facetBy === "group") {
    return mark.group ? [mark.group] : [];
  }
  if (facetBy.startsWith("meta.")) {
    const metaKey = facetBy.slice(5);
    const v = mark.meta[metaKey];
    if (!isPrimitive(v)) return [];
    return [String(v)];
  }
  return [];
}

/** Discover built-in + meta.* axes available for the facet picker. */
export function discoverFacetAxes(
  marks: NormalizedMark[],
  _unit: SpanUnit
): FacetAxis[] {
  const axes: FacetAxis[] = [
    { key: "year", label: "year", kind: "builtin" },
    { key: "cohort", label: "cohort", kind: "builtin" },
    { key: "group", label: "group", kind: "builtin" },
  ];

  const metaStats = new Map<
    string,
    { ok: boolean; seenPrimitive: boolean }
  >();

  for (const mark of marks) {
    for (const [k, v] of Object.entries(mark.meta ?? {})) {
      let stat = metaStats.get(k);
      if (!stat) {
        stat = { ok: true, seenPrimitive: false };
        metaStats.set(k, stat);
      }
      if (v === null || v === undefined) continue;
      if (!isPrimitive(v)) {
        stat.ok = false;
        continue;
      }
      stat.seenPrimitive = true;
    }
  }

  const metaKeys = [...metaStats.entries()]
    .filter(([, s]) => s.ok && s.seenPrimitive)
    .map(([k]) => k)
    .sort((a, b) => a.localeCompare(b));

  for (const k of metaKeys) {
    axes.push({ key: `meta.${k}`, label: k, kind: "meta" });
  }

  return axes;
}

/** Default facet: year when unit is date; else cohort / group if useful. */
export function defaultFacetBy(
  doc: NormalizedDocument,
  marks: NormalizedMark[] = doc.marks
): string {
  const axes = discoverFacetAxes(marks, doc.unit);
  const keys = new Set(axes.map((a) => a.key));

  if (doc.unit === "date" && keys.has("year")) return "year";

  const cohorts = new Set(marks.map((m) => m.cohort));
  if (cohorts.size > 1 && keys.has("cohort")) return "cohort";

  const groups = new Set(marks.map((m) => m.group));
  if (groups.size > 1 && keys.has("group")) return "group";

  for (const a of axes) {
    if (a.kind === "meta") return a.key;
  }

  if (keys.has("cohort")) return "cohort";
  if (keys.has("group")) return "group";
  return axes[0]?.key ?? "year";
}

export function resolveFacetBy(
  doc: NormalizedDocument,
  marks: NormalizedMark[],
  requested?: string | null
): string {
  const axes = discoverFacetAxes(marks, doc.unit);
  const keys = new Set(axes.map((a) => a.key));
  if (requested && keys.has(requested)) return requested;
  return defaultFacetBy(doc, marks);
}

function sortFacetKeys(keys: string[], facetBy: string): string[] {
  if (facetBy === "year") {
    return [...keys].sort((a, b) => Number(a) - Number(b));
  }
  return [...keys].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function computeFacetSummaries(
  marks: NormalizedMark[],
  facetBy: string,
  unit: SpanUnit
): FacetSummaryRow[] {
  const byKey = new Map<string, NormalizedMark[]>();

  for (const mark of marks) {
    for (const key of keysForMark(mark, facetBy, unit)) {
      let list = byKey.get(key);
      if (!list) {
        list = [];
        byKey.set(key, list);
      }
      list.push(mark);
    }
  }

  const keys = sortFacetKeys([...byKey.keys()], facetBy);
  const rows: FacetSummaryRow[] = [];

  for (const key of keys) {
    const group = byKey.get(key)!;
    const spans = group.map((m) => m.spanLength).sort((a, b) => a - b);
    const mags = group.map((m) => m.magnitude).sort((a, b) => a - b);
    const qSpans = [0.25, 0.5, 0.75].map((p) => quantileSorted(spans, p));
    const qMags = [0.25, 0.5, 0.75].map((p) => quantileSorted(mags, p));

    rows.push({
      key,
      label: key,
      count: group.length,
      avgSpan: mean(group.map((m) => m.spanLength)),
      avgMagnitude: mean(group.map((m) => m.magnitude)),
      quartiles: [
        { span: qSpans[0]!, magnitude: qMags[0]! },
        { span: qSpans[1]!, magnitude: qMags[1]! },
        { span: qSpans[2]!, magnitude: qMags[2]! },
      ],
    });
  }

  return rows;
}

/** @deprecated Prefer computeFacetSummaries(..., "year", unit) */
export function computeYearSummaries(
  marks: NormalizedMark[],
  unit: SpanUnit
): YearSummaryRow[] {
  return computeFacetSummaries(marks, "year", unit).map((row) => ({
    ...row,
    year: Number(row.key),
  }));
}

export function formatAvgSpan(avgSpan: number, unit: SpanUnit): string {
  if (unit === "date") {
    const days = avgSpan / (1000 * 60 * 60 * 24);
    return days >= 365
      ? `${(days / 365).toFixed(1)}y`
      : `${Math.round(days)}d`;
  }
  return formatMagnitude(avgSpan);
}

const MINI_SLOT_W = 38;
const MINI_H = 32;
const MINI_GAP = 4;
const MINI_COLOR = ["#9a1c28", "#d62839", "#e9374a"];

function renderMiniArcsSvg(
  quartiles: FacetSummaryRow["quartiles"],
  spanMax: number,
  magMax: number
): string {
  const strokeScale = scaleSqrt()
    .domain([0, Math.max(magMax, 1e-9)])
    .range([0.35, 1.55]);
  const totalW = MINI_SLOT_W * 3 + MINI_GAP * 2;
  const y = MINI_H * 0.88;

  const paths = quartiles
    .map((q, i) => {
      const spanNorm = Math.min(1, q.span / Math.max(spanMax, 1e-9));
      const arcW = Math.max(8, 10 + spanNorm * (MINI_SLOT_W - 12));
      const xOffset = i * (MINI_SLOT_W + MINI_GAP);
      const x0 = xOffset + (MINI_SLOT_W - arcW) / 2;
      const x1 = x0 + arcW;
      const bulge = Math.max(6, MINI_H * 0.42 * (0.55 + 0.45 * spanNorm));
      const d = arcPath(x0, x1, y, bulge, 1);
      const sw = strokeScale(q.magnitude);
      const color = MINI_COLOR[i] ?? MINI_COLOR[1]!;
      const label = i === 0 ? "Q1" : i === 1 ? "Q2" : "Q3";
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" opacity="0.92"><title>${label}: span ${q.span}, mag ${q.magnitude}</title></path>`;
    })
    .join("");

  return `<svg class="smv-facet-summary-mini smv-year-summary-mini" viewBox="0 0 ${totalW} ${MINI_H}" width="${totalW}" height="${MINI_H}" aria-hidden="true">${paths}</svg>`;
}

function renderRowsHtml(
  rows: FacetSummaryRow[],
  doc: NormalizedDocument,
  spanMax: number,
  magMax: number
): string {
  return rows
    .map(
      (row) => `
      <div class="smv-facet-summary-row smv-year-summary-row">
        <span class="smv-facet-summary-col smv-facet-summary-col--key smv-year-summary-col smv-year-summary-col--year" title="n=${row.count}">${escapeHtml(row.label)}</span>
        <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--span" title="n=${row.count}">${escapeHtml(formatAvgSpan(row.avgSpan, doc.unit))}</span>
        <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--mag">${escapeHtml(formatMagnitude(row.avgMagnitude))}</span>
        <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--arcs">${renderMiniArcsSvg(row.quartiles, spanMax, magMax)}</span>
      </div>`
    )
    .join("");
}

export function createFacetSummaryDom(
  container: HTMLElement,
  doc: NormalizedDocument,
  marks: NormalizedMark[],
  theme: "dark" | "light",
  options: FacetSummaryDomOptions = {}
): FacetSummaryElements {
  const axes = discoverFacetAxes(marks, doc.unit);
  let facetBy = resolveFacetBy(doc, marks, options.facetBy);
  const showPicker = options.showPicker !== false;

  const root = document.createElement("div");
  root.className = `smv-facet-summary smv-year-summary smv-facet-summary--${theme} smv-year-summary--${theme}`;
  root.setAttribute("role", "region");

  const titleEl = document.createElement("div");
  titleEl.className = "smv-facet-summary-title smv-year-summary-title";

  const controls = document.createElement("div");
  controls.className = "smv-facet-summary-controls";

  let selectEl: HTMLSelectElement | null = null;
  if (showPicker && axes.length > 0) {
    const label = document.createElement("label");
    label.className = "smv-facet-summary-picker-label";
    label.innerHTML = `<span>Décliner par / Break down by</span>`;
    selectEl = document.createElement("select");
    selectEl.className = "smv-facet-summary-picker";
    selectEl.setAttribute("aria-label", "Décliner par / Break down by");
    for (const axis of axes) {
      const opt = document.createElement("option");
      opt.value = axis.key;
      opt.textContent = axisOptionLabel(axis);
      selectEl.appendChild(opt);
    }
    selectEl.value = facetBy;
    label.appendChild(selectEl);
    controls.appendChild(label);
  }

  const colsEl = document.createElement("div");
  colsEl.className = "smv-facet-summary-cols smv-year-summary-cols";
  colsEl.setAttribute("aria-hidden", "true");

  const list = document.createElement("div");
  list.className = "smv-facet-summary-list smv-year-summary-list";

  const header = document.createElement("div");
  header.className = "smv-facet-summary-header smv-year-summary-header";
  header.appendChild(titleEl);
  if (showPicker) header.appendChild(controls);
  header.appendChild(colsEl);

  root.appendChild(header);
  root.appendChild(list);

  function paint(activeFacet: string): void {
    facetBy = activeFacet;
    const display = axisDisplay(activeFacet);
    const rows = computeFacetSummaries(marks, activeFacet, doc.unit);

    root.setAttribute(
      "aria-label",
      `Synthèse par ${display.fr} / Breakdown by ${display.en}`
    );
    titleEl.textContent = `Synthèse par ${display.fr} · Breakdown by ${display.en}`;

    const spanHeading = `${escapeHtml(doc.spanLabel)} (moy.)`;
    const magHeading = `${escapeHtml(doc.magnitudeLabel)} (moy.)`;
    colsEl.innerHTML = `
      <span class="smv-facet-summary-col smv-facet-summary-col--key smv-year-summary-col smv-year-summary-col--year">${escapeHtml(display.column)}</span>
      <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--span">${spanHeading}</span>
      <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--mag">${magHeading}</span>
      <span class="smv-facet-summary-col smv-year-summary-col smv-year-summary-col--arcs">Q1 · Médiane · Q3</span>
    `;

    if (rows.length === 0) {
      list.innerHTML = `<div class="smv-facet-summary-empty smv-year-summary-empty">No marks</div>`;
      return;
    }

    const spanMax = Math.max(
      ...rows.flatMap((r) => r.quartiles.map((q) => q.span)),
      1
    );
    const magMax = Math.max(
      ...rows.flatMap((r) => r.quartiles.map((q) => q.magnitude)),
      1
    );
    list.innerHTML = renderRowsHtml(rows, doc, spanMax, magMax);
  }

  if (selectEl) {
    selectEl.addEventListener("change", () => {
      const next = selectEl!.value;
      paint(next);
      options.onFacetChange?.(next);
    });
  }

  paint(facetBy);
  container.appendChild(root);
  return { root };
}

/** @deprecated Prefer createFacetSummaryDom */
export function createYearSummaryDom(
  container: HTMLElement,
  doc: NormalizedDocument,
  marks: NormalizedMark[],
  theme: "dark" | "light"
): YearSummaryElements {
  return createFacetSummaryDom(container, doc, marks, theme, {
    facetBy: "year",
    showPicker: false,
  });
}

export const FACET_SUMMARY_CSS = `
.smv-chart-area {
  position: relative;
  width: 100%;
}
.smv-facet-summary,
.smv-year-summary {
  border-top: 1px solid rgba(120, 113, 108, 0.35);
  padding: 10px 14px 12px;
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 12px;
}
.smv-facet-summary-title,
.smv-year-summary-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.7;
  margin-bottom: 8px;
}
.smv-facet-summary-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.smv-facet-summary-picker-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
.smv-facet-summary-picker {
  font: inherit;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid rgba(120, 113, 108, 0.45);
  background: rgba(28, 25, 23, 0.85);
  color: inherit;
  cursor: pointer;
  max-width: min(280px, 100%);
}
.smv-facet-summary--light .smv-facet-summary-picker,
.smv-year-summary--light .smv-facet-summary-picker {
  background: #fff;
  border-color: rgba(120, 113, 108, 0.35);
  color: #1c1917;
}
.smv-facet-summary-cols,
.smv-year-summary-cols,
.smv-facet-summary-row,
.smv-year-summary-row {
  display: grid;
  grid-template-columns: minmax(88px, 1.25fr) minmax(64px, 1fr) minmax(72px, 1.1fr) 130px;
  gap: 8px 12px;
  align-items: center;
}
.smv-facet-summary-cols,
.smv-year-summary-cols {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.55;
  margin-bottom: 6px;
  padding: 0 2px;
}
.smv-facet-summary-list,
.smv-year-summary-list {
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  scrollbar-width: thin;
}
.smv-facet-summary-row,
.smv-year-summary-row {
  padding: 5px 2px;
  border-radius: 4px;
}
.smv-facet-summary-row + .smv-facet-summary-row,
.smv-year-summary-row + .smv-year-summary-row {
  border-top: 1px solid rgba(120, 113, 108, 0.18);
}
.smv-facet-summary-col--key,
.smv-year-summary-col--year {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.smv-facet-summary-col.smv-year-summary-col--span,
.smv-facet-summary-col.smv-year-summary-col--mag,
.smv-year-summary-col--span,
.smv-year-summary-col--mag {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.smv-facet-summary-col.smv-year-summary-col--arcs,
.smv-year-summary-col--arcs {
  display: flex;
  justify-content: flex-end;
}
.smv-facet-summary-mini,
.smv-year-summary-mini {
  display: block;
  overflow: visible;
}
.smv-facet-summary-empty,
.smv-year-summary-empty {
  opacity: 0.55;
  font-size: 12px;
  padding: 4px 0;
}
.smv-facet-summary--dark,
.smv-year-summary--dark {
  background: #0b0b0c;
  color: #e7e5e4;
}
.smv-facet-summary--dark .smv-facet-summary-col--key,
.smv-facet-summary--dark .smv-year-summary-col--year,
.smv-year-summary--dark .smv-year-summary-col--year { color: #f4a0a8; }
.smv-facet-summary--dark .smv-year-summary-col--span,
.smv-year-summary--dark .smv-year-summary-col--span { color: #f5a623; }
.smv-facet-summary--dark .smv-year-summary-col--mag,
.smv-year-summary--dark .smv-year-summary-col--mag { color: #e8c547; }
.smv-facet-summary--dark .smv-facet-summary-row:hover,
.smv-year-summary--dark .smv-year-summary-row:hover {
  background: rgba(245, 166, 35, 0.06);
}
.smv-facet-summary--light,
.smv-year-summary--light {
  background: #fafaf9;
  color: #1c1917;
}
.smv-facet-summary--light .smv-facet-summary-col--key,
.smv-facet-summary--light .smv-year-summary-col--year,
.smv-year-summary--light .smv-year-summary-col--year { color: #9a1c28; }
.smv-facet-summary--light .smv-year-summary-col--span,
.smv-year-summary--light .smv-year-summary-col--span { color: #b82232; }
.smv-facet-summary--light .smv-year-summary-col--mag,
.smv-year-summary--light .smv-year-summary-col--mag { color: #d62839; }
.smv-facet-summary--light .smv-facet-summary-row:hover,
.smv-year-summary--light .smv-year-summary-row:hover {
  background: rgba(214, 40, 57, 0.06);
}
`;

/** @deprecated Prefer FACET_SUMMARY_CSS */
export const YEAR_SUMMARY_CSS = FACET_SUMMARY_CSS;
