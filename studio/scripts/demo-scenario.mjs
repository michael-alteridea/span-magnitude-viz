#!/usr/bin/env node
/**
 * Scénario de démonstration de bout en bout (Chrome headless) sur le Studio construit (studio-dist/) :
 * lance un scénario persona, exporte une image PNG par snapshot (rendu complet : titre, commentaires,
 * cartouche) et le PowerPoint de l'histoire.
 *
 *   npm run build:studio && node studio/scripts/demo-scenario.mjs [--scenario dircom] [--out /chemin/dossier] [--pptx Nom.pptx] [--morph Nom-morph.pptx]
 *
 * --morph : PowerPoint supplémentaire avec transitions Morph (barres natives nommées « !! », séquence de
 * construction, repli fondu) ; QR des cartouches vers le mode lecture (#/lire/demo-…/<snapshot>).
 */
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const dist = join(repo, "studio-dist");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const scenario = arg("--scenario", "dircom");
const out = resolve(arg("--out", join(repo, "studio/docs/demo")));
const pptxName = arg("--pptx", `Datanime-demo-${scenario}.pptx`);
const morphName = arg("--morph", null);
mkdirSync(out, { recursive: true });

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
await page.waitForFunction(() => !!window.r4d && !!window.r4d.store.state.ds);
const ok = await page.evaluate((id) => window.r4d.scenario(id, true), scenario);
if (!ok) throw new Error("scénario impossible");
await page.waitForFunction(() => window.r4d.film().isOpen, { timeout: 60000 });
await page.evaluate(() => window.r4d.film().close());
const snaps = await page.evaluate(() => window.r4d.story().snapshots.map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, comments: s.comments, path: s.path, step: s.step, role: s.role, lire: window.r4d.readUrl(s) })));
const files = [];
for (let i = 0; i < snaps.length; i++) {
  const url = await page.evaluate(async (k) => {
    const s = window.r4d.story().snapshots[k];
    window.r4d.openSnapshot(s);
    await window.r4d.settle();
    window.r4d.seek(1);
    return window.r4d.pngDataUrl(2);
  }, i);
  const f = join(out, snaps[i].step ? `${snaps[i].step}.png` : `${String(i + 1).padStart(2, "0")}-snapshot.png`);
  writeFileSync(f, Buffer.from(url.split(",")[1], "base64"));
  files.push(f);
}
const b64 = await page.evaluate(() => window.r4d.pptxBase64());
const pptx = join(out, pptxName);
writeFileSync(pptx, Buffer.from(b64, "base64"));
let morph = null;
if (morphName) {
  const m64 = await page.evaluate(() => window.r4d.pptxBase64({ morph: true, build: true }));
  morph = join(out, morphName);
  writeFileSync(morph, Buffer.from(m64, "base64"));
}
writeFileSync(join(out, "snapshots.json"), JSON.stringify(snaps, null, 2));
console.log(JSON.stringify({ snapshots: snaps.length, files, pptx, morph, errors }, null, 2));
await browser.close();
server.close();
if (errors.length) process.exit(1);
