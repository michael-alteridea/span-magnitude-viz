/**
 * Fond de carte « Monde (pays) » du Studio — Natural Earth 1:110m admin-0 (v5.1.1, domaine public),
 * pack « Monde » préparé pour Datanime (/workspace/datanime-maps, script build_world_maps.py) :
 * 236 entités avec un code ISO alpha-2 (pays souverains + territoires), Antarctique exclu,
 * Crimée rattachée à l'Ukraine, Chypre du Nord → CY, Somaliland → SO ; les 62 petits pays / îles
 * absents du 110m sont repris du 50m par le pack (Malte, Singapour, Maurice…).
 *
 *   node scripts/build-geo-world.mjs [--maps /workspace/datanime-maps]
 *
 * Sortie : src/geo/world/countries.topo.json (objet « countries »), mêmes propriétés que le fond
 * Europe : `id` (ISO alpha-2 en MAJUSCULES, comme src/geo/europe/countries.topo.json), `name`,
 * `nameFr`, `continent` ; + build-info.json. Pas de simplification supplémentaire (le 110m l'est déjà).
 * Anneaux extérieurs dans le sens horaire (sortie mapshaper, convention sphérique d3) ; le script
 * vérifie qu'aucune entité ne couvre plus d'un hémisphère.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea } from "d3";
import { feature } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mi = args.indexOf("--maps");
const MAPS = resolve(mi >= 0 ? args[mi + 1] : "/workspace/datanime-maps");
const SRC = resolve(MAPS, "world-countries-110m.topojson");
if (!existsSync(SRC)) throw new Error(`Pack Natural Earth introuvable : ${SRC} (--maps <dossier datanime-maps>)`);
const out = resolve(root, "src/geo/world/countries.topo.json");
const QUANTIZATION = 100000;

execFileSync(resolve(root, "node_modules/.bin/mapshaper"), [
  "-i", SRC, "name=countries",
  "-filter", "continent !== 'Antarctica' && iso2 !== 'aq'",
  "-each", "id=String(iso_a2).toUpperCase(), nameFr=name_fr",
  "-filter-fields", "id,name,nameFr,continent",
  "-o", out, "format=topojson", `quantization=${QUANTIZATION}`, "id-field=id",
], { stdio: ["ignore", "inherit", "inherit"] });

const topo = JSON.parse(readFileSync(out, "utf8"));
const fc = feature(topo, topo.objects.countries);
const bad = fc.features.filter((f) => geoArea(f) > 2 * Math.PI).map((f) => f.properties.id);
if (bad.length) throw new Error(`Entités mal orientées (> un hémisphère) : ${bad.join(", ")}`);
const byContinent = {};
for (const f of fc.features) byContinent[f.properties.continent] = (byContinent[f.properties.continent] ?? 0) + 1;
const info = {
  builtAt: new Date().toISOString(),
  source: "Natural Earth 1:110m admin-0 v5.1.1 (pack Monde Datanime, world-countries-110m.topojson ; 62 petites entités reprises du 50m)",
  licence: "domaine public",
  antarctica: "exclue",
  crimea: "UA",
  quantization: QUANTIZATION,
  features: fc.features.length,
  byContinent,
  bytes: statSync(out).size,
};
writeFileSync(resolve(root, "src/geo/world/build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(info);
