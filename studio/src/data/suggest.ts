/**
 * Encodages automatiques : choisit X / Y / série / temps selon le type de graphique
 * et les types de colonnes détectés. Conserve les choix valides de l'utilisateur.
 */
import type { ChartSpec, ChartType } from "../spec";
import { isBarType, isRadial, isSpecial, isVariance } from "../spec";
import { detectRoles } from "../story/roles";
import type { Column, Dataset } from "./table";

type Enc = ChartSpec["encoding"];

const measures = (ds: Dataset) => ds.columns.filter((c) => c.type === "number" && !c.idLike);
const cats = (ds: Dataset) =>
  ds.columns.filter((c) => c.type === "category").sort((a, b) => a.cardinality - b.cardinality).filter((c) => c.cardinality >= 2);
const dates = (ds: Dataset) => ds.columns.filter((c) => c.type === "date");
const texts = (ds: Dataset) => ds.columns.filter((c) => c.type === "text" || c.type === "category");
const col = (ds: Dataset, n: string | null | undefined) => (n ? ds.columns.find((c) => c.name === n) : undefined);

function bestCategory(ds: Dataset, exclude: (string | null | undefined)[], maxCard = 30): Column | undefined {
  return cats(ds).find((c) => !exclude.includes(c.name) && c.cardinality <= maxCard) ?? texts(ds).find((c) => !exclude.includes(c.name));
}

/**
 * @param fresh true = nouvelles données (on repart de zéro), false = changement de type (on garde ce qui reste valide).
 */
export function autoEncode(spec: ChartSpec, ds: Dataset | null, type: ChartType, fresh: boolean): Enc {
  const prev = spec.encoding;
  if (!ds) return { ...prev };
  const enc: Enc = fresh
    ? { ...prev, x: null, y: [], y2: null, series: null, time: null, size: null, label: null, end: null, lat: null, lon: null, postal: null, xGrain: "none", aggregate: "sum", y2Aggregate: "mean" }
    : { ...prev, y: prev.y.filter((f) => col(ds, f)?.type === "number") };
  for (const k of ["x", "y2", "series", "time", "size", "label", "end", "lat", "lon", "postal"] as const) {
    if (enc[k] && !col(ds, enc[k])) enc[k] = null;
  }
  const M = measures(ds);
  const D = dates(ds);

  if (isSpecial(type)) return enc;

  if (isVariance(type)) {
    // Réel vs référence : colonnes de scénarios reconnues, sinon les deux premières mesures
    const sc = detectRoles(ds).scenarios;
    const actual = sc.actual?.name ?? (enc.y[0] && col(ds, enc.y[0])?.type === "number" ? enc.y[0] : M[0]?.name);
    const ref = (sc.budget ?? sc.py ?? sc.forecast)?.name ?? (enc.y[1] && enc.y[1] !== actual ? enc.y[1] : M.find((c) => c.name !== actual)?.name);
    enc.y = [actual, ref].filter((v): v is string => !!v);
    const xCol = col(ds, enc.x);
    if (!xCol || xCol.type === "number") enc.x = bestCategory(ds, [], 24)?.name ?? D[0]?.name ?? null;
    enc.series = null;
    enc.y2 = null;
    enc.time = null;
    enc.aggregate = "sum";
    return enc;
  }

  if (!enc.y.length && M[0]) enc.y = [M[0].name];
  const xCol = col(ds, enc.x);

  if (isBarType(type) || isRadial(type)) {
    if (!xCol || (isRadial(type) && xCol.type === "date") || xCol.type === "number") {
      const c = bestCategory(ds, [enc.series], isRadial(type) ? 16 : 40);
      if (xCol?.type === "date" && !isRadial(type) && !fresh) {
        /* barres par date : on garde */
      } else enc.x = c?.name ?? D[0]?.name ?? null;
    }
    if (isRadial(type)) enc.series = null;
    if ((type === "groupedBar" || type === "stackedBar") && !enc.series && enc.y.length < 2) {
      const s = bestCategory(ds, [enc.x], 12);
      if (s) enc.series = s.name;
      else if (M.length >= 2) enc.y = M.slice(0, 3).map((c) => c.name);
    }
    if (col(ds, enc.x)?.type === "date" && enc.xGrain === "none") {
      const uniq = new Set(ds.rows.map((r) => r[enc.x!])).size;
      if (uniq > 40) enc.xGrain = "month";
    }
  } else if (type === "line" || type === "area" || type === "stackedArea") {
    if (!xCol || (xCol.type !== "date" && D[0])) {
      if (xCol && xCol.type === "category" && xCol.cardinality <= 12 && !enc.series) enc.series = xCol.name;
      enc.x = D[0]?.name ?? M.find((c) => !enc.y.includes(c.name))?.name ?? bestCategory(ds, [])?.name ?? null;
    }
    if (type === "stackedArea" && !enc.series && enc.y.length < 2) {
      const s = bestCategory(ds, [enc.x], 12);
      if (s) enc.series = s.name;
    }
    if (col(ds, enc.x)?.type === "date" && enc.xGrain === "none") {
      const uniq = new Set(ds.rows.map((r) => r[enc.x!])).size;
      if (uniq > 120) enc.xGrain = "month";
    }
  } else if (type === "scatter") {
    if (!xCol || (xCol.type !== "number" && xCol.type !== "date")) {
      enc.x = M.find((c) => !enc.y.includes(c.name))?.name ?? D[0]?.name ?? null;
    }
    if (enc.y.length > 1) enc.y = [enc.y[0]!];
    if (enc.y[0] === enc.x) enc.y = M.filter((c) => c.name !== enc.x).slice(0, 1).map((c) => c.name);
    if (!enc.label) enc.label = ds.columns.find((c) => (c.type === "text" || c.type === "category") && c.cardinality > ds.rows.length * 0.6)?.name ?? null;
    if (!enc.series && fresh) enc.series = bestCategory(ds, [enc.x, enc.label], 10)?.name ?? null;
  }
  if (!enc.time && D[0] && fresh) enc.time = D[0].name;
  return enc;
}
