/**
 * Préparation des données pour le rendu : agrégation (somme, moyenne…), séries,
 * axe secondaire, et logique « 4D » (pas de temps, pondérations cumulative / instantané).
 */
import { utcDay, utcMonday, utcMonth, utcYear } from "d3";
import type { ChartSpec } from "../spec";
import { isRadial } from "../spec";
import type { Column, Dataset, Row } from "./table";
import { columnOf } from "./table";
import { formatDate, guessGrain, formatCell, type TimeGrain } from "../format";

export type Key = string | number;

export interface WRow {
  row: Row;
  w: number;
}

export interface CatModel {
  kind: "cat";
  /** Type de l'axe X : continu (date / nombre) ou discret. */
  xKind: "band" | "time" | "linear";
  keys: Key[];
  labels: string[];
  series: string[];
  /** values[s][k] — NaN si absent. */
  values: number[][];
  y2: number[] | null;
  y2Name: string;
  yName: string;
}

export interface ScatterPoint {
  key: string;
  x: number | string;
  y: number;
  size: number | null;
  series: string;
  label: string;
  /** Opacité / échelle d'apparition (4D). */
  w: number;
}

export interface PointModel {
  kind: "points";
  xKind: "band" | "time" | "linear";
  points: ScatterPoint[];
  series: string[];
  xCategories: string[];
}

export type Model = CatModel | PointModel;

export interface TimeModel {
  field: string;
  grain: TimeGrain;
  steps: Key[];
  /** Index du pas pour chaque ligne (-1 si vide). */
  rowStep: number[];
  label(i: number): string;
}

export function bucketDate(ms: number, grain: TimeGrain): number {
  const d = new Date(ms);
  switch (grain) {
    case "day":
      return utcDay.floor(d).getTime();
    case "week":
      return utcMonday.floor(d).getTime();
    case "month":
      return utcMonth.floor(d).getTime();
    case "quarter": {
      const m = utcMonth.floor(d);
      m.setUTCMonth(m.getUTCMonth() - (m.getUTCMonth() % 3));
      return m.getTime();
    }
    case "year":
      return utcYear.floor(d).getTime();
    default:
      return ms;
  }
}

function keyOf(v: Row[string], col: Column | undefined, grain: TimeGrain | "none"): Key | null {
  if (v == null || v === "") return null;
  if (col?.type === "date" && typeof v === "number") return grain === "none" || grain === "raw" ? v : bucketDate(v, grain);
  if (col?.type === "number" && typeof v === "number") return v;
  return String(v);
}

function labelOf(k: Key, col: Column | undefined, grain: TimeGrain | "none", guessed: TimeGrain = "day"): string {
  if (col?.type === "date" && typeof k === "number") {
    if (grain === "none" || grain === "raw") return formatDate(k, guessed);
    return formatDate(k, grain);
  }
  if (typeof k === "number") return formatCell(k, "number");
  return String(k);
}

function effectiveXGrain(spec: ChartSpec, ds: Dataset): TimeGrain | "none" {
  const col = columnOf(ds, spec.encoding.x);
  if (col?.type !== "date") return "none";
  if (spec.encoding.xGrain !== "none") return spec.encoding.xGrain;
  return "none";
}

function aggregateInit() {
  return { sum: 0, w: 0, min: Infinity, max: -Infinity, last: NaN, n: 0 };
}
type Acc = ReturnType<typeof aggregateInit>;
function accAdd(a: Acc, v: number | null, w: number, countMode: boolean) {
  if (w <= 0) return;
  if (countMode) {
    a.sum += w;
    a.w += w;
    a.n++;
    return;
  }
  if (v == null || !Number.isFinite(v)) return;
  a.sum += v * w;
  a.w += w;
  a.n++;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
  a.last = v;
}
function accValue(a: Acc, agg: ChartSpec["encoding"]["aggregate"]): number {
  if (a.n === 0) return NaN;
  switch (agg) {
    case "sum":
    case "count":
      return a.sum;
    case "mean":
    case "last":
      return a.w > 0 ? a.sum / a.w : NaN;
    case "min":
      return a.min;
    case "max":
      return a.max;
  }
}

export interface ModelOptions {
  /** Ordre de clés figé (4D : évite que les barres changent de place). */
  fixedKeys?: Key[];
  fixedSeries?: string[];
}

export function numericColumns(ds: Dataset): Column[] {
  return ds.columns.filter((c) => c.type === "number");
}

/** Modèle catégoriel / continu (barres, lignes, aires, camembert, arcs). */
export function buildCatModel(spec: ChartSpec, ds: Dataset, rows: WRow[], opts: ModelOptions = {}): CatModel {
  const enc = spec.encoding;
  const xCol = columnOf(ds, enc.x);
  const grain = effectiveXGrain(spec, ds);
  const countMode = enc.aggregate === "count";
  const yFields = enc.y.filter((f) => columnOf(ds, f));
  const multiY = yFields.length > 1;
  const sCol = !multiY ? columnOf(ds, enc.series) : undefined;
  const y2Col = columnOf(ds, enc.y2);

  // Camembert sans X mais avec plusieurs mesures : les parts sont les mesures
  const measuresAsKeys = !xCol && multiY && isRadial(spec.type);

  let xKind: CatModel["xKind"] = "band";
  const t = spec.type;
  const continuousType = t === "line" || t === "area" || t === "stackedArea";
  if (continuousType && xCol?.type === "date") xKind = "time";
  else if (continuousType && xCol?.type === "number") xKind = "linear";
  if (spec.axes.x.scale === "linear" && xCol?.type === "number" && continuousType) xKind = "linear";

  const keyIndex = new Map<Key, number>();
  const keys: Key[] = [];
  const seriesIndex = new Map<string, number>();
  const series: string[] = [];
  if (opts.fixedKeys) opts.fixedKeys.forEach((k) => (keyIndex.set(k, keys.length), keys.push(k)));
  if (opts.fixedSeries) opts.fixedSeries.forEach((s) => (seriesIndex.set(s, series.length), series.push(s)));

  const addKey = (k: Key) => {
    let i = keyIndex.get(k);
    if (i === undefined) {
      if (opts.fixedKeys) return -1;
      i = keys.length;
      keyIndex.set(k, i);
      keys.push(k);
    }
    return i;
  };
  const addSeries = (s: string) => {
    let i = seriesIndex.get(s);
    if (i === undefined) {
      if (opts.fixedSeries) return -1;
      i = series.length;
      seriesIndex.set(s, i);
      series.push(s);
    }
    return i;
  };

  const yName = countMode ? "Nombre" : yFields[0] ?? "Valeur";
  const accs: Acc[][] = [];
  const y2Accs: Acc[] = [];
  const getAcc = (s: number, k: number) => {
    accs[s] ??= [];
    return (accs[s]![k] ??= aggregateInit());
  };

  if (measuresAsKeys) {
    const si = addSeries(yName);
    for (const f of yFields) {
      const ki = addKey(f);
      if (ki < 0 || si < 0) continue;
      for (const { row, w } of rows) accAdd(getAcc(si, ki), row[f] as number | null, w, countMode);
    }
  } else {
    if (multiY) yFields.forEach((f) => addSeries(f));
    for (const { row, w } of rows) {
      const k = xCol ? keyOf(row[xCol.name]!, xCol, grain) : "Total";
      if (k == null) continue;
      const ki = addKey(k);
      if (ki < 0) continue;
      if (multiY) {
        yFields.forEach((f) => {
          const si = seriesIndex.get(f);
          if (si !== undefined) accAdd(getAcc(si, ki), row[f] as number | null, w, countMode);
        });
      } else {
        const sv = sCol ? row[sCol.name] : null;
        const sName = sCol ? (sv == null || sv === "" ? "(vide)" : sCol.type === "date" && typeof sv === "number" ? formatDate(sv) : String(sv)) : yName;
        const si = addSeries(sName);
        if (si < 0) continue;
        accAdd(getAcc(si, ki), yFields[0] ? (row[yFields[0]] as number | null) : null, w, countMode);
      }
      if (y2Col) {
        y2Accs[ki] ??= aggregateInit();
        accAdd(y2Accs[ki]!, row[y2Col.name] as number | null, w, enc.y2Aggregate === "count");
      }
    }
  }

  let values = series.map((_, s) => keys.map((_, k) => (accs[s]?.[k] ? accValue(accs[s]![k]!, enc.aggregate) : NaN)));
  let y2 = y2Col ? keys.map((_, k) => (y2Accs[k] ? accValue(y2Accs[k]!, enc.y2Aggregate) : NaN)) : null;

  // Ordre des clés
  if (!opts.fixedKeys) {
    let order = keys.map((_, i) => i);
    if (xKind !== "band" || (xCol && (xCol.type === "date" || xCol.type === "number"))) {
      order.sort((a, b) => (keys[a]! as number) - (keys[b]! as number));
    } else if (spec.style.sort !== "none") {
      const tot = (i: number) => values.reduce((s, row) => s + (Number.isFinite(row[i]!) ? row[i]! : 0), 0);
      if (spec.style.sort === "desc") order.sort((a, b) => tot(b) - tot(a));
      else if (spec.style.sort === "asc") order.sort((a, b) => tot(a) - tot(b));
      else order.sort((a, b) => String(keys[a]).localeCompare(String(keys[b]), "fr"));
    }
    const k2 = order.map((i) => keys[i]!);
    values = values.map((row) => order.map((i) => row[i]!));
    if (y2) y2 = order.map((i) => y2![i]!);
    keys.splice(0, keys.length, ...k2);
  }

  return {
    kind: "cat",
    xKind,
    keys,
    labels: (() => {
      const g = xCol?.type === "date" ? guessGrain(keys.filter((k): k is number => typeof k === "number")) : "day";
      return keys.map((k) => (measuresAsKeys ? String(k) : labelOf(k, xCol, grain, g)));
    })(),
    series,
    values,
    y2,
    y2Name: y2Col?.name ?? "",
    yName,
  };
}

/** Modèle de points (nuage). */
export function buildPointModel(spec: ChartSpec, ds: Dataset, rows: WRow[]): PointModel {
  const enc = spec.encoding;
  const xCol = columnOf(ds, enc.x);
  const yCol = columnOf(ds, enc.y[0]);
  const sCol = columnOf(ds, enc.series);
  const zCol = columnOf(ds, enc.size);
  const lCol = columnOf(ds, enc.label);
  const xKind: PointModel["xKind"] = xCol?.type === "date" ? "time" : xCol?.type === "number" ? "linear" : "band";
  const series: string[] = [];
  const sSet = new Set<string>();
  const cats: string[] = [];
  const cSet = new Set<string>();
  const points: ScatterPoint[] = [];
  rows.forEach(({ row, w }, i) => {
    if (w <= 0 || !xCol || !yCol) return;
    const xv = row[xCol.name];
    const yv = row[yCol.name];
    if (xv == null || typeof yv !== "number") return;
    const s = sCol ? String(row[sCol.name] ?? "(vide)") : yCol.name;
    if (!sSet.has(s)) (sSet.add(s), series.push(s));
    let x: number | string = xv as number | string;
    if (xKind === "band") {
      x = String(xv);
      if (!cSet.has(x)) (cSet.add(x), cats.push(x));
    } else if (typeof xv !== "number") return;
    const label = lCol ? String(row[lCol.name] ?? "") : "";
    points.push({
      key: label || `${s}#${i}`,
      x,
      y: yv,
      size: zCol && typeof row[zCol.name] === "number" ? (row[zCol.name] as number) : null,
      series: s,
      label,
      w,
    });
  });
  return { kind: "points", xKind, points, series, xCategories: cats };
}

export function buildModel(spec: ChartSpec, ds: Dataset, rows: WRow[], opts?: ModelOptions): Model {
  return spec.type === "scatter" ? buildPointModel(spec, ds, rows) : buildCatModel(spec, ds, rows, opts);
}

export const allRows = (ds: Dataset): WRow[] => ds.rows.map((row) => ({ row, w: 1 }));

/* ------------------------------------------------------------------ 4D ---- */

/** Construit les pas de temps du champ temporel (null si 4D inapplicable). */
export function buildTimeModel(spec: ChartSpec, ds: Dataset): TimeModel | null {
  const f = spec.encoding.time;
  const col = columnOf(ds, f);
  if (!col) return null;
  let grain: TimeGrain = "raw";
  const xIsTime = spec.encoding.x === col.name;
  if (col.type === "date") {
    const vals = ds.rows.map((r) => r[col.name]).filter((v): v is number => typeof v === "number");
    if (xIsTime) {
      const g = spec.encoding.xGrain;
      grain = g === "none" ? "raw" : g;
    } else if (spec.mode.fourD.step !== "auto") grain = spec.mode.fourD.step;
    else {
      const uniq = new Set(vals).size;
      if (uniq <= 60) grain = "raw";
      else {
        const span = (Math.max(...vals) - Math.min(...vals)) / 86400000;
        grain = span > 365 * 6 ? "year" : span > 400 ? "month" : span > 90 ? "week" : "day";
      }
    }
  }
  const stepIdx = new Map<Key, number>();
  const raw: Key[] = [];
  const rowKeys: (Key | null)[] = ds.rows.map((r) => {
    const v = r[col.name];
    if (v == null || v === "") return null;
    const k: Key = col.type === "date" && typeof v === "number" ? (grain === "raw" ? v : bucketDate(v, grain)) : typeof v === "number" ? v : String(v);
    if (!stepIdx.has(k)) (stepIdx.set(k, 0), raw.push(k));
    return k;
  });
  const numeric = col.type === "date" || col.type === "number";
  const steps = numeric ? [...raw].sort((a, b) => (a as number) - (b as number)) : raw;
  steps.forEach((k, i) => stepIdx.set(k, i));
  const labelGrain: TimeGrain = grain === "raw" && col.type === "date" ? guessGrain(steps as number[]) : grain;
  return {
    field: col.name,
    grain,
    steps,
    rowStep: rowKeys.map((k) => (k == null ? -1 : stepIdx.get(k)!)),
    label: (i: number) => {
      const k = steps[Math.max(0, Math.min(steps.length - 1, Math.round(i)))];
      if (k === undefined) return "";
      if (col.type === "date" && typeof k === "number") return formatDate(k, labelGrain);
      if (typeof k === "number") return formatCell(k, "number");
      return String(k);
    },
  };
}

/**
 * Pondérations des lignes à la position `pos` (continue, en pas).
 * cumulative : pas ≤ ⌊pos⌋ pleins, pas suivant au prorata ; snapshot : interpolation entre 2 pas.
 */
export function weightsAt(ds: Dataset, tm: TimeModel, pos: number, mode: "cumulative" | "snapshot"): WRow[] {
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const out: WRow[] = [];
  ds.rows.forEach((row, r) => {
    const s = tm.rowStep[r]!;
    if (s < 0) return;
    let w = 0;
    if (mode === "cumulative") w = s <= i0 ? 1 : s === i0 + 1 ? frac : 0;
    else w = s === i0 ? 1 - frac : s === i0 + 1 ? frac : 0;
    if (w > 0) out.push({ row, w });
  });
  return out;
}

/** Snapshot nuage de points : une position par clé (libellé / série), interpolée entre deux pas. */
export function interpolatedPoints(spec: ChartSpec, ds: Dataset, tm: TimeModel, pos: number): PointModel {
  const i0 = Math.max(0, Math.min(tm.steps.length - 1, Math.floor(pos)));
  const i1 = Math.min(tm.steps.length - 1, i0 + 1);
  const frac = pos - Math.floor(pos);
  const at = (i: number) => {
    const rows = ds.rows.filter((_, r) => tm.rowStep[r] === i).map((row) => ({ row, w: 1 }));
    const m = buildPointModel(spec, ds, rows);
    const byKey = new Map<string, ScatterPoint>();
    for (const p of m.points) {
      const k = p.label || p.series;
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, { ...p, key: k });
      else if (typeof prev.x === "number" && typeof p.x === "number") {
        // moyenne simple des doublons
        prev.x = (prev.x + p.x) / 2;
        prev.y = (prev.y + p.y) / 2;
        prev.size = (prev.size ?? 0) + (p.size ?? 0);
      }
    }
    return { m, byKey };
  };
  const a = at(i0);
  const b = at(i1);
  const keys = new Set([...a.byKey.keys(), ...b.byKey.keys()]);
  const points: ScatterPoint[] = [];
  for (const k of keys) {
    const p = a.byKey.get(k);
    const q = b.byKey.get(k);
    if (p && q && typeof p.x === "number" && typeof q.x === "number") {
      points.push({
        ...p,
        x: p.x + (q.x - p.x) * frac,
        y: p.y + (q.y - p.y) * frac,
        size: p.size != null && q.size != null ? p.size + (q.size - p.size) * frac : p.size ?? q.size,
        w: 1,
      });
    } else if (p) points.push({ ...p, w: 1 - frac });
    else if (q) points.push({ ...q, w: frac });
  }
  const series = [...new Set([...a.m.series, ...b.m.series])];
  return { kind: "points", xKind: a.m.xKind, points, series, xCategories: [...new Set([...a.m.xCategories, ...b.m.xCategories])] };
}

/** L'axe X est-il le champ temporel (révélation le long de l'axe) ? */
export function xIsTimeField(spec: ChartSpec): boolean {
  return !!spec.encoding.time && spec.encoding.time === spec.encoding.x;
}
