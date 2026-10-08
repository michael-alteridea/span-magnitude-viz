/**
 * Build the European basemaps used by the map mode (mapRegion: "europe").
 *
 *   node scripts/build-europe-geo.mjs            # default: overseas excluded, Europe clip
 *   node scripts/build-europe-geo.mjs --keep-overseas --out /tmp/europe-overseas
 *
 * Sources (downloaded once into ./geo-raw, git-ignored):
 *  - Eurostat GISCO NUTS 2024, 1:10M, EPSG:4326, levels 1/2/3 (© EuroGeographics)
 *  - Natural Earth 1:50m admin-0 countries (public domain)
 *
 * Output: TopoJSON in src/geo/europe/ (one object per file), CW exterior rings
 * (d3-geo spherical convention), validated with d3.geoArea / d3.geoBounds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoBounds } from "d3";
import { feature } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const KEEP_OVERSEAS = args.includes("--keep-overseas");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? resolve(args[outIdx + 1]) : resolve(root, "src/geo/europe");
const RAW = resolve(root, "geo-raw");
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

export const SOURCES = {
  nuts: (l) =>
    `https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_10M_2024_4326_LEVL_${l}.geojson`,
  countries:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
};

/** Europe clip box (lon/lat): Iceland → Türkiye/Caucasus edge, Crete/Cyprus → North Cape. */
export const EUROPE_BBOX = [-25, 34, 45, 72];
/**
 * Wider clip for the countries context layer, so its cut edges (Russia, Middle
 * East, North Africa) fall outside the map viewport instead of showing as wedges.
 */
export const CONTEXT_BBOX = [-40, 22, 95, 80];
/** Far overseas NUTS units dropped by default (DOM, Canarias, Azores, Madeira, Svalbard/Jan Mayen). */
export const OVERSEAS_PREFIXES = ["FRY", "ES7", "PT2", "PT3", "NO0B"];

function download(url, file) {
  const dest = resolve(RAW, file);
  if (existsSync(dest) && statSync(dest).size > 1000) return dest;
  console.log("↓", url);
  execFileSync("curl", ["-sSfL", "--retry", "3", "-o", dest, url], { stdio: "inherit" });
  return dest;
}

const mapshaper = resolve(root, "node_modules/.bin/mapshaper");
function ms(cmd) {
  execFileSync(mapshaper, cmd, { stdio: ["ignore", "inherit", "inherit"] });
}

// ES7 / PT2 / PT3 are the NUTS-1 codes of Canarias / Açores / Madeira (and prefix their NUTS-2/3 units).
const overseasFilter = `!/^(${OVERSEAS_PREFIXES.join("|")})/.test(NUTS_ID)`;
/**
 * Overseas islands carried inside mainland geometries (Natural Earth ES/PT/NO,
 * NUTS-1 NO0): Canarias, Madeira, Açores, Jan Mayen — erased by default.
 */
export const OVERSEAS_ERASE_BOXES = [
  [-18.6, 27.3, -13.3, 29.6], // Canarias
  [-17.6, 32.2, -15.9, 33.3], // Madeira
  [-31.6, 36.6, -24.4, 40.1], // Açores
  [-9.6, 70.6, -7.6, 71.4], // Jan Mayen
];
const eraseArgs = (boxes) =>
  KEEP_OVERSEAS ? [] : boxes.flatMap((b) => ["-erase", `bbox=${b.join(",")}`]);
const erase = eraseArgs(OVERSEAS_ERASE_BOXES);
// NUTS layers: islands already dropped by the NUTS_ID filter, except Jan Mayen inside NUTS-1 "NO0".
const eraseNuts = eraseArgs(OVERSEAS_ERASE_BOXES.slice(3));
const clip = KEEP_OVERSEAS ? [] : ["-clip", `bbox=${EUROPE_BBOX.join(",")}`, "remove-slivers"];
const clipContext = KEEP_OVERSEAS ? [] : ["-clip", `bbox=${CONTEXT_BBOX.join(",")}`, "remove-slivers"];

/** Simplification (Visvalingam weighted, % of removable vertices retained). */
export const SIMPLIFY = { countries: "14%", nuts1: "12%", nuts2: "12%", nuts3: "10%" };

const results = [];

// --- NUTS 1/2/3 ---------------------------------------------------------
for (const level of [1, 2, 3]) {
  const name = `nuts${level}`;
  const src = download(SOURCES.nuts(level), `NUTS_RG_10M_2024_4326_LEVL_${level}.geojson`);
  const out = resolve(OUT, `${name}.topo.json`);
  ms([
    "-i", src, `name=${name}`,
    ...(KEEP_OVERSEAS ? [] : ["-filter", overseasFilter]),
    ...clip,
    ...eraseNuts,
    "-simplify", "weighted", SIMPLIFY[name], "keep-shapes",
    "-clean",
    "-each",
    `id=NUTS_ID, name=NAME_LATN, cntr=CNTR_CODE, level=${level}`,
    "-filter-fields", "id,name,cntr,level",
    "-o", out, "format=topojson", "quantization=20000", "id-field=id",
  ]);
  results.push({ name, out, object: name });
}

// --- Countries (Natural Earth admin-0 50m) ------------------------------
{
  const src = download(SOURCES.countries, "ne_50m_admin_0_countries.geojson");
  const out = resolve(OUT, "countries.topo.json");
  ms([
    "-i", src, "name=countries",
    // Greenland would only survive the clip as a thin sliver of its east coast.
    ...(KEEP_OVERSEAS ? [] : ["-filter", "ISO_A2_EH !== 'GL'"]),
    ...(KEEP_OVERSEAS ? ["-filter", "CONTINENT === 'Europe' || ['TR','CY','MA','DZ','TN','LY','EG','IL','PS','LB','SY','JO','IQ','IR','GE','AM','AZ','KZ','SA'].includes(ISO_A2_EH)"] : []),
    ...clipContext,
    ...erase,
    "-simplify", "weighted", SIMPLIFY.countries, "keep-shapes",
    "-clean",
    "-each",
    "id=(ISO_A2_EH && ISO_A2_EH !== '-99') ? ISO_A2_EH : ADM0_A3, name=NAME_EN || NAME, nameFr=NAME_FR || NAME, continent=CONTINENT",
    "-filter-fields", "id,name,nameFr,continent",
    "-o", out, "format=topojson", "quantization=20000", "id-field=id",
  ]);
  results.push({ name: "countries", out, object: "countries" });
}

// --- Validation: winding + bounds (d3 spherical convention) -------------
let bad = 0;
for (const r of results) {
  const topo = JSON.parse(readFileSync(r.out, "utf8"));
  const fc = feature(topo, topo.objects[r.object]);
  for (const f of fc.features) {
    const a = geoArea(f);
    const [[x0, y0], [x1, y1]] = geoBounds(f);
    // A mis-wound ring makes the feature cover (almost) the whole sphere.
    if (a > 2 * Math.PI || (!KEEP_OVERSEAS && (x1 - x0 > 160 || y1 - y0 > 70))) {
      bad++;
      console.warn(`✗ ${r.name} ${f.properties.id} area=${a.toFixed(3)} bounds=${[x0, y0, x1, y1].map((v) => v.toFixed(1))}`);
    }
  }
  const kb = (statSync(r.out).size / 1024).toFixed(1);
  console.log(`✓ ${r.name}: ${fc.features.length} features, ${kb} KB → ${r.out}`);
}
if (bad) {
  console.error(`${bad} feature(s) failed winding/bounds validation`);
  process.exit(1);
}
writeFileSync(
  resolve(OUT, "build-info.json"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      keepOverseas: KEEP_OVERSEAS,
      bbox: KEEP_OVERSEAS ? null : EUROPE_BBOX,
      contextBbox: KEEP_OVERSEAS ? null : CONTEXT_BBOX,
      overseasExcluded: KEEP_OVERSEAS ? [] : OVERSEAS_PREFIXES,
      overseasEraseBoxes: KEEP_OVERSEAS ? [] : OVERSEAS_ERASE_BOXES,
      simplify: SIMPLIFY,
      sources: { nuts: SOURCES.nuts("{1,2,3}"), countries: SOURCES.countries },
    },
    null,
    2
  ) + "\n"
);
