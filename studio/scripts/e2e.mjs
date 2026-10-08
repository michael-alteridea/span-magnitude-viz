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
    marks: document.querySelectorAll('[data-testid=chart-svg] .r4d-marks *, [data-testid=chart-svg] .r4d-drill-mark').length,
    empty: document.querySelector("[data-testid=chart-svg] .r4d-empty")?.textContent ?? null,
    special: document.querySelectorAll("[data-testid=special-host] svg *").length,
    title: document.querySelector("[data-testid=chart-svg] .r4d-title")?.textContent ?? null,
  }));
async function shotStage(name) {
  if (!SHOTS) return;
  // pointeur hors du graphique : pas d'infobulle résiduelle sur les captures
  await page.mouse.move(1, 1);
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
  check("en-tête « Datanime · Studio »", /Datanime\s*·\s*Studio/.test(header) && !/Reporting 4D/.test(header));
  // Identité Datanime bleu pétrole : bouton principal, logo « Bulle + barres », palette par défaut, titre, favicon
  const brand = await page.evaluate(() => ({
    btn: getComputedStyle(document.querySelector("[data-testid=export-menu]")).backgroundColor,
    logo: document.querySelector(".brand .logo stop")?.getAttribute("stop-color"),
    bars: document.querySelectorAll(".brand .logo svg rect").length,
    palette: window.r4d.getSpec().style.palette,
    title: document.title,
    icon: document.querySelector("link[rel=icon]")?.getAttribute("href"),
    touch: document.querySelector("link[rel=apple-touch-icon]")?.getAttribute("href"),
  }));
  check(
    "identité Datanime (bouton, logo Bulle + barres, palette, titre, favicon)",
    brand.btn === "rgb(63, 167, 196)" && brand.logo === "#0E6E8C" && brand.bars >= 12 && brand.palette === "petrole" && /^Datanime · Studio/.test(brand.title) && /favicon\.svg$/.test(brand.icon ?? "") && /apple-touch-icon\.png$/.test(brand.touch ?? ""),
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

  /* H. Panneau en accordéon, menus « Exporter » / « Fichier », toucher un élément → réglage */
  {
    const top = await page.evaluate(() => ({
      btns: document.querySelectorAll("header .toolbar > .tool-group > button").length,
      direct: !!document.querySelector("header [data-testid=export-svg], header [data-testid=save-config]"),
      exp: document.querySelector("[data-testid=export-menu]")?.textContent?.trim(),
      file: document.querySelector("[data-testid=file-menu]")?.textContent?.trim(),
    }));
    check("barre du haut : un menu « Exporter » et un menu « Fichier » remplacent les boutons d'export et de configuration", top.btns <= 7 && !top.direct && top.exp === "Exporter" && top.file === "Fichier", JSON.stringify(top));
    await page.click("[data-testid=export-menu]");
    await sleep(300);
    const menu = await page.evaluate(() => {
      const pop = document.querySelector("[data-testid=export-menu-pop]");
      const r = pop.getBoundingClientRect();
      return { open: !pop.hidden, inView: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0, items: [...pop.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid) };
    });
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "69-menu-exporter.png") });
    await page.keyboard.press("Escape");
    await sleep(150);
    const closed = await page.evaluate(() => document.querySelector("[data-testid=export-menu-pop]").hidden);
    check("menu « Exporter » : SVG, PNG + résolution, vidéo, GIF (V2), PowerPoint ; Échap le ferme", menu.open && menu.inView && closed && ["export-svg", "export-png", "png-scale", "export-webm", "export-gif", "export-pptx"].every((t) => menu.items.includes(t)), menu.items.join(" "));
    const acc = await page.evaluate(() => ({
      ids: [...document.querySelectorAll("[data-testid=settings-panel] .acc-s")].map((e) => e.dataset.section),
      open: [...document.querySelectorAll("[data-testid=settings-panel] .acc-s.open")].map((e) => e.dataset.section),
      sums: [...document.querySelectorAll("[data-testid=settings-panel] .acc-sum")].map((e) => e.textContent.trim()),
      dup: (() => {
        const seen = {};
        for (const e of document.querySelectorAll("[data-testid=settings-panel] [data-path]")) seen[e.dataset.path] = (seen[e.dataset.path] ?? 0) + 1;
        return Object.entries(seen).filter(([, n]) => n > 1).map(([k]) => k);
      })(),
      dl: ["svg", "png", "webm", "pptx"].every((k) => document.querySelector(`[data-testid=panel-export-${k}]`)),
    }));
    await domClick("[data-testid=acc-recit]");
    await sleep(200);
    const acc2 = await page.evaluate(() => [...document.querySelectorAll("[data-testid=settings-panel] .acc-s.open")].map((e) => e.dataset.section));
    check("accordéon : Données → Graphique → Récit → Style → Export, une seule section ouverte, un résumé par section, aucun doublon", acc.ids.join() === "donnees,graphique,recit,style,export" && acc.open.length === 1 && acc2.join() === "recit" && acc.sums.length === 5 && acc.sums.every((t) => t.length > 3) && acc.dup.length === 0 && acc.dl, `${acc.open} → ${acc2} · ${acc.sums.join(" | ")}${acc.dup.length ? " · doublons " + acc.dup.join(",") : ""}`);
    await page.type("[data-testid=settings-search]", "deci");
    await sleep(250);
    const sr = await page.evaluate(() => ({
      info: document.querySelector("[data-testid=settings-search-info]").textContent,
      vis: [...document.querySelectorAll("[data-testid=settings-panel] [data-item]")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim().slice(0, 30)),
    }));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "71-recherche-reglage.png") });
    await page.evaluate(() => window.r4d.panel().clearSearch());
    check("recherche de réglages : « deci » → Unité et décimales", /^\d+ réglages? pour « deci »$/.test(sr.info) && sr.vis.length >= 1 && sr.vis.some((t) => /décimales/i.test(t)), `${sr.info} · ${sr.vis.join(" / ")}`);
    // toucher (clic réel) l'axe Y puis le titre du graphique
    const tapAt = async (sel) => {
      const r = await page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await page.mouse.click(r.x, r.y);
      await sleep(350);
      return page.evaluate(() => ({ rev: document.querySelector("[data-testid=settings-panel]").getAttribute("data-revealed"), open: document.querySelector("[data-testid=settings-panel] .acc-s.open")?.dataset.section, flash: !!document.querySelector("[data-testid=settings-panel] .flash"), more: !!document.querySelector('[data-more="graphique"].open') }));
    };
    const ty = await tapAt("[data-testid=chart-svg] .r4d-axis-y .tick text");
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "70-toucher-axe-reglage.png") });
    const tt = await tapAt("[data-testid=chart-svg] .r4d-title");
    check("toucher le graphique : axe Y → Graphique › Axe Y (déplié, en surbrillance) ; titre → Récit › Titre", ty.rev === "graphique:axe-y" && ty.open === "graphique" && ty.flash && ty.more && tt.rev === "recit:style.title" && tt.open === "recit", JSON.stringify({ ty, tt }));
    await page.evaluate(() => window.r4d.panel().open("graphique"));
    await page.mouse.move(1, 1);
    await sleep(2000);
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "72-panneau-accordeon.png") });
  }

  /* I. Barres racontées : icône au bout des barres (Phosphor), pictogrammes, objectif, barre mise en avant annotée */
  {
    const load = async (id) => {
      await page.evaluate((i) => window.r4d.loadSample(i), id);
      await sleep(400);
      await page.evaluate(() => window.r4d.settle());
      await sleep(1600);
    };
    const tapAt = async (sel) => {
      const r = await page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await page.mouse.click(r.x, r.y);
      await sleep(400);
      return page.evaluate(() => ({ rev: document.querySelector("[data-testid=settings-panel]").getAttribute("data-revealed"), open: document.querySelector("[data-testid=settings-panel] .acc-s.open")?.dataset.section }));
    };
    await load("postes");
    await page.evaluate(() => window.r4d.panel().open("graphique"));
    const ic = await page.evaluate(() => ({
      caps: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-cap [data-icon]")].map((e) => e.dataset.icon),
      tiles: [...document.querySelectorAll("[data-testid=bar-cap] button")].map((b) => `${b.dataset.value}${b.classList.contains("active") ? "*" : ""}${b.disabled ? "!" : ""}`),
      lic: !!document.querySelector('a[href*="licences/phosphor-icons-MIT.txt"], [data-licence="phosphor"]'),
    }));
    check("icône au bout des barres : 6 pastilles Phosphor choisies d'après le nom (Hébergement → nuage, Équipe → personnes…), licence MIT liée", ic.lic && ic.caps.join() === "cloud,users,key,hard-drives,truck,buildings" && ic.tiles.join() === "none,icon*,picto,goal!", `${ic.caps.join()} · tuiles ${ic.tiles.join()}`);
    await shotStage("73-barres-icones.png");
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "74-panneau-extremite-barres.png") });
    // icône choisie pour une catégorie (Plus d'options › Icône par catégorie)
    await page.select('[data-icon-for="Équipe"]', "headset");
    await sleep(500);
    const forced = await page.evaluate(() => ({ cfg: window.r4d.getSpec().style.capIcons, icon: document.querySelectorAll("[data-testid=chart-svg] .r4d-cap [data-icon]")[1]?.dataset.icon }));
    await page.select('[data-icon-for="Équipe"]', "@auto");
    await sleep(300);
    const back = await page.evaluate(() => window.r4d.getSpec().style.capIcons);
    check("icône par catégorie : choix forcé (Équipe → casque) puis retour à « Auto »", forced.cfg["Équipe"] === "headset" && forced.icon === "headset" && Object.keys(back).length === 0, JSON.stringify({ forced, back }));
    await domClick('[data-testid=bar-cap] [data-value="picto"]');
    await sleep(400);
    await page.evaluate(() => window.r4d.settle());
    await sleep(1200);
    const pc = await page.evaluate(() => ({
      n: document.querySelectorAll("[data-testid=chart-svg] .r4d-bar-deco .r4d-picto").length,
      key: document.querySelector("[data-testid=chart-svg] .r4d-picto-key text")?.textContent ?? "",
      cap: window.r4d.getSpec().style.barCap,
    }));
    check("pictogrammes : icônes pleines jointives, clé « icône = unité ronde »", pc.cap === "picto" && pc.n >= 15 && /^= \d+[\s\u00a0\u202f]k€$/.test(pc.key), JSON.stringify(pc));
    await shotStage("75-barres-pictogrammes.png");
    const tc = await tapAt("[data-testid=chart-svg] .r4d-bar-deco .r4d-picto");
    check("toucher un pictogramme → Graphique › Extrémité des barres", tc.open === "graphique" && /style\.barCap/.test(tc.rev ?? ""), JSON.stringify(tc));

    await load("dossiers");
    const fo = await page.evaluate(() => {
      const svg = document.querySelector("[data-testid=chart-svg]");
      const fills = [...svg.querySelectorAll(".r4d-marks > rect")].map((r) => r.getAttribute("fill"));
      return {
        callout: svg.querySelector(".r4d-callout")?.textContent ?? "",
        link: !!svg.querySelector(".r4d-callout-link"),
        avg: svg.querySelector(".r4d-avg text")?.textContent ?? "",
        focus: svg.querySelectorAll(".r4d-focus-bar").length,
        grey: fills.filter((f) => f === "#c4c4c8" || f === "#4a4a52").length,
        bold: svg.querySelector('.r4d-axis-x text[font-weight="700"]')?.textContent ?? "",
      };
    });
    check("barre mise en avant : couleur pour Julie M., les autres en gris, annotation reliée, « Moyenne des autres »", fo.focus === 1 && fo.grey === 5 && fo.link && /Julie M\. absente, pas de relais/.test(fo.callout) && /^Moyenne des autres : 10$/.test(fo.avg) && fo.bold === "Julie M.", JSON.stringify(fo));
    await shotStage("76-barre-annotee.png");
    const ta = await tapAt("[data-testid=chart-svg] .r4d-callout rect");
    const fk = await page.evaluate(() => document.querySelector('[data-testid=settings-panel] select[data-path="style.focus.key"]')?.value);
    check("toucher l'annotation → Récit › Mise en avant (barre, titre, texte)", ta.open === "recit" && ta.rev === "recit:focus" && fk === "Julie M.", JSON.stringify({ ta, fk }));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "77-toucher-annotation.png") });

    await load("objectifs");
    const go = await page.evaluate(() => {
      const svg = document.querySelector("[data-testid=chart-svg]");
      const caps = [...svg.querySelectorAll(".r4d-goal-cap")].map((e) => e.dataset.goal);
      // aucune étiquette de valeur barrée par un repère d'objectif
      const marks = [...svg.querySelectorAll(".r4d-goal-mark")].map((m) => m.getBoundingClientRect());
      const labs = [...svg.querySelectorAll(".r4d-value-labels text")].map((t) => t.getBoundingClientRect());
      const crossed = labs.filter((l) => marks.some((m) => m.left < l.right && m.right > l.left && m.top < l.bottom && m.bottom > l.top)).length;
      return { caps, crossed, title: svg.querySelector(".r4d-title")?.textContent ?? "", legend: svg.querySelector(".r4d-legend")?.textContent ?? "" };
    });
    const ok4 = go.caps.filter((c) => c === "atteint").length;
    check("objectif : repère par barre, pastille verte (atteint) / rouge (manque), titre « 4 commerciaux sur 6 ont atteint leur objectif »", go.caps.length === 6 && ok4 === 4 && go.crossed === 0 && go.title.replace(/\s+/g, " ") === "4 commerciaux sur 6 ont atteint leur objectif" && /Objectif/.test(go.legend), JSON.stringify(go));
    await shotStage("78-barres-objectif.png");
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
  check("galerie : 15 types", types.length === 15, types.join(","));
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
      // Barre d'échelle en km sur toutes les cartes (FR·BE, Europe ; ancienne maille « nuts2 » lue comme pays)
      const scales = [];
      for (const [region, level] of [["fr-be", null], ["europe", "country"], ["europe", "nuts2"]]) {
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
      check("carte : barre d'échelle en km (FR·BE + Europe)", scales.every((x) => x.km > 0 && x.px > 20 && /^\d[\d\s]*\s?km$/.test(x.label)), scales.map((x) => `${x.where} ${x.label}`).join(" · "));
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
      check("carte : source du fond dans le cartouche (IGN, NGI-Statbel, Natural Earth ; aucune licence restrictive)", mapSrc.some((t) => /IGN, NGI-Statbel, Natural Earth/.test(t)) && !/GISCO|EuroGeographics|Eurostat|non commercial|NUTS/i.test(mapSrc.join(" ") + mapText) && mapText.includes("Fond : IGN, NGI-Statbel, Natural Earth"), mapSrc.join(" · "));
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
      "export SVG : signature (icône Datanime inline, « Datanime », lien plateforme) + date de génération",
      flat.includes('class="r4d-cartouche"') &&
        flat.includes('href="https://alteridea-dashboard.web.app/reporting/"') &&
        />Datanime</.test(flat) &&
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
      "cartouche : bloc rectangulaire (logo, « Datanime » en lien, généré le, données d'exemple, source, empreinte, QR), discret",
      !!ci && ci.href === "https://alteridea-dashboard.web.app/reporting/" && ci.brand === "Datanime" && /^Généré le \d/.test(ci.date) && /^Données d'exemple au \d{1,2} \S+ \d{4}$/.test(ci.data) && /^Empreinte [0-9a-f]{4}·[0-9a-f]{4}$/.test(ci.fp) && !!ci.qr && ci.ratio >= 1.5 && ci.ratio <= 2.8 && ci.relW < 0.22 && ci.overlaps.length === 0,
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
    // L'icône Datanime de la signature est bien dans le PNG : pixel du contour pétrole (bord gauche de l'icône,
    // hors bulle blanche : le contour occupe 7 % de la largeur), échelle 2×
    const logo = await page.evaluate(() => {
      const r = document.querySelector("[data-testid=chart-svg] .r4d-logo");
      return r ? { x: +r.getAttribute("x") + +r.getAttribute("width") * 0.035, y: +r.getAttribute("y") + +r.getAttribute("height") / 2 } : null;
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
    check("export PNG : signature présente (icône Datanime pétrole en bas à droite)", !!near, px ? `rgb(${px.slice(0, 3).join(", ")}) @ ${Math.round(logo.x)},${Math.round(logo.y)}` : "logo introuvable");
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
    check("option « QR d'empreinte des données » : masque le QR, garde le cartouche (offre gratuite)", !!off && !off.qr && off.brand === "Datanime" && /^Empreinte/.test(off.fp) && !!on?.qr && (await page.evaluate(() => window.r4d.getSpec().style.authQr)) === true, off ? `sans QR : ${Math.round(off.w)}×${Math.round(off.h)} px` : "cartouche absent");
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
      window.r4d.panel().open("recit");
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
  await domClick('[data-testid=norme-toggle] [data-value="true"]');
  await sleep(800);
  const nOn = await page.evaluate(() => {
    const b = document.querySelector("[data-testid=norme-badge]");
    return { on: window.r4d.getSpec().norme.enabled, badge: !!b && !b.hidden && b.offsetWidth > 0 && b.textContent, info: !document.querySelector("[data-testid=norme-info]").hidden, wording: document.querySelector("[data-testid=norme-wording]")?.textContent ?? "" };
  });
  check("mode norme : interrupteur (réglages), enregistré dans le spec, badge « Norme »", nOn.on === true && nOn.badge === "Norme" && nOn.info && /inspirée d’IBCS® et de la notation ISO 24896/.test(nOn.wording) && !/certifi/i.test(nOn.wording), JSON.stringify(nOn));
  const v1 = await chartAudit();
  check("mode norme : sous-titre qui · quoi · quand (« Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget »)", v1.sub === "Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget", v1.sub);
  check("mode norme : rouge / vert uniquement sur les écarts ; signature présente", v1.bad.length === 0 && v1.rgCount > 0 && v1.varBars > 0 && v1.cartouche, `${v1.rgCount} éléments rouge/vert, ${v1.bad.length} hors écarts ${v1.bad.slice(0, 3).join(" ")} · ${v1.varBars} barres d'écart`);
  await domClick('[data-testid=polarity] [data-value="lower"]');
  await sleep(600);
  const v1b = await chartAudit();
  const swapped = v1.varFills.length > 0 && v1.varFills.every((f, i) => v1b.varFills[i] === (f === RG[1] ? RG[0] : RG[1]));
  await domClick('[data-testid=polarity] [data-value="higher"]');
  await sleep(500);
  check("« Hausse = défavorable » inverse rouge et vert", swapped && (await page.evaluate(() => window.r4d.getSpec().variance.polarity)) === "higher", `${v1.varFills.length} écarts inversés`);
  if (SHOTS) {
    await page.evaluate(() => {
      window.r4d.panel().open("graphique");
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
  await domClick('[data-testid=norme-toggle] [data-value="false"]');
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
      "vérification : lecture du fragment, empreinte déclarée (pas une signature) (« généré par Datanime le … à partir de données importées le … (2 lignes, 3 colonnes), empreinte … »)",
      /Selon ce QR, ce graphique a été généré par Datanime le \d{1,2}(er)? \S+ \d{4} à partir de données importées le \d{1,2}(er)? \S+ \d{4} \(2 lignes, 3 colonnes\), empreinte [0-9a-f]{4}·[0-9a-f]{4}\./.test(sum) &&
        pageText.includes("Déposez le fichier d'origine pour vérifier") &&
        pageText.includes("La vérification compare l'empreinte du fichier ; elle ne dit rien de l'exactitude des données.") && pageText.includes("Un registre en ligne viendra renforcer cette vérification.") &&
        !/certifi|authenticit|preuve/i.test(pageText) &&
        /empreinte déclarée, pas d'une signature/.test(pageText) &&
        (await vp.title()).includes("Datanime"),
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
      await (await op.$("[data-testid=file-input]")).uploadFile(join(repo, "studio/test/fixtures/plan-mini.xlsx"));
      await op.waitForFunction(() => window.r4d.mapping().state.report && window.r4d.mapping().state.mapping, { timeout: 20000 }).catch(() => {});
      const ost = await op.evaluate(() => ({ r: window.r4d.mapping().state.report, where: window.r4d.mapping().state.where }));
      check("hors ligne (file://) : recalcul des formules dans un Worker (Blob), sans erreur", ost.r?.failed === 0 && ost.r.evaluated > 7000 && ost.where === "worker" && offErrors.length === 0, `${ost.r?.evaluated} formules (${ost.where}) ${offErrors.slice(0, 2).join(" | ")}`);
      await op.close();
    } else results.push("(version hors ligne absente : npm run build:studio:offline)");
  }

  /* 13. Import intelligent : onglets, recalcul des formules, tableau large, fenêtre « Mise en forme des données » */
  {
    // Classeur FICTIF (Exemple SA, Produit A / Produit B) : studio/scripts/make-test-fixtures.ts
    const xf = join(repo, "studio/test/fixtures/plan-mini.xlsx");
    const xfExpected = JSON.parse(readFileSync(join(repo, "studio/test/fixtures/plan-mini.expected.json"), "utf8"));
    const PLAN = "Plan 60m — Exemple";
    const mw = () => page.evaluate(() => window.r4d.mapping().state);
    const waitMw = async () => {
      await page.waitForFunction(() => window.r4d.mapping().isOpen && window.r4d.mapping().state.report && window.r4d.mapping().state.mapping, { timeout: 30000 }).catch(() => {});
      await sleep(400);
    };
    const pv = () => page.evaluate(() => window.r4d.mapping().state.pivot);
    const shotWindow = async (name) => {
      if (!SHOTS) return;
      await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 2 });
      await sleep(400);
      await page.screenshot({ path: join(shotsDir, name) });
      await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: 1.5 });
    };
    await page.evaluate(() => window.r4d.setSpec({ type: "line" }));
    const input = await page.$("[data-testid=file-input]");
    await input.uploadFile(xf);
    await waitMw();
    let st = await mw();
    const visible = await page.$eval("[data-testid=mapping-window]", (e) => !e.classList.contains("hidden"));
    check(
      "import intelligent : fenêtre ouverte, onglet « plan mensuel » proposé (Lisez-moi / Sources en dernier)",
      visible && st.sheet === PLAN && (["Lisez-moi", "Sources"].every((n) => st.guesses.slice().sort((a, b) => a.score - b.score).slice(0, 2).some((g) => g.name === n))),
      `${st.sheet} · ${st.guesses.map((g) => `${g.name}:${g.score}`).join(", ")}`
    );
    check(
      "recalcul des formules dans le navigateur (Web Worker) : toutes évaluées, aucune en échec",
      st.report && st.report.failed === 0 && st.report.evaluated === st.report.formulas && st.report.formulas > 7000 && st.where === "worker" && /formules recalculées/.test(await page.$eval("[data-testid=mw-status]", (e) => e.textContent)),
      `${st.report?.evaluated}/${st.report?.formulas} en ${st.report?.ms} ms (${st.where})`
    );
    check("structure : tableau large daté, sections, totaux annuels et résumé proposés à part", st.tables.length >= 3 && st.tables.some((t) => /totaux annuels/.test(t)) && st.tables.some((t) => t.startsWith("summary:")), st.tables.join(" | "));
    await shotWindow("22-choix-onglet.png");

    // Graphique 1 : commerciaux en poste = somme des lignes « en poste (1/0) », courbe en escalier
    await page.evaluate(() => window.r4d.mapping().clearSeries());
    await selectValue("[data-testid=mw-filter][data-filter=Indicateur]", "en poste (1/0)");
    await sleep(150);
    await domClick("[data-testid=mw-check-all]");
    await selectValue("[data-testid=mw-agg]", "sum");
    await page.$eval("[data-testid=mw-group-name]", (e) => (e.value = "Commerciaux en poste"));
    await domClick("[data-testid=mw-group]");
    await selectValue("[data-testid=mw-curve]", "step");
    await page.$eval("[data-testid=mw-title]", (e) => {
      e.value = "Commerciaux en poste par mois";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(500);
    let p = await pv();
    const vals = p?.rows.map((r) => r["Commerciaux en poste"]) ?? [];
    check(
      "regrouper 24 lignes 0/1 (somme) → effectif en escalier 2027–2031, aperçu en direct",
      p && p.rows.length === 60 && p.xGrain === "month" && vals.at(-1) === 24 && vals.every((v, i) => Number.isInteger(v) && (i === 0 || v >= vals[i - 1])) && (await page.$$eval("[data-testid=mw-preview] svg .r4d-marks *", (e) => e.length)) > 0,
      `${p?.rows.length} mois · ${vals.slice(0, 3).join(",")}…${vals.at(-1)} · ${p?.rows[0]?.[p.x]}`
    );
    await shotWindow("23-mapping-live.png");
    await domClick("[data-testid=mw-apply]");
    await sleep(900);
    let sp = await page.evaluate(() => ({ spec: window.r4d.getSpec(), n: window.r4d.store.state.ds?.rows.length, prov: window.r4d.provenance(), open: window.r4d.mapping().isOpen }));
    check(
      "Appliquer : chargé dans le Studio (courbe en escalier, provenance = empreinte du fichier brut, cartouche)",
      !sp.open && sp.n === 60 && sp.spec.encoding.y[0] === "Commerciaux en poste" && sp.spec.style.curve === "step" && sp.spec.style.title === "Commerciaux en poste par mois" && sp.prov?.kind === "file" && sp.prov.hash === sha256(readFileSync(xf)) && sp.prov.sheet === PLAN && !!(await cartoucheInfo()),
      `${sp.spec.type} ${sp.spec.encoding.x} → ${sp.spec.encoding.y.join(",")} · ${sp.prov?.hash?.slice(0, 12)}…`
    );
    await page.evaluate(() => window.r4d.seek(1));
    await shotStage("24-commerciaux-en-poste.png");

    // Graphique 2 : capacité commerciale (ETP) = somme des productivités ; X ⇄ Y
    await domClick("[data-testid=reshape-open]");
    await waitMw();
    await page.evaluate(() => window.r4d.mapping().clearSeries());
    await selectValue("[data-testid=mw-filter][data-filter=Indicateur]", "productivité (ramp)");
    await sleep(150);
    await domClick("[data-testid=mw-check-all]");
    await page.$eval("[data-testid=mw-group-name]", (e) => (e.value = "Capacité commerciale (ETP)"));
    await domClick("[data-testid=mw-group]");
    await page.$eval("[data-testid=mw-title]", (e) => {
      e.value = "Capacité commerciale équivalent temps plein";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(400);
    p = await pv();
    const cap = p?.rows.map((r) => r["Capacité commerciale (ETP)"]) ?? [];
    await domClick("[data-testid=mw-swap]");
    await sleep(400);
    const ps = await pv();
    await domClick("[data-testid=mw-swap]");
    await sleep(400);
    const pb = await pv();
    check(
      "capacité ETP (somme des productivités) ; ⇄ X / Y puis retour",
      cap.length === 60 && cap.at(-1) > 20 && cap.at(-1) <= 24 && ps?.x === "Série" && ps.series === "Période" && pb?.x === "Date" && pb.rows.length === 60,
      `fin ${cap.at(-1)?.toFixed(2)} · permuté x=${ps?.x} séries=${ps?.series}`
    );
    await domClick("[data-testid=mw-apply]");
    await sleep(700);
    sp = await page.evaluate(() => ({ y: window.r4d.getSpec().encoding.y, n: window.r4d.store.state.ds?.rows.length }));
    check("capacité ETP appliquée", sp.y[0] === "Capacité commerciale (ETP)" && sp.n === 60, JSON.stringify(sp));

    {
      // Graphique 3 : MRR Produit A vs MRR Produit B (deux lignes du tableau large)
      await domClick("[data-testid=reshape-open]");
      await waitMw();
      await page.evaluate(() => window.r4d.mapping().clearSeries());
      await domClick('[data-testid=mw-row][data-label="MRR Produit A"]');
      await domClick('[data-testid=mw-row][data-label="MRR Produit B"]');
      await page.$eval("[data-testid=mw-title]", (e) => {
        e.value = "MRR Produit A vs MRR Produit B";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await selectValue("[data-testid=mw-type]", "line");
      await sleep(400);
      p = await pv();
      check("MRR Produit A vs MRR Produit B : 2 séries mensuelles en euros", p?.y.join("|") === "MRR Produit A|MRR Produit B" && p.rows.length === 60 && p.unit === "eur", `${p?.y.join(", ")} · ${p?.unit}`);
      await domClick("[data-testid=mw-apply]");
      await sleep(900);
      await page.evaluate(() => window.r4d.seek(1));
      await shotStage("25-mrr-produits.png");

      // Graphique 4 : Synthèse — CA, EBITDA, Résultat net annuels (variante « Colonnes B–F »)
      await domClick("[data-testid=reshape-open]");
      await waitMw();
      await domClick('[data-testid=mw-sheet][data-sheet="Synthèse"]');
      await sleep(300);
      await domClick("[data-testid=mw-table]");
      await sleep(300);
      await page.evaluate(() => window.r4d.mapping().clearSeries());
      for (const l of ["Chiffre d'affaires HT", "EBITDA", "Résultat net"]) await domClick(`[data-testid=mw-row][data-label="${l}"]`);
      await selectValue("[data-testid=mw-type]", "groupedBar");
      await page.$eval("[data-testid=mw-title]", (e) => {
        e.value = "Synthèse annuelle : CA, EBITDA, résultat net";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await sleep(400);
      p = await pv();
      const ca = p?.rows.map((r) => r["Chiffre d'affaires HT"]) ?? [];
      check("Synthèse : CA / EBITDA / Résultat net 2027–2031 (5 années, une variante)", p?.xGrain === "year" && p.rows.length === 5 && p.y.length === 3 && Math.abs(ca[0] - xfExpected["Synthèse"].B6) < 0.01, `${p?.rows.length} ans · CA 2027 ${ca[0]?.toFixed(0)} · ${p?.y.join(", ")}`);
      await domClick("[data-testid=mw-apply]");
      await sleep(700);
      sp = await page.evaluate(() => ({ t: window.r4d.getSpec().type, g: window.r4d.getSpec().encoding.xGrain, n: window.r4d.store.state.ds?.rows.length, sheet: window.r4d.provenance()?.sheet }));
      check("Synthèse appliquée (barres groupées par année)", sp.t === "groupedBar" && sp.g === "year" && sp.n === 5 && sp.sheet === "Synthèse", JSON.stringify(sp));
    }

    // Collage d'un tableau large (temps en colonnes) → fenêtre proposée
    const tsvWide = readFileSync(join(repo, "studio/test/fixtures/plan-commercial.tsv"), "utf8");
    await page.evaluate((t) => window.r4d.importText(t), tsvWide);
    await page.waitForFunction(() => window.r4d.mapping().isOpen && window.r4d.mapping().state.mapping, { timeout: 8000 }).catch(() => {});
    st = await mw();
    check("collage d'un tableau large : fenêtre de mise en forme proposée (Entité + Indicateur, Ouverture)", st.mapping && st.tables.length >= 1 && (await page.$$("[data-testid=mw-opening]")).length === 1, st.tables.join(" | "));
    await page.keyboard.press("Escape");
    await sleep(200);
    check("Échap ferme la fenêtre", !(await page.evaluate(() => window.r4d.mapping().isOpen)));
  }

  /* 14. Exploration guidée + Scénario Directeur commercial (démo pipeline fictive) */
  {
    if (SHOTS) await page.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    const csvRes = await page.evaluate(async () => {
      const r = await fetch("demo/pipeline-commercial-2026.csv");
      return { status: r.status, text: r.ok ? await r.text() : "" };
    });
    const csvLines = csvRes.text.trim().split("\n");
    check("démo : CSV servi (demo/pipeline-commercial-2026.csv)", csvRes.status === 200 && csvLines.length === 1976 && csvLines[0].startsWith("id_opportunite;"), `${csvRes.status} · ${csvLines.length} lignes`);
    // Import du CSV (séparateur « ; », décimales françaises) puis exploration
    await page.evaluate((t) => window.r4d.importText(t), csvRes.text);
    await sleep(500);
    const imp = await page.evaluate(() => {
      const ds = window.r4d.store.state.ds;
      const col = (n) => ds.columns.find((c) => c.name === n)?.type;
      return { rows: ds.rows.length, montant: col("montant_eur"), date: col("date_creation"), proba: ds.rows[0].montant_pondere_eur };
    });
    check("démo : CSV importé (1 975 lignes, montants et dates reconnus)", imp.rows === 1975 && imp.montant === "number" && imp.date === "date" && typeof imp.proba === "number", JSON.stringify(imp));
    await page.evaluate(() => window.r4d.pickType("drill"));
    await sleep(500);
    const fromCsv = await page.evaluate(() => ({ bar: !document.querySelector("[data-testid=drill-bar]").hidden, title: window.r4d.getSpec().style.title.replace(/[\u00a0\u202f]/g, " "), d: window.r4d.drill() }));
    check("démo : exploration sur le CSV importé (rôles devinés, T2 2026 en recul)", fromCsv.bar && fromCsv.d.date === "date_creation" && fromCsv.d.measure === "montant_eur" && /T2 2026 : seul trimestre en recul/.test(fromCsv.title), fromCsv.title);

    // Exemple intégré « Démo : pipeline commercial » : clics réels
    await page.evaluate(() => window.r4d.loadSample("demo-pipeline"));
    await sleep(700);
    const t = async () => page.evaluate(() => window.r4d.getSpec().style.title.replace(/[\u00a0\u202f]/g, " "));
    const crumbs = async () => page.$$eval("[data-testid=drill-crumbs] button", (b) => b.map((x) => x.textContent));
    const clickSvg = async (sel) => {
      await page.waitForFunction(() => !document.querySelector("[data-testid=chart-svg]")?.hasAttribute("data-zoom"), { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.r4d.seek(1));
      const el = await page.$(`[data-testid=chart-svg] ${sel}`);
      if (!el) throw new Error("élément introuvable : " + sel);
      await el.click();
      await sleep(450);
      await page.evaluate(() => window.r4d.seek(1));
    };
    check("démo : vue de départ par trimestre", /^T2 2026 : seul trimestre en recul \(−3,8 %\)/.test(await t()) && (await page.$$("[data-testid=chart-svg] .r4d-drill-bar")).length === 7, await t());
    const tap = await page.$$eval(".drill-btn, .drill-crumb, .drill-select", (els) => Math.min(...els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)));
    check("démo : cibles tactiles ≥ 44 px (iPad)", tap >= 44, `${tap} px`);
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "26-exploration-trimestres.png") });
    await clickSvg('.r4d-drill-bar[data-focus="1"]');
    check("démo : clic sur T2 2026 → mois, juin décroche", /^Juin 2026 décroche : 1,3 M€, −22 %/.test(await t()) && JSON.stringify(await crumbs()) === JSON.stringify(["Tout", "T2 2026"]), await t());
    await clickSvg('.r4d-drill-bar[data-focus="1"]');
    check("démo : clic sur juin → jour par jour (fil d'Ariane Tout › T2 2026 › Juin 2026)", /tout au long du mois/.test(await t()) && JSON.stringify(await crumbs()) === JSON.stringify(["Tout", "T2 2026", "Juin 2026"]), await t());
    await domClick("[data-testid=drill-view-map]");
    await sleep(500);
    await page.evaluate(() => window.r4d.seek(1));
    const map = await page.evaluate(() => ({
      regions: [...document.querySelectorAll("[data-testid=chart-svg] .r4d-drill-region")].map((e) => e.getAttribute("data-drill-value")),
      km: document.querySelector("[data-testid=chart-svg] .r4d-scalebar")?.getAttribute("data-km"),
      cart: document.querySelector("[data-testid=chart-svg] .r4d-cartouche")?.textContent ?? "",
    }));
    check("démo : « Répartir dans l'espace » → carte des 5 régions, échelle en km, cartouche", map.regions.length === 5 && Number(map.km) > 0 && /IGN, NGI-Statbel, Natural Earth/.test(map.cart) && !/GISCO|EuroGeographics|non commercial/.test(map.cart) && /Généré le/.test(map.cart) && /Wallonie concentre toute la baisse/.test(await t()), `${map.regions.join(", ")} · ${map.km} km`);
    if (SHOTS) await shotStage("27-exploration-carte.png");
    await domClick("[data-testid=drill-view-history]");
    await sleep(500);
    check("démo : historique par région (5 petits multiples, août saisonnier)", (await page.$$("[data-testid=chart-svg] .r4d-drill-panel")).length === 5 && /août est bas partout/.test(await t()), await t());
    if (SHOTS) await shotStage("28-exploration-historique.png");
    await clickSvg('.r4d-drill-panel[data-drill-value="Wallonie"]');
    check("démo : focus Wallonie (juin au plus bas)", /^Wallonie : juin 2026 au plus bas/.test(await t()) && (await crumbs()).at(-1) === "Wallonie", await t());
    await page.select("[data-testid=drill-detail]", "commercial");
    await sleep(500);
    const bd = await page.evaluate(() => ({ rows: document.querySelectorAll("[data-testid=chart-svg] .r4d-drill-row").length, comments: window.r4d.getSpec().story.comments }));
    check("démo : « Détailler par » commercial → Julie M. à 0, collègues stables", /^Julie M\. : 0 opportunité créée en juin 2026 contre 13 en moyenne/.test(await t()) && bd.rows === 4 && bd.comments.some((c) => /stables/.test(c)), (await t()) + " · " + bd.rows);
    if (SHOTS) await shotStage("29-exploration-commerciaux.png");
    await domClick("[data-testid=drill-back]");
    await sleep(300);
    check("démo : retour (←) → vue temps du niveau Wallonie", (await page.evaluate(() => window.r4d.drill().view)) === "periods" && (await crumbs()).length === 4);
    await domClick("[data-testid=drill-crumb-1]");
    await sleep(300);
    check("démo : fil d'Ariane → retour au T2 2026", JSON.stringify(await crumbs()) === JSON.stringify(["Tout", "T2 2026"]) && /Juin 2026 décroche/.test(await t()));

    // Transition « zoom dans la marque » (ralentie ×6 pour l'observer) : descente puis remontée
    {
      const zs = () =>
        page.evaluate(() => {
          const svg = document.querySelector("[data-testid=chart-svg]");
          const root = [...svg.children].find((c) => c.tagName === "g" && !c.classList.contains("r4d-zoom-layer"));
          const faded = [...root.children].filter((c) => !c.classList.contains("r4d-bg")).map((c) => Number(c.style.opacity || 1));
          const mark = svg.querySelector(".r4d-zoom-layer .r4d-zoom-mark");
          const veil = svg.querySelector(".r4d-zoom-layer .r4d-zoom-veil");
          const sc = /scale\(([\d.]+) ([\d.]+)\)/.exec(mark?.getAttribute("transform") ?? "");
          return {
            zoom: svg.getAttribute("data-zoom"),
            minOpacity: Math.min(...faded),
            scale: sc ? Math.max(Number(sc[1]), Number(sc[2])) : 0,
            veil: veil ? Number(veil.getAttribute("fill-opacity")) : null,
            inert: mark ? !mark.hasAttribute("data-drill-kind") && !mark.querySelector("[data-drill-kind]") : null,
            drillMarksInLayer: svg.querySelectorAll(".r4d-zoom-layer .r4d-drill-mark, .r4d-zoom-layer [data-drill-kind]").length,
          };
        });
      const zoomGone = () => page.waitForFunction(() => !document.querySelector("[data-testid=chart-svg]").hasAttribute("data-zoom"), { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => {
        window.r4d.seek(1);
        window.r4d.drillZoom(true, 6);
      });
      await (await page.$('[data-testid=chart-svg] .r4d-drill-bar[data-focus="1"]')).click();
      await page.mouse.move(2, 2);
      await sleep(1300);
      const dive = await zs();
      check("zoom : descente — la barre cliquée grandit vers toute la zone du graphique, le reste s'efface (copie inerte)", dive.zoom === "in" && dive.scale > 1.3 && dive.minOpacity < 0.7 && dive.inert === true && dive.drillMarksInLayer === 0, JSON.stringify(dive));
      if (SHOTS) await (await page.$(".stage")).screenshot({ path: join(shotsDir, "66-zoom-descente-mi-parcours.png") });
      await page.waitForFunction(() => document.querySelector("[data-testid=chart-svg]").getAttribute("data-zoom") === "emerge", { timeout: 6000 }).catch(() => {});
      await sleep(400);
      const em = await zs();
      check("zoom : l'enfant (jour par jour) émerge de l'empreinte du parent (voile qui se dissout)", em.zoom === "emerge" && em.veil > 0 && em.veil < 0.92 && (await crumbs()).length === 3, JSON.stringify(em));
      await zoomGone();
      const end = await zs();
      check("zoom : fin de transition — calque retiré, opacités rétablies", end.zoom === null && end.minOpacity === 1 && end.veil === null && end.scale === 0, JSON.stringify(end));
      // remontée par le fil d'Ariane : l'enfant se replie dans un voile, puis la barre de juin rétrécit jusqu'à sa place
      await domClick("[data-testid=drill-crumb-1]");
      await sleep(1300);
      const fold = await zs();
      await page.waitForFunction(() => document.querySelector("[data-testid=chart-svg]").getAttribute("data-zoom") === "out", { timeout: 6000 }).catch(() => {});
      await sleep(1000);
      const out = await zs();
      check("zoom : remontée (fil d'Ariane) — repli dans un voile puis la marque parente rétrécit à sa place", fold.zoom === "fold" && fold.veil > 0.2 && out.zoom === "out" && out.scale > 1.05 && out.minOpacity < 1, JSON.stringify({ fold, out }));
      if (SHOTS) await (await page.$(".stage")).screenshot({ path: join(shotsDir, "67-zoom-remontee-mi-parcours.png") });
      await zoomGone();
      check("zoom : remontée terminée → T2 2026 par mois", JSON.stringify(await crumbs()) === JSON.stringify(["Tout", "T2 2026"]) && /Juin 2026 décroche/.test(await t()) && (await zs()).minOpacity === 1);
      // prefers-reduced-motion : aucune animation
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await (await page.$('[data-testid=chart-svg] .r4d-drill-bar[data-focus="1"]')).click();
      await sleep(150);
      const rm = await zs();
      check("zoom : prefers-reduced-motion → changement immédiat, sans calque", rm.zoom === null && rm.scale === 0 && (await crumbs()).length === 3, JSON.stringify(rm));
      await domClick("[data-testid=drill-crumb-1]");
      await sleep(300);
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await page.evaluate(() => window.r4d.drillZoom(true, 1));
    }

    // Scénario en un clic (fenêtre « Scénarios »)
    await domClick("[data-testid=scenario-open]");
    await sleep(300);
    const roles = await page.evaluate(() => [...document.querySelectorAll("[data-testid^=scenario-role-]")].map((s) => `${s.getAttribute("data-testid").slice(14)}=${s.value}`));
    check("scénario : rôles associés automatiquement (date, montant, région, commercial)", roles.join(",") === "date=date_creation,mesure=montant_eur,region=region,commercial=commercial", roles.join(", "));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "30-scenario-directeur-commercial.png") });
    await domClick("[data-testid=scenario-run]");
    await page.waitForFunction(() => window.r4d.film().isOpen, { timeout: 30000 }).catch(() => {});
    const story = await page.evaluate(() => window.r4d.story());
    const ids = story.snapshots.map((s) => s.id);
    globalThis.__dircom = { ids, titles: story.snapshots.map((s) => s.title) };
    check("scénario : 7 snapshots (ids stables, chemin, commentaires) puis film", story.snapshots.length === 7 && ids.join(",") === "dircom-01-trimestres,dircom-02-mois,dircom-03-mois-focus,dircom-04-carte,dircom-05-historique,dircom-06-region,dircom-07-commerciaux" && story.snapshots[3].path.join(" › ") === "Tout › T2 2026 › Juin 2026" && story.snapshots.every((s) => s.comments.length >= 2 && s.svg && s.thumb) && story.title === "Revue du pipeline — octobre 2026", ids.join(" "));
    await sleep(2200);
    const film = await page.evaluate(() => ({ open: window.r4d.film().isOpen, marks: document.querySelectorAll("[data-testid=film-svg] .r4d-drill-mark").length, counter: document.querySelector("[data-testid=film-counter]").textContent }));
    check("film : rejoue l'histoire (construction animée, compteur)", film.open && film.marks > 0 && film.counter === "1 / 7", JSON.stringify(film));
    await page.evaluate(() => window.r4d.film().close());
    await page.evaluate(() => window.r4d.film().open(window.r4d.story().snapshots, 3));
    await sleep(3600);
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "31-film-carte.png") });
    await domClick("[data-testid=film-next]");
    await sleep(2400);
    check("film : étape suivante (→) et commentaires révélés", (await page.$eval("[data-testid=film-counter]", (e) => e.textContent)) === "5 / 7" && (await page.$$("[data-testid=film-svg] .r4d-comment")).length >= 1);
    await page.keyboard.press("Escape");
    await sleep(200);
    check("film : Échap ferme", !(await page.evaluate(() => window.r4d.film().isOpen)));
    // Film : aucune mise en page qui saute — colonne « À retenir » réservée dès la première image
    const lay = () =>
      page.evaluate(() => {
        const svg = document.querySelector("[data-testid=film-svg]");
        const xs = [...svg.querySelectorAll(".r4d-drill-bar .r4d-drill-hitbox")].map((r) => Math.round(Number(r.getAttribute("x"))));
        return { line: svg.querySelector(".r4d-comments line")?.getAttribute("x1") ?? null, n: svg.querySelectorAll(".r4d-comment").length, xs: xs.join(",") };
      });
    await page.evaluate(() => window.r4d.film().open(window.r4d.story().snapshots, 0));
    await sleep(80);
    const j0 = await lay();
    await page.evaluate(() => window.r4d.film().finishNow());
    await sleep(300);
    const j1 = await lay();
    check("film : pas de saut — colonne « À retenir » et barres à leur place finale dès la première image", j0.n === 0 && !!j0.line && j0.line === j1.line && j0.xs === j1.xs && j0.xs.length > 0 && j1.n >= 2, JSON.stringify({ j0, j1 }));
    await page.evaluate(() => window.r4d.film().close());
    // Film : diapositive parent → enfant (juin 2026 → jour par jour) en « zoom dans la marque »
    await page.evaluate(() => {
      window.r4d.drillZoom(true, 4);
      window.r4d.film().open(window.r4d.story().snapshots, 1);
    });
    await sleep(400);
    await page.evaluate(() => window.r4d.film().finishNow());
    await sleep(300);
    await domClick("[data-testid=film-next]");
    await sleep(900);
    const fz = await page.evaluate(() => ({ z: document.querySelector("[data-testid=film-svg]").getAttribute("data-zoom"), mark: !!document.querySelector("[data-testid=film-svg] .r4d-zoom-mark") }));
    await page.waitForFunction(() => document.querySelector("[data-testid=film-svg]").getAttribute("data-zoom") === "emerge", { timeout: 6000 }).catch(() => {});
    const fe = await page.evaluate(() => ({ z: document.querySelector("[data-testid=film-svg]").getAttribute("data-zoom"), counter: document.querySelector("[data-testid=film-counter]").textContent }));
    check("film : diapositive enfant → zoom dans la barre parente puis émergence", fz.z === "in" && fz.mark && fe.z === "emerge" && fe.counter === "3 / 7", JSON.stringify({ fz, fe }));
    await page.evaluate(() => {
      window.r4d.film().close();
      window.r4d.drillZoom(true, 1);
    });
    // Rejouer le scénario : mêmes identifiants (partage futur par QR)
    await page.evaluate(() => window.r4d.scenario("dircom", true));
    await page.waitForFunction(() => window.r4d.film().isOpen, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.r4d.film().close());
    const ids2 = await page.evaluate(() => window.r4d.story().snapshots.map((s) => s.id));
    check("scénario : identifiants de snapshots stables d'un passage à l'autre", JSON.stringify(ids2) === JSON.stringify(ids));
    const b64 = await page.evaluate(() => window.r4d.pptxBase64());
    const zip = Buffer.from(b64, "base64").toString("latin1");
    const slides = new Set(zip.match(/ppt\/slides\/slide\d+\.xml/g) ?? []).size;
    check("scénario : PowerPoint 9 diapositives (couverture, sommaire, 7 snapshots)", slides === 9, `${slides} diapositives`);
    // Pas à pas : guidage dans la barre d'exploration
    await page.evaluate(() => window.r4d.scenario("dircom", false));
    await sleep(500);
    const guide = await page.$eval("[data-testid=drill-guide]", (e) => e.textContent).catch(() => "");
    check("scénario pas à pas : guidage (étape 1/7)", /Scénario Directeur commercial · étape 1\/7/.test(guide), guide);
    await domClick("[data-testid=drill-suggest]");
    await sleep(400);
    await domClick("[data-testid=drill-snapshot]");
    await sleep(600);
    const st2 = await page.evaluate(() => window.r4d.story().snapshots.map((s) => s.step));
    check("scénario pas à pas : « Suggestion » puis 📸 → snapshot de l'étape 2", JSON.stringify(st2) === JSON.stringify(["02-mois"]), st2.join(","));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "32-pas-a-pas.png") });
  }

  /* 15. Cascade budget vs réel + tableau croisé + Scénario Directeur financier (démo finance fictive) */
  {
    const csvRes = await page.evaluate(async () => {
      const r = await fetch("demo/finance-reel-2025-budget-2026.csv");
      return { status: r.status, text: r.ok ? await r.text() : "" };
    });
    const csvLines = csvRes.text.trim().split("\n");
    check("finance : CSV servi (demo/finance-reel-2025-budget-2026.csv)", csvRes.status === 200 && csvLines.length === 2521 && csvLines[0].startsWith("version;mois;"), `${csvRes.status} · ${csvLines.length} lignes`);
    await page.evaluate((t) => window.r4d.importText(t), csvRes.text);
    await sleep(500);
    await page.evaluate(() => window.r4d.pickType("drill"));
    await sleep(500);
    const fromCsv = await page.evaluate(() => ({ title: window.r4d.getSpec().style.title.replace(/[\u00a0\u202f]/g, " "), d: window.r4d.drill() }));
    check("finance : CSV importé → cascade devinée (version, nature, niveaux)", fromCsv.d.view === "bridge" && fromCsv.d.version === "version" && fromCsv.d.nature === "nature" && fromCsv.d.levels.join(",") === "ligne_metier,compte" && /^Budget 2026 : −0,4 M€ vs Réel 2025/.test(fromCsv.title), fromCsv.title);

    await page.evaluate(() => window.r4d.loadSample("demo-finance"));
    await sleep(700);
    const t = async () => page.evaluate(() => window.r4d.getSpec().style.title.replace(/[\u00a0\u202f]/g, " "));
    const crumbs = async () => page.$$eval("[data-testid=drill-crumbs] button", (b) => b.map((x) => x.textContent));
    const clickSvg = async (sel) => {
      await page.waitForFunction(() => !document.querySelector("[data-testid=chart-svg]")?.hasAttribute("data-zoom"), { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => window.r4d.seek(1));
      const el = await page.$(`[data-testid=chart-svg] ${sel}`);
      if (!el) throw new Error("élément introuvable : " + sel);
      await el.click();
      await sleep(450);
      await page.evaluate(() => window.r4d.seek(1));
    };
    const items = await page.$$eval("[data-testid=chart-svg] .r4d-drill-bridge-item", (els) => els.map((e) => e.getAttribute("data-key")));
    check("finance : cascade Réel 2025 → 5 lignes métier → Budget 2026", items.length === 7 && /^Budget 2026 : −0,4 M€ vs Réel 2025 — Équipements \(−3,0 M€\) efface la hausse de Plateforme \(\+2,1 M€\)/.test(await t()), `${items.length} · ${await t()}`);
    if (SHOTS) await shotStage("33-cascade.png");
    await clickSvg('.r4d-drill-bridge-item[data-drill-value="Plateforme"]');
    const sub = await page.$$("[data-testid=chart-svg] .r4d-drill-bridge-subtotal");
    check("finance : clic sur Plateforme → comptes, revenus puis coûts (sous-total)", sub.length === 1 && /^Plateforme : \+2,1 M€ vs 2025, dont \+2,6 M€ de revenus et \+0,5 M€ de coûts d'infrastructure/.test(await t()) && JSON.stringify(await crumbs()) === JSON.stringify(["Tout", "Plateforme"]), await t());
    if (SHOTS) await shotStage("34-cascade-plateforme.png");
    await clickSvg('.r4d-drill-bridge-item[data-drill-value="Abonnements annuels"]');
    check("finance : clic sur Abonnements annuels → mois (75 % au second semestre)", (await page.evaluate(() => window.r4d.drill().view)) === "compare" && /^Abonnements annuels : \+2,0 M€ au Budget 2026, dont 75 % au second semestre/.test(await t()), await t());
    if (SHOTS) await shotStage("35-cascade-mois.png");
    await domClick("[data-testid=drill-back]");
    await sleep(400);
    check("finance : retour (←) → cascade Plateforme", (await page.evaluate(() => window.r4d.drill().view)) === "bridge" && /^Plateforme :/.test(await t()), await t());
    await domClick("[data-testid=drill-crumb-0]");
    await sleep(400);
    await domClick("[data-testid=drill-view-map]");
    await sleep(500);
    await page.evaluate(() => window.r4d.seek(1));
    const map = await page.evaluate(() => ({ n: document.querySelectorAll("[data-testid=chart-svg] .r4d-drill-region").length, km: document.querySelector("[data-testid=chart-svg] .r4d-scalebar")?.getAttribute("data-km") }));
    check("finance : carte des écarts (IDF seule en recul, échelle)", map.n === 5 && Number(map.km) > 0 && /^L'Île-de-France : −2,1 M€ \(−28 %\)/.test(await t()), `${map.n} · ${await t()}`);
    if (SHOTS) await shotStage("36-cascade-carte.png");
    await domClick("[data-testid=drill-view-pivot]");
    await sleep(500);
    const pv = await page.evaluate(() => ({
      panel: !!document.querySelector("[data-testid=pivot-panel]")?.offsetParent,
      sel: ["x", "series", "agg", "chart"].map((k) => document.querySelector(`[data-testid=pivot-${k}]`)?.value),
      keys: document.querySelectorAll("[data-testid=chart-svg] .r4d-drill-pivot-key").length,
    }));
    check("tableau croisé : panneau compact (X, séries, mesure, graphique) · écart par trimestre", pv.panel && pv.sel.join(",") === "@quarter,ligne_metier,delta,bar" && pv.keys === 4 && /^Écart par trimestre : Plateforme \+2,1 M€ \(75 % sur T3–T4\), Équipements −3,0 M€ dès T1/.test(await t()), JSON.stringify(pv) + " " + (await t()));
    if (SHOTS) await shotStage("37-tableau-croise.png");
    await page.select("[data-testid=pivot-x]", "region");
    await sleep(500);
    const pv2 = await page.evaluate(() => document.querySelectorAll("[data-testid=chart-svg] .r4d-drill-pivot-key").length);
    check("tableau croisé : X = région → 5 colonnes", pv2 === 5, `${pv2} · ${await t()}`);
    await page.select("[data-testid=pivot-series]", "");
    await sleep(400);
    await page.select("[data-testid=pivot-agg]", "sum");
    await sleep(500);
    const pv3 = await page.evaluate(() => ({ series: document.querySelector("[data-testid=pivot-series]")?.value, title: window.r4d.getSpec().style.title.replace(/[\u00a0\u202f]/g, " ") }));
    check("tableau croisé : mesure « somme » → Réel 2025 et Budget 2026 côte à côte", /Budget 2026 vs Réel 2025|Réel 2025/.test(pv3.title), JSON.stringify(pv3));

    // Scénario Directeur financier : rôles + lancement automatique
    await domClick("[data-testid=scenario-open]");
    await sleep(300);
    await domClick("[data-testid=scenario-daf]");
    await sleep(300);
    const roles = await page.evaluate(() => [...document.querySelectorAll("[data-testid^=scenario-role-]")].map((s) => `${s.getAttribute("data-testid").slice(14)}=${s.value}`));
    const pair = await page.$eval("[data-testid=scenario-version-pair]", (e) => e.textContent).catch(() => "");
    check("scénario DAF : rôles associés (date, mesure, version, ligne, compte, nature, région)", roles.join(",") === "date=mois,mesure=montant_eur,version=version,ligne=ligne_metier,compte=compte,nature=nature,region=region" && /Réel 2025 → Budget 2026/.test(pair), roles.join(", ") + " · " + pair);
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "38-scenario-directeur-financier.png") });
    await domClick("[data-testid=scenario-run]");
    await page.waitForFunction(() => window.r4d.film().isOpen, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.r4d.film().close());
    const story = await page.evaluate(() => window.r4d.story());
    const ids = story.snapshots.map((s) => s.id);
    check("scénario DAF : 7 snapshots (ids stables, commentaires)", story.snapshots.length === 7 && ids.join(",") === "daf-01-cascade,daf-02-hausse,daf-03-hausse-mois,daf-04-baisse,daf-05-baisse-mois,daf-06-carte,daf-07-tableau-croise" && story.snapshots.every((s) => s.comments.length >= 2 && s.svg) && story.title === "Budget 2026 vs réel 2025 — revue financière", ids.join(" "));
    const b64 = await page.evaluate(() => window.r4d.pptxBase64());
    const slides = new Set(Buffer.from(b64, "base64").toString("latin1").match(/ppt\/slides\/slide\d+\.xml/g) ?? []).size;
    check("scénario DAF : PowerPoint 9 diapositives", slides === 9, `${slides} diapositives`);
    await page.evaluate(() => window.r4d.scenario("daf", false));
    await sleep(500);
    const guide = await page.$eval("[data-testid=drill-guide]", (e) => e.textContent).catch(() => "");
    check("scénario DAF pas à pas : guidage (étape 1/7)", /Scénario Directeur financier · étape 1\/7/.test(guide), guide);
    const chipTxt = await page.$eval("[data-testid=drill-suggest]", (e) => e.textContent).catch(() => "");
    await domClick("[data-testid=drill-suggest]");
    await sleep(500);
    check("scénario DAF pas à pas : bouton « Étape 2 : Facteur en hausse » → Plateforme", /^Étape 2 : Facteur en hausse/.test(chipTxt) && /^Plateforme : \+2,1 M€/.test(await t()), chipTxt + " · " + (await t()));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "39-pas-a-pas-finance.png") });
  }

  /* 16. Revues partagées : liste, Partager (lien + QR par revue / snapshot), page participant, réunion, compte rendu */
  {
    const P = "norvia-pipeline-oct-2026";
    const F = "norvia-budget-2026";
    const vp = async (w, h2, touch = false) => {
      await page.setViewport({ width: w, height: h2, deviceScaleFactor: SHOTS ? 1.5 : 1, isMobile: touch, hasTouch: touch });
      await sleep(400);
    };
    const shot = async (name) => {
      if (!SHOTS) return;
      await sleep(250);
      await page.screenshot({ path: join(shotsDir, name) });
    };
    await page.evaluate(() => window.r4d.film().close());
    await page.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    await domClick("[data-testid=reviews-open]");
    await page.waitForSelector(`[data-testid=rv-card-${P}]`, { timeout: 15000 });
    const list = await page.evaluate(() => ({
      hash: location.hash,
      cards: [...document.querySelectorAll("[data-testid^=rv-card-]")].map((e) => e.getAttribute("data-testid").slice(8)),
      count: document.querySelector("[data-testid=reviews-count]")?.textContent,
      note: document.querySelector("[data-testid=rv-local-note]")?.textContent ?? "",
      reset: !!document.querySelector("[data-testid=rv-reset-demo]"),
    }));
    check("Revues : bouton « Revues » → liste (#/revues), revue pipeline Norvia + revue DAF préchargées, note « partage en ligne bientôt »", list.hash.startsWith("#/revues") && list.cards.includes(P) && list.cards.includes(F) && list.count === "2" && /Partage en ligne bientôt/.test(list.note) && list.reset, JSON.stringify(list));
    await domClick(`[data-testid=rv-card-${P}]`);
    await sleep(500);
    const det = await page.evaluate((id) => {
      const r = window.r4d.reviewStorage().get(id);
      return { hash: location.hash, title: document.querySelector("[data-testid=rv-title]")?.textContent, seq: document.querySelectorAll("[data-testid^=rv-seq-]:not([data-testid^=rv-seq-qr])").length, ids: r.snapshots.map((s) => s.id), titles: r.snapshots.map((s) => s.title), org: r.org, reading: document.querySelector("[data-testid=rv-reading]")?.textContent ?? "" };
    }, P);
    const dc = globalThis.__dircom ?? { ids: [], titles: [] };
    check("revue pipeline : 7 snapshots du Scénario Directeur commercial, mêmes ids stables et titres que dans le Studio", det.title === "Revue pipeline — octobre 2026" && det.seq === 7 && JSON.stringify(det.ids) === JSON.stringify(dc.ids) && JSON.stringify(det.titles) === JSON.stringify(dc.titles) && /^Norvia/.test(det.org), `${det.hash} · ${det.ids.join(" ")}`);
    check("revue pipeline : lecture avant la réunion (8/9 ont tout vu)", /8\s*\/9/.test(det.reading.replace(/\s+/g, " ")) || /8\/9/.test(det.reading), det.reading.slice(0, 80));
    await page.evaluate(() => (document.querySelector(".rv-main").scrollTop = 0));
    await shot("40-revues-liste.png");
    // Partager : lien + QR de la revue, puis d'un snapshot
    await domClick("[data-testid=rv-share]");
    await page.waitForSelector("[data-testid=rv-share-dialog]");
    const sh = await page.evaluate(() => ({ url: document.querySelector("[data-testid=rv-share-url]").textContent, qr: !!document.querySelector("[data-testid=rv-qr] svg path"), links: document.querySelectorAll("[data-testid^=rv-snaplink-]").length }));
    check("Partager : lien de la revue (#/r/…) + QR + 7 liens de snapshot", sh.url.endsWith(`#/r/${P}`) && sh.qr && sh.links === 7, sh.url);
    await shot("41-revues-partager.png");
    // premier snapshot qu'Antoine Mercier (en retard) n'a pas encore vu
    const K = await page.evaluate((id) => { const r = window.r4d.reviewStorage().get(id); return Math.min(5, r.snapshots.findIndex((s) => !(r.seen.am ?? {})[s.id])); }, P);
    await page.evaluate((k) => document.querySelectorAll(".rv-snaplink-title")[k].click(), K);
    await sleep(300);
    const sh3 = await page.evaluate(() => ({ url: document.querySelector("[data-testid=rv-share-url]").textContent, hash: location.hash, qrLabel: document.querySelector("[data-testid=rv-qr] svg").getAttribute("aria-label") }));
    check(`Partager : QR propre au snapshot ${K + 1} (lien #/r/<revue>/<snapshot>)`, sh3.url.endsWith(`#/r/${P}/${dc.ids[K]}`) && sh3.qrLabel.includes(dc.ids[K]) && sh3.hash === `#/revues/${P}/partager/${dc.ids[K]}`, sh3.url);
    // page participant par le lien du snapshot 3
    await domClick("[data-testid=rv-open-participant]");
    await page.waitForSelector("[data-testid=rv-participant]");
    await sleep(1600);
    await page.evaluate(() => {
      const sel = document.querySelector("[data-testid=rv-who]");
      sel.value = "am";
      sel.dispatchEvent(new Event("change"));
    });
    await sleep(600);
    const p1 = await page.evaluate(() => ({ hash: location.hash, title: document.querySelector("[data-testid=rv-part-title]")?.textContent, seen: document.querySelector("[data-testid=rv-seen]")?.textContent, marks: document.querySelectorAll("[data-testid=rv-participant] .rv-part-chart svg .r4d-drill-mark, [data-testid=rv-participant] .rv-part-chart svg path").length, count: document.querySelector("[data-testid=rv-part-count]")?.textContent }));
    check(`page participant : ouverte par le lien du snapshot ${K + 1}, graphique rendu, « J'ai vu »`, p1.hash === `#/r/${P}/${dc.ids[K]}` && p1.title === dc.titles[K] && p1.marks > 0 && /J'ai vu/.test(p1.seen ?? ""), JSON.stringify(p1));
    await shot("42-participant-bureau.png");
    await domClick("[data-testid=rv-seen]");
    await sleep(300);
    await domClick("[data-testid=rv-react-utile]");
    await sleep(300);
    await page.evaluate(() => {
      const ta = document.querySelector("[data-testid=rv-ask-text]");
      ta.value = "Peut-on voir le même cumul pour juillet ?";
    });
    await domClick("[data-testid=rv-ask-send]");
    await sleep(400);
    const p2 = await page.evaluate((id, k) => {
      const r = window.r4d.reviewStorage().get(id);
      const snap = r.snapshots[k].id;
      return {
        seen: (r.seen.am ?? {})[snap] != null,
        react: r.reactions.some((x) => x.author === "am" && x.snapId === snap && x.kind === "utile"),
        q: r.comments.some((c) => c.author === "am" && c.question && /juillet/.test(c.text)),
        btn: document.querySelector("[data-testid=rv-seen]")?.textContent,
      };
    }, P, K);
    check("page participant : « J'ai vu », réaction « Utile » et question enregistrées (stockage local)", p2.seen && p2.react && p2.q && /Vu/.test(p2.btn), JSON.stringify(p2));
    await domClick("[data-testid=rv-next]");
    await sleep(500);
    const n4 = await page.evaluate(() => document.querySelector("[data-testid=rv-part-title]")?.textContent);
    await page.keyboard.press("ArrowLeft");
    await sleep(500);
    const n3 = await page.evaluate(() => document.querySelector("[data-testid=rv-part-title]")?.textContent);
    await domClick("[data-testid=rv-replay]");
    await sleep(250);
    const midBuild = await page.evaluate(() => {
      const rects = [...document.querySelectorAll(".rv-part-chart svg path, .rv-part-chart svg rect.r4d-drill-mark")];
      return rects.length;
    });
    check("page participant : suivant / précédent (bouton, flèches) et « Revoir l'animation »", n4 === dc.titles[K + 1] && n3 === dc.titles[K] && midBuild > 0, `${n4} ← ${n3}`);
    // iPad / iPhone
    await vp(1024, 768, true);
    await page.evaluate((h2) => (location.hash = h2), `#/r/${P}/${dc.ids[4]}`);
    await sleep(1800);
    await shot("43-participant-ipad-paysage.png");
    await vp(768, 1024, true);
    await page.evaluate((h2) => (location.hash = h2), `#/r/${P}/${dc.ids[1]}`);
    await sleep(1800);
    const ipad = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: window.innerWidth }));
    await shot("44-participant-ipad-portrait.png");
    await vp(390, 844, true);
    await page.evaluate((h2) => (location.hash = h2), `#/r/${P}/${dc.ids[4]}`);
    await sleep(1800);
    const phone = await page.evaluate(() => {
      const svg = document.querySelector(".rv-part-chart svg");
      const vb = svg?.getAttribute("viewBox")?.split(" ").map(Number) ?? [];
      const nav = document.querySelector(".rv-part-nav").getBoundingClientRect();
      const seen = document.querySelector("[data-testid=rv-seen]").getBoundingClientRect();
      return { w: document.documentElement.scrollWidth, vw: window.innerWidth, portrait: vb[3] > vb[2], navBottom: Math.round(nav.bottom), seenH: Math.round(seen.height), shortNext: getComputedStyle(document.querySelector(".rv-next-short")).display !== "none" };
    });
    check("page participant iPhone (390 px) : pas de débordement, graphique en format portrait, barre de navigation en bas, cibles ≥ 44 px", phone.w <= phone.vw + 1 && phone.portrait && phone.navBottom <= 844 && phone.seenH >= 44 && phone.shortNext && ipad.w <= ipad.vw + 1, JSON.stringify({ phone, ipad }));
    await shot("45-participant-iphone.png");
    await page.evaluate(() => (document.querySelector(".rv-scroll-keep").scrollTop = 640));
    await sleep(300);
    await shot("46-participant-iphone-fil.png");
    await vp(1600, 960);
    // mode réunion sur la revue DAF : décision, action, question → action, compte rendu
    await page.evaluate((h2) => (location.hash = h2), `#/revues/${F}/reunion`);
    await page.waitForSelector("[data-testid=rv-meeting-page]");
    await sleep(1200);
    const m0 = await page.evaluate((id) => ({ status: window.r4d.reviewStorage().get(id).status, queue: document.querySelectorAll("[data-testid=rv-queue-item]").length, live: document.querySelectorAll("[data-testid^=rv-live-]").length }), F);
    check("mode réunion : séance démarrée (« En réunion »), « Vu en direct » (6), file de questions", m0.status === "en-reunion" && m0.live === 6 && m0.queue >= 2, JSON.stringify(m0));
    await page.evaluate(() => {
      const i = document.querySelector("[data-testid=rv-item-text]");
      i.value = "Budget Équipements validé tel quel ; revue à fin T1";
    });
    await domClick("[data-testid=rv-item-add]");
    await sleep(300);
    await domClick("[data-testid=rv-q-action]");
    await sleep(500);
    const pre = await page.evaluate(() => ({ text: document.querySelector("[data-testid=rv-item-text]").value, due: !!document.querySelector("[data-testid=rv-item-due]") }));
    await page.evaluate(() => {
      const d = document.querySelector("[data-testid=rv-item-due]");
      d.value = "2026-10-23";
    });
    await domClick("[data-testid=rv-item-add]");
    await sleep(400);
    const m1 = await page.evaluate((id) => {
      const r = window.r4d.reviewStorage().get(id);
      return { items: r.items.map((x) => `${x.kind}:${x.text.slice(0, 30)}:${x.due ?? ""}`), inAction: r.comments.filter((c) => c.status === "en-action").length };
    }, F);
    check("mode réunion : décision ajoutée, question passée en action (texte prérempli, échéance)", m1.items.length === 2 && m1.items[0].startsWith("decision:Budget Équipements") && m1.items[1].startsWith("action:") && m1.items[1].endsWith("2026-10-23") && m1.inAction === 1 && pre.due && pre.text.length > 10, JSON.stringify(m1));
    await page.evaluate(() => (document.querySelector(".rv-scroll-keep").scrollTop = 330));
    await shot("47-reunion.png");
    await domClick("[data-testid=rv-end]");
    await page.waitForSelector("[data-testid=rv-report-page]");
    await sleep(1200);
    const rep = await page.evaluate((id) => ({
      hash: location.hash,
      status: window.r4d.reviewStorage().get(id).status,
      decisions: document.querySelectorAll("[data-testid=rv-report-decision]").length,
      actions: document.querySelectorAll("[data-testid=rv-report-action]").length,
      sections: document.querySelectorAll("[data-testid=rv-report-section]").length,
      reading: document.querySelectorAll("[data-testid=rv-report-reading] tbody tr").length,
      print: !!document.querySelector("[data-testid=rv-report-print]"),
      text: document.querySelector("[data-testid=rv-report-doc]").textContent,
    }), F);
    check("compte rendu : décisions, actions, qui a lu quoi, une section par snapshot, bouton Imprimer / PDF", rep.hash === `#/revues/${F}/compte-rendu` && rep.status === "terminee" && rep.decisions === 1 && rep.actions === 1 && rep.sections === 7 && rep.reading === 6 && rep.print, JSON.stringify({ ...rep, text: undefined }));
    check("compte rendu : vocabulaire sobre, Norvia", !/certifi|conforme|authenticit|preuve/i.test(rep.text) && /Norvia/.test(rep.text), "");
    await shot("48-compte-rendu.png");
    const b64 = await page.evaluate((id) => window.r4d.reviewPptxBase64(id), F);
    const zip = Buffer.from(b64 ?? "", "base64").toString("latin1");
    const slides = new Set(zip.match(/ppt\/slides\/slide\d+\.xml/g) ?? []).size;
    check("compte rendu : export PowerPoint (exporteur du Studio, 9 diapositives, commentaires de séance)", slides === 9 && zip.startsWith("PK"), `${slides} diapositives`);
    // pipeline : compte rendu de la réunion du 8 octobre
    await page.evaluate((h2) => (location.hash = h2), `#/revues/${P}/compte-rendu`);
    await sleep(1500);
    const rp = await page.evaluate(() => ({ d: document.querySelectorAll("[data-testid=rv-report-decision]").length, a: document.querySelectorAll("[data-testid=rv-report-action]").length, k: document.querySelector("[data-testid=rv-kpi-reading]")?.textContent }));
    check("compte rendu pipeline (8 oct.) : 2 décisions, 3 actions, lecture 7/9 → 8/9", rp.d === 2 && rp.a === 3 && /7\/9 → 8\/9/.test(rp.k ?? ""), JSON.stringify(rp));
    await page.evaluate(() => (document.querySelector(".rv-scroll-keep").scrollTop = 900));
    await shot("49-compte-rendu-sections.png");
    // Réinitialiser la démo : la revue DAF revient à « partagée », sans décision
    await page.evaluate((h2) => (location.hash = h2), `#/revues/${F}`);
    await sleep(600);
    await domClick("[data-testid=rv-reset-demo]");
    await sleep(1500);
    const rs = await page.evaluate((id) => { const r = window.r4d.reviewStorage().get(id); return { status: r.status, items: r.items.length, n: window.r4d.reviewStorage().list().length }; }, F);
    check("« Réinitialiser la démo » : revues Norvia rechargées", rs.status === "partagee" && rs.items === 0 && rs.n === 2, JSON.stringify(rs));
    // retour au Studio
    await domClick("[data-testid=rv-back-studio]");
    await sleep(500);
    const back = await page.evaluate(() => ({ hash: location.hash, hidden: document.querySelector("[data-testid=reviews]").hidden, stage: !!document.querySelector(".stage")?.getBoundingClientRect().width }));
    check("retour au Studio (fragment effacé, Studio visible)", back.hash === "" && back.hidden && back.stage, JSON.stringify(back));
  }

  /* 17. Mode lecture (#/lire/…) : lien profond autonome (autre appareil), navigation, iPad / iPhone ; PowerPoint Morph */
  {
    const P = "norvia-pipeline-oct-2026";
    const dc = globalThis.__dircom ?? { ids: [], titles: [] };
    const shotOn = async (pg, name) => {
      if (!SHOTS) return;
      await sleep(250);
      await pg.screenshot({ path: join(shotsDir, name) });
    };
    // a) nouveau contexte (stockage vide) = un autre appareil : le lien de la démo s'ouvre quand même
    const ctx = await browser.createBrowserContext();
    const rd = await ctx.newPage();
    const rdErrors = [];
    rd.on("pageerror", (e) => rdErrors.push("pageerror: " + e.message));
    rd.on("console", (m) => m.type() === "error" && rdErrors.push(m.text()));
    await rd.setViewport({ width: 1440, height: 900, deviceScaleFactor: SHOTS ? 1.5 : 1 });
    await rd.goto(`${origin}${BASE}#/lire/demo-dircom/${dc.ids[2]}`, { waitUntil: "networkidle0" });
    await rd.waitForFunction(() => window.r4d?.reader().isOpen && window.r4d.reader().current, { timeout: 20000 }).catch(() => {});
    await rd.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    await sleep(500);
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(400);
    const rs = () =>
      rd.evaluate(() => ({
        hash: location.hash,
        counter: document.querySelector("[data-testid=reader-counter]")?.textContent,
        id: window.r4d.reader().current?.id,
        playing: window.r4d.reader().isPlaying,
        marks: document.querySelectorAll("[data-testid=reader-svg] .r4d-drill-mark").length,
        cart: !!document.querySelector("[data-testid=reader-svg] .r4d-cartouche .r4d-qr"),
        title: document.querySelector("[data-testid=reader-svg] .r4d-title")?.textContent ?? "",
        comments: document.querySelectorAll("[data-testid=reader-svg] .r4d-comment, [data-testid=reader-svg] .r4d-comments text").length,
        dots: document.querySelectorAll("[data-testid=reader-dots] .film-dot").length,
        on: [...document.querySelectorAll("[data-testid=reader-dots] .film-dot")].findIndex((d) => d.classList.contains("on")),
        stored: (window.r4d.story().snapshots ?? []).length,
        sw: document.documentElement.scrollWidth,
        vw: window.innerWidth,
      }));
    const r0 = await rs();
    check("mode lecture : lien #/lire/demo-dircom/<snapshot 3> ouvert sur un appareil vierge (démo recalculée), diapositive 3/7", r0.counter === "3 / 7" && r0.id === dc.ids[2] && r0.stored === 0 && r0.hash === `#/lire/demo-dircom/${dc.ids[2]}`, JSON.stringify(r0));
    check("mode lecture : titre, commentaires, cartouche (QR), points de progression", r0.title.length > 10 && r0.cart && r0.dots === 7 && r0.on === 2 && r0.comments >= 1, JSON.stringify({ t: r0.title, c: r0.comments, dots: r0.dots }));
    await shotOn(rd, "50-lecture-bureau.png");
    // clavier : → ← Fin Début, espace (pause), R (rejouer)
    const press = async (k, ms = 900) => {
      await rd.keyboard.press(k);
      await sleep(ms);
    };
    await press("ArrowRight");
    const r1 = await rs();
    await press("ArrowLeft");
    const r2 = await rs();
    await press("End");
    const r3 = await rs();
    await press("Home");
    const r4 = await rs();
    check("mode lecture : ←/→, Début/Fin ; lien de la diapositive tenu à jour (#/lire/…/<snapshot>)", r1.counter === "4 / 7" && r1.hash.endsWith(dc.ids[3]) && r2.counter === "3 / 7" && r3.counter === "7 / 7" && r3.hash.endsWith(dc.ids[6]) && r4.counter === "1 / 7", [r1.counter, r2.counter, r3.counter, r4.counter, r3.hash].join(" · "));
    await press("ArrowRight", 300);
    await press(" ", 100);
    const pa = await rs();
    const frozen = await rd.evaluate(() => document.querySelector("[data-testid=reader-svg]").innerHTML.length);
    await sleep(500);
    const frozen2 = await rd.evaluate(() => document.querySelector("[data-testid=reader-svg]").innerHTML.length);
    await press(" ", 200);
    const pl = await rs();
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(300);
    await press("r", 120);
    const rp = await rd.evaluate(() => ({ playing: window.r4d.reader().isPlaying, labels: document.querySelectorAll("[data-testid=reader-svg] .r4d-comment").length }));
    check("mode lecture : pause (espace) fige l'animation, reprise, « Rejouer » (R)", !pa.playing && frozen === frozen2 && pl.playing && rp.playing, JSON.stringify({ pa: pa.playing, pl: pl.playing, frozen: frozen === frozen2 }));
    // transition parent ↔ enfant en mode lecture : → descente (T2 2026 → juin), ← remontée
    await rd.evaluate(() => {
      window.r4d.reader().finishNow();
      window.r4d.drillZoom(true, 4);
    });
    await sleep(300);
    const rdZoom = () => rd.evaluate(() => document.querySelector("[data-testid=reader-svg]").getAttribute("data-zoom"));
    const rdZoomGone = () => rd.waitForFunction(() => !document.querySelector("[data-testid=reader-svg]").hasAttribute("data-zoom"), { timeout: 10000 }).catch(() => {});
    await rd.keyboard.press("ArrowRight");
    await sleep(800);
    const rz1 = await rdZoom();
    if (SHOTS) await rd.screenshot({ path: join(shotsDir, "68-lecture-zoom-descente.png") });
    await rdZoomGone();
    await rd.keyboard.press("ArrowLeft");
    await sleep(800);
    const rz2 = await rdZoom();
    await rd.waitForFunction(() => document.querySelector("[data-testid=reader-svg]").getAttribute("data-zoom") === "out", { timeout: 6000 }).catch(() => {});
    const rz3 = await rdZoom();
    await rdZoomGone();
    const rzEnd = await rs();
    check("mode lecture : → descente « zoom dans la marque », ← remontée (repli puis la barre rétrécit)", rz1 === "in" && rz2 === "fold" && rz3 === "out" && rzEnd.counter === "2 / 7", JSON.stringify({ rz1, rz2, rz3, c: rzEnd.counter }));
    await rd.evaluate(() => window.r4d.drillZoom(true, 1));
    // boutons, points, zones de toucher
    await rd.evaluate(() => document.querySelectorAll("[data-testid=reader-dots] .film-dot")[4].click());
    await sleep(900);
    const d5 = await rs();
    const stageBox = await rd.evaluate(() => { const b = document.querySelector("[data-testid=reader-stage]").getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await rd.mouse.click(stageBox.x + stageBox.w * 0.8, stageBox.y + stageBox.h * 0.5);
    await sleep(900);
    const t6 = await rs();
    await rd.mouse.click(stageBox.x + stageBox.w * 0.1, stageBox.y + stageBox.h * 0.5);
    await sleep(900);
    const t5 = await rs();
    await rd.evaluate(() => document.querySelector("[data-testid=reader-next]").click());
    await sleep(900);
    const b6 = await rs();
    check("mode lecture : points de progression, toucher (droite = suivant, tiers gauche = précédent), boutons", d5.counter === "5 / 7" && t6.counter === "6 / 7" && t5.counter === "5 / 7" && b6.counter === "6 / 7", [d5.counter, t6.counter, t5.counter, b6.counter].join(" · "));
    // iPad paysage : balayage
    await rd.setViewport({ width: 1024, height: 768, deviceScaleFactor: SHOTS ? 1.5 : 1, isMobile: true, hasTouch: true });
    await rd.evaluate((h2) => (location.hash = h2), `#/lire/demo-dircom/${dc.ids[1]}`);
    await sleep(1200);
    const swipe = async (dx) => {
      const y = 380;
      const x0 = dx < 0 ? 760 : 260;
      await rd.touchscreen.touchStart(x0, y);
      for (let k = 1; k <= 6; k++) await rd.touchscreen.touchMove(x0 + (dx * k) / 6, y + k);
      await rd.touchscreen.touchEnd();
      await sleep(1000);
    };
    const i0 = await rs();
    await swipe(-320);
    const i1 = await rs();
    await swipe(320);
    const i2 = await rs();
    check("iPad : lien profond (hashchange), balayage gauche = suivant, droite = précédent", i0.counter === "2 / 7" && i1.counter === "3 / 7" && i2.counter === "2 / 7", [i0.counter, i1.counter, i2.counter].join(" · "));
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(500);
    await shotOn(rd, "51-lecture-ipad-paysage.png");
    // iPad portrait : démo financière, format portrait
    await rd.setViewport({ width: 768, height: 1024, deviceScaleFactor: SHOTS ? 1.5 : 1, isMobile: true, hasTouch: true });
    await rd.evaluate(() => (location.hash = "#/lire/demo-daf"));
    await sleep(1000);
    await rd.evaluate(() => window.r4d.reader().goTo(4));
    await sleep(1400);
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(500);
    const pp = await rd.evaluate(() => { const vb = document.querySelector("[data-testid=reader-svg]").viewBox.baseVal; return { w: vb.width, h: vb.height, id: window.r4d.reader().current?.id, hash: location.hash, sw: document.documentElement.scrollWidth, vw: window.innerWidth, foot: document.querySelector("[data-testid=reader-next]").getBoundingClientRect().bottom <= window.innerHeight }; });
    check("iPad portrait : démo DAF (lien autonome), graphique en format portrait, commandes visibles, pas de défilement horizontal", /^daf-05-/.test(pp.id ?? "") && pp.hash === `#/lire/demo-daf/${pp.id}` && pp.h > pp.w && pp.sw <= pp.vw && pp.foot, JSON.stringify(pp));
    await shotOn(rd, "52-lecture-ipad-portrait.png");
    await rd.setViewport({ width: 390, height: 844, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
    await rd.evaluate((h2) => (location.hash = h2), `#/lire/demo-dircom/${dc.ids[5]}`);
    await sleep(1400);
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(600);
    const ph = await rs();
    const phBtn = await rd.evaluate(() => Math.min(...[...document.querySelectorAll("[data-testid=reader] .film-btn")].map((b) => b.getBoundingClientRect().width)));
    check("iPhone : diapositive 6/7, cibles tactiles ≥ 44 px, pas de défilement horizontal", ph.counter === "6 / 7" && ph.sw <= ph.vw && phBtn >= 44, JSON.stringify({ c: ph.counter, sw: ph.sw, vw: ph.vw, phBtn }));
    await shotOn(rd, "53-lecture-iphone.png");
    // histoire locale d'un autre appareil : message explicite
    await rd.setViewport({ width: 1024, height: 768, deviceScaleFactor: SHOTS ? 1.5 : 1 });
    await rd.evaluate(() => (location.hash = "#/lire/histoire/xyz"));
    await sleep(900);
    const nf = await rd.evaluate(() => ({ msg: document.querySelector("[data-testid=reader-msg]")?.textContent ?? "", hidden: document.querySelector("[data-testid=reader-msg]")?.hidden }));
    check("lien vers une histoire locale absente : message « introuvable sur cet appareil » + liens vers les démos", !nf.hidden && /introuvable sur cet appareil/.test(nf.msg) && /Directeur commercial/.test(nf.msg), nf.msg.slice(0, 80));
    await shotOn(rd, "54-lecture-introuvable.png");
    check("mode lecture (autre appareil) : zéro erreur console", rdErrors.length === 0, rdErrors.slice(0, 3).join(" | "));
    await ctx.close();

    // b) revue Norvia : bouton « Mode lecture », Échap → retour à la revue
    await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: SHOTS ? 1.5 : 1 });
    await page.evaluate((h2) => (location.hash = h2), `#/revues/${P}`);
    await page.waitForSelector("[data-testid=rv-read]", { timeout: 10000 });
    await domClick("[data-testid=rv-read]");
    await sleep(1200);
    const rv = await page.evaluate(() => ({ open: window.r4d.reader().isOpen, hash: location.hash, counter: document.querySelector("[data-testid=reader-counter]")?.textContent }));
    await page.keyboard.press("Escape");
    await sleep(600);
    const rvBack = await page.evaluate(() => ({ open: window.r4d.reader().isOpen, hash: location.hash, rv: !document.querySelector("[data-testid=reviews]").hidden }));
    check("revue Norvia : « Mode lecture » (#/lire/<revue>/…), Échap → retour à la revue", rv.open && rv.hash.startsWith(`#/lire/${P}/`) && rv.counter === "1 / 7" && !rvBack.open && rvBack.hash === `#/revues/${P}` && rvBack.rv, JSON.stringify({ rv, rvBack }));
    // page participant : « Mode lecture » à partir du snapshot affiché
    await page.evaluate((h2) => (location.hash = h2), `#/r/${P}/${dc.ids[3]}`);
    await page.waitForSelector("[data-testid=rv-part-read]", { timeout: 10000 });
    await domClick("[data-testid=rv-part-read]");
    await sleep(1200);
    const pr = await page.evaluate(() => ({ hash: location.hash, counter: document.querySelector("[data-testid=reader-counter]")?.textContent }));
    await domClick("[data-testid=reader-close]");
    await sleep(500);
    const prBack = await page.evaluate(() => location.hash);
    check("page participant : « Mode lecture » sur le snapshot courant, fermeture → page participant", pr.hash === `#/lire/${P}/${dc.ids[3]}` && pr.counter === "4 / 7" && prBack === `#/r/${P}/${dc.ids[3]}`, JSON.stringify({ pr, prBack }));
    await page.evaluate(() => (location.hash = ""));
    await sleep(500);

    // c) Studio : histoire = démo pipeline → « Mode lecture » ouvre le lien universel ; PowerPoint Morph
    await page.evaluate((id) => {
      const r = window.r4d.reviewStorage().get(id);
      window.r4d.store.setStory({ title: "Revue du pipeline — octobre 2026", snapshots: r.snapshots, sameScale: false });
    }, P);
    await sleep(400);
    await domClick("[data-testid=story-read]");
    await sleep(1000);
    const st = await page.evaluate(() => ({ hash: location.hash, open: window.r4d.reader().isOpen }));
    await page.keyboard.press("Escape");
    await sleep(500);
    check("Studio : « Mode lecture » de l'histoire (démo pipeline) → #/lire/demo-dircom/…", st.open && st.hash.startsWith("#/lire/demo-dircom/"), st.hash);
    const JSZip = createRequire(join(repo, "package.json"))("jszip");
    const t0 = Date.now();
    const m64 = await page.evaluate(() => window.r4d.pptxBase64({ morph: true, build: true }));
    const mms = Date.now() - t0;
    const mz = await JSZip.loadAsync(Buffer.from(m64, "base64"));
    const sl = Object.keys(mz.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const xs = await Promise.all(sl.map((x) => mz.file(x).async("string")));
    const rels = await Promise.all(sl.map((x) => mz.file(x.replace("slides/", "slides/_rels/") + ".rels").async("string")));
    const morphN = xs.filter((x) => x.includes("<p159:morph") && /<mc:Fallback><p:transition[^>]*><p:fade\/>/.test(x)).length;
    const bars = xs.map((x) => (x.match(/name="!!barre:/g) ?? []).length);
    const namesOf = (x) => [...x.matchAll(/name="(!![^"]+)"/g)].map((m) => m[1]);
    const dup = xs.some((x) => { const n = namesOf(x); return new Set(n).size !== n.length; });
    // amorce (3) → complet (4) : mêmes noms de barres ; zoom : !!zoom-0 sur 4 et 5
    const pairOk = namesOf(xs[2]).filter((n) => n.startsWith("!!barre")).every((n) => namesOf(xs[3]).includes(n)) && namesOf(xs[3]).includes("!!zoom-0") && namesOf(xs[4]).includes("!!zoom-0");
    const linkOk = dc.ids.every((id) => rels.some((r) => r.includes(`https://alteridea-dashboard.web.app/reporting/#/lire/demo-dircom/${id}`)));
    check(`PowerPoint Morph : 16 diapositives (amorce + complet par snapshot), Morph + repli fondu sur 15, barres natives « !! » appariées, zoom, liens de lecture (${(mms / 1000).toFixed(1)} s)`, sl.length === 16 && morphN === 15 && !xs[0].includes("p159") && bars[3] > 3 && !dup && pairOk && linkOk, JSON.stringify({ n: sl.length, morphN, bars, dup, pairOk, linkOk }));
    const c64 = await page.evaluate(() => window.r4d.pptxBase64());
    const cz = await JSZip.loadAsync(Buffer.from(c64, "base64"));
    const cx = await cz.file("ppt/slides/slide3.xml").async("string");
    const cr = await cz.file("ppt/slides/_rels/slide3.xml.rels").async("string");
    check("PowerPoint classique : sans transition ni « !! », image et pied de page liés au mode lecture", !cx.includes("p159") && !cx.includes('name="!!') && cr.includes(`#/lire/demo-dircom/${dc.ids[0]}`) && Object.keys(cz.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length === 9, cr.match(/#\/lire\/[^"]+/)?.[0] ?? "");
  }

  /* 18. Pont Cadencer : manifestes publiés (index, 4 manifestes, PNG 1600 × 900), fenêtre « Envoyer vers Cadencer » */
  {
    const req = createRequire(import.meta.url);
    const { PNG } = req("pngjs");
    const PUB = "https://alteridea-dashboard.web.app/reporting/publie/";
    const shotOn = async (pg, name) => {
      if (!SHOTS) return;
      await sleep(250);
      await pg.screenshot({ path: join(shotsDir, name) });
    };
    const idx = await page.evaluate(async (b) => {
      const r = await fetch(`${b}publie/index.json`);
      return { type: r.headers.get("content-type"), json: await r.json() };
    }, BASE);
    const ids = (idx.json.revues ?? []).map((r) => r.id);
    check("index.json : 4 revues publiées (démos + revues Norvia), adresses absolues issues de la base unique", /application\/json/.test(idx.type) && idx.json.format === "datanime-index" && ids.join() === "demo-dircom,demo-daf,norvia-pipeline-oct-2026,norvia-budget-2026" && idx.json.revues.every((r) => r.manifeste === `${PUB}${r.id}/manifeste.json` && /^[0-9a-f]{64}$/.test(r.empreinte) && r.nb_snapshots === 7 && !!r.genere_le), JSON.stringify(ids));
    const bad = [];
    let nImg = 0;
    for (const id of ids) {
      const m = await page.evaluate(async (b, x) => (await fetch(`${b}publie/${x}/manifeste.json`)).json(), BASE, id);
      const issues = await page.evaluate((mm) => window.r4d.validateManifest(mm), m);
      if (issues) bad.push(`${id}: ${issues.join(";")}`);
      if (m.snapshots.length !== 7 || m.lien_lecture !== `https://alteridea-dashboard.web.app/reporting/#/lire/${id}`) bad.push(`${id}: ${m.snapshots.length} snapshots, ${m.lien_lecture}`);
      const notes = m.snapshots.filter((s) => s.commentaire_animateur).length;
      if (id.startsWith("demo-") && (notes < 2 || notes > 3)) bad.push(`${id}: ${notes} notes d'animateur`);
      for (const s of m.snapshots) {
        if (!s.image_png.endsWith(`?v=${s.empreinte.slice(0, 12)}`)) bad.push(`version ${s.id}`);
        if (!s.alt || s.a_retenir.includes(s.commentaire_genere) || s.commentaire_genere === s.a_retenir.join(" ")) bad.push(`textes ${s.id}`);
        const f = join(dist, "publie", s.image_png.slice(PUB.length).split("?")[0]);
        if (!existsSync(f)) { bad.push(`absent ${f}`); continue; }
        const png = PNG.sync.read(readFileSync(f));
        if (png.width !== 1600 || png.height !== 900) bad.push(`${f}: ${png.width}×${png.height}`);
        if (!s.image_svg || !existsSync(join(dist, "publie", s.image_svg.slice(PUB.length).split("?")[0]))) bad.push(`svg ${s.id}`);
        nImg++;
      }
    }
    check(`4 manifestes valides (schéma Zod 1.1 : ?v=empreinte, alt, synthèse ≠ puces, notes des démos), ${nImg} PNG 1600 × 900 + SVG présents`, !bad.length && nImg === 28, bad.slice(0, 3).join(" | "));
    // Histoire = démo « Directeur commercial » complète → URL du manifeste publié
    await page.evaluate(() => window.r4d.store.setUi({ openSections: { ...window.r4d.store.state.ui.openSections, histoire: true } }));
    await domClick("[data-testid=story-cadencer]");
    await page.waitForSelector("[data-testid=cadencer-dialog]:not([hidden]) [data-testid=cad-url]", { timeout: 5000 }).catch(() => {});
    const d1 = await page.evaluate(() => ({ url: document.querySelector("[data-testid=cad-url]")?.textContent, instr: document.querySelector("[data-testid=cad-instr]")?.textContent, json: document.querySelector("[data-testid=cad-open-json]")?.getAttribute("href") }));
    check("Histoire (démo complète) › Envoyer vers Cadencer : URL du manifeste publié + marche à suivre", d1.url === `${PUB}demo-dircom/manifeste.json` && d1.json === d1.url && d1.instr === "Dans Cadencer : ordre du jour › Ajouter › Revue Datanime › coller l'URL", JSON.stringify(d1));
    await shotOn(page, "55-cadencer-histoire.png");
    await domClick("[data-testid=cad-close]");
    // Revue Norvia → même fenêtre, manifeste de la revue
    await page.evaluate(() => (location.hash = "#/revues/norvia-pipeline-oct-2026"));
    await sleep(800);
    await domClick("[data-testid=rv-cadencer]");
    await page.waitForSelector("[data-testid=cadencer-dialog]:not([hidden]) [data-testid=cad-url]", { timeout: 5000 }).catch(() => {});
    const d2 = await page.evaluate(() => ({ url: document.querySelector("[data-testid=cad-url]")?.textContent, note: document.querySelector("[data-testid=cad-note]")?.textContent ?? "", top: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("[data-testid=cadencer-dialog]") != null }));
    check("Revues › Envoyer vers Cadencer : manifeste de la revue Norvia, au-dessus de l'espace Revues", d2.url === `${PUB}norvia-pipeline-oct-2026/manifeste.json` && /démonstration d'origine/.test(d2.note) && d2.top, JSON.stringify(d2));
    await shotOn(page, "56-cadencer-revue.png");
    await page.keyboard.press("Escape");
    await sleep(200);
    const closed = await page.evaluate(() => document.querySelector("[data-testid=cadencer-dialog]").hidden);
    await domClick("[data-testid=rv-back-studio]");
    await sleep(500);
    // Histoire locale (2 snapshots seulement) → « Télécharger le manifeste » (images intégrées)
    const saved = await page.evaluate(() => JSON.stringify(window.r4d.story()));
    await page.evaluate(() => { const st = window.r4d.story(); window.r4d.store.setStory({ ...st, title: "Pipeline : deux constats", snapshots: st.snapshots.slice(0, 2) }); });
    await sleep(300);
    await domClick("[data-testid=story-cadencer]");
    await page.waitForSelector("[data-testid=cadencer-dialog]:not([hidden]) [data-testid=cad-download]", { timeout: 5000 }).catch(() => {});
    const d3 = await page.evaluate(() => ({ url: !!document.querySelector("[data-testid=cadencer-dialog] [data-testid=cad-url]"), local: document.querySelector("[data-testid=cad-local-note]")?.textContent ?? "", note: document.querySelector("[data-testid=cad-note]")?.textContent ?? "" }));
    check("histoire locale : pas d'URL, « Télécharger le manifeste », publication en ligne à venir, renvoi vers la démo publiée", !d3.url && /enregistrement en ligne/.test(d3.local) && d3.note.includes(`${PUB}demo-dircom/manifeste.json`), JSON.stringify(d3));
    await shotOn(page, "57-cadencer-local.png");
    const before = readdirSync(dl);
    await domClick("[data-testid=cad-download]");
    const jf = await waitDownload(".json", before);
    let d4 = { file: !!jf };
    if (jf) {
      await sleep(300);
      const m = JSON.parse(readFileSync(jf, "utf8"));
      const issues = await page.evaluate((mm) => window.r4d.validateManifest(mm), m);
      const png = PNG.sync.read(Buffer.from(m.snapshots[0].image_png.split(",")[1], "base64"));
      d4 = { name: jf.split("/").pop(), issues, id: m.id, n: m.snapshots.length, w: png.width, h: png.height, svg: "image_svg" in m.snapshots[0], lien: m.snapshots[1].lien_lecture, lienRevue: m.lien_lecture, maxImg: Math.max(...m.snapshots.map((s) => s.image_png.length)), bytes: statSync(jf).size, alt: !!m.snapshots[0].alt };
    }
    check("manifeste téléchargé : schéma valide, 2 snapshots, PNG intégrés (≤ 800 000 caractères, fichier ≤ 12 Mo), sans SVG, liens de lecture null", d4.issues === null && /^histoire-[0-9a-f]{10}$/.test(d4.id) && d4.n === 2 && d4.w >= 640 && d4.w * 9 === d4.h * 16 && !d4.svg && d4.lien === null && d4.lienRevue === null && d4.maxImg <= 800000 && d4.bytes <= 12000000 && d4.alt && /^datanime-manifeste-histoire-/.test(d4.name), JSON.stringify(d4));
    if (jf) {
      // limite des images intégrées : une image trop lourde est réduite (paliers puis palette réduite)
      const m = JSON.parse(readFileSync(jf, "utf8"));
      const fit = await page.evaluate(async (u) => {
        const r = await window.r4d.fitPng(u, 120000);
        return { len: r.png.length, w: r.w, from: u.length };
      }, m.snapshots[0].image_png);
      check("manifeste téléchargé : image au-delà du budget réduite sous la limite", fit.len <= 120000 && fit.w < 1600, JSON.stringify(fit));
    }
    await domClick("[data-testid=cad-close]");
    await page.evaluate((j) => window.r4d.store.setStory(JSON.parse(j)), saved);
    check("fenêtre Cadencer : Échap ferme", closed);
    // iPhone : fenêtre en feuille basse, sans débordement horizontal
    const ctx = await browser.createBrowserContext();
    const ph = await ctx.newPage();
    await ph.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ph.goto(`${origin}${BASE}#/revues/norvia-budget-2026`, { waitUntil: "networkidle0" });
    await ph.waitForSelector("[data-testid=rv-cadencer]", { timeout: 15000 }).catch(() => {});
    await ph.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    await ph.evaluate(() => document.querySelector("[data-testid=rv-cadencer]")?.click());
    await ph.waitForSelector("[data-testid=cadencer-dialog]:not([hidden]) [data-testid=cad-url]", { timeout: 8000 }).catch(() => {});
    const d5 = await ph.evaluate(() => {
      const dlg = document.querySelector(".cad-dialog")?.getBoundingClientRect();
      const btn = document.querySelector("[data-testid=cad-copy]")?.getBoundingClientRect();
      return { url: document.querySelector("[data-testid=cad-url]")?.textContent, sw: document.documentElement.scrollWidth, vw: innerWidth, right: dlg ? Math.round(dlg.right) : -1, btnH: btn ? Math.round(btn.height) : 0 };
    });
    check("iPhone : fenêtre Cadencer lisible (URL entière, bouton Copier ≥ 44 px, pas de débordement)", d5.url === `${PUB}norvia-budget-2026/manifeste.json` && d5.sw <= d5.vw && d5.right <= d5.vw && d5.btnH >= 44, JSON.stringify(d5));
    await shotOn(ph, "58-cadencer-iphone.png");
    await ctx.close();
  }

  /* 19. Infobulles (survol, toucher, clavier) sur toutes les marques + iPad sans débordement horizontal */
  {
    const P = "norvia-pipeline-oct-2026";
    const dc = globalThis.__dircom ?? { ids: [], titles: [] };
    const shotOn = async (pg, name) => {
      if (!SHOTS) return;
      await sleep(150);
      await pg.screenshot({ path: join(shotsDir, name) });
    };
    /** Survole le centre (ou un point relatif) d'un élément et lit l'infobulle affichée. */
    const hoverTip = async (pg, sel, fy = 0.5) => {
      const box = await pg.evaluate((s, f) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        const hits = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); };
        const p0 = { x: r.left + r.width / 2, y: r.top + Math.max(2, r.height * f) };
        if (hits(p0.x, p0.y)) return p0;
        // forme non rectangulaire (segment d'anneau) : premier point de la grille qui touche la marque
        for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { const x = r.left + (r.width * i) / 10; const y = r.top + (r.height * j) / 10; if (hits(x, y)) return { x, y }; }
        return p0;
      }, sel, fy);
      if (!box) return { text: null, sel };
      await pg.mouse.move(box.x - 40, box.y - 40);
      await pg.mouse.move(box.x, box.y, { steps: 3 });
      await sleep(180);
      return pg.evaluate(() => {
        const t = document.querySelector("[data-testid=chart-tip]");
        if (!t || t.hidden || !t.isConnected) return { text: null };
        const r = t.getBoundingClientRect();
        return { text: t.innerText.replace(/[\u00a0\u202f]/g, " ").replace(/\n+/g, " | "), tones: [...t.querySelectorAll("dd[class^=tone-]")].map((d) => d.className), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, bg: getComputedStyle(t).backgroundColor };
      });
    };
    await page.setViewport({ width: 1600, height: 960, deviceScaleFactor: SHOTS ? 1.5 : 1 });
    await page.evaluate(() => (location.hash = ""));
    await page.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    await page.evaluate(() => window.r4d.loadSample("ventes"));
    await sleep(700);
    await page.evaluate(() => window.r4d.seek(1));
    const b1 = await hoverTip(page, "[data-testid=chart-svg] .r4d-marks rect", 0.6);
    check("infobulle : survol d'une barre → catégorie, valeur en M€, part du total (fond pétrole, dans la fenêtre)", /^Île-de-France \| 7,6 M€ \| Part du total \| 35 %/.test(b1.text ?? "") && b1.inside && b1.bg === "rgb(8, 70, 90)", JSON.stringify(b1));
    if (SHOTS) await page.screenshot({ path: join(shotsDir, "59-infobulle-barre.png"), clip: { x: 200, y: 120, width: 1100, height: 620 } });
    // pas de <title> natif (double infobulle) ; exports sans attribut d'infobulle
    const clean = await page.evaluate(async () => {
      const svg = await window.r4d.currentSvg();
      return { native: document.querySelectorAll("[data-testid=chart-svg] .r4d-marks title").length, tip: /data-tip|tabindex|aria-describedby/.test(svg), len: svg.length };
    });
    check("infobulle : jamais dans l'export (SVG / PNG / PowerPoint / film) ni en double avec l'infobulle native", clean.native === 0 && !clean.tip && clean.len > 1000, JSON.stringify(clean));
    // bord droit : l'infobulle bascule à gauche du curseur
    const edge = await hoverTip(page, "[data-testid=chart-svg] .r4d-marks rect:last-of-type", 0.6);
    check("infobulle : reste dans la fenêtre près du bord", edge.inside && !!edge.text, JSON.stringify(edge));
    // ligne : points
    await page.evaluate(() => window.r4d.pickType("line"));
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(1));
    const ln = await hoverTip(page, "[data-testid=chart-svg] .r4d-marks circle");
    check("infobulle : point d'une courbe", !!ln.text && /M€/.test(ln.text), JSON.stringify(ln));
    await page.evaluate(() => window.r4d.pickType("donut"));
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(1));
    const dn = await hoverTip(page, "[data-testid=chart-svg] .r4d-marks path", 0.2);
    check("infobulle : segment d'anneau (part du total)", /Part du total \| \d/.test(dn.text ?? ""), JSON.stringify(dn));
    // une marque par type de graphique : l'infobulle s'affiche partout
    const perType = [];
    for (const [sample, type, sel] of [
      ["ventes", "bar", "[data-testid=chart-svg] .r4d-marks rect[data-tip]"],
      ["ventes", "barH", "[data-testid=chart-svg] .r4d-marks rect[data-tip]"],
      ["business-review", "groupedBar", "[data-testid=chart-svg] [data-tip]"],
      ["business-review", "stackedBar", "[data-testid=chart-svg] [data-tip]"],
      ["ventes", "line", "[data-testid=chart-svg] .r4d-marks circle[data-tip]"],
      ["ventes", "area", "[data-testid=chart-svg] .r4d-marks circle[data-tip]"],
      ["business-review", "stackedArea", "[data-testid=chart-svg] [data-tip]"],
      ["pipeline", "scatter", "[data-testid=chart-svg] .r4d-marks circle[data-tip]"],
      ["ventes", "pie", "[data-testid=chart-svg] .r4d-marks path[data-tip]"],
      ["ventes", "donut", "[data-testid=chart-svg] .r4d-marks path[data-tip]"],
      ["ventes", "radialBar", "[data-testid=chart-svg] .r4d-mark[data-tip]"],
      ["business-review", "variance", "[data-testid=chart-svg] [data-tip]"],
      ["revue-mensuelle-norme", null, "[data-testid=chart-svg] .r4d-scn-AC[data-tip]"],
      ["pipeline", "map", "[data-testid=special-host] .smv-map-region[data-tip]:not(.smv-map-region--bg)"],
    ]) {
      await page.evaluate((sm) => window.r4d.loadSample(sm), sample);
      await sleep(500);
      if (type) await page.evaluate((t) => window.r4d.pickType(t), type);
      await sleep(600);
      if (type === "map") await page.waitForFunction(() => document.querySelectorAll("[data-testid=special-host] .smv-map-region").length > 3, { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => window.r4d.seek(1));
      await sleep(type === "map" ? 1500 : 150);
      const r = await hoverTip(page, sel);
      perType.push(`${type ?? "norme"}:${r.text ? "ok" : "AUCUNE"}${r.text ? "" : ` (${sel})`}`);
    }
    check("infobulle sur une marque de CHAQUE type (barres, horizontales, groupées, empilées, lignes, aires, nuage, camembert, anneau, arcs radiaux, écarts, norme, carte)", perType.every((x) => /:ok$/.test(x)), perType.join(" · "));
    await page.evaluate(() => window.r4d.pickType("bar"));
    await sleep(300);

    // exploration (démo pipeline) : trimestre, carte, détail
    await page.evaluate(() => window.r4d.loadSample("demo-pipeline"));
    await sleep(800);
    await page.evaluate(() => window.r4d.seek(1));
    const q = await hoverTip(page, '[data-testid=chart-svg] .r4d-drill-bar[data-focus="1"] .r4d-drill-mark', 0.5);
    check("exploration : barre T2 2026 → valeur, part, nombre d'opportunités, écart coloré vs T1, « Cliquer pour zoomer »", /^T2 2026/.test(q.text ?? "") && /opportunités/.test(q.text) && /Part de la période affichée/.test(q.text) && /vs T1 2026 \| −[\d ,]+ (k€|M€) · −3,8 %/.test(q.text) && q.tones?.includes("tone-neg") && /Cliquer pour zoomer/.test(q.text), JSON.stringify(q));
    if (SHOTS) await shotOn(page, "60-infobulle-exploration.png");
    await page.evaluate(() => window.r4d.seek(1));
    await sleep(120);
    // clavier : focus sur la première marque, flèche → suivante, Entrée → zoom
    const k1 = await page.evaluate(() => {
      const first = document.querySelector('[data-testid=chart-svg] [data-tip][tabindex="0"]');
      first?.focus();
      const t = document.querySelector("[data-testid=chart-tip]");
      return { ok: !!first, n: document.querySelectorAll('[data-testid=chart-svg] [data-tip][tabindex="0"]').length, label: first?.getAttribute("aria-label") ?? "", shown: !!t && !t.hidden && t.isConnected };
    });
    await page.keyboard.press("ArrowRight");
    await sleep(120);
    const k2 = await page.evaluate(() => ({ key: document.activeElement?.getAttribute("data-drill-key"), tip: document.querySelector("[data-testid=chart-tip]")?.innerText ?? "" }));
    const before = await page.evaluate(() => window.r4d.drill().path.length);
    await page.keyboard.press("Enter");
    await sleep(500);
    const after = await page.evaluate(() => window.r4d.drill().path.length);
    check("infobulle au clavier : une seule marque dans la tabulation (itinérant), libellé lisible, flèches, Entrée = explorer", k1.ok && k1.n === 1 && k1.shown && /Cliquer pour zoomer/.test(k1.label) && !!k2.key && k2.tip.length > 0 && after === before + 1, JSON.stringify({ k1, k2, before, after }));
    await page.keyboard.press("Escape");
    await domClick("[data-testid=drill-crumb-0]");
    await sleep(400);
    await domClick("[data-testid=drill-view-map]");
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(1));
    const mp = await hoverTip(page, '[data-testid=chart-svg] .r4d-drill-region[data-drill-value="Wallonie"]');
    check("carte : région → valeur, part du total, nombre, « Cliquer pour détailler « Wallonie » par période »", /^Wallonie/.test(mp.text ?? "") && /Part du total/.test(mp.text) && /opportunit/.test(mp.text) && /Cliquer pour détailler « Wallonie »/.test(mp.text), JSON.stringify(mp));
    if (SHOTS) await shotOn(page, "61-infobulle-carte.png");
    await domClick("[data-testid=drill-view-history]");
    await sleep(500);
    await page.evaluate(() => window.r4d.seek(1));
    const hi = await hoverTip(page, "[data-testid=chart-svg] .r4d-drill-panel .r4d-drill-mark");
    check("historique : barre d'un petit multiple (région · mois)", / · /.test(hi.text ?? "") && /Part de la série/.test(hi.text), JSON.stringify(hi));

    // cascade, mois (versions), tableau croisé (démo finance)
    await page.evaluate(() => window.r4d.loadSample("demo-finance"));
    await sleep(800);
    await page.evaluate(() => window.r4d.seek(1));
    const cf = await hoverTip(page, '[data-testid=chart-svg] .r4d-drill-bridge-item[data-drill-value="Plateforme"] .r4d-drill-mark');
    check("cascade : marche Plateforme → impact signé, Réel 2025 / Budget 2026, poids dans les écarts, hausse des coûts en rouge, « détailler par … »", /^Plateforme \| Impact sur le résultat \| \+2,1 M€/.test(cf.text ?? "") && /Réel 2025/.test(cf.text) && /Budget 2026/.test(cf.text) && /Poids dans les écarts \| \d/.test(cf.text) && /dont coûts \| −0,5 M€/.test(cf.text) && cf.tones?.includes("tone-neg") && /Cliquer pour détailler par/.test(cf.text), JSON.stringify(cf));
    if (SHOTS) await shotOn(page, "62-infobulle-cascade.png");
    const end = await hoverTip(page, ".r4d-drill-bridge-end .r4d-drill-mark");
    check("cascade : total d'arrivée → écart vs Réel 2025 (−2,2 % : stable sous ±3 %, gris)", /Point d'arrivée/.test(end.text ?? "") && /vs Réel 2025 \| −0,4 M€ · −2,2 %/.test(end.text) && end.tones?.includes("tone-neutral"), JSON.stringify(end));
    await domClick("[data-testid=drill-view-compare]");
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(1));
    const cmp = await hoverTip(page, "[data-testid=chart-svg] .r4d-drill-month-hit");
    check("mois Réel 2025 vs Budget 2026 : colonne d'un mois → deux versions et écart coloré", /Réel 2025/.test(cmp.text ?? "") && /Budget 2026/.test(cmp.text) && /Écart/.test(cmp.text) && cmp.tones?.length > 0, JSON.stringify(cmp));
    await domClick("[data-testid=drill-view-pivot]");
    await sleep(600);
    await page.evaluate(() => window.r4d.seek(1));
    const pv = await hoverTip(page, "[data-testid=chart-svg] .r4d-drill-pivot-key .r4d-drill-mark");
    check("tableau croisé : cellule → série, écart signé, sens coloré", /· écart \| [−+]/.test(pv.text ?? "") && /Sens \| (baisse|hausse)/.test(pv.text) && pv.tones?.some((x) => x === "tone-neg" || x === "tone-pos"), JSON.stringify(pv));

    // iPad (toucher) : 1er toucher = infobulle (pas de zoom), 2e toucher = zoom ; aucune barre de défilement horizontale
    const ctx = await browser.createBrowserContext();
    const ip = await ctx.newPage();
    await ip.setViewport({ width: 1180, height: 820, deviceScaleFactor: SHOTS ? 1.5 : 1, isMobile: true, hasTouch: true });
    await ip.goto(`${origin}${BASE}`, { waitUntil: "networkidle0" });
    await ip.addStyleTag({ content: "[data-testid=toasts]{display:none!important}" });
    await ip.evaluate(() => window.r4d.loadSample("demo-pipeline"));
    await sleep(900);
    await ip.evaluate(() => window.r4d.seek(1));
    const tapAt = async (sel) => {
      const b = await ip.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.6 } : null; }, sel);
      if (b) await ip.touchscreen.tap(b.x, b.y);
      await sleep(450);
    };
    const tsel = '[data-testid=chart-svg] .r4d-drill-bar[data-focus="1"] .r4d-drill-mark';
    await tapAt(tsel);
    const t1 = await ip.evaluate(() => ({ path: window.r4d.drill().path.length, tip: (() => { const t = document.querySelector("[data-testid=chart-tip]"); return t && !t.hidden && t.isConnected ? t.innerText : ""; })() }));
    await shotOn(ip, "63-infobulle-ipad-toucher.png");
    await tapAt(tsel);
    const t2 = await ip.evaluate(() => window.r4d.drill().path.length);
    check("iPad : 1er toucher sur une barre → infobulle sans zoom ; 2e toucher → zoom", t1.path === 0 && /Cliquer pour zoomer/.test(t1.tip) && t2 === 1, JSON.stringify({ t1, t2 }));
    const widths = [];
    for (const [w, h] of [[1366, 1024], [1180, 820], [1024, 768]]) {
      await ip.setViewport({ width: w, height: h, deviceScaleFactor: SHOTS ? 1.5 : 1, isMobile: true, hasTouch: true });
      await sleep(500);
      const o = await ip.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        bw: document.body.scrollWidth,
        vw: innerWidth,
        right: Math.round(document.querySelector(".panel-right")?.getBoundingClientRect().right ?? 0),
        tb: (() => { const t = document.querySelector(".toolbar"); return t ? t.scrollWidth - t.clientWidth : -1; })(),
        story: (() => { const s = document.querySelector(".story-bar"); return s ? s.scrollWidth - s.clientWidth : 0; })(),
      }));
      widths.push({ w, ...o });
      if (w === 1366) await shotOn(ip, "64-ipad-1366-sans-debordement.png");
    }
    check("iPad 1366 / 1180 / 1024 px : aucun débordement horizontal (page, panneau de réglages entier, barre d'outils, histoire)", widths.every((o) => o.sw <= o.vw && o.bw <= o.vw && o.right <= o.vw && o.tb <= 1 && o.story <= 1), JSON.stringify(widths));
    await ctx.close();

    // mode lecture : infobulle au survol ; film : aucune infobulle
    const rctx = await browser.createBrowserContext();
    const rd = await rctx.newPage();
    await rd.setViewport({ width: 1366, height: 1024, deviceScaleFactor: SHOTS ? 1.5 : 1 });
    await rd.goto(`${origin}${BASE}#/lire/demo-dircom/${dc.ids[0] ?? ""}`, { waitUntil: "networkidle0" });
    await sleep(1500);
    await rd.evaluate(() => window.r4d.reader().finishNow());
    await sleep(400);
    const rt = await hoverTip(rd, "[data-testid=reader-svg] .r4d-drill-bar .r4d-drill-mark");
    const counter = await rd.evaluate(() => document.querySelector("[data-testid=reader-counter]")?.textContent);
    check("mode lecture : infobulle au survol d'une barre (sans « Cliquer pour zoomer » : le clic y fait défiler)", /opportunit/.test(rt.text ?? "") && !/Cliquer/.test(rt.text) && counter === "1 / 7", JSON.stringify({ rt, counter }));
    await shotOn(rd, "65-infobulle-lecture.png");
    await rd.evaluate(() => window.r4d.reader().close?.());
    await rd.evaluate(() => (location.hash = ""));
    await sleep(500);
    await rd.evaluate(() => window.r4d.loadSample("demo-pipeline"));
    await sleep(600);
    await rd.evaluate(() => window.r4d.snapshot?.());
    await sleep(600);
    await rd.evaluate(() => window.r4d.film().open(window.r4d.story().snapshots, 0));
    await sleep(2200);
    const ft = await hoverTip(rd, "[data-testid=film-svg] .r4d-drill-mark");
    check("film : aucune infobulle (rendu de présentation)", ft.text === null, JSON.stringify(ft));
    await rd.evaluate(() => window.r4d.film().close());
    // page participant
    await rd.evaluate((h2) => (location.hash = h2), `#/r/${P}/${dc.ids[0] ?? ""}`);
    await rd.waitForSelector("[data-testid=rv-participant]", { timeout: 10000 }).catch(() => {});
    await sleep(1800);
    const pt = await hoverTip(rd, "[data-testid=rv-participant] .rv-part-chart svg .r4d-drill-mark");
    check("page participant : infobulle au survol", !!pt.text && /opportunit/.test(pt.text), JSON.stringify(pt));
    await rctx.close();
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
