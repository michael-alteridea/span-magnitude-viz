/**
 * Formats français : espace insécable pour les milliers, virgule décimale, unités (€, %, k, M…),
 * dates en français (UTC — toutes les dates importées sont normalisées en UTC).
 */
import {
  formatLocale,
  precisionFixed,
  timeFormatLocale,
  utcDay,
  utcMonth,
  utcYear,
  utcHour,
  utcMinute,
} from "d3";
import type { AxisSpec, UnitKey } from "./spec";

export const NBSP = "\u00a0";

export const frNumber = formatLocale({
  decimal: ",",
  thousands: NBSP,
  grouping: [3],
  currency: ["", `${NBSP}€`],
  minus: "\u2212",
  percent: `${NBSP}%`,
});

export const frTime = timeFormatLocale({
  dateTime: "%A %e %B %Y à %X",
  date: "%d/%m/%Y",
  time: "%H:%M:%S",
  periods: ["AM", "PM"],
  days: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  shortDays: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
  months: [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ],
  shortMonths: [
    "janv.", "févr.", "mars", "avr.", "mai", "juin",
    "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ],
});

const UNIT_DIV: Record<UnitKey, number> = { none: 1, eur: 1, keur: 1e3, meur: 1e6, pct: 1, k: 1e3, M: 1e6, custom: 1 };
const UNIT_SUFFIX: Record<UnitKey, string> = {
  none: "",
  eur: `${NBSP}€`,
  keur: `${NBSP}k€`,
  meur: `${NBSP}M€`,
  pct: `${NBSP}%`,
  k: `${NBSP}k`,
  M: `${NBSP}M`,
  custom: "",
};

export function unitSuffix(axis: Pick<AxisSpec, "unit" | "unitCustom">): string {
  if (axis.unit === "custom") {
    const c = axis.unitCustom.trim();
    return c ? `${NBSP}${c}` : "";
  }
  return UNIT_SUFFIX[axis.unit];
}

/** Décimales automatiques selon le pas de graduation (ou la valeur). */
export function autoDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.min(4, precisionFixed(step));
}

/**
 * Formateur de valeurs pour un axe : divise selon l'unité (k, M…), applique les décimales
 * (manuelles ou déduites de `step`), ajoute le suffixe.
 */
export function valueFormatter(
  axis: Pick<AxisSpec, "unit" | "unitCustom" | "decimals">,
  step?: number
): (v: number) => string {
  const div = UNIT_DIV[axis.unit];
  const suffix = unitSuffix(axis);
  // Graduations : au moins la précision du pas (évite « 0,1 · 0,1 · 0,2 ») ; étiquettes : choix utilisateur
  const auto = step != null ? autoDecimals(step / div) : null;
  const dec = axis.decimals != null ? Math.max(axis.decimals, auto ?? 0) : auto;
  const f = dec != null ? frNumber.format(`,.${dec}f`) : null;
  return (v: number) => {
    if (v == null || !Number.isFinite(v)) return "–";
    const x = v / div;
    if (f) return f(x) + suffix;
    // Auto sans pas connu : 0 à 2 décimales significatives
    const a = Math.abs(x);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return frNumber.format(`,.${d}~f`)(x) + suffix;
  };
}

/** Format compact pour étiquettes de valeur (1,2 M€, 34 k…). */
export function formatValue(v: number, axis: Pick<AxisSpec, "unit" | "unitCustom" | "decimals">): string {
  return valueFormatter(axis)(v);
}

export function formatPercent(share: number, decimals = 0): string {
  return frNumber.format(`.${decimals}f`)(share * 100) + `${NBSP}%`;
}

export function formatInt(v: number): string {
  return frNumber.format(",.0f")(v);
}

const fmtYear = frTime.utcFormat("%Y");
const fmtMonthYear = frTime.utcFormat("%b %Y");
const fmtMonth = frTime.utcFormat("%b");
const fmtDay = frTime.utcFormat("%e %b");
const fmtDayYear = frTime.utcFormat("%e %b %Y");
const fmtHour = frTime.utcFormat("%Hh%M");
const fmtFull = frTime.utcFormat("%d/%m/%Y");

/** Format multi-échelle pour les graduations temporelles (UTC). */
export function timeTickFormat(d: Date, i = 0): string {
  if (utcMinute(d) < d) return fmtHour(d);
  if (utcHour(d) < d) return fmtHour(d);
  if (utcDay(d) < d) return fmtHour(d);
  if (utcMonth(d) < d) return i === 0 ? fmtDayYear(d).trim() : fmtDay(d).trim();
  if (utcYear(d) < d) return i === 0 || d.getUTCMonth() === 0 ? fmtMonthYear(d) : fmtMonth(d);
  return fmtYear(d);
}

export type TimeGrain = "raw" | "day" | "week" | "month" | "quarter" | "year";

/** Libellé d'une date selon la granularité (tampon 4D, catégories de barres). */
export function formatDate(ms: number, grain: TimeGrain = "day"): string {
  const d = new Date(ms);
  switch (grain) {
    case "year":
      return fmtYear(d);
    case "quarter":
      return `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case "month":
      return fmtMonthYear(d);
    case "week":
      return `sem. du ${fmtDay(d).trim()}`;
    case "day":
    case "raw":
    default:
      return utcDay(d) < d ? fmtFull(d) + " " + fmtHour(d) : fmtDayYear(d).trim();
  }
}

/** Devine la granularité « naturelle » d'un ensemble de dates. */
export function guessGrain(values: number[]): TimeGrain {
  if (!values.length) return "day";
  const ds = values.map((v) => new Date(v));
  if (ds.every((d) => d.getUTCMonth() === 0 && d.getUTCDate() === 1)) return "year";
  if (ds.every((d) => d.getUTCDate() === 1 && d.getUTCMonth() % 3 === 0) && new Set(ds.map((d) => d.getUTCMonth())).size > 1)
    return "quarter";
  if (ds.every((d) => d.getUTCDate() === 1)) return "month";
  return "day";
}

/** Valeur de cellule → texte affichable (aperçu de données). */
export function formatCell(v: unknown, type: string): string {
  if (v == null || v === "") return "";
  if (type === "date" && typeof v === "number") return fmtFull(new Date(v)) + (utcDay(new Date(v)) < new Date(v) ? " " + fmtHour(new Date(v)) : "");
  if (type === "number" && typeof v === "number") return frNumber.format(",~f")(v);
  return String(v);
}

/** Unité suggérée d'après un nom de colonne (« Montant (€) » → €, « Taux (%) » → %). */
export function guessUnit(col: string | null | undefined): UnitKey {
  if (!col) return "none";
  if (/%/.test(col)) return "pct";
  if (/€|\beur\b|euros?\b/i.test(col)) return "eur";
  return "none";
}
