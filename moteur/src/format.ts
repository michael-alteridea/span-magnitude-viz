/** Formats de nombres à la française : virgule décimale, espace fine insécable, signe moins typographique. */
export const NNBSP = "\u202f";
const MINUS = "\u2212";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

export interface NumberOptions {
  /** Nombre de décimales (0 par défaut). */
  decimals?: number;
  /** Afficher « + » devant les valeurs positives. */
  signed?: boolean;
  /** Garder les zéros finaux (« 2,50 »). */
  keepZeros?: boolean;
}

/** 1234567,8 → « 1 234 568 » ; -3,25 (2 déc.) → « −3,25 ». */
export function number(v: number, opts: NumberOptions | number = {}): string {
  const o: NumberOptions = typeof opts === "number" ? { decimals: opts } : opts;
  if (!Number.isFinite(v)) return "–";
  const d = Math.max(0, Math.min(6, o.decimals ?? 0));
  const [int, dec] = Math.abs(v).toFixed(d).split(".");
  let frac = dec ?? "";
  if (!o.keepZeros) frac = frac.replace(/0+$/, "");
  const body = group(int!) + (frac ? "," + frac : "");
  const zero = /^[0,\u202f]*$/.test(body);
  const sign = zero ? "" : v < 0 ? MINUS : o.signed ? "+" : "";
  return sign + body;
}

export interface CompactOptions extends NumberOptions {
  /** Unité après le multiplicateur (« € » → « 12,5 k€ »). */
  unit?: string;
  /** Écriture compacte k / M / Md (vrai par défaut pour euro()). */
  compact?: boolean;
}

/** Valeur compacte : 12 500 → « 12,5 k », 1 200 000 € → « 1,2 M€ », 3,4 Md. */
export function compact(v: number, opts: CompactOptions = {}): string {
  if (!Number.isFinite(v)) return "–";
  const unit = (opts.unit ?? "").trim();
  const a = Math.abs(v);
  const scale = a >= 1e9 ? [1e9, "Md"] : a >= 1e6 ? [1e6, "M"] : a >= 1e4 ? [1e3, "k"] : [1, ""];
  const x = v / (scale[0] as number);
  const dec = opts.decimals ?? (Math.abs(x) >= 100 || scale[0] === 1 ? 0 : 1);
  const n = number(x, { decimals: dec, signed: opts.signed });
  const suffix = `${scale[1]}${unit}`;
  return suffix ? `${n}${NNBSP}${suffix}` : n;
}

/** Montant en euros : « 12 500 € » ou, compact, « 12,5 k€ ». */
export function euro(v: number, opts: CompactOptions = {}): string {
  if (opts.compact) return compact(v, { ...opts, unit: opts.unit ?? "€" });
  return `${number(v, opts)}${NNBSP}${opts.unit ?? "€"}`;
}

export interface PercentOptions extends NumberOptions {
  /** La valeur est déjà en points de pourcentage (32 → « 32 % »). Par défaut : ratio (0,32 → « 32 % »). */
  points?: boolean;
}

/** 0,324 → « 32 % » ; signé : « +32 % » / « −32 % ». */
export function percent(v: number, opts: PercentOptions | number = {}): string {
  const o: PercentOptions = typeof opts === "number" ? { decimals: opts } : opts;
  if (!Number.isFinite(v)) return "–";
  return `${number(o.points ? v : v * 100, o)}${NNBSP}%`;
}

/** Durée : 14 → « 14 mois » ; 13,6 → « 13,6 mois » ; unité au choix (« semaines », « ans »…). */
export function duration(v: number, unit = "mois", decimals = 1): string {
  if (!Number.isFinite(v)) return "–";
  const n = number(v, { decimals });
  if (unit === "ans" || unit === "an") return `${n}${NNBSP}${Math.abs(v) < 2 ? "an" : "ans"}`;
  if (unit === "semaines" || unit === "semaine") return `${n}${NNBSP}${Math.abs(v) < 2 ? "semaine" : "semaines"}`;
  if (unit === "jours" || unit === "jour") return `${n}${NNBSP}${Math.abs(v) < 2 ? "jour" : "jours"}`;
  return `${n}${NNBSP}${unit}`;
}

/** Date longue : « 8 octobre 2026 » (Date, horodatage ou « AAAA-MM-JJ »). */
export function date(d: Date | string | number): string {
  const x = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  if (Number.isNaN(x.getTime())) return String(d);
  return `${x.getDate() === 1 ? "1er" : x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}
