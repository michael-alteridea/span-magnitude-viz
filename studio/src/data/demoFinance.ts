/**
 * Jeu de démonstration « réel 2025 vs budget 2026 » — données 100 % FICTIVES (société, comptes et montants
 * inventés), générées de façon déterministe (graine fixe) pour le scénario « Directeur financier » :
 * cascade Réel 2025 → facteurs → Budget 2026, puis ligne métier → revenus / coûts par compte → mois.
 *
 * Format « long » (une ligne = version × mois × ligne métier × compte × région) :
 *   version ; mois ; ligne_metier ; nature ; compte ; entite ; region ; montant_eur
 * Les coûts sont des montants positifs (nature = « Coûts ») : la marge contributive vaut revenus − coûts.
 *
 * Histoire intégrée (vérifiée par les tests) — marge contributive 18,1 M€ (réel 2025) → 17,7 M€ (budget 2026) :
 *  - Plateforme : +2,1 M€ (+2,6 M€ de revenus, dont 2,0 M€ d'abonnements annuels, et +0,5 M€ de coûts, surtout
 *    l'infrastructure) ; trois quarts de la hausse au second semestre (nouveaux contrats à partir de juillet) ;
 *  - Équipements : −3,0 M€ : le contrat d'un distributeur d'Île-de-France s'arrête fin février 2026
 *    (−3,6 M€ de revenus de mars à décembre, −0,6 M€ de sous-traitance associée) ;
 *  - Services +0,4 M€, Licences +0,3 M€, Formation −0,2 M€ ;
 *  - par région : l'Île-de-France recule (contrat perdu), les quatre autres régions progressent.
 *
 * Utilisé par l'exemple intégré « Démo : réel vs budget » et par `studio/scripts/make-demo-finance.ts`, qui
 * écrit `studio/public/demo/finance-reel-2025-budget-2026.csv`.
 */
import { frDecimal, mulberry32 } from "./demoPipeline";

export const FIN_SEED = 20261009;
export const FIN_CSV_NAME = "finance-reel-2025-budget-2026.csv";
export const FIN_FROM = "Réel 2025";
export const FIN_TO = "Budget 2026";

export const FIN_COLUMNS = ["version", "mois", "ligne_metier", "nature", "compte", "entite", "region", "montant_eur"] as const;
export type FinRow = Record<(typeof FIN_COLUMNS)[number], string | number>;

export const FIN_REGIONS = [
  { name: "Bruxelles", entity: "Norvia Belgique SA", w: 0.24 },
  { name: "Flandre", entity: "Norvia Belgique SA", w: 0.2 },
  { name: "Wallonie", entity: "Norvia Belgique SA", w: 0.14 },
  { name: "Hauts-de-France", entity: "Norvia France SAS", w: 0.14 },
  { name: "Île-de-France", entity: "Norvia France SAS", w: 0.28 },
] as const;

type Nature = "Revenus" | "Coûts";
interface Account {
  line: string;
  nature: Nature;
  name: string;
  /** Montants annuels en k€ : réel 2025, budget 2026. */
  a: number;
  b: number;
}

/** Plan de comptes fictif (k€ par an). */
export const FIN_ACCOUNTS: Account[] = [
  { line: "Plateforme", nature: "Revenus", name: "Abonnements annuels", a: 5200, b: 7200 },
  { line: "Plateforme", nature: "Revenus", name: "Mise en service", a: 1600, b: 1950 },
  { line: "Plateforme", nature: "Revenus", name: "Options premium", a: 1200, b: 1450 },
  { line: "Plateforme", nature: "Coûts", name: "Coûts d'infrastructure", a: 2400, b: 2850 },
  { line: "Plateforme", nature: "Coûts", name: "Support client", a: 800, b: 850 },
  { line: "Équipements", nature: "Revenus", name: "Contrats distributeurs", a: 5400, b: 1800 },
  { line: "Équipements", nature: "Revenus", name: "Ventes PME", a: 2400, b: 2400 },
  { line: "Équipements", nature: "Revenus", name: "Pièces détachées", a: 1200, b: 1200 },
  { line: "Équipements", nature: "Coûts", name: "Équipe technique", a: 2800, b: 2800 },
  { line: "Équipements", nature: "Coûts", name: "Sous-traitance", a: 1200, b: 600 },
  { line: "Services", nature: "Revenus", name: "Conseil", a: 7000, b: 7500 },
  { line: "Services", nature: "Revenus", name: "Intégration", a: 5000, b: 5400 },
  { line: "Services", nature: "Coûts", name: "Consultants", a: 7500, b: 7900 },
  { line: "Services", nature: "Coûts", name: "Sous-traitance services", a: 1500, b: 1600 },
  { line: "Licences", nature: "Revenus", name: "Licences perpétuelles", a: 2500, b: 2300 },
  { line: "Licences", nature: "Revenus", name: "Renouvellements", a: 3500, b: 4100 },
  { line: "Licences", nature: "Coûts", name: "Redevances éditeurs", a: 1500, b: 1600 },
  { line: "Formation", nature: "Revenus", name: "Sessions inter", a: 1800, b: 1600 },
  { line: "Formation", nature: "Revenus", name: "Sessions intra", a: 1200, b: 1200 },
  { line: "Formation", nature: "Coûts", name: "Formateurs", a: 1600, b: 1600 },
  { line: "Formation", nature: "Coûts", name: "Salles et logistique", a: 600, b: 600 },
];

/** Distributeur perdu (Équipements, Île-de-France) : part mensuelle 2025 et dernier mois facturé en 2026 (février). */
const LOST = { revenue: 360, cost: 60, lastMonth2026: 1 };

/** Saisonnalité mensuelle (indice, moyenne ≈ 1) par ligne métier. */
const SEASON: Record<string, number[]> = {
  Plateforme: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  "Équipements": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  Services: [1.02, 1.05, 1.1, 1.06, 1.04, 1.08, 0.86, 0.55, 1.08, 1.1, 1.06, 1.0],
  Licences: [0.85, 0.85, 1.05, 0.9, 0.9, 1.05, 0.85, 0.7, 1.0, 0.95, 1.1, 1.8],
  Formation: [0.9, 1.1, 1.2, 1.15, 1.1, 1.1, 0.6, 0.2, 1.1, 1.25, 1.2, 1.1],
};
/** Plateforme 2026 : répartition mensuelle de la hausse vs 2025 (25 % au S1, 75 % au S2 : nouveaux contrats dès juillet). */
const PLATFORM_UPLIFT = [50, 60, 75, 90, 105, 120, 220, 235, 250, 255, 265, 275];
/** Plateforme 2025 : montée en charge régulière. */
const PLATFORM_RAMP = Array.from({ length: 12 }, (_, m) => 0.9 + (0.2 * m) / 11);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const norm = (xs: number[]) => {
  const t = sum(xs);
  return xs.map((x) => x / t);
};

/** Profil mensuel (k€, somme = annuel) d'un compte pour une version, hors distributeur perdu. */
function monthly(acc: Account, year: 2025 | 2026, annual: number): number[] {
  if (acc.line === "Plateforme") {
    const base = norm(PLATFORM_RAMP).map((w) => w * acc.a);
    if (year === 2025) return base;
    const up = norm(PLATFORM_UPLIFT).map((w) => w * (acc.b - acc.a));
    return base.map((v, m) => v + up[m]!);
  }
  return norm(SEASON[acc.line]!).map((w) => w * annual);
}

/** Lignes du jeu (ordre : version, mois, ligne métier, compte, région). */
export function demoFinanceRows(): FinRow[] {
  const rnd = mulberry32(FIN_SEED);
  const out: FinRow[] = [];
  for (const [year, version] of [
    [2025, FIN_FROM],
    [2026, FIN_TO],
  ] as const) {
    // Tirages par compte puis normalisation exacte au montant annuel (centimes)
    for (const acc of FIN_ACCOUNTS) {
      const annual = year === 2025 ? acc.a : acc.b;
      const lostShare = acc.name === "Contrats distributeurs" ? LOST.revenue : acc.name === "Sous-traitance" ? LOST.cost : 0;
      const lostMonths = Array.from({ length: 12 }, (_, m) => (lostShare && (year === 2025 || m <= LOST.lastMonth2026) ? lostShare : 0));
      const rest = annual - sum(lostMonths);
      const prof = monthly(acc, year, rest);
      const k = rest / sum(prof);
      const cells: { m: number; r: number; v: number }[] = [];
      for (let m = 0; m < 12; m++) {
        const target = prof[m]! * k;
        const draws = FIN_REGIONS.map((rg) => rg.w * (1 + (rnd() - 0.5) * 0.16));
        const dn = norm(draws);
        FIN_REGIONS.forEach((_, r) => cells.push({ m, r, v: target * dn[r]! * (1 + (rnd() - 0.5) * 0.04) }));
      }
      // Normalisation exacte du reste, puis ajout du distributeur perdu (Île-de-France)
      const tot = sum(cells.map((c) => c.v));
      for (const c of cells) {
        let v = (c.v * rest) / tot;
        if (FIN_REGIONS[c.r]!.name === "Île-de-France") v += lostMonths[c.m]!;
        const eur = Math.round(v * 1000 * 100) / 100;
        const rg = FIN_REGIONS[c.r]!;
        out.push({
          version,
          mois: `${year}-${String(c.m + 1).padStart(2, "0")}`,
          ligne_metier: acc.line,
          nature: acc.nature,
          compte: acc.name,
          entite: rg.entity,
          region: rg.name,
          montant_eur: eur,
        });
      }
    }
  }
  const order = (r: FinRow) => `${r.version === FIN_FROM ? 0 : 1}|${r.mois}|${FIN_ACCOUNTS.findIndex((a) => a.name === r.compte && a.line === r.ligne_metier).toString().padStart(2, "0")}|${FIN_REGIONS.findIndex((g) => g.name === r.region)}`;
  return out.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

/** CSV « ; », virgule décimale (centimes), UTF-8, LF. */
export function demoFinanceCsv(rows: FinRow[] = demoFinanceRows()): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [FIN_COLUMNS.join(";")];
  for (const row of rows) lines.push(FIN_COLUMNS.map((c) => esc(typeof row[c] === "number" ? frDecimal(row[c] as number) : String(row[c]))).join(";"));
  return lines.join("\n") + "\n";
}
