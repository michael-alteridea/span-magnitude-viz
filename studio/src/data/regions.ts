/**
 * Régions administratives FR · BE → identifiants NUTS 1 (Eurostat GISCO 2024), pour la carte des régions
 * de l'exploration guidée. Chaque région liste aussi ses départements / provinces, c'est-à-dire les
 * identifiants du fond « FR · BE » (`src/geo/frBeRegions.json`, cartes par code postal) qui la composent.
 * Module pur (aucune géométrie ici).
 */

export interface RegionRef {
  /** Identifiant NUTS 1 (« BE3 », « FRE »). */
  nuts: string;
  /** Nom d'affichage français. */
  name: string;
  country: "BE" | "FR";
  /** Départements / provinces du fond FR · BE (`frBeRegions.json`). */
  parts: string[];
}

const dep = (...codes: string[]) => codes.map((c) => `FR-${c}`);

export const REGIONS: RegionRef[] = [
  { nuts: "BE1", name: "Bruxelles", country: "BE", parts: ["BE-BE10"] },
  { nuts: "BE2", name: "Flandre", country: "BE", parts: ["BE-BE21", "BE-BE22", "BE-BE23", "BE-BE24", "BE-BE25"] },
  { nuts: "BE3", name: "Wallonie", country: "BE", parts: ["BE-BE31", "BE-BE32", "BE-BE33", "BE-BE34", "BE-BE35"] },
  { nuts: "FR1", name: "Île-de-France", country: "FR", parts: dep("75", "77", "78", "91", "92", "93", "94", "95") },
  { nuts: "FRB", name: "Centre-Val de Loire", country: "FR", parts: dep("18", "28", "36", "37", "41", "45") },
  { nuts: "FRC", name: "Bourgogne-Franche-Comté", country: "FR", parts: dep("21", "25", "39", "58", "70", "71", "89", "90") },
  { nuts: "FRD", name: "Normandie", country: "FR", parts: dep("14", "27", "50", "61", "76") },
  { nuts: "FRE", name: "Hauts-de-France", country: "FR", parts: dep("02", "59", "60", "62", "80") },
  { nuts: "FRF", name: "Grand Est", country: "FR", parts: dep("08", "10", "51", "52", "54", "55", "57", "67", "68", "88") },
  { nuts: "FRG", name: "Pays de la Loire", country: "FR", parts: dep("44", "49", "53", "72", "85") },
  { nuts: "FRH", name: "Bretagne", country: "FR", parts: dep("22", "29", "35", "56") },
  { nuts: "FRI", name: "Nouvelle-Aquitaine", country: "FR", parts: dep("16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87") },
  { nuts: "FRJ", name: "Occitanie", country: "FR", parts: dep("09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82") },
  { nuts: "FRK", name: "Auvergne-Rhône-Alpes", country: "FR", parts: dep("01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74") },
  { nuts: "FRL", name: "Provence-Alpes-Côte d'Azur", country: "FR", parts: dep("04", "05", "06", "13", "83", "84") },
  { nuts: "FRM", name: "Corse", country: "FR", parts: dep("2A", "2B") },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Variantes de noms (FR, NL, EN, sigles) → NUTS 1. */
const ALIASES: Record<string, string> = {
  bruxelles: "BE1",
  "bruxelles capitale": "BE1",
  "region de bruxelles capitale": "BE1",
  brussel: "BE1",
  brussels: "BE1",
  "brussels capital region": "BE1",
  "brussels hoofdstedelijk gewest": "BE1",
  flandre: "BE2",
  flandres: "BE2",
  "region flamande": "BE2",
  vlaanderen: "BE2",
  "vlaams gewest": "BE2",
  flanders: "BE2",
  wallonie: "BE3",
  "region wallonne": "BE3",
  wallonia: "BE3",
  "ile de france": "FR1",
  idf: "FR1",
  "paris ile de france": "FR1",
  "centre val de loire": "FRB",
  centre: "FRB",
  "bourgogne franche comte": "FRC",
  normandie: "FRD",
  "hauts de france": "FRE",
  hdf: "FRE",
  "nord pas de calais picardie": "FRE",
  "grand est": "FRF",
  "pays de la loire": "FRG",
  bretagne: "FRH",
  "nouvelle aquitaine": "FRI",
  occitanie: "FRJ",
  "auvergne rhone alpes": "FRK",
  aura: "FRK",
  "provence alpes cote d azur": "FRL",
  paca: "FRL",
  "region sud": "FRL",
  corse: "FRM",
};

/** NUTS 1 d'un nom de région (« Wallonie » → « BE3 ») ; null si inconnu. */
export function regionNuts(v: unknown): string | null {
  if (v == null || v === "") return null;
  const k = norm(String(v));
  const a = ALIASES[k];
  if (a) return a;
  const r = REGIONS.find((x) => norm(x.name) === k || x.nuts.toLowerCase() === k);
  return r?.nuts ?? null;
}

export function regionByNuts(id: string): RegionRef | undefined {
  return REGIONS.find((r) => r.nuts === id);
}

/** Part des valeurs distinctes reconnues comme régions (0..1). */
export function regionCoverage(values: Iterable<unknown>): { share: number; matched: number; total: number } {
  let matched = 0;
  let total = 0;
  for (const v of values) {
    if (v == null || v === "") continue;
    total++;
    if (regionNuts(v)) matched++;
  }
  return { share: total ? matched / total : 0, matched, total };
}
