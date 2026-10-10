/**
 * Transformations du spec (`spec.transform`) : colonnes calculées puis filtres.
 * Pures et mémorisées : le même (dataset, transform) renvoie le même objet Dataset,
 * ce qui garde les caches de rendu stables.
 */
import { dayMonthYear } from "../story/fr";
import type { CalcSpec, ChartSpec, DatasetRef, FilterSpec, TransformSpec } from "../spec";
import { buildDataset, type Cell, type Column, type ColumnType, type Dataset, type Row } from "./table";

const DAY = 86400000;

export const MONTHS_SHORT_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const AGE_BUCKETS = ["0–30 j", "31–90 j", "91–180 j", "181–365 j", "> 365 j"];

export function ageBucket(days: number): string {
  if (days <= 30) return AGE_BUCKETS[0]!;
  if (days <= 90) return AGE_BUCKETS[1]!;
  if (days <= 180) return AGE_BUCKETS[2]!;
  if (days <= 365) return AGE_BUCKETS[3]!;
  return AGE_BUCKETS[4]!;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Régions / provinces / grandes villes FR·BE → code postal représentatif (chef-lieu),
 * pour placer sur la carte un fichier qui n'a que des noms de région.
 */
const REGION_POSTAL: Record<string, string> = {
  "ile de france": "75001",
  idf: "75001",
  paris: "75001",
  "auvergne rhone alpes": "69001",
  aura: "69001",
  lyon: "69001",
  "hauts de france": "59000",
  lille: "59000",
  "nouvelle aquitaine": "33000",
  bordeaux: "33000",
  occitanie: "31000",
  toulouse: "31000",
  "provence alpes cote d azur": "13001",
  paca: "13001",
  "sud est": "13001",
  marseille: "13001",
  "grand est": "67000",
  strasbourg: "67000",
  "pays de la loire": "44000",
  nantes: "44000",
  bretagne: "35000",
  rennes: "35000",
  normandie: "76000",
  rouen: "76000",
  "centre val de loire": "45000",
  "bourgogne franche comte": "21000",
  corse: "20000",
  "sud ouest": "33000",
  belgique: "1000",
  belgium: "1000",
  bruxelles: "1000",
  "bruxelles capitale": "1000",
  "region de bruxelles capitale": "1000",
  brussels: "1000",
  wallonie: "5000",
  "region wallonne": "5000",
  namur: "5000",
  liege: "4000",
  flandre: "2000",
  "region flamande": "2000",
  vlaanderen: "2000",
  anvers: "2000",
  antwerpen: "2000",
  gand: "9000",
  gent: "9000",
  hainaut: "7000",
  "brabant wallon": "1300",
  luxembourg: "6700",
  benelux: "1000",
};

export function regionToPostal(v: unknown): string | null {
  if (v == null) return null;
  return REGION_POSTAL[norm(String(v))] ?? null;
}

function num(c: Cell | undefined): number | null {
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

function calcValue(c: CalcSpec, row: Row, colA: Column | undefined): Cell {
  const a = row[c.a];
  const b = c.b ? row[c.b] : null;
  switch (c.op) {
    case "mul":
    case "sub":
    case "add":
    case "div": {
      const x = num(a);
      const y = num(b);
      if (x == null || y == null) return null;
      const r = c.op === "mul" ? x * y : c.op === "sub" ? x - y : c.op === "add" ? x + y : y === 0 ? NaN : x / y;
      return Number.isFinite(r) ? r * c.scale : null;
    }
    case "coalesce": {
      const x = num(a) ?? num(b);
      return x == null ? null : x * c.scale;
    }
    case "age":
    case "ageBucket": {
      const t = num(a);
      if (t == null || c.ref == null) return null;
      const days = Math.max(0, Math.floor((c.ref - t) / DAY));
      return c.op === "age" ? days : ageBucket(days);
    }
    case "monthOfYear": {
      const t = num(a);
      return t == null || colA?.type !== "date" ? null : MONTHS_SHORT_FR[new Date(t).getUTCMonth()]!;
    }
    case "year": {
      const t = num(a);
      return t == null || colA?.type !== "date" ? null : String(new Date(t).getUTCFullYear());
    }
    case "flag": {
      if (a == null || a === "") return null;
      return c.values.includes(String(a)) ? 100 : 0;
    }
    case "regionPostal":
      return regionToPostal(a);
  }
}

const CALC_TYPE: Record<CalcSpec["op"], ColumnType> = {
  mul: "number",
  sub: "number",
  add: "number",
  div: "number",
  coalesce: "number",
  age: "number",
  ageBucket: "category",
  monthOfYear: "category",
  year: "category",
  flag: "number",
  regionPostal: "category",
};

export function passesFilter(f: FilterSpec, v: Cell | undefined): boolean {
  switch (f.op) {
    case "in":
      return v != null && f.values.includes(String(v));
    case "notIn":
      return v == null || !f.values.includes(String(v));
    case "notNull":
      return v != null && v !== "";
    default: {
      if (typeof v !== "number" || f.value == null) return false;
      if (f.op === "lt") return v < f.value;
      if (f.op === "lte") return v <= f.value;
      if (f.op === "gt") return v > f.value;
      return v >= f.value;
    }
  }
}

export function isEmptyTransform(t: TransformSpec | undefined): boolean {
  return !t || (!t.calculate.length && !t.filters.length);
}

/** Applique calculs + filtres (sans mémo). */
export function applyTransform(ds: Dataset, t: TransformSpec): Dataset {
  if (isEmptyTransform(t)) return ds;
  const columns: Column[] = [...ds.columns];
  const calcs = t.calculate.filter((c) => ds.columns.some((x) => x.name === c.a) || columns.some((x) => x.name === c.a));
  const rows: Row[] = ds.rows.map((r) => ({ ...r }));
  for (const c of calcs) {
    const colA = columns.find((x) => x.name === c.a);
    const values = rows.map((r) => {
      const v = calcValue(c, r, colA);
      r[c.as] = v;
      return v;
    });
    const type = CALC_TYPE[c.op];
    const distinct = new Set(values.filter((v) => v != null).map(String)).size;
    const col: Column = { name: c.as, type, detected: type, cardinality: distinct, decimal: ".", idLike: false };
    const i = columns.findIndex((x) => x.name === c.as);
    if (i >= 0) columns[i] = col;
    else columns.push(col);
  }
  const filters = t.filters.filter((f) => columns.some((c) => c.name === f.field));
  const keep: number[] = [];
  rows.forEach((r, i) => {
    if (filters.every((f) => passesFilter(f, r[f.field]))) keep.push(i);
  });
  const outRows = keep.map((i) => rows[i]!);
  const raw = keep.map((i) => {
    const o: Record<string, unknown> = { ...ds.raw[i] };
    for (const c of calcs) o[c.as] = rows[i]![c.as];
    return o;
  });
  return { name: ds.name, columns, rows: outRows, raw, typeOverrides: ds.typeOverrides };
}

const memo = new WeakMap<Dataset, Map<string, Dataset>>();
const baseMemo = new WeakMap<Dataset, Map<string, Dataset>>();

/** Recette d'un dataset dérivé (filtres permanents + colonnes gardées), sans version ni nom. */
export type DatasetRecipeLike = Pick<DatasetRef, "filters" | "columns"> & { name?: string; groupBy?: string; aggs?: { field: string; op: "sum" | "mean" | "count" }[]; formulas?: { as: string; op: "add" | "sub" | "mul" | "div" | "max" | "min"; a: string; b: string; bKind: "col" | "sum" | "max" | "mean" }[] };

/**
 * Applique la recette d'un dataset dérivé à la source : filtres permanents puis colonnes gardées.
 * Les filtres sur une colonne absente sont ignorés (source remplacée) ; le nom devient celui du dataset.
 */
function grouped(src: Dataset, idx: number[], groupBy: string, aggs: { field: string; op: "sum" | "mean" | "count" }[], name: string): Dataset {
  const groups = new Map<string, number[]>();
  for (const i of idx) {
    const key = String(src.rows[i]![groupBy] ?? "");
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  const raw = [...groups.entries()].map(([key, is]) => {
    const row: Record<string, unknown> = { [groupBy]: key };
    for (const a of aggs) {
      if (a.op === "count") { row[a.field] = is.length; continue; }
      const nums = is.map((i) => src.rows[i]![a.field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      row[a.field] = a.op === "mean" ? (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null) : nums.reduce((s, n) => s + n, 0);
    }
    return row;
  });
  return buildDataset(name, raw);
}


function aggOf(rows: Row[], field: string): { sum: number; max: number; mean: number } {
  const nums = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const sum = nums.reduce((s, n) => s + n, 0);
  return { sum, max: nums.length ? Math.max(...nums) : 0, mean: nums.length ? sum / nums.length : 0 };
}

function applyFormulas(ds: Dataset, formulas: NonNullable<DatasetRecipeLike["formulas"]>): Dataset {
  const usable = formulas.filter((f) => f.as && f.a && ds.columns.some((c) => c.name === f.a));
  if (!usable.length) return ds;
  const stats = new Map<string, { sum: number; max: number; mean: number }>();
  const need = (name: string) => stats.get(name) ?? (stats.set(name, aggOf(ds.rows, name)), stats.get(name)!);
  const right = (f: (typeof usable)[number], row: Row): number | null => {
    if (f.bKind === "col") {
      const v = row[f.b];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    const s = need(f.b || f.a);
    return f.bKind === "max" ? s.max : f.bKind === "mean" ? s.mean : s.sum;
  };
  const rows = ds.rows.map((row) => {
    const out = { ...row };
    for (const f of usable) {
      const x = row[f.a];
      const y = right(f, row);
      if (typeof x !== "number" || !Number.isFinite(x) || y == null) { out[f.as] = null; continue; }
      const r = f.op === "add" ? x + y : f.op === "sub" ? x - y : f.op === "mul" ? x * y : f.op === "div" ? (y === 0 ? null : x / y) : f.op === "max" ? Math.max(x, y) : Math.min(x, y);
      out[f.as] = r == null || !Number.isFinite(r) ? null : r;
    }
    return out;
  });
  const extra = usable.map((f) => ({ name: f.as, type: "number" as const, detected: "number" as const, cardinality: new Set(rows.map((r) => r[f.as]).filter((v) => v != null).map(String)).size, decimal: "," as const, idLike: false }));
  return { ...ds, columns: [...ds.columns.filter((c) => !usable.some((f) => f.as === c.name)), ...extra], rows, raw: rows.map((r) => ({ ...r })) };
}

export function applyRecipe(src: Dataset, r: DatasetRecipeLike): Dataset {
  const filters = r.filters.filter((f) => src.columns.some((c) => c.name === f.field));
  const idx: number[] = [];
  src.rows.forEach((row, i) => {
    if (filters.every((f) => passesFilter(f, row[f.field]))) idx.push(i);
  });
  const aggs = (r.aggs ?? []).filter((a) => a.op === "count" || src.columns.some((c) => c.name === a.field && c.type === "number"));
  if (r.groupBy && src.columns.some((c) => c.name === r.groupBy) && aggs.length) {
    const g = grouped(src, idx, r.groupBy, aggs, r.name?.trim() || src.name);
    return r.formulas?.length ? applyFormulas(g, r.formulas) : g;
  }
  const keepCols = r.columns.length ? src.columns.filter((c) => r.columns.includes(c.name)) : src.columns;
  const names = keepCols.map((c) => c.name);
  const pick = <T,>(o: Record<string, T>): Record<string, T> => {
    if (keepCols.length === src.columns.length) return o;
    const out: Record<string, T> = {};
    for (const n of names) if (n in o) out[n] = o[n]!;
    return out;
  };
  const rows = idx.map((i) => pick(src.rows[i]!) as Row);
  const columns = keepCols.map((c) => ({ ...c, cardinality: new Set(rows.map((x) => x[c.name]).filter((v) => v != null && v !== "").map(String)).size }));
  const base = { name: r.name?.trim() || src.name, columns, rows, raw: idx.map((i) => pick(src.raw[i] as Record<string, unknown>)), typeOverrides: src.typeOverrides };
  return r.formulas?.length ? applyFormulas(base, r.formulas) : base;
}

/** Données du dataset dérivé d'un spec (la source si aucun), mémorisées par source + recette. */
export function datasetBase<T extends Dataset | null>(spec: { dataset?: DatasetRef | null }, ds: T): T {
  const ref = spec.dataset;
  if (!ds || !ref || (!ref.filters.length && !ref.columns.length && !ref.name && !ref.base && !ref.groupBy && !(ref.formulas?.length))) return ds;
  const key = JSON.stringify([ref.name, ref.filters, ref.columns, ref.groupBy ?? "", ref.aggs ?? [], ref.formulas ?? [], ref.base ?? null]);
  let m = baseMemo.get(ds);
  if (!m) baseMemo.set(ds, (m = new Map()));
  let out = m.get(key);
  if (!out) {
    const chain = (src: Dataset, r: { filters?: FilterSpec[]; columns?: string[]; groupBy?: string; aggs?: { field: string; op: "sum" | "mean" | "count" }[]; formulas?: DatasetRecipeLike["formulas"]; base?: unknown; name?: string }): Dataset => {
      const parent = r.base && typeof r.base === "object" ? chain(src, r.base as typeof r) : src;
      return applyRecipe(parent, { name: r.name, filters: r.filters ?? [], columns: r.columns ?? [], groupBy: r.groupBy, aggs: r.aggs, formulas: r.formulas });
    };
    out = chain(ds, ref);
    if (m.size > 40) m.clear();
    m.set(key, out);
  }
  return out as T;
}

/** Dataset effectif d'un spec : dataset dérivé (recette), puis filtre de vue et calculs du graphique (mémorisé). */
export function effectiveDataset<T extends Dataset | null>(spec: Pick<ChartSpec, "transform"> & { dataset?: DatasetRef | null }, rawDs: T): T {
  const ds = datasetBase(spec, rawDs);
  if (!ds || isEmptyTransform(spec.transform)) return ds;
  const key = JSON.stringify(spec.transform);
  let m = memo.get(ds);
  if (!m) memo.set(ds, (m = new Map()));
  let out = m.get(key);
  if (!out) {
    out = applyTransform(ds, spec.transform);
    if (m.size > 40) m.clear();
    m.set(key, out);
  }
  return out as T;
}

/** Résumé lisible des transformations (réglages, sous-titres). */
export function describeTransform(t: TransformSpec): string[] {
  const out: string[] = [];
  for (const f of t.filters) {
    if (f.label) out.push(f.label);
    else if (f.op === "in") out.push(`${f.field} ∈ {${f.values.slice(0, 4).join(", ")}${f.values.length > 4 ? "…" : ""}}`);
    else if (f.op === "notIn") out.push(`${f.field} ∉ {${f.values.slice(0, 4).join(", ")}${f.values.length > 4 ? "…" : ""}}`);
    else if (f.op === "notNull") out.push(`${f.field} renseigné`);
    else {
      const v = f.value;
      // Horodatages (ms) → date française ; nombres → format français
      const shown = typeof v === "number" && Math.abs(v) > 1e11 ? dayMonthYear(v) : typeof v === "number" ? v.toLocaleString("fr-FR") : String(v ?? "");
      out.push(`${f.field} ${({ lt: "<", lte: "≤", gt: ">", gte: "≥" } as Record<string, string>)[f.op]} ${shown}`);
    }
  }
  return out;
}
