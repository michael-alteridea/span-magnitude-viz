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

const CITIES: [string, string][] = [
  ["Paris", "75008"],
  ["Lyon", "69002"],
  ["Marseille", "13001"],
  ["Toulouse", "31000"],
  ["Bordeaux", "33000"],
  ["Lille", "59000"],
  ["Nantes", "44000"],
  ["Strasbourg", "67000"],
  ["Rennes", "35000"],
  ["Nice", "06000"],
  ["Montpellier", "34000"],
  ["Bruxelles", "1000"],
  ["Liège", "4000"],
  ["Gand", "9000"],
  ["Anvers", "2000"],
  ["Namur", "5000"],
];
const OWNERS = ["Camille Martin", "Hugo Lefèvre", "Léa Dubois", "Nicolas Peeters", "Sarah Janssens"];
const OFFERS = ["Audit", "Licence", "Accompagnement", "Formation", "Tableau de bord", "Intégration"];

function pipelineRows(): Record<string, unknown>[] {
  const r = rng(4242);
  const t0 = Date.UTC(2025, 0, 6);
  const today = Date.UTC(2026, 9, 8);
  const endOfYear = Date.UTC(2026, 11, 31);
  const day = 86400000;
  const rows: Record<string, unknown>[] = [];
  const n = 160;
  for (let i = 0; i < n; i++) {
    // Densité croissante vers aujourd'hui
    const u = Math.pow(r(), 0.8);
    const created = t0 + Math.floor(u * ((today - t0) / day)) * day;
    let close = created + Math.round(20 + r() * 140) * day;
    let stage: string;
    if (close <= today) {
      stage = r() < 0.58 ? "Gagnée" : "Perdue";
    } else {
      const s = r();
      stage = s < 0.35 ? "Qualification" : s < 0.7 ? "Proposition" : "Négociation";
      if (close > endOfYear) close = today + Math.round(25 + r() * ((endOfYear - today) / day - 25)) * day;
    }
    const [city, postal] = CITIES[Math.floor(r() * CITIES.length)]!;
    const amount = Math.round(Math.exp(8.6 + r() * 2.9) / 100) * 100;
    rows.push({
      Réf: `OPP-${String(i + 1).padStart(4, "0")}`,
      Opportunité: `${OFFERS[Math.floor(r() * OFFERS.length)]} ${city} ${i + 1}`,
      "Créée le": iso(created),
      "Clôture (prévue)": iso(close),
      "Montant (€)": amount,
      Étape: stage,
      Ville: city,
      "Code postal": postal,
      Commercial: OWNERS[Math.floor(r() * OWNERS.length)],
    });
  }
  rows.sort((a, b) => String(a["Créée le"]).localeCompare(String(b["Créée le"])));
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
    name: "Pipeline commercial FR·BE",
    description: "160 opportunités créées de janv. 2025 au 8 oct. 2026 · clôtures prévues jusqu'au 31/12/2026",
    rows: pipelineRows,
    spec: {
      type: "film",
      encoding: {
        x: "Créée le",
        end: "Clôture (prévue)",
        y: ["Montant (€)"],
        series: "Étape",
        label: "Opportunité",
        postal: "Code postal",
        time: "Créée le",
      },
      mode: { kind: "dynamic" },
      axes: { y: { unit: "eur" } },
      style: {
        title: "Pipeline commercial : chaque arc est une opportunité",
        subtitle: "Largeur = cycle de vente, épaisseur = montant · janv. 2025 → déc. 2026",
        source: "Source : CRM de démonstration Alteridea",
      },
    },
  },
];

export function sampleById(id: string | null | undefined): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
