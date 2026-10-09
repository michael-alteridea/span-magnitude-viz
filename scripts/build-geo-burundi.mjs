/**
 * Fond de carte « Burundi (provinces) » du Studio — geoBoundaries gbOpen BDI ADM1
 * (licence CC0 1.0, domaine public), découpage des 18 provinces d'AVANT la réforme de 2025
 * (Rumonge, créée en 2015, incluse ; la loi organique n° 1/05 du 16 mars 2023, appliquée en 2025,
 * a ramené les provinces de 18 à 5 : ce fond ne représente PAS le découpage actuel).
 *
 *   node scripts/build-geo-burundi.mjs [--raw /workspace/datanime-maps/burundi/raw]
 *
 * Entrée (téléchargée une fois, hors git) :
 *   https://www.geoboundaries.org/api/current/gbOpen/BDI/ADM1/  → gb-BDI-ADM1-meta.json
 *   https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BDI/ADM1/geoBoundaries-BDI-ADM1.geojson
 * Natural Earth 10m admin-1 (v5.1.1) a été écarté : 17 provinces seulement, sans Rumonge.
 *
 * Sortie : src/geo/burundi/provinces.topo.json (objet « provinces ») ; propriétés
 *   id (ISO 3166-2, ex. « BI-GI »), name (nom officiel de la source), label (nom affiché :
 *   nom court pour les 10 provinces mises en avant, nom officiel sinon), highlight (booléen),
 *   lon / lat (point d'ancrage intérieur pour l'étiquette et le placement par nom) ;
 * + build-info.json. Anneaux extérieurs dans le sens horaire (convention sphérique d3) :
 * le script vérifie qu'aucune province ne couvre un hémisphère.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoBounds, geoCentroid, geoContains } from "d3";
import { feature } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ri = args.indexOf("--raw");
const RAW = resolve(ri >= 0 ? args[ri + 1] : "/workspace/datanime-maps/burundi/raw");
const SRC = resolve(RAW, "geoBoundaries-BDI-ADM1.geojson");
const META = resolve(RAW, "gb-BDI-ADM1-meta.json");
for (const p of [SRC, META]) if (!existsSync(p)) throw new Error(`Source introuvable : ${p} (voir l'en-tête du script)`);
const meta = JSON.parse(readFileSync(META, "utf8"));
if (!/CC0/i.test(meta.boundaryLicense)) throw new Error(`Licence inattendue : ${meta.boundaryLicense}`);

/** Les 10 provinces mises en avant : nom affiché (court) → nom officiel (geoBoundaries `shapeName`). */
export const HIGHLIGHT = {
  Gitega: "Gitega",
  "Buja rural": "Bujumbura Rural",
  Bururi: "Bururi",
  Kirundo: "Kirundo",
  Karusi: "Karuzi",
  Bubanza: "Bubanza",
  Rumonge: "Rumonge",
  Makamba: "Makamba",
  Ngozi: "Ngozi",
  Buja: "Bujumbura Mairie",
};
const labelOf = Object.fromEntries(Object.entries(HIGHLIGHT).map(([short, official]) => [official, short]));

const out = resolve(root, "src/geo/burundi/provinces.topo.json");
const QUANTIZATION = 20000;
const SIMPLIFY = "20%";
execFileSync(resolve(root, "node_modules/.bin/mapshaper"), [
  "-i", SRC, "name=provinces",
  "-each", "id=shapeISO, name=shapeName",
  "-filter-fields", "id,name",
  "-simplify", "weighted", "keep-shapes", SIMPLIFY,
  "-clean",
  "-o", out, "format=topojson", `quantization=${QUANTIZATION}`, "id-field=id",
], { stdio: ["ignore", "inherit", "inherit"] });

const topo = JSON.parse(readFileSync(out, "utf8"));
// Nom affiché et mise en avant (les 10 provinces demandées) ; les autres gardent leur nom officiel
for (const g of topo.objects.provinces.geometries) {
  const short = labelOf[g.properties.name];
  g.properties.label = short ?? g.properties.name;
  g.properties.highlight = !!short;
}
const fc = feature(topo, topo.objects.provinces);
const bad = fc.features.filter((f) => geoArea(f) > 2 * Math.PI).map((f) => f.properties.id);
if (bad.length) throw new Error(`Provinces mal orientées (> un hémisphère) : ${bad.join(", ")}`);
if (fc.features.length !== 18) throw new Error(`18 provinces attendues, ${fc.features.length} trouvées`);
for (const official of Object.values(HIGHLIGHT))
  if (!fc.features.some((f) => f.properties.name === official)) throw new Error(`Province absente : ${official}`);

/** Point d'ancrage intérieur : centroïde s'il est dans la province, sinon point intérieur le plus proche (grille). */
function anchor(f) {
  const c = geoCentroid(f);
  if (geoContains(f, c)) return c;
  const [[x0, y0], [x1, y1]] = geoBounds(f);
  let best = null;
  let bestD = Infinity;
  const N = 80;
  for (let i = 1; i < N; i++)
    for (let j = 1; j < N; j++) {
      const p = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N];
      if (!geoContains(f, p)) continue;
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
      if (d < bestD) (bestD = d), (best = p);
    }
  if (!best) throw new Error(`Pas de point intérieur pour ${f.properties.id}`);
  return best;
}
const anchors = new Map(fc.features.map((f) => [f.properties.id, anchor(f).map((v) => Math.round(v * 1e4) / 1e4)]));
for (const g of topo.objects.provinces.geometries) {
  const [lon, lat] = anchors.get(g.properties.id);
  g.properties.lon = lon;
  g.properties.lat = lat;
}
writeFileSync(out, JSON.stringify(topo));

const sha = createHash("sha256").update(readFileSync(SRC)).digest("hex");
const info = {
  builtAt: new Date().toISOString(),
  source: "geoBoundaries gbOpen BDI ADM1 (Province)",
  boundaryID: meta.boundaryID,
  boundarySource: meta.boundarySource,
  boundaryYearRepresented: meta.boundaryYearRepresented,
  sourceDataUpdateDate: meta.sourceDataUpdateDate,
  buildDate: meta.buildDate,
  licence: meta.boundaryLicense,
  api: "https://www.geoboundaries.org/api/current/gbOpen/BDI/ADM1/",
  download: meta.gjDownloadURL,
  sourceSha256: sha,
  vintage: "18 provinces antérieures à la réforme de 2025 (Rumonge incluse, créée en 2015) ; pas le découpage en 5 provinces de 2025",
  simplify: `weighted keep-shapes ${SIMPLIFY}`,
  quantization: QUANTIZATION,
  features: fc.features.length,
  highlighted: Object.entries(HIGHLIGHT).map(([label, name]) => ({
    label,
    name,
    id: fc.features.find((f) => f.properties.name === name).properties.id,
  })),
  bytes: statSync(out).size,
};
writeFileSync(resolve(root, "src/geo/burundi/build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(info);
