/**
 * Rôles sémantiques des colonnes (montant, probabilité, étape, dates de création / clôture,
 * commercial, compte, géographie, scénarios Réel / Budget / Prévision / N-1). Heuristiques FR/EN.
 */
import type { Column, Dataset } from "../data/table";
import { regionToPostal } from "../data/transform";

export type Scenario = "actual" | "budget" | "forecast" | "py";
export const SCENARIO_LABELS: Record<Scenario, string> = { actual: "Réel", budget: "Budget", forecast: "Prévision", py: "N-1" };

const RE = {
  amount: /montant|amount|chiffre|\bca\b|revenue|revenu|valeur|value|prix|price|total|vente|sales|€|budget|co[uû]t|cost/i,
  probability: /probabilit|proba\b|chance|likelihood|probability/i,
  stage: /[ée]tape|stage|phase|statut|status/i,
  close: /cl[oô]ture|close|[ée]ch[ée]ance|signature|closing/i,
  created: /cr[ée]{1,2}[ée]?|creat|ouverture|date d'entr[ée]e|opened/i,
  owner: /commercial|owner|propri[ée]taire|vendeur|responsable|sales ?rep|account manager|chargé/i,
  account: /compte|account|client|customer|soci[ée]t[ée]|entreprise|raison sociale/i,
  postal: /postal|zip|^cp$/i,
  region: /r[ée]gion|pays|country|d[ée]partement|province|territoire|zone/i,
  city: /ville|city|localit/i,
  label: /nom|name|libell[ée]|opportunit|intitul|titre|title|d[ée]signation/i,
  pct: /%|taux|marge|ratio|rate|pourcent|part\b/i,
  scenario: {
    actual: /r[ée]el|actual|r[ée]alis[ée]|\bact\b|\bac\b/i,
    budget: /budget|\bplan\b|objectif|target|\bbu?d\b/i,
    forecast: /pr[ée]vision|forecast|\bfc\b|atterrissage|estim[ée]|\bfcst\b|landing/i,
    py: /n\s*-\s*1|\bpy\b|prior year|ann[ée]e pr[ée]c[ée]dente|an dernier|previous year|\bly\b|last year/i,
  } as Record<Scenario, RegExp>,
};

export const WON = /gagn|won|sign[ée]|closed won|r[ée]ussi|conclu/i;
export const LOST = /perdu|lost|abandon|annul|closed lost|[ée]chou|refus/i;

export interface Roles {
  measures: Column[];
  amount: Column | null;
  probability: Column | null;
  stage: Column | null;
  wonValues: string[];
  lostValues: string[];
  closeDate: Column | null;
  createdDate: Column | null;
  dates: Column[];
  /** Date principale des tendances (création pour un pipeline, sinon 1re date). */
  mainDate: Column | null;
  owner: Column | null;
  account: Column | null;
  postal: Column | null;
  region: Column | null;
  city: Column | null;
  label: Column | null;
  categories: Column[];
  /** Scénarios en colonnes (format large). */
  scenarios: Partial<Record<Scenario, Column>>;
  /** Pipeline : étape (+ montant) ou probabilité + clôture. */
  isPipeline: boolean;
  /** Mesures exprimées en % (agrégat moyenne). */
  pctMeasures: Set<string>;
  currency: Set<string>;
}

const by = (cols: Column[], re: RegExp) => cols.find((c) => re.test(c.name)) ?? null;

export function distinctValues(ds: Dataset, col: string, max = 500): string[] {
  const s = new Set<string>();
  for (const r of ds.rows) {
    const v = r[col];
    if (v != null && v !== "") s.add(String(v));
    if (s.size > max) break;
  }
  return [...s];
}

export function detectRoles(ds: Dataset): Roles {
  const cols = ds.columns;
  const numbers = cols.filter((c) => c.type === "number" && !c.idLike);
  const dates = cols.filter((c) => c.type === "date");
  const cats = cols.filter((c) => c.type === "category" || c.type === "text");

  const probability = numbers.find((c) => {
    if (!RE.probability.test(c.name)) return false;
    const v = ds.rows.map((r) => r[c.name]).filter((x): x is number => typeof x === "number");
    return v.length > 0 && Math.min(...v) >= 0 && Math.max(...v) <= 100;
  }) ?? null;

  const scenarios: Partial<Record<Scenario, Column>> = {};
  for (const sc of ["py", "forecast", "budget", "actual"] as Scenario[]) {
    const c = numbers.find((n) => RE.scenario[sc].test(n.name) && !Object.values(scenarios).includes(n));
    if (c) scenarios[sc] = c;
  }
  const pctMeasures = new Set(numbers.filter((c) => RE.pct.test(c.name) || c === probability).map((c) => c.name));
  const currency = new Set(numbers.filter((c) => /€|eur\b|euro|montant|amount|chiffre|\bca\b|revenue|budget|prix|price|co[uû]t|vente/i.test(c.name) && !pctMeasures.has(c.name)).map((c) => c.name));
  const measures = numbers.filter((c) => c !== probability);
  const amount =
    scenarios.actual ??
    measures.find((c) => RE.amount.test(c.name) && !pctMeasures.has(c.name)) ??
    measures.find((c) => !pctMeasures.has(c.name)) ??
    measures[0] ??
    null;

  const stage = cats.find((c) => RE.stage.test(c.name) && c.cardinality >= 2 && c.cardinality <= 20) ?? null;
  let wonValues: string[] = [];
  let lostValues: string[] = [];
  if (stage) {
    const vals = distinctValues(ds, stage.name);
    wonValues = vals.filter((v) => WON.test(v) && !LOST.test(v));
    lostValues = vals.filter((v) => LOST.test(v));
  }
  const closeDate = by(dates, RE.close);
  const createdDate = dates.find((d) => d !== closeDate && RE.created.test(d.name)) ?? null;
  const owner = cats.find((c) => RE.owner.test(c.name) && c.cardinality >= 2 && c.cardinality <= 60) ?? null;
  const account = cats.find((c) => c !== owner && RE.account.test(c.name) && c.cardinality >= 3) ?? null;
  const postal = cols.find((c) => RE.postal.test(c.name)) ?? null;
  const city = cats.find((c) => RE.city.test(c.name) && c.cardinality >= 2) ?? null;
  let region = cats.find((c) => RE.region.test(c.name) && c.cardinality >= 2 && c.cardinality <= 60) ?? null;
  if (region) {
    // pays « France / Belgique » seul : peu informatif comme région de carte, on garde quand même
  }
  const label =
    cats.find((c) => RE.label.test(c.name) && c.cardinality > ds.rows.length * 0.5) ??
    cats.find((c) => c.type === "text" && c.cardinality > ds.rows.length * 0.6) ??
    null;
  const isPipeline = !!amount && ((!!stage && (wonValues.length > 0 || lostValues.length > 0 || !!probability)) || (!!probability && !!closeDate));
  const mainDate = (isPipeline ? createdDate : null) ?? dates.find((d) => d !== closeDate) ?? dates[0] ?? null;
  const categories = cats.filter((c) => c !== label && c.cardinality >= 2 && c.cardinality <= 400 && c !== postal);
  return {
    measures,
    amount,
    probability,
    stage,
    wonValues,
    lostValues,
    closeDate,
    createdDate,
    dates,
    mainDate,
    owner,
    account,
    postal,
    region,
    city,
    label,
    categories,
    scenarios,
    isPipeline,
    pctMeasures,
    currency,
  };
}

/** Une colonne de régions est-elle cartographiable (≥ 60 % de valeurs reconnues) ? */
export function regionsMappable(ds: Dataset, col: string): boolean {
  const vals = distinctValues(ds, col, 80);
  if (!vals.length) return false;
  return vals.filter((v) => regionToPostal(v)).length / vals.length >= 0.6;
}

/** Valeurs d'étape « ouvertes » (ni gagnées ni perdues). */
export function closedValues(r: Roles): string[] {
  return [...r.wonValues, ...r.lostValues];
}
