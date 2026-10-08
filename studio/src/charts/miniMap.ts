/**
 * Mini-carte choroplèthe France · Belgique (vignettes de l'Explorer) : départements et provinces
 * colorés par la somme de la mesure, à partir des codes postaux. Chargée à la demande.
 */
import { geoMercator, geoPath, scaleSqrt } from "d3";
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { lookupPostal } from "span-magnitude-viz/geo/postalLookup";
import regions from "span-magnitude-viz/geo/frBeRegions.json";
import { MINI_COLORS, MINI_H, MINI_W, svgAdd } from "../ui/miniBase";

type Feature = { type: "Feature"; properties: { id: string; country: string }; geometry: unknown };
const FC = regions as unknown as { type: "FeatureCollection"; features: Feature[] };
// Métropole + Belgique seulement (les DOM écraseraient le cadrage)
const MAINLAND = { type: "FeatureCollection" as const, features: FC.features.filter((f) => !/^FR-9[78]/.test(f.properties.id)) };

export function drawMiniMap(svg: SVGSVGElement, spec: ChartSpec, eff: Dataset): void {
  const postal = spec.encoding.postal;
  const y = spec.encoding.y[0];
  const by = new Map<string, number>();
  if (postal && y) {
    for (const r of eff.rows) {
      const v = r[y];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const g = lookupPostal(r[postal]);
      if (g?.regionId) by.set(g.regionId, (by.get(g.regionId) ?? 0) + v);
    }
  }
  // Remplace le cadre d'attente par la carte (à droite, le chiffre clé reste à gauche)
  svg.querySelector("rect")?.remove();
  const box = { x: MINI_W * 0.4, y: 6, w: MINI_W * 0.58, h: MINI_H - 12 };
  const proj = geoMercator().fitExtent(
    [
      [box.x, box.y],
      [box.x + box.w, box.y + box.h],
    ],
    MAINLAND as never
  );
  const path = geoPath(proj);
  const max = Math.max(1e-9, ...by.values());
  const color = scaleSqrt<string>().domain([0, max]).range(["#2b7489", "#c3eefa"]);
  const g = svgAdd(svg, "g", { class: "mini-map" });
  for (const f of MAINLAND.features) {
    const v = by.get(f.properties.id);
    svgAdd(g, "path", { d: path(f as never) ?? "", fill: v != null && v > 0 ? color(v) : "#20292e", stroke: "#0b0b0c", "stroke-width": 0.35 });
  }
  // Repère : la zone la plus forte
  let best: Feature | null = null;
  let bv = -Infinity;
  for (const f of MAINLAND.features) {
    const v = by.get(f.properties.id) ?? -Infinity;
    if (v > bv) (bv = v), (best = f);
  }
  if (best && bv > 0) {
    const [cx, cy] = path.centroid(best as never);
    if (Number.isFinite(cx)) svgAdd(svg, "circle", { cx, cy, r: 4, fill: "none", stroke: MINI_COLORS.text, "stroke-width": 1.6 });
  }
}
