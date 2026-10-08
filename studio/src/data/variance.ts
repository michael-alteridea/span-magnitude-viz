/**
 * Modèle d'écarts (IBCS) : réel vs référence par catégorie ou par période.
 * Sommes « appariées » : une ligne ne compte que si les deux scénarios sont renseignés
 * (ex. réel à fin septembre comparé au budget des mêmes mois).
 */
import type { ChartSpec } from "../spec";
import type { Dataset } from "./table";
import { columnOf } from "./table";
import { bucketDate, knownOrder, type Key } from "./model";
import { formatDate, guessGrain, type TimeGrain } from "../format";

export interface VarianceModel {
  xKind: "band" | "time";
  keys: Key[];
  labels: string[];
  actual: number[];
  ref: number[];
  delta: number[];
  rel: number[];
  actualName: string;
  refName: string;
  total: { actual: number; ref: number; delta: number; rel: number };
  /** Lignes appariées / lignes avec réel. */
  coverage: number;
}

export function buildVarianceModel(spec: ChartSpec, ds: Dataset): VarianceModel | null {
  const enc = spec.encoding;
  const [aName, bName] = enc.y;
  const aCol = columnOf(ds, aName);
  const bCol = columnOf(ds, bName);
  if (!aCol || !bCol || aCol.type !== "number" || bCol.type !== "number") return null;
  const xCol = columnOf(ds, enc.x);
  const isTime = xCol?.type === "date";
  const grain: TimeGrain | "none" = isTime ? (enc.xGrain !== "none" ? enc.xGrain : "month") : "none";
  const idx = new Map<Key, number>();
  const keys: Key[] = [];
  const A: number[] = [];
  const B: number[] = [];
  let paired = 0;
  let withA = 0;
  for (const r of ds.rows) {
    const a = r[aCol.name];
    const b = r[bCol.name];
    if (typeof a === "number") withA++;
    if (typeof a !== "number" || typeof b !== "number") continue;
    let k: Key = "Total";
    if (xCol) {
      const v = r[xCol.name];
      if (v == null || v === "") continue;
      k = isTime && typeof v === "number" ? bucketDate(v, grain as TimeGrain) : String(v);
    }
    let i = idx.get(k);
    if (i === undefined) {
      i = keys.length;
      idx.set(k, i);
      keys.push(k);
      A.push(0);
      B.push(0);
    }
    A[i]! += a;
    B[i]! += b;
    paired++;
  }
  if (!keys.length) return null;
  let order = keys.map((_, i) => i);
  if (isTime) order.sort((p, q) => (keys[p] as number) - (keys[q] as number));
  else {
    const ko = knownOrder(keys);
    const d = (i: number) => A[i]! - B[i]!;
    if (spec.style.sort === "none" && ko) order.sort((p, q) => ko.get(String(keys[p]))! - ko.get(String(keys[q]))!);
    else if (spec.style.sort === "asc") order.sort((p, q) => A[p]! - A[q]!);
    else if (spec.style.sort === "alpha") order.sort((p, q) => String(keys[p]).localeCompare(String(keys[q]), "fr"));
    else if (spec.style.sort === "desc") order.sort((p, q) => A[q]! - A[p]!);
    else order.sort((p, q) => d(p) - d(q));
  }
  const k2 = order.map((i) => keys[i]!);
  const actual = order.map((i) => A[i]!);
  const ref = order.map((i) => B[i]!);
  const delta = actual.map((a, i) => a - ref[i]!);
  const rel = actual.map((a, i) => (ref[i] ? (a - ref[i]!) / Math.abs(ref[i]!) : NaN));
  const g = isTime ? (grain === "none" ? guessGrain(k2 as number[]) : (grain as TimeGrain)) : "day";
  const ta = actual.reduce((s, v) => s + v, 0);
  const tb = ref.reduce((s, v) => s + v, 0);
  return {
    xKind: isTime ? "time" : "band",
    keys: k2,
    labels: k2.map((k) => (isTime && typeof k === "number" ? formatDate(k, g) : String(k))),
    actual,
    ref,
    delta,
    rel,
    actualName: aCol.name,
    refName: bCol.name,
    total: { actual: ta, ref: tb, delta: ta - tb, rel: tb ? (ta - tb) / Math.abs(tb) : NaN },
    coverage: withA ? paired / withA : 0,
  };
}

/** Un écart est-il favorable selon la polarité ? */
export function isFavourable(delta: number, polarity: "higher" | "lower"): boolean {
  return polarity === "higher" ? delta >= 0 : delta <= 0;
}
