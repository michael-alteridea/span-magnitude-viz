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

export function isContinuousColorBy(colorBy: string | null | undefined): boolean {
  return colorBy === "magnitude" || colorBy === "span";
}

function coldHotInterpolator() {
  const n = COLD_HOT.length;
  return (t: number) => {
    const u = Math.max(0, Math.min(1, t));
    const x = u * (n - 1);
    const i = Math.floor(x);
    const f = x - i;
    if (i >= n - 1) return COLD_HOT[n - 1]!;
    return interpolateRgb(COLD_HOT[i]!, COLD_HOT[i + 1]!)(f);
  };
}

function categoricalPalette(scheme: string, categoryCount: number): readonly string[] {
  if (scheme === "muted") return [MUTED];
  if (scheme === "observable10") return OBSERVABLE10;
  if (scheme === "warm") return WARM_PALETTE;
  if (scheme === "coldhot" || scheme === "cold-hot") return COLD_HOT;
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
    const scale = scaleSequential(coldHotInterpolator()).domain([lo, hi]);
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
      const scale = scaleSequential(coldHotInterpolator()).domain([lo, hi]);
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
