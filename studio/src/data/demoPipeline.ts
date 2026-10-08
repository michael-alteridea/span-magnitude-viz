/**
 * Jeu de démonstration « pipeline commercial 2026 » — données 100 % FICTIVES (société, clients et
 * commerciaux inventés), générées de façon déterministe (graine fixe) pour le scénario de réunion
 * commerciale : trimestres → mois → régions → commercial.
 *
 * Société fictive basée à Bruxelles, qui vend en Belgique et dans le nord de la France (5 régions).
 * Opportunités créées du 2 janvier 2025 au 30 septembre 2026 (trimestres complets : l'extrait est
 * arrêté à fin T3 2026), clôtures prévues jusqu'au 31 décembre 2026. Date de l'extrait : 8 octobre 2026.
 *
 * Histoire intégrée (vérifiée par les tests) :
 *  - croissance régulière (≈ +20 %/an) avec un creux d'août partout (saisonnalité) ;
 *  - T2 2026 : seul trimestre en recul ;
 *  - juin 2026 : nettement sous la moyenne de mars–mai ;
 *  - la baisse de juin est concentrée en Wallonie ;
 *  - en Wallonie, Julie M. (grands comptes) n'a créé aucune opportunité en juin (absence sans relais),
 *    ses collègues sont stables ; elle reprend dès juillet.
 *
 * Utilisé par l'exemple intégré « Démo : pipeline commercial » et par le script
 * `studio/scripts/make-demo-pipeline.ts`, qui écrit `studio/public/demo/pipeline-commercial-2026.csv`.
 */

export const DEMO_SEED = 20261008;
/** Date de l'extrait (dernier jour couvert par les créations : 30/09/2026). */
export const DEMO_EXTRACT_DATE = "2026-10-08";
export const DEMO_FIRST_DAY = Date.UTC(2025, 0, 1);
export const DEMO_LAST_CREATION = Date.UTC(2026, 8, 30);
export const DEMO_LAST_CLOSE = Date.UTC(2026, 11, 31);
export const DEMO_CSV_NAME = "pipeline-commercial-2026.csv";

export const DEMO_COLUMNS = [
  "id_opportunite",
  "date_creation",
  "mois",
  "trimestre",
  "region",
  "pays",
  "commercial",
  "client",
  "secteur",
  "etape",
  "montant_eur",
  "probabilite_pct",
  "montant_pondere_eur",
  "date_cloture_prevue",
] as const;

export type DemoRow = Record<(typeof DEMO_COLUMNS)[number], string | number>;

export const DEMO_REGIONS = [
  { name: "Bruxelles", country: "Belgique" },
  { name: "Flandre", country: "Belgique" },
  { name: "Wallonie", country: "Belgique" },
  { name: "Hauts-de-France", country: "France" },
  { name: "Île-de-France", country: "France" },
] as const;

interface Rep {
  name: string;
  region: string;
  /** Opportunités créées par mois (au niveau de printemps 2026, hors saisonnalité). */
  rate: number;
  /** Montant médian d'une opportunité (€). */
  median: number;
  /** Mois (AAAA-MM) sans aucune création (absence). */
  absent?: string[];
}

/** Commerciaux fictifs (prénom + initiale). */
export const DEMO_REPS: Rep[] = [
  { name: "Sophie L.", region: "Bruxelles", rate: 6.0, median: 14000 },
  { name: "Karim B.", region: "Bruxelles", rate: 5.5, median: 13000 },
  { name: "Élise V.", region: "Bruxelles", rate: 4.9, median: 12000 },
  { name: "Pieter V.", region: "Flandre", rate: 6.0, median: 13500 },
  { name: "Lotte D.", region: "Flandre", rate: 5.6, median: 13000 },
  { name: "Jens M.", region: "Flandre", rate: 5.2, median: 12500 },
  { name: "Sarah W.", region: "Flandre", rate: 4.7, median: 11500 },
  { name: "Julie M.", region: "Wallonie", rate: 12.3, median: 26500, absent: ["2026-06"] },
  { name: "Antoine R.", region: "Wallonie", rate: 5.7, median: 12500 },
  { name: "Nadia B.", region: "Wallonie", rate: 5.2, median: 12000 },
  { name: "Olivier F.", region: "Wallonie", rate: 4.7, median: 11000 },
  { name: "Camille D.", region: "Hauts-de-France", rate: 5.2, median: 11500 },
  { name: "Thomas L.", region: "Hauts-de-France", rate: 4.8, median: 11000 },
  { name: "Inès K.", region: "Hauts-de-France", rate: 4.3, median: 10500 },
  { name: "Mathieu G.", region: "Île-de-France", rate: 6.0, median: 15000 },
  { name: "Claire P.", region: "Île-de-France", rate: 5.6, median: 14000 },
  { name: "Yanis A.", region: "Île-de-France", rate: 5.2, median: 13000 },
  { name: "Laura S.", region: "Île-de-France", rate: 4.7, median: 12500 },
];

/** Clients fictifs par région (noms inventés) et secteur. */
const CLIENTS: Record<string, [string, string][]> = {
  Bruxelles: [
    ["Atelier Brabo", "Services"], ["Banque Sablon", "Services financiers"], ["Clinique des Étangs", "Santé"], ["Cogeris", "Services"],
    ["Distrimarolles", "Distribution"], ["Énergie Senne", "Énergie"], ["Fondation Horta", "Secteur public"], ["Hôtel Mont-des-Arts", "Hôtellerie"],
    ["Logis Ixelles", "Construction"], ["Novacité", "Services"], ["Pharma Josaphat", "Santé"], ["Transports Cantersteen", "Logistique"],
  ],
  Flandre: [
    ["Brouwerij Scheldekant", "Agroalimentaire"], ["Delta Logistiek", "Logistique"], ["Haven Coatings", "Industrie"], ["Kempen Bouw", "Construction"],
    ["Leie Textiel", "Industrie"], ["Mercator Zorg", "Santé"], ["Noordzee Visserij", "Agroalimentaire"], ["Polder Energie", "Énergie"],
    ["Stad Mechelen-Oost", "Secteur public"], ["Vlasbloem Retail", "Distribution"], ["Westhoek Metaal", "Industrie"], ["Zennevallei Data", "Services"],
  ],
  Wallonie: [
    ["Ardenne Bois", "Industrie"], ["Carrières du Condroz", "Construction"], ["Clinique Mosane", "Santé"], ["Coopérative Hesbaye", "Agroalimentaire"],
    ["Fonderies de Sambre", "Industrie"], ["Groupe Famenne", "Distribution"], ["Hainaut Logistique", "Logistique"], ["Intercommunale Meuse-Ourthe", "Secteur public"],
    ["Laiterie des Fagnes", "Agroalimentaire"], ["Métallurgie Val-Saint-Lambert", "Industrie"], ["Namur Énergies", "Énergie"], ["Verreries du Borinage", "Industrie"],
  ],
  "Hauts-de-France": [
    ["Aciéries de l'Escaut", "Industrie"], ["Agrinord Picardie", "Agroalimentaire"], ["Clinique du Beffroi", "Santé"], ["Distri Flandres", "Distribution"],
    ["Filature de Roubaix-Est", "Industrie"], ["Logistique Opale", "Logistique"], ["Métropole Services", "Services"], ["Sucrerie de la Somme", "Agroalimentaire"],
    ["Ville de Lens-Nord", "Secteur public"], ["Verlinghem Énergie", "Énergie"],
  ],
  "Île-de-France": [
    ["Assurances Quai Branly", "Services financiers"], ["Bercy Conseil", "Services"], ["Clinique Montsouris-Sud", "Santé"], ["Défense Data", "Services"],
    ["Galeries Haussmann-Est", "Distribution"], ["Hexagone Énergie", "Énergie"], ["Île Logistique", "Logistique"], ["Marne Construction", "Construction"],
    ["Paris Saclay Labs", "Santé"], ["Seine Finance", "Services financiers"], ["Université Lutèce", "Éducation"], ["Versailles Patrimoine", "Secteur public"],
  ],
};

/** Saisonnalité de création par mois (août creux partout, rentrée forte). */
export const DEMO_SEASON = [0.9, 1.0, 1.1, 1.0, 1.0, 1.0, 1.08, 0.62, 1.25, 1.1, 1.05, 0.85];
/** Probabilité par étape (%). */
export const DEMO_STAGE_PROBA: Record<string, number> = { Prospection: 10, Qualification: 25, Proposition: 50, Négociation: 75, Gagné: 100, Perdu: 0 };
export const DEMO_STAGES = Object.keys(DEMO_STAGE_PROBA);

const DAY = 86400000;
/** Jours fériés communs FR · BE (aucune création ces jours-là). */
const HOLIDAYS = ["01-01", "05-01", "08-15", "11-01", "11-11", "12-25"];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ym = (t: number) => iso(t).slice(0, 7);

/** Format décimal français (virgule), 2 décimales si nécessaire. */
export function frDecimal(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

/** Lignes du jeu de démonstration (valeurs typées : nombres pour les montants, dates ISO en texte). */
export function demoPipelineRows(): DemoRow[] {
  const r = mulberry32(DEMO_SEED);
  const normal = () => {
    const u = Math.max(1e-9, r());
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const today = Date.parse(`${DEMO_EXTRACT_DATE}T00:00:00Z`);
  const out: Omit<DemoRow, "id_opportunite">[] = [];
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 0; m < 12; m++) {
      const start = Date.UTC(y, m, 1);
      if (start > DEMO_LAST_CREATION) break;
      const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      // Jours ouvrés du mois
      const workdays: number[] = [];
      for (let d = 1; d <= days; d++) {
        const t = Date.UTC(y, m, d);
        const wd = new Date(t).getUTCDay();
        if (wd !== 0 && wd !== 6 && !HOLIDAYS.includes(iso(t).slice(5))) workdays.push(t);
      }
      const years = (start - DEMO_FIRST_DAY) / (365.25 * DAY);
      const growth = 0.8 * Math.pow(1.2, years);
      for (const rep of DEMO_REPS) {
        if (rep.absent?.includes(ym(start))) continue;
        // Nombre d'opportunités et pipeline du mois (cible ± 5 %) : les montants tirés au hasard sont
        // ensuite remis à l'échelle de la cible, pour une histoire lisible malgré la petite taille des équipes
        const base = rep.rate * growth * DEMO_SEASON[m]!;
        const n = Math.max(1, Math.round(base * (0.9 + r() * 0.2)));
        const target = base * rep.median * 1.12 * (0.95 + r() * 0.1);
        const clients = CLIENTS[rep.region]!;
        const country = DEMO_REGIONS.find((x) => x.name === rep.region)!.country;
        const draws = Array.from({ length: n }, () => rep.median * Math.exp(0.6 * normal()));
        const k = target / draws.reduce((a, b) => a + b, 0);
        for (let i = 0; i < n; i++) {
          const created = workdays[Math.floor(r() * workdays.length)]!;
          const amount = Math.max(5000, Math.min(150000, Math.round((draws[i]! * k) / 10) * 10));
          const [client, sector] = clients[Math.floor(r() * clients.length)]!;
          const age = (today - created) / DAY;
          // Étape selon l'ancienneté (affaires anciennes : gagnées / perdues, quelques retards)
          const u = r();
          let stage: string;
          if (age > 150) stage = u < 0.31 ? "Gagné" : u < 0.93 ? "Perdu" : u < 0.97 ? "Négociation" : "Proposition";
          else if (age > 90) stage = u < 0.22 ? "Gagné" : u < 0.5 ? "Perdu" : u < 0.72 ? "Négociation" : "Proposition";
          else if (age > 40) stage = u < 0.08 ? "Gagné" : u < 0.2 ? "Perdu" : u < 0.42 ? "Négociation" : u < 0.78 ? "Proposition" : "Qualification";
          else stage = u < 0.03 ? "Perdu" : u < 0.15 ? "Proposition" : u < 0.55 ? "Qualification" : "Prospection";
          let close: number;
          if (stage === "Gagné" || stage === "Perdu") {
            const cycle = 25 + Math.floor(r() * 120);
            close = Math.min(created + cycle * DAY, today - (1 + Math.floor(r() * 10)) * DAY);
            if (close < created) close = created;
          } else {
            const ahead = Math.max(created + (45 + Math.floor(r() * 90)) * DAY, today + (7 + Math.floor(r() * 70)) * DAY);
            close = Math.min(ahead, DEMO_LAST_CLOSE - Math.floor(r() * 5) * DAY);
          }
          const proba = DEMO_STAGE_PROBA[stage]!;
          const d = new Date(created);
          out.push({
            date_creation: iso(created),
            mois: ym(created),
            trimestre: `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`,
            region: rep.region,
            pays: country,
            commercial: rep.name,
            client,
            secteur: sector,
            etape: stage,
            montant_eur: amount,
            probabilite_pct: proba,
            montant_pondere_eur: Math.round(amount * proba) / 100,
            date_cloture_prevue: iso(close),
          });
        }
      }
    }
  }
  out.sort((a, b) => String(a.date_creation).localeCompare(String(b.date_creation)) || String(a.commercial).localeCompare(String(b.commercial), "fr"));
  return out.map((o, i) => ({ id_opportunite: `OPP-${String(o.date_creation).slice(2, 4)}-${String(i + 1).padStart(5, "0")}`, ...o }) as DemoRow);
}

/** CSV « ; » (virgule décimale française), UTF-8, fin de ligne LF. */
export function demoPipelineCsv(rows: DemoRow[] = demoPipelineRows()): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [DEMO_COLUMNS.join(";")];
  for (const row of rows) lines.push(DEMO_COLUMNS.map((c) => esc(typeof row[c] === "number" ? frDecimal(row[c] as number) : String(row[c]))).join(";"));
  return lines.join("\n") + "\n";
}
