/**
 * Surcharges par élément (sélection par touchers successifs) : couleur propre d'une barre, d'une part, d'un point
 * ou d'une série ; texte, couleur et graisse d'un libellé. Clés stables : « s:<série> », « e:<catégorie> »
 * (« e:<série>|<catégorie> » quand le graphique a plusieurs séries).
 */
import type { ChartSpec, MarkOverride } from "../spec";

type SpecLike = { style: Pick<ChartSpec["style"], "overrides"> };

export const seriesKey = (series: string): string => `s:${series}`;
export const elemKey = (cat: string, series: string | null = null): string => (series != null ? `e:${series}|${cat}` : `e:${cat}`);

function get(spec: SpecLike, key: string): MarkOverride | undefined {
  const o = spec.style.overrides;
  return o && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

/** Couleur d'un élément : la sienne, sinon celle de sa série, sinon la couleur de base. */
export function markColor(spec: SpecLike, base: string, ek: string | null, sk: string | null): string {
  return (ek ? get(spec, ek)?.color : undefined) ?? (sk ? get(spec, sk)?.color : undefined) ?? base;
}

/**
 * Couleur choisie pour CET élément (pas celle de sa série) : elle prime sur le gris de la mise en avant
 * (l'élément coloré reste visible à côté de l'élément mis en avant) et sur le gris de la notation norme.
 */
export function ownColor(spec: SpecLike, ek: string | null): string | null {
  return (ek ? get(spec, ek)?.color : undefined) ?? null;
}

/** Couleur choisie pour l'élément, sinon pour sa série ; null : pas de couleur choisie. */
export function chosenColor(spec: SpecLike, ek: string | null, sk: string | null): string | null {
  return (ek ? get(spec, ek)?.color : undefined) ?? (sk ? get(spec, sk)?.color : undefined) ?? null;
}

export interface LabelLook {
  text: string;
  color: string | null;
  bold: boolean | null;
  size: number | null;
  hidden: boolean;
}

/** Libellé d'un élément : gabarit {valeur} propre, sinon celui de la série ; couleur, graisse, taille. */
export function labelLook(spec: SpecLike, value: string, ek: string | null, sk: string | null, fallback: string = value): LabelLook {
  const e = ek ? get(spec, ek) : undefined;
  const s = sk ? get(spec, sk) : undefined;
  const tpl = e?.label ?? s?.label;
  const text = tpl != null && tpl.trim() ? tpl.replace(/\{\s*valeur\s*\}/gi, value) : fallback;
  return {
    text,
    color: e?.labelColor ?? s?.labelColor ?? null,
    bold: e?.labelBold ?? s?.labelBold ?? null,
    size: e?.labelSize ?? s?.labelSize ?? null,
    hidden: !!(e?.hideLabel ?? s?.hideLabel),
  };
}

/** Pose une surcharge (champ par champ ; `undefined` retire le champ, une surcharge vide disparaît). */
export function withOverride(all: Record<string, MarkOverride>, key: string, patch: Partial<Record<keyof MarkOverride, unknown>>): Record<string, MarkOverride> {
  const cur: Record<string, unknown> = { ...(all[key] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") delete cur[k];
    else cur[k] = v;
  }
  const out = { ...all };
  if (Object.keys(cur).length) out[key] = cur as MarkOverride;
  else delete out[key];
  return out;
}

/** Attributs de sélection posés sur une marque ou un libellé du SVG (`data-sel` = rôle). */
export function selAttrs(el: { attr(n: string, v: string | null): unknown }, role: "mark" | "label" | "series", ek: string | null, sk: string | null, name: string, value: string | null = null): void {
  el.attr("data-sel", role);
  el.attr("data-sel-value", value);
  el.attr("data-sel-key", ek);
  el.attr("data-sel-series", sk);
  el.attr("data-sel-name", name);
}
