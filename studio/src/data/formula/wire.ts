/** Sérialisation du classeur et des résultats entre le fil principal et le Web Worker de recalcul. */
import { XlErr, errOf, type Scalar } from "./values";
import type { RecalcReport, WorkbookIn } from "./engine";

type WScalar = number | string | boolean | null | { e: string };
export interface WireSheet {
  name: string;
  maxR: number;
  maxC: number;
  keys: number[];
  vals: WScalar[];
  /** Formule ou chaîne vide. */
  fs: string[];
}
export interface WireWorkbook {
  sheets: WireSheet[];
  names?: Record<string, string>;
}
export type WorkerMsg =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; values: { keys: number[]; vals: WScalar[] }[]; report: RecalcReport }
  | { type: "error"; message: string };

const enc = (v: Scalar): WScalar => (v instanceof XlErr ? { e: v.code } : v);
const dec = (v: WScalar): Scalar => (v !== null && typeof v === "object" ? errOf(v.e) : v);

export function wbToWire(wb: WorkbookIn): WireWorkbook {
  return {
    names: wb.names,
    sheets: wb.sheets.map((s) => {
      const keys: number[] = [];
      const vals: WScalar[] = [];
      const fs: string[] = [];
      for (const [k, c] of s.cells) {
        keys.push(k);
        vals.push(enc(c.v));
        fs.push(c.f ?? "");
      }
      return { name: s.name, maxR: s.maxR, maxC: s.maxC, keys, vals, fs };
    }),
  };
}
export function wbFromWire(w: WireWorkbook): WorkbookIn {
  return {
    names: w.names,
    sheets: w.sheets.map((s) => {
      const cells = new Map<number, { v: Scalar; f?: string }>();
      s.keys.forEach((k, i) => cells.set(k, s.fs[i] ? { v: dec(s.vals[i]!), f: s.fs[i] } : { v: dec(s.vals[i]!) }));
      return { name: s.name, maxR: s.maxR, maxC: s.maxC, cells };
    }),
  };
}
export function valuesToWire(values: Map<number, Scalar>[]): { keys: number[]; vals: WScalar[] }[] {
  return values.map((m) => {
    const keys: number[] = [];
    const vals: WScalar[] = [];
    for (const [k, v] of m) {
      keys.push(k);
      vals.push(enc(v));
    }
    return { keys, vals };
  });
}
export function valuesFromWire(w: { keys: number[]; vals: WScalar[] }[]): Map<number, Scalar>[] {
  return w.map(({ keys, vals }) => {
    const m = new Map<number, Scalar>();
    keys.forEach((k, i) => m.set(k, dec(vals[i]!)));
    return m;
  });
}
