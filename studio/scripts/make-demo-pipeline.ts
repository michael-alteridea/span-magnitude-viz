/**
 * Régénère le jeu de démonstration FICTIF du scénario « réunion commerciale » :
 *   npx vite-node --config vitest.config.ts studio/scripts/make-demo-pipeline.ts
 * → studio/public/demo/pipeline-commercial-2026.csv (séparateur « ; », virgule décimale, UTF-8, LF).
 * Déterministe (graine fixe `DEMO_SEED`) : le test `demoPipeline.test.ts` vérifie que le fichier
 * publié correspond exactement au générateur (`studio/src/data/demoPipeline.ts`).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_CSV_NAME, demoPipelineCsv, demoPipelineRows } from "../src/data/demoPipeline";

const out = resolve(import.meta.dirname ?? ".", "../public/demo");
mkdirSync(out, { recursive: true });
const rows = demoPipelineRows();
writeFileSync(resolve(out, DEMO_CSV_NAME), demoPipelineCsv(rows), "utf8");
console.log(`${DEMO_CSV_NAME} : ${rows.length} opportunités → ${out}`);
