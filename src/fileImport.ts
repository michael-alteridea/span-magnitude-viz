/**
 * Lightweight tabular → span-magnitude document helpers (JSON / CSV / Excel rows).
 * Excel binary parsing is left to the host (SheetJS); this module maps row objects.
 */

export interface ColumnMapping {
  /** Unique id column (optional — synthetic ids if missing). */
  id?: string | null;
  label?: string | null;
  /** Span start column (date ISO or number). */
  start: string;
  /** Span end column. Mutually exclusive with duration when both set — end wins. */
  end?: string | null;
  /** Duration column; end = start + duration when end is absent. */
  duration?: string | null;
  magnitude: string;
  cohort?: string | null;
  group?: string | null;
  /** Extra columns copied into meta. */
  meta?: string[];
  /** Optional color field hint (stored in meta.__colorBy if useful). */
  colorField?: string | null;
  facetField?: string | null;
  /** Latitude column (WGS84). Prefer with lon for map mode. */
  lat?: string | null;
  /** Longitude column (WGS84). */
  lon?: string | null;
  /** FR (5-digit) / BE (4-digit) postal code column — offline lookup. */
  postal?: string | null;
  /** Place-name column (Burundi basemap: province name, short or official) → `meta.place`. */
  place?: string | null;
}

export interface ImportDocumentOptions {
  unit?: "date" | "number";
  title?: string;
  magnitudeLabel?: string;
  spanLabel?: string;
  countLabel?: string;
  mapping: ColumnMapping;
}

function cell(row: Record<string, unknown>, key: string | null | undefined): unknown {
  if (!key) return undefined;
  if (key in row) return row[key];
  // case-insensitive fallback
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function excelSerialToIso(n: number): string {
  // Excel serial date (days since 1899-12-30), UTC
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function coerceEndpoint(v: unknown, unit: "date" | "number"): string | number | null {
  if (v == null || v === "") return null;
  if (unit === "number") {
    const n = asNumber(v);
    return n;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristic: Excel serial (~30000–60000) vs unix ms
    if (v > 20000 && v < 60000) return excelSerialToIso(v);
    if (v > 1e11) return new Date(v).toISOString().slice(0, 10);
    return excelSerialToIso(v);
  }
  const s = asString(v);
  if (!s) return null;
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

/**
 * Split delimited text (CSV / TSV / « ; ») into a matrix of raw string cells.
 * RFC-4180 quoting (double quotes, "" escape), CRLF/LF, BOM stripped, blank lines skipped.
 */
export function parseDelimitedMatrix(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && cur === "") {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

/**
 * Guess the delimiter of pasted / exported tabular text.
 * Tab wins when present (Excel / Google Sheets copy), else the most consistent of « ; » and « , ».
 */
export function detectDelimiter(text: string): "\t" | ";" | "," {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 20);
  if (!lines.length) return ",";
  const count = (line: string, d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  if (lines.some((l) => l.includes("\t"))) return "\t";
  const score = (d: string) => {
    const counts = lines.map((l) => count(l, d));
    const head = counts[0]!;
    if (head === 0) return 0;
    const consistent = counts.filter((c) => c === head).length / counts.length;
    return head * consistent;
  };
  return score(";") >= score(",") && score(";") > 0 ? ";" : ",";
}

/** Matrix (header row first) → row objects. Empty / duplicate headers are renamed. */
export function matrixToRows(matrix: string[][]): Record<string, unknown>[] {
  if (matrix.length < 2) return [];
  const seen = new Map<string, number>();
  const headers = matrix[0]!.map((h, i) => {
    let name = h.trim() || `Colonne ${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return name;
  });
  return matrix.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });
}

/** Parse delimited text into row objects (header row required). */
export function parseDelimited(text: string, delimiter?: string): Record<string, unknown>[] {
  return matrixToRows(parseDelimitedMatrix(text, delimiter ?? detectDelimiter(text)));
}

/** Parse CSV text into row objects (header row required). */
export function parseCsv(text: string): Record<string, unknown>[] {
  const matrix = parseDelimitedMatrix(text, ",");
  if (matrix.length < 2) return [];
  const headers = matrix[0]!.map((h) => h.trim());
  return matrix.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });
}

/** True when a header looks like an identifier, not a measure. */
export function isIdLikeColumnName(name: string): boolean {
  const l = name.toLowerCase().trim();
  if (!l) return false;
  if (l === "id" || l === "key" || l === "uuid" || l === "guid") return true;
  // "Strike ID", "Bureau ID", "record_id", "id_strike"
  if (/(^|[\s_-])id([\s_-]|$)/.test(l)) return true;
  if (/\b(uuid|guid)\b/.test(l)) return true;
  return false;
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match header names with exact > token/word-boundary preference.
 * Never uses bare substring includes for short needles (avoids "to"∈"Total").
 */
function findHeader(
  columns: { raw: string; l: string }[],
  needles: string[],
  opts?: { exclude?: (raw: string) => boolean }
): string | null {
  const excl = opts?.exclude;
  const pool = excl ? columns.filter((c) => !excl(c.raw)) : columns;
  // 1) exact match
  for (const n of needles) {
    const hit = pool.find((c) => c.l === n);
    if (hit) return hit.raw;
  }
  // 2) whole-token / word-boundary (underscores, hyphens, spaces)
  for (const n of needles) {
    if (n.length < 2) continue;
    const re = new RegExp(`(?:^|[\\s_-])${escapeRegExp(n)}(?:$|[\\s_-])`, "i");
    const hit = pool.find((c) => re.test(c.l) || c.l === n);
    if (hit) return hit.raw;
  }
  // 3) longer needles (≥4) may use includes; short ones must not
  for (const n of needles) {
    if (n.length < 4) continue;
    const hit = pool.find((c) => c.l.includes(n));
    if (hit) return hit.raw;
  }
  return null;
}

/** Guess a reasonable column mapping from header names. */
export function guessMapping(columns: string[]): ColumnMapping {
  const lower = columns.map((c) => ({ raw: c, l: c.toLowerCase() }));
  const notId = (raw: string) => isIdLikeColumnName(raw);

  const start =
    findHeader(lower, [
      "date_start",
      "span_start",
      "start_date",
      "start",
      "begin",
      "début",
      "debut",
      "date",
      "from",
    ]) ??
    columns[0] ??
    "start";

  const end = findHeader(
    lower,
    ["date_end", "span_end", "end_date", "finish", "end", "fin", "until", "to"],
    { exclude: (raw) => raw === start || notId(raw) }
  );

  const duration = findHeader(
    lower,
    ["duration", "durée", "duree", "days", "day_count", "terme", "length", "span_days"],
    { exclude: (raw) => raw === start || raw === end || notId(raw) }
  );

  const magnitude =
    findHeader(
      lower,
      [
        "magnitude",
        "budget",
        "amount",
        "acv",
        "cost",
        "montant",
        "value",
        "killed",
        "deaths",
        "casualties",
        "total",
        "count",
        "score",
        "revenue",
        "prix",
      ],
      { exclude: notId }
    ) ??
    columns.find((c) => c !== start && c !== end && c !== duration && !isIdLikeColumnName(c)) ??
    columns.find((c) => c !== start) ??
    "magnitude";

  const id = findHeader(lower, ["strike id", "bureau id", "uuid", "guid", "id", "key"]);
  const label = findHeader(lower, [
    "label",
    "name",
    "title",
    "projet",
    "project",
    "target group",
    "target",
  ]);
  const cohort = findHeader(lower, ["cohort", "year", "annee", "année", "vintage"]);
  const group = findHeader(lower, [
    "group",
    "category",
    "type",
    "segment",
    "groupe",
    "target group",
    "target",
  ]);

  const lat = findHeader(lower, ["latitude", "lat"]);
  const lon = findHeader(lower, ["longitude", "lng", "lon", "long"]);
  const postal = findHeader(lower, [
    "code_postal",
    "codepostal",
    "postal_code",
    "postalcode",
    "postal",
    "zip",
    "zipcode",
    "cp",
  ]);

  const reserved = new Set(
    [start, end, duration, magnitude, id, label, cohort, group, lat, lon, postal].filter(
      Boolean
    ) as string[]
  );
  const meta = columns.filter((c) => !reserved.has(c));

  // Point events: only one temporal column → reuse as end (zero-length / same-day span)
  let resolvedEnd = end;
  let resolvedDuration: string | null = end ? null : duration;
  if (!resolvedEnd && !resolvedDuration) {
    const dateish = lower.find(
      (c) =>
        c.raw === start ||
        /\bdate\b/.test(c.l) ||
        c.l.includes("start") ||
        c.l.includes("début") ||
        c.l.includes("debut")
    );
    if (dateish) {
      resolvedEnd = start;
      resolvedDuration = null;
    }
  }

  return {
    id,
    label,
    start,
    end: resolvedEnd,
    duration: resolvedDuration,
    magnitude,
    cohort,
    group,
    lat,
    lon,
    postal,
    meta: meta.slice(0, 12),
  };
}

/**
 * Map tabular rows to a span-magnitude document (version 1).
 * Does not validate — pass through parseDocument / tryParseDocument next.
 */
export function rowsToDocument(
  rows: Record<string, unknown>[],
  options: ImportDocumentOptions
): Record<string, unknown> {
  const unit = options.unit ?? "date";
  const m = options.mapping;
  const marks: Record<string, unknown>[] = [];

  rows.forEach((row, i) => {
    const start = coerceEndpoint(cell(row, m.start), unit);
    let end = m.end ? coerceEndpoint(cell(row, m.end), unit) : null;
    if (end == null && m.duration) {
      const dur = asNumber(cell(row, m.duration));
      if (start != null && dur != null) {
        if (unit === "number" && typeof start === "number") {
          end = start + dur;
        } else if (unit === "date" && typeof start === "string") {
          const t = Date.parse(start);
          if (!Number.isNaN(t)) {
            // duration as days
            end = new Date(t + dur * 86400000).toISOString().slice(0, 10);
          }
        }
      }
    }
    const mag = asNumber(cell(row, m.magnitude));
    if (start == null || end == null || mag == null) return;

    const idRaw = m.id ? asString(cell(row, m.id)) : "";
    const id = idRaw || `row-${i + 1}`;
    const label = m.label ? asString(cell(row, m.label)) || id : id;
    const mark: Record<string, unknown> = {
      id,
      label,
      span: { start, end },
      magnitude: Math.max(0, mag),
    };
    if (m.cohort) {
      const c = cell(row, m.cohort);
      if (c != null && asString(c) !== "") mark.cohort = asString(c);
    }
    if (m.group) {
      const g = cell(row, m.group);
      if (g != null && asString(g) !== "") mark.group = asString(g);
    }
    const meta: Record<string, unknown> = {};
    for (const key of m.meta ?? []) {
      const v = cell(row, key);
      if (v === undefined || v === "") continue;
      const n = asNumber(v);
      meta[key] = n != null && String(v).trim() !== "" && !Number.isNaN(Number(String(v).replace(/,/g, "")))
        ? n
        : asString(v);
    }
    if (m.lat) {
      const v = cell(row, m.lat);
      const n = asNumber(v);
      if (n != null) meta.lat = n;
      else if (asString(v)) meta.lat = asString(v);
    }
    if (m.lon) {
      const v = cell(row, m.lon);
      const n = asNumber(v);
      if (n != null) meta.lon = n;
      else if (asString(v)) meta.lon = asString(v);
    }
    if (m.postal) {
      const v = cell(row, m.postal);
      if (v != null && asString(v) !== "") meta.postal = asString(v);
    }
    if (m.place) {
      const v = cell(row, m.place);
      if (v != null && asString(v) !== "") meta.place = asString(v);
    }
    if (Object.keys(meta).length) mark.meta = meta;
    marks.push(mark);
  });

  return {
    version: 1,
    unit,
    title: options.title ?? "Imported data",
    magnitudeLabel: options.magnitudeLabel ?? "Magnitude",
    spanLabel: options.spanLabel ?? "Span",
    countLabel: options.countLabel ?? "Items",
    defaults: {
      geometry: "arc",
      colorScheme: "altairady",
      animate: true,
      tickers: ["count", "magnitudeSum"],
    },
    marks,
  };
}

export function columnsFromRows(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) set.add(k);
  }
  return [...set];
}

/** Detected scalar type for a column. */
export type DetectedType = "date" | "number" | "string" | "boolean";

/** Suitability of a column for a visualization role. */
export type Suitability = "good" | "ok" | "bad";

/** Roles a column may fill in the span-magnitude mapping. */
export type FieldRole =
  | "spanStart"
  | "spanEnd"
  | "duration"
  | "magnitude"
  | "color"
  | "facet"
  | "label"
  | "id"
  | "lat"
  | "lon"
  | "postal";

export const FIELD_ROLES: readonly FieldRole[] = [
  "spanStart",
  "spanEnd",
  "duration",
  "magnitude",
  "color",
  "facet",
  "label",
  "id",
  "lat",
  "lon",
  "postal",
] as const;

/** French labels for field roles (UI). */
export const FIELD_ROLE_LABELS_FR: Record<FieldRole, string> = {
  spanStart: "Début (span)",
  spanEnd: "Fin (span)",
  duration: "Durée",
  magnitude: "Magnitude (verticale)",
  color: "Couleur",
  facet: "Facettes / groupe",
  label: "Libellé",
  id: "Identifiant",
  lat: "Latitude",
  lon: "Longitude",
  postal: "Code postal (FR/BE)",
};

export interface RoleSuitability {
  role: FieldRole;
  suitability: Suitability;
  /** Short FR reason shown on hover. */
  reason: string;
}

export interface ColumnAnalysis {
  name: string;
  type: DetectedType;
  /** Distinct non-empty values. */
  cardinality: number;
  nullCount: number;
  rowCount: number;
  /** Up to a few sample string representations. */
  sampleValues: string[];
  /** Fraction of non-null values that parse as number / date / boolean. */
  numericRate: number;
  dateRate: number;
  booleanRate: number;
  roles: RoleSuitability[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const BOOL_SET = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "oui",
  "non",
  "0",
  "1",
]);

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return true;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial or unix ms / seconds — not plain magnitudes
    if (v > 20000 && v < 60000) return true;
    if (v > 1e11 && v < 2e13) return true;
    if (v > 1e9 && v < 2e10) return true;
    return false;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return false;
    if (DATE_RE.test(s)) return true;
    // Reject pure numerics (budgets, ids) — Date.parse("100000") is truthy
    if (/^[+-]?\d+(?:[.,]\d+)?([eE][+-]?\d+)?$/.test(s)) return false;
    // Require a date-like separator or month name before trusting Date.parse
    if (!/[/-]/.test(s) && !/[a-zA-Z]{3,}/.test(s)) return false;
    const t = Date.parse(s);
    return !Number.isNaN(t);
  }
  return false;
}

function looksLikeNumber(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "boolean") return false;
  if (v instanceof Date) return false;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "").replace(/\s/g, "");
    if (!s || /[a-zA-Z]/.test(s.replace(/[eE.+-]/g, ""))) return false;
    const n = Number(s);
    return Number.isFinite(n);
  }
  return false;
}

function looksLikeBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return true;
  if (typeof v === "string") return BOOL_SET.has(v.trim().toLowerCase());
  if (v === 0 || v === 1) return true;
  return false;
}

function sampleStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v == null) return "";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

function detectType(
  dateRate: number,
  numericRate: number,
  booleanRate: number
): DetectedType {
  if (booleanRate >= 0.85 && dateRate < 0.3) return "boolean";
  if (dateRate >= 0.6) return "date";
  if (numericRate >= 0.7) return "number";
  return "string";
}

function looksLikeTemporalNumericColumn(
  type: DetectedType,
  dateRate: number,
  numericRate: number,
  temporalNumericRate: number
): boolean {
  if (type === "date" || dateRate >= 0.6) return true;
  // Excel serials / epoch — not small integer counts
  return temporalNumericRate >= 0.6 && numericRate >= 0.6;
}

function suitabilityFor(
  role: FieldRole,
  type: DetectedType,
  cardinality: number,
  rowCount: number,
  numericRate: number,
  dateRate: number,
  columnName: string,
  temporalNumericRate = 0,
  ctx?: { startIsDate?: boolean }
): RoleSuitability {
  const uniq = rowCount > 0 ? cardinality / rowCount : 0;
  const idLike = isIdLikeColumnName(columnName);
  const temporal = looksLikeTemporalNumericColumn(
    type,
    dateRate,
    numericRate,
    temporalNumericRate
  );
  switch (role) {
    case "spanStart":
    case "spanEnd": {
      // Dates (and only temporal numbers) → start/end. Never killed-counts / IDs.
      if (idLike)
        return {
          role,
          suitability: "bad",
          reason: "Identifiant — pas une borne de span",
        };
      if (type === "date" || dateRate >= 0.6)
        return { role, suitability: "good", reason: "Dates détectées" };
      if (ctx?.startIsDate && role === "spanEnd" && !temporal)
        return {
          role,
          suitability: "bad",
          reason: "Incompatible avec un début de type date (fin = date ou durée numérique)",
        };
      if (temporal && type === "number")
        return {
          role,
          suitability: "ok",
          reason: "Nombres temporels (serial Excel / timestamp)",
        };
      return {
        role,
        suitability: "bad",
        reason: "Réservé aux dates (ou timestamps) — pas aux mesures / comptes",
      };
    }
    case "duration": {
      if (idLike)
        return {
          role,
          suitability: "bad",
          reason: "Identifiant — pas une durée",
        };
      if (type === "date" || dateRate >= 0.6)
        return {
          role,
          suitability: "bad",
          reason: "Une date ne convient pas comme durée",
        };
      if (type === "number" || numericRate >= 0.7)
        return { role, suitability: "good", reason: "Valeurs numériques" };
      if (numericRate >= 0.4)
        return { role, suitability: "ok", reason: "Partiellement numérique" };
      return {
        role,
        suitability: "bad",
        reason: "La durée doit être numérique",
      };
    }
    case "magnitude": {
      if (idLike)
        return {
          role,
          suitability: "bad",
          reason: "Identifiant (ex. Strike ID) — pas une magnitude",
        };
      if (type === "date" || dateRate >= 0.6)
        return {
          role,
          suitability: "bad",
          reason: "Une date ne convient pas comme magnitude",
        };
      if (type === "number" || numericRate >= 0.75)
        return { role, suitability: "good", reason: "Mesure quantitative" };
      if (numericRate >= 0.4)
        return { role, suitability: "ok", reason: "Partiellement numérique" };
      return {
        role,
        suitability: "bad",
        reason: "La magnitude doit être numérique",
      };
    }
    case "color":
    case "facet": {
      if (type === "boolean")
        return { role, suitability: "good", reason: "Catégorie binaire" };
      // Prefer low-ish cardinality; allow high uniqueness on tiny samples
      const catOk =
        cardinality >= 2 &&
        cardinality <= Math.max(12, Math.min(40, Math.ceil(Math.sqrt(rowCount) * 4)));
      if ((type === "string" || type === "number") && catOk && (uniq < 0.85 || rowCount <= 30))
        return {
          role,
          suitability: "good",
          reason: `Cardinalité adaptée (${cardinality})`,
        };
      if (cardinality >= 2 && cardinality <= 60 && (uniq < 0.95 || rowCount <= 50))
        return {
          role,
          suitability: "ok",
          reason: `Cardinalité acceptable (${cardinality})`,
        };
      if (cardinality <= 1)
        return { role, suitability: "bad", reason: "Une seule valeur" };
      return {
        role,
        suitability: "bad",
        reason: "Trop de valeurs distinctes pour colorer / facetter",
      };
    }
    case "label": {
      if (type === "string" && uniq >= 0.5)
        return { role, suitability: "good", reason: "Libellés distincts" };
      if (type === "string" || uniq >= 0.3)
        return { role, suitability: "ok", reason: "Utilisable comme libellé" };
      return {
        role,
        suitability: "bad",
        reason: "Peu distinct — mauvais libellé",
      };
    }
    case "id": {
      if (uniq >= 0.98 && cardinality >= Math.max(1, rowCount - 1))
        return { role, suitability: "good", reason: "Valeurs quasi uniques" };
      if (uniq >= 0.7)
        return { role, suitability: "ok", reason: "Assez distinct" };
      return {
        role,
        suitability: "bad",
        reason: "Trop de doublons pour un identifiant",
      };
    }
    case "lat":
    case "lon": {
      const name = columnName.toLowerCase();
      const nameHit =
        role === "lat"
          ? /^(lat|latitude)$/.test(name) || name.includes("lat")
          : /^(lon|lng|long|longitude)$/.test(name) || name.includes("lon") || name.includes("lng");
      if ((type === "number" || numericRate >= 0.7) && nameHit)
        return { role, suitability: "good", reason: "Coordonnée numérique" };
      if (type === "number" || numericRate >= 0.7)
        return { role, suitability: "ok", reason: "Numérique — vérifiez lat/lon" };
      return { role, suitability: "bad", reason: "Lat/lon doivent être numériques" };
    }
    case "postal": {
      const name = columnName.toLowerCase();
      const nameHit =
        name.includes("postal") ||
        name.includes("zip") ||
        name === "cp" ||
        name.includes("code_postal") ||
        name.includes("codepostal");
      if (nameHit && (type === "string" || type === "number"))
        return { role, suitability: "good", reason: "Code postal FR/BE" };
      if (type === "string" || type === "number")
        return { role, suitability: "ok", reason: "Utilisable comme code postal" };
      return { role, suitability: "bad", reason: "Code postal attendu" };
    }
    default:
      return { role, suitability: "bad", reason: "" };
  }
}

/**
 * Analyse chaque colonne : type détecté, cardinalité, échantillons,
 * et aptitude (vert / ambre / rouge) pour chaque rôle de mapping.
 */
export function analyzeColumns(
  rows: Record<string, unknown>[],
  sampleSize = 6
): ColumnAnalysis[] {
  const cols = columnsFromRows(rows);
  const rowCount = rows.length;
  return cols.map((name) => {
    const values: unknown[] = [];
    let nullCount = 0;
    let dateHits = 0;
    let numHits = 0;
    let boolHits = 0;
    let temporalNumHits = 0;
    const distinct = new Set<string>();
    for (const row of rows) {
      const v = cell(row, name);
      if (isBlank(v)) {
        nullCount++;
        continue;
      }
      values.push(v);
      distinct.add(sampleStr(v));
      if (looksLikeDate(v)) dateHits++;
      if (looksLikeNumber(v)) numHits++;
      if (looksLikeBoolean(v)) boolHits++;
      // Temporal numerics only (Excel serial / epoch) — not small counts
      if (typeof v === "number" && Number.isFinite(v)) {
        if ((v > 20000 && v < 60000) || (v > 1e11 && v < 2e13) || (v > 1e9 && v < 2e10)) {
          temporalNumHits++;
        }
      } else if (typeof v === "string" && looksLikeNumber(v) && looksLikeDate(v)) {
        temporalNumHits++;
      }
    }
    const nonNull = values.length || 1;
    const dateRate = dateHits / nonNull;
    const numericRate = numHits / nonNull;
    const booleanRate = boolHits / nonNull;
    const temporalNumericRate = temporalNumHits / nonNull;
    const type = detectType(dateRate, numericRate, booleanRate);
    const cardinality = distinct.size;
    const sampleValues = [...distinct].slice(0, sampleSize);
    const roles = FIELD_ROLES.map((role) =>
      suitabilityFor(
        role,
        type,
        cardinality,
        rowCount,
        numericRate,
        dateRate,
        name,
        temporalNumericRate
      )
    );
    return {
      name,
      type,
      cardinality,
      nullCount,
      rowCount,
      sampleValues,
      numericRate,
      dateRate,
      booleanRate,
      roles,
    };
  });
}

export interface MappingValidation {
  /** True when structural requirements are met (start+end|duration, magnitude). */
  valid: boolean;
  /** Blocking structural problems. */
  issues: string[];
  /** Non-blocking suitability warnings (amber/red hints). */
  warnings: string[];
}

function columnIsDateLike(a: ColumnAnalysis | undefined): boolean {
  if (!a) return false;
  return a.type === "date" || a.dateRate >= 0.6;
}

function columnIsNumericMeasure(a: ColumnAnalysis | undefined): boolean {
  if (!a) return false;
  if (isIdLikeColumnName(a.name)) return false;
  return a.type === "number" || a.numericRate >= 0.7;
}

/**
 * Requis : magnitude + (start+end OU start+duration).
 * Bloque les combos impossibles (ex. début date + fin = compte de tués ;
 * magnitude = Strike ID). Les aptitudes ambre restent en avertissement.
 */
export function validateMapping(
  mapping: ColumnMapping,
  columns: string[],
  analyses?: ColumnAnalysis[]
): MappingValidation {
  const issues: string[] = [];
  const warnings: string[] = [];
  const colSet = new Set(columns);
  const byName = new Map((analyses ?? []).map((a) => [a.name, a]));

  const need = (key: string | null | undefined, label: string) => {
    if (!key) {
      issues.push(`${label} obligatoire.`);
      return;
    }
    if (!colSet.has(key)) issues.push(`Colonne introuvable pour ${label}: ${key}`);
  };

  need(mapping.start, "Début (span)");
  need(mapping.magnitude, "Magnitude");

  const hasEnd = Boolean(mapping.end);
  const hasDur = Boolean(mapping.duration);
  if (!hasEnd && !hasDur) {
    issues.push("Indiquez une fin (span) ou une durée.");
  }
  if (hasEnd && mapping.end && !colSet.has(mapping.end)) {
    issues.push(`Colonne introuvable pour Fin: ${mapping.end}`);
  }
  if (hasDur && mapping.duration && !colSet.has(mapping.duration)) {
    issues.push(`Colonne introuvable pour Durée: ${mapping.duration}`);
  }

  const startA = mapping.start ? byName.get(mapping.start) : undefined;
  const endA = mapping.end ? byName.get(mapping.end) : undefined;
  const durA = mapping.duration ? byName.get(mapping.duration) : undefined;
  const magA = mapping.magnitude ? byName.get(mapping.magnitude) : undefined;

  // End must be date-compatible with a date start, OR leave end empty and use numeric duration
  if (startA && columnIsDateLike(startA)) {
    if (hasEnd && endA && !columnIsDateLike(endA)) {
      issues.push(
        `Fin « ${mapping.end} » incompatible avec un début date — choisissez une colonne date (éventuellement la même) ou une durée numérique.`
      );
    }
    if (!hasEnd && hasDur && durA && !columnIsNumericMeasure(durA)) {
      issues.push(
        `Durée « ${mapping.duration} » doit être numérique lorsque le début est une date.`
      );
    }
  }

  if (mapping.magnitude && isIdLikeColumnName(mapping.magnitude)) {
    issues.push(
      `Magnitude « ${mapping.magnitude} » ressemble à un identifiant — choisissez une mesure (ex. tués, budget).`
    );
  } else if (magA && (magA.type === "date" || magA.dateRate >= 0.6)) {
    issues.push(`Magnitude « ${mapping.magnitude} » est une date — choisissez une mesure numérique.`);
  }

  if (mapping.end && isIdLikeColumnName(mapping.end)) {
    issues.push(`Fin « ${mapping.end} » est un identifiant — pas une borne de span.`);
  }

  const checkRole = (
    col: string | null | undefined,
    role: FieldRole,
    label: string,
    { blockBad = false }: { blockBad?: boolean } = {}
  ) => {
    if (!col || !byName.size) return;
    const a = byName.get(col);
    // Re-score spanEnd with start context when possible
    let s = a?.roles.find((r) => r.role === role);
    if (a && role === "spanEnd" && startA) {
      s = suitabilityFor(
        role,
        a.type,
        a.cardinality,
        a.rowCount,
        a.numericRate,
        a.dateRate,
        a.name,
        0,
        { startIsDate: columnIsDateLike(startA) }
      );
    }
    if (s?.suitability === "bad") {
      const msg = `${label}: « ${col} » inadaptée (${s.reason}).`;
      if (blockBad) issues.push(msg);
      else warnings.push(msg);
    } else if (s?.suitability === "ok") {
      warnings.push(`${label}: « ${col} » acceptable (${s.reason}).`);
    }
  };

  checkRole(mapping.start, "spanStart", "Début", { blockBad: true });
  if (mapping.end) checkRole(mapping.end, "spanEnd", "Fin", { blockBad: true });
  if (mapping.duration) checkRole(mapping.duration, "duration", "Durée", { blockBad: true });
  checkRole(mapping.magnitude, "magnitude", "Magnitude", { blockBad: true });

  return { valid: issues.length === 0, issues, warnings };
}

const MAPPING_STORAGE_KEY = "span-magnitude-viz:last-column-mapping:v1";

interface StoredMapping {
  columns: string[];
  mapping: ColumnMapping;
  unit?: "date" | "number";
}

/** Persist mapping keyed by sorted column signature. */
export function rememberMapping(
  columns: string[],
  mapping: ColumnMapping,
  unit?: "date" | "number"
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: StoredMapping = {
      columns: [...columns].sort(),
      mapping,
      unit,
    };
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Restore last mapping when the column set matches exactly. */
export function loadRememberedMapping(
  columns: string[]
): { mapping: ColumnMapping; unit?: "date" | "number" } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredMapping;
    if (!stored?.columns || !stored.mapping) return null;
    const a = [...columns].sort().join("\0");
    const b = [...stored.columns].sort().join("\0");
    if (a !== b) return null;
    return { mapping: stored.mapping, unit: stored.unit };
  } catch {
    return null;
  }
}

/**
 * Prefer remembered mapping when columns match; otherwise header-name guess.
 * Optionally bias guess using column analysis suitability.
 */
export function resolveInitialMapping(
  columns: string[],
  analyses?: ColumnAnalysis[]
): ColumnMapping {
  const remembered = loadRememberedMapping(columns);
  if (remembered) {
    const check = validateMapping(remembered.mapping, columns, analyses);
    if (check.valid) return remembered.mapping;
    // Stale / previously wrong auto-map (e.g. Strike ID as magnitude) — re-guess
  }

  const base = guessMapping(columns);
  if (!analyses?.length) return base;

  const rankOf = (col: string | null | undefined, role: FieldRole): number => {
    if (!col) return -1;
    const a = analyses.find((x) => x.name === col);
    const s = a?.roles.find((r) => r.role === role);
    if (!s) return -1;
    return s.suitability === "good" ? 2 : s.suitability === "ok" ? 1 : 0;
  };

  const bestFor = (
    role: FieldRole,
    fallback: string | null | undefined,
    exclude: Set<string> = new Set()
  ) => {
    const fbRank = rankOf(fallback, role);
    // Keep name-based guess when it is already good/ok
    if (fallback && fbRank >= 1) return fallback;
    let best: { name: string; rank: number } | null = null;
    for (const a of analyses) {
      if (exclude.has(a.name)) continue;
      const s = a.roles.find((r) => r.role === role);
      if (!s) continue;
      const rank = s.suitability === "good" ? 2 : s.suitability === "ok" ? 1 : 0;
      if (rank === 0) continue;
      if (!best || rank > best.rank) best = { name: a.name, rank };
    }
    return best?.name ?? fallback ?? null;
  };

  const used = new Set<string>();
  // Prefer date-typed columns for start
  const dateCols = analyses.filter((a) => a.type === "date" || a.dateRate >= 0.6);
  const startGuess =
    (base.start && dateCols.some((a) => a.name === base.start) ? base.start : null) ??
    dateCols[0]?.name ??
    bestFor("spanStart", base.start);
  const start = startGuess ?? base.start;
  used.add(start);

  let end = bestFor("spanEnd", base.end, used);
  // Point event: single date column → end = start
  if (!end && dateCols.length === 1 && dateCols[0]!.name === start) {
    end = start;
  } else if (!end && dateCols.length > 1) {
    end = dateCols.find((a) => a.name !== start)?.name ?? null;
  }
  if (end) used.add(end);

  const duration = end ? null : bestFor("duration", base.duration, used);
  if (duration) used.add(duration);

  // Never pick ID-like as magnitude even if numeric
  const magBest = (() => {
    const fb = base.magnitude && !isIdLikeColumnName(base.magnitude) ? base.magnitude : null;
    const fbRank = rankOf(fb, "magnitude");
    if (fb && fbRank >= 1) return fb;
    let best: { name: string; rank: number } | null = null;
    for (const a of analyses) {
      if (used.has(a.name) || isIdLikeColumnName(a.name)) continue;
      const s = a.roles.find((r) => r.role === "magnitude");
      if (!s || s.suitability === "bad") continue;
      const rank = s.suitability === "good" ? 2 : 1;
      if (!best || rank > best.rank) best = { name: a.name, rank };
    }
    return best?.name ?? fb ?? base.magnitude;
  })();
  const magnitude = magBest ?? base.magnitude;
  used.add(magnitude);
  const label = bestFor("label", base.label, used);
  if (label) used.add(label);
  const id = bestFor("id", base.id, used);
  if (id) used.add(id);
  const group = bestFor("facet", base.group, used);
  if (group) used.add(group);
  const colorField = bestFor("color", group ?? base.group, used);

  return {
    ...base,
    start,
    end,
    duration,
    magnitude,
    label,
    id,
    group,
    colorField,
  };
}

/** Live preview of how span length is derived from the current mapping. */
export type SpanPreviewMode = "endMinusStart" | "duration";

export interface SpanPreviewStats {
  /** Formula mode when start+end or start+duration is set. */
  mode: SpanPreviewMode;
  /** Valid sample lengths in axis units (days when unit=date, raw when number). */
  lengths: number[];
  /** Count of rows that produced a finite non-negative length. */
  count: number;
  median: number | null;
  mean: number | null;
  /** Rows examined (capped for responsiveness). */
  sampled: number;
}

function medianOf(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * Sample computed span lengths for the field-analysis live preview.
 * Mode is "endMinusStart" when `end` is set, else "duration" when `duration` is set.
 * Lengths are in **days** for `unit === "date"`, otherwise raw numeric units.
 */
export function computeSpanPreview(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  unit: "date" | "number" = "date",
  maxSample = 500
): SpanPreviewStats | null {
  const hasEnd = Boolean(mapping.end);
  const hasDur = Boolean(mapping.duration);
  if (!mapping.start || (!hasEnd && !hasDur)) return null;

  const mode: SpanPreviewMode = hasEnd ? "endMinusStart" : "duration";
  const slice = rows.length > maxSample ? rows.slice(0, maxSample) : rows;
  const lengths: number[] = [];

  for (const row of slice) {
    const start = coerceEndpoint(cell(row, mapping.start), unit);
    if (start == null) continue;

    let length: number | null = null;

    if (mode === "endMinusStart" && mapping.end) {
      const end = coerceEndpoint(cell(row, mapping.end), unit);
      if (end == null) continue;
      if (unit === "date" && typeof start === "string" && typeof end === "string") {
        const t0 = Date.parse(start);
        const t1 = Date.parse(end);
        if (Number.isNaN(t0) || Number.isNaN(t1)) continue;
        length = (t1 - t0) / 86400000;
      } else if (
        unit === "number" &&
        typeof start === "number" &&
        typeof end === "number"
      ) {
        length = end - start;
      }
    } else if (mode === "duration" && mapping.duration) {
      const dur = asNumber(cell(row, mapping.duration));
      if (dur == null) continue;
      length = dur;
    }

    if (length == null || !Number.isFinite(length) || length < 0) continue;
    lengths.push(length);
  }

  const sorted = [...lengths].sort((a, b) => a - b);
  return {
    mode,
    lengths,
    count: lengths.length,
    median: medianOf(sorted),
    mean: meanOf(lengths),
    sampled: slice.length,
  };
}

/** French label for the span formula shown in the field-analysis panel. */
export function spanPreviewFormulaFr(mode: SpanPreviewMode): string {
  return mode === "endMinusStart" ? "Span = Fin − Début" : "Span = Durée";
}

/** Format a span length for the FR preview (days → j / an). */
export function formatSpanLengthFr(
  value: number,
  unit: "date" | "number"
): string {
  if (unit === "date") {
    const days = value;
    if (days >= 365) {
      const y = days / 365;
      const s = y >= 10 ? y.toFixed(0) : y.toFixed(1).replace(".", ",");
      return `${s} an${y >= 2 ? "s" : ""}`;
    }
    const d = Math.round(days);
    return `${d} j`;
  }
  if (Math.abs(value) >= 1000) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
    return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(".", ",");
}
