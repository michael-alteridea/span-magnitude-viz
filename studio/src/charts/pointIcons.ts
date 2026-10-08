/**
 * Nuage de points : « Forme des points » — ronds, une icône pour tous, ou une icône par groupe (« Couleur par »).
 * Mêmes icônes Phosphor (MIT) que les extrémités de barres. Logique de choix pure (testée).
 */
import type { ChartSpec } from "../spec";
import { categoryIcon, iconFor, PHOSPHOR } from "./icons";

/** Icônes distinctes proposées quand un groupe n'a pas d'icône trouvée d'après son nom. */
export const POINT_ICON_CYCLE = ["star", "map-pin", "leaf", "drop", "lightning", "target", "trophy", "gift", "rocket", "fire", "sun", "coins"];

/** Icône par défaut « Une icône » : d'après la mesure ou le libellé, sinon l'étoile. */
export function defaultPointIcon(spec: ChartSpec): string {
  return iconFor(spec.encoding.y[0]) ?? iconFor(spec.encoding.label) ?? iconFor(spec.encoding.x) ?? "star";
}

export type PointShape = "circle" | "icon" | "iconByGroup";

/** Forme effective : « par groupe » demande une colonne « Couleur par » ; sinon une seule icône. */
export function effectivePointShape(spec: ChartSpec): PointShape {
  const s = spec.style.pointShape ?? "circle";
  if (s === "iconByGroup" && !spec.encoding.series) return "icon";
  return s;
}

/**
 * Icône de chaque groupe (ordre des séries du modèle) : choix manuel (« » = rond), sinon d'après le nom,
 * sinon une icône du cycle non encore prise.
 */
export function groupIcons(spec: ChartSpec, series: readonly string[]): (string | null)[] {
  const shape = effectivePointShape(spec);
  if (shape === "circle") return series.map(() => null);
  if (shape === "icon") {
    const one = spec.style.pointIcon && PHOSPHOR[spec.style.pointIcon] ? spec.style.pointIcon : defaultPointIcon(spec);
    return series.map(() => one);
  }
  const over = spec.style.pointIcons ?? {};
  const out: (string | null)[] = series.map((g) => categoryIcon(g, over));
  const taken = new Set(out.filter(Boolean) as string[]);
  let k = 0;
  return out.map((ic, i) => {
    if (ic || over[series[i]!] === "") return ic;
    while (k < POINT_ICON_CYCLE.length && taken.has(POINT_ICON_CYCLE[k]!)) k++;
    const pick = POINT_ICON_CYCLE[k % POINT_ICON_CYCLE.length]!;
    taken.add(pick);
    k++;
    return pick;
  });
}

/** Taille d'une icône (px) : diamètre du rond qu'elle remplace, agrandi, avec un minimum lisible. */
export function pointIconSize(r: number, s: number): number {
  return Math.max(16 * s, r * 2.3);
}
