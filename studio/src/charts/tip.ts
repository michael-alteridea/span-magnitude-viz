/**
 * Infobulles riches des graphiques : chaque marque (barre, segment, région, marche de cascade, point, cellule)
 * porte un attribut `data-tip` (JSON compact) lu par l'infobulle interactive (`ui/tooltip.ts`).
 * Rien n'est dessiné dans le SVG : les exports (SVG, PNG, PowerPoint, film) retirent l'attribut.
 */
import { formatPct } from "../story/fr";

/** Ton d'une ligne : écart favorable (vert), défavorable (rouge), stable (gris) — règles de la notation. */
export type Tone = "pos" | "neg" | "neutral";

export interface TipRow {
  /** Libellé (« vs moy. mars–mai 2026 », « Part du total »). */
  k: string;
  v: string;
  tone?: Tone;
}

export interface TipData {
  /** Catégorie / libellé. */
  t: string;
  /** Sous-libellé (série, version). */
  sub?: string;
  /** Valeur principale formatée (k€ / M€). */
  v?: string;
  rows?: TipRow[];
  /** Indication d'action (« Cliquer pour zoomer »). */
  h?: string;
}

export const TIP_ATTR = "data-tip";
/** Marqueur des attributs d'accessibilité posés par l'infobulle (retirés à l'export). */
export const TIP_A11Y = "data-tip-a11y";
export const HINT_ZOOM = "Cliquer pour zoomer";
export const HINT_FOCUS = "Cliquer pour focaliser";
export const hintDetail = (by?: string | null): string => (by ? `Cliquer pour détailler par ${by}` : "Cliquer pour détailler");

interface Attrable {
  attr(name: string, value: string | null): unknown;
}

/** Pose l'infobulle sur une sélection D3 (ou un élément). */
export function tip<S extends Attrable>(sel: S, d: TipData | null): S {
  sel.attr(TIP_ATTR, d ? JSON.stringify(compactTip(d)) : null);
  return sel;
}

function compactTip(d: TipData): TipData {
  const o: TipData = { t: d.t };
  if (d.sub) o.sub = d.sub;
  if (d.v) o.v = d.v;
  const rows = (d.rows ?? []).filter((r) => r && r.v);
  if (rows.length) o.rows = rows.map((r) => (r.tone ? r : { k: r.k, v: r.v }));
  if (d.h) o.h = d.h;
  return o;
}

/** Lecture tolérante de l'attribut (null si absent ou illisible). */
export function parseTip(s: string | null | undefined): TipData | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s) as TipData;
    if (!o || typeof o.t !== "string") return null;
    return { t: o.t, sub: typeof o.sub === "string" ? o.sub : undefined, v: typeof o.v === "string" ? o.v : undefined, rows: Array.isArray(o.rows) ? o.rows.filter((r) => r && typeof r.k === "string" && typeof r.v === "string") : undefined, h: typeof o.h === "string" ? o.h : undefined };
  } catch {
    return null;
  }
}

/** Ton d'un écart relatif : stable sous ±3 %, sinon favorable / défavorable (sens inversé pour les coûts). */
export function toneOf(rel: number, opts: { costs?: boolean; threshold?: number } = {}): Tone {
  if (!Number.isFinite(rel) || Math.abs(rel) < (opts.threshold ?? 0.03)) return "neutral";
  const good = opts.costs ? rel < 0 : rel > 0;
  return good ? "pos" : "neg";
}

/** Ton d'un écart déjà qualifié (favorable / défavorable, ou nul). */
export const toneGood = (good: boolean | null): Tone => (good == null ? "neutral" : good ? "pos" : "neg");

/** « Part du total : 23 % » (rien si le total est nul ou la valeur négative). */
export function shareRow(value: number, total: number, k = "Part du total"): TipRow | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value < 0) return null;
  const r = value / total;
  return { k, v: formatPct(r) };
}

/** Lignes non nulles. */
export function rows(...r: (TipRow | null | undefined | false)[]): TipRow[] {
  return r.filter((x): x is TipRow => !!x);
}

/** Texte accessible (lecteurs d'écran, focus clavier). */
export function tipText(d: TipData): string {
  return [d.t, d.sub, d.v, ...(d.rows ?? []).map((r) => `${r.k} : ${r.v}`), d.h].filter(Boolean).join(" ; ");
}

/** Retire de la copie d'un SVG tout ce qui ne sert qu'à l'infobulle (exports, PowerPoint, film). */
export function stripTips(root: Element): void {
  for (const e of root.querySelectorAll(`[${TIP_ATTR}], [${TIP_A11Y}]`)) {
    e.removeAttribute(TIP_ATTR);
    if (e.hasAttribute(TIP_A11Y)) {
      e.removeAttribute(TIP_A11Y);
      e.removeAttribute("aria-label");
      e.removeAttribute("aria-describedby");
      e.removeAttribute("tabindex");
      if (e.getAttribute("role") === "img") e.removeAttribute("role");
    }
    e.classList.remove("r4d-tip-on");
    if (e.getAttribute("class") === "") e.removeAttribute("class");
  }
}
