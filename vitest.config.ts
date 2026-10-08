import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^span-magnitude-viz$/, replacement: resolve(root, "src/index.ts") },
      { find: /^span-magnitude-viz\/(.*)$/, replacement: resolve(root, "src/$1") },
    ],
  },
  test: {
    include: ["studio/test/**/*.test.ts"],
    environment: "node",
  },
});
