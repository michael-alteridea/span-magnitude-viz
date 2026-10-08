/**
 * Static « cartons SVG » (Alteridea dark style, thin borders) → docs/maps/*.svg
 *
 *   node scripts/build-map-svgs.mjs
 *
 * Uses the raw downloads in ./geo-raw (run scripts/build-europe-geo.mjs first),
 * simplified less aggressively than the runtime basemaps since these are assets.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  geoArea,
  geoAzimuthalEqualArea,
  geoBounds,
  geoConicConformal,
  geoPath,
} from "d3";
import { feature, mesh } from "topojson-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = resolve(root, "geo-raw");
const OUT = resolve(root, "docs/maps");
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "smv-svg-"));
const mapshaper = resolve(root, "node_modules/.bin/mapshaper");

const STYLE = {
  bg: "#0b0b0c",
  fill: "#1c1917",
  fillContext: "#131110",
  stroke: "#4a4440",
  strokeContext: "#2a2623",
  border: "#78716c",
  accent: "#d62839",
  title: "#e7e5e4",
  sub: "#a8a29e",
  attr: "#57534e",
  font: "Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
};

const ATTR_GISCO = "© EuroGeographics pour les limites administratives — Eurostat GISCO, NUTS 2024 (1:10M)";
const ATTR_GISCO_01M = "© EuroGeographics pour les limites administratives — Eurostat GISCO, NUTS 2024 (1:1M)";
const ATTR_NE = "Natural Earth 1:50m (domaine public)";

/** Run mapshaper → TopoJSON, return {topo, object}. */
function prep(name, input, cmds, simplify) {
  const out = join(tmp, `${name}.topo.json`);
  execFileSync(
    mapshaper,
    [
      "-i", input, `name=${name}`,
      ...cmds,
      "-simplify", "weighted", simplify, "keep-shapes",
      "-clean",
      "-o", out, "format=topojson", "quantization=100000",
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  return JSON.parse(readFileSync(out, "utf8"));
}

function checkWinding(fc, label) {
  for (const f of fc.features) {
    const a = geoArea(f);
    const [[x0, y0], [x1, y1]] = geoBounds(f);
    if (a > 2 * Math.PI || x1 - x0 > 160 || y1 - y0 > 70) {
      throw new Error(`${label}: ${f.properties.id} mis-wound (area ${a.toFixed(2)})`);
    }
  }
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function svgDoc({ width, height, title, subtitle, attribution, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <desc>${esc(subtitle)} · ${esc(attribution)}</desc>
  <style>
    .region { fill: ${STYLE.fill}; stroke: ${STYLE.stroke}; stroke-width: 0.5; stroke-linejoin: round; }
    .context { fill: ${STYLE.fillContext}; stroke: ${STYLE.strokeContext}; stroke-width: 0.4; stroke-linejoin: round; }
    .borders { fill: none; stroke: ${STYLE.border}; stroke-width: 0.9; stroke-linejoin: round; stroke-linecap: round; }
    .outline { fill: none; stroke: ${STYLE.border}; stroke-width: 0.8; stroke-linejoin: round; }
    .t { font-family: ${STYLE.font}; }
  </style>
  <rect id="background" width="${width}" height="${height}" fill="${STYLE.bg}"/>
${body}
  <g id="title" class="t">
    <rect x="32" y="30" width="4" height="40" fill="${STYLE.accent}"/>
    <text x="46" y="48" font-size="20" font-weight="600" fill="${STYLE.title}">${esc(title)}</text>
    <text x="46" y="68" font-size="12.5" fill="${STYLE.sub}">${esc(subtitle)}</text>
  </g>
  <g id="attribution" class="t">
    <text x="${width - 24}" y="${height - 18}" font-size="10" text-anchor="end" fill="${STYLE.attr}">${esc(attribution)}</text>
  </g>
</svg>
`;
}

function pathsGroup(id, cls, features, path, attrs = () => "") {
  const rows = features
    .map((f) => {
      const d = path(f);
      if (!d) return "";
      const p = f.properties;
      return `    <path id="${esc(`${id}-${p.id}`)}" class="${cls}" data-id="${esc(p.id)}" data-name="${esc(p.name)}"${attrs(f)} d="${d}"><title>${esc(p.name)} (${esc(p.id)})</title></path>`;
    })
    .filter(Boolean)
    .join("\n");
  return `  <g id="${id}">\n${rows}\n  </g>`;
}

const written = [];
function write(file, svg) {
  const p = resolve(OUT, file);
  writeFileSync(p, svg);
  written.push([file, (Buffer.byteLength(svg) / 1024).toFixed(1)]);
}

const nutsSrc = (l) => resolve(RAW, `NUTS_RG_10M_2024_4326_LEVL_${l}.geojson`);
/** 1:1M NUTS for the country cartons (downloaded on demand). */
function nutsSrc01(l) {
  const file = resolve(RAW, `NUTS_RG_01M_2024_4326_LEVL_${l}.geojson`);
  if (!existsSync(file)) {
    const url = `https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_${l}.geojson`;
    console.log("↓", url);
    execFileSync("curl", ["-sSfL", "--retry", "3", "-o", file, url], { stdio: "inherit" });
  }
  return file;
}
const neSrc = resolve(RAW, "ne_50m_admin_0_countries.geojson");
const nutsEach = "id=NUTS_ID, name=NAME_LATN, cntr=CNTR_CODE";
const OVERSEAS = "!/^(FRY|ES7|PT2|PT3|NO0B)/.test(NUTS_ID)";

// French département codes (INSEE) keyed by normalized name, from the FR+BE basemap.
const frBe = JSON.parse(readFileSync(resolve(root, "src/geo/frBeRegions.json"), "utf8"));
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const deptByName = new Map(
  frBe.features.filter((f) => f.properties.country === "FR").map((f) => [norm(f.properties.name), f.properties.code])
);

// ---------- Country-level cartons (France / Belgique) -------------------
function countryCarton({ file, title, subtitle, level, cntr, simplify, projection, width, height, attrs }) {
  const topo = prep(`${cntr}${level}`, nutsSrc01(level), [
    "-filter", `CNTR_CODE === '${cntr}' && ${OVERSEAS}`,
    "-each", nutsEach,
    "-filter-fields", "id,name,cntr",
  ], simplify);
  const obj = topo.objects[`${cntr}${level}`];
  const fc = feature(topo, obj);
  checkWinding(fc, file);
  projection.fitExtent([[40, 92], [width - 40, height - 40]], fc);
  const path = geoPath(projection).digits(1);
  const outline = mesh(topo, obj, (a, b) => a === b);
  const body =
    pathsGroup("regions", "region", fc.features, path, attrs) +
    `\n  <path id="outline" class="outline" d="${path(outline)}"/>`;
  write(file, svgDoc({ width, height, title, subtitle, attribution: ATTR_GISCO_01M, body }));
}

const lambertFr = () => geoConicConformal().parallels([44, 49]).rotate([-3, 0]);
const lambertBe = () => geoConicConformal().parallels([49.8333, 51.1667]).rotate([-4.3674, 0]);

countryCarton({
  file: "france-regions.svg",
  title: "France — régions",
  subtitle: "13 régions métropolitaines · NUTS 1 (2024)",
  level: 1, cntr: "FR", simplify: "10%", projection: lambertFr(), width: 1000, height: 1000,
});
countryCarton({
  file: "france-departements.svg",
  title: "France — départements",
  subtitle: "96 départements métropolitains · NUTS 3 (2024)",
  level: 3, cntr: "FR", simplify: "10%", projection: lambertFr(), width: 1000, height: 1000,
  attrs: (f) => {
    const code = deptByName.get(norm(f.properties.name));
    return code ? ` data-dept="${code}"` : "";
  },
});
countryCarton({
  file: "belgium-regions.svg",
  title: "Belgique — régions",
  subtitle: "Bruxelles-Capitale · Flandre · Wallonie · NUTS 1 (2024)",
  level: 1, cntr: "BE", simplify: "25%", projection: lambertBe(), width: 1000, height: 820,
});
countryCarton({
  file: "belgium-provinces.svg",
  title: "Belgique — provinces",
  subtitle: "10 provinces + Bruxelles-Capitale · NUTS 2 (2024)",
  level: 2, cntr: "BE", simplify: "25%", projection: lambertBe(), width: 1000, height: 820,
});

// ---------- Europe cartons ----------------------------------------------
const EU_FRAME_BBOX = "-25,34,45,72";
const CONTEXT_BBOX = "-40,22,95,80";
const ERASE = [
  "-18.6,27.3,-13.3,29.6", "-17.6,32.2,-15.9,33.3", "-31.6,36.6,-24.4,40.1", "-9.6,70.6,-7.6,71.4",
].flatMap((b) => ["-erase", `bbox=${b}`]);

const countriesTopo = prep("countries", neSrc, [
  "-filter", "ISO_A2_EH !== 'GL'",
  "-clip", `bbox=${CONTEXT_BBOX}`, "remove-slivers",
  ...ERASE,
  "-each",
  "id=(ISO_A2_EH && ISO_A2_EH !== '-99') ? ISO_A2_EH : ADM0_A3, name=NAME_FR || NAME, continent=CONTINENT",
  "-filter-fields", "id,name,continent",
], "20%");
const countries = feature(countriesTopo, countriesTopo.objects.countries);
checkWinding(countries, "countries");

const nuts1Frame = prep("frame", nutsSrc(1), [
  "-filter", OVERSEAS, "-clip", `bbox=${EU_FRAME_BBOX}`, "-each", nutsEach, "-filter-fields", "id",
], "5%");
const frame = feature(nuts1Frame, nuts1Frame.objects.frame);

function europeProjection(width, height) {
  return geoAzimuthalEqualArea()
    .rotate([-10, -52])
    .fitExtent([[24, 88], [width - 24, height - 36]], frame)
    .clipExtent([[0, 0], [width, height]]);
}

// Europe — countries
{
  const width = 1200, height = 1000;
  const projection = europeProjection(width, height);
  const path = geoPath(projection).digits(1);
  const EUROPEISH = new Set(["TR", "CY", "CYN", "GE", "AM", "AZ"]);
  const isEurope = (f) => f.properties.continent === "Europe" || EUROPEISH.has(f.properties.id);
  const body =
    pathsGroup("context", "context", countries.features.filter((f) => !isEurope(f)), path) +
    "\n" +
    pathsGroup("countries", "region", countries.features.filter(isEurope), path);
  write("europe-countries.svg", svgDoc({
    width, height,
    title: "Europe — pays",
    subtitle: "Frontières nationales · projection azimutale équivalente (10°E 52°N)",
    attribution: ATTR_NE,
    body,
  }));
}

// Europe — NUTS 2
{
  const width = 1200, height = 1000;
  const topo = prep("nuts2", nutsSrc(2), [
    "-filter", OVERSEAS,
    "-clip", `bbox=${EU_FRAME_BBOX}`, "remove-slivers",
    "-each", nutsEach,
    "-filter-fields", "id,name,cntr",
  ], "20%");
  const fc = feature(topo, topo.objects.nuts2);
  checkWinding(fc, "nuts2");
  const iso = (c) => ({ EL: "GR", UK: "GB" })[c] ?? c;
  const covered = new Set(fc.features.map((f) => iso(f.properties.cntr)));
  const projection = europeProjection(width, height);
  const path = geoPath(projection).digits(1);
  const borders = mesh(topo, topo.objects.nuts2, (a, b) => a !== b && a.properties.cntr !== b.properties.cntr);
  const body =
    pathsGroup("context", "context", countries.features.filter((f) => !covered.has(f.properties.id)), path) +
    "\n" +
    pathsGroup("nuts2", "region", fc.features, path, (f) => ` data-country="${esc(f.properties.cntr)}"`) +
    `\n  <path id="country-borders" class="borders" d="${path(borders)}"/>`;
  write("europe-nuts2.svg", svgDoc({
    width, height,
    title: "Europe — régions NUTS 2",
    subtitle: `${fc.features.length} régions NUTS 2 (2024) · pays hors NUTS en fond (Natural Earth)`,
    attribution: `${ATTR_GISCO} · ${ATTR_NE}`,
    body,
  }));
}

for (const [f, kb] of written) console.log(`✓ docs/maps/${f}  ${kb} KB`);
