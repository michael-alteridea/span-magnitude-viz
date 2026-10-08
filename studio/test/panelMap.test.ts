import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { defaultSpec, type ChartSpec } from "../src/spec";
import { DEFAULT_SECTION, SECTION_IDS, SECTION_TITLES, animKind, chartTarget, dataComplete, normSearch, searchMatch, sectionSummaries } from "../src/ui/panelMap";

function spec(patch: (s: ChartSpec) => void = () => {}): ChartSpec {
  const s = defaultSpec();
  patch(s);
  return s;
}

/** Élément d'un SVG de graphique minimal (linkedom : closest disponible). */
function svgEl(markup: string, sel: string): Element {
  const { document } = parseHTML(`<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg">${markup}</svg></body></html>`);
  const el = document.querySelector(sel);
  if (!el) throw new Error(`introuvable : ${sel}`);
  return el as unknown as Element;
}

describe("panneau en accordéon : sections", () => {
  it("quatre sections dans l'ordre Graphique → Récit → Style → Export (Données fondue dans Graphique), Graphique ouverte par défaut", () => {
    expect(SECTION_IDS.map((id) => SECTION_TITLES[id])).toEqual(["Graphique", "Récit", "Style", "Export"]);
    expect(DEFAULT_SECTION).toBe("graphique");
  });

  it("un résumé d'une ligne par section, sans retour à la ligne", () => {
    const s = spec((x) => {
      x.type = "bar";
      x.encoding.x = "Région";
      x.encoding.y = ["Chiffre d'affaires (€)"];
      x.style.sort = "desc";
      x.style.valueLabels = true;
      x.axes.y.unit = "meur";
    });
    const sums = sectionSummaries(s, true);
    expect(sums.donnees).toBe("Région → Chiffre d'affaires (€) · Somme");
    expect(sums.graphique).toMatch(/^Barres.*tri décroissant · étiquettes · M€$/);
    expect(sums.style).toMatch(/^Sombre · /);
    expect(sums.export).toMatch(/^16:9 · /);
    for (const v of Object.values(sums)) {
      expect(v).not.toMatch(/\n/);
      expect(v.length).toBeLessThan(90);
    }
    expect(sectionSummaries(s, false).donnees).toBe("Aucune donnée chargée");
  });

  it("Données « faite » quand les encodages minimaux sont choisis", () => {
    expect(dataComplete(spec((x) => ((x.type = "bar"), (x.encoding.x = "a"), (x.encoding.y = ["b"]))), true)).toBe(true);
    expect(dataComplete(spec((x) => ((x.type = "bar"), (x.encoding.x = "a"), (x.encoding.y = []))), true)).toBe(false);
    expect(dataComplete(spec((x) => ((x.type = "bar"), (x.encoding.x = "a"), (x.encoding.y = ["b"]))), false)).toBe(false);
  });

  it("animation : fixe, entrée animée, 4D", () => {
    expect(animKind(spec((x) => (x.mode.kind = "static")))).toBe("static");
    expect(animKind(spec((x) => ((x.mode.kind = "dynamic"), (x.mode.fourD.enabled = false))))).toBe("build");
    expect(animKind(spec((x) => ((x.type = "bar"), (x.mode.kind = "dynamic"), (x.mode.fourD.enabled = true), (x.encoding.time = "Date"))))).toBe("4d");
  });
});

describe("recherche de réglages", () => {
  it("sans accents, sans casse, préfixes, tous les mots", () => {
    expect(normSearch("  Décimales  d’axe ")).toBe("decimales d axe");
    expect(searchMatch("Unité et décimales · format nombre", "deci")).toBe(true);
    expect(searchMatch("Unité et décimales · format nombre", "UNITE format")).toBe(true);
    expect(searchMatch("Unité et décimales", "légende")).toBe(false);
    expect(searchMatch("n'importe quoi", "  ")).toBe(true);
  });
});

describe("toucher un élément du graphique → réglage", () => {
  const bar = spec((x) => (x.type = "bar"));
  it("titre, sous-titre et points à retenir → Récit", () => {
    expect(chartTarget(svgEl(`<text class="r4d-title" data-r4d-edit="title">T</text>`, "text"), "bar", false)).toEqual({ section: "recit", paths: ["style.title"] });
    expect(chartTarget(svgEl(`<text data-r4d-edit="subtitle">S</text>`, "text"), "bar", false)?.paths[0]).toBe("style.subtitle");
    expect(chartTarget(svgEl(`<g data-r4d-edit="comment:2"><text>C</text></g>`, "text"), "bar", false)?.paths[0]).toBe("story.comments.2");
  });
  it("axes → Graphique › groupe d'axe ; légende ; barres → tri / étiquettes", () => {
    expect(chartTarget(svgEl(`<g class="r4d-axis r4d-axis-y"><text>1</text></g>`, "text"), "bar", false)).toMatchObject({ section: "graphique", group: "axe-y" });
    expect(chartTarget(svgEl(`<g class="r4d-axis r4d-axis-x"><text>a</text></g>`, "text"), "bar", false)).toMatchObject({ group: "axe-x" });
    expect(chartTarget(svgEl(`<g class="r4d-legend"><rect/></g>`, "rect"), "bar", false)?.paths).toEqual(["style.legend"]);
    expect(chartTarget(svgEl(`<g class="r4d-marks"><rect/></g>`, "rect"), bar.type, false)).toMatchObject({ section: "graphique", paths: ["style.sort", "style.valueLabels", "axes.y.unit"] });
  });
  it("cartouche / QR → Export ; fond → Style", () => {
    expect(chartTarget(svgEl(`<g class="r4d-cartouche"><rect class="r4d-qr"/></g>`, "rect"), "bar", false)).toEqual({ section: "export", paths: ["style.authQr"] });
    expect(chartTarget(svgEl(`<rect class="r4d-bg"/>`, "rect"), "bar", false)?.section).toBe("style");
  });
  it("éléments d'exploration (zoom) et liens : rien (traités ailleurs)", () => {
    expect(chartTarget(svgEl(`<g class="r4d-marks"><rect data-drill-kind="bar"/></g>`, "rect"), "drill", false)).toBeNull();
    expect(chartTarget(svgEl(`<a href="#"><text>lien</text></a>`, "text"), "bar", false)).toBeNull();
    expect(chartTarget(null, "bar", false)).toBeNull();
  });
});
