#!/usr/bin/env node
/**
 * Version hors ligne en un seul fichier HTML (JS, CSS et polices inline) :
 *   npm run build:studio:offline  →  studio-offline/reporting-4d-studio.html
 *
 * Fonctionne en file:// (double-clic). Favicon et apple-touch-icon (studio/public/) sont inlinés en data: URL.
 * Le nom du fichier reste technique (reporting-4d-studio.html) ; le produit s'affiche « Tell4D ». Les modules chargés à la demande (xlsx, film/carte)
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

/** Alias identiques à studio/vite.config.ts + imports Vite « ?url » / « ?inline » (data: URL) et « ?raw » (texte). */
const plugin = {
  name: "r4d-offline",
  setup(b) {
    b.onResolve({ filter: /^span-magnitude-viz$/ }, () => ({ path: join(repo, "src/index.ts") }));
    b.onResolve({ filter: /^span-magnitude-viz\// }, (a) => ({ path: join(repo, "src", a.path.slice("span-magnitude-viz/".length)) + (a.path.endsWith(".ts") ? "" : ".ts") }));
    b.onResolve({ filter: /\?url$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?url$/, "")), namespace: "dataurl" }));
    b.onResolve({ filter: /\?inline$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?inline$/, "")), namespace: "dataurl" }));
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?raw$/, "")), namespace: "raw" }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, (a) => ({ contents: `export default ${JSON.stringify(readFileSync(a.path, "utf8"))};`, loader: "js" }));
    b.onLoad({ filter: /.*/, namespace: "dataurl" }, (a) => {
      const mime = mimeOf(a.path);
      return { contents: `export default ${JSON.stringify(`data:${mime};base64,${readFileSync(a.path).toString("base64")}`)};`, loader: "js" };
    });
  },
};

function mimeOf(p) {
  return p.endsWith(".woff2") ? "font/woff2" : p.endsWith(".png") ? "image/png" : p.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
}
const dataUrl = (p) => `data:${mimeOf(p)};base64,${readFileSync(p).toString("base64")}`;

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
// Icônes du dossier public/ (href="/favicon.svg"…) → data: URL, le fichier devant rester autonome
html = html.replace(/href="\/([\w.-]+\.(?:svg|png))"/g, (m, f) => `href="${dataUrl(join(studio, "public", f))}"`);
html = html.replace("</head>", () => `  <meta name="generator" content="Tell4D Studio · version hors ligne · ${new Date().toISOString().slice(0, 10)}" />\n    <style>${safeCss}</style>\n  </head>`);
html = html.replace("</body>", () => `  <script>${safeJs}</script>\n  </body>`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`✓ ${outFile} (${(statSync(outFile).size / 1024 / 1024).toFixed(2)} Mo)`);
