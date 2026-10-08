#!/usr/bin/env node
/**
 * Version hors ligne en un seul fichier HTML (JS, CSS et polices inline) :
 *   npm run build:studio:offline  →  studio-offline/reporting-4d-studio.html
 *
 * Fonctionne en file:// (double-clic). Les modules chargés à la demande (xlsx, film/carte)
 * sont intégrés au même fichier, d'où une taille plus importante que la version hébergée.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, "..");
const repo = resolve(studio, "..");
const outDir = join(repo, "studio-offline");
const outFile = join(outDir, "reporting-4d-studio.html");

/** Alias identiques à studio/vite.config.ts + imports Vite « ?url » transformés en data: URL. */
const plugin = {
  name: "r4d-offline",
  setup(b) {
    b.onResolve({ filter: /^span-magnitude-viz$/ }, () => ({ path: join(repo, "src/index.ts") }));
    b.onResolve({ filter: /^span-magnitude-viz\// }, (a) => ({ path: join(repo, "src", a.path.slice("span-magnitude-viz/".length)) + (a.path.endsWith(".ts") ? "" : ".ts") }));
    b.onResolve({ filter: /\?url$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?url$/, "")), namespace: "dataurl" }));
    b.onLoad({ filter: /.*/, namespace: "dataurl" }, (a) => {
      const mime = a.path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
      return { contents: `export default ${JSON.stringify(`data:${mime};base64,${readFileSync(a.path).toString("base64")}`)};`, loader: "js" };
    });
  },
};

const res = await build({
  entryPoints: [join(studio, "src/main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  write: false,
  outdir: "out",
  loader: { ".woff2": "dataurl", ".json": "json" },
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.BASE_URL": '"./"' },
  plugins: [plugin],
  logLevel: "warning",
});
const js = res.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const css = res.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
if (!js) throw new Error("bundle JS vide");

// Remplacements par fonction : le bundle contient des « $& », « $' »… que String.replace interpréterait.
const safeJs = js.replace(/<\/script/gi, "<\\/script");
const safeCss = css.replace(/<\/style/gi, "<\\/style");
let html = readFileSync(join(studio, "index.html"), "utf8");
html = html.replace(/\s*<script type="module" src="\.\/src\/main\.ts"><\/script>/, "");
html = html.replace("</head>", () => `  <meta name="generator" content="Reporting 4D Studio · version hors ligne · ${new Date().toISOString().slice(0, 10)}" />\n    <style>${safeCss}</style>\n  </head>`);
html = html.replace("</body>", () => `  <script>${safeJs}</script>\n  </body>`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`✓ ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(2)} Mo)`);
