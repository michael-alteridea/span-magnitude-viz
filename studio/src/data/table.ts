/**
 * Modèle de données tabulaire du Studio + détection de types (nombre, date, texte, catégorie).
 * Gère la virgule décimale française, les espaces de milliers, €, %, et les dates FR (jj/mm/aaaa).
 */
import { isIdLikeColumnName } from "span-magnitude-viz/fileImport";

export type ColumnType = "number" | "date" | "text" | "category";
export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  number: "Nombre",
  date: "Date",
  text: "Texte",
  category: "Catégorie",
};

export interface Column {
  name: string;
  type: ColumnType;
  /** Type détecté automatiquement (avant surcharge éventuelle). */
  detected: ColumnType;
  /** Valeurs distinctes non vides. */
  cardinality: number;
  /** Convention décimale détectée pour les nombres. */
  decimal: "," | ".";
  idLike: boolean;
}

/** Cellule typée : nombre (dates = ms UTC), chaîne, ou vide. */
export type Cell = number | string | null;
export type Row = Record<string, Cell>;

export interface Dataset {
  name: string;
  columns: Column[];
  /** Lignes typées selon `columns[i].type`. */
  rows: Row[];
  /** Lignes brutes (pour re-typage et sauvegarde). */
  raw: Record<string, unknown>[];
  typeOverrides: Record<string, ColumnType>;
}

const MONTHS_FR: Record<string, number> = {
  janvier: 0, janv: 0, jan: 0, january: 0,
  février: 1, fevrier: 1, févr: 1, fevr: 1, fév: 1, fev: 1, feb: 1, february: 1,
  mars: 2, mar: 2, march: 2,
  avril: 3, avr: 3, apr: 3, april: 3,
  mai: 4, may: 4,
  juin: 5, jun: 5, june: 5,
  juillet: 6, juil: 6, jul: 6, july: 6,
  août: 7, aout: 7, aoû: 7, aug: 7, august: 7,
  septembre: 8, sept: 8, sep: 8, september: 8,
  octobre: 9, oct: 9, october: 9,
  novembre: 10, nov: 10, november: 10,
  décembre: 11, decembre: 11, déc: 11, dec: 11, december: 11,
};

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Nettoie une chaîne numérique (espaces, €, %, signes typographiques). */
function cleanNumeric(s: string): { body: string; negative: boolean } | null {
  let t = s.trim();
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t
    .replace(/[\u00a0\u202f\u2009\s']/g, "")
    .replace(/^[€$£]|[€$£]$/g, "")
    .replace(/(k€|m€|eur|usd)$/i, "")
    .replace(/%$/, "")
    .replace(/\u2212/g, "-");
  if (t.startsWith("+")) t = t.slice(1);
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^[\d.,]+([eE][+-]?\d+)?$/.test(t) || !/\d/.test(t)) return null;
  return { body: t, negative };
}

/**
 * Parse un nombre au format FR ou EN.
 * `decimal` force la convention ; sinon heuristique (« 1 234,5 » / « 1.234,5 » / « 1,234.5 »).
 */
export function parseNumberLoose(v: unknown, decimal?: "," | "."): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v == null || v instanceof Date) return null;
  const c = cleanNumeric(String(v));
  if (!c) return null;
  let t = c.body;
  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  if (hasComma && hasDot) {
    // Le dernier séparateur est la décimale
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (hasComma) {
    const parts = t.split(",");
    if (parts.length > 2) t = t.replace(/,/g, "");
    else if (decimal === ".") t = t.replace(/,/g, "");
    else if (decimal === ",") t = t.replace(",", ".");
    else if (/^\d{1,3},\d{3}$/.test(t)) t = t.replace(",", ""); // « 1,234 » ambigu → milliers EN
    else t = t.replace(",", ".");
  } else if (hasDot) {
    const parts = t.split(".");
    if (parts.length > 2) t = t.replace(/\./g, "");
    else if (decimal === "," && /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(".", "");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return c.negative ? -n : n;
}

function utc(y: number, m: number, d = 1, hh = 0, mm = 0, ss = 0): number | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1000 || y > 9999) return null;
  const t = Date.UTC(y, m, d, hh, mm, ss);
  const dt = new Date(t);
  if (dt.getUTCMonth() !== m) return null;
  return t;
}

/** Parse une date (ISO, jj/mm/aaaa, aaaa-mm, mois en toutes lettres FR/EN, Date, série Excel) → ms UTC. */
export function parseDateLoose(v: unknown, opts: { allowSerial?: boolean; allowYear?: boolean } = {}): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (opts.allowYear && Number.isInteger(v) && v >= 1900 && v <= 2100) return Date.UTC(v, 0, 1);
    if (opts.allowSerial && v > 20000 && v < 80000) return Math.round((v - 25569) * 86400000);
    return null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // année seule (« 2004 » dans une colonne « Année ») : 1er janvier
  if (opts.allowYear && /^\d{4}$/.test(s) && +s >= 1900 && +s <= 2100) return Date.UTC(+s, 0, 1);
  let m: RegExpMatchArray | null;
  // ISO date / datetime
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    return utc(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  // aaaa-mm / aaaa/mm
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) return utc(+m[1]!, +m[2]! - 1, 1);
  // jj/mm/aaaa, jj-mm-aaaa, jj.mm.aaaa (ordre français) [+ heure]
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    let y = +m[3]!;
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let d = +m[1]!;
    let mo = +m[2]!;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // format US évident
    return utc(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  // mm/aaaa
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return utc(+m[2]!, +m[1]! - 1, 1);
  // Trimestres « T3 2026 » / « Q3 2026 » / « 2026 T3 »
  if ((m = s.match(/^[TQ]([1-4])\s*[-/ ]?\s*(\d{4})$/i)) || (m = s.match(/^(\d{4})\s*[-/ ]?\s*[TQ]([1-4])$/i))) {
    const a = +m[1]!;
    const b = +m[2]!;
    const [q, y] = a > 4 ? [b, a] : [a, b];
    return utc(y, (q - 1) * 3, 1);
  }
  // « 8 oct. 2026 », « octobre 2026 », « oct-26 », « Jan 2026 »
  const words = s.toLowerCase().replace(/[.,]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 3) {
    let day = 1;
    let month: number | undefined;
    let year: number | undefined;
    for (const w of words) {
      if (/^\d{1,2}$/.test(w) && month === undefined && words.length === 3) day = +w;
      else if (/^\d{4}$/.test(w)) year = +w;
      else if (/^\d{2}$/.test(w) && month !== undefined) year = 2000 + +w;
      else if (MONTHS_FR[w] !== undefined) month = MONTHS_FR[w];
      else return null;
    }
    if (month !== undefined && year !== undefined) return utc(year, month, day);
  }
  return null;
}

const YEAR_HEADER = /(ann[ée]e|year|exercice|millésime|millesime)/i;

function detectDecimal(values: string[]): "," | "." {
  let comma = 0;
  let dot = 0;
  for (const s of values) {
    const t = s.replace(/[\s\u00a0\u202f]/g, "");
    if (/\d,\d{1,2}(?!\d)/.test(t) || /\d,\d{4,}/.test(t) || /\.\d{3},\d/.test(t)) comma++;
    if (/\d\.\d{1,2}(?!\d)/.test(t) || /\d\.\d{4,}/.test(t) || /,\d{3}\.\d/.test(t)) dot++;
  }
  return comma > dot ? "," : ".";
}

/** Détecte le type d'une colonne à partir de ses valeurs brutes. */
export function detectColumn(name: string, values: unknown[]): Omit<Column, "type"> {
  const nonBlank = values.filter((v) => !isBlank(v));
  const n = nonBlank.length || 1;
  const strings = nonBlank.filter((v): v is string => typeof v === "string");
  const decimal = detectDecimal(strings);
  const idLike = isIdLikeColumnName(name) || /^(réf|ref|référence|reference|code)$/i.test(name.trim());
  let num = 0;
  let date = 0;
  let years = 0;
  const distinct = new Set<string>();
  for (const v of nonBlank) {
    distinct.add(v instanceof Date ? v.toISOString() : String(v));
    const isDate = v instanceof Date || (typeof v === "string" && parseDateLoose(v) != null);
    const isNum = !isDate && parseNumberLoose(v, decimal) != null;
    if (isNum) num++;
    if (isDate) date++;
    const asN = isNum ? parseNumberLoose(v, decimal)! : NaN;
    if (Number.isInteger(asN) && asN >= 1900 && asN <= 2100) years++;
  }
  const cardinality = distinct.size;
  let detected: ColumnType;
  if (nonBlank.length === 0) detected = "text";
  else if (date / n >= 0.8) detected = "date";
  else if (years / n >= 0.95 && YEAR_HEADER.test(name)) detected = "date";
  else if (num / n >= 0.9) detected = idLike ? "category" : "number";
  else {
    const rows = values.length;
    detected = cardinality <= 40 && (cardinality <= rows * 0.7 || rows <= 25) ? "category" : "text";
  }
  // Codes postaux / identifiants numériques : catégorie plutôt que mesure
  if (detected === "number" && /(postal|zip|^cp$|code)/i.test(name)) detected = "category";
  return { name, detected, cardinality, decimal, idLike };
}

/** Convertit une valeur brute selon le type de colonne. */
export function coerceCell(v: unknown, col: Pick<Column, "type" | "decimal" | "name">): Cell {
  if (isBlank(v)) return null;
  switch (col.type) {
    case "number":
      return parseNumberLoose(v, col.decimal);
    case "date": {
      const yearish = YEAR_HEADER.test(col.name);
      return parseDateLoose(v, { allowSerial: true, allowYear: yearish || typeof v === "number" });
    }
    default:
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();
  }
}

export function columnNames(raw: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of raw.slice(0, 2000)) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

/** Construit un Dataset typé à partir de lignes brutes. */
export function buildDataset(
  name: string,
  raw: Record<string, unknown>[],
  typeOverrides: Record<string, ColumnType> = {}
): Dataset {
  const names = columnNames(raw);
  const columns: Column[] = names.map((n) => {
    const det = detectColumn(n, raw.map((r) => r[n]));
    const override = typeOverrides[n];
    return { ...det, type: override ?? det.detected };
  });
  const rows: Row[] = raw.map((r) => {
    const out: Row = {};
    for (const c of columns) out[c.name] = coerceCell(r[c.name], c);
    return out;
  });
  const cleanOverrides: Record<string, ColumnType> = {};
  for (const [k, v] of Object.entries(typeOverrides)) if (names.includes(k)) cleanOverrides[k] = v;
  return { name, columns, rows, raw, typeOverrides: cleanOverrides };
}

export function retype(ds: Dataset, column: string, type: ColumnType): Dataset {
  const overrides = { ...ds.typeOverrides };
  const col = ds.columns.find((c) => c.name === column);
  if (col && col.detected === type) delete overrides[column];
  else overrides[column] = type;
  return buildDataset(ds.name, ds.raw, overrides);
}

export function columnOf(ds: Dataset | null, name: string | null | undefined): Column | undefined {
  if (!ds || !name) return undefined;
  return ds.columns.find((c) => c.name === name);
}

/** Lignes brutes JSON-sûres (Date → ISO). */
export function serializableRaw(raw: Record<string, unknown>[]): Record<string, unknown>[] {
  return raw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date) o[k] = Number.isNaN(v.getTime()) ? null : v.toISOString();
      else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v == null) o[k] = v;
      else o[k] = String(v);
    }
    return o;
  });
}
