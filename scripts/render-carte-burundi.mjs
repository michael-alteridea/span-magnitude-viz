/**
 * Carte autonome « Burundi — provinces » (documentation) depuis src/geo/burundi/provinces.topo.json :
 * les 10 provinces mises en avant en bleu pétrole clair avec leur nom affiché (court), les 8 autres
 * en gris discret sans nom, barre d'échelle en km, mention de la source.
 *
 *   node scripts/render-carte-burundi.mjs
 *
 * Sorties : studio/docs/shots/carte-burundi.svg et carte-burundi.png (capture Chrome sans interface, ×2 ;
 * CHROME=<chemin> pour un autre binaire ; sans Chrome, seul le SVG est écrit).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoDistance, geoMercator, geoPath } from "d3";
import { feature, mesh } from "topojson-client";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const topo = JSON.parse(readFileSync(resolve(root, "src/geo/burundi/provinces.topo.json"), "utf8"));
const info = JSON.parse(readFileSync(resolve(root, "src/geo/burundi/build-info.json"), "utf8"));
const fc = feature(topo, topo.objects.provinces);

const W = 900, H = 1000;
const M = { top: 92, right: 40, bottom: 96, left: 40 };
const PETROL = "#0E6E8C", PETROL_LIGHT = "#BFDDE7", PETROL_INK = "#0B4F66", GREY = "#E7E5E4", GREY_STROKE = "#C9C5C1", INK = "#44403C";
const projection = geoMercator().fitExtent([[M.left, M.top], [W - M.right, H - M.bottom]], fc);
const path = geoPath(projection);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (v) => Math.round(v * 10) / 10;

const hi = fc.features.filter((f) => f.properties.highlight);
const lo = fc.features.filter((f) => !f.properties.highlight);
const borders = path(mesh(topo, topo.objects.provinces, (a, b) => a !== b));
const outline = path(mesh(topo, topo.objects.provinces, (a, b) => a === b));

// Étiquettes au point d'ancrage intérieur ; « Buja » (Bujumbura Mairie, très petite) décalée avec un trait de rappel
const labels = hi.map((f) => {
  const [x, y] = projection([f.properties.lon, f.properties.lat]);
  if (f.properties.id === "BI-BM") return { f, x, y, lx: x - 70, ly: y - 26, anchor: "end", leader: true };
  return { f, x, y, lx: x, ly: y, anchor: "middle", leader: false };
});

// Barre d'échelle : distance au sol mesurée à la latitude de la barre (Mercator)
const sbX = M.left, sbY = H - M.bottom + 40;
const span = 200;
const a = projection.invert([sbX, sbY - 40]), b = projection.invert([sbX + span, sbY - 40]);
const kmPerPx = (geoDistance(a, b) * 6371.0088) / span;
let km = 10;
for (const n of [10, 20, 25, 50, 75, 100]) if (n / kmPerPx <= 220) km = n;
const sbPx = km / kmPerPx;

const font = "Inter, 'DejaVu Sans', Arial, sans-serif";
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
  <title>Burundi — provinces (découpage d'avant 2025)</title>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${M.left}" y="44" font-size="24" font-weight="700" fill="${INK}">Burundi — provinces</text>
  <text x="${M.left}" y="70" font-size="13" fill="#78716C">Découpage en 18 provinces d'avant la réforme de 2025 · 10 provinces mises en avant</text>
  <g id="provinces-autres" fill="${GREY}" stroke="none">
${lo.map((f) => `    <path data-id="${f.properties.id}" d="${path(f)}"><title>${esc(f.properties.name)}</title></path>`).join("\n")}
  </g>
  <g id="provinces-mises-en-avant" fill="${PETROL_LIGHT}" stroke="none">
${hi.map((f) => `    <path data-id="${f.properties.id}" data-name="${esc(f.properties.name)}" d="${path(f)}"><title>${esc(f.properties.label)} — ${esc(f.properties.name)}</title></path>`).join("\n")}
  </g>
  <path id="limites" d="${borders}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
  <path id="frontiere" d="${outline}" fill="none" stroke="${PETROL}" stroke-width="1.4" stroke-linejoin="round"/>
  <g id="etiquettes" font-size="15" font-weight="700" fill="${PETROL_INK}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">
${labels
  .map((l) =>
    (l.leader
      ? `    <line x1="${r1(l.x)}" y1="${r1(l.y)}" x2="${r1(l.lx + 4)}" y2="${r1(l.ly + 4)}" stroke="${PETROL_INK}" stroke-width="1" paint-order="normal"/>\n    <circle cx="${r1(l.x)}" cy="${r1(l.y)}" r="2.5" fill="${PETROL_INK}" stroke="none"/>\n`
      : "") +
    `    <text x="${r1(l.lx)}" y="${r1(l.ly)}" text-anchor="${l.anchor}" dominant-baseline="central" data-id="${l.f.properties.id}">${esc(l.f.properties.label)}</text>`
  )
  .join("\n")}
  </g>
  <g id="echelle" transform="translate(${sbX},${sbY})" font-size="12" fill="${INK}">
    <rect x="0" y="-6" width="${r1(sbPx)}" height="6" fill="#ffffff" stroke="${INK}" stroke-width="0.8"/>
    <rect x="0" y="-6" width="${r1(sbPx / 2)}" height="6" fill="${INK}"/>
    <text x="0" y="-11">0</text>
    <text x="${r1(sbPx / 2)}" y="-11" text-anchor="middle">${km / 2}</text>
    <text x="${r1(sbPx)}" y="-11" text-anchor="middle" font-weight="600">${km} km</text>
  </g>
  <g id="legende" transform="translate(${W - M.right - 250},${H - M.bottom + 20})" font-size="12" fill="${INK}">
    <rect x="0" y="0" width="14" height="14" fill="${PETROL_LIGHT}" stroke="${PETROL}" stroke-width="0.8"/>
    <text x="20" y="11">Province mise en avant (nom affiché)</text>
    <rect x="0" y="22" width="14" height="14" fill="${GREY}" stroke="${GREY_STROKE}" stroke-width="0.8"/>
    <text x="20" y="33">Autre province</text>
  </g>
  <text id="source" x="${M.left}" y="${H - 16}" font-size="11" fill="#78716C">Fond : geoBoundaries gbOpen BDI ADM1 (${esc(info.boundaryID)}, CC0 1.0 domaine public), 18 provinces d'avant 2025 · projection Mercator · Datanime</text>
</svg>
`;
const outSvg = resolve(root, "studio/docs/shots/carte-burundi.svg");
writeFileSync(outSvg, svg);
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
const outPng = resolve(root, "studio/docs/shots/carte-burundi.png");
if (chrome) {
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=2",
    `--window-size=${W},${H}`, `--screenshot=${outPng}`, `file://${outSvg}`,
  ], { stdio: "ignore" });
} else console.warn("Chrome introuvable : PNG non régénéré");
console.log({ svg: outSvg, km, sbPx: r1(sbPx), labels: labels.map((l) => [l.f.properties.label, l.f.properties.name, r1(l.x), r1(l.y)]) });
