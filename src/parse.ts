import { z } from "zod";
import type {
  NormalizedDocument,
  NormalizedMark,
  SpanMagnitudeDocument,
  SpanMark,
  SpanUnit,
} from "./types.js";
import { ParseError } from "./types.js";

const spanEndpointsSchema = z.object({
  start: z.union([z.string(), z.number()]),
  end: z.union([z.string(), z.number()]),
});

const markSchemaLoose = z.object({
  id: z.string().min(1),
  span: spanEndpointsSchema,
  magnitude: z.number(),
  label: z.string().optional(),
  revealAt: z.union([z.string(), z.number()]).optional(),
  cohort: z.union([z.string(), z.number()]).optional(),
  group: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const defaultsSchema = z
  .object({
    geometry: z.enum(["arc", "bar", "lane"]).optional(),
    colorScheme: z.string().optional(),
    animate: z.boolean().optional(),
    tickers: z
      .array(z.enum(["count", "magnitudeSum", "spanSum"]))
      .optional(),
  })
  .optional();

const documentSchema = z.object({
  version: z.literal(1),
  unit: z.enum(["date", "number"]),
  marks: z.array(markSchemaLoose).min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  magnitudeLabel: z.string().optional(),
  spanLabel: z.string().optional(),
  countLabel: z.string().optional(),
  defaults: defaultsSchema,
  $schema: z.string().optional(),
});

function tryParseDate(v: string | number, field: string, issues: string[]): number | null {
  if (typeof v === "number") {
    issues.push(`${field}: expected ISO date string for unit "date", got number ${v}`);
    return null;
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) {
    issues.push(`${field}: invalid ISO date "${v}"`);
    return null;
  }
  return t;
}

function tryParseNumber(v: string | number, field: string, issues: string[]): number | null {
  if (typeof v === "string") {
    issues.push(`${field}: expected number for unit "number", got string "${v}"`);
    return null;
  }
  if (!Number.isFinite(v)) {
    issues.push(`${field}: expected finite number, got ${v}`);
    return null;
  }
  return v;
}

function parseEndpoint(
  v: string | number,
  unit: SpanUnit,
  field: string,
  issues: string[]
): number | null {
  return unit === "date"
    ? tryParseDate(v, field, issues)
    : tryParseNumber(v, field, issues);
}

/**
 * Validate and normalize a span-magnitude document.
 * Throws ParseError with clear multi-line messages on failure.
 */
export function parseDocument(
  input: unknown,
  options?: { strict?: boolean }
): NormalizedDocument {
  const issues: string[] = [];

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ParseError(["Document must be a JSON object"]);
  }

  if (options?.strict) {
    const allowed = new Set([
      "version",
      "unit",
      "marks",
      "title",
      "description",
      "magnitudeLabel",
      "spanLabel",
      "countLabel",
      "defaults",
      "$schema",
    ]);
    for (const key of Object.keys(input as object)) {
      if (!allowed.has(key)) {
        issues.push(`Unknown top-level key "${key}" (strict mode)`);
      }
    }
  }

  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      issues.push(`${path}: ${issue.message}`);
    }
    throw new ParseError(issues);
  }

  const doc = parsed.data as SpanMagnitudeDocument;

  // Collect all mark-level issues before throwing
  const ids = new Map<string, number>();
  for (let i = 0; i < doc.marks.length; i++) {
    const mark = doc.marks[i];
    const prev = ids.get(mark.id);
    if (prev !== undefined) {
      issues.push(`Duplicate mark id "${mark.id}" at marks[${prev}] and marks[${i}]`);
    } else {
      ids.set(mark.id, i);
    }

    if (!Number.isFinite(mark.magnitude)) {
      issues.push(`marks[${i}] (id=${mark.id}): magnitude must be a finite number`);
    } else if (mark.magnitude < 0) {
      issues.push(`marks[${i}] (id=${mark.id}): magnitude must be ≥ 0 (got ${mark.magnitude})`);
    }

    const start = parseEndpoint(
      mark.span.start,
      doc.unit,
      `marks[${i}].span.start`,
      issues
    );
    const end = parseEndpoint(
      mark.span.end,
      doc.unit,
      `marks[${i}].span.end`,
      issues
    );
    if (start !== null && end !== null && end < start) {
      issues.push(
        `marks[${i}] (id=${mark.id}): span.end (${mark.span.end}) must be ≥ span.start (${mark.span.start})`
      );
    }
    if (mark.revealAt !== undefined) {
      parseEndpoint(mark.revealAt, doc.unit, `marks[${i}].revealAt`, issues);
    }
  }

  if (issues.length) {
    throw new ParseError(issues);
  }

  // Second pass: build normalized marks (all valid now)
  const marks: NormalizedMark[] = doc.marks.map((mark, i) => {
    const start = parseEndpoint(mark.span.start, doc.unit, `marks[${i}].span.start`, [])!;
    const end = parseEndpoint(mark.span.end, doc.unit, `marks[${i}].span.end`, [])!;
    const revealRaw = mark.revealAt ?? mark.span.start;
    const revealAt = parseEndpoint(revealRaw, doc.unit, `marks[${i}].revealAt`, [])!;

    let cohort: string;
    if (mark.cohort !== undefined && mark.cohort !== null) {
      cohort = String(mark.cohort);
    } else if (doc.unit === "date") {
      cohort = String(new Date(start).getUTCFullYear());
    } else {
      cohort = "default";
    }

    return {
      id: mark.id,
      label: mark.label ?? mark.id,
      start,
      end,
      spanLength: end - start,
      magnitude: mark.magnitude,
      revealAt,
      cohort,
      group: mark.group ?? "default",
      meta: mark.meta ?? {},
      raw: mark,
    };
  });

  marks.sort((a, b) => {
    if (a.revealAt !== b.revealAt) return a.revealAt - b.revealAt;
    return a.id.localeCompare(b.id);
  });

  const xMin = Math.min(...marks.map((m) => m.start));
  const xMax = Math.max(...marks.map((m) => m.end));
  const magnitudeMax = Math.max(...marks.map((m) => m.magnitude), 0);
  const cohorts = [...new Set(marks.map((m) => m.cohort))].sort();
  const groups = [...new Set(marks.map((m) => m.group))].sort();

  const d = doc.defaults ?? {};
  return {
    version: 1,
    unit: doc.unit,
    title: doc.title ?? "",
    description: doc.description ?? "",
    magnitudeLabel: doc.magnitudeLabel ?? "Magnitude",
    spanLabel: doc.spanLabel ?? "Span",
    countLabel: doc.countLabel ?? "Items",
    defaults: {
      geometry: d.geometry ?? "arc",
      colorScheme: d.colorScheme ?? "warm",
      animate: d.animate ?? true,
      tickers: d.tickers ?? ["count", "magnitudeSum"],
    },
    marks,
    xDomain: [xMin, xMax],
    magnitudeMax,
    cohorts,
    groups,
  };
}

/** Soft parse: returns { ok, data } or { ok: false, error }. */
export function tryParseDocument(
  input: unknown,
  options?: { strict?: boolean }
):
  | { ok: true; data: NormalizedDocument }
  | { ok: false; error: ParseError } {
  try {
    return { ok: true, data: parseDocument(input, options) };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e };
    throw e;
  }
}
