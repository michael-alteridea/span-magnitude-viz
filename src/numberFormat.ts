/**
 * Locale-aware number / date formatting for tickers, tooltips and axes.
 *
 * Default locale `"en"` keeps the historical output (`10.6M`, `2025-02`).
 * `"fr"` follows French typography: decimal comma, narrow no-break space
 * (U+202F) for thousands and before units, minus sign U+2212, units appended
 * when known (`10,6 M€`, `1 234`, `févr. 2025`).
 */
import { formatAxisValue, formatMagnitude, formatSpanRange } from "./layout.js";

export type NumberLocale = "en" | "fr";

/** Narrow no-break space (French thin space before units and as thousands separator). */
export const NNBSP = "\u202f";
const MINUS = "\u2212";
const FR_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export interface NumberFormatOptions {
  locale?: NumberLocale;
  /** Unit appended to magnitudes (e.g. `"€"` → `10,6 M€`, `850 €`). */
  magnitudeUnit?: string;
  /** Full override of the magnitude formatter (tickers, tooltip). */
  formatMagnitude?: (v: number) => string;
}

function frFixed(v: number, decimals: number): string {
  const [int, dec] = Math.abs(v).toFixed(decimals).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const body = dec && /[1-9]/.test(dec) ? `${grouped},${dec}` : grouped;
  return (v < 0 && body !== "0" ? MINUS : "") + body;
}

/** French compact magnitude: `10,6 M€`, `152 M€`, `84,2 k€`, `850 €`, `1 234`. */
export function formatMagnitudeFr(v: number, unit = ""): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const u = unit.trim();
  const sign = v < 0 ? MINUS : "";
  const dec = (x: number) => (x >= 100 ? 0 : 1);
  if (a >= 1e9) return `${sign}${frFixed(a / 1e9, dec(a / 1e9))}${NNBSP}Md${u ? NNBSP + u : ""}`;
  if (a >= 1e6) return `${sign}${frFixed(a / 1e6, dec(a / 1e6))}${NNBSP}M${u}`;
  if (a >= 1e4) return `${sign}${frFixed(a / 1e3, dec(a / 1e3))}${NNBSP}k${u}`;
  const body = frFixed(a, Number.isInteger(a) || a >= 100 ? 0 : 1);
  return `${sign}${body}${u ? NNBSP + u : ""}`;
}

/** Integer count: `1 234` (fr) / `1234` (en, historical). */
export function formatCountLocale(n: number, locale: NumberLocale = "en"): string {
  return locale === "fr" ? frFixed(Math.round(n), 0) : String(Math.round(n));
}

export function magnitudeFormatter(o: NumberFormatOptions = {}): (v: number) => string {
  if (o.formatMagnitude) return o.formatMagnitude;
  if (o.locale === "fr") return (v) => formatMagnitudeFr(v, o.magnitudeUnit ?? "");
  const unit = o.magnitudeUnit?.trim();
  return unit ? (v) => `${formatMagnitude(v)} ${unit}` : formatMagnitude;
}

/** Sum of spans: `1,2 an` / `34 j` (fr), `1.2y` / `34d` (en). */
export function formatSpanSumLocale(spanSum: number, unit: "date" | "number", o: NumberFormatOptions = {}): string {
  if (unit === "date") {
    const days = spanSum / 86400000;
    if (o.locale === "fr") return days >= 365 ? `${frFixed(days / 365, 1)}${NNBSP}${days >= 730 ? "ans" : "an"}` : `${frFixed(Math.round(days), 0)}${NNBSP}j`;
    return days >= 365 ? `${(days / 365).toFixed(1)}y` : `${Math.round(days)}d`;
  }
  return o.locale === "fr" ? formatMagnitudeFr(spanSum) : formatMagnitude(spanSum);
}

/** Axis tick: `févr. 2025` (fr date), `2025-02` (en date). */
export function formatAxisValueLocale(v: number, unit: "date" | "number", locale: NumberLocale = "en"): string {
  if (locale !== "fr") return formatAxisValue(v, unit);
  if (unit === "date") {
    const d = new Date(v);
    return `${FR_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return frFixed(v, Number.isInteger(v) ? 0 : 1);
}

/** Tooltip span range: `06/01/2025 → 15/03/2025` (fr). */
export function formatSpanRangeLocale(start: number, end: number, unit: "date" | "number", locale: NumberLocale = "en"): string {
  if (locale !== "fr") return formatSpanRange(start, end, unit);
  if (unit === "date") {
    const f = (t: number) => {
      const d = new Date(t);
      return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    };
    return `${f(start)} → ${f(end)}`;
  }
  return `${frFixed(start, Number.isInteger(start) ? 0 : 1)} → ${frFixed(end, Number.isInteger(end) ? 0 : 1)}`;
}
