/**
 * Bundle demo/standalone.ts + deps into a single offline HTML file.
 */
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demo = resolve(root, "demo");

const result = await esbuild.build({
  entryPoints: [resolve(demo, "standalone.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "transform",
  loader: { ".json": "json" },
  alias: {
    "span-magnitude-viz": resolve(root, "src/index.ts"),
  },
  logLevel: "info",
});

const js = result.outputFiles[0].text;
let html = readFileSync(resolve(demo, "standalone.html"), "utf8");

const marker = '<script type="module" src="./standalone.ts"></script>';
const idx = html.indexOf(marker);
if (idx < 0) throw new Error("standalone.ts script tag not found in standalone.html");
// Avoid String.replace $& / $1 interpretation inside the bundle
html =
  html.slice(0, idx) +
  "<script>\n" +
  js +
  "\n</script>" +
  html.slice(idx + marker.length);

const out = resolve(demo, "standalone-offline.html");
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
