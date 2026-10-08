#!/usr/bin/env node
/**
 * Tests de bout en bout (Chrome headless) du Studio construit dans studio-dist/.
 *
 *   npm run build:studio && npm run test:e2e:studio            # vérifications
 *   node studio/scripts/e2e.mjs --shots                         # + captures dans studio/docs/shots/
 *
 * Variables : CHROME_PATH (défaut /usr/bin/google-chrome), PUPPETEER_DIR (dossier où
 * puppeteer-core est installé si ce n'est pas une dépendance du projet).
 *
 * Le site est servi sous un sous-chemin (/e2e/sous/chemin/) pour vérifier la base relative.
 */
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const dist = join(repo, "studio-dist");
const shotsDir = join(repo, "studio/docs/shots");
const SHOTS = process.argv.includes("--shots");
const BASE = "/e2e/sous/chemin/";

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    const dir = process.env.PUPPETEER_DIR ?? "/home/box/tools/pptr";
    return createRequire(join(dir, "package.json"))("puppeteer-core");
  }
}

if (!existsSync(join(dist, "index.html"))) {
  console.error("studio-dist/ introuvable : lancez d'abord npm run build:studio");
  process.exit(2);
}

/* ------------------------------------------------------------ serveur statique */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!url.startsWith(BASE)) return void res.writeHead(404).end();
  let p = join(dist, url.slice(BASE.length) || "index.html");
  if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) p = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------ navigateur */
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: SHOTS ? 1.5 : 1 });

const errors = [];
const warnings = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  else if (m.type() === "warning") warnings.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push(`requête échouée : ${r.url()} (${r.failure()?.errorText})`));

const dl = join(tmpdir(), `r4d-e2e-${Date.now()}`);
mkdirSync(dl, { recursive: true });
const cdp = await browser.target().createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}
async function waitDownload(prefixExt, before) {
  for (let i = 0; i < 100; i++) {
    const f = readdirSync(dl).filter((n) => !before.includes(n) && n.endsWith(prefixExt));
    if (f.length) return join(dl, f[0]);
    await sleep(100);
  }
  return null;
}
const stageInfo = () =>
  page.evaluate(() => ({
    marks: document.querySelectorAll('[data-testid=chart-svg] .r4d-marks *').length,
    empty: document.querySelector("[data-testid=chart-svg] .r4d-empty")?.textContent ?? null,
    special: document.querySelectorAll("[data-testid=special-host] svg *").length,
    title: document.querySelector("[data-testid=chart-svg] .r4d-title")?.textContent ?? null,
  }));
async function shotStage(name) {
  if (!SHOTS) return;
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 2 });
  await sleep(300);
  await (await page.$(".stage")).screenshot({ path: join(shotsDir, name) });
  await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
}
async function domClick(sel) {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.closest("details")?.setAttribute("open", "");
    el.click();
    return true;
  }, sel);
  if (!ok) throw new Error("élément introuvable : " + sel);
}
async function selectValue(sel, value) {
  await page.evaluate(
    (s, v) => {
      const el = document.querySelector(s);
      if (!el) throw new Error("select introuvable : " + s);
      el.closest("details")?.setAttribute("open", "");
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    sel,
    value
  );
}
if (SHOTS) mkdirSync(shotsDir, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
/** « 3f9a·c21e » d'une URL de vérification (fragment compact). */
const xp_hash_prefix = (url) => {
  const h = (url.split("#")[1] ?? "").split(".")[2]?.toLowerCase() ?? "";
  return `${h.slice(0, 4)}·${h.slice(4, 8)}`;
};
/** Même normalisation que provenance.ts (texte collé). */
const normPaste = (t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/[ \u00a0]+$/gm, "").replace(/\s+$/, "");
const JSQR = join(repo, "node_modules/jsqr/dist/jsQR.js");
/** Cartouche de l'aperçu : présence, QR, rectangle, chevauchements avec les autres éléments du graphique. */
const cartoucheInfo = () =>
  page.evaluate(() => {
    const svg = document.querySelector("[data-testid=chart-svg]");
    const c = svg.querySelector(".r4d-cartouche");
    if (!c) return null;
    const box = c.querySelector(".r4d-cartouche-box").getBoundingClientRect();
    const qr = c.querySelector(".r4d-qr");
    const hit = (r) => r.width > 0 && r.height > 0 && !(r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom);
    const others = [...svg.querySelectorAll(".r4d-axis-x text, .r4d-axis-y text, .r4d-axis-y2 text, .r4d-legend *, .r4d-marks *, .r4d-comment text, .r4d-title, .r4d-subtitle, .r4d-value"), ...document.querySelectorAll("[data-testid=special-host] .smv-map-scale, [data-testid=special-host] .smv-map-scale *")];
    const overlaps = others.filter((e) => hit(e.getBoundingClientRect())).map((e) => `${e.tagName}.${e.getAttribute("class") ?? e.parentNode?.getAttribute?.("class") ?? ""}`);
    const text = (sel) => [...c.querySelectorAll(sel)].map((e) => e.textContent.replace(/[\u00a0\u202f]/g, " "));
    return {
      w: box.width, h: box.height, ratio: box.width / box.height,
      relW: box.width / svg.getBoundingClientRect().width,
      href: c.querySelector("a.r4d-cartouche-link")?.getAttribute("href"),
      brand: c.querySelector(".r4d-brand")?.textContent,
      date: text(".r4d-cartouche-date")[0] ?? "",
      data: text(".r4d-cartouche-data").join(" "),
      source: text(".r4d-source")[0] ?? "",
      fp: text(".r4d-fingerprint")[0] ?? "",
      qr: qr ? { url: qr.getAttribute("data-url"), version: +qr.getAttribute("data-version"), modules: +qr.getAttribute("data-modules"), x: +qr.getAttribute("x"), y: +qr.getAttribute("y"), size: +qr.getAttribute("width"), vb: qr.getAttribute("viewBox") } : null,
      overlaps,
    };
  });
/** Décode le QR d'un PNG (data URL / base64) avec jsQR, sur la zone du QR (+ marge) à l'échelle donnée. */
async function decodeQr(pngB64, qr, scale) {
  await page.addScriptTag({ path: JSQR });
  return page.evaluate(
    async (b64, q, k) => {
      const img = new Image();
      img.src = b64.startsWith("data:") ? b64 : "data:image/png;base64," + b64;
      await img.decode();
      const m = 12 * k;
      const sx = Math.max(0, Math.floor(q.x * k - m));
      const sy = Math.max(0, Math.floor(q.y * k - m));
      const sw = Math.min(img.width - sx, Math.ceil(q.size * k + 2 * m));
      const sh = Math.min(img.height - sy, Math.ceil(q.size * k + 2 * m));
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const r = window.jsQR(ctx.getImageData(0, 0, sw, sh).data, sw, sh);
      return { data: r?.data ?? null, width: img.width };
    },
    pngB64,
    qr,
    scale
  );
}

let xlsxFile = null;
let xlsxUrl = "";
let sampleUrl = "";
let pasteUrlG = "";
try {
  await page.goto(`${origin}${BASE}?reset=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid=chart-svg] .r4d-marks");
  const header = await page.$eval("header", (e) => e.textContent ?? "");
  check("en-tête « Tell4D · Studio »", /Tell4D\s*·\s*Studio/.test(header) && !/Reporting 4D/.test(header));
  // Identité Tell4D bleu pétrole : bouton principal, logo « Bulle + barres », palette par défaut, titre, favicon
  const brand = await page.evaluate(() => ({
    btn: getComputedStyle(document.querySelector("[data-testid=export-svg]")).backgroundColor,
    logo: document.querySelector(".brand .logo stop")?.getAttribute("stop-color"),
    bars: document.querySelectorAll(".brand .logo svg rect").length,
    palette: window.r4d.getSpec().style.palette,
    title: document.title,
    icon: document.querySelector("link[rel=icon]")?.getAttribute("href"),
    touch: document.querySelector("link[rel=apple-touch-icon]")?.getAttribute("href"),
  }));
  check(
    "identité Tell4D (bouton, logo Bulle + barres, palette, titre, favicon)",
    brand.btn === "rgb(63, 167, 196)" && brand.logo === "#0E6E8C" && brand.bars >= 12 && brand.palette === "petrole" && /^Tell4D · Studio/.test(brand.title) && /favicon\.svg$/.test(brand.icon ?? "") && /apple-touch-icon\.png$/.test(brand.touch ?? ""),
    JSON.stringify(brand)
  );
  {
    const icons = await page.evaluate(async () => {
      const get = async (sel) => {
        const r = await fetch(document.querySelector(sel).href);
        return { ok: r.ok, type: r.headers.get("content-type") };
      };
      return { svg: await get("link[rel=icon]"), png: await get("link[rel=apple-touch-icon]") };
    });
    check("favicon SVG + apple-touch-icon 180 px servis", icons.svg.ok && icons.png.ok && /svg/.test(icons.svg.type) && /png/.test(icons.png.type), JSON.stringify(icons));
  }

  /* 1. Collage type Excel (tabulations, virgule décimale, mois FR) */
  const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const lines = ["Mois\tRégion\tVentes (€)\tMarge (%)\tCommandes"];
  months.forEach((m, i) =>
    ["Île-de-France", "Bruxelles", "Wallonie"].forEach((r, j) => {
      const v = (120000 + i * 8500 + j * 41000 + ((i * 7 + j * 13) % 9) * 3100) * (i >= 9 ? 1.04 : 1);
      lines.push(`${m} 2026\t${r}\t${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")}\t${(18 + j * 3.5 + (i % 4) * 0.7).toFixed(1).replace(".", ",")}\t${200 + i * 11 + j * 37}`);
    })
  );
  const tsv = lines.join("\n");
  await page.evaluate(() => document.querySelector("[data-testid=paste-area]")?.closest("details")?.setAttribute("open", ""));
  await page.$eval("[data-testid=paste-area]", (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, tsv);
  await domClick("[data-testid=paste-apply]");
  await sleep(600);
  const cols = await page.evaluate(() => window.r4d.store.state.ds?.columns.map((c) => `${c.name}:${c.type}`));
  check(
    "collage TSV : 36 lignes, types détectés",
    JSON.stringify(cols) === JSON.stringify(["Mois:date", "Région:category", "Ventes (€):number", "Marge (%):number", "Commandes:number"]),
    (cols ?? []).join(", ")
  );
  const first = await page.evaluate(() => window.r4d.store.state.ds?.rows[0]);
  check("collage TSV : décimales FR", Math.abs(first?.["Ventes (€)"] - 120000) < 1 && first?.Mois === Date.UTC(2026, 0, 1), JSON.stringify(first));
  const rowsN = await page.evaluate(() => window.r4d.store.state.ds?.rows.length);
  check("collage TSV : nombre de lignes", rowsN === 36, String(rowsN));
  const pasteProv = await page.evaluate(() => window.r4d.provenance());
  const pasteHash = sha256(Buffer.from(normPaste(lines.join("\r\n") + "\r\n"), "utf8"));
  check("collage : empreinte SHA-256 du texte normalisé (CRLF → LF), horodatage, dimensions", pasteProv?.kind === "paste" && pasteProv.hash === pasteHash && pasteProv.hash === sha256(Buffer.from(tsv, "utf8")) && pasteProv.rows === 36 && pasteProv.cols === 5 && Math.abs(Date.parse(pasteProv.importedAt) - Date.now()) < 120000, `${pasteProv?.kind} ${pasteProv?.hash?.slice(0, 12)}… ${pasteProv?.rows}×${pasteProv?.cols}`);
  pasteUrlG = (await cartoucheInfo())?.qr?.url ?? "";
  check("collage : QR de type « texte collé » (P)", /verifier\.html#1\.P\.[0-9A-F]{32}\.\d{8}\.\d{8}\.36\.5$/.test(pasteUrlG), pasteUrlG);

  /* 1 bis. Import XLSX (fichier généré avec SheetJS, dates Excel en jours entiers) */
  {
    const XLSX = createRequire(join(repo, "package.json"))("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["Date", "Agence", "Montant (€)"],
      [new Date(2026, 8, 30), "Lyon", 1520.5],
      [new Date(2026, 9, 8), "Bruxelles", 980],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Octobre");
    const xf = join(dl, "import-test.xlsx");
    XLSX.writeFile(wb, xf);
    const input = await page.$("[data-testid=file-input]");
    await input.uploadFile(xf);
    await page.waitForFunction(() => window.r4d.store.state.ds?.name?.includes("import-test"), { timeout: 8000 }).catch(() => {});
    const x = await page.evaluate(() => ({ cols: window.r4d.store.state.ds?.columns.map((c) => `${c.name}:${c.type}`), r: window.r4d.store.state.ds?.rows[1] }));
    check("import XLSX", JSON.stringify(x.cols) === JSON.stringify(["Date:date", "Agence:category", "Montant (€):number"]) && x.r?.Date === Date.UTC(2026, 9, 8), `${(x.cols ?? []).join(", ")} · ${new Date(x.r?.Date).toISOString()}`);
    await page.waitForFunction(() => window.r4d.provenance()?.kind === "file", { timeout: 5000 }).catch(() => {});
    await sleep(200);
    const xp = await page.evaluate(() => window.r4d.provenance());
    check("fichier : empreinte SHA-256 des octets bruts, nom, dimensions (persistée dans le spec)", xp?.kind === "file" && xp.hash === sha256(readFileSync(xf)) && xp.fileName === "import-test.xlsx" && xp.rows === 2 && xp.cols === 3 && (await page.evaluate(() => window.r4d.getSpec().provenance?.hash)) === xp.hash, `${xp?.hash?.slice(0, 12)}… ${xp?.fileName}`);
    xlsxFile = xf;
    xlsxUrl = (await cartoucheInfo())?.qr?.url ?? "";
    check("cartouche : QR vers verifier.html avec l'empreinte du fichier", xlsxUrl.startsWith("https://alteridea-dashboard.web.app/reporting/verifier.html#1.F." + xp?.hash?.slice(0, 32).toUpperCase() + "."), xlsxUrl);
    await page.evaluate((t) => window.r4d.importText(t), tsv);
    await sleep(500);
  }

  /* 2. Chaque type de graphique */
  const types = await page.$$eval("[data-testid^=type-]", (els) => els.map((e) => e.dataset.type));
  check("galerie : 14 types", types.length === 14, types.join(","));
  for (const t of types) {
    if (t === "film" || t === "map") continue;
    await page.click(`[data-testid=type-${t}]`);
    await sleep(t === "bar" ? 700 : 500);
    await page.evaluate(() => window.r4d.seek(1));
    await sleep(150);
    const info = await stageInfo();
    check(`type ${t}`, info.marks > 0 && !info.empty, `${info.marks} éléments${info.empty ? " · " + info.empty : ""}`);
  }
  // Les spéciaux ont besoin de dates début/fin et de codes postaux : échantillon « pipeline ».
  await domClick("[data-testid=sample-pipeline]");
  await sleep(800);
  for (const t of ["film", "map"]) {
    await page.click(`[data-testid=type-${t}]`);
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=special-host] svg *").length > 20, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => window.r4d.seek(0.8));
    await sleep(400);
    const info = await stageInfo();
    check(`type ${t} (spécial)`, info.special > 20 && !info.empty, `${info.special} éléments SVG`);
    if (t === "map") {
      // Barre d'échelle en km sur toutes les cartes (FR·BE, Europe à chaque maille)
      const scales = [];
      for (const [region, level] of [["fr-be", null], ["europe", "country"], ["europe", "nuts1"], ["europe", "nuts2"], ["europe", "nuts3"]]) {
        await page.evaluate((r, l) => {
          window.r4d.set("special.mapRegion", r);
          if (l) window.r4d.set("special.mapLevel", l);
        }, region, level);
        await page.waitForFunction(() => !!document.querySelector("[data-testid=special-host] .smv-map-scale"), { timeout: 10000 }).catch(() => {});
        await sleep(300);
        scales.push(
          await page.evaluate((r, l) => {
            const g = document.querySelector("[data-testid=special-host] .smv-map-scale");
            return { where: l ? `${r}/${l}` : r, km: Number(g?.getAttribute("data-km")), px: Number(g?.getAttribute("data-px")), label: g?.querySelector(".smv-map-scale-label")?.textContent ?? "" };
          }, region, level)
        );
      }
      check("carte : barre d'échelle en km (FR·BE + Europe, toutes mailles)", scales.every((x) => x.km > 0 && x.px > 20 && /^\d[\d\s]*\s?km$/.test(x.label)), scales.map((x) => `${x.where} ${x.label}`).join(" · "));
      await page.evaluate(() => window.r4d.set("special.mapRegion", "fr-be"));
      await page.waitForFunction(() => !!document.querySelector("[data-testid=special-host] .smv-map-scale"), { timeout: 10000 }).catch(() => {});
      await sleep(400);
      const bm = readdirSync(dl);
      await domClick("[data-testid=export-svg]");
      const mapSvg = await waitDownload(".svg", bm);
      const mapText = mapSvg ? readFileSync(mapSvg, "utf8") : "";
      check("export SVG de la carte : barre d'échelle + signature", /data-km="\d+"/.test(mapText) && /\d km</.test(mapText.replace(/[\u00a0\u202f]/g, " ")) && mapText.includes("r4d-cartouche") && mapText.includes("r4d-qr"), mapSvg ? "ok" : "aucun fichier");
      const mc = await cartoucheInfo();
      const scaleBar = await page.evaluate(() => !!document.querySelector("[data-testid=special-host] .smv-map-scale"));
      const mapSrc = await page.evaluate(() => [...document.querySelectorAll("[data-testid=preview] .r4d-map-source, .r4d-cartouche .r4d-map-source")].map((e) => e.textContent));
      check("carte : source et licence du fond dans le cartouche (© EuroGeographics, usage non commercial)", mapSrc.some((t) => /EuroGeographics/.test(t)) && mapSrc.some((t) => /non commercial/.test(t)) && mapText.includes("Limites GISCO : usage non commercial"), mapSrc.join(" · "));
      if (process.env.R4D_MAP_SHOT) await (await page.$(".r4d-cartouche"))?.screenshot({ path: process.env.R4D_MAP_SHOT });
      check("carte : cartouche + QR sans chevauchement (barre d'échelle km, carte)", !!mc?.qr && scaleBar && mc.overlaps.length === 0 && /#1\.E\./.test(mc.qr.url), mc ? `${Math.round(mc.w)}×${Math.round(mc.h)} · ${mc.overlaps.length ? "chevauche " + mc.overlaps.slice(0, 3).join(", ") : "aucun chevauchement"}` : "absent");
      await page.click("[data-testid=type-film]");
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=special-host] svg *").length > 20, { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => window.r4d.seek(0.8));
      await sleep(300);
    }
  }
  // Compteurs du film au format français (bibliothèque, locale « fr ») : « 10,6 M€ », espace fine insécable
  await page.evaluate(() => window.r4d.seek(1));
  await sleep(400);
  const counters = await page.evaluate(() => ({
    mag: document.querySelector("[data-testid=special-host] [data-role=magnitude]")?.textContent ?? "",
    count: document.querySelector("[data-testid=special-host] [data-role=count]")?.textContent ?? "",
    labels: [...document.querySelectorAll("[data-testid=special-host] .smv-ticker-label")].map((e) => e.textContent).join(" | "),
    ticks: [...document.querySelectorAll("[data-testid=special-host] .smv-axis text")].map((e) => e.textContent).slice(0, 3).join(" | "),
  }));
  check(
    "Film 4D : compteurs et axe au format français",
    /^(\d{1,3}(,\d)?\u202f(k|M)€|\d{1,3}(\u202f\d{3})?\u202f€)$/.test(counters.mag) && /^\d+$/.test(counters.count.replace(/\u202f/g, "")) && !/\./.test(counters.mag) && /Affaires/i.test(counters.labels) && !/^\d{4}-\d{2}/.test(counters.ticks),
    `${counters.count} · ${counters.mag} · ${counters.labels} · ${counters.ticks}`
  );
  const before0 = readdirSync(dl);
  await domClick("[data-testid=export-svg]");
  const filmSvg = await waitDownload(".svg", before0);
  check("export SVG du film", !!filmSvg && /<svg[\s\S]*<\/svg>\s*$/.test(readFileSync(filmSvg, "utf8")), filmSvg ?? "aucun fichier");

  /* 3. Axe logarithmique (via l'interface) */
  await domClick("[data-testid=sample-canaux]");
  await sleep(700);
  await page.click("[data-testid=type-scatter]");
  await sleep(500);
  await domClick('[data-path="axes.y.scale"] [data-value="log"]');
  await sleep(500);
  const logState = await page.evaluate(() => ({
    scale: window.r4d.getSpec().axes.y.scale,
    ticks: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-axis-y text")].map((t) => t.textContent),
  }));
  check("axe Y logarithmique", logState.scale === "log" && logState.ticks.length >= 2, `${logState.scale} : ${logState.ticks.join(" | ")}`);

  /* 4. Second axe Y (via l'interface) */
  await domClick("[data-testid=sample-ventes]");
  await sleep(700);
  await page.click("[data-testid=type-line]");
  await sleep(500);
  await selectValue('select[data-path="encoding.y2"]', "Marge (%)");
  await sleep(900);
  const y2 = await page.evaluate(() => ({
    y2: window.r4d.getSpec().encoding.y2,
    ticks: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-axis-y2 text")].map((t) => t.textContent),
    path: !!document.querySelector("[data-testid=chart-svg] .r4d-y2 path"),
  }));
  check("second axe Y (droite)", y2.y2 === "Marge (%)" && y2.ticks.length >= 2 && y2.path, y2.ticks.join(" | "));

  /* 5. Exports SVG + PNG */
  const b1 = readdirSync(dl);
  await domClick("[data-testid=export-svg]");
  const svgFile = await waitDownload(".svg", b1);
  const svgText = svgFile ? readFileSync(svgFile, "utf8") : "";
  check(
    "export SVG autonome",
    /@font-face/.test(svgText) && /data:font\/woff2;base64,/.test(svgText) && /<svg[^>]+viewBox="0 0 1200 675"/.test(svgText) && !/(src|href)="(?!data:|#|https:\/\/alteridea-dashboard\.web\.app\/reporting\/"|https:\/\/alteridea-dashboard\.web\.app\/reporting\/verifier\.html#1\.[FPEC]\.[0-9A-F]{32}\.\d{8}\.\d{8}\.\d+\.\d+")[^"]+"/.test(svgText),
    svgFile ? `${(svgText.length / 1024).toFixed(0)} Ko` : "aucun fichier"
  );
  {
    const flat = svgText.replace(/[\u00a0\u202f]/g, " ");
    const dateRe = /Généré le \d{1,2}(er)? (janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\.? \d{4}/;
    check(
      "export SVG : signature (icône Tell4D inline, « Tell4D », lien plateforme) + date de génération",
      flat.includes('class="r4d-cartouche"') &&
        flat.includes('href="https://alteridea-dashboard.web.app/reporting/"') &&
        />Tell4D</.test(flat) &&
        !/Reporting 4D/.test(flat.replace(/<metadata>.*?<\/metadata>/s, "")) &&
        dateRe.test(flat) &&
        /<svg(?=[^>]*\sclass="r4d-logo")(?=[^>]*\sviewBox="0 0 512 512")[^>]*>/.test(flat),
      (flat.match(dateRe) ?? ["date absente"])[0]
    );
  }
  {
    const ci = await cartoucheInfo();
    sampleUrl = ci?.qr?.url ?? "";
    const flat = svgText.replace(/[\u00a0\u202f]/g, " ");
    check(
      "cartouche : bloc rectangulaire (logo, « Tell4D » en lien, généré le, données d'exemple, source, empreinte, QR), discret",
      !!ci && ci.href === "https://alteridea-dashboard.web.app/reporting/" && ci.brand === "Tell4D" && /^Généré le \d/.test(ci.date) && /^Données d'exemple au \d{1,2} \S+ \d{4}$/.test(ci.data) && /^Empreinte [0-9a-f]{4}·[0-9a-f]{4}$/.test(ci.fp) && !!ci.qr && ci.ratio >= 1.5 && ci.ratio <= 2.8 && ci.relW < 0.22 && ci.overlaps.length === 0,
      ci ? `${Math.round(ci.w)}×${Math.round(ci.h)} px (${ci.ratio.toFixed(2)}:1, ${(ci.relW * 100).toFixed(0)} % de la largeur) · ${ci.data} · ${ci.fp} · QR v${ci.qr?.version} ${ci.qr?.modules} modules${ci.overlaps.length ? " · chevauche " + ci.overlaps.slice(0, 4).join(", ") : ""}` : "absent"
    );
    check("export SVG : QR (lien « Vérifier l'empreinte ») + empreinte, vocabulaire sobre", flat.includes('class="r4d-qr"') && flat.includes("Vérifier l'empreinte") && /Empreinte [0-9a-f]{4}·[0-9a-f]{4}/.test(flat.replace(/<[^>]+>/g, "")) && !/certifi|authenticit|preuve/i.test(flat) && /"verify":"https:\/\/alteridea-dashboard\.web\.app\/reporting\/verifier\.html#1\./.test(flat));
  }
  await selectValue("[data-testid=png-scale]", "2");
  const b2 = readdirSync(dl);
  await domClick("[data-testid=export-png]");
  const pngFile = await waitDownload(".png", b2);
  let dims = null;
  if (pngFile) {
    const buf = readFileSync(pngFile);
    dims = buf.toString("ascii", 1, 4) === "PNG" ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;
  }
  check("export PNG 2×", dims?.[0] === 2400 && dims?.[1] === 1350, dims ? dims.join("×") : "aucun fichier");
  if (pngFile) {
    // L'icône Tell4D de la signature est bien dans le PNG : pixel du fond pétrole (bord gauche de l'icône,
    // hors bulle blanche), échelle 2×
    const logo = await page.evaluate(() => {
      const r = document.querySelector("[data-testid=chart-svg] .r4d-logo");
      return r ? { x: +r.getAttribute("x") + +r.getAttribute("width") * 0.07, y: +r.getAttribute("y") + +r.getAttribute("height") / 2 } : null;
    });
    const px = logo
      ? await page.evaluate(
          async (b64, x, y) => {
            const img = new Image();
            img.src = "data:image/png;base64," + b64;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return [...ctx.getImageData(Math.round(x * 2), Math.round(y * 2), 1, 1).data];
          },
          readFileSync(pngFile).toString("base64"),
          logo.x,
          logo.y
        )
      : null;
    const near = px && px[0] < 70 && px[1] > 60 && px[1] < 150 && px[2] > 85 && px[2] < 180 && px[2] > px[0] + 50;
    check("export PNG : signature présente (icône Tell4D pétrole en bas à droite)", !!near, px ? `rgb(${px.slice(0, 3).join(", ")}) @ ${Math.round(logo.x)},${Math.round(logo.y)}` : "logo introuvable");
    const frame = await page.evaluate(() => window.r4d.preview.svgAt(0.5));
    check("vidéo WebM : chaque image porte la signature et la date", frame.includes("r4d-cartouche") && /Généré le/.test(frame) && frame.includes("r4d-qr"));
    // QR décodable dans les PNG (2×, 1×, et un graphique de 1600 px de large), ≥ 1,5 px par module, marge claire
    const ci = await cartoucheInfo();
    const q = ci?.qr;
    const dec = [];
    if (q) {
      const quiet = -Number(q.vb.split(" ")[0]);
      dec.push({ label: "PNG 2×", k: 2, ...(await decodeQr(readFileSync(pngFile).toString("base64"), q, 2)), ppm: (q.size * 2) / (q.modules + 2 * quiet), quiet });
      dec.push({ label: "PNG 1×", k: 1, ...(await decodeQr(await page.evaluate(() => window.r4d.pngDataUrl(1)), q, 1)), ppm: q.size / (q.modules + 2 * quiet), quiet });
      await page.evaluate(() => window.r4d.set("style.size", { preset: "custom", width: 1600, height: 900 }));
      await sleep(700);
      const q16 = (await cartoucheInfo())?.qr;
      if (q16) dec.push({ label: "PNG 1600 px", k: 1, ...(await decodeQr(await page.evaluate(() => window.r4d.pngDataUrl(1)), q16, 1)), ppm: q16.size / (q16.modules + 2 * quiet), quiet });
      await page.evaluate(() => window.r4d.set("style.size", { preset: "16:9", width: 1200, height: 675 }));
      await sleep(500);
    }
    check(
      "QR décodé (jsQR) dans les PNG : URL de vérification, ≥ 21 modules, ≥ 1,5 px/module, marge claire",
      dec.length === 3 && dec.every((d) => d.data === q.url && d.ppm >= 1.5 && d.quiet >= 2) && q.modules >= 21 && q.version <= 6,
      dec.map((d) => `${d.label} (${d.width} px) ${d.data === q?.url ? "✓" : "✗"} ${d.ppm.toFixed(2)} px/module`).join(" · ") + ` · v${q?.version} (${q?.modules} modules)`
    );
    // Option « QR d'empreinte des données » (Réglages › Style) : masque le QR seulement
    await domClick('[data-path="style.authQr"]');
    await sleep(500);
    const off = await cartoucheInfo();
    await domClick('[data-path="style.authQr"]');
    await sleep(500);
    const on = await cartoucheInfo();
    check("option « QR d'empreinte des données » : masque le QR, garde le cartouche (offre gratuite)", !!off && !off.qr && off.brand === "Tell4D" && /^Empreinte/.test(off.fp) && !!on?.qr && (await page.evaluate(() => window.r4d.getSpec().style.authQr)) === true, off ? `sans QR : ${Math.round(off.w)}×${Math.round(off.h)} px` : "cartouche absent");
  }

  /* 6. Sauvegarde / chargement de configuration */
  const b3 = readdirSync(dl);
  await domClick("[data-testid=save-config]");
  const cfgFile = await waitDownload(".json", b3);
  let cfgOk = false;
  if (cfgFile) {
    const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
    cfgOk = cfg.kind === "reporting-4d-studio" && cfg.spec?.$schema === "reporting-4d-studio/spec-v1" && cfg.spec.encoding.y2 === "Marge (%)";
    await page.click("[data-testid=type-donut]");
    await sleep(300);
    const input = await page.$("[data-testid=config-input]");
    await input.uploadFile(cfgFile);
    await sleep(900);
    cfgOk = cfgOk && (await page.evaluate(() => window.r4d.getSpec().type)) === "line";
  }
  check("enregistrer / ouvrir la configuration JSON", cfgOk);

  /* 7. Persistance de session */
  await sleep(800); // sauvegarde différée
  await page.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
  await sleep(700);
  const restored = await page.evaluate(() => ({ t: window.r4d.getSpec().type, y2: window.r4d.getSpec().encoding.y2 }));
  check("session restaurée (localStorage)", restored.t === "line" && restored.y2 === "Marge (%)", JSON.stringify(restored));

  /* 8. 4D : lecture puis position intermédiaire */
  await page.evaluate(() => {
    window.r4d.loadSample("ventes");
  });
  await sleep(600);
  await page.evaluate(() => {
    window.r4d.set("mode.kind", "dynamic");
    window.r4d.set("mode.fourD.enabled", true);
    window.r4d.set("encoding.time", "Mois");
  });
  await sleep(600);
  await page.evaluate(() => window.r4d.seek(0.55));
  await sleep(300);
  const label = await page.$eval("[data-testid=time-label]", (e) => e.textContent);
  const stamp = await page.evaluate(() => document.querySelector("[data-testid=chart-svg] .r4d-stamp")?.textContent ?? "");
  check("4D : position intermédiaire", /20(24|25|26)/.test(stamp + label), `${stamp} · ${label}`);

  /* 9. Récit : Explorer, titres calculés, édition, snapshots, PowerPoint */
  if (SHOTS) await page.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
  await page.evaluate(() => window.r4d.store.setStory({ title: "Revue commerciale T3 2026", snapshots: [] }));
  for (const [id, shot] of [["pipeline", "11-explorer-pipeline.png"], ["business-review", "12-explorer-business-review.png"]]) {
    await domClick(`[data-testid=sample-${id}]`);
    await sleep(700);
    await domClick("[data-testid=explore-data]");
    await page.waitForSelector("[data-testid=explorer-card]", { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".explorer-thumb svg[data-loading]"), { timeout: 8000 }).catch(() => {});
    await sleep(500);
    const cards = await page.$$eval("[data-testid=explorer-card]", (els) =>
      els.map((e) => {
        const svg = e.querySelector(".explorer-thumb svg");
        const r = svg?.getBoundingClientRect();
        const vb = svg?.viewBox?.baseVal;
        const k = r && vb?.width ? r.width / vb.width : 0;
        const sizes = [...(svg?.querySelectorAll("text") ?? [])].map((t) => Number(t.getAttribute("font-size") || 0) * k);
        return { kind: e.dataset.kind, title: e.querySelector("h3")?.textContent ?? "", why: e.querySelector(".explorer-why")?.textContent ?? "", thumb: svg?.querySelectorAll("*").length ?? 0, w: Math.round(r?.width ?? 0), minFont: sizes.length ? Math.min(...sizes) : 0, texts: sizes.length, paths: svg?.querySelectorAll(".mini-map path").length ?? 0 };
      })
    );
    check(`Explorer « ${id} » : 5 à 8 pistes avec vignette, titre, pourquoi`, cards.length >= 5 && cards.length <= 8 && cards.every((c) => c.title.length > 10 && c.why.length > 10 && c.thumb > 0), `${cards.length} : ${cards.map((c) => c.kind).join(", ")}`);
    // Vignettes lisibles : au moins 340 px de large, 1 à 3 libellés, aucun texte sous 12 px ; carte = vraie choroplèthe FR/BE
    check(
      `Explorer « ${id} » : vignettes lisibles (≥ 340 px, textes ≥ 12 px, carte FR/BE)`,
      cards.every((c) => c.w >= 340 && c.texts >= 1 && c.texts <= 3 && c.minFont >= 12) && cards.filter((c) => c.kind === "geo").every((c) => c.paths > 50),
      cards.map((c) => `${c.kind} ${c.w}px ${c.texts}×≥${c.minFont.toFixed(1)}px${c.kind === "geo" ? ` ${c.paths} zones` : ""}`).join(" · ")
    );
    if (SHOTS) await page.screenshot({ path: join(shotsDir, shot) });
    const pick = id === "pipeline" ? cards.findIndex((c) => c.kind === "concentration") : cards.findIndex((c) => c.kind === "variance" && /budget/i.test(c.title));
    const idx = Math.max(0, pick);
    await page.evaluate((i) => document.querySelectorAll("[data-testid=explorer-open]")[i].click(), idx);
    await sleep(900);
    const opened = await page.evaluate(() => ({ kind: window.r4d.getSpec().story.kind, title: window.r4d.getSpec().style.title, explorer: !document.querySelector("[data-testid=explorer]").classList.contains("hidden"), comments: document.querySelectorAll("[data-testid=chart-svg] .r4d-comment").length, svgTitle: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-title")].map((t) => t.textContent).join(" ") }));
    const info = await stageInfo();
    check(`Explorer « ${id} » : « Ouvrir » charge le graphique et son récit`, opened.kind === cards[idx].kind && opened.title === cards[idx].title && !opened.explorer && opened.comments >= 1 && (info.marks > 0 || info.special > 0), `${opened.kind} · « ${opened.title} » · ${opened.comments} commentaire(s)`);
    if (id === "pipeline") check("titre de l'exemple demandé", opened.title.replace(/[\u00a0\u202f]/g, " ") === "Le pipeline T4 repose à 53 % sur 2 comptes", opened.title);
  }

  // Titre modifié directement sur le graphique (double-clic) → conservé → « Régénérer » le rétablit
  const computed = await page.evaluate(() => window.r4d.getSpec().style.title);
  const tbox = await (await page.$("[data-testid=chart-svg] .r4d-title")).boundingBox();
  await page.mouse.click(tbox.x + 30, tbox.y + tbox.height / 2, { count: 2, clickCount: 2 });
  await page.waitForSelector("[data-testid=inline-editor]", { timeout: 3000 }).catch(() => {});
  const editorOpen = !!(await page.$("[data-testid=inline-editor]"));
  if (editorOpen) {
    await page.evaluate(() => {
      const ta = document.querySelector("[data-testid=inline-editor]");
      ta.select();
    });
    await page.keyboard.type("Nouvelle-Aquitaine : plan d'action avant décembre");
    await page.keyboard.press("Enter");
  }
  await sleep(500);
  const afterEdit = await page.evaluate(() => ({ title: window.r4d.getSpec().style.title, edited: window.r4d.getSpec().story.edited.title, svg: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-title")].map((t) => t.textContent).join(" ") }));
  check("édition directe du titre (double-clic sur le graphique)", editorOpen && afterEdit.title === "Nouvelle-Aquitaine : plan d'action avant décembre" && afterEdit.edited && afterEdit.svg.startsWith("Nouvelle-Aquitaine"), JSON.stringify(afterEdit));
  // un changement de données / de réglage ne l'écrase pas, la session non plus
  await page.evaluate(() => window.r4d.set("variance.show", "rel"));
  await sleep(500);
  await page.evaluate(() => window.r4d.store.save());
  await page.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
  await sleep(900);
  const kept = await page.evaluate(() => ({ title: window.r4d.getSpec().style.title, sub: window.r4d.getSpec().style.subtitle }));
  check("titre modifié conservé (changement de réglage + rechargement)", kept.title === "Nouvelle-Aquitaine : plan d'action avant décembre" && kept.sub.length > 10, kept.title);
  await domClick("[data-testid=story-regenerate]");
  await sleep(500);
  const regen = await page.evaluate(() => ({ title: window.r4d.getSpec().style.title, edited: window.r4d.getSpec().story.edited.title, field: document.querySelector("[data-testid=story-title]")?.value }));
  check("« Régénérer » rétablit le titre calculé", regen.title === computed && !regen.edited && regen.field === computed, regen.title);
  await page.evaluate(() => window.r4d.set("variance.show", "abs"));
  await sleep(400);
  if (SHOTS) {
    await page.evaluate(() => {
      document.querySelector('[data-section="recit"]')?.setAttribute("open", "");
      document.querySelector('[data-section="recit"]')?.scrollIntoView();
    });
    await sleep(300);
    await page.screenshot({ path: join(shotsDir, "13-titre-commentaires.png") });
  }

  // Trois snapshots → glisser-déposer → rechargement → toujours là
  const snapIds = [];
  await domClick("[data-testid=snapshot]");
  await sleep(900);
  await domClick("[data-testid=sample-pipeline]");
  await sleep(700);
  for (const kind of ["pipelineSlipping", "trend"]) {
    await page.evaluate(() => window.r4d.explore());
    await sleep(300);
    await page.evaluate((k) => {
      const cards = [...document.querySelectorAll("[data-testid=explorer-card]")];
      const c = cards.find((e) => e.dataset.kind === k) ?? cards[0];
      c.querySelector("[data-testid=explorer-open]").click();
    }, kind);
    await sleep(900);
    await page.evaluate(() => window.r4d.seek(1));
    await sleep(200);
    await domClick("[data-testid=snapshot]");
    await sleep(900);
  }
  snapIds.push(...(await page.evaluate(() => window.r4d.story().snapshots.map((s) => s.id))));
  check("3 snapshots dans l'histoire", snapIds.length === 3 && (await page.$$("[data-testid=story-card]")).length === 3, String(snapIds.length));
  await page.evaluate(() => {
    const cards = document.querySelectorAll("[data-testid=story-card]");
    const dt = new DataTransfer();
    cards[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    cards[2].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    cards[2].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    cards[0].dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  });
  await sleep(400);
  const reordered = await page.evaluate(() => window.r4d.story().snapshots.map((s) => s.id));
  const expected = [snapIds[1], snapIds[2], snapIds[0]];
  check("glisser-déposer : réordonner les snapshots", JSON.stringify(reordered) === JSON.stringify(expected), reordered.join(" → "));
  await page.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
  await sleep(900);
  const afterReload = await page.evaluate(() => ({ ids: window.r4d.story().snapshots.map((s) => s.id), cards: document.querySelectorAll("[data-testid=story-card] img").length, svg: window.r4d.story().snapshots.every((s) => s.svg && s.svg.includes("r4d-cartouche") && s.svg.includes("r4d-qr")) }));
  check("histoire persistée (rechargement) avec vignettes et signature", JSON.stringify(afterReload.ids) === JSON.stringify(expected) && afterReload.cards === 3 && afterReload.svg, `${afterReload.ids.length} snapshots · ${afterReload.cards} vignettes`);
  await domClick("[data-testid=story-order]");
  await sleep(400);
  const roles = await page.evaluate(() => window.r4d.story().snapshots.map((s) => s.role));
  const rank = { context: 0, tension: 1, revelation: 2, recommendation: 3 };
  check("« Ordonner en récit » : contexte → tension → révélation → recommandation", roles.every((r, i) => i === 0 || rank[roles[i - 1]] <= rank[r]), roles.join(" → "));
  // Clic sur une vignette : recharge le graphique
  await page.evaluate(() => document.querySelectorAll("[data-testid=story-card-open]")[0].click());
  await sleep(900);
  const reloadedTitle = await page.evaluate(() => [window.r4d.getSpec().style.title, window.r4d.story().snapshots[0].title]);
  check("clic sur un snapshot : recharge le graphique", reloadedTitle[0] === reloadedTitle[1], reloadedTitle[0]);
  if (SHOTS) {
    await page.evaluate(() => {
      const st = window.r4d.story();
      window.r4d.store.setStory({ ...st, snapshots: st.snapshots.map((s, i) => (i === 0 ? { ...s, name: s.name } : s)) });
    });
    await sleep(300);
    await page.screenshot({ path: join(shotsDir, "14-histoire-snapshots.png") });
  }

  // Export PowerPoint : zip valide, couverture + sommaire + 1 diapositive par snapshot
  const bp = readdirSync(dl);
  await domClick("[data-testid=story-pptx]");
  const pptxFile = await waitDownload(".pptx", bp);
  let pptxOk = false;
  let pptxDetail = "aucun fichier";
  if (pptxFile) {
    const JSZip = createRequire(join(repo, "package.json"))("jszip");
    const zip = await JSZip.loadAsync(readFileSync(pptxFile));
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\//.test(f));
    const rels = (await Promise.all(Object.keys(zip.files).filter((f) => /slides\/_rels\/.+\.rels$/.test(f)).map((f) => zip.file(f).async("string")))).join("");
    const slideXml = (await Promise.all(slides.map((x) => zip.file(x).async("string")))).join("");
    pptxOk = slides.length === 5 && media.length >= 3 && rels.includes("https://alteridea-dashboard.web.app/reporting/") && /verifier\.html#1\.E\.[0-9A-F]{32}\./.test(rels) && slideXml.replace(/&apos;/g, "'").includes("Vérifier l'empreinte des données") && !/certifi|authenticit|preuve/i.test(slideXml) && !!zip.file("[Content_Types].xml");
    pptxDetail = `${slides.length} diapositives · ${media.length} images · ${(readFileSync(pptxFile).length / 1024).toFixed(0)} Ko`;
    if (SHOTS) {
      const { execFileSync } = await import("node:child_process");
      const out = join(dl, "pptx-render");
      mkdirSync(out, { recursive: true });
      try {
        execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", out, pptxFile], { stdio: "ignore", timeout: 120000 });
        const pdf = readdirSync(out).find((f) => f.endsWith(".pdf"));
        for (const f of readdirSync(shotsDir).filter((f) => /^15-pptx-slide-/.test(f))) rmSync(join(shotsDir, f));
        execFileSync("pdftoppm", ["-png", "-r", "80", join(out, pdf), join(shotsDir, "15-pptx-slide")], { stdio: "ignore", timeout: 120000 });
        // pdftoppm nomme « -1.png » : on garde ce schéma (15-pptx-slide-1.png …)
      } catch (e) {
        results.push("(rendu LibreOffice impossible : " + e.message + ")");
      }
    }
  }
  check("export PowerPoint (.pptx = zip valide)", pptxOk, pptxDetail);

  /* 10. Mode norme (notation inspirée d'IBCS® / de la notation ISO 24896) */
  const RG = ["#d62839", "#2e9e4f"];
  const chartAudit = () =>
    page.evaluate((rg) => {
      const svg = document.querySelector("[data-testid=chart-svg]");
      const bad = [];
      let rgCount = 0;
      for (const el of svg.querySelectorAll("*")) {
        const paints = [el.getAttribute("fill"), el.getAttribute("stroke"), el.style?.fill, el.style?.stroke].map((v) => (v ?? "").toLowerCase());
        if (!paints.some((p) => rg.includes(p))) continue;
        rgCount++;
        if (!el.closest(".r4d-variance-bar, .r4d-variance-needle, .r4d-variance-value, .r4d-hatch-var")) bad.push(`${el.tagName}.${el.getAttribute("class") ?? ""}`);
      }
      const hatch = svg.querySelector("pattern.r4d-hatch:not(.r4d-hatch-var)");
      const hid = hatch?.getAttribute("id");
      return {
        bad,
        rgCount,
        varBars: svg.querySelectorAll(".r4d-variance-bar").length,
        varFills: [...svg.querySelectorAll(".r4d-variance-bar")].map((e) => e.getAttribute("fill")),
        sub: [...svg.querySelectorAll(".r4d-subtitle")].map((t) => t.textContent).join(" ").replace(/[\u00a0\u202f]/g, " "),
        cartouche: !!svg.querySelector(".r4d-cartouche .r4d-logo") && !!svg.querySelector(".r4d-cartouche .r4d-qr") && /Généré le/.test(svg.querySelector(".r4d-cartouche")?.textContent ?? ""),
        hatch: !!hatch,
        fcHatched: hid ? [...svg.querySelectorAll('[data-scenario="FC"]')].filter((e) => e.getAttribute("fill") === `url(#${hid})`).length : 0,
        scn: Object.fromEntries(["AC", "PY", "PL", "FC"].map((c) => [c, svg.querySelectorAll(`rect[data-scenario="${c}"]`).length])),
        plFill: [...svg.querySelectorAll('rect[data-scenario="PL"]')].every((e) => e.getAttribute("fill") === "none"),
        legend: [...svg.querySelectorAll(".r4d-legend text")].map((t) => t.textContent),
        euroLabels: [...svg.querySelectorAll(".r4d-value")].filter((t) => /€/.test(t.textContent ?? "")).length,
        type: window.r4d.getSpec().type,
      };
    }, RG);
  await page.evaluate(() => window.r4d.store.setStory({ title: "Revue mensuelle — mode norme", snapshots: [] }));
  await domClick("[data-testid=sample-business-review]");
  await sleep(700);
  await domClick('[data-path="norme.enabled"]');
  await sleep(800);
  const nOn = await page.evaluate(() => {
    const b = document.querySelector("[data-testid=norme-badge]");
    return { on: window.r4d.getSpec().norme.enabled, badge: !!b && !b.hidden && b.offsetWidth > 0 && b.textContent, info: !document.querySelector("[data-testid=norme-info]").hidden, wording: document.querySelector("[data-testid=norme-wording]")?.textContent ?? "" };
  });
  check("mode norme : interrupteur (réglages), enregistré dans le spec, badge « Norme »", nOn.on === true && nOn.badge === "Norme" && nOn.info && /inspirée d’IBCS® et de la notation ISO 24896/.test(nOn.wording) && !/certifi/i.test(nOn.wording), JSON.stringify(nOn));
  const v1 = await chartAudit();
  check("mode norme : sous-titre qui · quoi · quand (« Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget »)", v1.sub === "Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget", v1.sub);
  check("mode norme : rouge / vert uniquement sur les écarts ; signature présente", v1.bad.length === 0 && v1.rgCount > 0 && v1.varBars > 0 && v1.cartouche, `${v1.rgCount} éléments rouge/vert, ${v1.bad.length} hors écarts ${v1.bad.slice(0, 3).join(" ")} · ${v1.varBars} barres d'écart`);
  await domClick("[data-testid=norme-up-is-bad]");
  await sleep(600);
  const v1b = await chartAudit();
  const swapped = v1.varFills.length > 0 && v1.varFills.every((f, i) => v1b.varFills[i] === (f === RG[1] ? RG[0] : RG[1]));
  await domClick("[data-testid=norme-up-is-bad]");
  await sleep(500);
  check("« Hausse = défavorable » inverse rouge et vert", swapped && (await page.evaluate(() => window.r4d.getSpec().variance.polarity)) === "higher", `${v1.varFills.length} écarts inversés`);
  if (SHOTS) {
    await page.evaluate(() => {
      document.querySelector('[data-section="norme"]')?.setAttribute("open", "");
      document.querySelector('[data-section="norme"]')?.scrollIntoView({ block: "start" });
    });
    await sleep(300);
    await page.screenshot({ path: join(shotsDir, "16-norme-ecarts.png") });
  }
  // Types déconseillés : désactivés avec info-bulle ; le clic propose des barres horizontales ; le film reste permis
  const tiles = await page.evaluate(() =>
    Object.fromEntries(["pie", "donut", "radialBar", "film", "bar"].map((t) => {
      const b = document.querySelector(`[data-testid=type-${t}]`);
      return [t, { aria: b.getAttribute("aria-disabled"), title: b.title, cls: b.classList.contains("disabled") }];
    }))
  );
  await domClick("[data-testid=type-pie]");
  await sleep(800);
  const afterPie = await page.evaluate(() => ({ type: window.r4d.getSpec().type, pie: document.querySelectorAll("[data-testid=chart-svg] .r4d-marks path.r4d-slice, [data-testid=chart-svg] .r4d-arc").length }));
  check(
    "camembert, donut, arcs désactivés (« déconseillé par la notation IBCS — utilisez des barres ») ; clic → barres ; film permis",
    ["pie", "donut", "radialBar"].every((t) => tiles[t].aria === "true" && tiles[t].cls && tiles[t].title.includes("déconseillé par la notation IBCS — utilisez des barres")) && tiles.film.aria === null && tiles.bar.aria === null && afterPie.type === "barH",
    `${tiles.pie.title} → ${afterPie.type}`
  );
  // Orientation : catégories à la verticale (barres), temps à l'horizontale (colonnes)
  await page.evaluate(() => window.r4d.pickType("bar"));
  await sleep(700);
  const orient1 = await page.evaluate(() => window.r4d.getSpec().type);
  await page.evaluate(() => window.r4d.set("encoding.x", "Mois"));
  await sleep(700);
  const orient2 = await page.evaluate(() => window.r4d.getSpec().type);
  check("orientation : structure → barres horizontales, temps → colonnes (bascule douce)", orient1 === "barH" && orient2 === "bar", `${orient1} puis ${orient2}`);
  // Préréglage « Revue mensuelle (norme) » : colonnes par scénario
  await domClick("[data-testid=sample-revue-mensuelle-norme]");
  await sleep(900);
  await page.evaluate(() => window.r4d.seek(1));
  await sleep(300);
  const v2 = await chartAudit();
  check(
    "notation des scénarios : Réel plein, N-1 gris, Budget en contour, Prévision hachurée (motif SVG)",
    v2.hatch && v2.fcHatched === 3 && v2.scn.AC === 9 && v2.scn.PY === 12 && v2.scn.PL === 12 && v2.plFill && v2.legend.join("|").includes("Réel (AC)") && v2.legend.join("|").includes("Prévision (FC)"),
    `${JSON.stringify(v2.scn)} · ${v2.fcHatched} hachurés · légende ${v2.legend.join(", ")}`
  );
  check("préréglage norme : sous-titre, unités hors étiquettes, rouge/vert réservés aux écarts, signature", v2.sub === "Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel + Prévision vs Budget, N-1" && v2.euroLabels === 0 && v2.bad.length === 0 && v2.varBars === 12 && v2.cartouche, `${v2.sub} · ${v2.bad.length} hors écarts`);
  await shotStage("17-norme-colonnes-scenarios.png");
  // Légende « ℹ Notation »
  await domClick("[data-testid=norme-info]");
  await sleep(300);
  const legendPop = await page.evaluate(() => {
    const p = document.querySelector("[data-testid=norme-legend]");
    return { open: !!p && !p.hidden && p.offsetHeight > 100, text: p?.textContent ?? "", swatches: p?.querySelectorAll("svg").length ?? 0 };
  });
  await page.keyboard.press("Escape");
  await sleep(200);
  const legendClosed = await page.evaluate(() => document.querySelector("[data-testid=norme-legend]").hidden);
  check(
    "légende « ℹ Notation » (AC / PY / PL / FC, écarts, en français)",
    legendPop.open && legendClosed && ["Réel (AC)", "N-1 (PY)", "Budget (PL)", "Prévision (FC)", "Écart favorable", "Écart défavorable", "Écart relatif", "inspirée d’IBCS®"].every((s) => legendPop.text.includes(s)) && legendPop.swatches >= 7 && !/certifi/i.test(legendPop.text),
    `${legendPop.swatches} pastilles`
  );
  // Explorer en mode norme : sous-titre structuré, vignettes grises, pas de camembert
  await page.evaluate(() => window.r4d.explore());
  await page.waitForSelector("[data-testid=explorer-card]", { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const ex = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-testid=explorer-card]").length,
    ibcs: [...document.querySelectorAll("[data-testid=explorer-ibcs]")].map((e) => e.textContent),
    petrol: [...document.querySelectorAll(".explorer-thumb svg")].filter((s) => /#3fa7c4|#8ecfe2|#1b8ba8/i.test(s.outerHTML)).length,
    pies: document.querySelectorAll(".explorer-thumb svg path[d*='A']").length,
  }));
  const firstCard = await page.evaluate(() => {
    document.querySelectorAll("[data-testid=explorer-open]")[0].click();
    return true;
  });
  await sleep(800);
  const exOpened = await page.evaluate(() => ({ norme: window.r4d.getSpec().norme.enabled, type: window.r4d.getSpec().type }));
  check(
    "Explorer en mode norme : sous-titre qui · quoi · quand, vignettes grises, pistes ouvertes en mode norme",
    firstCard && ex.cards >= 5 && ex.ibcs.length === ex.cards && ex.ibcs.every((t) => t.startsWith("Alteridea SA · ")) && ex.petrol === 0 && exOpened.norme && !["pie", "donut", "radialBar"].includes(exOpened.type),
    `${ex.cards} pistes · « ${ex.ibcs[0]} » · ouverte : ${exOpened.type}`
  );
  // Histoire : deux graphiques de même mesure → « ≠ échelle », puis « Même échelle » ; PowerPoint avec légende de notation
  await domClick("[data-testid=sample-business-review]");
  await sleep(800);
  await domClick("[data-testid=snapshot]");
  await sleep(900);
  await page.evaluate(() => window.r4d.set("encoding.x", "Ligne de produit"));
  await sleep(800);
  await domClick("[data-testid=snapshot]");
  await sleep(900);
  const sc1 = await page.evaluate(() => ({ badges: [...document.querySelectorAll("[data-testid=story-scale]")].map((b) => b.textContent), scales: window.r4d.storyScales() }));
  await domClick("[data-testid=story-same-scale]");
  await sleep(500);
  const sc2 = await page.evaluate(() => ({ badges: [...document.querySelectorAll("[data-testid=story-scale]")].map((b) => b.textContent), same: window.r4d.story().sameScale }));
  check(
    "échelles : même mesure → « ≠ échelle » signalé, puis « Même échelle » (histoire + PowerPoint)",
    sc1.badges.length === 2 && sc1.badges.every((b) => b === "≠ échelle") && Object.values(sc1.scales).every((s) => s.size === 2 && s.differs) && sc2.same && sc2.badges.every((b) => b === "= échelle"),
    `${sc1.badges.join(", ")} → ${sc2.badges.join(", ")}`
  );
  {
    const b = readdirSync(dl);
    await domClick("[data-testid=story-pptx]");
    const f = await waitDownload(".pptx", b);
    let ok = false;
    let detail = "aucun fichier";
    if (f) {
      const JSZip = createRequire(join(repo, "package.json"))("jszip");
      const zip = await JSZip.loadAsync(readFileSync(f));
      const slides = Object.keys(zip.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x));
      const xml = (await Promise.all(slides.map((x) => zip.file(x).async("string")))).join("");
      const notation = (xml.match(/Notation inspirée d’IBCS®/g) ?? []).length;
      ok = slides.length === 4 && notation === 2 && xml.includes("Réel (AC)") && xml.includes("Prévision (FC)") && !/certifi/i.test(xml);
      detail = `${slides.length} diapositives · légende de notation sur ${notation} diapositive(s)`;
      if (SHOTS) {
        const { execFileSync } = await import("node:child_process");
        const out = join(dl, "pptx-norme");
        mkdirSync(out, { recursive: true });
        try {
          execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", out, f], { stdio: "ignore", timeout: 120000 });
          const pdf = readdirSync(out).find((x) => x.endsWith(".pdf"));
          execFileSync("pdftoppm", ["-png", "-r", "80", "-f", "4", "-l", "4", "-singlefile", join(out, pdf), join(shotsDir, "18-norme-pptx")], { stdio: "ignore", timeout: 120000 });
        } catch (e) {
          results.push("(rendu LibreOffice impossible : " + e.message + ")");
        }
      }
    }
    check("PowerPoint en mode norme : légende de notation, même échelle", ok, detail);
  }
  await domClick('[data-path="norme.enabled"]');
  await sleep(600);
  const nOff = await page.evaluate(() => ({ on: window.r4d.getSpec().norme.enabled, badge: document.querySelector("[data-testid=norme-badge]").hidden, pie: document.querySelector("[data-testid=type-pie]").getAttribute("aria-disabled") }));
  check("mode norme désactivable (badge masqué, camembert de nouveau permis)", !nOff.on && nOff.badge && nOff.pie === null, JSON.stringify(nOff));

  /* 11. Page de vérification (verifier.html) : fragment du QR, fichier d'origine ✓, fichier modifié ✗ */
  {
    const vp = await browser.newPage();
    vp.on("console", (m) => m.type() === "error" && errors.push("verifier: " + m.text()));
    vp.on("pageerror", (e) => errors.push("verifier pageerror: " + e.message));
    vp.on("requestfailed", (r) => errors.push(`verifier : requête échouée ${r.url()}`));
    await vp.setViewport({ width: 900, height: 1080, deviceScaleFactor: SHOTS ? 2 : 1 });
    const state = () => vp.evaluate(() => ({ state: document.querySelector("[data-testid=v-result]")?.dataset.state ?? null, text: (document.querySelector("[data-testid=v-result]")?.textContent ?? "").replace(/[\u00a0\u202f]/g, " ") }));
    const waitResult = () => vp.waitForFunction(() => ["ok", "ko", "neutral", "error"].includes(document.querySelector("[data-testid=v-result]")?.dataset.state) && !/Calcul/.test(document.querySelector("[data-testid=v-result]")?.textContent ?? ""), { timeout: 8000 }).catch(() => {});
    const frag = xlsxUrl.split("#")[1] ?? "";
    await vp.goto("about:blank");
    await vp.goto(`${origin}${BASE}verifier.html#${frag}`, { waitUntil: "networkidle0" });
    const pageText = (await vp.evaluate(() => document.body.textContent)).replace(/[\u00a0\u202f]/g, " ");
    const sum = (await vp.$eval("[data-testid=v-summary]", (e) => e.textContent)).replace(/[\u00a0\u202f]/g, " ");
    check(
      "vérification : lecture du fragment, empreinte déclarée (pas une signature) (« généré par Tell4D le … à partir de données importées le … (2 lignes, 3 colonnes), empreinte … »)",
      /Selon ce QR, ce graphique a été généré par Tell4D le \d{1,2}(er)? \S+ \d{4} à partir de données importées le \d{1,2}(er)? \S+ \d{4} \(2 lignes, 3 colonnes\), empreinte [0-9a-f]{4}·[0-9a-f]{4}\./.test(sum) &&
        pageText.includes("Déposez le fichier d'origine pour vérifier") &&
        pageText.includes("La vérification compare l'empreinte du fichier ; elle ne dit rien de l'exactitude des données.") && pageText.includes("Un registre en ligne viendra renforcer cette vérification.") &&
        !/certifi|authenticit|preuve/i.test(pageText) &&
        /empreinte déclarée, pas d'une signature/.test(pageText) &&
        (await vp.title()).includes("Tell4D"),
      sum.slice(0, 160)
    );
    await (await vp.$("[data-testid=v-file]")).uploadFile(xlsxFile);
    await waitResult();
    const ok = await state();
    check("vérification : fichier d'origine → « ✓ Les données correspondent »", ok.state === "ok" && ok.text.startsWith("✓ Les données correspondent"), ok.text.slice(0, 120));
    if (SHOTS) await vp.screenshot({ path: join(shotsDir, "20-verifier-ok.png"), fullPage: true });
    // fichier modifié : un seul montant change
    const XLSX = createRequire(join(repo, "package.json"))("xlsx");
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["Date", "Agence", "Montant (€)"],
      [new Date(2026, 8, 30), "Lyon", 1525.5],
      [new Date(2026, 9, 8), "Bruxelles", 980],
    ]);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws2, "Octobre");
    const altered = join(dl, "import-test-modifie.xlsx");
    XLSX.writeFile(wb2, altered);
    await (await vp.$("[data-testid=v-file]")).uploadFile(altered);
    await waitResult();
    const ko = await state();
    check("vérification : fichier modifié → « ✗ Les données ne correspondent pas à ce graphique »", ko.state === "ko" && ko.text.startsWith("✗ Les données ne correspondent pas à ce graphique"), ko.text.slice(0, 120));
    if (SHOTS) await vp.screenshot({ path: join(shotsDir, "21-verifier-ko.png"), fullPage: true });
    // texte collé (même texte, fins de ligne Windows) ✓ ; une cellule modifiée ✗
    await vp.goto("about:blank");
    await vp.goto(`${origin}${BASE}verifier.html#${pasteUrlG.split("#")[1] ?? ""}`, { waitUntil: "networkidle0" });
    const pasteVerify = async (text) => {
      await vp.evaluate(() => {
        document.querySelector("[data-testid=v-paste]").closest("details").open = true;
        document.querySelector("[data-testid=v-result]").dataset.state = "";
      });
      await vp.evaluate((t) => window.t4dVerifier.verifyText(t), text);
      await waitResult();
      return state();
    };
    const p1 = await pasteVerify(lines.join("\r\n") + "\r\n");
    const p2 = await pasteVerify(lines.join("\n").replace("Bruxelles", "Bruges"));
    check("vérification : texte collé ✓ (CRLF normalisé), texte modifié ✗", p1.state === "ok" && p2.state === "ko", `${p1.text.slice(0, 40)} · ${p2.text.slice(0, 40)}`);
    // exemple intégré : vérifié directement ; liens incomplets : message clair
    await vp.goto("about:blank");
    await vp.goto(`${origin}${BASE}verifier.html#${sampleUrl.split("#")[1] ?? ""}`, { waitUntil: "networkidle0" });
    await waitResult();
    const smp = await state();
    await vp.goto("about:blank");
    await vp.goto(`${origin}${BASE}verifier.html#1.F.ABC.20261008`, { waitUntil: "networkidle0" });
    const bad = await vp.$eval("[data-testid=v-summary]", (e) => e.textContent);
    await vp.goto("about:blank");
    await vp.goto(`${origin}${BASE}verifier.html`, { waitUntil: "networkidle0" });
    const none = await vp.$eval("[data-testid=v-summary]", (e) => e.textContent);
    await (await vp.$("[data-testid=v-file]")).uploadFile(xlsxFile);
    await waitResult();
    const neutral = await state();
    check(
      "vérification : exemple intégré reconnu ; lien illisible / absent géré (empreinte calculée quand même)",
      smp.state === "ok" && /Exemple intégré au Studio/.test(smp.text) && /incomplet ou illisible/.test(bad) && /Aucun graphique à vérifier/.test(none) && neutral.state === "neutral" && neutral.text.includes(xp_hash_prefix(xlsxUrl)),
      `${smp.text.slice(0, 70)} · ${neutral.text.slice(0, 40)}`
    );
    await vp.close();
  }

  /* 12. Version hors ligne (file://) : cartouche + QR, lien vers la vérification en ligne */
  {
    const off = join(repo, "studio-offline/reporting-4d-studio.html");
    if (existsSync(off)) {
      const op = await browser.newPage();
      const offErrors = [];
      op.on("console", (m) => m.type() === "error" && offErrors.push(m.text()));
      op.on("pageerror", (e) => offErrors.push(e.message));
      await op.goto(pathToFileURL(off).href + "?reset=1", { waitUntil: "load" });
      await op.waitForSelector("[data-testid=chart-svg] .r4d-qr", { timeout: 15000 }).catch(() => {});
      const url = await op.evaluate(() => document.querySelector("[data-testid=chart-svg] .r4d-qr")?.getAttribute("data-url") ?? "");
      check("version hors ligne (file://) : empreinte calculée, QR vers la vérification en ligne", /^https:\/\/alteridea-dashboard\.web\.app\/reporting\/verifier\.html#1\.E\./.test(url) && offErrors.length === 0, url || offErrors.slice(0, 2).join(" | "));
      await op.close();
    } else results.push("(version hors ligne absente : npm run build:studio:offline)");
  }

  /* ------------------------------------------------ captures de documentation */
  if (SHOTS) {
    await page.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    const prep = async (fn, arg) => {
      await page.evaluate(fn, arg);
      await sleep(700);
      await page.evaluate(() => window.r4d.seek(1));
      await sleep(250);
    };
    // 1. Interface complète, barres
    await prep(() => window.r4d.loadSample("ventes"));
    await page.screenshot({ path: join(shotsDir, "01-interface-barres.png") });
    // 19. Gros plan du cartouche (bloc + QR) sur un graphique
    {
      await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 3 });
      await sleep(400);
      const r = await page.evaluate(() => {
        const b = document.querySelector("[data-testid=chart-svg] .r4d-cartouche-box").getBoundingClientRect();
        const st = document.querySelector(".stage").getBoundingClientRect();
        return { x: Math.max(st.left, b.left - 300), y: Math.max(st.top, b.top - 150), right: st.right, bottom: st.bottom };
      });
      await page.screenshot({ path: join(shotsDir, "19-cartouche.png"), clip: { x: r.x, y: r.y, width: r.right - r.x, height: r.bottom - r.y } });
      await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
      await sleep(300);
    }
    // 2. Barres empilées
    await prep(() => {
      window.r4d.pickType("stackedBar");
      window.r4d.set("encoding.x", "Mois");
      window.r4d.set("encoding.series", "Région");
      window.r4d.set("encoding.xGrain", "quarter");
      window.r4d.set("style.title", "Chiffre d'affaires trimestriel par région");
      window.r4d.set("style.subtitle", "T1 2024 → T4 2026 · prévisions à partir d'octobre 2026");
      window.r4d.set("style.valueLabels", false);
    });
    await shotStage("02-barres-empilees.png");
    // 3. Lignes, double axe
    await prep(() => {
      window.r4d.pickType("line");
      window.r4d.set("encoding.x", "Mois");
      window.r4d.set("encoding.series", null);
      window.r4d.set("encoding.xGrain", "month");
      window.r4d.set("encoding.y2", "Marge (%)");
      window.r4d.set("axes.y2.unit", "pct");
      window.r4d.set("style.title", "Chiffre d'affaires et marge moyenne");
      window.r4d.set("style.subtitle", "Mensuel, toutes régions · axe de droite : marge (%)");
    });
    await shotStage("03-lignes-double-axe.png");
    // 7. SVG exporté (graphique double axe ci-dessus), rendu seul dans le navigateur
    {
      const b = readdirSync(dl);
      await domClick("[data-testid=export-svg]");
      const f = await waitDownload(".svg", b);
      if (f) {
        const p2 = await browser.newPage();
        await p2.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1.5 });
        await p2.goto(pathToFileURL(f).href, { waitUntil: "load" });
        await sleep(400);
        await p2.screenshot({ path: join(shotsDir, "07-export-svg-rendu.png") });
        await p2.close();
        writeFileSync(join(shotsDir, "07-export.svg"), readFileSync(f));
      }
    }
    // 4. Donut
    await prep(() => window.r4d.loadSample("canaux"));
    await shotStage("04-donut.png");
    // 5. Arcs radiaux
    await prep(() => {
      window.r4d.pickType("radialBar");
      window.r4d.set("encoding.y", ["Clients signés"]);
      window.r4d.set("axes.y.unit", "none");
      window.r4d.set("style.title", "Clients signés par canal");
      window.r4d.set("style.subtitle", "Cumul 2026 au 8 octobre");
    });
    await shotStage("05-arcs-radiaux.png");
    // 6. 4D à mi-parcours
    await page.evaluate(() => {
      window.r4d.loadSample("ventes");
    });
    await sleep(600);
    await page.evaluate(() => {
      window.r4d.set("mode.kind", "dynamic");
      window.r4d.set("mode.fourD.enabled", true);
      window.r4d.set("style.title", "Chiffre d'affaires cumulé par région — 4D");
    });
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(0.55));
    await sleep(300);
    await page.screenshot({ path: join(shotsDir, "06-4d-mi-animation.png") });
    // 8. Film 4D (spécial)
    await page.evaluate(() => window.r4d.loadSample("pipeline"));
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=special-host] svg *").length > 20, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => window.r4d.seek(0.7));
    await sleep(700);
    await shotStage("08-film-4d.png");
    // 9. Fond clair : série unique au ton principal #0E6E8C
    await prep(() => {
      window.r4d.loadSample("ventes");
      window.r4d.set("style.background", "light");
    });
    await shotStage("09-barres-fond-clair.png");
    // 10. Préréglage « Alteridea (rouge) » (toujours disponible)
    await prep(() => {
      window.r4d.loadSample("canaux");
      window.r4d.set("style.background", "dark");
      window.r4d.set("style.palette", "alteridea");
    });
    await shotStage("10-preset-alteridea-rouge.png");
    await page.evaluate(() => window.r4d.set("style.palette", "petrole"));
  }
} catch (e) {
  failures++;
  results.push("✗ exception : " + (e?.stack ?? e));
} finally {
  check("zéro erreur console", errors.length === 0, errors.slice(0, 5).join(" | "));
  console.log(results.join("\n"));
  if (warnings.length) console.log(`(${warnings.length} avertissement(s) console : ${warnings.slice(0, 3).join(" | ")})`);
  console.log(failures ? `\n${failures} échec(s)` : `\nTous les tests passent (${results.length}).`);
  await browser.close();
  server.close();
  rmSync(dl, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
