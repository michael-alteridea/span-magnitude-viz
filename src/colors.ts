import { interpolateRgb, scaleOrdinal, scaleSequential } from "d3";
import type { NormalizedMark } from "./types.js";

/**
 * Alteridea brand crimson palette (alteridea.com `--red` / hover).
 * Primary: #d62839 · hover: #e9374a · soft: rgba(214,40,57,.14)
 */
export const ALTAIRADY_REDS = [
  "#3a0a10", // near-black burgundy
  "#5c1018",
  "#7a1520",
  "#9a1c28",
  "#b82232",
  "#d62839", // Alteridea primary (exact)
  "#e9374a", // Alteridea hover (exact)
  "#ed5564",
  "#f0707c",
  "#c42234",
] as const;

/** @deprecated Alias — same as ALTAIRADY_REDS (Alteridea brand). */
export const ALTERIDEA_REDS = ALTAIRADY_REDS;

/**
 * Reporting 4D « bleu pétrole » identity (chosen 2026-10-08).
 * main: #0E6E8C · light (accents on dark backgrounds): #3FA7C4 · dark: #08465A
 */
export const PETROLE_MAIN = "#0E6E8C";
export const PETROLE_LIGHT = "#3FA7C4";
export const PETROLE_DARK = "#08465A";

/**
 * Reporting 4D categorical palette: petrol / blue / grey ramp, ordered so that
 * neighbouring categories stay distinguishable on dark and light backgrounds.
 * Colour scheme keys: "petrole" (aliases "petrol", "reporting4d").
 */
export const PETROLE = [
  "#0E6E8C", // main (exact)
  "#3FA7C4", // light (exact)
  "#08465A", // dark (exact)
  "#8ECFE2", // pale petrol
  "#2F5D8A", // petrol blue
  "#8A9BA3", // blue grey
  "#1B8BA8", // mid petrol
  "#C3E4EE", // ice
  "#4F7CAC", // steel blue
  "#5E6E76", // slate
] as const;

/** Sequential petrol ramp (low → high) used for continuous colorBy with the "petrole" scheme. */
export const PETROLE_SEQUENTIAL = ["#2F5D8A", "#0E6E8C", "#1B8BA8", "#3FA7C4", "#8ECFE2"] as const;

/** Scheme keys that resolve to the petrol palette. */
export function isPetroleScheme(scheme: string | null | undefined): boolean {
  return scheme === "petrole" || scheme === "petrol" || scheme === "reporting4d";
}

/** Legacy warm gold (kept for colorScheme: "warm"). */
export const WARM_PALETTE = [
  "#f5a623",
  "#e8913a",
  "#d4762c",
  "#c45c28",
  "#a84a32",
  "#e8c547",
  "#f0b429",
  "#d97706",
  "#b45309",
  "#92400e",
] as const;

export const OBSERVABLE10 = [
  "#4269d0",
  "#efb118",
  "#ff725c",
  "#6cc5b0",
  "#3ca951",
  "#ff8ab7",
  "#a463f2",
  "#97bbf5",
  "#9c6b4e",
  "#9498a0",
] as const;

/** Cool mix for many categorical values (> palette length). */
export const MIXED_COOL = [
  "#d62839",
  "#1d4ed8",
  "#e9374a",
  "#0d9488",
  "#9a1c28",
  "#6366f1",
  "#b82232",
  "#0891b2",
  "#c42234",
  "#4f46e5",
  "#7a1520",
  "#0284c7",
] as const;

/** Cold → hot sequential / diverging storytelling gradient. */
export const COLD_HOT = [
  "#1e3a8a", // deep blue
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#ef4444",
  "#d62839", // Alteridea hot end
] as const;

export const MUTED = "#6b7280";

/** Accent tokens for UI chrome (tickers, tooltips, facet strip) — alteridea.com. */
export const BRAND = {
  accent: "#d62839",
  accentSoft: "#e9374a",
  accentDeep: "#9a1c28",
  accentGlow: "rgba(214, 40, 57, 0.55)",
  annotation: "#f4a0a8",
  miniArcs: ["#9a1c28", "#d62839", "#e9374a"] as const,
} as const;

/** Accent tokens for Reporting 4D (bleu pétrole). Same shape as BRAND. */
export const BRAND_PETROLE = {
  accent: PETROLE_MAIN,
  accentSoft: PETROLE_LIGHT,
  accentDeep: PETROLE_DARK,
  accentGlow: "rgba(63, 167, 196, 0.55)",
  annotation: "#8ECFE2",
  miniArcs: [PETROLE_DARK, PETROLE_MAIN, PETROLE_LIGHT] as const,
} as const;

/** Accent tokens matching a colour scheme (petrol for "petrole", Alteridea red otherwise). */
export function brandForScheme(scheme: string | null | undefined): typeof BRAND | typeof BRAND_PETROLE {
  return isPetroleScheme(scheme) ? BRAND_PETROLE : BRAND;
}

export function isContinuousColorBy(colorBy: string | null | undefined): boolean {
  return colorBy === "magnitude" || colorBy === "span";
}

function rampInterpolator(stops: readonly string[]) {
  const n = stops.length;
  return (t: number) => {
    const u = Math.max(0, Math.min(1, t));
    const x = u * (n - 1);
    const i = Math.floor(x);
    const f = x - i;
    if (i >= n - 1) return stops[n - 1]!;
    return interpolateRgb(stops[i]!, stops[i + 1]!)(f);
  };
}

/** Continuous interpolator: petrol ramp for "petrole", cold → hot for every other scheme. */
function continuousInterpolator(scheme: string) {
  return rampInterpolator(isPetroleScheme(scheme) ? PETROLE_SEQUENTIAL : COLD_HOT);
}

function categoricalPalette(scheme: string, categoryCount: number): readonly string[] {
  if (scheme === "muted") return [MUTED];
  if (scheme === "observable10") return OBSERVABLE10;
  if (scheme === "warm") return WARM_PALETTE;
  if (scheme === "coldhot" || scheme === "cold-hot") return COLD_HOT;
  if (isPetroleScheme(scheme)) return PETROLE;
  // Default Alteridea reds (scheme keys: altairady | alteridea); mix cool hues when many categories
  if (categoryCount > ALTAIRADY_REDS.length) return MIXED_COOL;
  return ALTAIRADY_REDS;
}

function metaValue(mark: NormalizedMark, key: string): string {
  const v = mark.meta[key];
  if (v === undefined || v === null) return "(none)";
  return String(v);
}

function colorByValue(mark: NormalizedMark, colorBy: string): string | number {
  if (colorBy === "group") return mark.group;
  if (colorBy === "cohort") return mark.cohort;
  if (colorBy === "magnitude") return mark.magnitude;
  if (colorBy === "span") return mark.spanLength;
  if (colorBy.startsWith("meta.")) {
    return metaValue(mark, colorBy.slice(5));
  }
  return mark.group;
}

function isNumericMeta(marks: NormalizedMark[], key: string): boolean {
  let saw = false;
  for (const m of marks) {
    const v = m.meta[key];
    if (v === undefined || v === null) continue;
    saw = true;
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return saw;
}

/**
 * Resolve a fill/stroke color for each mark given scheme + colorBy.
 */
export function resolveMarkColor(
  mark: NormalizedMark,
  marks: NormalizedMark[],
  options: {
    colorScheme?: string;
    colorBy?: string | null;
    groups?: string[];
    cohorts?: string[];
  }
): string {
  const scheme = options.colorScheme ?? "altairady";
  const colorBy = options.colorBy ?? "group";

  if (scheme === "muted") return MUTED;

  // Continuous: magnitude / span / numeric meta
  if (colorBy === "magnitude" || colorBy === "span") {
    const values = marks.map((m) =>
      colorBy === "magnitude" ? m.magnitude : m.spanLength
    );
    const lo = Math.min(...values);
    const hi = Math.max(...values, lo + 1e-9);
    const scale = scaleSequential(continuousInterpolator(scheme)).domain([lo, hi]);
    const v = colorBy === "magnitude" ? mark.magnitude : mark.spanLength;
    return scale(v);
  }

  if (colorBy.startsWith("meta.")) {
    const key = colorBy.slice(5);
    if (isNumericMeta(marks, key)) {
      const values = marks
        .map((m) => m.meta[key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const lo = Math.min(...values);
      const hi = Math.max(...values, lo + 1e-9);
      const scale = scaleSequential(continuousInterpolator(scheme)).domain([lo, hi]);
      const v = mark.meta[key];
      if (typeof v === "number" && Number.isFinite(v)) return scale(v);
      return MUTED;
    }
  }

  // Categorical
  let domain: string[];
  if (colorBy === "cohort") {
    domain = options.cohorts ?? [...new Set(marks.map((m) => m.cohort))].sort();
  } else if (colorBy.startsWith("meta.")) {
    const key = colorBy.slice(5);
    domain = [...new Set(marks.map((m) => metaValue(m, key)))].sort();
  } else {
    domain = options.groups ?? [...new Set(marks.map((m) => m.group))].sort();
  }

  const palette = categoricalPalette(scheme, domain.length);
  const scale = scaleOrdinal<string, string>().domain(domain).range([...palette]);
  const cat = String(colorByValue(mark, colorBy));
  return scale(cat);
}

/** Discover colorBy options for UI (group, cohort, magnitude, span, meta.*). */
export function discoverColorByAxes(marks: NormalizedMark[]): Array<{
  key: string;
  label: string;
  kind: "continuous" | "categorical";
}> {
  const axes: Array<{ key: string; label: string; kind: "continuous" | "categorical" }> = [
    { key: "group", label: "Group", kind: "categorical" },
    { key: "cohort", label: "Cohort", kind: "categorical" },
    { key: "magnitude", label: "Magnitude (cold→hot)", kind: "continuous" },
    { key: "span", label: "Span (cold→hot)", kind: "continuous" },
  ];

  const metaKeys = new Map<string, { numeric: boolean; count: number }>();
  for (const m of marks) {
    for (const [k, v] of Object.entries(m.meta)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "object") continue;
      const prev = metaKeys.get(k) ?? { numeric: true, count: 0 };
      prev.count += 1;
      if (typeof v !== "number" || !Number.isFinite(v)) prev.numeric = false;
      metaKeys.set(k, prev);
    }
  }

  for (const [k, info] of [...metaKeys.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (info.count === 0) continue;
    axes.push({
      key: `meta.${k}`,
      label: info.numeric ? `meta.${k} (cold→hot)` : `meta.${k}`,
      kind: info.numeric ? "continuous" : "categorical",
    });
  }

  return axes;
}

/** Linear helper for morph blends (exported for tests / morph). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
