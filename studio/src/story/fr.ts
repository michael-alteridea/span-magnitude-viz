/**
 * Rédaction en français : nombres (espace insécable, virgule, signe moins U+2212), montants compacts,
 * pourcentages, pluriels, élision, listes, mois et trimestres. Module pur (sans DOM).
 */
import { frNumber, NBSP } from "../format";

export { NBSP };
export const MINUS = "\u2212";

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Pluriel français : |n| < 2 → singulier (0 affaire, 1 affaire, 1,5 affaire, 2 affaires). */
export function plural(n: number, singular: string, pluralForm?: string): string {
  if (Math.abs(n) < 2) return singular;
  return pluralForm ?? pluralize(singular);
}

/** Pluriel régulier d'un nom (ou groupe nominal : seul le 1er mot varie, « ligne de produit » → « lignes de produit »). */
export function pluralize(word: string): string {
  const m = word.match(/^(\S+)(\s+(?:de|d'|du|des|en|à)\b.*)?$/i);
  const head = m?.[1] ?? word;
  const tail = m?.[2] ?? "";
  let p: string;
  if (/[sxz]$/i.test(head)) p = head;
  else if (/(au|eu|eau)$/i.test(head)) p = head + "x";
  else if (/al$/i.test(head) && !/^(bal|festival|récital|carnaval|chacal)$/i.test(head)) p = head.slice(0, -2) + "aux";
  else p = head + "s";
  return p + tail;
}

/** « 3 comptes », « 1 compte », « 0 affaire ». */
export function count(n: number, singular: string, pluralForm?: string): string {
  return `${formatInt(n)}${NBSP}${plural(n, singular, pluralForm)}`;
}

export function formatInt(n: number): string {
  return frNumber.format(",.0f")(Math.round(n));
}

/** Nombre avec d décimales au plus (zéros inutiles supprimés). */
export function formatNumber(n: number, d = 1): string {
  return frNumber.format(`,.${d}~f`)(n);
}

/**
 * Montant compact : 8 450 €, 84 k€, 840 k€, 1,4 M€, 12 M€.
 * `currency` = false → « 84 k », « 1,4 M ».
 */
export function formatAmount(v: number, currency = true): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  const cur = currency ? "€" : "";
  let body: string;
  if (a >= 1e9) body = `${formatNumber(a / 1e9, a >= 1e10 ? 0 : 1)}${NBSP}Md${cur ? NBSP + cur : ""}`;
  else if (a >= 1e6) body = `${formatNumber(a / 1e6, a >= 1e7 ? 0 : 1)}${NBSP}M${cur}`;
  else if (a >= 1e4) body = `${formatInt(a / 1e3)}${NBSP}k${cur}`;
  else if (a >= 1e3 && !currency) body = `${formatNumber(a / 1e3, 1)}${NBSP}k`;
  else body = `${a >= 100 ? formatInt(a) : formatNumber(a, a >= 10 ? 1 : 2)}${cur ? NBSP + cur : ""}`;
  return sign + body;
}

/** Montant signé (+120 k€ / −45 k€). */
export function formatSignedAmount(v: number, currency = true): string {
  if (!Number.isFinite(v)) return "–";
  return (v > 0 ? "+" : "") + formatAmount(v, currency);
}

/** Part (0..1) → « 60 % ». Décimales automatiques : 1 sous 10 %, 0 au-delà. */
export function formatPct(share: number, decimals?: number): string {
  if (!Number.isFinite(share)) return "–";
  const p = share * 100;
  const d = decimals ?? (Math.abs(p) < 10 && Math.abs(p) >= 0.05 && Math.round(p) !== p ? 1 : 0);
  return frNumber.format(`,.${d}~f`)(p).replace("-", MINUS) + `${NBSP}%`;
}

/** Variation relative signée : +12 %, −3,8 %. */
export function formatSignedPct(r: number, decimals?: number): string {
  if (!Number.isFinite(r)) return "–";
  const s = formatPct(Math.abs(r), decimals);
  if (s.startsWith("0" + NBSP) || s === `0${NBSP}%`) return s;
  return (r > 0 ? "+" : MINUS) + s;
}

/** Écart en points : +3,2 pts. */
export function formatPoints(d: number): string {
  const v = formatNumber(Math.abs(d), Math.abs(d) < 10 ? 1 : 0);
  return `${d > 0 ? "+" : d < 0 ? MINUS : ""}${v}${NBSP}${plural(Math.abs(d), "pt", "pts")}`;
}

/** Multiplicateur : 1,9×. */
export function formatRatio(r: number): string {
  return `${formatNumber(r, r >= 10 ? 0 : 1)}×`;
}

/** Multiplicateur en tête : « ×2,5 » (croissances de plus de 100 %). */
export function formatTimes(r: number): string {
  return `×${formatNumber(r, r >= 10 ? 0 : 1)}`;
}

/**
 * Variation relative lisible : « +12 % », « −40 % » ; au-delà de +100 % le pourcentage devient
 * un multiplicateur (« ×2,5 »), plus parlant et moins spectaculaire qu'un « +152 % ».
 */
export function formatGrowth(r: number): string {
  if (!Number.isFinite(r)) return "–";
  return r >= 1 ? formatTimes(1 + r) : formatSignedPct(r);
}

/** Valeur selon l'unité de la mesure. */
export function formatMeasure(v: number, unit: "eur" | "pct" | "count" | "plain"): string {
  if (unit === "eur") return formatAmount(v, true);
  if (unit === "pct") return formatPct(v / 100);
  if (unit === "count") return formatInt(v);
  return Math.abs(v) >= 1e4 ? formatAmount(v, false) : formatNumber(v, Math.abs(v) >= 100 ? 0 : 1);
}

export function formatSignedMeasure(v: number, unit: "eur" | "pct" | "count" | "plain"): string {
  if (unit === "pct") return formatPoints(v);
  const s = formatMeasure(Math.abs(v), unit);
  return (v > 0 ? "+" : v < 0 ? MINUS : "") + s;
}

/** « A », « A et B », « A, B et C ». */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

const VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæh]/i;
const H_ASPIRE = /^(hauts?|hainaut|hollande|hongrie|hugo|hall|hausse|haut)/i;

/** Élision : « de » + mot → « d'Anvers », « de Lyon », « des Hauts-de-France » non géré (h aspiré conservé). */
export function de(word: string): string {
  return VOWEL.test(word) && !H_ASPIRE.test(word) ? `d'${word}` : `de ${word}`;
}

/** « le » / « l' » devant un mot. */
export function le(word: string): string {
  return VOWEL.test(word) && !H_ASPIRE.test(word) ? `l'${word}` : `le ${word}`;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1) : s;
}

/** Libellé de mesure lisible : « Montant (€) » → « montant » ; acronymes conservés (CA, EBITDA). */
export function measureLabel(col: string): string {
  let s = col.replace(/\s*\((?:€|k€|m€|eur|%|euros?|nb|#)\)\s*/gi, " ").replace(/\s*[€%]\s*$/, "").replace(/\s+/g, " ").trim();
  if (!s) s = col;
  const first = s.split(" ")[0]!;
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return s;
  return s.charAt(0).toLocaleLowerCase("fr-FR") + s.slice(1);
}

const NOUNS: [RegExp, string, string, boolean][] = [
  [/^(nom du |raison sociale|)compte|account/i, "compte", "comptes", false],
  [/client|customer/i, "client", "clients", false],
  [/r[ée]gion/i, "région", "régions", true],
  [/ville|city/i, "ville", "villes", true],
  [/pays|country/i, "pays", "pays", false],
  [/ligne de produit|gamme/i, "ligne de produit", "lignes de produit", true],
  [/produit|product/i, "produit", "produits", false],
  [/commercial|vendeur|owner|propri[ée]taire|sales/i, "commercial", "commerciaux", false],
  [/canal|channel/i, "canal", "canaux", false],
  [/[ée]tape|stage|phase/i, "étape", "étapes", true],
  [/source|origine/i, "source", "sources", true],
  [/secteur|industr/i, "secteur", "secteurs", false],
  [/segment/i, "segment", "segments", false],
  [/agence|site|magasin|store/i, "agence", "agences", true],
  [/anciennet/i, "tranche d'ancienneté", "tranches d'ancienneté", true],
  [/offre|type/i, "type", "types", false],
  [/opportunit|affaire|deal/i, "affaire", "affaires", true],
  [/code postal|postal|zip/i, "code postal", "codes postaux", false],
  [/mois/i, "mois", "mois", false],
  [/ann[ée]e/i, "année", "années", true],
];

export interface Noun {
  sg: string;
  pl: string;
  /** Féminin (accords : premières, restantes, à elle seule). */
  f: boolean;
}

/** Nom commun (singulier, pluriel, genre) associé à une colonne de catégories. */
export function nounOf(col: string): Noun {
  for (const [re, sg, pl, f] of NOUNS) if (re.test(col)) return { sg, pl, f };
  const base = measureLabel(col);
  return { sg: base, pl: pluralize(base), f: /(e|tion|té)$/i.test(base) && !/(ème|isme|age|ice)$/i.test(base) };
}

/** Accord en genre : agree(noun, "premiers", "premières"). */
export function agree(n: Pick<Noun, "f">, masc: string, fem: string): string {
  return n.f ? fem : masc;
}

export function monthLong(ms: number): string {
  return MONTHS_LONG[new Date(ms).getUTCMonth()]!;
}
export function monthIndexLong(i: number): string {
  return MONTHS_LONG[((i % 12) + 12) % 12]!;
}
export function monthYear(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function monthYearLong(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function quarterOf(ms: number): string {
  const d = new Date(ms);
  return `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}
/** « 8 oct. 2026 » (1er : « 1er oct. 2026 »). */
export function dayMonthYear(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  return `${day === 1 ? "1er" : day}${NBSP}${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** Période « janv. 2025 – sept. 2026 » (même mois : « sept. 2026 »). */
export function periodLabel(min: number, max: number): string {
  const a = monthYear(min);
  const b = monthYear(max);
  return a === b ? a : `${a} – ${b}`;
}

/** « Généré le 8 oct. 2026 » (date locale du rendu / de l'export). */
export function generatedOn(date: Date = new Date()): string {
  const ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return `Généré le ${dayMonthYear(ms)}`;
}

/** Tronque proprement un texte à n caractères (sur un mot). */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

const FEM = /^(marge|valeur|vente|quantit|d[ée]pense|commande|recette|production|consommation|charge|facturation|livraison|part|population|surface|capacit|prime|remise|perte|dette|tr[ée]sorerie|activit|demande|offre)/i;
const PLURAL_MEASURES = /^(ventes|commandes|d[ée]penses|leads|clients|recettes|charges|livraisons|heures|unit[ée]s|effectifs|achats|pertes|primes|remises|visites|inscriptions)\b/i;

/** Article partitif devant une mesure : « du montant », « de la marge », « de l'EBITDA », « des ventes ». */
export function partitive(label: string): string {
  if (PLURAL_MEASURES.test(label)) return `des ${label}`;
  if (VOWEL.test(label) && !H_ASPIRE.test(label)) return `de l'${label}`;
  if (FEM.test(label)) return `de la ${label}`;
  return `du ${label}`;
}
