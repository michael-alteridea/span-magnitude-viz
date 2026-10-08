/**
 * Classeurs Excel : lecture SheetJS → modèle de cellules (valeurs, formules, formats de date), détection des formules
 * sans valeur en cache (fichier généré par script, jamais enregistré par Excel), matrices de valeurs par feuille
 * (après recalcul éventuel) et choix de l'onglet (score « tableau de données »).
 */
import type { WorkBook, WorkSheet, CellObject } from "xlsx";
import { KEY_COLS, type RecalcReport, type SheetIn, type WorkbookIn } from "./formula/engine";
import { XlErr, errOf, serialToMs, type Scalar } from "./formula/values";
import { IMPORT_LIMITS, checkFileSize, checkTableSize } from "./files";

/** Cellule de matrice : nombre, texte, booléen, date (Date UTC), vide. */
export type MCell = number | string | boolean | Date | null;
export type Matrix = MCell[][];

export interface SheetData {
  name: string;
  /** Modèle pour le moteur de formules. */
  model: SheetIn;
  /** Cellules dont le format est une date (clé r * 16384 + c). */
  dateCells: Set<number>;
  /** Formules sans valeur en cache. */
  missingCached: number;
  formulas: number;
}
export interface WorkbookData {
  sheets: SheetData[];
  names: Record<string, string>;
  formulas: number;
  missingCached: number;
}

let xlsxMod: typeof import("xlsx") | null = null;
export async function loadXlsx(): Promise<typeof import("xlsx")> {
  if (!xlsxMod) xlsxMod = await import("xlsx");
  return xlsxMod;
}

function isDateFormat(X: typeof import("xlsx"), z: unknown): boolean {
  if (typeof z !== "string" && typeof z !== "number") return false;
  try {
    return X.SSF.is_date(z as string);
  } catch {
    return false;
  }
}

function cellScalar(c: CellObject): Scalar {
  switch (c.t) {
    case "n":
      return typeof c.v === "number" ? c.v : null;
    case "s":
    case "str" as never:
      return c.v == null ? null : String(c.v);
    case "b":
      return !!c.v;
    case "e":
      return errOf(typeof c.w === "string" ? c.w : "#VALUE!");
    case "d":
      return c.v instanceof Date ? (c.v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : null;
    default:
      return null;
  }
}

/** Lit un classeur (octets) en modèle de cellules. */
export async function readWorkbookData(buf: ArrayBuffer): Promise<WorkbookData> {
  checkFileSize(buf.byteLength);
  const X = await loadXlsx();
  let wb: WorkBook;
  try {
    wb = X.read(buf, { type: "array", cellFormula: true, sheetStubs: true, cellNF: true, cellDates: false, sheetRows: IMPORT_LIMITS.maxRows + 2, dense: false });
  } catch (e) {
    throw new Error("Classeur illisible ou corrompu : " + (e instanceof Error ? e.message : String(e)));
  }
  return workbookDataFrom(X, wb);
}

export function workbookDataFrom(X: typeof import("xlsx"), wb: WorkBook): WorkbookData {
  const sheets: SheetData[] = [];
  let formulas = 0;
  let missing = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name] as WorkSheet | undefined;
    const cells = new Map<number, { v: Scalar; f?: string }>();
    const dateCells = new Set<number>();
    let maxR = 0;
    let maxC = 0;
    let f = 0;
    let miss = 0;
    if (ws) {
      const full = (ws["!fullref"] as string | undefined) ?? ws["!ref"];
      if (full) {
        const rg = X.utils.decode_range(full);
        checkTableSize(rg.e.r - rg.s.r + 1, rg.e.c - rg.s.c + 1, `La feuille « ${name} »`);
      }
      for (const addr of Object.keys(ws)) {
        if (addr[0] === "!") continue;
        const c = ws[addr] as CellObject;
        const { r, c: col } = X.utils.decode_cell(addr);
        const key = r * KEY_COLS + col;
        const formula = typeof c.f === "string" && c.f.length ? c.f : undefined;
        const hasCached = c.t !== "z" && c.v !== undefined && !(c.t === "s" && c.v === "" && formula);
        if (!formula && c.t === "z") continue;
        const v = hasCached ? cellScalar(c) : null;
        if (formula) {
          f++;
          if (!hasCached) miss++;
        }
        cells.set(key, formula ? { v, f: formula } : { v });
        if (isDateFormat(X, c.z)) dateCells.add(key);
        if (r > maxR) maxR = r;
        if (col > maxC) maxC = col;
      }
    }
    formulas += f;
    missing += miss;
    sheets.push({ name, model: { name, cells, maxR, maxC }, dateCells, missingCached: miss, formulas: f });
  }
  const names: Record<string, string> = {};
  for (const n of wb.Workbook?.Names ?? []) if (n.Name && n.Ref && n.Sheet === undefined) names[n.Name] = n.Ref;
  return { sheets, names, formulas, missingCached: missing };
}

export function toWorkbookIn(d: WorkbookData): WorkbookIn {
  return { sheets: d.sheets.map((s) => s.model), names: d.names };
}

/**
 * Matrice des valeurs affichables d'une feuille : valeur calculée (si recalcul) sinon valeur en cache ;
 * nombres au format date → Date ; erreurs Excel → texte (« #DIV/0! »).
 */
export function sheetMatrix(sheet: SheetData, computed?: Map<number, Scalar> | null): Matrix {
  const { cells, maxR, maxC } = sheet.model;
  const m: Matrix = [];
  for (let r = 0; r <= maxR; r++) m.push(new Array<MCell>(maxC + 1).fill(null));
  for (const [key, cell] of cells) {
    const r = Math.floor(key / KEY_COLS);
    const c = key % KEY_COLS;
    let v: Scalar = cell.f && computed?.has(key) ? computed.get(key)! : cell.v;
    let out: MCell;
    if (v instanceof XlErr) out = v.code;
    else if (typeof v === "number" && sheet.dateCells.has(key) && v > 0 && v < 2958466) out = new Date(serialToMs(Math.round(v * 86400) / 86400));
    else out = v;
    m[r]![c] = out;
  }
  return m;
}

/* ---------------------------------------------------------------- choix de l'onglet */

export interface SheetGuess {
  name: string;
  score: number;
  rows: number;
  cols: number;
  formulas: number;
  /** Raison courte affichée (« plan mensuel 60 mois », « notes »…). */
  hint: string;
  isData: boolean;
}

const DEPRIORITIZE = /(lisez|readme|read me|sources?|notes?|aide|help|à propos|about|instructions|sommaire|contents|légende|legende|param)/i;
const MONTHLY_HEADER = /^(m\s?\d{1,3}|mois\s?\d{1,3})$/i;

/** Score « tableau de données » : grille numérique large, en-têtes temporels, peu de texte libre. */
export function guessSheet(name: string, m: Matrix, formulas = 0): SheetGuess {
  const rows = m.length;
  const cols = rows ? Math.max(...m.map((r) => r.length)) : 0;
  let num = 0;
  let txt = 0;
  let longTxt = 0;
  let timeHeaders = 0;
  let dates = 0;
  for (const row of m)
    for (const v of row) {
      if (typeof v === "number") num++;
      else if (v instanceof Date) dates++;
      else if (typeof v === "string" && v.trim()) {
        txt++;
        if (v.length > 80) longTxt++;
        if (MONTHLY_HEADER.test(v.trim())) timeHeaders++;
      }
    }
  const filled = num + txt + dates;
  let score = 0;
  let hint = "";
  if (filled === 0) return { name, score: -10, rows, cols, formulas, hint: "vide", isData: false };
  score += Math.min(4, Math.log10(1 + num + dates));
  score += (num + dates) / Math.max(1, filled);
  if (timeHeaders >= 6) {
    score += 3;
    hint = `plan mensuel (${timeHeaders} mois)`;
  } else if (dates >= 6) {
    score += 1.5;
    hint = "dates";
  }
  if (cols >= 6) score += 0.5;
  score -= Math.min(3, longTxt * 0.3);
  if (DEPRIORITIZE.test(name)) {
    score -= 4;
    hint = hint || "notes / sources";
  }
  if (!hint) hint = num > txt ? "tableau chiffré" : "surtout du texte";
  return { name, score: Math.round(score * 100) / 100, rows, cols, formulas, hint, isData: score >= 2.5 && !DEPRIORITIZE.test(name) };
}

export type { RecalcReport };
