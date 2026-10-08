/**
 * Barres racontées (étape I) : icône au bout de la barre, pictogrammes (isotype), objectif, barre mise en avant
 * (mode focus) avec annotation reliée et moyenne des autres. Tout en SVG (chemins Phosphor, MIT), rendu identique
 * en SVG, PNG, vidéo et PowerPoint. Logique de choix pure (testée) ; le tracé est appelé par `drawCategorical`.
 */
import type { ChartSpec } from "../spec";
import type { CatModel } from "../data/model";
import { categoryIcon, iconFor } from "./icons";

export type CapMode = "none" | "icon" | "picto" | "goal";

export interface BarDeco {
  cap: CapMode;
  /** Icône par catégorie (null : aucune ; en pictogrammes : point). */
  icons: (string | null)[];
  /** Indice de la barre mise en avant, ou null. */
  focusK: number | null;
}

/**
 * Décorations applicables : barres simples verticales ou horizontales (« bar », « barH »), hors norme et empilement.
 * Icône, pictogrammes et focus : une seule série ; objectif : deux mesures (réalisé, objectif).
 */
export function barDeco(spec: ChartSpec, model: CatModel, eligible: boolean): BarDeco {
  const none: BarDeco = { cap: "none", icons: [], focusK: null };
  const t = spec.type;
  if (!eligible || (t !== "bar" && t !== "barH")) return none;
  const nS = model.series.length;
  let cap: CapMode = spec.style.barCap;
  if (cap === "goal" && (nS < 2 || spec.encoding.series)) cap = "none";
  if ((cap === "icon" || cap === "picto") && nS !== 1) cap = "none";
  const fallback = cap === "picto" ? iconFor(spec.encoding.x) ?? iconFor(model.series[0]) : null;
  const icons = model.labels.map((l) => (cap === "icon" || cap === "picto" ? categoryIcon(l, spec.style.capIcons) ?? fallback : null));
  let focusK: number | null = null;
  const fk = spec.style.focus.key;
  if (fk && (nS === 1 || cap === "goal")) {
    const vals = model.values[0] ?? [];
    if (fk === "@max") {
      let best = -Infinity;
      vals.forEach((v, k) => {
        if (Number.isFinite(v) && v > best) {
          best = v;
          focusK = k;
        }
      });
    } else {
      const k = model.labels.indexOf(fk);
      focusK = k >= 0 ? k : null;
    }
  }
  return { cap, icons, focusK };
}

/** Unité « ronde » des pictogrammes : 1, 2, 5 × 10ⁿ, pour ~`target` icônes sur la plus grande barre. */
export function pictoUnit(max: number, target = 10): number {
  if (!(max > 0)) return 1;
  const raw = max / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Textes calculés de l'annotation (titre et note) d'une barre mise en avant. */
export function focusTexts(
  label: string,
  value: number,
  values: number[],
  k: number,
  fmt: (v: number) => string,
  user: { title: string; note: string },
  /** false : valeurs non additives (moyennes, taux en %) → pas de « part du total ». */
  additive = true
): { title: string; note: string; avg: number | null } {
  const others = values.filter((v, i) => i !== k && Number.isFinite(v));
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
  const total = values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const pct = additive && total > 0 && value >= 0 ? Math.round((value / total) * 100) : null;
  // espace insécable avant « : » (typographie française : jamais de deux-points en début de ligne)
  const title = user.title.trim() || `${label}\u00a0: ${fmt(value)}${pct != null ? ` (${pct}\u00a0% du total)` : ""}`;
  let note = user.note.trim();
  if (!note && avg != null && avg !== 0) {
    const r = value / avg;
    const rTxt = r.toLocaleString("fr-FR", { maximumFractionDigits: r >= 10 ? 0 : 1 });
    note = r >= 1.05 ? `${rTxt} fois la moyenne des autres (${fmt(avg)})` : r <= 0.95 ? `${rTxt} fois la moyenne des autres (${fmt(avg)}) : en retrait` : `Au niveau de la moyenne des autres (${fmt(avg)})`;
  }
  return { title, note, avg };
}
