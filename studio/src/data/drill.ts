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
  const rows = eff.rows.filter((r) => typeof r[date.name] === "number" && cats.every((c) => String(r[c.field!] ?? "") === c.value));
  const ts = new Float64Array(rows.length);
  const vs = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    ts[i] = r[date.name] as number;
    const v = measure ? r[measure.name] : 1;
    vs[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  return { ctx: { spec: d, date, measure, eff, rows, ts, vs, minT, maxT, period, cats }, error: null };
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
  /** Carte : identifiant NUTS 1 (null si non reconnu). */
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

export type DrillModel = PeriodsModel | MonthModel | BreakdownModel | HistoryModel;

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

/** Modèle de la vue courante. */
export function buildDrillModel(spec: Pick<ChartSpec, "drill" | "transform">, ds: Dataset | null): { model: DrillModel | null; ctx: DrillCtx | null; error: string | null } {
  const { ctx, error } = drillCtx(spec, ds);
  if (!ctx) return { model: null, ctx: null, error };
  const d = spec.drill;
  const by = d.by && columnOf(ctx.eff, d.by) ? d.by : null;
  let model: DrillModel | null = null;
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
  return {
    date,
    measure,
    label: prev?.label ?? "",
    path: [],
    view: "periods",
    grain: date ? rootGrain(ds, date) : "month",
    by: guessRegionField(ds) ?? guessPersonField(ds),
    compare: prev?.compare ?? 3,
    version: prev?.version ?? null,
    from: prev?.from ?? null,
    to: prev?.to ?? null,
    sortByImpact: prev?.sortByImpact ?? true,
  };
}

/** Vue par défaut quand le chemin se termine par `last`. */
function defaultViewFor(d: DrillSpec, path: DrillStep[], root: DrillGrain): Pick<DrillSpec, "view" | "grain"> {
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
export function drillDefaultView(d: DrillSpec, root: DrillGrain): Pick<DrillSpec, "view" | "grain"> {
  return defaultViewFor(d, d.path, root);
}
