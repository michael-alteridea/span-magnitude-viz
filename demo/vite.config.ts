import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      "span-magnitude-viz": resolve(root, "../src/index.ts"),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: resolve(root, "../demo-dist"),
    emptyOutDir: true,
  },
});
