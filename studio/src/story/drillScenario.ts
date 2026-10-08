/** Piste suivante de l'exploration (bouton « Suggestion ») appliquée au spec. Module pur. */
import type { DrillSpec } from "../spec";
import type { Dataset } from "../data/table";
import { drillInto, drillView, rootGrain } from "../data/drill";
import { drillStory } from "./drillStory";

export function applySuggestion(d: DrillSpec, ds: Dataset, transform: { calculate: never[]; filters: never[] } | undefined = undefined): DrillSpec | null {
  const st = drillStory({ drill: d, transform: transform ?? { calculate: [], filters: [] } }, ds);
  const s = st?.suggestion;
  if (!s) return null;
  const root = d.date ? rootGrain(ds, d.date) : d.grain;
  if (s.target) return drillInto(d, s.target, root);
  if (s.view) return { ...drillView(d, s.view, s.by ?? d.by), ...(s.pivot ? { pivot: { ...d.pivot, ...s.pivot } } : {}) };
  return null;
}

