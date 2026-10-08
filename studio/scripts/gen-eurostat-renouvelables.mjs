/**
 * Exemple public « Énergies renouvelables dans l'UE » (Reel en un clic) : extrait Eurostat nrg_ind_ren
 * (part des renouvelables dans la consommation finale brute d'énergie, %), UE-27 et ses 27 pays, 2004 → 2025.
 *   node studio/scripts/gen-eurostat-renouvelables.mjs [chemin du CSV]
 * Source : Eurostat (nrg_ind_ren), DOI 10.2908/NRG_IND_REN — réutilisation autorisée y compris commerciale avec
 * mention de la source (décision 2011/833/UE, CC BY 4.0). 2025 : valeurs provisoires (« p »).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] ?? "/workspace/datanime-landing/film/data/eurostat-nrg_ind_ren-REN-PC.csv";
const metaPath = csvPath.replace(/\.csv$/, ".metadata.json");
const EU = "AT BE BG CY CZ DE DK EE EL ES FI FR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");
const lines = readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
const head = lines.shift().split(",");
const col = (n) => head.indexOf(n);
const recs = lines.map((l) => l.split(",")).filter((r) => EU.includes(r[col("geo")]) || r[col("geo")] === "EU27_2020");
const years = [...new Set(recs.map((r) => Number(r[col("annee")])))].sort((a, b) => a - b);
const codes = ["EU27_2020", ...EU];
const names = {};
for (const r of recs) names[r[col("geo")]] = r[col("geo")] === "EU27_2020" ? "UE-27" : r[col("libelle_fr")];
const values = codes.map((c) => years.map((y) => {
  const r = recs.find((x) => x[col("geo")] === c && Number(x[col("annee")]) === y);
  return r && r[col("part_renouvelables_pct")] !== "" ? Number(r[col("part_renouvelables_pct")]) : null;
}));
const prov = codes.map((c) => years.filter((y) => recs.find((x) => x[col("geo")] === c && Number(x[col("annee")]) === y)?.[col("statut")] === "p"));
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const out = `/* Fichier généré par studio/scripts/gen-eurostat-renouvelables.mjs — ne pas modifier à la main.
 * ${meta.titre} — Eurostat ${meta.dataset} (${meta.filtres.nrg_bal} ; ${meta.filtres.unit}).
 * ${meta.doi} · mis à jour par Eurostat le ${meta.mis_a_jour_par_eurostat.slice(0, 10)} · téléchargé le ${meta.telecharge_le}.
 * Licence : ${meta.licence}. */

export const EUROSTAT_REN = {
  source: "Source : Eurostat (nrg_ind_ren) · 2025 provisoire",
  licence: "CC BY 4.0",
  doi: ${JSON.stringify(meta.doi)},
  page: ${JSON.stringify(meta.page)},
  updated: ${JSON.stringify(meta.mis_a_jour_par_eurostat.slice(0, 10))},
  downloaded: ${JSON.stringify(meta.telecharge_le)},
  years: ${JSON.stringify(years)},
  codes: ${JSON.stringify(codes)},
  names: ${JSON.stringify(codes.map((c) => names[c]))},
  /** Part des renouvelables (%), une ligne par code, une colonne par année (null : non publié). */
  values: ${JSON.stringify(values)},
  /** Années provisoires (« p ») par code. */
  provisional: ${JSON.stringify(prov)},
} as const;
`;
writeFileSync(join(here, "../src/data/eurostatRenouvelables.ts"), out);
console.log(`${codes.length} zones × ${years.length} années → src/data/eurostatRenouvelables.ts`);
