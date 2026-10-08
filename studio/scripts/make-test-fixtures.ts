/**
 * Génère les fixtures de test réduites à partir des fichiers de Michaël (hors dépôt) :
 *   npx vite-node --config vitest.config.ts studio/scripts/make-test-fixtures.ts
 * - plan-mini.xlsx : feuilles « Hypothèses », « Plan 60m — Exemple » (lignes 1–83 : calendrier + équipe commerciale)
 *   et « Synthèse » (lignes 1–5 et 9–10), réduites à la fermeture des dépendances des cellules gardées, formules SANS
 *   valeur en cache (comme le fichier d'origine) ;
 * - plan-mini.expected.json : valeurs recalculées par LibreOffice (vérité terrain) pour chaque formule gardée.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseFormula, addrOf, type Node } from "../src/data/formula/parser";

const SRC = process.env.SRC ?? "/workspace/fixtures/fichier-michael.xlsx";
const REF = process.env.REF ?? "/workspace/fixtures/recalc/fichier-michael.xlsx";
const OUT = resolve(import.meta.dirname ?? ".", "../test/fixtures");

const src = XLSX.read(readFileSync(SRC), { type: "buffer", cellFormula: true, sheetStubs: true, cellNF: true });
const ref = XLSX.read(readFileSync(REF), { type: "buffer" });
const MONTHLY = "Plan 60m — Exemple";
const keepRows: Record<string, (r: number, c: number) => boolean> = {
  [MONTHLY]: (r) => r <= 82, // indices 0 : lignes 1–83
  "Synthèse": (r, c) => (r <= 4 || r === 8 || r === 9) && c <= 5, // colonnes A–F (scénario central)
  "Hypothèses": () => false,
};
const keep = new Map<string, Set<string>>();
const add = (sheet: string, a: string) => {
  if (!keep.has(sheet)) keep.set(sheet, new Set());
  const set = keep.get(sheet)!;
  if (set.has(a)) return false;
  set.add(a);
  return true;
};
const queue: [string, string][] = [];
for (const [sheet, pred] of Object.entries(keepRows)) {
  const ws = src.Sheets[sheet]!;
  for (const a of Object.keys(ws)) {
    if (a[0] === "!") continue;
    const { r, c } = XLSX.utils.decode_cell(a);
    if (pred(r, c) && add(sheet, a)) queue.push([sheet, a]);
  }
}
const refsOf = (n: Node, sheet: string, out: [string, string][]) => {
  switch (n.k) {
    case "ref":
      out.push([n.sheet ?? sheet, addrOf(n.r, n.c)]);
      break;
    case "range":
      for (let r = n.r1; r <= Math.min(n.r2, 400); r++) for (let c = n.c1; c <= Math.min(n.c2, 80); c++) out.push([n.sheet ?? sheet, addrOf(r, c)]);
      break;
    case "un":
      refsOf(n.a, sheet, out);
      break;
    case "bin":
      refsOf(n.a, sheet, out);
      refsOf(n.b, sheet, out);
      break;
    case "call":
      n.args.forEach((a) => refsOf(a, sheet, out));
      break;
    case "array":
      n.rows.forEach((row) => row.forEach((a) => refsOf(a, sheet, out)));
      break;
  }
};
while (queue.length) {
  const [sheet, a] = queue.pop()!;
  const c = src.Sheets[sheet]?.[a] as XLSX.CellObject | undefined;
  if (!c?.f) continue;
  const deps: [string, string][] = [];
  refsOf(parseFormula(c.f), sheet, deps);
  for (const [s, d] of deps) if (src.Sheets[s]?.[d] && add(s, d)) queue.push([s, d]);
}
const wb = XLSX.utils.book_new();
const expected: Record<string, Record<string, number | string>> = {};
let nf = 0;
for (const sheet of ["Hypothèses", MONTHLY, "Synthèse"].filter((s) => keep.has(s))) {
  const ws: XLSX.WorkSheet = {};
  const s0 = src.Sheets[sheet]!;
  let maxR = 0;
  let maxC = 0;
  expected[sheet] = {};
  // Libellés de la colonne A des lignes gardées (pour la détection de structure)
  for (const a of keep.get(sheet) ?? []) {
    const c = s0[a] as XLSX.CellObject;
    const { r, c: col } = XLSX.utils.decode_cell(a);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, col);
    if (c.f) {
      nf++;
      ws[a] = { t: "n", f: c.f, z: c.z } as XLSX.CellObject;
      const e = ref.Sheets[sheet]?.[a] as XLSX.CellObject | undefined;
      if (e && (e.t === "n" || e.t === "s")) expected[sheet]![a] = e.v as number | string;
    } else ws[a] = { t: c.t, v: c.v, z: c.z } as XLSX.CellObject;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  XLSX.utils.book_append_sheet(wb, ws, sheet);
}
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
writeFileSync(resolve(OUT, "plan-mini.xlsx"), buf);
writeFileSync(resolve(OUT, "plan-mini.expected.json"), JSON.stringify(expected));
console.log(`plan-mini.xlsx : ${(buf.length / 1024).toFixed(0)} Ko, ${nf} formules ; cellules gardées :`, [...keep].map(([s, set]) => `${s} ${set.size}`).join(" · "));
