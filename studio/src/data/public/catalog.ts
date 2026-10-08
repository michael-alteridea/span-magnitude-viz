/**
 * « Données publiques » : enregistrement des jeux ouverts (modules générés dans ce dossier) comme exemples du Studio,
 * et histoires suggérées de 3 à 5 snapshots pour « Créer un Reel ». Les titres et chiffres clés viennent du catalogue
 * généré (`index.ts`, calculés depuis les données) ; ce module ne fait que choisir graphiques, filtres et unités.
 * Les étapes « carte » du catalogue deviennent des classements en barres dans les histoires (le Reel ne dessine pas
 * le type Carte) ; les colonnes « Latitude » / « Longitude » permettent la carte dans le Studio.
 */
import type { ChartSpecInput, FilterSpec } from "../../spec";
import { parseSpec } from "../../spec";
import type { Snapshot } from "../../story/snapshots";
import { PUBLIC_SAMPLES, type PublicSample } from "./index";
import { EUROSTAT_FECONDITE } from "./eurostatFecondite";
import { NOAA_CO2 } from "./noaaCo2MaunaLoa";
import { ageMedianRows, belgiqueProvincesRows, co2FossileRows, detteRows, feconditeRows, gesRows, populationMondialeRows, zonesProtegeesRows } from "./rows";

type Row = Record<string, unknown>;
type Role = Snapshot["role"];

/** Thème du catalogue → libellé de la section « Données publiques ». */
export const THEME_OF: Record<PublicSample["theme"], "Dette publique" | "CO₂ & climat" | "Démographie" | "Nature"> = {
  dette: "Dette publique",
  climat: "CO₂ & climat",
  demographie: "Démographie",
  biodiversite: "Nature",
};

/* ------------------------------------------------------------------ lignes */

/** CO₂ Mauna Loa : une ligne par mois (mai 1974 →), hausse sur 12 mois calculée (ppm). */
export function co2Rows(): Row[] {
  const d = NOAA_CO2;
  const [y0, m0] = d.monthStart.split("-").map(Number) as [number, number];
  return d.monthly.map((v, i) => {
    const t = m0 - 1 + i;
    const prev = i >= 12 ? d.monthly[i - 12] : null;
    return {
      Mois: `${y0 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`,
      "CO₂ (ppm)": v,
      "CO₂ désaisonnalisé (ppm)": d.monthlyDeseasonalized[i] ?? null,
      "Hausse sur 12 mois (ppm)": prev != null && v != null ? Math.round((v - prev) * 100) / 100 : null,
    };
  });
}

/** Fécondité (2000 → 2024) et âge médian (2000 → 2025) réunis : une ligne par pays et par année. */
export function feconditeAgeRows(): Row[] {
  const byKey = new Map<string, Row>();
  const key = (r: Row) => `${r.Code}|${r.Année}`;
  for (const r of feconditeRows()) byKey.set(key(r), { ...r, "Âge médian (ans)": null });
  for (const r of ageMedianRows()) {
    const hit = byKey.get(key(r));
    if (hit) hit["Âge médian (ans)"] = r["Âge médian (ans)"];
    else byKey.set(key(r), { ...r, "Enfants par femme": null });
  }
  const order = EUROSTAT_FECONDITE.codes as readonly string[];
  return [...byKey.values()].sort((a, b) => order.indexOf(String(a.Code)) - order.indexOf(String(b.Code)) || String(a.Année).localeCompare(String(b.Année)));
}

const ROWS: Record<string, () => Row[]> = {
  "dette-publique-ue": detteRows,
  "co2-mauna-loa": co2Rows,
  "co2-fossile-pays": co2FossileRows,
  "ges-ue": gesRows,
  "fecondite-ue": feconditeAgeRows,
  "population-mondiale": populationMondialeRows,
  "belgique-age-provinces": belgiqueProvincesRows,
  "zones-protegees-ue": zonesProtegeesRows,
};

/* ------------------------------------------------------------------ histoires suggérées */

const NB = "\u00a0";
const year = (y: number) => Date.UTC(y, 0, 1);
const from = (y: number, field = "Année"): FilterSpec => ({ field, op: "gte", value: year(y), values: [], label: `depuis ${y}` });
const until = (y: number, field = "Année"): FilterSpec => ({ field, op: "lt", value: year(y + 1), values: [], label: `jusqu'en ${y}` });
const only = (y: number, field = "Année"): FilterSpec[] => [{ ...from(y, field), label: String(y) }, { ...until(y, field), label: String(y) }];
const inF = (field: string, values: string[], label = values.join(", ")): FilterSpec => ({ field, op: "in", values, value: null, label });
const notIn = (field: string, values: string[], label: string): FilterSpec => ({ field, op: "notIn", values, value: null, label });
const AGG_EU = ["UE-27", "Zone euro (20)"];

type Unit = { unit: "none" | "pct" | "eur" | "custom"; custom?: string; decimals?: number };
const PCT: Unit = { unit: "pct", decimals: 1 };
const u = (custom: string, decimals = 1): Unit => ({ unit: "custom", custom, decimals });

interface StepDef {
  /** Identifiant de l'étape du catalogue (titre et chiffres clés repris). */
  step: string;
  type: ChartSpecInput["type"];
  x: string | null;
  y: string[];
  series?: string | null;
  grain?: "year" | "month" | "none";
  aggregate?: "sum" | "mean" | "last";
  filters: FilterSpec[];
  unit: Unit;
  subtitle: string;
  sort?: "asc" | "desc";
  topN?: number;
  focus?: string;
  valueLabels?: boolean;
  /** Titre propre au graphique (sinon celui du catalogue). */
  title?: string;
  role?: Role;
}

const STORIES: Record<string, StepDef[]> = {
  "dette-publique-ue": [
    { step: "dette-01-ue", type: "line", x: "Année", y: ["Dette publique (% du PIB)"], grain: "year", filters: [inF("Pays", ["UE-27"], "UE-27")], unit: PCT, subtitle: "Dette publique brute en % du PIB, UE-27, 2000 → 2025" },
    { step: "dette-02-carte", type: "barH", x: "Pays", y: ["Dette publique (% du PIB)"], filters: [...only(2025), notIn("Pays", AGG_EU, "pays")], unit: PCT, subtitle: "Les 10 dettes les plus élevées de l'UE en % du PIB, 2025", sort: "desc", topN: 10, focus: "Grèce", valueLabels: true },
    { step: "dette-03-frbe", type: "line", x: "Année", y: ["Dette publique (% du PIB)"], series: "Pays", grain: "year", filters: [inF("Pays", ["France", "Belgique", "UE-27"])], unit: PCT, subtitle: "Dette publique en % du PIB : France, Belgique et UE-27, 2000 → 2025", focus: "France" },
    { step: "dette-04-habitant", type: "barH", x: "Pays", y: ["Dette par habitant (€)"], filters: [...only(2025), notIn("Pays", ["Zone euro (20)"], "pays et UE-27")], unit: { unit: "eur", decimals: 0 }, subtitle: "Dette publique par habitant fin 2025 (calcul : dette ÷ population au 1er janvier 2026), 10 premiers", sort: "desc", topN: 10, focus: "France", valueLabels: true },
  ],
  "co2-mauna-loa": [
    { step: "co2-01-courbe", type: "line", x: "Mois", y: ["CO₂ (ppm)"], grain: "year", aggregate: "mean", filters: [from(1975, "Mois"), until(2025, "Mois")], unit: u("ppm", 0), subtitle: "Moyenne annuelle du CO₂ atmosphérique à Mauna Loa (ppm), 1975 → 2025" },
    { step: "co2-02-dentscie", type: "line", x: "Mois", y: ["CO₂ (ppm)"], grain: "month", filters: [from(2021, "Mois")], unit: u("ppm", 0), subtitle: "Moyenne mensuelle (ppm), janv. 2021 → août 2026 : la respiration saisonnière de la végétation" },
    { step: "co2-03-acceleration", type: "bar", x: "Mois", y: ["Hausse sur 12 mois (ppm)"], grain: "year", aggregate: "mean", filters: [from(1976, "Mois"), until(2025, "Mois")], unit: u("ppm", 1), subtitle: "Hausse moyenne sur 12 mois, par année (ppm/an), 1976 → 2025" },
    { step: "co2-04-seuil", type: "bar", x: "Mois", y: ["CO₂ (ppm)"], grain: "year", aggregate: "mean", filters: [from(2016, "Mois"), until(2025, "Mois")], unit: u("ppm", 1), subtitle: "Moyenne annuelle (ppm), 2016 → 2025", valueLabels: true },
  ],
  "co2-fossile-pays": [
    { step: "gcb-01-monde", type: "line", x: "Année", y: ["CO₂ fossile (Mt)"], grain: "year", filters: [inF("Zone", ["Monde"])], unit: u("Mt", 0), subtitle: "Émissions mondiales de CO₂ fossile (Mt), 1990 → 2024" },
    { step: "gcb-02-qui", type: "barH", x: "Zone", y: ["CO₂ fossile (Mt)"], filters: [...only(2024), inF("Zone", ["Chine", "États-Unis", "Inde", "UE-27 (somme des 27)", "Allemagne", "Pologne", "Italie", "France"], "grands émetteurs")], unit: u("Mt", 0), subtitle: "Émissions de CO₂ fossile en 2024 (Mt) : Chine, États-Unis, Inde, UE-27 et ses plus grands émetteurs", sort: "desc", focus: "Chine", valueLabels: true },
    { step: "gcb-03-habitant", type: "barH", x: "Zone", y: ["CO₂ par habitant (t)"], filters: [...only(2024), notIn("Zone", ["Chine", "États-Unis", "Inde", "UE-27 (somme des 27)"], "pays de l'UE et monde")], unit: u("t", 1), subtitle: "CO₂ fossile par habitant en 2024 (t) : les 10 premiers pays de l'UE et la moyenne mondiale", sort: "desc", topN: 10, focus: "Luxembourg", valueLabels: true },
    { step: "gcb-04-frbe", type: "line", x: "Année", y: ["CO₂ fossile (Mt)"], series: "Zone", grain: "year", filters: [inF("Zone", ["Belgique", "France"])], unit: u("Mt", 0), subtitle: "Émissions de CO₂ fossile (Mt), Belgique et France, 1990 → 2024", focus: "France" },
  ],
  "ges-ue": [
    { step: "ges-01-ue", type: "line", x: "Année", y: ["GES (Mt éq. CO₂)"], grain: "year", filters: [inF("Pays", ["UE-27"])], unit: u("Mt", 0), subtitle: "Émissions de gaz à effet de serre de l'UE-27 (Mt éq. CO₂, hors UTCATF, aviation internationale incluse), 1990 → 2024" },
    { step: "ges-02-classement", type: "barH", x: "Pays", y: ["Indice 1990 = 100"], filters: [...only(2024), notIn("Pays", ["UE-27"], "pays")], unit: u("", 0), subtitle: "Émissions 2024, indice 1990 = 100 (sous 100 : baisse depuis 1990)", sort: "asc", focus: "Estonie", valueLabels: false },
    { step: "ges-03-habitant", type: "barH", x: "Pays", y: ["GES par habitant (t)"], filters: [...only(2024), notIn("Pays", ["UE-27"], "pays")], unit: u("t", 1), subtitle: "Émissions par habitant en 2024 (t éq. CO₂), 10 premiers pays", sort: "desc", topN: 10, focus: "Belgique", valueLabels: true },
    { step: "ges-04-frbe", type: "line", x: "Année", y: ["Indice 1990 = 100"], series: "Pays", grain: "year", filters: [inF("Pays", ["Belgique", "France", "UE-27"])], unit: u("", 0), subtitle: "Émissions de GES, indice 1990 = 100 : Belgique, France et UE-27, 1990 → 2024", focus: "Belgique" },
  ],
  "fecondite-ue": [
    { step: "fec-01-ue", type: "line", x: "Année", y: ["Enfants par femme"], grain: "year", filters: [inF("Pays", ["UE-27"]), from(2001), until(2024)], unit: u("", 2), subtitle: "Indicateur conjoncturel de fécondité (enfants par femme), UE-27, 2001 → 2024" },
    { step: "fec-02-carte", type: "barH", x: "Pays", y: ["Enfants par femme"], filters: [...only(2024), notIn("Pays", ["UE-27"], "pays")], unit: u("", 2), subtitle: "Enfants par femme en 2024, les 27 pays de l'UE", sort: "desc", focus: "Malte", valueLabels: false },
    { step: "fec-03-frbe", type: "line", x: "Année", y: ["Enfants par femme"], series: "Pays", grain: "year", filters: [inF("Pays", ["France", "Belgique", "UE-27"]), from(2001), until(2024)], unit: u("", 2), subtitle: "Enfants par femme : France, Belgique et UE-27, 2001 → 2024", focus: "France" },
    { step: "fec-04-age", type: "barH", x: "Pays", y: ["Âge médian (ans)"], filters: [...only(2025)], unit: u("ans", 1), subtitle: "Âge médian de la population au 1er janvier 2025 (ans), 10 pays les plus âgés et UE-27", sort: "desc", topN: 10, focus: "Italie", valueLabels: true },
  ],
  "population-mondiale": [
    { step: "wpp-01-monde", type: "area", x: "Année", y: ["Population (millions)"], grain: "year", filters: [inF("Zone", ["Monde"]), until(2024)], unit: u("M", 0), subtitle: "Population mondiale (millions), 1950 → 2024" },
    { step: "wpp-02-pic", type: "line", x: "Année", y: ["Population (millions)"], grain: "year", filters: [inF("Zone", ["Monde"])], unit: u("M", 0), subtitle: "Population mondiale (millions), 1950 → 2100 : projections de l'ONU (variante moyenne) à partir de 2024" },
    { step: "wpp-03-europe", type: "line", x: "Année", y: ["Population (millions)"], grain: "year", filters: [inF("Zone", ["Europe"])], unit: u("M", 0), subtitle: "Population de l'Europe (millions), 1950 → 2100, projections à partir de 2024" },
    { step: "wpp-04-pourquoi", type: "line", x: "Année", y: ["Enfants par femme"], grain: "year", filters: [inF("Zone", ["Monde"])], unit: u("", 2), subtitle: "Fécondité mondiale (enfants par femme), 1950 → 2100, projections à partir de 2024" },
  ],
  "belgique-age-provinces": [
    { step: "be-01-pays", type: "donut", x: null, y: ["0-17 ans", "18-64 ans", "65 ans et plus"], filters: [], unit: { unit: "none", decimals: 0 }, subtitle: "Population de la Belgique par âge au 1er janvier 2026 (somme des provinces)", focus: "65 ans et plus" },
    { step: "be-02-carte", type: "barH", x: "Province", y: ["Part des 65 ans et plus (%)"], filters: [], unit: PCT, subtitle: "Part des 65 ans et plus par province au 1er janvier 2026 (Bruxelles-Capitale comprise)", sort: "desc", focus: "Flandre occidentale", valueLabels: true },
    { step: "be-04-regions", type: "stackedBar", x: "Région", y: ["0-17 ans", "18-64 ans", "65 ans et plus"], filters: [], unit: { unit: "none", decimals: 0 }, subtitle: "Population par région et par âge au 1er janvier 2026" },
  ],
  "zones-protegees-ue": [
    { step: "zp-01-ue", type: "bar", x: "Année", y: ["Surface protégée (%)"], grain: "year", filters: [inF("Pays", ["UE-27"])], unit: PCT, subtitle: "Part de la surface terrestre protégée (Natura 2000 + aires nationales), UE-27, 2011 → 2023", valueLabels: true },
    { step: "zp-02-carte", type: "barH", x: "Pays", y: ["Surface protégée (%)"], filters: [...only(2023), notIn("Pays", ["UE-27"], "pays")], unit: PCT, subtitle: "Part de la surface terrestre protégée en 2023, 10 premiers pays", sort: "desc", topN: 10, focus: "Bulgarie", valueLabels: true },
    { step: "zp-03-frbe", type: "barH", x: "Pays", y: ["Surface protégée (%)"], filters: [...only(2023), inF("Pays", ["Bulgarie", "Luxembourg", "Allemagne", "UE-27", "France", "Pays-Bas", "Belgique", "Finlande"], "Belgique, voisins, UE-27 et extrêmes")], unit: PCT, subtitle: "Part de la surface terrestre protégée en 2023 : la Belgique, ses voisins, l'UE-27 et les extrêmes", sort: "desc", focus: "Belgique", valueLabels: true },
  ],
};

/** Ligne de source du cartouche : producteur et tableau, données adaptées, licence. */
export function sourceLineOf(p: PublicSample): string {
  const src = (p.data as { source?: string }).source ?? p.source;
  return `${src} · données adaptées · Licence : ${p.licence}`;
}

function specOf(p: PublicSample, d: StepDef, src: string): ChartSpecInput {
  const st = p.story.find((s) => s.id === d.step);
  const title = d.title ?? st?.title ?? p.title;
  return {
    type: d.type,
    encoding: { x: d.x, y: d.y, series: d.series ?? null, aggregate: d.aggregate ?? "sum", xGrain: d.grain ?? "none", ...(d.topN ? { topN: d.topN, others: false } : {}) },
    axes: { y: { unit: d.unit.unit, unitCustom: d.unit.custom ?? "", decimals: d.unit.decimals ?? 1, title: "" }, x: { grid: false } },
    transform: { filters: d.filters },
    style: {
      title,
      subtitle: d.subtitle,
      source: src,
      valueLabels: d.valueLabels ?? false,
      ...(d.sort ? { sort: d.sort } : {}),
      ...(d.focus ? { focus: { key: d.focus, title: "", note: "", average: d.type === "barH" || d.type === "bar" } } : {}),
    },
  } as ChartSpecInput;
}

/** Puces « À retenir » : chiffres clés du catalogue, sans doublon, 3 au plus. */
const bulletsOf = (p: PublicSample, step: string): string[] => [...new Set(p.story.find((s) => s.id === step)?.keyNumbers ?? [])].slice(0, 3).map((k) => k.replace(/ : /g, `${NB}: `));

export function publicStorySnapshots(id: string, now = new Date()): { title: string; snapshots: Snapshot[] } | null {
  const p = PUBLIC_SAMPLES.find((x) => x.id === id);
  const defs = STORIES[id];
  if (!p || !defs) return null;
  const src = sourceLineOf(p);
  const at = now.toISOString();
  const snapshots = defs.map((d) => {
    const parsed = parseSpec(specOf(p, d, src));
    if (!parsed.ok) throw new Error(`Données publiques : spec invalide (${d.step})`);
    const spec = parsed.spec;
    const step = p.story.find((s) => s.id === d.step);
    return {
      id: `${d.step}`,
      name: spec.style.title,
      createdAt: at,
      spec,
      svg: null,
      thumb: null,
      width: 1200,
      height: 675,
      title: spec.style.title,
      subtitle: spec.style.subtitle,
      comments: bulletsOf(p, d.step),
      source: src,
      kind: null,
      role: (d.role ?? step?.role ?? null) as Role,
      sampleId: id,
      dataName: p.title,
      generatedAt: at,
      path: [],
      scenario: null,
      step: null,
    } satisfies Snapshot;
  });
  return { title: p.title.replace(/\s*\([^)]*\)\s*$/, ""), snapshots };
}

/** Exemples « Données publiques » au format `Sample` (sans l'exemple Eurostat renouvelables, déclaré à part). */
export function publicSamples() {
  return PUBLIC_SAMPLES.filter((p) => ROWS[p.id] && STORIES[p.id]).map((p) => {
    const src = sourceLineOf(p);
    const first = STORIES[p.id]![0]!;
    return {
      id: p.id,
      name: p.title,
      description: p.description,
      rows: ROWS[p.id]!,
      spec: specOf(p, first, src),
      licence: p.licence.includes(producerOf(p)) ? p.licence : `${p.licence} (${producerOf(p)})`,
      publicData: {
        theme: THEME_OF[p.theme],
        licenceShort: `${producerOf(p)} · ${p.licence.replace(/\s*\(.*\)$/, "")}`,
        sourceLabel: src,
        page: (p.data as { page?: string }).page,
        reelCount: STORIES[p.id]!.length,
        reel: async () => publicStorySnapshots(p.id)!,
      },
    };
  });
}

function producerOf(p: PublicSample): string {
  const s = p.source;
  if (/Eurostat/.test(s)) return "Eurostat";
  if (/NOAA/.test(s)) return "NOAA";
  if (/Global Carbon/.test(s)) return "Global Carbon Project";
  if (/ONU|Nations unies/.test(s)) return "ONU";
  if (/Statbel/.test(s)) return "Statbel";
  return s.replace(/^Source : /, "").split(/[ ,(]/)[0] ?? "";
}
