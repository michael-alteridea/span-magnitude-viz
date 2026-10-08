/**
 * Jeux d'exemple intégrés — générés de façon déterministe et ancrés sur la date du jour
 * de la V1 (8 octobre 2026) : réel jusqu'à septembre 2026, prévisions jusqu'à fin 2026.
 */
import type { ChartSpecInput } from "../spec";

export const SAMPLE_TODAY = "2026-10-08";

export interface Sample {
  id: string;
  name: string;
  description: string;
  rows: () => Record<string, unknown>[];
  /** Spec suggéré au chargement. */
  spec: ChartSpecInput;
}

function rng(seed: number) {
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
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

function ventesRows(): Record<string, unknown>[] {
  const r = rng(2026);
  const regions = [
    { name: "Île-de-France", base: 182000, growth: 0.11 },
    { name: "Auvergne-Rhône-Alpes", base: 121000, growth: 0.14 },
    { name: "Hauts-de-France", base: 76000, growth: 0.07 },
    { name: "Occitanie", base: 68000, growth: 0.18 },
    { name: "Belgique", base: 54000, growth: 0.22 },
  ];
  const season = [0.86, 0.9, 1.02, 0.98, 1.0, 1.04, 0.92, 0.7, 1.06, 1.1, 1.12, 1.2];
  const rows: Record<string, unknown>[] = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 0; m < 12; m++) {
      const forecast = y === 2026 && m >= 9; // octobre → décembre 2026
      for (const reg of regions) {
        const years = y - 2024 + m / 12;
        const trend = reg.base * Math.pow(1 + reg.growth, years);
        const noise = forecast ? 1 : 0.92 + r() * 0.16;
        const ca = trend * season[m]! * noise;
        const marge = 30 + reg.growth * 40 + (r() - 0.5) * 4 - (m === 7 ? 3 : 0);
        rows.push({
          Mois: `${y}-${String(m + 1).padStart(2, "0")}-01`,
          Région: reg.name,
          "Chiffre d'affaires (€)": round(ca, 0),
          "Marge (%)": round(marge, 1),
          Commandes: Math.round(ca / (380 + r() * 60)),
          Statut: forecast ? "Prévision" : "Réel",
        });
      }
    }
  }
  return rows;
}

function canauxRows(): Record<string, unknown>[] {
  const data: [string, number, number, number][] = [
    ["SEO & contenu", 38500, 1840, 92],
    ["Google Ads", 182000, 2960, 118],
    ["LinkedIn Ads", 96400, 820, 57],
    ["Salons & événements", 128000, 410, 49],
    ["Partenaires", 24800, 365, 61],
    ["E-mailing", 6900, 1120, 38],
    ["Recommandation", 2500, 214, 44],
  ];
  return data.map(([canal, budget, leads, clients]) => ({
    Canal: canal,
    "Budget 2026 (€)": budget,
    Leads: leads,
    "Clients signés": clients,
    "Coût par lead (€)": round(budget / leads, 2),
    "Taux de conversion (%)": round((clients / leads) * 100, 1),
  }));
}

/* ------------------------------------------------------------------ Pipeline Salesforce */

const CITIES: [string, string, string][] = [
  ["Paris", "75008", "France"],
  ["Lyon", "69002", "France"],
  ["Marseille", "13001", "France"],
  ["Toulouse", "31000", "France"],
  ["Bordeaux", "33000", "France"],
  ["Lille", "59000", "France"],
  ["Nantes", "44000", "France"],
  ["Strasbourg", "67000", "France"],
  ["Rennes", "35000", "France"],
  ["Montpellier", "34000", "France"],
  ["Bruxelles", "1000", "Belgique"],
  ["Liège", "4000", "Belgique"],
  ["Gand", "9000", "Belgique"],
  ["Anvers", "2000", "Belgique"],
  ["Namur", "5000", "Belgique"],
  ["Charleroi", "6000", "Belgique"],
];
/** Comptes fictifs (ville d'implantation = index dans CITIES). Les 3 premiers sont les grands comptes. */
const ACCOUNTS: [string, number][] = [
  ["Groupe Vandermeulen", 13], ["Solvane Industries", 1], ["Hexalis Santé", 0],
  ["Brasserie Lambiek", 10], ["Transports Mertens", 12], ["Atelier Roussel", 4], ["Coopérative Agrinord", 5],
  ["Clinique Saint-Rémy", 11], ["Banque Delvigne", 10], ["Maison Fabre & Fils", 2], ["Optima Logistique", 6],
  ["Verlaine Assurances", 0], ["Studio Kaléo", 8], ["Métallerie Jacquet", 7], ["Groupe Hennaux", 15],
  ["Pharmacies Leroy", 3], ["Cimenteries Dubrulle", 14], ["Électro Moselle", 7], ["Domaine des Cèdres", 9],
  ["Ateliers Vauban", 5], ["Nordis Énergie", 12], ["Hôtels Belvue", 2], ["Groupe Castel", 4],
  ["Imprimerie Gaspard", 1], ["Laboratoires Orphée", 3], ["Mutuelle Ardennaise", 14], ["Keramis", 13],
  ["Socotra Bâtiment", 9], ["Vins Mazeau", 4], ["Polyclinique Rive Gauche", 0], ["Adequa Conseil", 6],
  ["Textiles Moreau", 5], ["Agence Lumen", 10], ["Bois & Forêts Wallons", 15], ["Distrilux", 11],
  ["Groupe Peyrac", 3], ["Fromageries Leclou", 8], ["Ville de Namur", 14], ["Campus Horizon", 1], ["Novacare", 11],
];
const OWNERS: [string, number][] = [
  ["Camille Martin", 0.64], ["Nicolas Peeters", 0.56], ["Sarah Janssens", 0.5], ["Léa Dubois", 0.46], ["Thomas Girard", 0.38], ["Hugo Lefèvre", 0.27],
];
const OFFERS: [string, number][] = [["Audit", 0.7], ["Licence", 1.5], ["Accompagnement", 1], ["Formation", 0.45], ["Tableau de bord", 0.9], ["Intégration", 1.8]];
const SOURCES = ["Site web", "Salon", "Partenaire", "Recommandation", "Prospection", "Webinaire"];
const STAGE_PROBA: Record<string, number> = { Prospection: 10, Qualification: 20, Proposition: 50, Négociation: 75, "Fermée gagnée": 100, "Fermée perdue": 0 };

function pipelineRows(): Record<string, unknown>[] {
  const r = rng(4242);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const day = 86400000;
  const t0 = Date.UTC(2025, 0, 6);
  const today = Date.UTC(2026, 9, 8);
  const rows: Record<string, unknown>[] = [];
  const add = (o: { created: number; close: number; stage: string; account: [string, number]; owner: string; amount: number; offer: string; type?: string }) => {
    const [city, postal, country] = CITIES[o.account[1]]!;
    rows.push({
      "Nom de l'opportunité": `${o.account[0]} – ${o.offer}`,
      Compte: o.account[0],
      Propriétaire: o.owner,
      Étape: o.stage,
      "Probabilité (%)": STAGE_PROBA[o.stage],
      "Montant (€)": Math.round(o.amount / 100) * 100,
      "Date de création": iso(o.created),
      "Date de clôture": iso(o.close),
      Type: o.type ?? (r() < 0.42 ? "Client existant" : "Nouveau client"),
      Source: pick(SOURCES),
      Ville: city,
      "Code postal": postal,
      Pays: country,
    });
  };
  const amountFor = (offer: string) => Math.exp(9.35 + r() * 1.9) * (OFFERS.find((x) => x[0] === offer)?.[1] ?? 1);
  const small = ACCOUNTS.slice(3);
  // 1. Affaires conclues (créées janv. 2025 → août 2026), clôtures concentrées en juin et décembre
  for (let i = 0; i < 176; i++) {
    const created = t0 + Math.floor(Math.pow(r(), 1.25) * ((Date.UTC(2026, 7, 20) - t0) / day)) * day;
    let close = created + Math.round(25 + r() * 120) * day;
    const cd = new Date(close);
    if (r() < 0.38) {
      // poussée de fin de semestre : fin juin / fin décembre suivant
      const m = cd.getUTCMonth();
      const target = m <= 5 ? Date.UTC(cd.getUTCFullYear(), 5, 18 + Math.floor(r() * 11)) : Date.UTC(cd.getUTCFullYear(), 11, 10 + Math.floor(r() * 12));
      if (target > created + 20 * day) close = target;
    }
    if (close > today - 2 * day) close = today - Math.round(3 + r() * 40) * day;
    if (close < created + 10 * day) close = created + 10 * day;
    const [owner, win] = pick(OWNERS);
    const offer = pick(OFFERS)[0];
    const acc = r() < 0.08 ? ACCOUNTS[Math.floor(r() * 3)]! : pick(small);
    add({ created, close, stage: r() < win ? "Fermée gagnée" : "Fermée perdue", account: acc, owner, amount: amountFor(offer), offer });
  }
  // 2. Grands comptes : 16 grosses affaires ouvertes à signer au T4 2026
  const keyOwners = ["Camille Martin", "Nicolas Peeters", "Sarah Janssens"];
  for (let i = 0; i < 16; i++) {
    const acc = ACCOUNTS[i % 3]!;
    const created = Date.UTC(2026, 1, 1) + Math.floor(r() * 220) * day;
    const close = Date.UTC(2026, 9, 20) + Math.floor(Math.pow(r(), 0.6) * 70) * day;
    const offer = pick(["Licence", "Intégration", "Accompagnement"] as const);
    add({ created, close, stage: pick(["Proposition", "Négociation", "Négociation", "Qualification"] as const), account: acc, owner: keyOwners[i % 3]!, amount: 190000 + r() * 260000, offer, type: "Client existant" });
  }
  // 3. Grappe d'affaires en retard : clôture prévue dépassée mais toujours ouvertes
  for (let i = 0; i < 22; i++) {
    const owner = i < 12 ? "Hugo Lefèvre" : i < 17 ? "Thomas Girard" : pick(OWNERS)[0];
    const close = Date.UTC(2026, 5, 10) + Math.floor(r() * 115) * day;
    const created = close - Math.round(70 + r() * 200) * day;
    const offer = pick(OFFERS)[0];
    add({ created, close: Math.min(close, today - 2 * day), stage: pick(["Proposition", "Négociation", "Qualification"] as const), account: pick(small), owner, amount: amountFor(offer) * 1.2, offer });
  }
  // 4. Affaires ouvertes courantes, clôtures oct. → déc. 2026 (dont quelques anciennes, créées en 2025)
  for (let i = 0; i < 86; i++) {
    const stale = i < 14;
    const created = stale ? t0 + Math.floor(r() * 240) * day : Date.UTC(2026, 0, 5) + Math.floor(Math.pow(r(), 0.6) * ((today - Date.UTC(2026, 0, 5)) / day)) * day;
    const u = r();
    const month = u < 0.27 ? 9 : u < 0.57 ? 10 : 11;
    const close = Math.max(today + 5 * day, Date.UTC(2026, month, 1 + Math.floor(r() * 28)));
    const offer = pick(OFFERS)[0];
    const s = r();
    const stage = s < 0.22 ? "Prospection" : s < 0.48 ? "Qualification" : s < 0.78 ? "Proposition" : "Négociation";
    add({ created, close, stage, account: pick(small), owner: pick(OWNERS)[0], amount: amountFor(offer), offer });
  }
  rows.sort((a, b) => String(a["Date de création"]).localeCompare(String(b["Date de création"])));
  return rows;
}

/* ------------------------------------------------------------------ Business review grand compte */

function businessReviewRows(): Record<string, unknown>[] {
  const r = rng(77);
  const products: [string, number, number, number][] = [
    // ligne, part du CA 2025, croissance réelle 2026, croissance budgétée 2026
    ["Solutions cloud", 0.3, 0.24, 0.2],
    ["Licences", 0.26, -0.06, 0.02],
    ["Services pro", 0.27, 0.05, 0.06],
    ["Maintenance", 0.17, 0.03, 0.03],
  ];
  const regions: [string, number, number][] = [
    // région, poids, facteur réel / budget 2026
    ["Île-de-France", 0.38, 1.02],
    ["Auvergne-Rhône-Alpes", 0.21, 1.01],
    ["Hauts-de-France", 0.13, 0.99],
    ["Nouvelle-Aquitaine", 0.13, 0.84],
    ["Bruxelles-Capitale", 0.15, 1.03],
  ];
  const season = [0.82, 0.88, 1.02, 0.95, 0.98, 1.14, 0.9, 0.6, 1.0, 1.05, 1.12, 1.54];
  const monthly2025 = 1_050_000;
  const actual2025 = new Map<string, number>();
  const rows: Record<string, unknown>[] = [];
  for (const y of [2025, 2026]) {
    for (let m = 0; m < 12; m++) {
      const isActual = y === 2025 || m <= 8; // réel jusqu'à septembre 2026
      for (const [prod, share, g26, b26] of products) {
        for (const [reg, w, fac] of regions) {
          const base = monthly2025 * share * w * season[m]!;
          const key = `${m}|${prod}|${reg}`;
          let actual: number | null = null;
          let budget: number;
          let py: number;
          let forecast: number | null = null;
          if (y === 2025) {
            actual = base * (0.93 + r() * 0.12);
            actual2025.set(key, actual);
            budget = base * (1.01 + r() * 0.02);
            py = base / (1 + g26 * 0.8) * (0.94 + r() * 0.1);
          } else {
            const ly = actual2025.get(key)!;
            budget = base * (1 + b26);
            py = ly;
            const real = base * (1 + g26) * fac * (0.94 + r() * 0.1);
            if (isActual) actual = real;
            else forecast = base * (1 + g26) * (fac < 0.9 ? 0.88 : fac) * 0.99;
          }
          rows.push({
            Mois: `${y}-${String(m + 1).padStart(2, "0")}-01`,
            "Ligne de produit": prod,
            Région: reg,
            "Réel (€)": actual == null ? null : round(actual, 0),
            "Budget (€)": round(budget, 0),
            "N-1 (€)": round(py, 0),
            "Prévision (€)": forecast == null ? null : round(forecast, 0),
          });
        }
      }
    }
  }
  return rows;
}

export const SAMPLES: Sample[] = [
  {
    id: "ventes",
    name: "Ventes mensuelles par région",
    description: "Jan. 2024 → déc. 2026 · 5 régions FR·BE · réel jusqu'à sept. 2026, prévisions oct.–déc. 2026",
    rows: ventesRows,
    spec: {
      type: "bar",
      encoding: { x: "Région", y: ["Chiffre d'affaires (€)"], series: null, time: "Mois", aggregate: "sum" },
      axes: { y: { unit: "meur", decimals: 1, title: "" }, x: { grid: false } },
      style: {
        title: "Chiffre d'affaires par région",
        subtitle: "Cumul janvier 2024 → décembre 2026 (prévisions incluses)",
        source: "Source : données de démonstration Alteridea · réel au 30/09/2026",
        sort: "desc",
        valueLabels: true,
      },
    },
  },
  {
    id: "canaux",
    name: "Canaux d'acquisition 2026",
    description: "Budget, leads et clients par canal — cumul au 8 octobre 2026",
    rows: canauxRows,
    spec: {
      type: "donut",
      encoding: { x: "Canal", y: ["Budget 2026 (€)"], aggregate: "sum" },
      axes: { y: { unit: "keur", decimals: 0 } },
      style: {
        title: "Où va le budget marketing ?",
        subtitle: "Répartition du budget 2026 par canal, au 8 octobre 2026",
        source: "Source : données de démonstration Alteridea",
        sort: "desc",
      },
    },
  },
  {
    id: "pipeline",
    name: "Pipeline Salesforce",
    description: "300 opportunités FR·BE (export type Salesforce) · créées de janv. 2025 au 8 oct. 2026 · clôtures prévues jusqu'au 31/12/2026",
    rows: pipelineRows,
    spec: {
      type: "film",
      encoding: {
        x: "Date de création",
        end: "Date de clôture",
        y: ["Montant (€)"],
        series: "Étape",
        label: "Nom de l'opportunité",
        postal: "Code postal",
        time: "Date de création",
      },
      mode: { kind: "dynamic" },
      axes: { y: { unit: "eur" } },
      style: {
        source: "Source : CRM de démonstration Alteridea (export Salesforce)",
      },
    },
  },
  {
    id: "business-review",
    name: "Business review grand compte",
    description: "Réel / Budget / N-1 / Prévision mensuels par ligne de produit et région · janv. 2025 → déc. 2026 · réel jusqu'à sept. 2026, prévision oct.–déc.",
    rows: businessReviewRows,
    spec: {
      type: "variance",
      encoding: { x: "Région", y: ["Réel (€)", "Budget (€)"], aggregate: "sum" },
      axes: { y: { unit: "keur", decimals: 0 } },
      transform: { calculate: [{ as: "Année", op: "year", a: "Mois" }], filters: [{ field: "Année", op: "in", values: ["2026"], label: "2026" }] },
      style: { source: "Source : business review de démonstration Alteridea · réel au 30/09/2026" },
    },
  },
];

export function sampleById(id: string | null | undefined): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
