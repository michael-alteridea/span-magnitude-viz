#!/usr/bin/env node
/**
 * Pont Cadencer — publication des « manifestes de revue » (étape de `npm run build:studio`).
 *
 * Rendu headless (Chrome, même chemin que demo-scenario.mjs) du Studio construit (studio-dist/) pour les
 * histoires autonomes (démos « Directeur commercial » / « Directeur financier », revues Norvia) :
 *
 *   studio-dist/publie/index.json
 *   studio-dist/publie/<revue>/manifeste.json
 *   studio-dist/publie/<revue>/<snapshot>.png   (1600 × 900, cartouche, QR vers le mode lecture)
 *   studio-dist/publie/<revue>/<snapshot>.svg   (autonome, polices intégrées)
 *
 * Déterministe : dates de génération figées (données de démonstration), aucun horodatage de construction.
 * Contrat : studio/docs/contrat-cadencer.md. DATANIME_SKIP_PUBLIE=1 : étape ignorée (construction rapide).
 */
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const dist = join(repo, "studio-dist");
const outDir = join(dist, "publie");
const require = createRequire(import.meta.url);

if (process.env.DATANIME_SKIP_PUBLIE === "1") {
  console.warn("publish-manifests : étape ignorée (DATANIME_SKIP_PUBLIE=1) — studio-dist/publie/ absent");
  process.exit(0);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("studio-dist/ introuvable : lancez d'abord vite build");
  process.exit(2);
}

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    const dir = process.env.PUPPETEER_DIR ?? "/home/box/tools/pptr";
    return createRequire(join(dir, "package.json"))("puppeteer-core");
  }
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".csv": "text/csv; charset=utf-8" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let p = join(dist, url.slice(1) || "index.html");
  if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) p = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--font-render-hinting=none"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${origin}/?reset`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => !!window.r4d && !!window.r4d.store.state.ds, { timeout: 30000 });

const { PNG } = require("pngjs");
const jsQR = require("jsqr").default ?? require("jsqr");
const problems = [];
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const ids = await page.evaluate(() => window.r4d.publishedStories());
const manifests = [];
const summary = [];
for (const id of ids) {
  const pub = await page.evaluate((x) => window.r4d.publication(x, "publie"), id);
  if (!pub) {
    problems.push(`${id} : histoire introuvable`);
    continue;
  }
  const { manifest, images } = pub;
  const issues = await page.evaluate((m) => window.r4d.validateManifest(m), manifest);
  if (issues) problems.push(`${id} : manifeste invalide — ${issues.join(" ; ")}`);
  const dir = join(outDir, id);
  mkdirSync(dir, { recursive: true });
  const prefix = `${manifest.lien_lecture.split("#")[0]}publie/${encodeURIComponent(id)}/`;
  for (const [k, s] of manifest.snapshots.entries()) {
    const img = images[k];
    if (!s.image_png.startsWith(prefix)) problems.push(`${id}/${s.id} : adresse PNG inattendue ${s.image_png}`);
    const pngBuf = Buffer.from(img.png.split(",")[1], "base64");
    const pngFile = join(dir, decodeURIComponent(s.image_png.slice(prefix.length)));
    writeFileSync(pngFile, pngBuf);
    const png = PNG.sync.read(pngBuf);
    if (png.width !== 1600 || png.height !== 900) problems.push(`${id}/${s.id} : PNG ${png.width}×${png.height} (1600×900 attendu)`);
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (!qr || qr.data !== s.lien_lecture) problems.push(`${id}/${s.id} : QR ${qr ? qr.data : "illisible"} ≠ ${s.lien_lecture}`);
    if (s.image_svg) {
      if (!img.svg) problems.push(`${id}/${s.id} : SVG annoncé mais absent`);
      else writeFileSync(join(dir, decodeURIComponent(s.image_svg.slice(prefix.length))), img.svg);
    }
    summary.push({ id, snap: s.id, png: sha(pngBuf), kb: Math.round(pngBuf.length / 1024), svgKb: img.svg ? Math.round(img.svg.length / 1024) : 0 });
  }
  writeFileSync(join(dir, "manifeste.json"), JSON.stringify(manifest, null, 2) + "\n");
  manifests.push(manifest);
}
const genere = manifests.map((m) => m.genere_le).sort((a, b) => Date.parse(a) - Date.parse(b)).pop();
const index = await page.evaluate((ms, g) => window.r4d.publicationIndex(ms, g), manifests, genere);
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
await browser.close();
server.close();
if (errors.length) problems.push(...errors.map((e) => `console : ${e}`));
const total = summary.reduce((a, s) => a + s.kb + s.svgKb, 0);
console.log(`publish-manifests : ${manifests.length} manifestes, ${summary.length} images (${Math.round(total / 1024 * 10) / 10} Mo) → ${outDir}`);
for (const m of manifests) console.log(`  ${m.id} · ${m.snapshots.length} snapshots · empreinte ${m.empreinte.slice(0, 8)} · ${index.revues.find((r) => r.id === m.id)?.manifeste}`);
if (process.argv.includes("--details")) console.log(JSON.stringify(summary, null, 1));
if (problems.length) {
  console.error("ÉCHEC :\n  " + problems.join("\n  "));
  process.exit(1);
}
