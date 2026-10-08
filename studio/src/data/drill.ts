/**
 * Exploration guidée (type « drill ») — modèle pur, sans DOM.
 *
 * Un état d'exploration = fil d'Ariane (`path` : étapes « période » et « catégorie ») + vue courante :
 *  - « periods »   : barres par pas de temps (trimestre, mois…) ; une période du chemin plus grossière que le
 *                    pas est zoomée (ses mois + la période précédente en contexte), une période de même pas
 *                    est mise en avant sur tout l'historique (focus après un clic sur une région, un commercial…) ;
 *  - « month »     : la période focalisée jour par jour (cumul), comparée au rythme des N périodes précédentes ;
 *  - « map »       : la période focalisée répartie par région (choroplèthe), avec la référence ;
 *  - « history »   : historique par catégorie (petits multiples), période focalisée mise en avant ;
 *  - « breakdown » : la période focalisée détaillée par n'importe quelle catégorie, avec la référence.
 * Les étapes « catégorie » filtrent toujours ; la dernière étape « période » filtre (carte, détail, jour par
 * jour) ou sert de mise en avant (périodes, historique).
 */
import type { ChartSpec, DrillGrain, DrillSpec, DrillStep, DrillView } from "../spec";
import type { Column, Dataset, Row } from "./table";
import { columnOf } from "./table";
import { effectiveDataset } from "./transform";
import { regionCoverage, regionNuts } from "./regions";

const DAY = 86400000;
export const GRAIN_RANK: Record<DrillGrain, number> = { week: 0, month: 1, quarter: 2, year: 3 };
/** Pas plus fin pour le zoom (null : on passe à la vue « jour par jour »). */
export const FINER: Record<DrillGrain, DrillGrain | null> = { year: "quarter", quarter: "month", month: null, week: null };

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/* ------------------------------------------------------------------ calendrier */

export function floorGrain(ms: number, g: DrillGrain): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (g) {
    case "year":
      return Date.UTC(y, 0, 1);
    case "quarter":
      return Date.UTC(y, m - (m % 3), 1);
    case "month":
      return Date.UTC(y, m, 1);
    case "week": {
      const wd = (d.getUTCDay() + 6) % 7;
      return Date.UTC(y, m, d.getUTCDate() - wd);
    }
  }
}

export function addGrain(ms: number, g: DrillGrain, n: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (g) {
    case "year":
      return Date.UTC(y + n, m, d.getUTCDate());
    case "quarter":
      return Date.UTC(y, m + 3 * n, d.getUTCDate());
    case "month":
      return Date.UTC(y, m + n, d.getUTCDate());
    case "week":
      return ms + 7 * n * DAY;
  }
}

/** « T2 2026 », « juin 2026 », « 2026 », « sem. du 1 juin 2026 ». `cap` : majuscule initiale (fil d'Ariane). */
export function grainLabel(ms: number, g: DrillGrain, cap = false): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  let s: string;
  if (g === "year") s = String(y);
  else if (g === "quarter") s = `T${Math.floor(m / 3) + 1} ${y}`;
  else if (g === "month") s = `${MONTHS_LONG[m]} ${y}`;
  else s = `sem. du ${d.getUTCDate()} ${MONTHS_SHORT[m]} ${y}`;
  return cap ? s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1) : s;
}

/** Libellé court d'axe (« avr. », « T2 », « 2026 », « 1 juin ») + année séparée (deuxième ligne). */
export function tickLabel(ms: number, g: DrillGrain): { tick: string; year: string } {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear());
  const m = d.getUTCMonth();
  if (g === "year") return { tick: y, year: "" };
  if (g === "quarter") return { tick: `T${Math.floor(m / 3) + 1}`, year: y };
  if (g === "month") return { tick: MONTHS_SHORT[m]!, year: y };
  return { tick: `${d.getUTCDate()} ${MONTHS_SHORT[m]}`, year: y };
}

/** « mars–mai 2026 » / « T3 2025–T1 2026 » : fenêtre de référence [a, b] (b = début de la dernière période). */
export function windowLabel(a: number, b: number, g: DrillGrain): string {
  if (a === b) return grainLabel(a, g);
  const da = new Date(a);
  const db = new Date(b);
  if (g === "month") {
    const sameYear = da.getUTCFullYear() === db.getUTCFullYear();
    return sameYear ? `${MONTHS_LONG[da.getUTCMonth()]}–${MONTHS_LONG[db.getUTCMonth()]} ${db.getUTCFullYear()}` : `${grainLabel(a, g)}–${grainLabel(b, g)}`;
  }
  return `${grainLabel(a, g)}–${grainLabel(b, g)}`;
}

/* ------------------------------------------------------------------ colonnes */

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function guessDrillDate(ds: Dataset): string | null {
  const dates = ds.columns.filter((c) => c.type === "date");
  if (!dates.length) return null;
  const pref = dates.find((c) => /creat|crea|cree|ouvert|commande|order|date_?op|^date$/.test(norm(c.name)) && !/clotur|close|fin|echeance/.test(norm(c.name)));
  if (pref) return pref.name;
  return [...dates].sort((a, b) => b.cardinality - a.cardinality)[0]!.name;
}

export function guessDrillMeasure(ds: Dataset): string | null {
  const nums = ds.columns.filter((c) => c.type === "number" && !c.idLike);
  const pref = nums.find((c) => /montant|amount|chiffre|\bca\b|revenu|valeur|value|vente|sales/.test(norm(c.name)) && !/pond|weight|prob|pct|taux|%/.test(norm(c.name)));
  return (pref ?? nums.find((c) => !/prob|pct|taux|%|annee|year/.test(norm(c.name))) ?? null)?.name ?? null;
}

/** Colonne « région » cartographiable (≥ 2 valeurs, ≥ 60 % reconnues). */
export function guessRegionField(ds: Dataset): string | null {
  let best: { name: string; score: number } | null = null;
  for (const c of ds.columns) {
    if (c.type !== "category" && c.type !== "text") continue;
    if (c.cardinality < 2 || c.cardinality > 40) continue;
    const vals = new Set(ds.rows.map((r) => r[c.name]));
    const cov = regionCoverage(vals);
    if (cov.matched >= 2 && cov.share >= 0.6) {
      const score = cov.share + (/r[ée]gion/i.test(c.name) ? 0.5 : 0);
      if (!best || score > best.score) best = { name: c.name, score };
    }
  }
  return best?.name ?? null;
}

/** Colonne « personne » (commercial, vendeur, responsable). */
export function guessPersonField(ds: Dataset): string | null {
  const c = ds.columns.find((x) => (x.type === "category" || x.type === "text") && x.cardinality >= 2 && x.cardinality <= 80 && /commercial|vendeur|owner|propri|sales|responsable|conseiller|account manager/.test(norm(x.name)));
  return c?.name ?? null;
}

/** Catégories proposées pour « Détailler par… » (2 à 60 valeurs distinctes). */
export function detailFields(ds: Dataset, exclude: (string | null | undefined)[] = []): Column[] {
  return ds.columns.filter((c) => (c.type === "category" || (c.type === "text" && c.cardinality <= 60)) && c.cardinality >= 2 && c.cardinality <= 60 && !c.idLike && !exclude.includes(c.name));
}

/* ------------------------------------------------------------------ contexte */

export interface DrillCtx {
  spec: DrillSpec;
  date: Column;
  measure: Column | null;
  eff: Dataset;
  /** Lignes après filtres de catégorie du chemin (toutes dates). */
  rows: Row[];
  /** Horodatage et valeur de chaque ligne de `rows`. */
  ts: Float64Array;
  vs: Float64Array;
  /** Bornes des dates sur tout le jeu (avant filtres de catégorie). */
  minT: number;
  maxT: number;
  /** Dernière étape « période » du chemin. */
  period: DrillStep | null;
  cats: DrillStep[];
  /** Mode versions (Réel 2025 → Budget 2026) : 0 = version « from », 1 = « to » ; null hors de ce mode. */
  ver: Int8Array | null;
  /** Ligne de coûts (colonne nature) : montant soustrait dans `vs`. */
  cost: Uint8Array | null;
  fromLabel: string;
  toLabel: string;
  version: Column | null;
  nature: Column | null;
}

/** Comparaison de versions active (colonne + deux valeurs distinctes). */
export function isVersionMode(d: Pick<DrillSpec, "version" | "from" | "to">): boolean {
  return !!(d.version && d.from && d.to && d.from !== d.to);
}

/** Libellé « coût » (charges, dépenses…) : montant soustrait du résultat. */
export function isCostLabel(v: unknown): boolean {
  return typeof v === "string" && /co[uû]t|charge|d[ée]pense|cost|expense|achat/i.test(v);
}

export function drillCtx(spec: Pick<ChartSpec, "drill" | "transform">, ds: Dataset | null): { ctx: DrillCtx | null; error: string | null } {
  if (!ds || !ds.rows.length) return { ctx: null, error: "Aucune donnée — importez un fichier ou choisissez un exemple." };
  const eff = effectiveDataset(spec, ds);
  const d = spec.drill;
  const date = columnOf(eff, d.date) ?? columnOf(eff, guessDrillDate(eff));
  if (!date || date.type !== "date") return { ctx: null, error: "Exploration guidée : il faut une colonne date (création, commande…)." };
  const measure = d.measure ? columnOf(eff, d.measure) ?? null : null;
  if (measure && measure.type !== "number") return { ctx: null, error: `« ${measure.name} » n'est pas numérique.` };
  let minT = Infinity;
  let maxT = -Infinity;
  for (const r of eff.rows) {
    const t = r[date.name];
    if (typeof t !== "number") continue;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  if (!Number.isFinite(minT)) return { ctx: null, error: `Aucune date exploitable dans « ${date.name} ».` };
  const cats = d.path.filter((s) => s.kind === "cat" && s.field && s.value != null);
  const period = [...d.path].reverse().find((s) => s.kind === "period" && s.start != null && s.grain) ?? null;
  const version = isVersionMode(d) ? columnOf(eff, d.version) ?? null : null;
  const nature = d.nature ? columnOf(eff, d.nature) ?? null : null;
  if (isVersionMode(d) && !version) return { ctx: null, error: `Colonne de versions « ${d.version} » introuvable.` };
  const rows = eff.rows.filter((r) => typeof r[date.name] === "number" && cats.every((c) => String(r[c.field!] ?? "") === c.value) && (!version || r[version.name] === d.from || r[version.name] === d.to));
  if (version && !rows.some((r) => r[version.name] === d.from)) return { ctx: null, error: `Aucune ligne « ${d.from} » dans « ${version.name} ».` };
  const ts = new Float64Array(rows.length);
  const vs = new Float64Array(rows.length);
  const ver = version ? new Int8Array(rows.length) : null;
  const cost = nature ? new Uint8Array(rows.length) : null;
  rows.forEach((r, i) => {
    ts[i] = r[date.name] as number;
    const v = measure ? r[measure.name] : 1;
    const x = typeof v === "number" && Number.isFinite(v) ? v : 0;
    const c = nature ? isCostLabel(r[nature.name]) : false;
    if (cost) cost[i] = c ? 1 : 0;
    vs[i] = c && measure ? -x : x;
    if (ver) ver[i] = r[version!.name] === d.to ? 1 : 0;
  });
  return { ctx: { spec: d, date, measure, eff, rows, ts, vs, minT, maxT, period, cats, ver, cost, fromLabel: d.from ?? "", toLabel: d.to ?? "", version, nature }, error: null };
}

/** Somme (ou nombre) sur [a, b[ ; `pred` filtre en plus les lignes. */
function sumIn(ctx: DrillCtx, a: number, b: number, pred?: (r: Row) => boolean): { v: number; n: number } {
  let v = 0;
  let n = 0;
  for (let i = 0; i < ctx.rows.length; i++) {
    const t = ctx.ts[i]!;
    if (t < a || t >= b) continue;
    if (pred && !pred(ctx.rows[i]!)) continue;
    v += ctx.vs[i]!;
    n++;
  }
  return { v, n };
}

/** Période incomplète : les données s'arrêtent plus d'une semaine avant sa fin (un jour pour une semaine). */
function isPartial(ctx: DrillCtx, start: number, g: DrillGrain): boolean {
  const end = addGrain(start, g, 1);
  return ctx.maxT < end - (g === "week" ? 1 : 7) * DAY || start < floorGrain(ctx.minT, g) || (start === floorGrain(ctx.minT, g) && ctx.minT > start + 7 * DAY);
}

/** Moyenne des `k` périodes précédentes (dans l'étendue des données) ; null si aucune. */
function trailing(ctx: DrillCtx, start: number, g: DrillGrain, k: number, pred?: (r: Row) => boolean): { v: number; n: number; from: number; to: number } | null {
  const first = floorGrain(ctx.minT, g);
  let v = 0;
  let n = 0;
  let used = 0;
  let from = start;
  for (let i = 1; i <= k; i++) {
    const a = addGrain(start, g, -i);
    if (a < first) break;
    const s = sumIn(ctx, a, addGrain(a, g, 1), pred);
    v += s.v;
    n += s.n;
    used++;
    from = a;
  }
  if (!used) return null;
  return { v: v / used, n: n / used, from, to: addGrain(start, g, -1) };
}

/* ------------------------------------------------------------------ modèles */

export interface PeriodBar {
  key: number;
  tick: string;
  year: string;
  label: string;
  value: number;
  count: number;
  highlight: boolean;
  partial: boolean;
  /** Référence (moyenne des N périodes précédentes, ou période précédente) ; null sans référence. */
  ref: number | null;
  refCount: number | null;
}

export interface PeriodsModel {
  view: "periods";
  grain: DrillGrain;
  bars: PeriodBar[];
  /** Index de la barre mise en avant (focus du chemin ou décrochage détecté). */
  focus: number | null;
  focusKind: "standout" | "focus" | null;
  /** Libellé de la référence de la barre mise en avant (« moy. mars–mai 2026 », « T1 2026 »). */
  refLabel: string;
  /** Zoom : libellé de la période zoomée (« T2 2026 »). */
  zoomLabel: string | null;
}

export interface MonthModel {
  view: "month";
  grain: DrillGrain;
  start: number;
  days: number;
  /** Cumul de la période jour par jour (null au-delà des données). */
  cur: (number | null)[];
  /** Cumul moyen des périodes de référence, jour par jour. */
  ref: number[];
  refLabel: string;
  curTotal: number;
  refTotal: number;
  curCount: number;
  refCount: number;
  /** Semaines (1–7, 8–14, 15–21, 22–fin) : valeur vs rythme de référence. */
  weeks: { from: number; to: number; cur: number; ref: number }[];
}

export interface CatStat {
  key: string;
  value: number;
  count: number;
  ref: number | null;
  refCount: number | null;
  delta: number | null;
  /** Période suivante (reprise ?) : valeur et nombre ; null si hors données. */
  next: { value: number; count: number } | null;
  /** Carte : identifiant de région FR · BE (null si non reconnu). */
  nuts?: string | null;
}

export interface BreakdownModel {
  view: "breakdown" | "map";
  field: string;
  stats: CatStat[];
  total: number;
  count: number;
  refTotal: number | null;
  refCount: number | null;
  delta: number | null;
  periodLabel: string | null;
  refLabel: string;
  nextLabel: string | null;
  /** Catégorie qui pèse le plus dans l'écart (baisse si l'écart total est négatif). */
  standout: number | null;
  /** Part de l'écart total expliquée par `standout` (0..1+). */
  share: number | null;
  /** Carte : valeurs non reconnues comme régions. */
  unmatched: string[];
  /** Comparaison de versions : valeur = version « to », référence = version « from ». */
  versions?: boolean;
}

export interface HistorySeries {
  key: string;
  values: number[];
  counts: number[];
  /** Ratio de la période focalisée vs sa référence (−0,64 = −64 %). */
  focusRatio: number | null;
  focusRef: number | null;
  nuts?: string | null;
}

export interface HistoryModel {
  view: "history";
  field: string;
  grain: DrillGrain;
  keys: number[];
  ticks: { tick: string; year: string }[];
  partial: boolean[];
  series: HistorySeries[];
  focus: number | null;
  max: number;
  standout: number | null;
  refLabel: string;
  /** Mois calendaire bas dans toutes les séries (saisonnalité) : index 0..11 et ratio moyen. */
  seasonal: { month: number; ratio: number; keys: number[] } | null;
}

export interface BridgeItem {
  key: string;
  kind: "start" | "delta" | "subtotal" | "end";
  label: string;
  /** Facteur : impact signé sur le résultat ; total / sous-total : niveau. */
  value: number;
  /** Cumul avant et après l'élément (dessin des marches). */
  y0: number;
  y1: number;
  group: string | null;
  /** Facteur : valeur nette de chaque version. */
  from: number;
  to: number;
  /** Facteur : écart de revenus et écart de coûts (hausse de coûts > 0), si une colonne nature est définie. */
  rev: number;
  cost: number;
}

export interface BridgeModel {
  view: "bridge";
  field: string;
  groupField: string | null;
  items: BridgeItem[];
  fromLabel: string;
  toLabel: string;
  start: number;
  end: number;
  delta: number;
  revDelta: number | null;
  costDelta: number | null;
  /** Index (dans items) du plus fort facteur positif / négatif. */
  topPos: number | null;
  topNeg: number | null;
  /** Un clic sur un facteur descend d'un niveau (niveau suivant ou mois). */
  drillable: boolean;
}

export interface CompareMonth {
  key: number;
  tick: string;
  label: string;
  from: number | null;
  to: number | null;
  delta: number | null;
}

export interface CompareModel {
  view: "compare";
  months: CompareMonth[];
  fromLabel: string;
  toLabel: string;
  fromTotal: number;
  toTotal: number;
  delta: number;
  /** Coûts seuls : montants positifs, une hausse est défavorable. */
  costOnly: boolean;
  /** Écart du 1er et du 2nd semestre. */
  h1: number;
  h2: number;
  /** Rupture : premier mois d'un écart durable (contrat perdu, nouveaux contrats…). */
  breakAt: number | null;
}

export interface PivotSeries {
  key: string;
  values: (number | null)[];
  total: number;
}

export interface PivotModel {
  view: "pivot";
  chart: "bar" | "line";
  x: string;
  xLabel: string;
  xIsTime: boolean;
  keys: string[];
  /** Valeur de catégorie cliquable (null : axe de temps). */
  catValues: (string | null)[];
  series: PivotSeries[];
  seriesField: string | null;
  agg: "sum" | "mean" | "count" | "delta";
  isDelta: boolean;
  /** Version retenue quand la mesure ne compare pas les versions. */
  versionNote: string | null;
}

export type DrillModel = PeriodsModel | MonthModel | BreakdownModel | HistoryModel | BridgeModel | CompareModel | PivotModel;

function bucketsOf(ctx: DrillCtx, g: DrillGrain, from?: number, to?: number): number[] {
  const out: number[] = [];
  let k = floorGrain(from ?? ctx.minT, g);
  const end = to ?? ctx.maxT;
  for (let i = 0; k <= end && i < 600; i++) {
    out.push(k);
    k = addGrain(k, g, 1);
  }
  return out;
}

function periodsModel(ctx: DrillCtx): PeriodsModel {
  const d = ctx.spec;
  const g = d.grain;
  const P = ctx.period;
  let keys: number[];
  let highlight = (_k: number) => false;
  let zoomLabel: string | null = null;
  let mode: "root" | "zoom" | "focus" = "root";
  if (P && P.grain && GRAIN_RANK[P.grain] > GRAIN_RANK[g]) {
    // Zoom : la période et la précédente (contexte), au pas plus fin
    mode = "zoom";
    const pStart = P.start!;
    const pEnd = addGrain(pStart, P.grain, 1);
    const ctxStart = Math.max(floorGrain(ctx.minT, g), addGrain(pStart, P.grain, -1));
    keys = bucketsOf(ctx, g, ctxStart, pEnd - 1);
    highlight = (k) => k >= pStart && k < pEnd;
    zoomLabel = grainLabel(pStart, P.grain);
  } else {
    keys = bucketsOf(ctx, g);
    if (P && P.grain === g) {
      mode = "focus";
      highlight = (k) => k === P.start;
    }
  }
  const bars: PeriodBar[] = keys.map((k) => {
    const s = sumIn(ctx, k, addGrain(k, g, 1));
    const t = tickLabel(k, g);
    return { key: k, tick: t.tick, year: t.year, label: grainLabel(k, g), value: s.v, count: s.n, highlight: highlight(k), partial: isPartial(ctx, k, g), ref: null, refCount: null };
  });
  let focus: number | null = null;
  let focusKind: PeriodsModel["focusKind"] = null;
  let refLabel = "";
  if (mode === "root") {
    // Décrochage : la plus forte baisse vs la période précédente (périodes complètes)
    let best = 0;
    for (let i = 1; i < bars.length; i++) {
      const a = bars[i - 1]!;
      const b = bars[i]!;
      if (a.partial || b.partial || a.value <= 0) continue;
      const ch = b.value / a.value - 1;
      if (ch < best) {
        best = ch;
        focus = i;
      }
    }
    if (focus != null) {
      const p = bars[focus - 1]!;
      bars[focus]!.ref = p.value;
      bars[focus]!.refCount = p.count;
      refLabel = p.label;
      focusKind = "standout";
    }
  } else {
    for (const b of bars) {
      if (!b.highlight) continue;
      const tr = trailing(ctx, b.key, g, d.compare);
      if (tr) {
        b.ref = tr.v;
        b.refCount = tr.n;
      }
    }
    if (mode === "focus") {
      focus = bars.findIndex((b) => b.highlight);
      if (focus < 0) focus = null;
      focusKind = focus != null ? "focus" : null;
    } else {
      let best = -0.08;
      bars.forEach((b, i) => {
        if (!b.highlight || b.partial || b.ref == null || b.ref <= 0) return;
        const r = b.value / b.ref - 1;
        if (r < best) {
          best = r;
          focus = i;
        }
      });
      focusKind = focus != null ? "standout" : null;
    }
    if (focus != null) {
      const tr = trailing(ctx, bars[focus]!.key, g, d.compare);
      if (tr) refLabel = `moy. ${windowLabel(tr.from, tr.to, g)}`;
    }
  }
  return { view: "periods", grain: g, bars, focus, focusKind, refLabel, zoomLabel };
}

function monthModel(ctx: DrillCtx): MonthModel | null {
  const P = ctx.period;
  if (!P || !P.grain || P.start == null) return null;
  const g = P.grain;
  const start = P.start;
  const end = addGrain(start, g, 1);
  const days = Math.round((end - start) / DAY);
  const daily = (a: number, n: number) => {
    const out = new Array<number>(n).fill(0);
    for (let i = 0; i < ctx.rows.length; i++) {
      const t = ctx.ts[i]!;
      const k = Math.floor((t - a) / DAY);
      if (k >= 0 && k < n) out[k] = out[k]! + ctx.vs[i]!;
    }
    return out;
  };
  const cum = (arr: number[]) => {
    let s = 0;
    return arr.map((v) => (s += v));
  };
  const curDaily = cum(daily(start, days));
  const lastDay = Math.floor((ctx.maxT - start) / DAY);
  const cur = curDaily.map((v, i) => (i <= lastDay ? v : null));
  const refs: number[][] = [];
  const first = floorGrain(ctx.minT, g);
  let from = start;
  for (let i = 1; i <= ctx.spec.compare; i++) {
    const a = addGrain(start, g, -i);
    if (a < first) break;
    const n = Math.round((addGrain(a, g, 1) - a) / DAY);
    const c = cum(daily(a, n));
    // Même longueur que la période focalisée (dernière valeur prolongée)
    refs.push(Array.from({ length: days }, (_, k) => c[Math.min(k, n - 1)]!));
    from = a;
  }
  const ref = Array.from({ length: days }, (_, k) => (refs.length ? refs.reduce((s, r) => s + r[k]!, 0) / refs.length : 0));
  const s = sumIn(ctx, start, end);
  const tr = trailing(ctx, start, g, ctx.spec.compare);
  const cuts = [0, 7, 14, 21, days];
  const weeks = cuts.slice(0, -1).map((a, i) => {
    const b = cuts[i + 1]!;
    const cv = (curDaily[b - 1] ?? 0) - (a ? curDaily[a - 1]! : 0);
    const rv = ref[b - 1]! - (a ? ref[a - 1]! : 0);
    return { from: a + 1, to: b, cur: cv, ref: rv };
  });
  return {
    view: "month",
    grain: g,
    start,
    days,
    cur,
    ref,
    refLabel: refs.length ? `moy. ${windowLabel(from, addGrain(start, g, -1), g)}` : "",
    curTotal: s.v,
    refTotal: tr?.v ?? 0,
    curCount: s.n,
    refCount: tr?.n ?? 0,
    weeks,
  };
}

function catValue(r: Row, f: string): string {
  const v = r[f];
  return v == null || v === "" ? "(vide)" : String(v);
}

function breakdownModel(ctx: DrillCtx, field: string, view: "breakdown" | "map"): BreakdownModel {
  const P = ctx.period;
  const g = P?.grain ?? null;
  const a = P?.start ?? -Infinity;
  const b = P && g ? addGrain(P.start!, g, 1) : Infinity;
  const k = ctx.spec.compare;
  const stats = new Map<string, CatStat>();
  const get = (key: string) => {
    let s = stats.get(key);
    if (!s) stats.set(key, (s = { key, value: 0, count: 0, ref: P ? 0 : null, refCount: P ? 0 : null, delta: null, next: null }));
    return s;
  };
  // Fenêtre de référence et période suivante (dans l'étendue des données)
  let refFrom = a;
  let used = 0;
  const first = g ? floorGrain(ctx.minT, g) : -Infinity;
  if (P && g) {
    for (let i = 1; i <= k; i++) {
      const x = addGrain(a, g, -i);
      if (x < first) break;
      refFrom = x;
      used++;
    }
  }
  const nextStart = b;
  const nextEnd = g ? addGrain(b, g, 1) : Infinity;
  const hasNext = !!g && !isPartial(ctx, nextStart, g) && nextStart <= ctx.maxT;
  for (let i = 0; i < ctx.rows.length; i++) {
    const t = ctx.ts[i]!;
    const r = ctx.rows[i]!;
    if (t >= a && t < b) {
      const s = get(catValue(r, field));
      s.value += ctx.vs[i]!;
      s.count++;
    } else if (used && t >= refFrom && t < a) {
      const s = get(catValue(r, field));
      s.ref! += ctx.vs[i]! / used;
      s.refCount! += 1 / used;
    } else if (hasNext && t >= nextStart && t < nextEnd) {
      const s = get(catValue(r, field));
      s.next ??= { value: 0, count: 0 };
      s.next.value += ctx.vs[i]!;
      s.next.count++;
    }
  }
  let list = [...stats.values()];
  if (!used) list.forEach((s) => ((s.ref = null), (s.refCount = null)));
  if (hasNext) list.forEach((s) => (s.next ??= { value: 0, count: 0 }));
  list.forEach((s) => (s.delta = s.ref != null ? s.value - s.ref : null));
  // Catégories de la période ou de sa référence seulement (pas celles de la seule période suivante)
  list = list.filter((s) => s.count > 0 || (s.refCount ?? 0) > 0.001);
  list.sort((x, y) => (y.ref ?? y.value) - (x.ref ?? x.value) || y.value - x.value);
  if (view === "breakdown" && list.length > 14) {
    const keep = list.slice(0, 13);
    const rest = list.slice(13);
    const o: CatStat = { key: `Autres (${rest.length})`, value: 0, count: 0, ref: used ? 0 : null, refCount: used ? 0 : null, delta: null, next: hasNext ? { value: 0, count: 0 } : null };
    for (const s of rest) {
      o.value += s.value;
      o.count += s.count;
      if (o.ref != null) o.ref += s.ref ?? 0;
      if (o.refCount != null) o.refCount += s.refCount ?? 0;
      if (o.next && s.next) (o.next.value += s.next.value), (o.next.count += s.next.count);
    }
    o.delta = o.ref != null ? o.value - o.ref : null;
    list = [...keep, o];
  }
  const unmatched: string[] = [];
  if (view === "map") for (const s of list) {
    s.nuts = regionNuts(s.key);
    if (!s.nuts) unmatched.push(s.key);
  }
  const total = list.reduce((x, s) => x + s.value, 0);
  const count = list.reduce((x, s) => x + s.count, 0);
  const refTotal = used ? list.reduce((x, s) => x + (s.ref ?? 0), 0) : null;
  const refCount = used ? list.reduce((x, s) => x + (s.refCount ?? 0), 0) : null;
  const delta = refTotal != null ? total - refTotal : null;
  let standout: number | null = null;
  let share: number | null = null;
  if (delta != null && delta !== 0) {
    const sign = Math.sign(delta);
    let best = 0;
    list.forEach((s, i) => {
      const dd = (s.delta ?? 0) * sign;
      if (dd > best) {
        best = dd;
        standout = i;
      }
    });
    if (standout != null) share = (list[standout]!.delta ?? 0) / delta;
  } else if (refTotal == null && list.length) {
    standout = list.reduce((bi, s, i) => (s.value > list[bi]!.value ? i : bi), 0);
  }
  return {
    view,
    field,
    stats: list,
    total,
    count,
    refTotal,
    refCount,
    delta,
    periodLabel: P && g ? grainLabel(P.start!, g) : null,
    refLabel: used && g ? `moy. ${windowLabel(refFrom, addGrain(a, g, -1), g)}` : "",
    nextLabel: hasNext && g ? grainLabel(nextStart, g) : null,
    standout,
    share,
    unmatched,
  };
}

function historyModel(ctx: DrillCtx, field: string): HistoryModel {
  const P = ctx.period;
  const g: DrillGrain = P?.grain && P.grain !== "year" ? (P.grain === "quarter" ? "quarter" : P.grain) : "month";
  const keys = bucketsOf(ctx, g);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const by = new Map<string, HistorySeries>();
  for (let i = 0; i < ctx.rows.length; i++) {
    const key = catValue(ctx.rows[i]!, field);
    let s = by.get(key);
    if (!s) by.set(key, (s = { key, values: new Array(keys.length).fill(0), counts: new Array(keys.length).fill(0), focusRatio: null, focusRef: null }));
    const j = idx.get(floorGrain(ctx.ts[i]!, g));
    if (j == null) continue;
    s.values[j] += ctx.vs[i]!;
    s.counts[j]++;
  }
  let series = [...by.values()].sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0));
  if (series.length > 8) series = series.slice(0, 8);
  const focus = P?.start != null && P.grain === g ? idx.get(P.start) ?? null : null;
  const k = ctx.spec.compare;
  const trail = (vals: number[], j: number) => {
    const xs = vals.slice(Math.max(0, j - k), j);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  let standout: number | null = null;
  if (focus != null) {
    let best = Infinity;
    series.forEach((s, i) => {
      const r = trail(s.values, focus);
      s.focusRef = r;
      s.focusRatio = r && r > 0 ? s.values[focus]! / r - 1 : null;
      if (s.focusRatio != null && s.focusRatio < best) {
        best = s.focusRatio;
        standout = i;
      }
    });
  }
  for (const s of series) s.nuts = regionNuts(s.key);
  const partial = keys.map((kk) => isPartial(ctx, kk, g));
  // Saisonnalité : mois calendaire bas dans toutes les séries (hors focus), ratio vs les k mois précédents
  let seasonal: HistoryModel["seasonal"] = null;
  if (g === "month" && series.length >= 2) {
    for (let m = 0; m < 12; m++) {
      const occ = keys.map((kk, j) => ({ kk, j })).filter((o) => new Date(o.kk).getUTCMonth() === m && o.j >= k && o.j !== focus && !partial[o.j]);
      if (!occ.length) continue;
      const ratios: number[] = [];
      let all = true;
      for (const s of series) {
        for (const o of occ) {
          const r = trail(s.values, o.j);
          if (!r) continue;
          const x = s.values[o.j]! / r - 1;
          ratios.push(x);
          if (x > -0.15) all = false;
        }
      }
      if (all && ratios.length) {
        const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        if (!seasonal || ratio < seasonal.ratio) seasonal = { month: m, ratio, keys: occ.map((o) => o.kk) };
      }
    }
  }
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values));
  let refLabel = "";
  if (focus != null && P?.start != null) refLabel = `moy. ${windowLabel(addGrain(P.start, g, -Math.min(k, focus)), addGrain(P.start, g, -1), g)}`;
  return { view: "history", field, grain: g, keys, ticks: keys.map((kk) => tickLabel(kk, g)), partial, series, focus, max, standout, refLabel, seasonal };
}

/* ------------------------------------------------------------------ versions (réel → budget) */

const MONTHS_TICK = MONTHS_SHORT;

/** Hiérarchie de la cascade : niveaux déclarés, sinon devinés (ligne métier → compte). */
export function levelsOf(d: DrillSpec, ds: Dataset): string[] {
  const lv = d.levels.filter((f) => columnOf(ds, f));
  return lv.length ? lv : guessLevels(ds, d);
}

/** Champ de la cascade courante : `by` s'il n'est pas déjà filtré, sinon le premier niveau libre. */
function bridgeField(ctx: DrillCtx): string | null {
  const used = new Set(ctx.cats.map((c) => c.field));
  const d = ctx.spec;
  if (d.by && columnOf(ctx.eff, d.by) && !used.has(d.by) && d.by !== d.version && d.by !== d.nature) return d.by;
  return levelsOf(d, ctx.eff).find((f) => !used.has(f)) ?? null;
}

function versionSums(ctx: DrillCtx, keyOf: (r: Row, i: number) => string | null) {
  const out = new Map<string, { from: number; to: number; revF: number; revT: number; costF: number; costT: number; nF: number; nT: number }>();
  for (let i = 0; i < ctx.rows.length; i++) {
    const k = keyOf(ctx.rows[i]!, i);
    if (k == null) continue;
    let e = out.get(k);
    if (!e) out.set(k, (e = { from: 0, to: 0, revF: 0, revT: 0, costF: 0, costT: 0, nF: 0, nT: 0 }));
    const v = ctx.vs[i]!;
    const isCost = ctx.cost?.[i] === 1;
    if (ctx.ver![i] === 1) {
      e.to += v;
      e.nT++;
      if (isCost) e.costT -= v;
      else e.revT += v;
    } else {
      e.from += v;
      e.nF++;
      if (isCost) e.costF -= v;
      else e.revF += v;
    }
  }
  return out;
}

function bridgeModel(ctx: DrillCtx, field: string): BridgeModel {
  const d = ctx.spec;
  const sums = versionSums(ctx, (r) => catValue(r, field));
  // Groupes (Revenus / Coûts) quand chaque facteur relève d'une seule nature
  let groupOf: Map<string, string> | null = null;
  const used = new Set(ctx.cats.map((c) => c.field));
  if (ctx.nature && !used.has(ctx.nature.name)) {
    const g = new Map<string, Set<string>>();
    for (const r of ctx.rows) {
      const k = catValue(r, field);
      let set = g.get(k);
      if (!set) g.set(k, (set = new Set()));
      set.add(String(r[ctx.nature.name] ?? ""));
    }
    if ([...g.values()].every((x) => x.size === 1) && new Set([...g.values()].map((x) => [...x][0])).size > 1) groupOf = new Map([...g].map(([k, v]) => [k, [...v][0]!]));
  }
  let deltas = [...sums].map(([key, e]) => ({ key, e, delta: e.to - e.from, group: groupOf?.get(key) ?? null }));
  const byImpact = (a: { delta: number; key: string }, b: { delta: number; key: string }) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key, "fr");
  if (d.sortByImpact) deltas.sort(byImpact);
  else deltas.sort((a, b) => a.key.localeCompare(b.key, "fr"));
  if (deltas.length > 12) {
    const keep = deltas.slice(0, 11);
    const rest = deltas.slice(11);
    const e = { from: 0, to: 0, revF: 0, revT: 0, costF: 0, costT: 0, nF: 0, nT: 0 };
    for (const x of rest) for (const k of Object.keys(e) as (keyof typeof e)[]) e[k] += x.e[k];
    deltas = [...keep, { key: `Autres (${rest.length})`, e, delta: e.to - e.from, group: null }];
  }
  const groups: (string | null)[] = groupOf ? [...new Set(deltas.map((x) => x.group))].sort((a, b) => Number(isCostLabel(a)) - Number(isCostLabel(b))) : [null];
  const start = [...sums.values()].reduce((a, e) => a + e.from, 0);
  const end = [...sums.values()].reduce((a, e) => a + e.to, 0);
  const scope = ctx.cats.map((c) => c.value).join(" · ");
  const items: BridgeItem[] = [];
  const base = { group: null, from: 0, to: 0, rev: 0, cost: 0 };
  items.push({ ...base, key: "__start", kind: "start", label: scope ? `${scope} · ${ctx.fromLabel}` : ctx.fromLabel, value: start, y0: 0, y1: start });
  let run = start;
  groups.forEach((gname, gi) => {
    for (const x of deltas.filter((y) => y.group === gname)) {
      items.push({ key: x.key, kind: "delta", label: x.key, value: x.delta, y0: run, y1: run + x.delta, group: gname, from: x.e.from, to: x.e.to, rev: x.e.revT - x.e.revF, cost: x.e.costT - x.e.costF });
      run += x.delta;
    }
    if (gname && gi < groups.length - 1) items.push({ ...base, key: `__sub-${gi}`, kind: "subtotal", label: `Sous-total ${gname.toLocaleLowerCase("fr-FR")}`, value: run, y0: 0, y1: run, group: gname });
  });
  items.push({ ...base, key: "__end", kind: "end", label: scope ? `${scope} · ${ctx.toLabel}` : ctx.toLabel, value: end, y0: 0, y1: end });
  let topPos: number | null = null;
  let topNeg: number | null = null;
  items.forEach((it, i) => {
    if (it.kind !== "delta" || it.key.startsWith("Autres (")) return;
    if (it.value > 0 && (topPos == null || it.value > items[topPos]!.value)) topPos = i;
    if (it.value < 0 && (topNeg == null || it.value < items[topNeg]!.value)) topNeg = i;
  });
  const rev = ctx.cost ? [...sums.values()].reduce((a, e) => a + e.revT - e.revF, 0) : null;
  const cst = ctx.cost ? [...sums.values()].reduce((a, e) => a + e.costT - e.costF, 0) : null;
  return { view: "bridge", field, groupField: groupOf ? ctx.nature!.name : null, items, fromLabel: ctx.fromLabel, toLabel: ctx.toLabel, start, end, delta: end - start, revDelta: rev, costDelta: cst, topPos, topNeg, drillable: true };
}

function compareModel(ctx: DrillCtx): CompareModel {
  const sums = versionSums(ctx, (_r, i) => String(new Date(ctx.ts[i]!).getUTCMonth()));
  const allCost = !!ctx.cost && ctx.rows.length > 0 && ctx.cost.every((c) => c === 1);
  const sign = allCost ? -1 : 1;
  const months: CompareMonth[] = Array.from({ length: 12 }, (_, m) => {
    const e = sums.get(String(m));
    const from = e && e.nF ? e.from * sign : null;
    const to = e && e.nT ? e.to * sign : null;
    return { key: m, tick: MONTHS_TICK[m]!, label: MONTHS_LONG[m]!, from, to, delta: from != null && to != null ? to - from : null };
  });
  const fromTotal = months.reduce((a, x) => a + (x.from ?? 0), 0);
  const toTotal = months.reduce((a, x) => a + (x.to ?? 0), 0);
  const dl = months.map((x) => x.delta ?? 0);
  const h1 = dl.slice(0, 6).reduce((a, b) => a + b, 0);
  const h2 = dl.slice(6).reduce((a, b) => a + b, 0);
  // Rupture : saut d'écart le plus net, suivi d'écarts de même signe nettement plus forts qu'avant
  let breakAt: number | null = null;
  let best = 0;
  for (let k = 1; k < 12; k++) {
    const jump = Math.abs(dl[k]! - dl[k - 1]!);
    const after = dl.slice(k);
    const before = dl.slice(0, k);
    const sameSign = after.every((x) => Math.sign(x) === Math.sign(dl[k]!) && x !== 0);
    const mA = after.reduce((a, b) => a + Math.abs(b), 0) / after.length;
    const mB = before.reduce((a, b) => a + Math.abs(b), 0) / before.length;
    const scale = Math.max(1e-9, Math.abs(fromTotal) / 12);
    if (sameSign && mA > 2 * mB && mA > 0.15 * scale && jump > best) {
      best = jump;
      breakAt = k;
    }
  }
  return { view: "compare", months, fromLabel: ctx.fromLabel, toLabel: ctx.toLabel, fromTotal, toTotal, delta: toTotal - fromTotal, costOnly: allCost, h1, h2, breakAt };
}

/** Carte / détail en mode versions : valeur = version « to », référence = version « from ». */
function versionBreakdown(ctx: DrillCtx, field: string, view: "breakdown" | "map"): BreakdownModel {
  const sums = versionSums(ctx, (r) => catValue(r, field));
  let list: CatStat[] = [...sums].map(([key, e]) => ({ key, value: e.to, count: e.nT, ref: e.from, refCount: e.nF, delta: e.to - e.from, next: null }));
  list.sort((a, b) => (b.ref ?? 0) - (a.ref ?? 0) || b.value - a.value);
  if (view === "breakdown" && list.length > 14) {
    const keep = list.slice(0, 13);
    const rest = list.slice(13);
    const o: CatStat = { key: `Autres (${rest.length})`, value: 0, count: 0, ref: 0, refCount: 0, delta: 0, next: null };
    for (const x of rest) (o.value += x.value), (o.count += x.count), (o.ref! += x.ref ?? 0), (o.refCount! += x.refCount ?? 0);
    o.delta = o.value - (o.ref ?? 0);
    list = [...keep, o];
  }
  const unmatched: string[] = [];
  if (view === "map")
    for (const x of list) {
      x.nuts = regionNuts(x.key);
      if (!x.nuts) unmatched.push(x.key);
    }
  const total = list.reduce((a, x) => a + x.value, 0);
  const refTotal = list.reduce((a, x) => a + (x.ref ?? 0), 0);
  const delta = total - refTotal;
  let standout: number | null = null;
  let best = 0;
  const sign = Math.sign(delta) || -1;
  list.forEach((x, i) => {
    const dd = (x.delta ?? 0) * sign;
    if (dd > best) (best = dd), (standout = i);
  });
  // Écart total faible : la catégorie qui pèse le plus (en valeur absolue)
  if (standout == null) list.forEach((x, i) => Math.abs(x.delta ?? 0) > best && ((best = Math.abs(x.delta ?? 0)), (standout = i)));
  return {
    view,
    field,
    stats: list,
    total,
    count: list.reduce((a, x) => a + x.count, 0),
    refTotal,
    refCount: list.reduce((a, x) => a + (x.refCount ?? 0), 0),
    delta,
    periodLabel: ctx.toLabel,
    refLabel: ctx.fromLabel,
    nextLabel: null,
    standout,
    share: standout != null && delta ? (list[standout]!.delta ?? 0) / delta : null,
    unmatched,
    versions: true,
  };
}

const QUARTER_TICK = ["T1", "T2", "T3", "T4"];

/** Tableau croisé : X × séries, somme / moyenne / nombre / écart entre versions. */
function pivotModel(ctx: DrillCtx): PivotModel | null {
  const d = ctx.spec;
  const pv = d.pivot;
  const x = pv.x ?? (ctx.ver ? bridgeField(ctx) : null) ?? "@month";
  const isTime = x.startsWith("@");
  if (!isTime && !columnOf(ctx.eff, x)) return null;
  const vm = !!ctx.ver;
  const isDelta = pv.agg === "delta" && vm;
  const agg = pv.agg === "delta" && !vm ? "sum" : pv.agg;
  let seriesField = pv.series && (pv.series === "@version" ? vm : columnOf(ctx.eff, pv.series)) && pv.series !== x ? pv.series : null;
  if (vm && !isDelta && !seriesField) seriesField = "@version";
  const onlyTo = vm && !isDelta && seriesField !== "@version";
  const grain: DrillGrain = x === "@quarter" ? "quarter" : x === "@year" ? "year" : "month";
  const xKey = (r: Row, i: number): string => {
    if (!isTime) return catValue(r, x);
    const t = ctx.ts[i]!;
    if (vm) return grain === "quarter" ? `q${Math.floor(new Date(t).getUTCMonth() / 3)}` : grain === "year" ? "y" : `m${String(new Date(t).getUTCMonth()).padStart(2, "0")}`;
    return String(floorGrain(t, grain));
  };
  const sKey = (r: Row, i: number): string => (seriesField === "@version" ? (ctx.ver![i] === 1 ? ctx.toLabel : ctx.fromLabel) : seriesField ? catValue(r, seriesField) : "__total");
  const cells = new Map<string, Map<string, { v: number; n: number }>>();
  const xTotals = new Map<string, number>();
  const sTotals = new Map<string, number>();
  for (let i = 0; i < ctx.rows.length; i++) {
    if (onlyTo && ctx.ver![i] !== 1) continue;
    const r = ctx.rows[i]!;
    const xk = xKey(r, i);
    const sk = sKey(r, i);
    const v = isDelta ? (ctx.ver![i] === 1 ? ctx.vs[i]! : -ctx.vs[i]!) : ctx.vs[i]!;
    let row = cells.get(sk);
    if (!row) cells.set(sk, (row = new Map()));
    const c = row.get(xk) ?? { v: 0, n: 0 };
    c.v += v;
    c.n++;
    row.set(xk, c);
    xTotals.set(xk, (xTotals.get(xk) ?? 0) + v);
    sTotals.set(sk, (sTotals.get(sk) ?? 0) + v);
  }
  let keys = [...xTotals.keys()];
  if (isTime) keys.sort((a, b) => (vm ? a.localeCompare(b) : Number(a) - Number(b)));
  else keys.sort((a, b) => Math.abs(xTotals.get(b)!) - Math.abs(xTotals.get(a)!));
  if (!isTime && keys.length > 12) keys = keys.slice(0, 12);
  const labelOf = (k: string): string => {
    if (!isTime) return k;
    if (vm) return k === "y" ? `${ctx.fromLabel} → ${ctx.toLabel}` : k.startsWith("q") ? QUARTER_TICK[Number(k.slice(1))]! : MONTHS_TICK[Number(k.slice(1))]!;
    const t = tickLabel(Number(k), grain);
    return grain === "year" ? t.tick : `${t.tick} ${t.year.slice(-2)}`;
  };
  let sk = [...sTotals.keys()];
  if (seriesField === "@version") sk.sort((a) => (a === ctx.fromLabel ? -1 : 1));
  else sk.sort((a, b) => Math.abs(sTotals.get(b)!) - Math.abs(sTotals.get(a)!));
  if (sk.length > 8) sk = sk.slice(0, 8);
  const series: PivotSeries[] = sk.map((s) => {
    const row = cells.get(s)!;
    const values = keys.map((k) => {
      const c = row.get(k);
      if (!c) return isDelta ? 0 : null;
      return agg === "mean" ? c.v / c.n : agg === "count" ? c.n : c.v;
    });
    return { key: s === "__total" ? (isDelta ? `Écart ${ctx.toLabel} vs ${ctx.fromLabel}` : d.label || ctx.measure?.name || "Total") : s, values, total: values.reduce<number>((a, v) => a + (v ?? 0), 0) };
  });
  const xLabel = x === "@month" ? "mois" : x === "@quarter" ? "trimestre" : x === "@year" ? "année" : x;
  return { view: "pivot", chart: pv.chart === "line" ? "line" : "bar", x, xLabel, xIsTime: isTime, keys: keys.map(labelOf), catValues: keys.map((k) => (isTime ? null : k)), series, seriesField: seriesField === "@version" ? "@version" : seriesField, agg: isDelta ? "delta" : agg, isDelta, versionNote: onlyTo ? ctx.toLabel : null };
}

/* ------------------------------------------------------------------ colonnes (finance) */

/** Colonne de versions (Réel / Budget / Prévision / N-1) et ses deux valeurs à comparer. */
export function guessVersion(ds: Dataset): { field: string; from: string; to: string } | null {
  for (const c of ds.columns) {
    if (c.type !== "category" && c.type !== "text") continue;
    if (c.cardinality < 2 || c.cardinality > 8) continue;
    const p = versionPair(ds, c.name, true);
    if (p) return { field: c.name, ...p };
  }
  return null;
}

/** Les deux valeurs à comparer d'une colonne de versions : le réel le plus récent → le budget (ou la prévision) le plus récent. */
export function versionPair(ds: Dataset, field: string, strict = false): { from: string; to: string } | null {
  const c = columnOf(ds, field);
  if (!c) return null;
  const vals = [...new Set(ds.rows.map((r) => r[c.name]).filter((v): v is string => typeof v === "string" && v !== ""))];
  const yr = (v: string) => Number(v.match(/(19|20)\d{2}/)?.[0] ?? 0);
  const actual = vals.filter((v) => /r[ée]el|r[ée]alis|actual|\bN-1\b/i.test(v)).sort((a, b) => yr(a) - yr(b));
  const plan = vals.filter((v) => /budget|pr[ée]vision|forecast|plan|objectif/i.test(v)).sort((a, b) => yr(b) - yr(a));
  if (actual.length && plan.length) {
    if (strict && !/version|sc[ée]nario|type|donn/i.test(norm(c.name)) && vals.length > 4) return null;
    return { from: actual[actual.length - 1]!, to: plan[0]! };
  }
  if (strict || vals.length < 2) return null;
  // Sans libellé reconnu : ordre chronologique des années, sinon alphabétique
  const sorted = [...vals].sort((a, b) => yr(a) - yr(b) || a.localeCompare(b, "fr"));
  return { from: sorted[0]!, to: sorted[sorted.length - 1]! };
}

/** Colonne « Revenus / Coûts ». */
export function guessNature(ds: Dataset): string | null {
  const c = ds.columns.find((x) => {
    if (x.type !== "category" && x.type !== "text") return false;
    if (x.cardinality < 2 || x.cardinality > 6) return false;
    const vals = new Set(ds.rows.map((r) => r[x.name]));
    return [...vals].some(isCostLabel) && [...vals].some((v) => typeof v === "string" && /revenu|produit|recette|vente|chiffre|income|revenue/i.test(v));
  });
  return c?.name ?? null;
}

/** Niveaux de la cascade : ligne métier (ou segment, activité…) puis compte (ou poste…). */
export function guessLevels(ds: Dataset, d?: Partial<DrillSpec>): string[] {
  const skip = new Set([d?.version, d?.nature, d?.date].filter(Boolean) as string[]);
  const cands = ds.columns.filter((c) => (c.type === "category" || (c.type === "text" && c.cardinality <= 60)) && c.cardinality >= 2 && c.cardinality <= 60 && !c.idLike && !skip.has(c.name) && !/version|sc[ée]nario/i.test(c.name));
  const vals = (c: Column) => new Set(ds.rows.map((r) => r[c.name]));
  const notGeo = cands.filter((c) => !/r[ée]gion|pays|country|entit|soci[ée]t|ville|site/i.test(norm(c.name)) && regionCoverage(vals(c)).share < 0.6 && !(vals(c).size <= 6 && [...vals(c)].some(isCostLabel)));
  const line = notGeo.find((c) => /ligne|metier|activit|segment|business|\bbu\b|division|famille|produit|offre/.test(norm(c.name)));
  const acct = notGeo.find((c) => c !== line && /compte|poste|rubrique|account|libell|sous|item|article/.test(norm(c.name)));
  const out = [line, acct].filter(Boolean).map((c) => c!.name);
  if (out.length) return out;
  return [...notGeo].sort((a, b) => a.cardinality - b.cardinality).slice(0, 2).map((c) => c.name);
}

/** Modèle de la vue courante. */
export function buildDrillModel(spec: Pick<ChartSpec, "drill" | "transform">, ds: Dataset | null): { model: DrillModel | null; ctx: DrillCtx | null; error: string | null } {
  const { ctx, error } = drillCtx(spec, ds);
  if (!ctx) return { model: null, ctx: null, error };
  const d = spec.drill;
  const by = d.by && columnOf(ctx.eff, d.by) ? d.by : null;
  let model: DrillModel | null = null;
  if (ctx.ver) {
    // Comparaison de versions : cascade, mois, carte / détail (écart par catégorie), tableau croisé
    const view = d.view === "periods" || d.view === "month" || d.view === "history" ? "compare" : d.view;
    if (view === "bridge") {
      const field = bridgeField(ctx);
      if (!field) return { model: null, ctx, error: "Cascade : choisissez une colonne de facteurs (ligne métier, compte…)." };
      model = bridgeModel(ctx, field);
    } else if (view === "compare") model = compareModel(ctx);
    else if (view === "pivot") {
      const pm = pivotModel(ctx);
      if (!pm) return { model: null, ctx, error: "Tableau croisé : choisissez l'axe X." };
      model = pm;
    } else {
      if (!by) return { model: null, ctx, error: "Choisissez une colonne à détailler." };
      model = versionBreakdown(ctx, by, view);
      if (view === "map" && (model as BreakdownModel).stats.every((x) => !x.nuts)) return { model: null, ctx, error: `Carte : aucune valeur de « ${by} » n'est reconnue comme région FR · BE.` };
    }
    return { model, ctx, error: null };
  }
  if (d.view === "pivot") {
    const pm = pivotModel(ctx);
    if (!pm) return { model: null, ctx, error: "Tableau croisé : choisissez l'axe X." };
    return { model: pm, ctx, error: null };
  }
  if (d.view === "bridge" || d.view === "compare") return { model: null, ctx, error: "Cascade : définissez deux versions à comparer (colonne version, de… à…)." };
  switch (d.view) {
    case "month":
      model = monthModel(ctx);
      if (!model) return { model: null, ctx, error: "Choisissez d'abord une période (cliquez sur une barre)." };
      break;
    case "map":
    case "breakdown":
      if (!by) return { model: null, ctx, error: d.view === "map" ? "Carte : aucune colonne de régions reconnue (Bruxelles, Wallonie, Hauts-de-France…)." : "Choisissez une colonne à détailler." };
      model = breakdownModel(ctx, by, d.view);
      if (d.view === "map" && (model as BreakdownModel).stats.every((s) => !s.nuts)) return { model: null, ctx, error: `Carte : aucune valeur de « ${by} » n'est reconnue comme région FR · BE.` };
      break;
    case "history":
      if (!by) return { model: null, ctx, error: "Choisissez une colonne pour l'historique." };
      model = historyModel(ctx, by);
      break;
    default:
      model = periodsModel(ctx);
  }
  if (model.view === "periods" && !model.bars.length) return { model: null, ctx, error: "Aucune période exploitable." };
  return { model, ctx, error: null };
}

/* ------------------------------------------------------------------ navigation */

/** Pas de départ : trimestres dès 9 mois de données, sinon mois. */
export function rootGrain(ds: Dataset, date: string): DrillGrain {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of ds.rows) {
    const t = r[date];
    if (typeof t !== "number") continue;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  const months = (hi - lo) / (30.4 * DAY);
  return months > 48 ? "year" : months >= 9 ? "quarter" : months >= 2 ? "month" : "week";
}

/** Exploration neuve sur un jeu de données (colonnes devinées). */
export function initDrill(ds: Dataset, prev?: Partial<DrillSpec>): DrillSpec {
  const date = prev?.date && columnOf(ds, prev.date)?.type === "date" ? prev.date : guessDrillDate(ds);
  const measure = prev?.measure && columnOf(ds, prev.measure)?.type === "number" ? prev.measure : guessDrillMeasure(ds);
  const base: DrillSpec = {
    date,
    measure,
    label: prev?.label ?? "",
    path: [],
    view: "periods",
    grain: date ? rootGrain(ds, date) : "month",
    by: guessRegionField(ds) ?? guessPersonField(ds),
    compare: prev?.compare ?? 3,
    version: null,
    from: null,
    to: null,
    sortByImpact: prev?.sortByImpact ?? true,
    nature: null,
    levels: [],
    pivot: { x: null, series: null, agg: "sum", chart: "bar", ...(prev?.pivot ?? {}) },
  };
  // Comparaison de versions (Réel → Budget) : cascade par ligne métier
  const keep = prev?.version && prev.from && prev.to && columnOf(ds, prev.version) && ds.rows.some((r) => r[prev.version!] === prev.from) && ds.rows.some((r) => r[prev.version!] === prev.to);
  const gv = keep ? { field: prev!.version!, from: prev!.from!, to: prev!.to! } : guessVersion(ds);
  if (!gv) return base;
  const nature = prev?.nature && columnOf(ds, prev.nature) ? prev.nature : guessNature(ds);
  const d0: DrillSpec = { ...base, version: gv.field, from: gv.from, to: gv.to, nature, pivot: { ...base.pivot, agg: prev?.pivot?.agg ?? "delta" } };
  const lv = (prev?.levels ?? []).filter((f) => columnOf(ds, f));
  const levels = lv.length ? lv : guessLevels(ds, d0);
  return { ...d0, levels, view: "bridge", by: levels[0] ?? null };
}

/** Vue par défaut quand le chemin se termine par `last`. */
function defaultViewFor(d: DrillSpec, path: DrillStep[], root: DrillGrain): Pick<DrillSpec, "view" | "grain"> & Partial<Pick<DrillSpec, "by">> {
  if (isVersionMode(d)) {
    // Cascade du niveau suivant (ligne métier → compte), puis les mois
    const used = new Set(path.filter((x) => x.kind === "cat").map((x) => x.field));
    const next = d.levels.find((f) => !used.has(f));
    return next ? { view: "bridge", grain: d.grain, by: next } : { view: "compare", grain: d.grain };
  }
  const last = path[path.length - 1];
  const P = [...path].reverse().find((s) => s.kind === "period");
  if (!last) return { view: "periods", grain: root };
  if (last.kind === "period" && last.grain) {
    const finer = FINER[last.grain];
    return finer ? { view: "periods", grain: finer } : { view: "month", grain: last.grain };
  }
  return { view: "periods", grain: P?.grain && !FINER[P.grain] ? P.grain : P?.grain ? FINER[P.grain]! : d.grain };
}

export type DrillTarget = { kind: "period"; start: number; grain: DrillGrain } | { kind: "cat"; field: string; value: string };

/** Clic sur une barre, une région, une catégorie : étape ajoutée au chemin et vue suivante. */
export function drillInto(d: DrillSpec, t: DrillTarget, root: DrillGrain): DrillSpec {
  let path = d.path.slice();
  if (t.kind === "period") {
    const step: DrillStep = { kind: "period", grain: t.grain, start: t.start, field: null, value: null, label: grainLabel(t.start, t.grain, true) };
    const P = [...path].reverse().find((s) => s.kind === "period");
    if (P && P.grain && GRAIN_RANK[P.grain] <= GRAIN_RANK[t.grain]) {
      // Autre période au même pas (historique filtré) : on remplace les étapes « période » en place
      const parent: DrillStep[] = [];
      for (let g = FINER_PARENT[t.grain]; g && GRAIN_RANK[g] <= GRAIN_RANK[root]; g = FINER_PARENT[g]) {
        const s = floorGrain(t.start, g);
        parent.unshift({ kind: "period", grain: g, start: s, field: null, value: null, label: grainLabel(s, g, true) });
      }
      const firstP = path.findIndex((s) => s.kind === "period");
      const cats = path.filter((s) => s.kind === "cat");
      const before = path.slice(0, firstP).filter((s) => s.kind === "cat");
      path = [...before, ...parent, step, ...cats.filter((c) => !before.includes(c))];
      const v = FINER[t.grain] ? { view: "periods" as const, grain: FINER[t.grain]! } : { view: "month" as const, grain: t.grain };
      return { ...d, path, ...v };
    }
    path.push(step);
    return { ...d, path, ...defaultViewFor(d, path, root) };
  }
  path = path.filter((s) => !(s.kind === "cat" && s.field === t.field));
  path.push({ kind: "cat", grain: null, start: null, field: t.field, value: t.value, label: t.value });
  return { ...d, path, ...defaultViewFor(d, path, root) };
}

const FINER_PARENT: Record<DrillGrain, DrillGrain | null> = { week: null, month: "quarter", quarter: "year", year: null };

/** Fil d'Ariane : retour à l'étape `n` (0 = « Tout »). */
export function drillTo(d: DrillSpec, n: number, root: DrillGrain): DrillSpec {
  const path = d.path.slice(0, Math.max(0, n));
  return { ...d, path, ...defaultViewFor(d, path, root) };
}

/** Change de vue (carte, historique, détail par…) sans toucher au chemin. */
export function drillView(d: DrillSpec, view: DrillView, by?: string | null): DrillSpec {
  return { ...d, view, by: by !== undefined ? by : d.by };
}

/** Fil d'Ariane lisible : « Tout › T2 2026 › Juin 2026 › Wallonie ». */
export function drillPathLabels(d: DrillSpec): string[] {
  return ["Tout", ...d.path.map((s) => s.label || (s.kind === "period" && s.start != null && s.grain ? grainLabel(s.start, s.grain, true) : String(s.value ?? "")))];
}

/** Vue « temps » par défaut du niveau courant (barres du grain plus fin, ou mois jour par jour). */
export function drillDefaultView(d: DrillSpec, root: DrillGrain): Pick<DrillSpec, "view" | "grain"> & Partial<Pick<DrillSpec, "by">> {
  return defaultViewFor(d, d.path, root);
}
