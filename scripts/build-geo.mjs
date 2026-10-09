/**
 * Fonds de carte de la bibliothèque et du Studio — uniquement des sources utilisables commercialement :
 *
 *  - France (régions, départements métropolitains) : IGN — ADMIN EXPRESS COG CARTO PE 2026
 *    (Licence Ouverte Etalab 2.0), FlatGeobuf WGS84 ;
 *  - Belgique (régions, provinces) : NGI-IGN — AdminVector (géométries AGDP / Statbel),
 *    CC BY 4.0, Shapefile WGS84 ;
 *  - Pays (Europe et contexte) : Natural Earth 1:50m admin-0 (domaine public), pack « Monde »
 *    préparé pour Datanime (Crimée rattachée à l'Ukraine, Chypre entière, codes ISO alpha-2).
 *
 *   node scripts/build-geo.mjs [--maps /workspace/datanime-maps]
 *
 * Téléchargements mis en cache dans ./geo-raw (ignoré par git). Sorties :
 *  - src/geo/europe/countries.topo.json (objet « countries ») ;
 *  - src/geo/frBe/regions.topo.json (objet « regions » : 13 régions FR + 3 régions BE) ;
 *  - src/geo/frBeRegions.json (96 départements + 10 provinces + Bruxelles-Capitale) ;
 *  - src/geo/regionCentroids.json (centroïdes du fond précédent, géocodage par code postal).
 * Fond « Monde (pays) » (src/geo/world/countries.topo.json) : script séparé scripts/build-geo-world.mjs (hors ligne).
 * Les identifiants internes historiques (« FR1 », « BE2 », « BE-BE21 »…) sont conservés comme clés de jointure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoBounds, geoCentroid } from "d3";
import { feature } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mi = args.indexOf("--maps");
const MAPS = resolve(mi >= 0 ? args[mi + 1] : "/workspace/datanime-maps");
const RAW = resolve(root, "geo-raw");
mkdirSync(RAW, { recursive: true });
mkdirSync(resolve(root, "src/geo/frBe"), { recursive: true });

const IGN = "https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG-CARTO-PE/ADMIN-EXPRESS-COG-CARTO-PE_4-0__FLATGEOBUF_WGS84G_FRA_2026-01-01";
const NGI = "https://ac.ngi.be/remoteclient-open/ngi-standard-open/Vectordata/TerritorialDivisions/TerritorialDivisions-AdminVector/fb1e2993-2020-428c-9188-eb5f75e284b9_x-shapefile_4326.zip";
export const SOURCES = {
  ign: { url: IGN, layers: ["region.fgb", "departement.fgb"], licence: "Licence Ouverte Etalab 2.0", producer: "IGN — ADMIN EXPRESS COG CARTO PE 2026" },
  ngi: { url: NGI, layers: ["region_4326", "province_4326"], licence: "CC BY 4.0", producer: "NGI-IGN — AdminVector (AGDP, Statbel)" },
  ne: { file: "world-countries-50m.geojson", licence: "domaine public", producer: "Natural Earth 1:50m (v5.1.1)" },
};

/** Cadre de contexte (pays voisins hors champ découpés en dehors de la vue). */
export const CONTEXT_BBOX = [-40, 22, 95, 80];
/** Îles lointaines retirées du fond Europe : Canaries, Madère, Açores, Jan Mayen. */
export const OVERSEAS_ERASE_BOXES = [
  [-18.6, 27.3, -13.3, 29.6],
  [-17.6, 32.2, -15.9, 33.3],
  [-31.6, 36.6, -24.4, 40.1],
  [-9.6, 70.6, -7.6, 71.4],
];

function download(url, file) {
  const dest = resolve(RAW, file);
  if (existsSync(dest) && statSync(dest).size > 1000) return dest;
  console.log("↓", url);
  execFileSync("curl", ["-sSfL", "--retry", "3", "-o", dest, url], { stdio: "inherit" });
  return dest;
}
const mapshaper = resolve(root, "node_modules/.bin/mapshaper");
const ms = (cmd) => execFileSync(mapshaper, cmd, { stdio: ["ignore", "inherit", "inherit"] });

/* ---------------------------------------------------------------- sources */
// IGN : FlatGeobuf → GeoJSON (paquet « flatgeobuf », installé à la demande dans geo-raw)
const fgbDir = resolve(RAW, "fgb");
if (!existsSync(resolve(fgbDir, "node_modules/flatgeobuf"))) {
  mkdirSync(fgbDir, { recursive: true });
  execFileSync("npm", ["i", "--prefix", fgbDir, "flatgeobuf@4"], { stdio: "inherit" });
}
const { geojson: fgb } = await import(resolve(fgbDir, "node_modules/flatgeobuf/lib/mjs/flatgeobuf.js"));
async function fgbToGeojson(name) {
  const out = resolve(RAW, `ign-${name}.geojson`);
  if (existsSync(out)) return out;
  const src = download(`${IGN}/${name}.fgb`, `ign-${name}.fgb`);
  const feats = [];
  for await (const f of fgb.deserialize(new Uint8Array(readFileSync(src)))) feats.push(f);
  writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features: feats }));
  return out;
}
const ignRegion = await fgbToGeojson("region");
const ignDep = await fgbToGeojson("departement");
const ngiZip = download(NGI, "ngi-adminvector-4326.zip");
if (!existsSync(resolve(RAW, "province_4326.shp"))) execFileSync("unzip", ["-o", "-q", ngiZip, "province_4326.*", "region_4326.*", "-d", RAW]);
const neWorld = resolve(MAPS, SOURCES.ne.file);
if (!existsSync(neWorld)) throw new Error(`Pack Natural Earth introuvable : ${neWorld} (--maps <dossier datanime-maps>)`);

/* ---------------------------------------------------------------- clés historiques */
const FR_REGION_KEY = { 11: "FR1", 24: "FRB", 27: "FRC", 28: "FRD", 32: "FRE", 44: "FRF", 52: "FRG", 53: "FRH", 75: "FRI", 76: "FRJ", 84: "FRK", 93: "FRL", 94: "FRM" };
const BE_REGION_KEY = { "04000": "BE1", "02000": "BE2", "03000": "BE3" };
const BE_REGION_NAME = { "04000": "Bruxelles-Capitale", "02000": "Flandre", "03000": "Wallonie" };
const BE_PROV_KEY = { 10000: "BE21", 70000: "BE22", 40000: "BE23", 20001: "BE24", 30000: "BE25", 20002: "BE31", 50000: "BE32", 60000: "BE33", 80000: "BE34", 90000: "BE35" };
const shortProv = (s) => s.replace(/^Province (d’|d'|du |de la |de )/, "").replace(/^./, (c) => c.toUpperCase());

/* ---------------------------------------------------------------- 1. pays (Natural Earth) */
const countriesOut = resolve(root, "src/geo/europe/countries.topo.json");
ms([
  "-i", neWorld, "name=countries",
  "-filter", "iso_a2 !== 'GL' && continent !== 'Antarctica'",
  "-clip", `bbox=${CONTEXT_BBOX.join(",")}`, "remove-slivers",
  ...OVERSEAS_ERASE_BOXES.flatMap((b) => ["-erase", `bbox=${b.join(",")}`]),
  "-simplify", "weighted", "14%", "keep-shapes",
  "-clean",
  "-each", "id=iso_a2, nameFr=name_fr, continent=continent",
  "-filter-fields", "id,name,nameFr,continent",
  "-o", countriesOut, "format=topojson", "quantization=20000", "id-field=id",
]);

/* ---------------------------------------------------------------- 2. régions FR + BE */
const tmpFr = resolve(RAW, "fr-regions.json");
const tmpBe = resolve(RAW, "be-regions.json");
ms(["-i", ignRegion, "-filter", "Number(code_insee) >= 11", "-proj", "wgs84", "-simplify", "weighted", "4%", "keep-shapes", "-clean",
  "-each", `id=(${JSON.stringify(FR_REGION_KEY)})[Number(code_insee)], name=nom_officiel, cntr='FR', code=code_insee`, "-filter-fields", "id,name,cntr,code", "-o", tmpFr, "format=geojson", "precision=0.0001"]);
ms(["-i", resolve(RAW, "region_4326.shp"), "encoding=utf8", "-simplify", "weighted", "8%", "keep-shapes", "-clean",
  "-each", `id=(${JSON.stringify(BE_REGION_KEY)})[niscode], name=(${JSON.stringify(BE_REGION_NAME)})[niscode], cntr='BE', code=niscode`, "-filter-fields", "id,name,cntr,code", "-o", tmpBe, "format=geojson", "precision=0.0001"]);
const regionsFc = { type: "FeatureCollection", features: [...JSON.parse(readFileSync(tmpFr, "utf8")).features, ...JSON.parse(readFileSync(tmpBe, "utf8")).features] };
const tmpAll = resolve(RAW, "frbe-regions.json");
writeFileSync(tmpAll, JSON.stringify(regionsFc));
const regionsOut = resolve(root, "src/geo/frBe/regions.topo.json");
ms(["-i", tmpAll, "name=regions", "-o", regionsOut, "format=topojson", "quantization=20000", "id-field=id"]);

/* ---------------------------------------------------------------- 3. départements + provinces (fond « France · Belgique ») */
const tmpDep = resolve(RAW, "fr-dep.json");
const tmpProv = resolve(RAW, "be-prov.json");
ms(["-i", ignDep, "-filter", "!/^97/.test(code_insee)", "-simplify", "weighted", "1.2%", "keep-shapes", "-clean",
  "-each", "id='FR-' + code_insee, country='FR', code=code_insee, name=nom_officiel", "-filter-fields", "id,country,code,name", "-o", tmpDep, "format=geojson", "precision=0.001"]);
ms(["-i", resolve(RAW, "province_4326.shp"), "encoding=utf8", "-simplify", "weighted", "2.5%", "keep-shapes", "-clean",
  "-each", `prov=(${JSON.stringify(BE_PROV_KEY)})[niscode], id='BE-' + (prov || 'BE10'), country='BE', code=(niscode === 'NA' ? '04000' : niscode), name=(niscode === 'NA' ? 'Bruxelles-Capitale' : namefre)`,
  "-filter-fields", "id,country,code,name", "-o", tmpProv, "format=geojson", "precision=0.001"]);
const parts = [...JSON.parse(readFileSync(tmpDep, "utf8")).features, ...JSON.parse(readFileSync(tmpProv, "utf8")).features];
/** Convention d3 (anneaux extérieurs dans le sens horaire) : on retourne les entités mal orientées. */
function rewind(f) {
  if (geoArea(f) <= 2 * Math.PI) return;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) ring.reverse();
}
const centroids = {};
for (const f of parts) {
  rewind(f);
  const p = f.properties;
  if (p.country === "BE") p.name = shortProv(p.name);
  const [lon, lat] = geoCentroid(f);
  p.lat = Math.round(lat * 1e4) / 1e4;
  p.lon = Math.round(lon * 1e4) / 1e4;
  centroids[p.id] = { lat: p.lat, lon: p.lon, name: p.name, country: p.country, code: p.code };
}
// ordre historique : départements FR puis provinces BE (chacun par identifiant)
parts.sort((a, b) => (a.properties.country === b.properties.country ? a.properties.id.localeCompare(b.properties.id) : a.properties.country === "FR" ? -1 : 1));
writeFileSync(resolve(root, "src/geo/frBeRegions.json"), JSON.stringify({ type: "FeatureCollection", features: parts }));
writeFileSync(resolve(root, "src/geo/regionCentroids.json"), JSON.stringify(Object.fromEntries(Object.keys(centroids).sort().map((k) => [k, centroids[k]]))));

/* ---------------------------------------------------------------- validation (convention sphérique d3) */
let bad = 0;
const check = (name, fc) => {
  for (const f of fc.features) {
    const a = geoArea(f);
    const [[x0, y0], [x1, y1]] = geoBounds(f);
    if (a > 2 * Math.PI || x1 - x0 > 160 || y1 - y0 > 70) {
      bad++;
      console.warn(`✗ ${name} ${f.properties?.id} area=${a.toFixed(3)}`);
    }
  }
  console.log(`✓ ${name} : ${fc.features.length} entités`);
};
const topo = (f, o) => {
  const t = JSON.parse(readFileSync(f, "utf8"));
  return feature(t, t.objects[o]);
};
check("pays", topo(countriesOut, "countries"));
check("régions FR · BE", topo(regionsOut, "regions"));
check("départements · provinces", { features: parts });
const ids = topo(regionsOut, "regions").features.map((f) => f.properties.id);
if (ids.length !== 16 || ids.some((x) => !x)) throw new Error("régions FR · BE : 16 clés attendues, reçu " + ids.join(","));
if (parts.length !== 107) throw new Error(`départements + provinces : 107 attendus, reçu ${parts.length}`);
if (bad) process.exit(1);
writeFileSync(
  resolve(root, "src/geo/europe/build-info.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), contextBbox: CONTEXT_BBOX, overseasEraseBoxes: OVERSEAS_ERASE_BOXES, sources: SOURCES }, null, 2) + "\n"
);
