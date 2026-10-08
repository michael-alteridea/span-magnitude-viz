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

try {
  await page.goto(`${origin}${BASE}?reset=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-testid=chart-svg] .r4d-marks");
  const header = await page.$eval("header", (e) => e.textContent ?? "");
  check("en-tête « Reporting 4D · Studio »", /Reporting 4D\s*·\s*Studio/.test(header));
  // Identité bleu pétrole : bouton principal, logo, palette par défaut
  const brand = await page.evaluate(() => ({
    btn: getComputedStyle(document.querySelector("[data-testid=export-svg]")).backgroundColor,
    logo: document.querySelector(".brand .logo stop")?.getAttribute("stop-color"),
    palette: window.r4d.getSpec().style.palette,
  }));
  check("identité bleu pétrole (bouton, logo, palette)", brand.btn === "rgb(63, 167, 196)" && brand.logo === "#3FA7C4" && brand.palette === "petrole", JSON.stringify(brand));

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
    await page.evaluate((t) => window.r4d.importText(t), tsv);
    await sleep(500);
  }

  /* 2. Chaque type de graphique */
  const types = await page.$$eval("[data-testid^=type-]", (els) => els.map((e) => e.dataset.type));
  check("galerie : 13 types", types.length === 13, types.join(","));
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
  }
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
    /@font-face/.test(svgText) && /data:font\/woff2;base64,/.test(svgText) && /<svg[^>]+viewBox="0 0 1200 675"/.test(svgText) && !/(src|href)="(?!data:|#)[^"]+"/.test(svgText),
    svgFile ? `${(svgText.length / 1024).toFixed(0)} Ko` : "aucun fichier"
  );
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
