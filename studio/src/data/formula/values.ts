/** Valeurs du moteur de formules : scalaires, erreurs Excel, tableaux (plages évaluées). */

export class XlErr {
  constructor(readonly code: string) {}
  toString(): string {
    return this.code;
  }
}
export const ERR = {
  div0: new XlErr("#DIV/0!"),
  value: new XlErr("#VALUE!"),
  ref: new XlErr("#REF!"),
  name: new XlErr("#NAME?"),
  num: new XlErr("#NUM!"),
  na: new XlErr("#N/A"),
  nul: new XlErr("#NULL!"),
  cycle: new XlErr("#CYCLE!"),
};
export function errOf(code: string): XlErr {
  return Object.values(ERR).find((e) => e.code === code) ?? new XlErr(code);
}

export type Scalar = number | string | boolean | null | XlErr;
/** Plage / tableau évalué ; (r0, c0) = coin haut gauche quand il vient d'une plage (intersection implicite). */
export interface Arr {
  kind: "arr";
  rows: Scalar[][];
  r0?: number;
  c0?: number;
}
export type Val = Scalar | Arr;

export const isArr = (v: unknown): v is Arr => !!v && typeof v === "object" && (v as Arr).kind === "arr";
export const isErr = (v: unknown): v is XlErr => v instanceof XlErr;

export function arr(rows: Scalar[][], r0?: number, c0?: number): Arr {
  return { kind: "arr", rows, r0, c0 };
}

/** Tous les scalaires d'une valeur (plage aplatie). */
export function flat(v: Val): Scalar[] {
  if (isArr(v)) {
    const out: Scalar[] = [];
    for (const row of v.rows) for (const x of row) out.push(x);
    return out;
  }
  return [v];
}

/** Conversion numérique (opérateurs) : vide → 0, booléen → 1/0, texte numérique → nombre. */
export function toNum(v: Scalar): number | XlErr {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof XlErr) return v;
  const t = v.trim();
  if (t === "") return ERR.value;
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  if (Number.isFinite(n)) return pct ? n / 100 : n;
  return ERR.value;
}
export function toBool(v: Scalar): boolean | XlErr {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v instanceof XlErr) return v;
  const u = v.toUpperCase();
  if (u === "TRUE" || u === "VRAI") return true;
  if (u === "FALSE" || u === "FAUX") return false;
  return ERR.value;
}
/** Format « Général » simplifié (concaténation, TEXT sans format). */
export function numToText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = String(Number(n.toPrecision(15)));
  return s;
}
export function toStr(v: Scalar): string | XlErr {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToText(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}

/** Comparaison Excel : nombres < textes < booléens ; texte insensible à la casse ; vide = 0 ou "". */
export function compare(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const rank = (x: Scalar) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return a === b ? 0 : a ? 1 : -1;
}

/* ---- dates (système 1900) ---- */
const EPOCH = Date.UTC(1899, 11, 30);
export function serialFromYmd(y: number, m0: number, d: number): number {
  return Math.round((Date.UTC(y, m0, d) - EPOCH) / 86400000);
}
export function ymdFromSerial(serial: number): { y: number; m: number; d: number } {
  const dt = new Date(EPOCH + Math.floor(serial) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}
export function serialToMs(serial: number): number {
  return EPOCH + serial * 86400000;
}
export function msToSerial(ms: number): number {
  return (ms - EPOCH) / 86400000;
}
