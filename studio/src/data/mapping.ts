/**
 * Fenêtre « Mise en forme des données » — modèle pur (sans DOM) : rôles des champs (X, Y sur 1 ou 2 axes,
 * Couleur / Groupe, Facette), séries issues de lignes (vue large) ou de colonnes (vue longue), regroupements
 * avec agrégat (somme, moyenne, max, dernier), filtres Section / Indicateur / Entité, permutation X ⇄ Y,
 * et calcul du tableau à afficher (pivot) + encodage du Studio.
 */
import type { ChartType } from "../spec";
import { F, type LongTable } from "./structure";

export type GroupAgg = "sum" | "mean" | "max" | "last";
export const GROUP_AGGS: GroupAgg[] = ["sum", "mean", "max", "last"];
export const GROUP_AGG_LABELS: Record<GroupAgg, string> = { sum: "Somme", mean: "Moyenne", max: "Max", last: "Dernier" };

export interface SeriesDef {
  id: string;
  label: string;
  /** Mesures (colonnes) agrégées ; vue large : ["Valeur"]. */
  measures: string[];
  /** Lignes d'origine (vue large) ; null = toutes les lignes filtrées. */
  rowIds: string[] | null;
  agg: GroupAgg;
  axis: 1 | 2;
}

export interface MappingState {
  x: string | null;
  series: SeriesDef[];
  color: string | null;
  facet: string | null;
  filters: Record<string, string[]>;
  /** Agrégat dans le temps quand X est plus grossier que les lignes (ex. X = Poste : somme ou dernier). */
  timeAgg: GroupAgg;
  type: ChartType;
  curve: "linear" | "monotone" | "step";
  swapped: boolean;
  title: string;
}

export interface PivotResult {
  rows: Record<string, string | number | null>[];
  x: string;
  y: string[];
  y2: string | null;
  series: string | null;
  facet: string | null;
  facetValues: string[];
  xIsDate: boolean;
  xGrain: "none" | "month" | "year";
  unit: "none" | "pct" | "eur";
  empty: string | null;
}

let seq = 0;
export const newSeriesId = () => `s${Date.now().toString(36)}${(++seq).toString(36)}`;

const MEASURE = F.value;

export function dateField(t: LongTable): string | null {
  return t.fields.find((f) => f.kind === "date")?.name ?? null;
}
export function dimensionFields(t: LongTable): string[] {
  return t.fields.filter((f) => f.kind === "dimension").map((f) => f.name);
}
export function measureFields(t: LongTable): string[] {
  return t.fields.filter((f) => f.kind === "measure").map((f) => f.name);
}

/** Valeurs distinctes d'un champ (ordre d'apparition). */
export function distinct(t: LongTable, field: string, rows = t.rows): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[field];
    if (v == null || v === "") continue;
    const k = String(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Libellé lisible d'un regroupement : indicateur commun (« Somme — en poste (1/0) »), sinon libellé commun. */
export function groupLabel(t: LongTable, rowIds: string[], agg: GroupAgg): string {
  const info = t.wide?.rows.filter((r) => rowIds.includes(r.id)) ?? [];
  const inds = new Set(info.map((r) => r.indicator ?? ""));
  const a = GROUP_AGG_LABELS[agg];
  if (inds.size === 1 && [...inds][0]) return `${a} — ${[...inds][0]}`;
  if (info.length) return `${a} — ${info.length} lignes`;
  return `${a} — ${rowIds.length} lignes`;
}

/** État initial : X = temps (ou 1re dimension), première ligne de données (vue large) ou première mesure en Y. */
export function defaultMapping(t: LongTable, title = t.name): MappingState {
  const dField = dateField(t);
  const x = dField ?? (t.wide ? F.period : dimensionFields(t)[0] ?? null);
  const series: SeriesDef[] = [];
  if (t.wide && t.wide.rows.length) {
    const first = t.wide.rows.find((_, i) => t.wide!.values[i]!.some((v) => v != null && v !== 0)) ?? t.wide.rows[0]!;
    series.push({ id: newSeriesId(), label: first.label, measures: [MEASURE], rowIds: [first.id], agg: "sum", axis: 1 });
  } else {
    const m = measureFields(t)[0];
    if (m) series.push({ id: newSeriesId(), label: m, measures: [m], rowIds: null, agg: "sum", axis: 1 });
  }
  return { x, series, color: null, facet: null, filters: {}, timeAgg: "sum", type: dField ? "line" : "bar", curve: "monotone", swapped: false, title };
}

/* ---------------------------------------------------------------- actions (pures : renvoient un nouvel état) */

/** Clic sur un libellé de ligne (vue large) : l'ajoute en Y, ou le retire s'il y est déjà seul. */
export function toggleRowSeries(st: MappingState, t: LongTable, rowId: string, axis: 1 | 2 = 1): MappingState {
  const existing = st.series.find((s) => s.rowIds?.length === 1 && s.rowIds[0] === rowId);
  if (existing) return { ...st, series: st.series.filter((s) => s !== existing) };
  const row = t.wide?.rows.find((r) => r.id === rowId);
  if (!row) return st;
  const s: SeriesDef = { id: newSeriesId(), label: uniqueLabel(st, row.label), measures: [MEASURE], rowIds: [rowId], agg: "sum", axis };
  return { ...st, series: [...st.series, s].slice(-12) };
}

/** Clic sur un en-tête de colonne : rôle X, Y (axe 1 / 2), Couleur, Facette — ou retrait. */
export type Role = "x" | "y" | "y2" | "color" | "facet" | "none";
export function assignField(st: MappingState, t: LongTable, field: string, role: Role): MappingState {
  let next: MappingState = { ...st };
  // Retire le champ de ses rôles actuels
  if (next.x === field) next.x = null;
  if (next.color === field) next.color = null;
  if (next.facet === field) next.facet = null;
  next.series = next.series.filter((s) => !(s.rowIds === null && s.measures.length === 1 && s.measures[0] === field));
  const isMeasure = t.fields.find((f) => f.name === field)?.kind === "measure";
  switch (role) {
    case "x":
      next.x = field;
      break;
    case "y":
    case "y2":
      if (!isMeasure) {
        // Une dimension en Y : on la prend comme couleur (séries par valeur)
        next.color = field;
        break;
      }
      next.series = [...next.series, { id: newSeriesId(), label: uniqueLabel(next, field), measures: [field], rowIds: null, agg: "sum" as GroupAgg, axis: (role === "y2" ? 2 : 1) as 1 | 2 }].slice(-12);
      break;
    case "color":
      next.color = field;
      break;
    case "facet":
      next.facet = field;
      break;
    case "none":
      break;
  }
  if (next.series.filter((s) => s.axis === 2).length > 1) {
    let seen = false;
    next.series = next.series.map((s) => (s.axis === 2 ? (seen ? { ...s, axis: 1 } : ((seen = true), s)) : s));
  }
  return next;
}

/** Regroupe des lignes (vue large) ou des colonnes de mesure (vue longue) sous une seule série. */
export function groupSeries(st: MappingState, t: LongTable, sel: { rowIds?: string[]; measures?: string[] }, agg: GroupAgg, label?: string): MappingState {
  if (sel.rowIds && sel.rowIds.length) {
    const ids = sel.rowIds;
    const s: SeriesDef = { id: newSeriesId(), label: uniqueLabel(st, label?.trim() || groupLabel(t, ids, agg)), measures: [MEASURE], rowIds: [...ids], agg, axis: 1 };
    // Les séries individuelles des lignes regroupées sont remplacées par le groupe
    const rest = st.series.filter((x) => !(x.rowIds && x.rowIds.length === 1 && ids.includes(x.rowIds[0]!)));
    return { ...st, series: [...rest, s].slice(-12) };
  }
  if (sel.measures && sel.measures.length) {
    const ms = sel.measures;
    const s: SeriesDef = { id: newSeriesId(), label: uniqueLabel(st, label?.trim() || `${GROUP_AGG_LABELS[agg]} — ${ms.join(" + ")}`.slice(0, 80)), measures: [...ms], rowIds: null, agg, axis: 1 };
    const rest = st.series.filter((x) => !(x.rowIds === null && x.measures.length === 1 && ms.includes(x.measures[0]!)));
    return { ...st, series: [...rest, s].slice(-12) };
  }
  return st;
}

export function setSeriesAxis(st: MappingState, id: string, axis: 1 | 2): MappingState {
  return { ...st, series: st.series.map((s) => (s.id === id ? { ...s, axis } : axis === 2 && s.axis === 2 ? { ...s, axis: 1 } : s)) };
}
export function removeSeries(st: MappingState, id: string): MappingState {
  return { ...st, series: st.series.filter((s) => s.id !== id) };
}
export function renameSeries(st: MappingState, id: string, label: string): MappingState {
  const l = label.trim();
  if (!l) return st;
  return { ...st, series: st.series.map((s) => (s.id === id ? { ...s, label: uniqueLabel({ ...st, series: st.series.filter((x) => x.id !== id) }, l) } : s)) };
}

/** X ⇄ Y : les séries deviennent les catégories de l'axe X, les valeurs de X deviennent les séries (et inversement). */
export function swapXY(st: MappingState): MappingState {
  const swapped = !st.swapped;
  let type = st.type;
  if (swapped && (type === "line" || type === "area" || type === "stackedArea")) type = "groupedBar";
  if (!swapped && type === "groupedBar") type = "line";
  return { ...st, swapped, type };
}

export function setFilter(st: MappingState, field: string, values: string[]): MappingState {
  const filters = { ...st.filters };
  if (values.length) filters[field] = values;
  else delete filters[field];
  return { ...st, filters };
}

function uniqueLabel(st: MappingState, label: string): string {
  const used = new Set(st.series.map((s) => s.label));
  let l = label.slice(0, 80);
  let i = 2;
  while (used.has(l) || l === st.x || l === "Série") l = `${label.slice(0, 74)} (${i++})`;
  return l;
}

/* ---------------------------------------------------------------- calcul */

function combine(vals: number[], agg: GroupAgg): number | null {
  if (!vals.length) return null;
  switch (agg) {
    case "sum":
      return vals.reduce((a, b) => a + b, 0);
    case "mean":
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "max":
      return Math.max(...vals);
    case "last":
      return vals[vals.length - 1]!;
  }
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function grainOf(dates: number[]): "none" | "month" | "year" {
  const ds = [...new Set(dates)].sort((a, b) => a - b);
  if (ds.length < 2) return "none";
  const allJan1 = ds.every((d) => {
    const x = new Date(d);
    return x.getUTCMonth() === 0 && x.getUTCDate() === 1;
  });
  const gaps = ds.slice(1).map((d, i) => d - ds[i]!);
  const med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1]!;
  if (allJan1 && med > 300 * 86400000) return "year";
  if (med > 25 * 86400000 && med < 35 * 86400000) return "month";
  return "none";
}

/** Tableau prêt pour le Studio (format large : une colonne par série ; long si Couleur ou X ⇄ Y). */
export function pivot(t: LongTable, st: MappingState): PivotResult {
  const dField = dateField(t);
  const x = st.x ?? dField ?? F.period;
  const res: PivotResult = { rows: [], x, y: [], y2: null, series: null, facet: st.facet, facetValues: [], xIsDate: x === dField, xGrain: "none", unit: "none", empty: null };
  if (!st.series.length) {
    res.empty = "Choisissez au moins une mesure Y : touchez un libellé de ligne ou un en-tête de colonne.";
    return res;
  }
  const filtered = t.rows.filter((r) => Object.entries(st.filters).every(([f, vals]) => !vals.length || vals.includes(String(r[f] ?? ""))));
  const xIsDate = x === dField;
  const xKey = (r: (typeof t.rows)[number]): string | number | null => {
    const v = r[x];
    if (v == null || v === "") return null;
    return v;
  };
  const tpKey = (r: (typeof t.rows)[number]) => (dField ? r[dField] ?? `t${r._t}` : r._t ?? r._id) as string | number;
  // bucket → série → timepoint → valeurs
  type Bucket = { x: string | number; color: string | null; facet: string | null; order: number; vals: Map<string, Map<string | number, number[]>> };
  const buckets = new Map<string, Bucket>();
  const xOrder = new Map<string, number>();
  const units = new Set<string>();
  for (const s of st.series) {
    const rowSet = s.rowIds ? new Set(s.rowIds) : null;
    for (const r of filtered) {
      if (rowSet && !rowSet.has(String(r._id))) continue;
      const xv = xKey(r);
      if (xv == null) continue;
      if (r[F.unit] != null) units.add(String(r[F.unit]));
      const cv = st.color && !st.swapped ? (r[st.color] == null ? "" : String(r[st.color])) : null;
      const fv = st.facet ? (r[st.facet] == null ? "" : String(r[st.facet])) : null;
      const key = `${xv}\u0001${cv ?? ""}\u0001${fv ?? ""}`;
      if (!xOrder.has(String(xv))) xOrder.set(String(xv), xOrder.size);
      let b = buckets.get(key);
      if (!b) {
        b = { x: xv, color: cv, facet: fv, order: xOrder.get(String(xv))!, vals: new Map() };
        buckets.set(key, b);
      }
      let perSeries = b.vals.get(s.id);
      if (!perSeries) b.vals.set(s.id, (perSeries = new Map()));
      const tp = tpKey(r);
      for (const m of s.measures) {
        const v = r[m];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        let arr = perSeries.get(tp);
        if (!arr) perSeries.set(tp, (arr = []));
        arr.push(v);
      }
    }
  }
  const valueOf = (b: Bucket, s: SeriesDef): number | null => {
    const perSeries = b.vals.get(s.id);
    if (!perSeries) return null;
    const tps = [...perSeries.entries()].sort((a, b2) => (typeof a[0] === "number" && typeof b2[0] === "number" ? a[0] - b2[0] : 0));
    const stage1 = tps.map(([, vals]) => combine(vals, s.agg)).filter((v): v is number => v != null);
    return combine(stage1, st.timeAgg);
  };
  const list = [...buckets.values()].sort((a, b) => (xIsDate ? (a.x as number) - (b.x as number) : a.order - b.order));
  const fmtX = (v: string | number) => (xIsDate && typeof v === "number" ? isoDay(v) : v);
  res.facetValues = st.facet ? [...new Set(list.map((b) => b.facet ?? ""))] : [];
  res.xGrain = xIsDate ? grainOf(list.map((b) => b.x as number)) : "none";
  const u = [...units];
  res.unit = u.length === 1 && u[0] === "%" ? "pct" : u.length === 1 && /€|eur/i.test(u[0]!) ? "eur" : "none";

  if (st.swapped) {
    // Séries → catégories X ; valeurs de X → séries (Couleur)
    const xLabel = xIsDate ? (res.xGrain === "year" ? "Année" : "Période") : x;
    const sx = "Série";
    for (const s of st.series)
      for (const b of list) {
        const v = valueOf(b, s);
        if (v == null) continue;
        const xv = fmtX(b.x);
        const lab = xIsDate && typeof b.x === "number" ? (res.xGrain === "year" ? String(new Date(b.x).getUTCFullYear()) : isoDay(b.x).slice(0, 7)) : String(xv);
        const row: Record<string, string | number | null> = { [sx]: s.label, [xLabel]: lab, Valeur: v };
        if (st.facet) row[st.facet] = b.facet;
        res.rows.push(row);
      }
    res.x = sx;
    res.y = ["Valeur"];
    res.series = xLabel;
    res.xIsDate = false;
    res.xGrain = "none";
    return res;
  }

  const axis1 = st.series.filter((s) => s.axis === 1);
  const axis2 = st.series.find((s) => s.axis === 2) ?? null;
  for (const b of list) {
    const row: Record<string, string | number | null> = { [x]: fmtX(b.x) };
    if (st.color) row[st.color] = b.color;
    if (st.facet) row[st.facet] = b.facet;
    let any = false;
    for (const s of st.series) {
      const v = valueOf(b, s);
      row[s.label] = v;
      if (v != null) any = true;
    }
    if (any) res.rows.push(row);
  }
  res.y = axis1.map((s) => s.label);
  if (!res.y.length && axis2) res.y = [axis2.label];
  res.y2 = axis2 && res.y[0] !== axis2.label ? axis2.label : null;
  res.series = st.color;
  if (!res.rows.length) res.empty = "Aucune valeur pour ces choix (filtres trop restrictifs ?).";
  return res;
}

/** Courbe en escalier conseillée : valeurs entières (effectifs 0/1 sommés, comptes). */
export function suggestCurve(p: PivotResult): "step" | "monotone" {
  if (!p.xIsDate || !p.y.length) return "monotone";
  const vals = p.rows.flatMap((r) => p.y.map((y) => r[y])).filter((v): v is number => typeof v === "number");
  return vals.length > 6 && vals.every((v) => Number.isInteger(Math.round(v * 1e9) / 1e9)) ? "step" : "monotone";
}
