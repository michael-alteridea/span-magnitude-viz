#!/usr/bin/env node
/**
 * Contrôle d'un PowerPoint exporté par Datanime : transitions Morph (avec repli fondu), formes nommées « !! »,
 * et QR du cartouche de chaque graphique (décodé avec jsQR) → lien du mode lecture.
 *
 *   node studio/scripts/check-pptx.mjs Fichier.pptx [--json]
 *
 * Morph ne peut être vérifié visuellement que dans PowerPoint (2019 / Microsoft 365) : ce script contrôle la
 * structure, LibreOffice affiche le repli (fondu).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(here, "../.."), "package.json"));
const JSZip = require("jszip");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

const file = process.argv[2];
if (!file) {
  console.error("usage : check-pptx.mjs Fichier.pptx");
  process.exit(2);
}
const zip = await JSZip.loadAsync(readFileSync(file));
const slides = Object.keys(zip.files)
  .map((p) => [p, /^ppt\/slides\/slide(\d+)\.xml$/.exec(p)])
  .filter(([, m]) => m)
  .map(([p, m]) => ({ p, n: Number(m[1]) }))
  .sort((a, b) => a.n - b.n);

function decode(buf) {
  const png = PNG.sync.read(buf);
  const { width: W, height: H } = png;
  // zone du cartouche : quart inférieur droit
  for (const [fx, fy] of [[0.55, 0.55], [0.35, 0.35], [0, 0]]) {
    const x0 = Math.floor(W * fx);
    const y0 = Math.floor(H * fy);
    const w = W - x0;
    const h = H - y0;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(png.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
    const r = jsQR(data, w, h);
    if (r) return r.data;
  }
  return null;
}

const out = [];
for (const { p, n } of slides) {
  const xml = await zip.file(p).async("string");
  const rels = (await zip.file(p.replace("slides/", "slides/_rels/") + ".rels")?.async("string")) ?? "";
  const names = [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
  const bang = names.filter((x) => x.startsWith("!!"));
  const morph = xml.includes("<p159:morph");
  const fallback = /<mc:Fallback><p:transition[^>]*><p:fade\/>/.test(xml);
  // image du graphique : la plus grande image de la diapositive
  let qr = null;
  const imgs = [...xml.matchAll(/<p:pic>[\s\S]*?r:embed="(rId\d+)"[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/g)].map((m) => ({ rid: m[1], area: Number(m[2]) * Number(m[3]) }));
  imgs.sort((a, b) => b.area - a.area);
  const big = imgs[0];
  if (big && big.area > 4e12) {
    const target = new RegExp(`Id="${big.rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${big.rid}"`).exec(rels)?.[1];
    if (target && /\.png$/i.test(target)) qr = decode(await zip.file(join("ppt/slides", target).replace(/\\/g, "/")).async("nodebuffer"));
  }
  const dup = bang.filter((x, k) => bang.indexOf(x) !== k);
  out.push({ slide: n, shapes: names.length, named: bang.length, duplicates: dup.length, morph, fallback, qr });
}
const valid = out.every((s) => s.duplicates === 0 && (!s.morph || s.fallback));
if (process.argv.includes("--json")) console.log(JSON.stringify({ file, slides: out, valid }, null, 2));
else {
  for (const s of out) console.log(`diapo ${String(s.slide).padStart(2)} · formes ${String(s.shapes).padStart(3)} · « !! » ${String(s.named).padStart(3)}${s.duplicates ? ` · DOUBLONS ${s.duplicates}` : ""} · ${s.morph ? (s.fallback ? "Morph + repli fondu" : "Morph SANS repli") : "sans transition"}${s.qr ? ` · QR → ${s.qr}` : ""}`);
  console.log(valid ? "OK" : "ÉCHEC");
}
process.exit(valid ? 0 : 1);
