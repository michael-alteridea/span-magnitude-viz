import { describe, expect, it } from "vitest";
import { stripVisible, stripMax, STRIP_PRIORITY } from "../src/ui/gallery";
import { CHART_FAMILIES, type ChartType } from "../src/spec";

const ALL = CHART_FAMILIES.flatMap((f) => f.types);
const w = (cur: ChartType) => (t: ChartType) => (t === cur ? 90 : 34);

describe("bande des types (variante B)", () => {
  it("l'ordre de priorité couvre les 15 types une seule fois", () => {
    expect([...STRIP_PRIORITY].sort()).toEqual([...ALL].sort());
  });
  it("≥ 1200 px : 12 pictogrammes, « Plus » = Aires empilées, Arcs radiaux, Film 4D", () => {
    const vis = stripVisible(2000, "bar", w("bar"), 84, stripMax(1366));
    expect(vis).toEqual(["drill", "bar", "barH", "groupedBar", "stackedBar", "line", "area", "scatter", "pie", "donut", "variance", "map"]);
    expect(ALL.filter((t) => !vis.includes(t))).toEqual(["stackedArea", "radialBar", "film"]);
  });
  it("< 1200 px : 7 pictogrammes (Barres, Horizontales, Groupées | Lignes, Aires | Points | Camembert)", () => {
    expect(stripVisible(2000, "bar", w("bar"), 84, stripMax(1024))).toEqual(["bar", "barH", "groupedBar", "line", "area", "scatter", "pie"]);
  });
  it("le type sélectionné reste visible même s'il vit dans « Plus »", () => {
    const vis = stripVisible(2000, "film", w("film"), 84, 7);
    expect(vis).toContain("film");
    expect(vis).toHaveLength(7);
    expect(vis).not.toContain("pie");
  });
  it("jamais de débordement : la place disponible réduit le nombre de pictogrammes", () => {
    const narrow = stripVisible(300, "bar", w("bar"), 84, 12);
    const wide = stripVisible(700, "bar", w("bar"), 84, 12);
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow).toContain("bar");
    expect(stripVisible(10, "map", w("map"), 84, 12)).toEqual(["map"]);
  });
  it("affichage dans l'ordre des familles", () => {
    const vis = stripVisible(2000, "radialBar", w("radialBar"), 84, 12);
    expect(vis).toEqual(ALL.filter((t) => vis.includes(t)));
  });
});
