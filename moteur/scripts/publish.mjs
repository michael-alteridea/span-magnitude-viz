// Assemble le dossier publiable du moteur : fichiers construits, démo, données fictives, README, index.
// Usage : node moteur/scripts/publish.mjs <dossier cible>
import { copyFileSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(here, "publish"));
mkdirSync(out, { recursive: true });
const files = [];
for (const f of readdirSync(join(here, "dist"))) (copyFileSync(join(here, "dist", f), join(out, f)), files.push(f));
for (const f of ["demo.html", "donnees-demo.js"]) (copyFileSync(join(here, "demo", f), join(out, f)), files.push(f));
copyFileSync(join(here, "README.md"), join(out, "README.md"));
files.push("README.md");
const size = (f) => `${(statSync(join(out, f)).size / 1024).toFixed(1).replace(".", ",")} Ko`;
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AlterideaCharts 0.1.0</title><link rel="icon" href="data:,">
<style>body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#14262E;line-height:1.5}a{color:#0E6E8C}code{background:#EEF4F6;padding:1px 5px;border-radius:4px}</style></head>
<body><h1>AlterideaCharts 0.1.0</h1><p>Moteur de graphiques partagé (gain cumulé, cascade, avant / après).</p><ul>
<li><a href="demo.html">Démo</a> (données fictives)</li><li><a href="README.md">README</a> (API, thème, cartouche)</li>
<li><a href="alteridea-charts-0.1.0.min.js"><code>alteridea-charts-0.1.0.min.js</code></a> — fichier classique, ${size("alteridea-charts-0.1.0.min.js")}</li>
<li><a href="alteridea-charts-0.1.0.esm.js"><code>alteridea-charts-0.1.0.esm.js</code></a> — module ES, ${size("alteridea-charts-0.1.0.esm.js")}</li></ul></body></html>\n`
);
files.push("index.html");
console.log(`moteur publié → ${out} : ${files.join(", ")}`);
