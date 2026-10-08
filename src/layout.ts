import { scaleLinear, scaleSqrt } from "d3";
import { resolveMarkColor } from "./colors.js";
import type {
  GeometryMode,
  LayoutMark,
  NormalizedDocument,
  NormalizedMark,
  VizOptions,
} from "./types.js";

export interface LayoutResult {
  marks: LayoutMark[];
  xScale: (v: number) => number;
  xDomain: [number, number];
  yBase: number;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
  geometry: GeometryMode;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Quadratic Bézier arc from (x0,y) to (x1,y) with control at midpoint raised by bulge*side. */
export function arcPath(
  x0: number,
  x1: number,
  y: number,
  bulge: number,
  side: 1 | -1
): string {
  const mx = (x0 + x1) / 2;
  const my = y - bulge * side;
  return `M${x0},${y} Q${mx},${my} ${x1},${y}`;
}

export function computeLayout(
  doc: NormalizedDocument,
  options: VizOptions,
  visibleMarks?: NormalizedMark[]
): LayoutResult {
  const width = options.width ?? 960;
  const height = options.height ?? 540;
  const margin = options.margin ?? {
    top: 72,
    right: 40,
    bottom: 48,
    left: 40,
  };
  const geometry = options.geometry ?? doc.defaults.geometry;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const marks = visibleMarks ?? doc.marks;
  const pad = (doc.xDomain[1] - doc.xDomain[0]) * 0.02 || 1;
  const xDomain: [number, number] = [
    doc.xDomain[0] - pad,
    doc.xDomain[1] + pad,
  ];
  const xScale = scaleLinear().domain(xDomain).range([0, innerWidth]);

  const magMax = Math.max(...marks.map((m) => m.magnitude), doc.magnitudeMax, 1);
  const strokeScale = scaleSqrt()
    .domain([0, magMax])
    .range([0.45, geometry === "arc" ? 2.1 : geometry === "point" ? 2.4 : 1]);
  const barHeightScale = scaleLinear()
    .domain([0, magMax])
    .range([4, innerHeight * 0.42]);
  const pointRadiusScale = scaleSqrt()
    .domain([0, magMax])
    .range([2.2, Math.min(18, innerHeight * 0.06)]);
  const pointStyle = options.pointStyle ?? "radius";
  const fixedPointR = 4.5;

  const mirrorSplit = options.mirrorSplit ?? false;
  const mirrorCohort = options.mirrorCohort ?? null;
  const yBase = mirrorSplit ? innerHeight / 2 : innerHeight * 0.72;

  const scheme = options.colorScheme ?? doc.defaults.colorScheme;
  const spanMax = Math.max(...marks.map((m) => m.spanLength), 1);

  const layoutMarks: LayoutMark[] = marks.map((mark, i) => {
    const x0 = xScale(mark.start);
    const x1 = xScale(mark.end);
    const spanPx = Math.max(x1 - x0, 2);
    const jitter = ((hashId(mark.id) % 100) / 100 - 0.5) * 0.35;
    const baseBulge =
      Math.min(innerHeight * 0.55, 28 + (spanPx / innerWidth) * innerHeight * 0.45) *
      (0.75 + (mark.spanLength / spanMax) * 0.35);
    const bulge = Math.max(18, baseBulge * (1 + jitter));

    let side: 1 | -1 = 1;
    if (mirrorSplit && mirrorCohort != null) {
      side = mark.cohort === mirrorCohort ? 1 : -1;
    } else if (mirrorSplit) {
      const cohorts = doc.cohorts;
      const mid = Math.ceil(cohorts.length / 2);
      const idx = cohorts.indexOf(mark.cohort);
      side = idx < mid ? 1 : -1;
    }

    const strokeWidth = strokeScale(mark.magnitude);
    const barHeight = barHeightScale(mark.magnitude);
    const color = resolveMarkColor(mark, marks, {
      colorScheme: scheme,
      colorBy: options.colorBy ?? "group",
      groups: doc.groups,
      cohorts: doc.cohorts,
    });
    const pathD = arcPath(x0, x1, yBase, bulge, side);
    const barY =
      side === 1 ? yBase - barHeight - (i % 5) * 1.5 : yBase + (i % 5) * 1.5;

    // Point: span midpoint on x; vertical jitter forms a loose scatter (geo map deferred)
    const cx = (x0 + x1) / 2;
    const scatterJitter =
      ((hashId(mark.id + ":pt") % 1000) / 1000 - 0.5) * innerHeight * 0.42;
    const cy = yBase - scatterJitter * side;
    const pointR =
      pointStyle === "stroke" ? fixedPointR : pointRadiusScale(mark.magnitude);
    const pointStroke =
      pointStyle === "stroke" ? Math.max(0.8, strokeScale(mark.magnitude)) : 0.9;

    return {
      mark,
      x0,
      x1,
      yBase,
      bulge,
      strokeWidth,
      barHeight,
      color,
      side,
      pathD,
      bar: {
        x: x0,
        y: barY,
        width: Math.max(x1 - x0, 1),
        height: barHeight,
      },
      point: {
        cx,
        cy,
        r: pointR,
        strokeWidth: pointStroke,
      },
    };
  });

  return {
    marks: layoutMarks,
    xScale,
    xDomain,
    yBase,
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    geometry: geometry === "lane" ? "bar" : geometry,
  };
}

export function formatAxisValue(v: number, unit: "date" | "number"): string {
  if (unit === "date") {
    const d = new Date(v);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

export function formatMagnitude(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

export function formatSpanRange(
  start: number,
  end: number,
  unit: "date" | "number"
): string {
  if (unit === "date") {
    const fmt = (t: number) => {
      const d = new Date(t);
      return d.toISOString().slice(0, 10);
    };
    return `${fmt(start)} → ${fmt(end)}`;
  }
  return `${start} → ${end}`;
}
