/**
 * Détection de la structure d'un tableau « humain » (feuille Excel ou collage) :
 * vraie ligne d'en-têtes (titres, notes et lignes vides ignorés), ligne de temps dans le corps (« Mois » avec dates)
 * ou en-têtes temporels (M1…, janv. 2027, 2027, « Central — 2027 »), lignes de section (libellé seul → « Section »),
 * colonne d'unité, colonne « Ouverture » (valeur avant M1, facultative), nombres et pourcentages français,
 * blocs successifs (nouvel en-tête) et blocs de résumé (« RÉSUMÉ… ») proposés comme tableaux séparés,
 * disposition large (temps en colonnes) → longue (Section, Poste, Unité, Date, Valeur),
 * découpage des libellés répétitifs en Entité + Indicateur (« Commercial salarié n°3 — productivité (ramp) »).
 */
import { parseDateLoose, parseNumberLoose } from "./table";
import type { MCell, Matrix } from "./workbook";

export type Layout = "wide" | "long";

export interface TimeCol {
  col: number;
  /** En-tête affiché (« M1 », « janv. 2027 », « 2027 »). */
  label: string;
  /** Date (ms UTC) si connue. */
  date: number | null;
  /** Rang dans la série (0 = premier mois / année). */
  index: number;
  /** Groupe de colonnes répétées (mêmes dates deux fois : variantes). */
  variant: number;
}

export interface BodyRow {
  /** Identifiant stable (« r12 » = ligne 12 de la feuille). */
  id: string;
  row: number;
  section: string;
  label: string;
  entity: string | null;
  indicator: string | null;
  unit: string;
  opening: number | null;
  /** Valeurs par colonne de temps (disposition large) ou par colonne (longue). */
  values: (number | null)[];
  /** Cellules brutes (disposition longue). */
  cells: MCell[];
}

export interface DetectedTable {
  /** Titre du bloc (ligne de titre au-dessus de l'en-tête, ou nom de la feuille). */
  title: string;
  kind: "main" | "summary" | "block";
  headerRow: number;
  endRow: number;
  headers: string[];
  labelCol: number;
  unitCol: number | null;
  openingCol: number | null;
  layout: Layout;
  timeSource: "row" | "header" | "none";
  timeRow: number | null;
  timeCols: TimeCol[];
  /** Noms de variantes quand les dates se répètent (« Colonnes B–F »). */
  variants: string[];
  rows: BodyRow[];
  sections: string[];
  /** Découpage Entité + Indicateur appliqué. */
  split: boolean;
  /** Lignes de titre / notes ignorées. */
  notes: string[];
  /** Colonnes « longues » (disposition longue) : nom, type. */
  fields: { name: string; col: number; kind: "dimension" | "measure" | "date" }[];
}

export interface Structure {
  tables: DetectedTable[];
  /** Index du tableau principal. */
  main: number;
}

/* ---------------------------------------------------------------- utilitaires */

const isBlank = (v: MCell | undefined) => v == null || (typeof v === "string" && v.trim() === "");
const str = (v: MCell | undefined) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** Nombre au format français ou anglais ; « 26,7% » → 0,267 ; « — », « n/a » → null. */
export function parseFrenchValue(v: MCell | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return null;
  const s = v.trim();
  if (!s || /^[-–—]$/.test(s) || /^(n\/?a|nd|n\.d\.|#n\/a)$/i.test(s) || s.startsWith("#")) return null;
  const pct = /%\s*$/.test(s);
  const n = parseNumberLoose(s, ",");
  if (n == null) return null;
  return pct ? n / 100 : n;
}

const MONTH_INDEX = /^(?:m|mois\s*)(\d{1,3})$/i;
const YEAR_IN = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/;
const TIME_LABEL = /^(mois|date|dates|période|periode|month|months|période\s*\/\s*mois|calendrier)$/i;
const OPENING = /^(ouverture|opening|initial|initiale|début|debut|report|bilan d'ouverture|m0)$/i;
const UNIT_HEADER = /^(unit[ée]s?|units?|u\.?)$/i;
const SUMMARY = /^\s*(r[ée]sum[ée]|summary|synth[èe]se\s+du|total\s+g[ée]n[ée]ral|annexe|kpi\s+de\s+synth)/i;

/** Date d'une cellule de temps (Date, numéro de série Excel, texte « janv. 2027 », « 2027-01 », « T1 2027 »). */
export function cellDate(v: MCell | undefined, allowSerial = true): number | null {
  if (v instanceof Date) return Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  if (typeof v === "number") return allowSerial && v > 20000 && v < 80000 && Number.isInteger(v) ? Math.round((v - 25569) * 86400000) : null;
  if (typeof v === "string") return parseDateLoose(v.trim());
  return null;
}

/** En-tête temporel : « M12 », « janv. 2027 », « 2027 », « Central — 2027 ». */
export function headerTime(h: string): { index: number | null; date: number | null } | null {
  const s = h.trim();
  if (!s) return null;
  const m = MONTH_INDEX.exec(s);
  if (m) return { index: Number(m[1]) - 1, date: null };
  const d = parseDateLoose(s);
  if (d != null) return { index: null, date: d };
  if (/^(19|20)\d{2}$/.test(s)) return { index: null, date: Date.UTC(Number(s), 0, 1) };
  const y = YEAR_IN.exec(s);
  if (y && s.length <= 40) return { index: null, date: Date.UTC(Number(y[1]), 0, 1) };
  return null;
}

/* ---------------------------------------------------------------- détection */

function rowCells(m: Matrix, r: number): MCell[] {
  return m[r] ?? [];
}
function nonEmpty(row: MCell[]): number[] {
  const out: number[] = [];
  row.forEach((v, i) => !isBlank(v) && out.push(i));
  return out;
}

/** Score d'une ligne candidate « en-têtes ». */
function headerScore(m: Matrix, r: number): number {
  const row = rowCells(m, r);
  const filled = nonEmpty(row);
  if (filled.length < 2) return -1;
  const strings = filled.filter((i) => typeof row[i] === "string" && parseFrenchValue(row[i]) == null);
  if (strings.length / filled.length < 0.6) return -1;
  // Les lignes suivantes doivent contenir des données (nombres) dans les colonnes de l'en-tête
  let dataBelow = 0;
  for (let k = r + 1; k < Math.min(m.length, r + 12); k++) {
    const rr = rowCells(m, k);
    for (const i of filled) if (typeof rr[i] === "number" || rr[i] instanceof Date || (typeof rr[i] === "string" && parseFrenchValue(rr[i]) != null)) dataBelow++;
  }
  if (dataBelow === 0) return -1;
  const times = filled.filter((i) => headerTime(str(row[i])) != null).length;
  return strings.length + Math.min(dataBelow, 40) / 4 + (times >= 3 ? 5 : 0);
}

/** Ligne qui ressemble à un nouvel en-tête (surtout du texte hors colonne de libellé). */
function looksLikeHeader(row: MCell[], labelCol: number): boolean {
  const filled = nonEmpty(row).filter((i) => i !== labelCol);
  if (filled.length < 2) return false;
  return filled.every((i) => typeof row[i] === "string" && parseFrenchValue(row[i]) == null && cellDate(row[i]) == null) || filled.filter((i) => headerTime(str(row[i])) != null).length >= 3;
}

function findHeaderRow(m: Matrix, from: number, to: number): number {
  let best = -1;
  let bestScore = 0;
  for (let r = from; r < Math.min(to, from + 40); r++) {
    const s = headerScore(m, r);
    if (s > bestScore + 0.01) {
      best = r;
      bestScore = s;
      // Premier en-tête solide : on s'arrête (les blocs suivants seront détectés à part)
      if (s >= 6) break;
    }
  }
  return best;
}

/** Colonne de libellé : première colonne du bloc majoritairement textuelle. */
function findLabelCol(m: Matrix, header: number, end: number, width: number): number {
  for (let c = 0; c < Math.min(width, 4); c++) {
    let txt = 0;
    let filled = 0;
    for (let r = header + 1; r <= end; r++) {
      const v = rowCells(m, r)[c];
      if (isBlank(v)) continue;
      filled++;
      if (typeof v === "string" && parseFrenchValue(v) == null) txt++;
    }
    if (filled && txt / filled >= 0.6) return c;
  }
  return 0;
}

function variantName(cols: TimeCol[], v: number): string {
  const cs = cols.filter((t) => t.variant === v);
  const letter = (c: number) => {
    let s = "";
    let n = c + 1;
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  return cs.length ? `Colonnes ${letter(cs[0]!.col)}–${letter(cs[cs.length - 1]!.col)}` : `Variante ${v + 1}`;
}

/** Détecte tous les tableaux d'une feuille (bloc principal, blocs suivants, résumés). */
export function detectStructure(m: Matrix, sheetName = "Feuille"): Structure {
  const tables: DetectedTable[] = [];
  let from = 0;
  let guard = 0;
  while (from < m.length && guard++ < 30) {
    const b = detectBlock(m, from, sheetName, tables.length === 0);
    if (!b) break;
    const t = b.table;
    if (t.rows.length) tables.push(t, ...b.extras);
    from = Math.max(t.endRow + 1, from + 1);
    if (b.summaryAt !== null) {
      const kv = detectKeyValue(m, b.summaryAt);
      if (kv) {
        tables.push(kv);
        from = kv.endRow + 1;
      } else from = b.summaryAt + 1;
    }
  }
  let main = 0;
  let best = -1;
  tables.forEach((t, i) => {
    const cells = t.rows.reduce((s, r) => s + r.values.filter((v) => v != null).length, 0);
    const w = cells * (t.kind === "summary" ? 0.3 : 1) * (t.layout === "wide" ? 1.2 : 1);
    if (w > best) {
      best = w;
      main = i;
    }
  });
  tables.forEach((t, i) => {
    if (t.kind !== "summary") t.kind = i === main ? "main" : "block";
  });
  return { tables, main };
}

interface BlockResult {
  table: DetectedTable;
  extras: DetectedTable[];
  summaryAt: number | null;
}

function detectBlock(m: Matrix, from: number, sheetName: string, first: boolean): BlockResult | null {
  const header = findHeaderRow(m, from, m.length);
  if (header < 0) return null;
  const notes: string[] = [];
  let title = "";
  for (let r = from; r < header; r++) {
    const t = nonEmpty(rowCells(m, r)).map((i) => str(rowCells(m, r)[i])).join(" ");
    if (t) {
      notes.push(t);
      title = t;
    }
  }
  if (!title || title.length > 90) title = first ? sheetName : title.slice(0, 90);
  const hdr = rowCells(m, header);
  const width = Math.max(hdr.length, ...m.slice(header, header + 30).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, c) => str(hdr[c]));
  const isSummaryTitle = SUMMARY.test(title);

  // Fin provisoire du bloc : nouvel en-tête, marqueur de résumé, ou fin de feuille
  let end = m.length - 1;
  let labelCol = 0;
  let summaryAt: number | null = null;
  {
    // Libellé provisoire sur 40 lignes
    labelCol = findLabelCol(m, header, Math.min(m.length - 1, header + 40), width);
    let sawData = false;
    let prevBreak = false; // ligne vide ou ligne à libellé seul juste avant
    for (let r = header + 1; r < m.length; r++) {
      const row = rowCells(m, r);
      const filled = nonEmpty(row);
      if (!filled.length) {
        prevBreak = true;
        continue;
      }
      const label = str(row[labelCol]);
      if (sawData && SUMMARY.test(label) && filled.length <= 2) {
        end = r - 1;
        summaryAt = r;
        break;
      }
      if (sawData && prevBreak && looksLikeHeader(row, labelCol)) {
        // Titres / notes du bloc suivant (lignes à libellé seul juste au-dessus du nouvel en-tête) exclus
        let e = r - 1;
        let skipped = 0;
        while (e > header) {
          const n = nonEmpty(rowCells(m, e)).length;
          if (n === 0) e--;
          else if (n === 1 && skipped < 3) {
            e--;
            skipped++;
          } else break;
        }
        end = e;
        break;
      }
      const dataRow = filled.some((i) => i !== labelCol);
      if (dataRow) sawData = true;
      prevBreak = !dataRow;
    }
  }
  while (end > header && nonEmpty(rowCells(m, end)).length === 0) end--;
  labelCol = findLabelCol(m, header, end, width);

  // Colonnes : unité, ouverture, temps
  let unitCol: number | null = null;
  let openingCol: number | null = null;
  for (let c = 0; c < width; c++) {
    if (c === labelCol) continue;
    if (unitCol === null && UNIT_HEADER.test(headers[c]!)) unitCol = c;
    if (openingCol === null && OPENING.test(headers[c]!)) openingCol = c;
  }
  if (unitCol === null && labelCol + 1 < width && !headers[labelCol + 1]) {
    // Colonne sans en-tête juste après le libellé, remplie de courtes chaînes (« % », « € », « mois »)
    let short = 0;
    let filled = 0;
    for (let r = header + 1; r <= end; r++) {
      const v = rowCells(m, r)[labelCol + 1];
      if (isBlank(v)) continue;
      filled++;
      if (typeof v === "string" && v.trim().length <= 10 && parseFrenchValue(v) == null) short++;
    }
    if (filled >= 3 && short / filled >= 0.7) unitCol = labelCol + 1;
  }

  // Ligne de temps dans le corps (« Mois » avec dates)
  let timeRow: number | null = null;
  for (let r = header + 1; r <= Math.min(end, header + 15); r++) {
    const row = rowCells(m, r);
    if (!TIME_LABEL.test(str(row[labelCol]))) continue;
    let dates = 0;
    let filled = 0;
    for (let c = 0; c < width; c++) {
      if (c === labelCol || c === unitCol || c === openingCol || isBlank(row[c])) continue;
      filled++;
      if (cellDate(row[c]) != null) dates++;
    }
    if (filled >= 3 && dates / filled >= 0.8) {
      timeRow = r;
      break;
    }
  }

  // Colonnes de temps (en-têtes temporels, ou ligne de temps)
  let timeCols: TimeCol[] = [];
  const cand: TimeCol[] = [];
  for (let c = 0; c < width; c++) {
    if (c === labelCol || c === unitCol || c === openingCol) continue;
    const ht = headerTime(headers[c]!);
    const rowDate = timeRow !== null ? cellDate(rowCells(m, timeRow)[c]) : null;
    if (ht || rowDate != null) cand.push({ col: c, label: headers[c] || "", date: rowDate ?? ht?.date ?? null, index: ht?.index ?? cand.length, variant: 0 });
  }
  // Une seule granularité : les colonnes M1…M60 (ou mois datés) d'un côté, les totaux annuels (2027…) de l'autre
  const kindOf = (t: TimeCol) => {
    const h = headers[t.col]!;
    if (MONTH_INDEX.test(h)) return "index";
    if (/^(19|20)\d{2}$/.test(h.trim()) || (YEAR_IN.test(h) && parseDateLoose(h) == null)) return "year";
    return "date";
  };
  const groups = new Map<string, TimeCol[]>();
  for (const t of cand) {
    const k = kindOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  let extraYears: TimeCol[] = [];
  if (groups.size > 1) {
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    const keep = sorted[0]![1];
    const yearGroup = sorted.find(([k]) => k === "year" && sorted[0]![0] !== "year");
    if (yearGroup && yearGroup[1].length >= 3) extraYears = yearGroup[1].map((t) => ({ ...t, date: headerTime(headers[t.col]!)?.date ?? null }));
    cand.length = 0;
    cand.push(...keep);
  }
  const timeSource: DetectedTable["timeSource"] = timeRow !== null ? "row" : cand.length >= 3 ? "header" : "none";
  const others = width - 1 - (unitCol !== null ? 1 : 0) - (openingCol !== null ? 1 : 0) - extraYears.length;
  if (cand.length >= 3 && cand.length >= others * 0.6) timeCols = cand;
  const layout: Layout = timeCols.length >= 3 ? "wide" : "long";

  // Variantes : mêmes dates répétées (Synthèse : 2027…2031 deux fois)
  const variants: string[] = [];
  if (layout === "wide") {
    const seen = new Map<number, number>();
    let variant = 0;
    let lastDate = -Infinity;
    for (const t of timeCols) {
      if (t.date != null) {
        if (t.date <= lastDate && seen.has(t.date)) variant++;
        seen.set(t.date, (seen.get(t.date) ?? 0) + 1);
        lastDate = t.date;
      }
      t.variant = variant;
      if (!t.label) t.label = t.date != null ? new Date(t.date).toISOString().slice(0, 7) : `C${t.col + 1}`;
    }
    const nv = variant + 1;
    for (let v = 0; v < nv; v++) variants.push(nv > 1 ? variantName(timeCols, v) : "");
    // Index dans la variante
    for (let v = 0; v < nv; v++) timeCols.filter((t) => t.variant === v).forEach((t, i) => (t.index = i));
  }

  // Corps : sections, lignes de données
  const rows: BodyRow[] = [];
  const sections: string[] = [];
  let section = "";
  const valueCols = layout === "wide" ? timeCols.map((t) => t.col) : headers.map((_, c) => c).filter((c) => c !== labelCol && c !== unitCol);
  for (let r = header + 1; r <= end; r++) {
    if (r === timeRow) continue;
    const row = rowCells(m, r);
    const filled = nonEmpty(row);
    if (!filled.length) continue;
    const label = str(row[labelCol]);
    const others = filled.filter((i) => i !== labelCol && i !== unitCol);
    if (label && others.length === 0) {
      // Libellé seul : section (courte) ou note (longue)
      if (label.length <= 80 && !/^(lecture|note|nb|n\.b\.|source)\b/i.test(label)) {
        section = label;
        if (!sections.includes(label)) sections.push(label);
      }
      continue;
    }
    if (!label && layout === "wide") continue;
    const values = valueCols.map((c) => parseFrenchValue(row[c]));
    if (layout === "wide" && values.every((v) => v == null)) continue;
    rows.push({
      id: `r${r + 1}`,
      row: r,
      section,
      label: label || `Ligne ${r + 1}`,
      entity: null,
      indicator: null,
      unit: unitCol !== null ? str(row[unitCol]) : "",
      opening: openingCol !== null ? parseFrenchValue(row[openingCol]) : null,
      values,
      cells: row,
    });
  }

  const split = layout === "wide" ? splitLabels(rows) : false;
  const usedSections = sections.filter((sec) => rows.some((r) => r.section === sec));

  // Champs (disposition longue)
  const fields: DetectedTable["fields"] = [];
  if (layout === "long") {
    const used = new Set<string>();
    const uniq = (n: string) => {
      let k = n || "Colonne";
      let i = 2;
      while (used.has(k)) k = `${n} (${i++})`;
      used.add(k);
      return k;
    };
    for (let c = 0; c < width; c++) {
      let num = 0;
      let dates = 0;
      let filled = 0;
      for (const br of rows) {
        const v = br.cells[c];
        if (isBlank(v)) continue;
        filled++;
        if (v instanceof Date || (TIME_LABEL.test(headers[c]!) && cellDate(v) != null)) dates++;
        else if (parseFrenchValue(v) != null) num++;
      }
      if (!filled) continue;
      const kind = dates / filled >= 0.8 ? "date" : num / filled >= 0.8 && c !== labelCol ? "measure" : "dimension";
      fields.push({ name: uniq(headers[c] || (c === labelCol ? "Libellé" : `Colonne ${c + 1}`)), col: c, kind });
    }
  }

  const table: DetectedTable = {
    title,
    kind: isSummaryTitle ? "summary" : "block",
    headerRow: header,
    endRow: end,
    headers,
    labelCol,
    unitCol,
    openingCol,
    layout,
    timeSource,
    timeRow,
    timeCols,
    variants,
    rows,
    sections: usedSections,
    split,
    notes,
    fields,
  };
  // Totaux annuels (colonnes 2027…2031 à droite d'un plan mensuel) : tableau séparé
  const extras: DetectedTable[] = [];
  if (layout === "wide" && extraYears.length >= 3) {
    extraYears.forEach((t, i) => {
      t.index = i;
      t.variant = 0;
      t.label = headers[t.col] || t.label;
    });
    const yRows = rows
      .map((br) => ({ ...br, values: extraYears.map((t) => parseFrenchValue(br.cells[t.col])) }))
      .filter((br) => br.values.some((v) => v != null));
    if (yRows.length)
      extras.push({ ...table, title: `${title} — totaux annuels`, kind: "block", timeSource: "header", timeRow: null, timeCols: extraYears, variants: [""], rows: yRows, sections: usedSections.filter((sec) => yRows.some((r) => r.section === sec)), openingCol: null });
  }
  return { table, extras, summaryAt };
}

/** Bloc « clé → valeur » sans en-tête (résumé en bas de feuille : libellé, puis une valeur). */
function detectKeyValue(m: Matrix, start: number): DetectedTable | null {
  const title = nonEmpty(rowCells(m, start)).map((i) => str(rowCells(m, start)[i])).join(" ");
  const rows: BodyRow[] = [];
  let end = start;
  let blank = 0;
  let section = "";
  const sections: string[] = [];
  for (let r = start + 1; r < m.length; r++) {
    const row = rowCells(m, r);
    const filled = nonEmpty(row);
    if (!filled.length) {
      if (++blank >= 2 && rows.length) break;
      continue;
    }
    blank = 0;
    const label = str(row[filled[0]!]);
    const rest = filled.slice(1);
    if (!rest.length) {
      section = label;
      sections.push(label);
      continue;
    }
    const v = row[rest[0]!];
    const num = parseFrenchValue(v);
    rows.push({ id: `r${r + 1}`, row: r, section, label, entity: null, indicator: null, unit: "", opening: null, values: [num], cells: [label, num ?? (v instanceof Date ? v : str(v))] });
    end = r;
  }
  if (!rows.length) return null;
  const textVals = rows.filter((r) => r.values[0] == null).length;
  return {
    title: title.slice(0, 90),
    kind: "summary",
    headerRow: start,
    endRow: end,
    headers: ["Indicateur", "Valeur"],
    labelCol: 0,
    unitCol: null,
    openingCol: null,
    layout: "long",
    timeSource: "none",
    timeRow: null,
    timeCols: [],
    variants: [],
    rows,
    sections: sections.filter((sec) => rows.some((r) => r.section === sec)),
    split: false,
    notes: [],
    fields: [
      { name: "Indicateur", col: 0, kind: "dimension" },
      { name: "Valeur", col: 1, kind: textVals > rows.length / 2 ? "dimension" : "measure" },
    ],
  };
}

/* ---------------------------------------------------------------- Entité + Indicateur */

const ENTITY_NUM = /^(.*?\b(?:n°|no\.?|nº|#)\s*\d+)\s*(?:[—–-]\s*)?(.+)$/i;
const DASH_SPLIT = /^(.+?)\s+[—–]\s+(.+)$/;

/**
 * Découpe « Commercial salarié n°3 — productivité (ramp) » / « … n°3 en poste (1/0) » en Entité + Indicateur
 * quand le motif se répète (≥ 2 entités partageant ≥ 1 indicateur). Modifie les lignes ; renvoie vrai si appliqué.
 */
export function splitLabels(rows: { label: string; entity: string | null; indicator: string | null }[]): boolean {
  const parts = rows.map((r) => {
    const m = ENTITY_NUM.exec(r.label) ?? DASH_SPLIT.exec(r.label);
    return m ? { entity: m[1]!.trim(), indicator: m[2]!.trim() } : null;
  });
  const byInd = new Map<string, Set<string>>();
  parts.forEach((p) => {
    if (!p) return;
    if (!byInd.has(p.indicator)) byInd.set(p.indicator, new Set());
    byInd.get(p.indicator)!.add(p.entity);
  });
  const repeated = new Set([...byInd].filter(([, ents]) => ents.size >= 2).map(([k]) => k));
  if (!repeated.size) return false;
  // Entités : celles qui portent au moins un indicateur répété
  const entities = new Set<string>();
  parts.forEach((p) => p && repeated.has(p.indicator) && entities.add(p.entity));
  if (entities.size < 2) return false;
  let applied = 0;
  rows.forEach((r, i) => {
    const p = parts[i];
    if (p && entities.has(p.entity) && repeated.has(p.indicator)) {
      r.entity = p.entity;
      r.indicator = p.indicator;
      applied++;
    }
  });
  return applied >= 4;
}

/* ---------------------------------------------------------------- large → long */

export interface LongField {
  name: string;
  kind: "dimension" | "measure" | "date";
}
export interface LongRow {
  [k: string]: string | number | null;
}
export interface LongTable {
  name: string;
  fields: LongField[];
  /** Lignes longues ; `_id` = identifiant de ligne d'origine, `_t` = rang temporel. */
  rows: LongRow[];
  /** Vue large (lignes = postes, colonnes = dates) quand le tableau d'origine est large. */
  wide: WideView | null;
}
export interface WideView {
  rows: { id: string; label: string; section: string; entity: string | null; indicator: string | null; unit: string }[];
  cols: { key: string; label: string; date: number | null; variant: string; opening?: boolean }[];
  /** valeur[rowIndex][colIndex]. */
  values: (number | null)[][];
}

export const F = { section: "Section", poste: "Poste", entity: "Entité", indicator: "Indicateur", unit: "Unité", date: "Date", period: "Période", variant: "Variante", value: "Valeur" } as const;

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function periodLabel(t: TimeCol, monthly: boolean): string {
  if (t.date == null) return t.label;
  const d = new Date(t.date);
  return monthly ? `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(d.getUTCFullYear());
}
function isMonthly(cols: TimeCol[]): boolean {
  const ds = cols.map((c) => c.date).filter((d): d is number => d != null);
  if (ds.length < 2) return false;
  const gaps = ds.slice(1).map((d, i) => d - ds[i]!).filter((g) => g > 0);
  const med = gaps.sort((a, b) => a - b)[gaps.length >> 1] ?? 0;
  return med > 0 && med < 40 * 86400000;
}

/** Tableau détecté → table longue (+ vue large). `opening` : inclure la colonne Ouverture (Période « Ouverture », sans date). */
export function toLongTable(t: DetectedTable, name: string, opts: { opening?: boolean } = {}): LongTable {
  if (t.layout === "long") {
    const fields: LongField[] = [];
    if (t.sections.length) fields.push({ name: F.section, kind: "dimension" });
    fields.push(...t.fields.map((f) => ({ name: f.name, kind: f.kind })));
    if (t.unitCol !== null && !t.fields.some((f) => f.col === t.unitCol)) fields.push({ name: F.unit, kind: "dimension" });
    const rows: LongRow[] = t.rows.map((br, i) => {
      const o: LongRow = { _id: br.id, _t: i };
      if (t.sections.length) o[F.section] = br.section;
      for (const f of t.fields) {
        const v = br.cells[f.col];
        o[f.name] = f.kind === "measure" ? parseFrenchValue(v) : f.kind === "date" ? cellDate(v) : isBlank(v) ? null : str(v);
      }
      return o;
    });
    return { name, fields, rows, wide: null };
  }
  const monthly = isMonthly(t.timeCols);
  const multiVariant = t.variants.length > 1;
  const fields: LongField[] = [];
  if (t.sections.length) fields.push({ name: F.section, kind: "dimension" });
  fields.push({ name: F.poste, kind: "dimension" });
  if (t.split) fields.push({ name: F.entity, kind: "dimension" }, { name: F.indicator, kind: "dimension" });
  if (t.unitCol !== null) fields.push({ name: F.unit, kind: "dimension" });
  if (multiVariant) fields.push({ name: F.variant, kind: "dimension" });
  const hasDates = t.timeCols.some((c) => c.date != null);
  if (hasDates) fields.push({ name: F.date, kind: "date" });
  fields.push({ name: F.period, kind: "dimension" }, { name: F.value, kind: "measure" });

  const rows: LongRow[] = [];
  const wideRows: WideView["rows"] = [];
  const wideVals: (number | null)[][] = [];
  const cols: WideView["cols"] = [];
  const withOpening = !!opts.opening && t.openingCol !== null;
  if (withOpening) cols.push({ key: "ouverture", label: "Ouverture", date: null, variant: "", opening: true });
  t.timeCols.forEach((c) => cols.push({ key: `c${c.col}`, label: periodLabel(c, monthly) + (multiVariant ? ` · ${t.variants[c.variant]}` : ""), date: c.date, variant: multiVariant ? t.variants[c.variant]! : "" }));
  for (const br of t.rows) {
    const base: LongRow = { _id: br.id };
    if (t.sections.length) base[F.section] = br.section;
    base[F.poste] = br.label;
    if (t.split) {
      base[F.entity] = br.entity;
      base[F.indicator] = br.indicator ?? br.label;
    }
    if (t.unitCol !== null) base[F.unit] = br.unit;
    const vals: (number | null)[] = [];
    if (withOpening) {
      rows.push({ ...base, ...(multiVariant ? { [F.variant]: "" } : {}), ...(hasDates ? { [F.date]: null } : {}), [F.period]: "Ouverture", [F.value]: br.opening, _t: -1 });
      vals.push(br.opening);
    }
    t.timeCols.forEach((c, i) => {
      const v = br.values[i] ?? null;
      vals.push(v);
      const o: LongRow = { ...base, _t: c.index };
      if (multiVariant) o[F.variant] = t.variants[c.variant]!;
      if (hasDates) o[F.date] = c.date;
      o[F.period] = c.date != null ? periodLabel(c, monthly) : c.label;
      o[F.value] = v;
      rows.push(o);
    });
    wideRows.push({ id: br.id, label: br.label, section: br.section, entity: br.entity, indicator: br.indicator, unit: br.unit });
    wideVals.push(vals);
  }
  return { name, fields, rows, wide: { rows: wideRows, cols, values: wideVals } };
}
