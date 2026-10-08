/**
 * Régénère le jeu de démonstration FICTIF du scénario « Directeur financier » :
 *   npx vite-node --config vitest.config.ts studio/scripts/make-demo-finance.ts
 * → studio/public/demo/finance-reel-2025-budget-2026.csv (séparateur « ; », virgule décimale, UTF-8, LF).
 * Déterministe (graine fixe `FIN_SEED`) : le test `finance.test.ts` vérifie que le fichier publié correspond
 * exactement au générateur (`studio/src/data/demoFinance.ts`).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { FIN_CSV_NAME, demoFinanceCsv, demoFinanceRows } from "../src/data/demoFinance";

const out = resolve(import.meta.dirname ?? ".", "../public/demo");
mkdirSync(out, { recursive: true });
const rows = demoFinanceRows();
writeFileSync(resolve(out, FIN_CSV_NAME), demoFinanceCsv(rows), "utf8");
console.log(`${FIN_CSV_NAME} : ${rows.length} lignes → ${out}`);
