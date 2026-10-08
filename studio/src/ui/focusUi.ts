/**
 * Mise en avant (étape L), côté interface : nature de la marque et éléments proposables pour la spec courante
 * (Récit › Mise en avant), d'après le modèle préparé (catégories, séries, points, régions de la carte).
 */
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, prepareFrame } from "../charts/render";
import { focusChoices, focusKindOf, type FocusKind } from "../charts/focus";

export interface FocusInfo {
  kind: FocusKind | null;
  choices: string[];
}

export function focusInfo(spec: ChartSpec, ds: Dataset | null): FocusInfo {
  if (!ds) return { kind: null, choices: [] };
  try {
    const cache = prepareCache(spec, ds, null, -1);
    const prep = prepareFrame(spec, ds, cache, { build: 1, timePos: null });
    if (spec.type === "drill") {
      const dm = prep.drill?.model as { view?: string; stats?: { key: string; nuts?: string | null }[] } | undefined;
      const kind = focusKindOf(spec, 1, dm?.view ?? null);
      return { kind, choices: kind ? (dm?.stats ?? []).filter((st) => st.nuts).map((st) => st.key) : [] };
    }
    const model = prep.model;
    const kind = focusKindOf(spec, model && model.kind === "cat" ? model.series.length : 1);
    return { kind, choices: focusChoices(kind, model) };
  } catch {
    return { kind: null, choices: [] };
  }
}
