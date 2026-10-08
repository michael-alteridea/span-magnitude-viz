/** Build du moteur : UMD minifié (window.AlterideaCharts, D3 inclus) + ESM, version figée dans le nom. */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.1.0";

export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "es2019",
    minify: "esbuild",
    sourcemap: false,
    lib: {
      entry: resolve(root, "src/index.ts"),
      name: "AlterideaCharts",
      formats: ["umd", "es"],
      fileName: (f) => (f === "umd" ? `alteridea-charts-${VERSION}.min.js` : `alteridea-charts-${VERSION}.esm.js`),
    },
  },
});
