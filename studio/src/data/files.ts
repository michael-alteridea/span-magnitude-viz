/**
 * Import de fichiers (CSV, TSV, JSON, XLSX, XLS) et collage depuis Excel / Google Sheets.
 * SheetJS est chargé à la demande (import dynamique) pour garder le premier rendu léger.
 */
import { detectDelimiter, parseDelimitedMatrix, matrixToRows } from "span-magnitude-viz/fileImport";

export interface ImportResult {
  name: string;
  rows: Record<string, unknown>[];
  /** Feuilles disponibles (classeurs Excel). */
  sheets?: string[];
  sheet?: string;
  delimiter?: string;
  note?: string;
}

export const ACCEPTED_EXT = [".csv", ".tsv", ".txt", ".json", ".xlsx", ".xls"];

/** Limites d'import (protection mémoire / fichiers piégés) : taille, lignes, cellules. */
export const IMPORT_LIMITS = {
  /** Taille maximale d'un fichier (octets). */
  maxBytes: 20 * 1024 * 1024,
  /** Lignes lues au plus par feuille ou par texte (au-delà : refus). */
  maxRows: 100_000,
  /** Cellules au plus par feuille (lignes × colonnes de la zone utilisée). */
  maxCells: 2_000_000,
  /** Colonnes au plus. */
  maxCols: 2_000,
  /** Texte collé : caractères au plus. */
  maxChars: 20 * 1024 * 1024,
};

const fmtMo = (n: number) => (n / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Mo";
const fmtN = (n: number) => n.toLocaleString("fr-FR");

/** Refuse un fichier trop lourd avant toute lecture. */
export function checkFileSize(size: number, name = "Le fichier"): void {
  if (size > IMPORT_LIMITS.maxBytes)
    throw new Error(`${name} est trop volumineux (${fmtMo(size)}) : la limite est de ${fmtMo(IMPORT_LIMITS.maxBytes)}. Gardez seulement l'onglet utile ou exportez-le en CSV.`);
}

/** Refuse un tableau trop grand (lignes, colonnes, cellules). */
export function checkTableSize(rows: number, cols: number, what = "Le tableau"): void {
  if (rows > IMPORT_LIMITS.maxRows)
    throw new Error(`${what} compte plus de ${fmtN(IMPORT_LIMITS.maxRows)} lignes : réduisez-le (filtre, agrégation) avant l'import.`);
  if (cols > IMPORT_LIMITS.maxCols) throw new Error(`${what} compte ${fmtN(cols)} colonnes : la limite est de ${fmtN(IMPORT_LIMITS.maxCols)}.`);
  if (rows * cols > IMPORT_LIMITS.maxCells)
    throw new Error(`${what} est trop grand (${fmtN(rows * cols)} cellules) : la limite est de ${fmtN(IMPORT_LIMITS.maxCells)} cellules.`);
}

const DELIM_LABEL: Record<string, string> = { "\t": "tabulation", ";": "point-virgule", ",": "virgule" };

/** Texte délimité (collage ou fichier) → lignes. */
export function parseText(text: string, name = "Collage"): ImportResult {
  if (text.length > IMPORT_LIMITS.maxChars) throw new Error(`Le texte collé est trop long (${fmtMo(text.length)}) : la limite est de ${fmtMo(IMPORT_LIMITS.maxChars)}.`);
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("Le texte est vide.");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return { name, ...parseJsonValue(JSON.parse(trimmed)) };
    } catch {
      /* pas du JSON valide : on tente le tableau */
    }
  }
  const delimiter = detectDelimiter(trimmed);
  const matrix = parseDelimitedMatrix(trimmed, delimiter);
  checkTableSize(matrix.length, Math.max(0, ...matrix.slice(0, 1000).map((r) => r.length)));
  // Retire les colonnes entièrement vides à droite (sélections Excel trop larges)
  const width = Math.max(...matrix.map((r) => r.length));
  let last = width - 1;
  while (last > 0 && matrix.every((r) => (r[last] ?? "").trim() === "")) last--;
  const cut = matrix.map((r) => r.slice(0, last + 1));
  if (cut.length < 2) throw new Error("Il faut une ligne d'en-têtes et au moins une ligne de données.");
  const rows = matrixToRows(cut);
  return { name, rows, delimiter, note: `Séparateur détecté : ${DELIM_LABEL[delimiter] ?? delimiter}` };
}

function flattenSpanDoc(doc: { marks: Record<string, unknown>[] }): Record<string, unknown>[] {
  return doc.marks.map((m) => {
    const span = (m.span ?? {}) as { start?: unknown; end?: unknown };
    const meta = (m.meta ?? {}) as Record<string, unknown>;
    return {
      id: m.id,
      label: m.label ?? m.id,
      start: span.start,
      end: span.end,
      magnitude: m.magnitude,
      group: m.group ?? "",
      cohort: m.cohort ?? "",
      ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v == null || typeof v !== "object")),
    };
  });
}

/** JSON : tableau d'objets, tableau de tableaux, { data|rows|records: [...] }, ou document span-magnitude. */
export function parseJsonValue(v: unknown): { rows: Record<string, unknown>[]; note?: string } {
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) {
      const matrix = (v as unknown[][]).map((r) => r.map((c) => (c == null ? "" : String(c))));
      return { rows: matrixToRows(matrix), note: "Tableau de tableaux (1re ligne = en-têtes)" };
    }
    const rows = v.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
    if (!rows.length) throw new Error("Le JSON ne contient aucune ligne exploitable.");
    return { rows };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.marks)) {
      return { rows: flattenSpanDoc(o as { marks: Record<string, unknown>[] }), note: "Document span-magnitude aplati" };
    }
    for (const k of ["data", "rows", "records", "items", "values"]) {
      if (Array.isArray(o[k])) return parseJsonValue(o[k]);
    }
  }
  throw new Error("Format JSON non reconnu (attendu : tableau d'objets).");
}

let xlsxMod: typeof import("xlsx") | null = null;
async function xlsx(): Promise<typeof import("xlsx")> {
  if (!xlsxMod) xlsxMod = await import("xlsx");
  return xlsxMod;
}

/** Classeur Excel → lignes de la feuille demandée (ou de la première non vide). */
export async function parseWorkbook(buf: ArrayBuffer, name: string, sheet?: string): Promise<ImportResult> {
  checkFileSize(buf.byteLength);
  const X = await xlsx();
  let wb: import("xlsx").WorkBook;
  try {
    // sheetRows : SheetJS s'arrête après maxRows + 2 lignes (détection du dépassement sans tout charger)
    wb = X.read(buf, { type: "array", cellDates: true, sheetRows: IMPORT_LIMITS.maxRows + 2 });
  } catch (e) {
    throw new Error("Classeur illisible ou corrompu : " + (e instanceof Error ? e.message : String(e)));
  }
  const sheets = wb.SheetNames;
  const pick =
    (sheet && sheets.includes(sheet) && sheet) ||
    sheets.find((s) => {
      const ws = wb.Sheets[s];
      return ws && ws["!ref"];
    }) ||
    sheets[0];
  if (!pick) throw new Error("Classeur vide.");
  const ws = wb.Sheets[pick]!;
  const full = ws["!fullref"] ?? ws["!ref"];
  if (full) {
    const r = X.utils.decode_range(full);
    checkTableSize(r.e.r - r.s.r + 1, r.e.c - r.s.c + 1, `La feuille « ${pick} »`);
  }
  const rows = X.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  if (!rows.length) throw new Error(`La feuille « ${pick} » est vide.`);
  return { name, rows, sheets, sheet: pick, note: sheets.length > 1 ? `Feuille « ${pick} » (${sheets.length} feuilles)` : undefined };
}

export async function readFile(file: File, sheet?: string): Promise<ImportResult> {
  checkFileSize(file.size, `« ${file.name} »`);
  const lower = file.name.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, "");
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm") || lower.endsWith(".ods")) {
    return parseWorkbook(await file.arrayBuffer(), base, sheet);
  }
  const text = await file.text();
  if (lower.endsWith(".json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("JSON invalide : " + (e instanceof Error ? e.message : String(e)));
    }
    return { name: base, ...parseJsonValue(parsed) };
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    return parseText(text, base);
  }
  throw new Error(`Format non pris en charge : ${file.name}. Formats acceptés : CSV, TSV, JSON, XLSX, XLS.`);
}
