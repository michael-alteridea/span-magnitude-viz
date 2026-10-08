/**
 * Transformations du spec (`spec.transform`) : colonnes calculées puis filtres.
 * Pures et mémorisées : le même (dataset, transform) renvoie le même objet Dataset,
 * ce qui garde les caches de rendu stables.
 */
import { dayMonthYear } from "../story/fr";
import type { CalcSpec, ChartSpec, FilterSpec, TransformSpec } from "../spec";
import type { Cell, Column, ColumnType, Dataset, Row } from "./table";

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

/** Dataset effectif d'un spec (mémorisé par dataset + transform). */
export function effectiveDataset<T extends Dataset | null>(spec: Pick<ChartSpec, "transform">, ds: T): T {
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
