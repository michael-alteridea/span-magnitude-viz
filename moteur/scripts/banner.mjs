// Ajoute l'en-tête de licence aux fichiers construits (la minification le retire).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const BANNER = "/*! AlterideaCharts 0.1.0 — moteur de graphiques Alteridea (MIT). Inclut D3 (ISC, Mike Bostock) et qrcode-generator (MIT, Kazuhiko Arase). */\n";
for (const f of readdirSync(dist).filter((n) => n.endsWith(".js"))) {
  const p = join(dist, f);
  const s = readFileSync(p, "utf8");
  if (!s.startsWith("/*! AlterideaCharts")) writeFileSync(p, BANNER + s);
  console.log(`${f} · ${(readFileSync(p).length / 1024).toFixed(1)} Ko`);
}
