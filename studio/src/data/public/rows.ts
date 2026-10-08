/**
 * Mise à plat des modules « Données publiques » en lignes (même logique que renouvelablesRows() dans
 * studio/src/data/samples.ts) : une ligne par zone et par année, libellés français, colonnes « Code carte »,
 * « Latitude », « Longitude » pour la carte (type "map" : point-in-polygon sur le fond europe / fr-be).
 * Écrit à la main (non généré) ; ne contient aucune donnée.
 */
import { EUROSTAT_DETTE } from "./eurostatDettePublique";
import { NOAA_CO2 } from "./noaaCo2MaunaLoa";
import { GCB_CO2 } from "./gcbCo2Fossile";
import { EUROSTAT_GES } from "./eurostatGes";
import { EUROSTAT_FECONDITE } from "./eurostatFecondite";
import { ONU_WPP } from "./onuPopulationMondiale";
import { STATBEL_AGE } from "./statbelAgeProvinces";
import { EUROSTAT_ZONES_PROTEGEES } from "./eurostatZonesProtegees";

type Row = Record<string, unknown>;
type Num = number | null;
const at = (m: readonly (readonly Num[])[] | undefined, i: number, k: number): Num => (m?.[i]?.[k] ?? null) as Num;

interface Wide {
  readonly years: readonly number[];
  readonly codes: readonly string[];
  readonly names: readonly string[];
  readonly provisional: readonly (readonly number[])[];
  readonly mapIds?: readonly (string | null)[];
  readonly lat?: readonly (number | null)[];
  readonly lon?: readonly (number | null)[];
}

/** Une ligne par code × année ; `cols` : nom de colonne → matrice (codes × years). Lignes entièrement vides omises. */
function flatten(d: Wide, cols: Record<string, readonly (readonly Num[])[]>, zone = "Pays"): Row[] {
  const out: Row[] = [];
  d.codes.forEach((code, i) => {
    const prov = d.provisional[i] ?? [];
    d.years.forEach((y, k) => {
      const vals = Object.entries(cols).map(([name, m]) => [name, at(m, i, k)] as const);
      if (vals.every(([, v]) => v === null)) return;
      const r: Row = { [zone]: d.names[i], Code: code, Année: String(y) };
      for (const [name, v] of vals) r[name] = v;
      r["Statut"] = prov.includes(y) ? "provisoire" : "définitif";
      if (d.mapIds) r["Code carte"] = d.mapIds[i] ?? null;
      if (d.lat && d.lon) { r["Latitude"] = d.lat[i] ?? null; r["Longitude"] = d.lon[i] ?? null; }
      out.push(r);
    });
  });
  return out;
}

export function detteRows(): Row[] {
  const d = EUROSTAT_DETTE;
  const last = d.years[d.years.length - 1]!;
  return flatten(d, { "Dette publique (% du PIB)": d.values }).map((r) => {
    const i = d.codes.indexOf(r.Code as never);
    return r.Année === String(last) ? { ...r, "Dette (M€)": d.debtMeur[i] ?? null, "Dette par habitant (€)": d.perCapitaEur[i] ?? null } : r;
  });
}

/** CO₂ Mauna Loa : moyennes mensuelles depuis mai 1974 (colonne Mois = 1er du mois). */
export function co2MensuelRows(): Row[] {
  const d = NOAA_CO2;
  const [y0, m0] = d.monthStart.split("-").map(Number) as [number, number];
  return d.monthly.map((v, i) => {
    const t = m0 - 1 + i;
    return { Mois: `${y0 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`, "CO₂ (ppm)": v, "CO₂ désaisonnalisé (ppm)": d.monthlyDeseasonalized[i] ?? null };
  });
}

export function co2AnnuelRows(): Row[] {
  return NOAA_CO2.years.map((y, k) => ({ Année: String(y), "CO₂ (ppm)": NOAA_CO2.values[0]![k] ?? null }));
}

export function co2FossileRows(): Row[] {
  return flatten(GCB_CO2, { "CO₂ fossile (Mt)": GCB_CO2.values, "CO₂ par habitant (t)": GCB_CO2.perCapita }, "Zone");
}

export function co2ParSourceRows(): Row[] {
  const out: Row[] = [];
  for (const [src, vals] of Object.entries(GCB_CO2.worldByFuel)) GCB_CO2.years.forEach((y, k) => out.push({ Année: String(y), Source: src, "CO₂ fossile mondial (Mt)": vals[k] ?? null }));
  return out;
}

export function gesRows(): Row[] {
  const d = EUROSTAT_GES;
  return flatten(d, { "GES (Mt éq. CO₂)": d.values, "GES par habitant (t)": d.perCapita, "Indice 1990 = 100": d.index1990 });
}

export function feconditeRows(): Row[] {
  return flatten(EUROSTAT_FECONDITE, { "Enfants par femme": EUROSTAT_FECONDITE.values });
}

export function ageMedianRows(): Row[] {
  const d = EUROSTAT_FECONDITE;
  return flatten({ ...d, years: d.medianAgeYears, provisional: d.medianAgeProvisional }, { "Âge médian (ans)": d.medianAge });
}

export function populationMondialeRows(): Row[] {
  const d = ONU_WPP;
  return flatten(d, { "Population (millions)": d.values, "Enfants par femme": d.fertility, "Âge médian (ans)": d.medianAge, "Espérance de vie (ans)": d.lifeExpectancy }, "Zone").map((r) => ({
    ...r,
    Statut: Number(r.Année) >= d.firstProjectedYear ? "projection" : "estimation",
  }));
}

/** Provinces belges (fond FR · BE) : une ligne par province, au 1er janvier 2026. */
export function belgiqueProvincesRows(): Row[] {
  const d = STATBEL_AGE;
  return d.codes.map((code, i) => ({
    Province: d.names[i],
    "Code NIS": code,
    Région: d.regions[i],
    "Code carte": d.mapIds[i],
    Latitude: d.lat[i],
    Longitude: d.lon[i],
    Année: "2026",
    Population: d.population[i],
    "0-17 ans": d.age0to17[i],
    "18-64 ans": d.age18to64[i],
    "65 ans et plus": d.age65plus[i],
    "Part des 65 ans et plus (%)": d.values[i]![0],
    "Part des 80 ans et plus (%)": d.pct80plus[i],
    "Part de résidents étrangers (%)": d.pctNonBelgian[i],
  }));
}

export function zonesProtegeesRows(): Row[] {
  const d = EUROSTAT_ZONES_PROTEGEES;
  return flatten(d, { "Surface protégée (%)": d.values, "Surface protégée (km²)": d.areaKm2 });
}
