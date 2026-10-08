import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  // Chemins relatifs : le site fonctionne servi depuis n'importe quel sous-chemin (ou en file://)
  base: "./",
  resolve: {
    alias: [
      { find: /^span-magnitude-viz$/, replacement: resolve(root, "../src/index.ts") },
      { find: /^span-magnitude-viz\/(.*)$/, replacement: resolve(root, "../src/$1") },
    ],
  },
  server: { port: 5174, open: false },
  preview: { port: 4174 },
  build: {
    outDir: resolve(root, "../studio-dist"),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
    // Deux pages : le Studio et la page de vérification (QR d'empreinte des données)
    rollupOptions: {
      input: { main: resolve(root, "index.html"), verifier: resolve(root, "verifier.html") },
    },
  },
});
