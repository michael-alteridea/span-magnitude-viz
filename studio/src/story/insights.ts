/**
 * Détecteurs d'insights déterministes (sans LLM) et analyseurs de récit.
 *
 * Chaque « kind » sait :
 *  - `detect(ctx)` : proposer des specs candidats à partir des rôles de colonnes ;
 *  - `analyze(spec, eff, ctx)` : recalculer, à partir du spec et des données, les chiffres clés,
 *    l'effet (0..1), la couverture (0..1) et les textes (titre affirmatif, commentaires, « pourquoi »).
 * La carte Explorer et le titre du graphique ouvert proviennent donc du même calcul.
 */
import { chartSpecSchema, type ChartSpec, type ChartSpecInput, type NarrativeRole, type UnitKey } from "../spec";
import type { Dataset, Row } from "../data/table";
import { columnOf } from "../data/table";
import { allRows, buildCatModel, bucketDate } from "../data/model";
import { effectiveDataset } from "../data/transform";
import { buildVarianceModel, isFavourable } from "../data/variance";
import { closedValues, detectRoles, distinctValues, regionsMappable, SCENARIO_LABELS, type Roles, type Scenario } from "./roles";
import * as S from "./stats";
import {
  agree,
  capitalize,
  count,
  dayMonthYear,
  formatAmount,
  formatInt,
  formatMeasure,
  formatNumber,
  formatPct,
  formatPoints,
  formatRatio,
  formatSignedMeasure,
  formatSignedPct,
  formatGrowth,
  formatTimes,
  joinList,
  measureLabel,
  monthIndexLong,
  monthYear,
  monthYearLong,
  nounOf,
  partitive,
  plural,
  quarterOf,
} from "./fr";

const DAY = 86400000;

export const INSIGHT_KINDS = [
  "trend",
  "concentration",
  "ranking",
  "seasonality",
  "outlier",
  "variance",
  "pipelineWeighted",
  "pipelineSlipping",
  "pipelineAging",
  "pipelineConversion",
  "pipelineCloseMonth",
  "geo",
  "correlation",
  "film",
  "total",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const KIND_LABELS: Record<InsightKind, string> = {
  trend: "Tendance",
  concentration: "Concentration",
  ranking: "Classement",
  seasonality: "Saisonnalité",
  outlier: "Valeurs atypiques",
  variance: "Écarts",
  pipelineWeighted: "Pipeline pondéré",
  pipelineSlipping: "Affaires en retard",
  pipelineAging: "Ancienneté",
  pipelineConversion: "Transformation",
  pipelineCloseMonth: "Clôtures à venir",
  geo: "Géographie",
  correlation: "Corrélation",
  film: "Film 4D",
  total: "Synthèse",
};

export interface StoryContext {
  /** Date de référence (ms UTC, minuit) : « aujourd'hui » des retards, âges, cumuls. */
  today: number;
  /** Entité du sous-titre IBCS (nom du jeu de données). */
  entity?: string;
}

export interface Ctx extends StoryContext {
  ds: Dataset;
  roles: Roles;
  year: number;
  yearStart: number;
  yearEnd: number;
  monthStart: number;
}

export interface Analysis {
  kind: InsightKind;
  title: string;
  comments: string[];
  why: string;
  role: NarrativeRole;
  effect: number;
  coverage: number;
  /** Précisions de périmètre pour le sous-titre (« affaires ouvertes au 8 oct. 2026 »). */
  scope?: string;
  /** Chiffres utilisés (traçabilité, future réécriture LLM). */
  facts: Record<string, string | number>;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  score: number;
  effect: number;
  coverage: number;
  spec: ChartSpec;
  analysis: Analysis;
}

export function makeCtx(ds: Dataset, sc: StoryContext): Ctx {
  const d = new Date(sc.today);
  const year = d.getUTCFullYear();
  return {
    ...sc,
    ds,
    roles: detectRoles(ds),
    year,
    yearStart: Date.UTC(year, 0, 1),
    yearEnd: Date.UTC(year, 11, 31, 23, 59, 59),
    monthStart: Date.UTC(year, d.getUTCMonth(), 1),
  };
}

/** Empreinte d'un spec : la narration spécifique d'un insight ne s'applique que tant qu'elle correspond. */
export function basisOf(spec: Pick<ChartSpec, "type" | "encoding" | "transform">): string {
  const e = spec.encoding;
  return JSON.stringify([spec.type, e.x, e.y, e.series, e.xGrain, e.aggregate, spec.transform]);
}

/* ------------------------------------------------------------------ helpers */

type MUnit = "eur" | "pct" | "count" | "plain";

function measureUnit(spec: ChartSpec, field: string | undefined, ctx: Ctx): MUnit {
  if (spec.encoding.aggregate === "count") return "count";
  const u = spec.axes.y.unit;
  if (u === "pct" || (field && ctx.roles.pctMeasures.has(field))) return "pct";
  if (u === "eur" || u === "keur" || u === "meur" || (field && (ctx.roles.currency.has(field) || /€/.test(field)))) return "eur";
  return "plain";
}

function fm(v: number, u: MUnit) {
  return formatMeasure(v, u);
}

/** Unité d'axe adaptée à l'ordre de grandeur. */
export function axisUnitFor(maxAbs: number, currency: boolean, pct = false): { unit: UnitKey; decimals: number | null } {
  if (pct) return { unit: "pct", decimals: 0 };
  if (maxAbs >= 2e6) return { unit: currency ? "meur" : "M", decimals: 1 };
  if (maxAbs >= 2e4) return { unit: currency ? "keur" : "k", decimals: 0 };
  return { unit: currency ? "eur" : "none", decimals: null };
}

function rowsOf(eff: Dataset): Row[] {
  return eff.rows;
}

function numAt(r: Row, f: string | null | undefined): number | null {
  if (!f) return null;
  const v = r[f];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/** Totaux par clé (somme des séries) d'un modèle catégoriel, sans top-N. */
function keyTotals(spec: ChartSpec, eff: Dataset): { labels: string[]; totals: number[] } | null {
  const sp: ChartSpec = { ...spec, encoding: { ...spec.encoding, topN: null } };
  if (!columnOf(eff, sp.encoding.x) && !(sp.encoding.y.length > 1)) return null;
  const m = buildCatModel(sp, eff, allRows(eff));
  if (!m.keys.length) return null;
  const totals = m.keys.map((_, k) => {
    let s = 0;
    let any = false;
    for (const row of m.values) if (Number.isFinite(row[k]!)) (s += row[k]!, (any = true));
    return any ? s : NaN;
  });
  return { labels: m.labels, totals };
}

function isOpenFilter(spec: ChartSpec, stage: string | null): boolean {
  return !!stage && spec.transform.filters.some((f) => f.field === stage && f.op === "notIn");
}

/* ------------------------------------------------------------------ analyzers */

type Analyzer = (spec: ChartSpec, eff: Dataset, ctx: Ctx) => Analysis | null;

/** Pas suivant d'une période (mois, trimestre, semaine, jour, année), en UTC. */
function nextPeriod(t: number, grain: string): number {
  const d = new Date(t);
  if (grain === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (grain === "quarter") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  if (grain === "year") return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  if (grain === "week") return t + 7 * DAY;
  return t + DAY;
}

/** Comparaison de deux fenêtres appariées (même période, un an d'écart) + indicateurs de robustesse. */
export interface TrendComparison {
  /** Croissance des sommes (fenêtre courante / fenêtre de référence − 1). */
  growth: number;
  /** Croissance des médianes (amortit les pics). */
  medianGrowth: number;
  /** Part des périodes appariées qui vont dans le sens de `growth` (0..1). */
  consistency: number;
  /** Croissance la plus faible (en valeur absolue) en retirant une période à la fois. */
  leaveOneOut: number;
  /** Part de la période la plus forte dans la fenêtre courante (pic isolé si élevée). */
  peakShare: number;
  confident: boolean;
  /** Croissance retenue pour le titre (prudente si la confiance est faible). */
  headline: number;
}

/** Robustesse d'une hausse / baisse : médianes, constance mois par mois, sensibilité à un mois isolé. */
export function compareWindows(cur: number[], ref: number[]): TrendComparison | null {
  const n = Math.min(cur.length, ref.length);
  if (!n) return null;
  const a = ref.slice(-n);
  const b = cur.slice(-n);
  const sa = S.sum(a);
  const sb = S.sum(b);
  if (!(sa > 0) || sb < 0) return null;
  const growth = sb / sa - 1;
  const ma = S.median(a);
  const mb = S.median(b);
  const medianGrowth = ma > 0 ? mb / ma - 1 : growth;
  const dir = Math.sign(growth);
  let agreeN = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.sign(b[i]! - a[i]!);
    agreeN += d === dir ? 1 : d === 0 ? 0.5 : 0;
  }
  const consistency = n ? agreeN / n : 0;
  let loo = growth;
  if (n >= 3) {
    for (let i = 0; i < n; i++) {
      const ra = sa - a[i]!;
      const rb = sb - b[i]!;
      if (!(ra > 0)) continue;
      const g = rb / ra - 1;
      if (Math.sign(g) !== dir || Math.abs(g) < Math.abs(loo)) loo = g;
    }
  }
  const peakShare = sb > 0 ? Math.max(...b) / sb : 0;
  const small = Math.abs(growth) < 0.03;
  const confident =
    n >= 3 &&
    (small ||
      (consistency >= 0.6 && Math.sign(medianGrowth) === dir && Math.sign(loo) === dir && Math.abs(loo) >= Math.abs(growth) * 0.5 && !(n >= 6 && peakShare > 0.35)));
  // Titre prudent : la plus petite des estimations de même signe (somme, médiane, sans le mois le plus influent)
  const sameSign = [growth, medianGrowth, loo].filter((g) => Math.sign(g) === dir);
  const headline = confident ? growth : sameSign.length === 3 ? sameSign.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x)) : 0;
  return { growth, medianGrowth, consistency, leaveOneOut: loo, peakShare, confident, headline };
}

/**
 * Tendance : période complète uniquement (mois en cours exclu), cumul depuis janvier (ou 12 mois glissants)
 * vs même période un an plus tôt, contrôlée par les médianes et la constance mois par mois.
 * Au-delà de ±100 %, le titre passe en multiplicateur (« ×2,5 ») si le constat est net, en valeurs absolues sinon.
 */
const pctMeasureOf = (u: MUnit) => u === "pct";
const analyzeTrend: Analyzer = (spec, eff, ctx) => {
  const xCol = columnOf(eff, spec.encoding.x);
  const yField = spec.encoding.y[0];
  if (!xCol || xCol.type !== "date" || (!yField && spec.encoding.aggregate !== "count")) return null;
  const grain = spec.encoding.xGrain === "none" ? "month" : spec.encoding.xGrain;
  const sp: ChartSpec = { ...spec, type: "line", encoding: { ...spec.encoding, xGrain: grain, y: yField ? [yField] : [], y2: null } };
  const m = buildCatModel(sp, eff, allRows(eff));
  let pts = m.keys
    .map((k, i) => ({ t: k as number, v: m.values.reduce((s, row) => s + (Number.isFinite(row[i]!) ? row[i]! : 0), 0), any: m.values.some((row) => Number.isFinite(row[i]!)) }))
    .filter((p) => p.any && typeof p.t === "number");
  // Périodes complètes uniquement : la période en cours (incomplète) et le futur sont exclus
  const cur = bucketDate(ctx.today, grain);
  pts = pts.filter((p) => p.t < cur).sort((a, b) => a.t - b.t);
  if (pts.length < 3) return null;
  // Sommes / comptages : une période sans ligne vaut 0 (sinon elle disparaîtrait des comparaisons)
  const additive = spec.encoding.aggregate === "sum" || spec.encoding.aggregate === "count";
  if (additive && ["month", "quarter", "year", "week"].includes(grain)) {
    const byT = new Map(pts.map((p) => [p.t, p]));
    const filled: typeof pts = [];
    for (let t = pts[0]!.t; t <= pts[pts.length - 1]!.t; t = nextPeriod(t, grain)) filled.push(byT.get(t) ?? { t, v: 0, any: true });
    if (filled.length <= 400) pts = filled;
  }
  const u = measureUnit(sp, yField, ctx);
  const label = str(spec.story.params.subject) ?? (spec.encoding.aggregate === "count" ? "nombre de lignes" : measureLabel(yField!));
  const Subject = capitalize(label);
  const last = pts[pts.length - 1]!;
  const perYear = grain === "month" ? 12 : grain === "quarter" ? 4 : grain === "week" ? 52 : grain === "year" ? 1 : 365;
  const fmtT = (t: number) => (grain === "month" ? monthYear(t) : grain === "quarter" ? quarterOf(t) : grain === "year" ? String(new Date(t).getUTCFullYear()) : dayMonthYear(t));
  const shortMonth = (t: number) => monthYear(t).split(" ")[0]!;
  const lastYear = new Date(last.t).getUTCFullYear();
  const n = pts.length;
  const vals = pts.map((p) => p.v);

  // 1. Choix des fenêtres comparées
  let curW: typeof pts = [];
  let refW: typeof pts = [];
  let basis = "";
  let periodTxt = "";
  if (perYear > 1 && perYear <= 12 && n >= perYear + 3) {
    const ytd = pts.filter((p) => new Date(p.t).getUTCFullYear() === lastYear).length;
    const k = n >= 2 * perYear && (ytd < 3 || ytd === perYear) ? perYear : ytd >= 3 ? ytd : Math.min(perYear, n - perYear);
    curW = pts.slice(-k);
    refW = pts.slice(-k - perYear, -perYear);
    const a = curW[0]!.t;
    const span = (t0: number, t1: number) => (grain === "month" ? `${shortMonth(t0)}–${monthYear(t1)}` : `${fmtT(t0).split(" ")[0]}–${fmtT(t1)}`);
    if (k === perYear && n >= 2 * perYear) {
      basis = grain === "month" ? "sur 12 mois glissants" : "sur 4 trimestres glissants";
      periodTxt = `${span(a, last.t)}`;
    } else {
      const isYtd = new Date(a).getUTCMonth() === 0 && new Date(a).getUTCFullYear() === lastYear;
      basis = isYtd ? `sur un an (${span(a, last.t)} vs ${lastYear - 1})` : `sur un an (${span(a, last.t)} vs N-1)`;
      periodTxt = span(a, last.t);
    }
  } else if (perYear === 1 && n >= 2) {
    curW = pts.slice(-1);
    refW = pts.slice(-2, -1);
    basis = `en ${lastYear} vs ${lastYear - 1}`;
    periodTxt = String(lastYear);
  } else {
    // Moins d'un an de recul : 2e moitié vs 1re moitié de la période (comparée sur les médianes)
    const h = Math.floor(n / 2);
    curW = pts.slice(-h);
    refW = pts.slice(0, h);
    basis = "sur la période";
    periodTxt = `${fmtT(curW[0]!.t)} – ${fmtT(last.t)}`;
  }
  const paired = perYear > 1 ? refW.length === curW.length && curW.length > 0 : true;
  let cmp = paired && curW.length ? compareWindows(curW.map((p) => p.v), refW.map((p) => p.v)) : null;
  const halves = basis === "sur la période";
  if (halves && cmp) {
    // Moitiés non appariées : on juge sur les médianes et la pente
    const reg = S.linreg(pts.map((_, i) => i), vals);
    const g = cmp.medianGrowth;
    const confident = Math.sign(g) === Math.sign(cmp.growth) && reg.r2 >= 0.3 && Math.sign(reg.slope) === Math.sign(g);
    cmp = { ...cmp, confident: confident || Math.abs(cmp.growth) < 0.03, headline: confident ? g : Math.sign(g) === Math.sign(cmp.growth) ? (Math.abs(g) < Math.abs(cmp.growth) ? g : cmp.growth) * 0.5 : 0 };
  }
  if (!cmp || !Number.isFinite(cmp.growth)) return null;
  const sumCur = S.sum(curW.map((p) => p.v));
  const sumRef = S.sum(refW.map((p) => p.v));
  let g = cmp.headline;
  const shown = additive || perYear === 1;

  // 2. Titre : prudent si irrégulier, multiplicateur au-delà de +100 %, valeurs absolues si le constat est fragile
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
  // Pic isolé : comparé aux périodes voisines (±3), pour ne pas confondre une croissance forte et un pic
  const localMedian = (p: (typeof pts)[number]) => {
    const i = pts.indexOf(p);
    return S.median(pts.slice(Math.max(0, i - 3), i + 4).filter((q) => q !== p).map((q) => q.v));
  };
  const spikeOf = (p: (typeof pts)[number]) => !pctMeasureOf(u) && localMedian(p) > 0 && p.v >= 2.5 * localMedian(p);
  const isolatedPeak = spikeOf(peak);
  const med = localMedian(peak);
  const curPeak = curW.reduce((a, b) => (b.v > a.v ? b : a), curW[0]!);
  // Un multiplicateur (« ×2,5 ») n'est affiché que si le constat est net : médiane et « sans le meilleur mois » le confirment
  const extremeOk = cmp.confident && cmp.medianGrowth >= 0.5 && cmp.leaveOneOut >= 0.7 && !spikeOf(curPeak) && curW.length >= 3;
  if (cmp.growth >= 1 && !extremeOk) {
    const same = [cmp.growth, cmp.medianGrowth, cmp.leaveOneOut].filter((x) => x > 0);
    g = same.length === 3 ? Math.min(...same) : 0;
    cmp = { ...cmp, confident: false, headline: g };
  }
  const pctMeasure = u === "pct";
  const meanCur = S.mean(curW.map((p) => p.v));
  const meanRef = S.mean(refW.map((p) => p.v));
  const dPts = meanCur - meanRef;
  let title: string;
  let qualifier = "";
  if (pctMeasure && refW.length) {
    // Taux / marges : écart en points de moyenne, jamais en % relatif
    title = Math.abs(dPts) < 0.5 ? `${Subject} stable ${basis} : ${fm(meanCur, u)} (${formatPoints(dPts)})` : `${Subject} en ${dPts > 0 ? "hausse" : "baisse"} de ${formatPoints(Math.abs(dPts)).replace(/^[+−]/, "")} ${basis} (${fm(meanCur, u)})`;
  } else if (Math.abs(cmp.growth) < 0.03) title = `${Subject} stable ${basis} : ${formatSignedPct(cmp.growth)}`;
  else if (cmp.confident) {
    if (cmp.growth >= 1) title = `${Subject} : ${formatTimes(1 + cmp.growth)} ${basis}`;
    else title = `${Subject} en ${cmp.growth > 0 ? "hausse" : "baisse"} de ${formatPct(Math.abs(cmp.growth))} ${basis}`;
  } else if (Math.abs(cmp.growth) >= 1 && shown) {
    title = `${Subject} : ${fm(sumCur, u)} ${halves ? "en fin de période" : `en ${periodTxt}`} contre ${fm(sumRef, u)} ${halves ? "au début" : "un an plus tôt"}${spikeOf(curPeak) ? `, dont ${fm(curPeak.v, u)} en ${fmtT(curPeak.t)}` : ", mois irréguliers"}`;
    qualifier = "irrégulier";
  } else if (Math.abs(g) >= 0.03) {
    title = `${Subject} plutôt en ${g > 0 ? "hausse" : "baisse"} ${basis} : ${formatSignedPct(g)}, ${perYear === 12 ? "mois" : "périodes"} irréguli${perYear === 12 ? "ers" : "ères"}`;
    qualifier = "irrégulier";
  } else {
    title = `${Subject} sans tendance nette ${basis} : évolution irrégulière`;
    qualifier = "contrasté";
  }

  // 3. Commentaires
  const comments: string[] = [];
  if (pctMeasure && refW.length) comments.push(`Moyenne ${halves ? "en fin de période" : periodTxt} : ${fm(meanCur, u)}, contre ${fm(meanRef, u)} ${halves ? "au début" : "un an plus tôt"}.`);
  else if (shown && refW.length) comments.push(`${halves ? "Fin de période" : capitalize(periodTxt)} : ${fm(sumCur, u)}, contre ${fm(sumRef, u)} ${halves ? "en début de période" : "un an plus tôt"} (${formatGrowth(cmp.growth)}).`);
  if (!halves && perYear > 1 && curW.length >= 3 && Math.abs(cmp.growth) >= 0.03 && !pctMeasure) {
    const up = Math.round(cmp.consistency * curW.length);
    comments.push(cmp.confident ? `${count(up, perYear === 12 ? "mois" : "période", perYear === 12 ? "mois" : "périodes")} sur ${curW.length} ${cmp.growth >= 0 ? "au-dessus" : "en dessous"} de l'an dernier : tendance régulière.` : `${count(up, perYear === 12 ? "mois" : "période", perYear === 12 ? "mois" : "périodes")} sur ${curW.length} ${cmp.growth >= 0 ? "au-dessus" : "en dessous"} de l'an dernier ; en médiane : ${formatGrowth(cmp.medianGrowth)}.`);
  }
  const cagr =
    perYear > 1 && n >= 2 * perYear
      ? S.cagr(S.sum(pts.slice(0, perYear).map((p) => p.v)), S.sum(pts.slice(-perYear).map((p) => p.v)), (n - perYear) / perYear)
      : perYear === 1 && n >= 3
        ? S.cagr(pts[0]!.v, last.v, (last.t - pts[0]!.t) / (365.25 * DAY))
        : NaN;
  if (Number.isFinite(cagr) && Math.abs(cagr) < 1 && cmp.confident && !pctMeasure && comments.length < 3) comments.push(`Rythme annuel moyen (TCAM) : ${formatSignedPct(cagr)} depuis ${fmtT(pts[0]!.t)}.`);
  if (isolatedPeak) comments.push(`Pic isolé en ${fmtT(peak.t)} : ${fm(peak.v, u)}, ${formatRatio(peak.v / med)} les ${perYear === 12 ? "mois" : "périodes"} voisin${perYear === 12 ? "s" : "es"}.`);
  else if (comments.length < 3) comments.push(peak !== last ? `Point haut : ${fmtT(peak.t)} (${fm(peak.v, u)}).` : `${capitalize(fmtT(last.t))} est le point le plus haut de la série.`);
  if (!comments.length) comments.push(`Dernière période complète (${fmtT(last.t)}) : ${fm(last.v, u)}.`);

  const why = !cmp.confident
    ? `Tendance fragile : l'écart tient à quelques ${perYear === 12 ? "mois" : "périodes"} exceptionnel${perYear === 12 ? "s" : "les"} ; à confirmer avant de conclure.`
    : pctMeasure
      ? `Situe le niveau : ${fm(meanCur, u)} en moyenne, ${formatPoints(dPts)} sur un an.`
      : Number.isFinite(cagr) && Math.abs(cagr) < 1
      ? `Situe la dynamique : rythme annuel moyen de ${formatSignedPct(cagr)}.`
      : `Situe la dynamique récente : ${formatGrowth(cmp.growth)} ${basis}.`;
  const conf = cmp.confident ? 1 : 0.4;
  return {
    kind: "trend",
    title,
    comments: comments.slice(0, 3),
    why,
    role: "context",
    effect: (pctMeasure ? S.clamp01(Math.abs(dPts) / 5) : S.clamp01(Math.abs(cmp.confident ? cmp.growth : g) / 0.3)) * conf * (curW.length >= 6 || perYear === 1 ? 1 : 0.8),
    coverage: S.clamp01(n / Math.max(6, m.keys.length)) * (cmp.confident ? 1 : 0.7),
    facts: {
      growth: cmp.growth,
      headlineGrowth: g,
      medianGrowth: cmp.medianGrowth,
      consistency: cmp.consistency,
      confidence: cmp.confident ? "élevée" : "faible",
      qualifier,
      current: sumCur,
      reference: sumRef,
      cagr: Number.isFinite(cagr) ? cagr : "",
      peak: peak.v,
      points: n,
    },
  };
};

/** Concentration / Pareto : part des N premiers. */
const analyzeConcentration: Analyzer = (spec, eff, ctx) => {
  const xCol = columnOf(eff, spec.encoding.x);
  if (!xCol || xCol.type === "date" || xCol.type === "number") return null;
  const kt = keyTotals(spec, eff);
  if (!kt || kt.labels.length < 3) return null;
  const pairs = kt.labels.map((l, i) => ({ l, v: kt.totals[i]! })).filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
  if (pairs.length < 3) return null;
  const c = S.concentration(pairs.map((p) => p.v), 0.5);
  const K = pairs.length;
  let N = c.nForTarget <= 5 ? c.nForTarget : 3;
  if (N >= K) N = 1;
  const share = c.topShare(N);
  const yField = spec.encoding.y[0];
  const u = measureUnit(spec, yField, ctx);
  const noun = nounOf(xCol.name);
  const pipe = ctx.roles.isPipeline && yField === ctx.roles.amount?.name;
  const qual = str(spec.story.params.qual);
  const mLabel = spec.encoding.aggregate === "count" ? "nombre de lignes" : measureLabel(yField ?? "valeur");
  const whole = pipe ? `le pipeline${qual ? " " + qual : isOpenFilter(spec, ctx.roles.stage?.name ?? null) ? " ouvert" : ""}` : partitive(mLabel).replace(/^(du|de la|de l'|des) /, "");
  const names = pairs.slice(0, N).map((p) => p.l);
  let title: string;
  if (pipe) title = `${capitalize(whole)} repose à ${formatPct(share)} sur ${N === 1 ? names[0] : count(N, noun.sg, noun.pl)}`;
  else if (N === 1) title = `${names[0]} concentre ${formatPct(share)} ${partitive(mLabel)}`;
  else title = `${count(N, noun.sg, noun.pl)} concentrent ${formatPct(share)} ${partitive(mLabel)}`;
  const comments = [
    `${pairs[0]!.l} : ${formatPct(c.shares[0]!)} à ${agree(noun, "lui seul", "elle seule")} (${fm(pairs[0]!.v, u)}).`,
    N > 1 ? `Les ${N} ${agree(noun, "premiers", "premières")} ${noun.pl} : ${joinList(names)}.` : `${pairs[1]!.l} suit avec ${formatPct(c.shares[1]!)}.`,
    K - N === 1 ? `${agree(noun, "Le dernier", "La dernière")} ${noun.sg} pèse ${formatPct(1 - share)}.` : `Les ${count(K - N, noun.sg, noun.pl)} ${agree(noun, "restants", "restantes")} se partagent ${formatPct(1 - share)}.`,
  ];
  const uniform = N / K;
  return {
    kind: "concentration",
    title,
    comments,
    why: `Risque de dépendance : perdre ${pairs[0]!.l} amputerait ${pipe ? "le pipeline" : "le total"} de ${formatPct(c.shares[0]!)}.`,
    role: "revelation",
    effect: S.clamp01((share - uniform) / 0.45),
    coverage: 1,
    facts: { n: N, share, top1: c.shares[0]!, categories: K, total: c.total },
  };
};

/** Classement / dispersion : meilleur, moins bon, écart à la moyenne. */
const analyzeRanking: Analyzer = (spec, eff, ctx) => {
  const xCol = columnOf(eff, spec.encoding.x);
  if (!xCol || xCol.type === "date") return null;
  const kt = keyTotals(spec, eff);
  if (!kt || kt.labels.length < 3) return null;
  const pairs = kt.labels.map((l, i) => ({ l, v: kt.totals[i]! })).filter((p) => Number.isFinite(p.v)).sort((a, b) => b.v - a.v);
  if (pairs.length < 3) return null;
  const vals = pairs.map((p) => p.v);
  const avg = S.mean(vals);
  const best = pairs[0]!;
  const worst = pairs[pairs.length - 1]!;
  const yField = spec.encoding.y[0];
  const u = measureUnit(spec, yField, ctx);
  const noun = nounOf(xCol.name);
  const mLabel = spec.encoding.aggregate === "count" ? "nombre de lignes" : measureLabel(yField ?? "valeur");
  const disp = S.cv(vals);
  const above = vals.filter((v) => v > avg).length;
  let title: string;
  if (u === "pct") {
    title = disp < 0.08 ? `${capitalize(mLabel)} homogène entre ${noun.pl} (${fm(worst.v, u)} à ${fm(best.v, u)})` : `${best.l} en tête : ${fm(best.v, u)}, ${formatPoints(best.v - avg)} vs la moyenne`;
  } else if (disp < 0.08) {
    title = `${capitalize(mLabel)} homogène entre ${noun.pl} (écart max ${formatPct(Math.max(best.v / avg - 1, 1 - worst.v / avg))})`;
  } else {
    title = `${best.l} en tête : ${formatRatio(best.v / avg)} la moyenne des ${noun.pl}`;
  }
  const ratio = worst.v > 0 ? best.v / worst.v : NaN;
  const comments = [
    `${best.l} : ${fm(best.v, u)} ; ${worst.l} : ${fm(worst.v, u)}${Number.isFinite(ratio) && u !== "pct" ? ` (${formatRatio(ratio)} moins)` : ""}.`,
    `Moyenne par ${noun.sg} : ${fm(avg, u)} ; ${count(above, noun.sg, noun.pl)} au-dessus.`,
    u === "pct" ? `${worst.l} : ${formatPoints(worst.v - avg)} sous la moyenne.` : `${worst.l} : ${formatSignedPct(worst.v / avg - 1)} par rapport à la moyenne.`,
  ];
  return {
    kind: "ranking",
    title,
    comments,
    why: Number.isFinite(ratio) && u !== "pct" ? `Écart de ${formatRatio(ratio)} entre ${best.l} et ${worst.l} : la moyenne masque de fortes disparités.` : `Dispersion entre ${noun.pl} : ${formatPoints(best.v - worst.v).replace(/^\+/, "")} d'écart.`,
    role: "revelation",
    effect: S.clamp01(disp / 1.0),
    coverage: 1,
    facts: { best: best.l, bestValue: best.v, worst: worst.l, worstValue: worst.v, mean: avg, cv: disp },
  };
};

/** Saisonnalité : indice mensuel moyen (valeur / moyenne de l'année). */
const analyzeSeasonality: Analyzer = (spec, eff, ctx) => {
  const dateField = str(spec.story.params.date);
  const yField = spec.encoding.y[0];
  if (!dateField || !yField || columnOf(eff, dateField)?.type !== "date") return null;
  const cells = new Map<string, number>();
  for (const r of rowsOf(eff)) {
    const t = numAt(r, dateField);
    const v = numAt(r, yField);
    if (t == null || v == null || t > ctx.today) continue;
    const d = new Date(t);
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    cells.set(k, (cells.get(k) ?? 0) + v);
  }
  // période en cours exclue
  const cd = new Date(ctx.today);
  cells.delete(`${cd.getUTCFullYear()}-${cd.getUTCMonth()}`);
  if (cells.size < 15) return null;
  const byYear = new Map<number, Map<number, number>>();
  for (const [k, v] of cells) {
    const [y, m] = k.split("-").map(Number) as [number, number];
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(m, v);
  }
  const idx: number[][] = Array.from({ length: 12 }, () => []);
  const peaks: number[] = [];
  for (const [, months] of byYear) {
    if (months.size < 6) continue;
    const avg = S.mean([...months.values()]);
    if (!(avg > 0)) continue;
    for (const [m, v] of months) idx[m]!.push(v / avg);
    if (months.size === 12) peaks.push([...months.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
  }
  // Médiane des indices annuels : un mois exceptionnel une année ne fait pas une saisonnalité
  const mIdx = idx.map((a) => (a.length ? S.median(a) : NaN));
  const valid = mIdx.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  if (valid.length < 10) return null;
  const peak = valid.reduce((a, b) => (b.v > a.v ? b : a));
  const trough = valid.reduce((a, b) => (b.v < a.v ? b : a));
  const amplitude = peak.v - trough.v;
  const consistent = peaks.length >= 1 && peaks.every((p) => p === peak.i);
  // Confiance : le mois de pic doit être observé au moins deux années et rester au-dessus de la moyenne chaque fois
  const peakObs = idx[peak.i]!;
  const confident = peakObs.length >= 2 && peakObs.every((v) => v > 1.1);
  const peakYears = [...byYear.entries()].filter(([, months]) => months.size >= 6 && months.has(peak.i)).map(([y]) => y);
  const nextPeak = peak.i >= cd.getUTCMonth() ? `${monthIndexLong(peak.i)} ${cd.getUTCFullYear()}` : `${monthIndexLong(peak.i)} ${cd.getUTCFullYear() + 1}`;
  const P = capitalize(monthIndexLong(peak.i));
  const strength = peak.v >= 2 ? `${formatRatio(peak.v)} un mois moyen` : `${formatSignedPct(peak.v - 1)} par rapport à un mois moyen`;
  const title = confident ? `${P}, mois le plus fort : ${strength}` : `${P}, mois le plus fort en ${joinList(peakYears.map(String))} : ${strength}`;
  return {
    kind: "seasonality",
    title,
    comments: [
      `Creux en ${monthIndexLong(trough.i)} : ${formatSignedPct(trough.v - 1)} par rapport à la moyenne.`,
      consistent && peaks.length > 1 ? `Pic en ${monthIndexLong(peak.i)} chaque année complète (${peaks.length} ans).` : `Écart pic / creux : ${formatRatio(peak.v / Math.max(0.01, trough.v))}.`,
      confident ? `Prochain pic attendu : ${nextPeak}.` : `Une seule année observée pour ${monthIndexLong(peak.i)} : à confirmer en ${nextPeak}.`,
    ],
    why: confident ? `Anticiper la charge : ${monthIndexLong(peak.i)} pèse ${formatRatio(peak.v)} un mois moyen.` : `Profil à confirmer : ${monthIndexLong(peak.i)} n'est observé que sur ${count(peakObs.length, "année", "années")}.`,
    role: "context",
    effect: S.clamp01((amplitude - 0.12) / 0.6) * (confident ? 1 : 0.45),
    coverage: S.clamp01(cells.size / 24),
    facts: { peakMonth: peak.i + 1, peakIndex: peak.v, troughMonth: trough.i + 1, troughIndex: trough.v, months: cells.size, confidence: confident ? "élevée" : "faible" },
  };
};

/** Valeurs atypiques (Tukey, k = 3) au niveau ligne. */
const analyzeOutlier: Analyzer = (spec, eff, ctx) => {
  const yField = spec.encoding.y[0];
  if (!yField) return null;
  const labelField = spec.encoding.label;
  const vals = rowsOf(eff)
    .map((r) => ({ v: numAt(r, yField), l: labelField ? String(r[labelField] ?? "") : "" }))
    .filter((p): p is { v: number; l: string } => p.v != null && p.v > 0);
  if (vals.length < 20) return null;
  const xs = vals.map((p) => p.v);
  const f = S.iqrFences(xs, 3);
  const z = S.zscores(xs);
  const outs = vals.filter((p, i) => p.v > f.hi || z[i]! >= 3.5).sort((a, b) => b.v - a.v);
  if (!outs.length || outs.length > vals.length * 0.1) return null;
  const total = S.sum(xs);
  const share = S.sum(outs.map((p) => p.v)) / total;
  const med = S.median(xs);
  const u = measureUnit(spec, yField, ctx);
  const noun = labelField ? nounOf(labelField) : { sg: "ligne", pl: "lignes", f: true };
  const top = outs[0]!;
  const mLabel = measureLabel(yField);
  const n = outs.length;
  return {
    kind: "outlier",
    title: n === 1 ? `${agree(noun, "Un", "Une")} ${noun.sg} hors norme pèse ${formatPct(share)} ${partitive(mLabel)} total` : `${count(n, noun.sg, noun.pl)} hors norme pèsent ${formatPct(share)} ${partitive(mLabel)} total`,
    comments: [
      `${top.l ? `La plus importante : ${top.l}` : "La plus importante"} à ${fm(top.v, u)} (${formatRatio(top.v / med)} la médiane).`,
      `Médiane : ${fm(med, u)} ; seuil « hors norme » : ${fm(f.hi, u)}.`,
      `À suivre une à une : ${n === 1 ? "elle fausse" : "elles faussent"} moyennes et prévisions.`,
    ],
    why: `${count(n, "valeur extrême", "valeurs extrêmes")} : ${formatPct(share)} du total sur ${formatPct(n / vals.length)} des lignes.`,
    role: "tension",
    effect: S.clamp01(0.3 + share * 1.5),
    coverage: S.clamp01(vals.length / Math.max(1, ctx.ds.rows.length)),
    facts: { count: n, share, max: top.v, median: med, fence: f.hi },
  };
};

function scenarioOf(col: string): Scenario | null {
  if (/n\s*-\s*1|\bpy\b|prior|pr[ée]c[ée]dent|last year/i.test(col)) return "py";
  if (/budget|\bplan\b|objectif|target/i.test(col)) return "budget";
  if (/pr[ée]vision|forecast|atterrissage|landing/i.test(col)) return "forecast";
  if (/r[ée]el|actual|r[ée]alis/i.test(col)) return "actual";
  return null;
}

/** Écarts réel vs référence (IBCS). */
const analyzeVariance: Analyzer = (spec, eff, ctx) => {
  if (spec.type !== "variance") return null;
  const vm = buildVarianceModel(spec, eff);
  if (!vm || !vm.keys.length) return null;
  const pol = spec.variance.polarity;
  const u = measureUnit(spec, vm.actualName, ctx);
  const t = vm.total;
  if (!Number.isFinite(t.rel)) return null;
  const landing = !!spec.story.params.landing;
  const refSc = scenarioOf(vm.refName);
  const refLabel = refSc ? SCENARIO_LABELS[refSc] : measureLabel(vm.refName);
  const refLow = refSc === "budget" ? "le budget" : refSc === "forecast" ? "la prévision" : refSc === "py" ? "N-1" : refLabel;
  const yearTxt = spec.story.params.year != null ? ` ${spec.story.params.year}` : "";
  const actLabel = landing ? "Atterrissage" : capitalize(measureLabel(vm.actualName).replace(/\s*\(.*\)$/, ""));
  const fav = isFavourable(t.delta, pol);
  const items = vm.keys.map((_, i) => ({ l: vm.labels[i]!, d: vm.delta[i]!, r: vm.rel[i]! })).filter((p) => Number.isFinite(p.r));
  const sorted = [...items].sort((a, b) => (pol === "higher" ? a.d - b.d : b.d - a.d));
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const multi = items.length > 1 && !!spec.encoding.x;
  let title: string;
  const pct = formatPct(Math.abs(t.rel));
  if (landing) {
    const ratio = t.actual / t.ref;
    title = ratio < 0.995 ? `${actLabel}${yearTxt} à ${formatPct(ratio)} du budget : ${fm(-t.delta, u)} à combler` : `${actLabel}${yearTxt} à ${formatPct(ratio)} du budget : objectif dépassé de ${fm(t.delta, u)}`;
  } else if (refSc === "py") {
    title = `${actLabel}${yearTxt} en ${t.delta >= 0 ? "hausse" : "baisse"} de ${pct} sur N-1` + (multi && best && worst ? (t.delta >= 0 ? `, porté par ${best.l} (${formatSignedPct(best.r)})` : `, freiné par ${worst.l} (${formatSignedPct(worst.r)})`) : "");
  } else if (Math.abs(t.rel) <= 0.01) {
    title = `${actLabel}${yearTxt} conforme ${refSc === "budget" ? "au budget" : `à ${refLow}`} (${formatSignedPct(t.rel)})` + (multi && worst && !isFavourable(worst.d, pol) ? ` ; ${worst.l} en retrait` : "");
  } else {
    const dir = t.delta < 0 ? "sous" : "au-dessus" + (refSc === "budget" ? " du" : " de");
    const refTxt = t.delta < 0 ? refLow : refSc === "budget" ? "budget" : refLow;
    title = `${actLabel}${yearTxt} ${dir} ${refTxt} de ${pct} (${formatSignedMeasure(t.delta, u)})`;
    if (multi && worst && best) title += !fav ? ` : ${worst.l} décroche (${formatSignedPct(worst.r)})` : `, porté par ${best.l} (${formatSignedPct(best.r)})`;
  }
  const comments = [`${actLabel} : ${fm(t.actual, u)} vs ${fm(t.ref, u)} ${refLabel.toLowerCase() === "n-1" ? "en N-1" : `(${refLabel.toLowerCase()})`}, soit ${formatSignedMeasure(t.delta, u)} (${formatSignedPct(t.rel)}).`];
  if (multi && worst) {
    const gap = S.sum(items.filter((p) => !isFavourable(p.d, pol)).map((p) => p.d));
    const share = gap ? worst.d / gap : NaN;
    if (!isFavourable(worst.d, pol)) comments.push(`${worst.l} : ${formatSignedMeasure(worst.d, u)} (${formatSignedPct(worst.r)})${Number.isFinite(share) && share < 0.999 ? `, soit ${formatPct(share)} des écarts défavorables` : ""}.`);
    if (best && isFavourable(best.d, pol) && best !== worst) comments.push(`${best.l} : ${formatSignedMeasure(best.d, u)} (${formatSignedPct(best.r)}).`);
    if (!fav && !isFavourable(worst.d, pol)) comments.splice(2, 1, `Recommandation : plan d'action ciblé sur ${worst.l}.`);
  }
  const spread = items.length > 1 ? S.stdev(items.map((p) => p.r)) : 0;
  // « Explique l'essentiel » seulement si l'écart total est défavorable et que l'élément en porte au moins la moitié
  const varianceWhy = (): string => {
    const generic = `Écart ${fav ? "favorable" : "défavorable"} de ${formatSignedPct(t.rel)} ${refSc === "py" ? "sur un an" : `face ${refSc === "budget" ? "au budget" : "à la référence"}`}.`;
    if (!multi || !worst || isFavourable(worst.d, pol)) return generic;
    if (fav) return `Malgré un écart favorable, ${worst.l} recule : ${formatSignedMeasure(worst.d, u)} (${formatSignedPct(worst.r)}).`;
    const unfav = S.sum(items.filter((p) => !isFavourable(p.d, pol)).map((p) => p.d));
    const share = unfav ? worst.d / unfav : 0;
    return share >= 0.5 ? `${worst.l} explique l'essentiel de l'écart : ${formatSignedMeasure(worst.d, u)}.` : `${worst.l} pèse le plus dans l'écart (${formatPct(share)} des écarts défavorables) : ${formatSignedMeasure(worst.d, u)}.`;
  };
  return {
    kind: "variance",
    title,
    comments: comments.slice(0, 3),
    why: varianceWhy(),
    role: fav ? "revelation" : "tension",
    effect: S.clamp01(0.5 * S.clamp01(Math.abs(t.rel) / 0.06) + 0.5 * (worst && multi ? S.clamp01(Math.abs(worst.r) / 0.15) : S.clamp01(spread / 0.15))),
    coverage: vm.coverage,
    scope: `${actLabel} vs ${refLabel}`,
    facts: { actual: t.actual, ref: t.ref, delta: t.delta, rel: t.rel, worst: worst?.l ?? "", worstRel: worst?.r ?? "", best: best?.l ?? "" },
  };
};

interface PipeParams {
  amount: string;
  stage: string | null;
  closed: string[];
  won: string[];
  prob: string | null;
  close: string | null;
  created: string | null;
  owner: string | null;
}
function pipeParams(spec: ChartSpec): PipeParams | null {
  const p = spec.story.params;
  const amount = str(p.amount);
  if (!amount) return null;
  return { amount, stage: str(p.stage), closed: strs(p.closed), won: strs(p.won), prob: str(p.prob), close: str(p.close), created: str(p.created), owner: str(p.owner) };
}

/** Lignes ouvertes du jeu brut (référence pour les parts). */
function openRows(ctx: Ctx, pp: PipeParams): Row[] {
  return ctx.ds.rows.filter((r) => {
    if (pp.stage) {
      const s = r[pp.stage];
      return s != null && !pp.closed.includes(String(s));
    }
    if (pp.prob) {
      const p = numAt(r, pp.prob);
      return p != null && p > 0 && p < 100;
    }
    return true;
  });
}
const probScale = (eff: Dataset, f: string) => (eff.rows.some((r) => (numAt(r, f) ?? 0) > 1) ? 0.01 : 1);

const analyzeWeighted: Analyzer = (spec, eff, ctx) => {
  const pp = pipeParams(spec);
  if (!pp?.prob) return null;
  const rows = rowsOf(eff);
  if (rows.length < 5) return null;
  const sc = probScale(ctx.ds, pp.prob);
  const tot = S.sum(rows.map((r) => numAt(r, pp.amount) ?? 0));
  const w = S.sum(rows.map((r) => (numAt(r, pp.amount) ?? 0) * (numAt(r, pp.prob) ?? 0) * sc));
  if (!(tot > 0)) return null;
  const byStage = new Map<string, number>();
  if (pp.stage) for (const r of rows) byStage.set(String(r[pp.stage] ?? "?"), (byStage.get(String(r[pp.stage] ?? "?")) ?? 0) + (numAt(r, pp.amount) ?? 0) * (numAt(r, pp.prob) ?? 0) * sc);
  const topStage = [...byStage.entries()].sort((a, b) => b[1] - a[1])[0];
  const avgP = S.mean(rows.map((r) => (numAt(r, pp.prob) ?? 0) * sc));
  const eoy = pp.close ? S.sum(rows.filter((r) => (numAt(r, pp.close) ?? Infinity) <= ctx.yearEnd).map((r) => (numAt(r, pp.amount) ?? 0) * (numAt(r, pp.prob) ?? 0) * sc)) : NaN;
  const comments = [
    topStage ? `${topStage[0]} : ${formatAmount(topStage[1])} pondérés (${formatPct(topStage[1] / w)} du pondéré).` : `${count(rows.length, "affaire")} ouvertes.`,
    `${count(rows.length, "affaire ouverte", "affaires ouvertes")}, probabilité moyenne de ${formatPct(avgP)}.`,
  ];
  if (Number.isFinite(eoy)) comments.push(`Pondéré à signer d'ici fin ${ctx.year} : ${formatAmount(eoy)}.`);
  return {
    kind: "pipelineWeighted",
    title: `Pipeline pondéré : ${formatAmount(w)} sur ${formatAmount(tot)} ouverts (${formatPct(w / tot)})`,
    comments,
    why: "Le pondéré (montant × probabilité) est la meilleure estimation du chiffre d'affaires à venir.",
    role: "context",
    effect: S.clamp01(0.35 + Math.abs(0.5 - w / tot)),
    coverage: S.clamp01(rows.filter((r) => numAt(r, pp.prob) != null).length / rows.length),
    scope: `affaires ouvertes au ${dayMonthYear(ctx.today)}`,
    facts: { weighted: w, open: tot, ratio: w / tot, deals: rows.length },
  };
};

const analyzeCloseMonth: Analyzer = (spec, eff, ctx) => {
  const pp = pipeParams(spec);
  if (!pp?.close) return null;
  const rows = rowsOf(eff).filter((r) => numAt(r, pp.close) != null);
  if (rows.length < 5) return null;
  const by = new Map<number, number>();
  for (const r of rows) {
    const k = bucketDate(numAt(r, pp.close)!, "month");
    by.set(k, (by.get(k) ?? 0) + (numAt(r, pp.amount) ?? 0));
  }
  const months = [...by.entries()].sort((a, b) => a[0] - b[0]);
  if (months.length < 2) return null;
  const tot = S.sum(months.map((m) => m[1]));
  const peak = months.reduce((a, b) => (b[1] > a[1] ? b : a));
  const share = peak[1] / tot;
  const sc = pp.prob ? probScale(ctx.ds, pp.prob) : 1;
  const w = pp.prob ? S.sum(rows.map((r) => (numAt(r, pp.amount) ?? 0) * (numAt(r, pp.prob) ?? 0) * sc)) : NaN;
  const end = new Date(Math.max(...months.map((m) => m[0])));
  const endTxt = end.getUTCFullYear() === ctx.year && end.getUTCMonth() === 11 ? `fin ${ctx.year}` : monthYearLong(end.getTime());
  return {
    kind: "pipelineCloseMonth",
    title: `${capitalize(monthYearLong(peak[0]).replace(/ \d{4}$/, ""))} concentre ${formatPct(share)} du pipeline à signer d'ici ${endTxt}`,
    comments: [
      `${formatAmount(tot)} à signer d'ici ${endTxt} (${count(rows.length, "affaire")}).`,
      Number.isFinite(w) ? `Dont ${formatAmount(w)} en pondéré (${formatPct(w / tot)}).` : `${monthYear(months[0]![0])} : ${formatAmount(months[0]![1])}.`,
      months.map((m) => `${monthYear(m[0])} : ${formatAmount(m[1])}`).slice(0, 4).join(" ; ") + ".",
    ],
    why: `Charge de closing : ${formatAmount(tot)} à signer en ${count(months.length, "mois", "mois")}.`,
    role: "context",
    effect: S.clamp01((share - 1 / months.length) / 0.4),
    coverage: S.clamp01(rows.length / Math.max(1, openRows(ctx, pp).length)),
    scope: `affaires ouvertes au ${dayMonthYear(ctx.today)}, par mois de clôture`,
    facts: { total: tot, peakShare: share, peakMonth: monthYear(peak[0]), deals: rows.length },
  };
};

const analyzeSlipping: Analyzer = (spec, eff, ctx) => {
  const pp = pipeParams(spec);
  if (!pp?.close) return null;
  const rows = rowsOf(eff).filter((r) => (numAt(r, pp.close) ?? Infinity) < ctx.today);
  if (rows.length < 2) return null;
  const tot = S.sum(rows.map((r) => numAt(r, pp.amount) ?? 0));
  const open = S.sum(openRows(ctx, pp).map((r) => numAt(r, pp.amount) ?? 0));
  const share = open ? tot / open : 0;
  const delay = S.mean(rows.map((r) => (ctx.today - numAt(r, pp.close)!) / DAY));
  const ownerField = spec.encoding.x ?? pp.owner;
  let ownerTxt = "";
  if (ownerField) {
    const by = new Map<string, { n: number; v: number }>();
    for (const r of rows) {
      const k = String(r[ownerField] ?? "?");
      const e = by.get(k) ?? { n: 0, v: 0 };
      e.n++;
      e.v += numAt(r, pp.amount) ?? 0;
      by.set(k, e);
    }
    const top = [...by.entries()].sort((a, b) => b[1].v - a[1].v)[0];
    if (top) ownerTxt = `${top[0]} porte ${count(top[1].n, "de ces affaires", "de ces affaires").replace(/^1\u00a0de ces affaires/, "une de ces affaires")} (${formatAmount(top[1].v)}, ${formatPct(top[1].v / tot)}).`;
  }
  const n = rows.length;
  return {
    kind: "pipelineSlipping",
    title: `${count(n, "affaire en retard", "affaires en retard")} : ${formatAmount(tot)} à date de clôture dépassée`,
    comments: [
      `Soit ${formatPct(share)} du pipeline ouvert, avec ${formatInt(delay)}${"\u00a0"}jours de retard en moyenne.`,
      ownerTxt || `${count(n, "affaire")} à requalifier.`,
      `Recommandation : requalifier ces dates de clôture avant la prochaine revue de pipeline.`,
    ],
    why: "Des dates de clôture dépassées gonflent artificiellement le prévisionnel.",
    role: "recommendation",
    effect: S.clamp01(0.3 + share / 0.15),
    coverage: 1,
    scope: `affaires ouvertes dont la clôture prévue est antérieure au ${dayMonthYear(ctx.today)}`,
    facts: { deals: n, amount: tot, shareOfOpen: share, avgDelayDays: delay },
  };
};

const analyzeAging: Analyzer = (spec, eff, ctx) => {
  const pp = pipeParams(spec);
  if (!pp?.created) return null;
  const rows = rowsOf(eff).filter((r) => numAt(r, pp.created) != null);
  if (rows.length < 8) return null;
  const ages = rows.map((r) => ({ a: (ctx.today - numAt(r, pp.created)!) / DAY, v: numAt(r, pp.amount) ?? 0 }));
  const tot = S.sum(ages.map((x) => x.v));
  if (!(tot > 0)) return null;
  const over = (d: number) => S.sum(ages.filter((x) => x.a > d).map((x) => x.v)) / tot;
  const s180 = over(180);
  const thr = s180 >= 0.15 ? 180 : 90;
  const share = thr === 180 ? s180 : over(90);
  const med = S.median(ages.map((x) => x.a));
  const old = ages.filter((x) => x.a > 365);
  return {
    kind: "pipelineAging",
    title: `${formatPct(share)} du pipeline ouvert a plus de ${thr === 180 ? "6 mois" : "3 mois"}`,
    comments: [
      `Âge médian des affaires ouvertes : ${formatInt(med)}${"\u00a0"}jours.`,
      old.length ? `${count(old.length, "affaire")} de plus d'un an (${formatAmount(S.sum(old.map((x) => x.v)))}).` : `Aucune affaire ouverte de plus d'un an.`,
      `Recommandation : clore ou relancer les affaires de plus de ${thr === 180 ? "6" : "3"} mois.`,
    ],
    why: "Plus une affaire vieillit, moins elle a de chances d'aboutir.",
    role: "tension",
    effect: S.clamp01(share / 0.5),
    coverage: S.clamp01(rows.length / Math.max(1, openRows(ctx, pp).length)),
    scope: `affaires ouvertes au ${dayMonthYear(ctx.today)}, par ancienneté`,
    facts: { share, thresholdDays: thr, medianAge: med, overOneYear: old.length },
  };
};

const analyzeConversion: Analyzer = (spec, eff, ctx) => {
  const pp = pipeParams(spec);
  if (!pp?.stage || !pp.won.length) return null;
  const rows = rowsOf(eff).filter((r) => pp.closed.includes(String(r[pp.stage!] ?? "")));
  if (rows.length < 10) return null;
  const won = rows.filter((r) => pp.won.includes(String(r[pp.stage!])));
  const rate = won.length / rows.length;
  const amt = S.sum(rows.map((r) => numAt(r, pp.amount) ?? 0));
  const rateV = amt ? S.sum(won.map((r) => numAt(r, pp.amount) ?? 0)) / amt : NaN;
  const g = spec.encoding.x;
  let spreadPts = 0;
  let detail = "";
  let best = "";
  let worstTxt = "";
  if (g) {
    const by = new Map<string, { n: number; w: number }>();
    for (const r of rows) {
      const k = String(r[g] ?? "?");
      const e = by.get(k) ?? { n: 0, w: 0 };
      e.n++;
      if (pp.won.includes(String(r[pp.stage!]))) e.w++;
      by.set(k, e);
    }
    const list = [...by.entries()].filter(([, e]) => e.n >= 5).map(([k, e]) => ({ k, r: e.w / e.n, n: e.n })).sort((a, b) => b.r - a.r);
    if (list.length >= 2) {
      const b = list[0]!;
      const w = list[list.length - 1]!;
      spreadPts = (b.r - w.r) * 100;
      best = b.k;
      detail = `de ${formatPct(w.r)} à ${formatPct(b.r)} selon ${nounOf(g).sg === "commercial" ? "le commercial" : `${nounOf(g).sg}`}`;
      worstTxt = `${b.k} : ${formatPct(b.r)} sur ${count(b.n, "affaire conclue", "affaires conclues")} ; ${w.k} : ${formatPct(w.r)}.`;
    }
  }
  return {
    kind: "pipelineConversion",
    title: `Taux de transformation de ${formatPct(rate)}${detail ? ` : ${detail}` : ""}`,
    comments: [
      Number.isFinite(rateV) ? `En valeur : ${formatPct(rateV)} des montants conclus sont gagnés.` : `${count(won.length, "affaire gagnée", "affaires gagnées")} sur ${formatInt(rows.length)}.`,
      worstTxt || `${count(won.length, "affaire gagnée", "affaires gagnées")} sur ${formatInt(rows.length)} conclues.`,
      best ? `Recommandation : diffuser les pratiques de ${best}.` : `${count(rows.length - won.length, "affaire perdue", "affaires perdues")}.`,
    ],
    why: spreadPts ? `Écart de ${formatPoints(spreadPts).replace("+", "")} de taux de transformation entre ${nounOf(g!).pl}.` : "Le taux de transformation mesure l'efficacité commerciale.",
    role: "revelation",
    effect: S.clamp01(0.2 + spreadPts / 50),
    coverage: S.clamp01(rows.length / Math.max(1, ctx.ds.rows.length)),
    scope: "affaires conclues (gagnées ou perdues)",
    facts: { winRate: rate, winRateValue: Number.isFinite(rateV) ? rateV : "", spreadPts, closedDeals: rows.length },
  };
};

const analyzeGeo: Analyzer = (spec, eff, ctx) => {
  const yField = spec.encoding.y[0];
  const place = str(spec.story.params.place) ?? ctx.roles.city?.name ?? ctx.roles.region?.name ?? spec.encoding.postal;
  if (!yField || !place || !columnOf(eff, place)) return null;
  const by = new Map<string, number>();
  for (const r of rowsOf(eff)) {
    const k = r[place];
    const v = numAt(r, yField);
    if (k == null || k === "" || v == null) continue;
    by.set(String(k), (by.get(String(k)) ?? 0) + v);
  }
  if (by.size < 2) return null;
  const pairs = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const tot = S.sum(pairs.map((p) => p[1]));
  const n = Math.min(3, pairs.length - 1);
  const share = S.sum(pairs.slice(0, n).map((p) => p[1])) / tot;
  const u = measureUnit(spec, yField, ctx);
  const noun = nounOf(place);
  let fr = 0;
  let be = 0;
  const postal = spec.encoding.postal;
  if (postal) {
    for (const r of rowsOf(eff)) {
      const p = String(r[postal] ?? "").replace(/\s/g, "");
      const v = numAt(r, yField) ?? 0;
      if (/^\d{4}$/.test(p)) be += v;
      else if (/^\d{5}$/.test(p)) fr += v;
    }
  }
  const mLabel = measureLabel(yField);
  const comments = [`${count(pairs.length, noun.sg, noun.pl)} ${agree(noun, plural(pairs.length, "représenté"), plural(pairs.length, "représentée"))} ; premier : ${pairs[0]![0]} (${fm(pairs[0]![1], u)}).`];
  if (fr + be > 0 && fr > 0 && be > 0) comments.push(`France : ${formatPct(fr / (fr + be))} ; Belgique : ${formatPct(be / (fr + be))}.`);
  comments.push(`${agree(noun, "Les autres", "Les autres")} ${noun.pl} pèsent ${formatPct(1 - share)}.`);
  return {
    kind: "geo",
    title: `${joinList(pairs.slice(0, n).map((p) => p[0]))} : ${formatPct(share)} ${ctx.roles.isPipeline && isOpenFilter(spec, ctx.roles.stage?.name ?? null) ? "du pipeline ouvert" : partitive(mLabel)}`,
    comments,
    why: "Lecture territoriale : où se concentre l'activité en France et en Belgique.",
    role: "context",
    effect: S.clamp01(0.25 + (share - n / pairs.length) * 0.6),
    coverage: S.clamp01(S.sum(pairs.map((p) => p[1])) / Math.max(1, S.sum(rowsOf(eff).map((r) => numAt(r, yField) ?? 0)))),
    facts: { top: pairs[0]![0], share, places: pairs.length },
  };
};

const analyzeCorrelation: Analyzer = (spec, eff, ctx) => {
  const x = spec.encoding.x;
  const y = spec.encoding.y[0];
  if (!x || !y || columnOf(eff, x)?.type !== "number") return null;
  const pts = rowsOf(eff).map((r) => [numAt(r, x), numAt(r, y)] as const).filter((p): p is readonly [number, number] => p[0] != null && p[1] != null);
  if (pts.length < 5) return null;
  const r = S.pearson(pts.map((p) => p[0]), pts.map((p) => p[1]));
  const a = Math.abs(r);
  const strength = a >= 0.7 ? "fort" : a >= 0.4 ? "modéré" : "faible";
  const smallSample = pts.length < 10;
  return {
    kind: "correlation",
    title: `Lien ${strength} entre ${measureLabel(x)} et ${measureLabel(y)} (r = ${formatNumber(r, 2)})`,
    comments: [
      `${count(pts.length, "point")} ; ${r >= 0 ? "les deux mesures évoluent dans le même sens" : "les deux mesures évoluent en sens inverse"}.`,
      `R² = ${formatNumber(r * r, 2)} : ${formatPct(r * r)} de la variation de ${measureLabel(y)} va de pair avec ${measureLabel(x)}.`,
      ...(smallSample ? [`Échantillon réduit (${count(pts.length, "point")}) : lien à confirmer sur plus de données.`] : []),
    ],
    why: "Une corrélation n'est pas une causalité, mais elle oriente l'analyse.",
    role: "revelation",
    effect: S.clamp01(a) * (smallSample ? 0.75 : 1),
    coverage: S.clamp01(pts.length / Math.max(1, ctx.ds.rows.length)),
    facts: { r, n: pts.length },
  };
};

const analyzeTotal: Analyzer = (spec, eff, ctx) => {
  const y = spec.encoding.y[0];
  const n = eff.rows.length;
  if (!n) return null;
  const u = measureUnit(spec, y, ctx);
  const tot = y ? S.sum(rowsOf(eff).map((r) => numAt(r, y) ?? 0)) : n;
  const label = y ? measureLabel(y) : "lignes";
  const film = spec.type === "film";
  const lab = spec.encoding.label ? nounOf(spec.encoding.label) : ctx.roles.isPipeline ? { sg: "affaire", pl: "affaires" } : { sg: "ligne", pl: "lignes" };
  return {
    kind: film ? "film" : "total",
    title: film ? `${count(n, lab.sg, lab.pl)} pour ${fm(tot, u)} : chaque arc est une ${lab.sg === "affaire" ? "affaire" : "ligne"}` : `${capitalize(label)} : ${fm(tot, u)} au total`,
    comments: [`${count(n, lab.sg, lab.pl)} ; moyenne ${fm(tot / n, u)}.`],
    why: "Vue d'ensemble.",
    role: "context",
    effect: 0.2,
    coverage: 1,
    facts: { total: tot, rows: n },
  };
};

export const ANALYZERS: Record<InsightKind, Analyzer> = {
  trend: analyzeTrend,
  concentration: analyzeConcentration,
  ranking: analyzeRanking,
  seasonality: analyzeSeasonality,
  outlier: analyzeOutlier,
  variance: analyzeVariance,
  pipelineWeighted: analyzeWeighted,
  pipelineSlipping: analyzeSlipping,
  pipelineAging: analyzeAging,
  pipelineConversion: analyzeConversion,
  pipelineCloseMonth: analyzeCloseMonth,
  geo: analyzeGeo,
  correlation: analyzeCorrelation,
  film: analyzeTotal,
  total: analyzeTotal,
};

/* ------------------------------------------------------------------ detectors */

type Param = string | number | boolean | string[] | null;
type Cand = ChartSpecInput & { story: { kind: InsightKind; params?: Record<string, Param> } };

function maxAbsOf(ds: Dataset, f: string): number {
  let m = 0;
  for (const r of ds.rows) {
    const v = numAt(r, f);
    if (v != null && Math.abs(v) > m) m = Math.abs(v);
  }
  return m;
}

function aggFor(ctx: Ctx, f: string): "sum" | "mean" {
  return ctx.roles.pctMeasures.has(f) ? "mean" : "sum";
}

/** Unité d'axe selon l'ordre de grandeur des totaux affichés (≈ somme / nb de clés). */
function unitForTotals(ctx: Ctx, f: string, groups: number): ChartSpecInput["axes"] {
  const pct = ctx.roles.pctMeasures.has(f);
  const cur = ctx.roles.currency.has(f) || /€/.test(f);
  const tot = S.sum(ctx.ds.rows.map((r) => Math.abs(numAt(r, f) ?? 0)));
  const typical = pct ? 100 : Math.max(maxAbsOf(ctx.ds, f), tot / Math.max(1, groups));
  const u = axisUnitFor(typical, cur, pct);
  return { y: { unit: u.unit, decimals: u.decimals } };
}

function pipeBase(ctx: Ctx): Record<string, Param> {
  const r = ctx.roles;
  return {
    amount: r.amount!.name,
    stage: r.stage?.name ?? null,
    closed: closedValues(r),
    won: r.wonValues,
    prob: r.probability?.name ?? null,
    close: r.closeDate?.name ?? null,
    created: r.createdDate?.name ?? null,
    owner: r.owner?.name ?? null,
  };
}

function openFilter(ctx: Ctx) {
  const r = ctx.roles;
  if (r.stage && closedValues(r).length) return [{ field: r.stage.name, op: "notIn" as const, values: closedValues(r), label: "affaires ouvertes" }];
  if (r.probability) return [{ field: r.probability.name, op: "gt" as const, value: 0, label: "affaires ouvertes" }, { field: r.probability.name, op: "lt" as const, value: 100, label: "" }];
  return [];
}

function detect(ctx: Ctx): Cand[] {
  const r = ctx.roles;
  const out: Cand[] = [];
  const ds = ctx.ds;
  if (!r.amount && !r.measures.length) return out;
  const amount = r.amount ?? r.measures[0]!;
  const measures = [amount, ...r.measures.filter((m) => m !== amount && !Object.values(r.scenarios).includes(m))].slice(0, 3);
  const pipe = r.isPipeline;
  const open = pipe ? openFilter(ctx) : [];

  /* tendance */
  if (r.mainDate) {
    const span = (() => {
      const v = ds.rows.map((x) => numAt(x, r.mainDate!.name)).filter((x): x is number => x != null);
      return v.length ? (Math.max(...v) - Math.min(...v)) / DAY : 0;
    })();
    const grain = span > 365 * 6 ? "year" : span > 120 ? "month" : span > 30 ? "week" : "day";
    for (const m of measures.slice(0, 2)) {
      const ys = [m.name];
      if (r.scenarios.actual === m && r.scenarios.forecast) ys.push(r.scenarios.forecast.name);
      const filters: any[] = [];
      const maxT = Math.max(...ds.rows.map((x) => numAt(x, r.mainDate!.name) ?? -Infinity));
      if (pipe && maxT >= ctx.monthStart) filters.push({ field: r.mainDate.name, op: "lt", value: ctx.monthStart, label: `hors mois en cours` });
      out.push({
        type: "line",
        encoding: { x: r.mainDate.name, y: ys, xGrain: grain, aggregate: aggFor(ctx, m.name) },
        axes: unitForTotals(ctx, m.name, Math.max(1, span / 30)),
        transform: { filters },
        style: { valueLabels: false },
        story: { kind: "trend", params: pipe && m === amount ? { subject: `montant des opportunités créées` } : {} },
      });
    }
  }

  /* concentration + classement */
  const catCols = r.categories.filter((c) => c !== r.stage || !pipe);
  const concCols = [r.account, ...catCols.filter((c) => c !== r.account)].filter((c): c is NonNullable<typeof c> => !!c && c.cardinality >= 3).slice(0, 4);
  for (const c of concCols) {
    for (const m of [amount]) {
      if (r.pctMeasures.has(m.name)) continue;
      let qual: string | null = null;
      if (pipe && r.closeDate) {
        const op = ds.rows.filter((x) => !closedValues(r).includes(String(x[r.stage?.name ?? ""] ?? "")));
        const q = bucketDate(ctx.today, "quarter");
        const qEnd = Date.UTC(new Date(q).getUTCFullYear(), new Date(q).getUTCMonth() + 3, 1);
        const tot = S.sum(op.map((x) => numAt(x, m.name) ?? 0));
        const inQ = S.sum(op.filter((x) => { const t = numAt(x, r.closeDate!.name); return t != null && t >= q && t < qEnd; }).map((x) => numAt(x, m.name) ?? 0));
        if (tot && inQ / tot >= 0.6) qual = quarterOf(ctx.today).split(" ")[0]!;
      }
      out.push({
        type: c.cardinality > 8 ? "barH" : "bar",
        encoding: { x: c.name, y: [m.name], aggregate: "sum", topN: c.cardinality > 10 ? 10 : null, others: true },
        axes: unitForTotals(ctx, m.name, Math.min(c.cardinality, 10)),
        transform: { filters: open },
        style: { sort: "desc", valueLabels: true },
        story: { kind: "concentration", params: { qual } },
      });
    }
  }
  const rankCols = [...new Set([r.owner, r.region, ...catCols.filter((c) => c.cardinality <= 15).sort((a, b) => Math.abs(a.cardinality - 6) - Math.abs(b.cardinality - 6))])].filter(
    (c): c is NonNullable<typeof c> => !!c && c.cardinality >= 3 && c.cardinality <= 30 && (!pipe || c !== r.stage)
  );
  const rankMeasures = r.mainDate ? measures.slice(0, 2) : r.measures.slice(0, 5);
  for (const c of rankCols.slice(0, 3)) {
    for (const m of rankMeasures) {
      out.push({
        type: c.cardinality > 8 ? "barH" : "bar",
        encoding: { x: c.name, y: [m.name], aggregate: aggFor(ctx, m.name) },
        axes: unitForTotals(ctx, m.name, c.cardinality),
        transform: { filters: pipe ? open : [] },
        style: { sort: "desc", valueLabels: true },
        story: { kind: "ranking" },
      });
    }
  }

  /* saisonnalité */
  const seasonDate = r.scenarios.actual ? r.mainDate : pipe ? r.closeDate : r.mainDate;
  if (seasonDate) {
    const m = r.scenarios.actual ?? amount;
    const filters: any[] = [{ field: seasonDate.name, op: "lte", value: ctx.today, label: "" }];
    if (pipe && r.wonValues.length && r.stage) filters.push({ field: r.stage.name, op: "in", values: r.wonValues, label: "affaires gagnées" });
    out.push({
      type: "line",
      encoding: { x: "Mois de l'année", y: [m.name], series: "Année", aggregate: "sum" },
      axes: unitForTotals(ctx, m.name, 24),
      transform: { calculate: [{ as: "Mois de l'année", op: "monthOfYear", a: seasonDate.name }, { as: "Année", op: "year", a: seasonDate.name }], filters },
      style: { curve: "monotone" },
      story: { kind: "seasonality", params: { date: seasonDate.name } },
    });
  }

  /* valeurs atypiques (ligne à ligne) */
  if (!r.scenarios.actual) {
    const m = amount;
    const x = r.createdDate ?? r.mainDate;
    if (x && !r.pctMeasures.has(m.name)) {
      out.push({
        type: "scatter",
        encoding: { x: x.name, y: [m.name], label: r.label?.name ?? r.account?.name ?? null, series: r.stage?.name ?? null },
        axes: { y: { unit: axisUnitFor(maxAbsOf(ds, m.name), r.currency.has(m.name)).unit } },
        style: { legend: "top" },
        story: { kind: "outlier" },
      });
    } else if (!x && r.label && !r.pctMeasures.has(m.name)) {
      // Sans date : les plus grosses lignes, une barre chacune
      out.push({
        type: "barH",
        encoding: { x: r.label.name, y: [m.name], aggregate: "sum", label: r.label.name, topN: 15, others: false },
        axes: { y: { unit: axisUnitFor(maxAbsOf(ds, m.name), r.currency.has(m.name)).unit } },
        style: { sort: "desc", valueLabels: true },
        story: { kind: "outlier" },
      });
    }
  }

  /* écarts (scénarios) */
  const act = r.scenarios.actual;
  if (act) {
    const yearFilter = r.mainDate ? [{ field: "Année", op: "in" as const, values: [String(ctx.year)], label: String(ctx.year) }] : [];
    const yearCalc = r.mainDate ? [{ as: "Année", op: "year" as const, a: r.mainDate.name }] : [];
    const groupCols = r.categories.filter((c) => c.cardinality >= 2 && c.cardinality <= 15);
    for (const ref of ["budget", "py", "forecast"] as Scenario[]) {
      const refCol = r.scenarios[ref];
      if (!refCol) continue;
      for (const g of groupCols.slice(0, 3)) {
        out.push({
          type: "variance",
          encoding: { x: g.name, y: [act.name, refCol.name], aggregate: "sum" },
          axes: unitForTotals(ctx, act.name, g.cardinality * 3),
          transform: { calculate: yearCalc, filters: yearFilter },
          variance: { polarity: "higher", show: "abs" },
          story: { kind: "variance", params: { year: r.mainDate ? ctx.year : null } },
        });
      }
      if (r.mainDate && ref === "budget") {
        out.push({
          type: "variance",
          encoding: { x: r.mainDate.name, y: [act.name, refCol.name], xGrain: "month", aggregate: "sum" },
          axes: unitForTotals(ctx, act.name, 4),
          transform: { calculate: yearCalc, filters: yearFilter },
          story: { kind: "variance", params: { year: ctx.year } },
        });
      }
    }
    // Atterrissage : réel + prévision vs budget, année en cours
    if (r.scenarios.forecast && r.scenarios.budget && r.mainDate) {
      const g = groupCols[0];
      out.push({
        type: "variance",
        encoding: { x: g?.name ?? null, y: ["Atterrissage (€)", r.scenarios.budget.name], aggregate: "sum" },
        axes: unitForTotals(ctx, act.name, (g?.cardinality ?? 1) * 1),
        transform: { calculate: [...yearCalc, { as: "Atterrissage (€)", op: "coalesce", a: act.name, b: r.scenarios.forecast.name }], filters: yearFilter },
        story: { kind: "variance", params: { landing: true, year: ctx.year } },
      });
    }
  }

  /* pipeline */
  if (pipe) {
    const base = pipeBase(ctx);
    if (r.probability) {
      const sc = probScale(ds, r.probability.name);
      out.push({
        type: "groupedBar",
        encoding: { x: r.stage?.name ?? null, y: [amount.name, "Montant pondéré (€)"], aggregate: "sum" },
        axes: unitForTotals(ctx, amount.name, 4),
        transform: { calculate: [{ as: "Montant pondéré (€)", op: "mul", a: amount.name, b: r.probability.name, scale: sc }], filters: open },
        style: { valueLabels: true },
        story: { kind: "pipelineWeighted", params: base },
      });
    }
    if (r.closeDate) {
      out.push({
        type: r.stage ? "stackedBar" : "bar",
        encoding: { x: r.closeDate.name, xGrain: "month", y: [amount.name], series: r.stage?.name ?? null, aggregate: "sum" },
        axes: unitForTotals(ctx, amount.name, 4),
        transform: { filters: [...open, { field: r.closeDate.name, op: "gte", value: ctx.monthStart, label: `clôture à partir de ${monthYear(ctx.monthStart)}` }, { field: r.closeDate.name, op: "lte", value: ctx.yearEnd, label: `jusqu'à fin ${ctx.year}` }] },
        style: { valueLabels: false },
        story: { kind: "pipelineCloseMonth", params: base },
      });
      const g = r.owner ?? r.account;
      out.push({
        type: "barH",
        encoding: { x: g?.name ?? null, y: [amount.name], aggregate: "sum" },
        axes: unitForTotals(ctx, amount.name, 3),
        transform: { filters: [...open, { field: r.closeDate.name, op: "lt", value: ctx.today, label: `clôture prévue dépassée au ${dayMonthYear(ctx.today)}` }] },
        style: { sort: "desc", valueLabels: true },
        story: { kind: "pipelineSlipping", params: base },
      });
    }
    if (r.createdDate) {
      out.push({
        type: "bar",
        encoding: { x: "Ancienneté", y: [amount.name], aggregate: "sum" },
        axes: unitForTotals(ctx, amount.name, 3),
        transform: { calculate: [{ as: "Ancienneté", op: "ageBucket", a: r.createdDate.name, ref: ctx.today }], filters: open },
        style: { valueLabels: true, sort: "none" },
        story: { kind: "pipelineAging", params: base },
      });
    }
    if (r.stage && r.wonValues.length) {
      const g = r.owner ?? r.categories.find((c) => c !== r.stage && c.cardinality <= 15);
      out.push({
        type: "bar",
        encoding: { x: g?.name ?? null, y: ["Taux de transformation (%)"], aggregate: "mean" },
        axes: { y: { unit: "pct", decimals: 0, min: 0 } },
        transform: { calculate: [{ as: "Taux de transformation (%)", op: "flag", a: r.stage.name, values: r.wonValues }], filters: [{ field: r.stage.name, op: "in", values: closedValues(r), label: "affaires conclues" }] },
        style: { sort: "desc", valueLabels: true },
        story: { kind: "pipelineConversion", params: base },
      });
    }
  }

  /* corrélations entre mesures (petits tableaux de synthèse) */
  if (!r.mainDate && !pipe) {
    const ms = r.measures.slice(0, 5);
    const lab = r.categories[0]?.name ?? r.label?.name ?? null;
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        if (r.pctMeasures.has(ms[i]!.name) && r.pctMeasures.has(ms[j]!.name)) continue;
        out.push({ type: "scatter", encoding: { x: ms[i]!.name, y: [ms[j]!.name], label: lab, size: null }, axes: { y: { unit: axisUnitFor(maxAbsOf(ds, ms[j]!.name), r.currency.has(ms[j]!.name), r.pctMeasures.has(ms[j]!.name)).unit } }, story: { kind: "correlation" } });
      }
  }

  /* géographie */
  const amountForMap = r.scenarios.actual ?? amount;
  const mapStart = r.createdDate ?? r.mainDate;
  if (mapStart && !r.pctMeasures.has(amountForMap.name)) {
    if (r.postal) {
      out.push({
        type: "map",
        encoding: { x: mapStart.name, end: r.closeDate?.name ?? null, y: [amountForMap.name], postal: r.postal.name, label: r.label?.name ?? null, series: null },
        mode: { kind: "static" },
        special: { mapRegion: "fr-be" },
        transform: { filters: pipe ? open : [] },
        story: { kind: "geo", params: { place: r.city?.name ?? r.region?.name ?? r.postal.name } },
      });
    } else if (r.region && regionsMappable(ds, r.region.name)) {
      out.push({
        type: "map",
        encoding: { x: mapStart.name, y: [amountForMap.name], postal: "Code postal (région)", label: r.region.name },
        mode: { kind: "static" },
        special: { mapRegion: "fr-be" },
        transform: { calculate: [{ as: "Code postal (région)", op: "regionPostal", a: r.region.name }], filters: [] },
        story: { kind: "geo", params: { place: r.region.name } },
      });
    }
  }
  return out;
}

const PRIOR: Record<InsightKind, number> = {
  variance: 1,
  pipelineSlipping: 0.95,
  concentration: 0.9,
  pipelineCloseMonth: 0.8,
  pipelineWeighted: 0.75,
  pipelineConversion: 0.75,
  trend: 0.75,
  pipelineAging: 0.7,
  seasonality: 0.65,
  ranking: 0.6,
  geo: 0.55,
  outlier: 0.5,
  correlation: 0.4,
  film: 0.2,
  total: 0.1,
};

/** Groupe de quasi-doublons : même kind + même axe X, ou concentration/classement sur la même colonne. */
function baseDupGroup(i: Insight): string {
  const x = i.spec.encoding.x ?? "";
  if (i.kind === "concentration" || i.kind === "ranking") return `cat:${x}:${i.spec.encoding.y[0]}`;
  if (i.kind === "variance") return `var:${i.spec.encoding.y[1]}:${i.spec.story.params.landing ? "L" : ""}`;
  if (i.kind === "trend") return `trend`;
  if (i.kind === "correlation") return `corr:${i.spec.encoding.x}`;
  return i.kind;
}

export interface ExploreOptions {
  min?: number;
  max?: number;
}

/** Ajuste l'unité d'axe (€ / k€ / M€) aux valeurs réellement tracées (après filtres et agrégat). */
function fitUnit(spec: ChartSpec, eff: Dataset): void {
  const u = spec.axes.y.unit;
  if (!["eur", "keur", "meur", "k", "M", "none"].includes(u)) return;
  if (["scatter", "film", "map", "variance", "pie", "donut"].includes(spec.type)) return;
  try {
    const m = buildCatModel(spec, eff, allRows(eff));
    const vals = m.values.flat().filter(Number.isFinite).map(Math.abs);
    if (!vals.length) return;
    const stacked = spec.type === "stackedBar" || spec.type === "stackedArea";
    const max = stacked ? Math.max(...m.keys.map((_, k) => m.values.reduce((a, row) => a + (Number.isFinite(row[k]!) ? Math.abs(row[k]!) : 0), 0))) : Math.max(...vals);
    const cur = u === "eur" || u === "keur" || u === "meur";
    if (!cur && u === "none" && max < 2e4) return;
    const next = axisUnitFor(max, cur);
    spec.axes.y.unit = next.unit;
    spec.axes.y.decimals = next.decimals;
  } catch {
    /* garde l'unité proposée */
  }
}

/** Analyse les colonnes et renvoie 5 à 8 insights classés, sans quasi-doublons. */
/** Tous les candidats valides, analysés et notés (avant sélection). */
export function allInsights(ds: Dataset, sc: StoryContext): Insight[] {
  if (!ds.rows.length) return [];
  const ctx = makeCtx(ds, sc);
  const all: Insight[] = [];
  for (const cand of detect(ctx)) {
    const parsed = chartSpecSchema.safeParse(cand);
    if (!parsed.success) continue;
    const spec = parsed.data;
    spec.story.basis = basisOf(spec);
    const eff = effectiveDataset(spec, ds);
    fitUnit(spec, eff);
    let a: Analysis | null = null;
    try {
      a = ANALYZERS[cand.story.kind](spec, eff, ctx);
    } catch {
      a = null;
    }
    if (!a) continue;
    const score = 0.6 * a.effect + 0.25 * a.coverage + 0.15 * PRIOR[a.kind];
    all.push({ id: `${a.kind}:${spec.encoding.x ?? ""}:${spec.encoding.y.join("+")}:${spec.type}`, kind: a.kind, score, effect: a.effect, coverage: a.coverage, spec, analysis: a });
  }
  return all;
}

export function explore(ds: Dataset, sc: StoryContext, opts: ExploreOptions = {}): Insight[] {
  const max = opts.max ?? 8;
  const min = opts.min ?? 5;
  if (!ds.rows.length) return [];
  const all = allInsights(ds, sc);
  // dédoublonnage strict (id) puis sélection gloutonne avec pénalité de répétition
  // La carte FR/BE couvre déjà la répartition par ville / région : pas de barres en doublon sur la même colonne
  const geoKeys = new Set(all.filter((i) => i.kind === "geo").map((i) => `${String(i.spec.story.params.place ?? "")}|${i.spec.encoding.y[0]}`));
  const dupGroup = (i: Insight) => ((i.kind === "concentration" || i.kind === "ranking") && geoKeys.has(`${i.spec.encoding.x ?? ""}|${i.spec.encoding.y[0]}`) ? "geo" : baseDupGroup(i));
  const byId = new Map<string, Insight>();
  for (const i of all) if (!byId.has(i.id) || byId.get(i.id)!.score < i.score) byId.set(i.id, i);
  const pool = [...byId.values()].sort((a, b) => b.score - a.score);
  const chosen: Insight[] = [];
  const groups = new Set<string>();
  const kinds = new Map<InsightKind, number>();
  const titles = new Set<string>();
  while (chosen.length < max && pool.length) {
    let bestI = -1;
    let bestS = -Infinity;
    pool.forEach((p, i) => {
      if (groups.has(dupGroup(p)) || titles.has(p.analysis.title)) return;
      if ((kinds.get(p.kind) ?? 0) >= (p.kind === "correlation" ? 2 : 3)) return;
      const s = p.score * Math.pow(0.7, kinds.get(p.kind) ?? 0);
      if (s > bestS) (bestS = s), (bestI = i);
    });
    if (bestI < 0) break;
    const p = pool.splice(bestI, 1)[0]!;
    if (chosen.length >= min && p.score < 0.25) break;
    chosen.push(p);
    groups.add(dupGroup(p));
    titles.add(p.analysis.title);
    kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  }
  // Types « incontournables » quand ils existent (carte, écarts, retards) : remplacent le moins bon doublon de type
  for (const must of ["geo", "variance", "pipelineSlipping"] as InsightKind[]) {
    if (chosen.some((c) => c.kind === must)) continue;
    const cand = pool.find((p) => p.kind === must);
    if (!cand) continue;
    const clash = chosen.findIndex((c) => dupGroup(c) === dupGroup(cand));
    if (clash >= 0) chosen.splice(clash, 1, cand);
    else if (chosen.length < max) chosen.push(cand);
    else {
      const counts = new Map<InsightKind, number>();
      chosen.forEach((c) => counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1));
      const victims = chosen.filter((c) => !["geo", "variance", "pipelineSlipping"].includes(c.kind)).sort((a, b) => a.score - b.score);
      const v = victims.find((c) => (counts.get(c.kind) ?? 0) > 1) ?? victims[0];
      if (v) chosen.splice(chosen.indexOf(v), 1, cand);
    }
    pool.splice(pool.indexOf(cand), 1);
  }
  // Complément si moins de `min` : on relâche la contrainte de groupe
  for (const p of pool) {
    if (chosen.length >= min) break;
    if (!titles.has(p.analysis.title)) (chosen.push(p), titles.add(p.analysis.title));
  }
  return chosen.sort((a, b) => b.score - a.score);
}

export { allInsights as detectCandidates, distinctValues };
