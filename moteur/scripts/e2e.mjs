/**
 * e2e du moteur : une page HTML simple (origine A) charge le fichier unique depuis une autre origine (B, sans en-tête
 * CORS, comme l'hébergement), monte les 3 graphiques, vérifie animation, mouvement réduit, thème, export SVG/PNG,
 * accessibilité, largeur mobile ; puis la démo publiée (thème par défaut et perso) avec captures.
 *   node moteur/scripts/e2e.mjs [--shots]
 */
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const SHOTS = process.argv.includes("--shots");
const shotDir = join(here, "..", "docs", "shots");
const pub = "/tmp/moteur-e2e-pub";

execSync("npm run -s build:moteur", { cwd: repo, stdio: "inherit" });
execSync(`node moteur/scripts/publish.mjs ${pub}`, { cwd: repo, stdio: "inherit" });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".png": "image/png" };
function serve(dir, port, extra = {}) {
  return new Promise((res) => {
    const s = createServer((req, rsp) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (extra[p]) return rsp.writeHead(200, { "content-type": "text/html; charset=utf-8" }), rsp.end(extra[p]);
      const f = join(dir, p === "/" ? "index.html" : p);
      if (!f.startsWith(dir) || !existsSync(f)) return rsp.writeHead(404), rsp.end("404");
      rsp.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" }); // pas d'en-tête CORS
      rsp.end(readFileSync(f));
    }).listen(port, "127.0.0.1", () => res(s));
  });
}

const B = 4312;
const A = 4311;
const plain = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test simple</title><link rel="icon" href="data:,"></head>
<body style="margin:0;padding:12px;font-family:sans-serif">
<div id="g"></div><div id="c" style="max-width:640px"></div><div id="p" style="--ac-primary:#5B2A86;--ac-font:Georgia,serif"></div><div id="a"></div>
<script src="http://localhost:${B}/alteridea-charts-0.1.0.min.js"></script>
<script src="http://localhost:${B}/donnees-demo.js"></script>
</body></html>`;
const srvB = await serve(pub, B);
const srvA = await serve(pub, A, { "/simple.html": plain });

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    return createRequire(join(process.env.PUPPETEER_DIR ?? "/home/box/tools/pptr", "package.json"))("puppeteer-core");
  }
}
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let pass = 0;
let fail = 0;
const check = (name, ok, info = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${info ? ` — ${String(info).slice(0, 400)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  /* 1. Page HTML simple, fichier unique depuis une autre origine */
  const pg = await browser.newPage();
  const errs = [];
  const scripts = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  pg.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
  await pg.setViewport({ width: 1100, height: 900 });
  await pg.goto(`http://127.0.0.1:${A}/simple.html`, { waitUntil: "load" });
  const g = await pg.evaluate(() => ({ v: window.AlterideaCharts?.version, keys: Object.keys(window.AlterideaCharts ?? {}).sort(), d3: typeof window.d3 }));
  check("fichier unique chargé depuis une autre origine sans CORS : window.AlterideaCharts 0.1.0 (D3 inclus, pas de d3 global)", g.v === "0.1.0" && scripts.filter((u) => /alteridea-charts/.test(u)).length === 1 && g.d3 === "undefined", JSON.stringify({ ...g, scripts }));
  check("API : cumulativeGain, waterfall, beforeAfter, cartouche, format, theme, toPNG", ["beforeAfter", "cartouche", "cumulativeGain", "format", "theme", "toPNG", "version", "waterfall"].every((k) => g.keys.includes(k)), g.keys.join(","));

  // montage + animation en cours
  const mid = await pg.evaluate(async () => {
    const AC = window.AlterideaCharts, D = window.NORVIA_DEMO;
    window.ctl = {
      g: AC.cumulativeGain.animate("#g", D.gain, { title: "Rentabilisé en un an", duration: 1200 }),
      c: AC.waterfall.animate(document.getElementById("c"), D.cascade, { title: "Cascade", duration: 1200 }),
      p: AC.waterfall.animate("#p", D.cascade, { duration: 0 }),
      a: AC.beforeAfter.animate("#a", D.avantApres, { format: "number", unit: "h", duration: 1200 }),
    };
    await new Promise((r) => setTimeout(r, 250));
    const bar = document.querySelector("#c .ac-bar.ac-total");
    const reveal = document.querySelector("#g .ac-reveal");
    return { totalH: +bar.getAttribute("height"), revealW: +reveal.getAttribute("width") };
  });
  await pg.evaluate(() => Promise.all(Object.values(window.ctl).map((c) => c.ready)));
  const fin = await pg.evaluate(() => {
    const AC = window.AlterideaCharts, D = window.NORVIA_DEMO;
    const bar = document.querySelector("#c .ac-bar.ac-total");
    const ref = new DOMParser().parseFromString(window.ctl.c.toSVG(), "image/svg+xml").querySelector(".ac-bar.ac-total");
    const reveal = document.querySelector("#g .ac-reveal");
    const after = [...document.querySelectorAll("#a .ac-after")].map((r) => +r.getAttribute("width"));
    return {
      h: +bar.getAttribute("height"), hRef: +ref.getAttribute("height"), revealW: +reveal.getAttribute("width"), revealRef: +reveal.getAttribute("data-ac-b") || null,
      after, svgs: document.querySelectorAll(".ac-chart > svg").length,
    };
  });
  check("animation D3 : barres et courbe partent de zéro puis atteignent la géométrie finale (ready)", mid.totalH < fin.hRef && fin.h === fin.hRef && mid.revealW < fin.revealW && fin.after.every((w) => w > 0) && fin.svgs === 4, JSON.stringify({ mid, fin }));

  const a11y = await pg.evaluate(() => {
    const svg = document.querySelector("#g svg");
    const ids = (svg.getAttribute("aria-labelledby") ?? "").split(" ");
    const tbl = document.querySelector("#g .ac-sr table");
    const cs = getComputedStyle(document.querySelector("#g .ac-sr"));
    return { role: svg.getAttribute("role"), title: document.getElementById(ids[0])?.textContent, desc: document.getElementById(ids[1])?.textContent, rows: tbl?.querySelectorAll("tbody tr").length, hidden: cs.position === "absolute" && cs.width === "1px", head: [...tbl.querySelectorAll("thead th")].map((t) => t.textContent) };
  });
  check("accessibilité : role=img, title + desc (résumé : creux, délai de retour, cumul final), tableau lu par les lecteurs d'écran", a11y.role === "img" && a11y.title === "Rentabilisé en un an" && /creux de −155\u202fk€/.test(a11y.desc) && /rentabilisé en 12\u202fmois/.test(a11y.desc) && a11y.rows === 24 && a11y.hidden, JSON.stringify(a11y));

  const look = await pg.evaluate(() => {
    const gsvg = document.querySelector("#g svg").outerHTML;
    const p = document.querySelector("#p .ac-bar.ac-total").getAttribute("fill");
    const pfont = document.querySelector("#p svg").getAttribute("font-family");
    const neg = document.querySelectorAll('#c .ac-bar.ac-delta[fill="#C8423B"]').length;
    const pos = document.querySelectorAll('#c .ac-bar.ac-delta[fill="#1E8E5A"]').length;
    const tot = document.querySelector("#c .ac-bar.ac-total").getAttribute("fill");
    const deltas = [...document.querySelectorAll("#a .ac-delta")].map((d) => [d.textContent, d.getAttribute("fill")]);
    return { payback: /Rentabilisé en 12\u202fmois/.test(gsvg), red: gsvg.includes('stroke="#C8423B"'), green: gsvg.includes('stroke="#1E8E5A"'), p, pfont, neg, pos, tot, deltas, brand: /Datanime|Alteridea|ValueRoom/i.test(document.querySelector("#g").innerHTML + document.querySelector("#c").innerHTML) };
  });
  check("gain cumulé : rouge sous zéro, vert après le point mort, « Rentabilisé en 12 mois »", look.payback && look.red && look.green, JSON.stringify(look));
  check("cascade : 3 coûts rouges, 3 gains verts, total pétrole ; avant/après : 4 écarts verts, 1 rouge", look.neg === 3 && look.pos === 3 && look.tot === "#0E6E8C" && look.deltas.filter((d) => d[1] === "#1E8E5A").length === 4 && look.deltas.filter((d) => d[1] === "#C8423B").length === 1, JSON.stringify(look.deltas));
  check("thème par variables CSS du conteneur (--ac-primary, --ac-font) ; aucune marque sans cartouche", look.p === "#5b2a86" && /Georgia/.test(look.pfont) && !look.brand, JSON.stringify({ p: look.p, f: look.pfont }));

  const css = await pg.evaluate(() => {
    const st = document.getElementById("alteridea-charts-css");
    const rules = [...st.sheet.cssRules].map((r) => r.cssText);
    return { n: document.querySelectorAll("#alteridea-charts-css").length, ok: rules.every((r) => r.startsWith(".ac-chart") || (r.startsWith("@media") && !/[{,]\s*(?!\.ac-chart)[a-z*#]/.test(r.replace(/^@media[^{]+\{/, "").replace(/\{[^}]*\}/g, "")))), rules };
  });
  check("CSS injecté une seule fois et limité à .ac-chart (+ prefers-reduced-motion)", css.n === 1 && css.ok && css.rules.some((r) => /prefers-reduced-motion/.test(r)), JSON.stringify(css.rules.map((r) => r.slice(0, 50))));

  const exp = await pg.evaluate(async () => {
    const AC = window.AlterideaCharts, D = window.NORVIA_DEMO;
    const s = window.ctl.c.toSVG();
    const png = await window.ctl.g.toPNG(2);
    const png2 = await AC.beforeAfter.toPNG(D.avantApres, { format: "number", unit: "h" });
    const cs = AC.cartouche.toSVG(D.cartouche, { width: 600 });
    const cpng = await AC.cartouche.toPNG(D.cartouche, { width: 600 });
    const img = new Image();
    await new Promise((r) => ((img.onload = r), (img.src = png)));
    return { svg: s.startsWith("<svg") && s.includes("<title"), png: png.slice(0, 22), pngW: img.naturalWidth, png2: png2.startsWith("data:image/png"), cs: cs.includes("ac-qr") && cs.includes("Norvia"), cpng: cpng.startsWith("data:image/png") && cpng.length > 2000 };
  });
  check("export : toSVG (chaîne), toPNG (data URL, ×2), cartouche seul en SVG et PNG avec QR", exp.svg && exp.png === "data:image/png;base64," && exp.pngW > 2000 && exp.png2 && exp.cs && exp.cpng, JSON.stringify(exp));

  // largeur mobile : nouveau rendu à la largeur du conteneur, rien ne déborde
  await pg.setViewport({ width: 375, height: 800 }); // isMobile rechargerait la page
  await sleep(500);
  const mob = await pg.evaluate(() => ({ vb: document.querySelector("#g svg").getAttribute("viewBox"), sw: document.documentElement.scrollWidth, iw: innerWidth, fs: document.querySelector("#g .ac-title")?.getAttribute("font-size") }));
  check("responsive : à 375 px le graphique se redessine à la largeur du conteneur (typo réduite), aucun débordement", /^0 0 35\d /.test(mob.vb) && mob.sw <= mob.iw && +mob.fs < 18, JSON.stringify(mob));

  const upd = await pg.evaluate(async () => {
    const D = window.NORVIA_DEMO;
    await window.ctl.c.update({ ...D.cascade, total: false }, { duration: 0 });
    const n = document.querySelectorAll("#c .ac-bar").length;
    window.ctl.p.destroy();
    return { n, gone: !document.querySelector("#p .ac-chart") };
  });
  check("update() (sans barre de total) et destroy()", upd.n === 6 && upd.gone, JSON.stringify(upd));
  check("page simple : aucune erreur console", errs.length === 0, errs.join(" | "));
  await pg.close();

  /* 2. Mouvement réduit : état final immédiat */
  const rm = await browser.newPage();
  await rm.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await rm.goto(`http://127.0.0.1:${A}/simple.html`, { waitUntil: "load" });
  const red = await rm.evaluate(() => {
    const AC = window.AlterideaCharts, D = window.NORVIA_DEMO;
    const c = AC.waterfall.animate("#c", D.cascade, { duration: 3000 });
    const h = +document.querySelector("#c .ac-bar.ac-total").getAttribute("height");
    const ref = +new DOMParser().parseFromString(c.toSVG(), "image/svg+xml").querySelector(".ac-bar.ac-total").getAttribute("height");
    return { h, ref, rm: AC.prefersReducedMotion() };
  });
  check("prefers-reduced-motion : pas d'animation, état final immédiat", red.rm && red.h === red.ref && red.h > 0, JSON.stringify(red));
  await rm.close();

  /* 3. Démo publiée : thème par défaut puis perso, captures */
  const dp = await browser.newPage();
  const derr = [];
  dp.on("pageerror", (e) => derr.push(String(e)));
  dp.on("console", (m) => m.type() === "error" && derr.push(m.text()));
  await dp.setViewport({ width: 1366, height: 1024, deviceScaleFactor: 1 });
  await dp.goto(`http://127.0.0.1:${B}/demo.html`, { waitUntil: "load" });
  await dp.evaluate(() => Promise.all(Object.values(window.__demo.charts).map((c) => c.ready)));
  const d0 = await dp.evaluate(() => ({ n: document.querySelectorAll(".ac-chart svg").length, cart: document.querySelectorAll(".ac-cartouche").length, tot: document.querySelector("#cascade .ac-total").getAttribute("fill") }));
  check("démo : 3 graphiques animés, cartouche neutre (nom, lien, QR, dates, source), pétrole par défaut", d0.n === 3 && d0.cart === 3 && d0.tot === "#0E6E8C", JSON.stringify(d0));
  if (SHOTS) {
    mkdirSync(shotDir, { recursive: true });
    for (const [id, name] of [["gain", "01-gain-cumule"], ["cascade", "02-cascade"], ["avap", "03-avant-apres"]]) await (await dp.$(`#${id}`)).screenshot({ path: join(shotDir, `${name}-defaut.png`) });
    await dp.screenshot({ path: join(shotDir, "00-demo-1366.png"), fullPage: true });
  }
  await dp.click("[data-testid=theme-perso]");
  await dp.evaluate(() => Promise.all(Object.values(window.__demo.charts).map((c) => c.ready)));
  await sleep(1900);
  const d1 = await dp.evaluate(() => ({ tot: document.querySelector("#cascade .ac-total").getAttribute("fill"), font: document.querySelector("#gain svg").getAttribute("font-family"), bg: document.querySelector("#gain .ac-bg").getAttribute("fill") }));
  check("démo : thème perso (Prune, Georgia, fond crème) appliqué par variables CSS", d1.tot === "#5b2a86" && /Georgia/.test(d1.font) && d1.bg.toLowerCase() === "#fbf8f3", JSON.stringify(d1));
  if (SHOTS) for (const [id, name] of [["gain", "01-gain-cumule"], ["cascade", "02-cascade"], ["avap", "03-avant-apres"]]) await (await dp.$(`#${id}`)).screenshot({ path: join(shotDir, `${name}-perso.png`) });
  await dp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(700);
  const d2 = await dp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check("démo sur iPhone (390 px) : aucun débordement", d2.sw <= d2.iw, JSON.stringify(d2));
  if (SHOTS) await dp.screenshot({ path: join(shotDir, "04-demo-iphone.png"), fullPage: true });
  check("démo : aucune erreur console", derr.length === 0, derr.join(" | "));
  await dp.close();
} catch (e) {
  fail++;
  console.log("✗ exception", e);
} finally {
  await browser.close();
  srvA.close();
  srvB.close();
}
console.log(fail ? `\n${fail} échec(s), ${pass} réussis.` : `\nTous les tests passent (${pass}).`);
process.exit(fail ? 1 : 0);
