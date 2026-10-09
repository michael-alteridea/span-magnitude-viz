import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { chartSpecSchema, type ChartSpec, type ChartSpecInput } from "../src/spec";
import { buildDataset } from "../src/data/table";
import { SAMPLES } from "../src/data/samples";
import { chosenColor, ownColor } from "../src/charts/overrides";

/** Bogue « je sélectionne une barre, je change la couleur, elle ne change pas » : norme et mise en avant. */
const specOf = (id: string, patch: (raw: ChartSpecInput) => void) => {
  const smp = SAMPLES.find((s) => s.id === id)!;
  const raw = JSON.parse(JSON.stringify(smp.spec)) as ChartSpecInput;
  patch(raw);
  return { spec: chartSpecSchema.parse(raw), ds: buildDataset(smp.name, smp.rows()) };
};

describe("couleur choisie : élément, série", () => {
  const sp = { style: { overrides: { "e:A": { color: "#FF0000" }, "s:S": { color: "#0070C0" } } } };
  it("ownColor : seulement la couleur de l'élément", () => {
    expect(ownColor(sp, "e:A")).toBe("#FF0000");
    expect(ownColor(sp, "e:B")).toBeNull();
  });
  it("chosenColor : élément, sinon série, sinon rien", () => {
    expect(chosenColor(sp, "e:A", "s:S")).toBe("#FF0000");
    expect(chosenColor(sp, "e:B", "s:S")).toBe("#0070C0");
    expect(chosenColor(sp, "e:B", "s:T")).toBeNull();
  });
});

describe("rendu : la couleur choisie s'applique", () => {
  let render: typeof import("../src/charts/render");
  beforeAll(async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window });
    render = await import("../src/charts/render");
  });
  const draw = (spec: ChartSpec, ds: ReturnType<typeof buildDataset>) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    render.renderChart(svg, spec, ds, render.prepareCache(spec, ds, null, 1), { build: 1, timePos: null, focus: 1 } as never, { now: new Date(2026, 9, 9) });
    const at = (k: string) => [...svg.querySelectorAll('[data-sel="mark"]')].find((e) => e.getAttribute("data-sel-key") === k);
    return at;
  };

  it("mode norme : réel coloré plein, budget coloré en contour, prévision hachurée à la couleur ; sans couleur : gris de la notation", () => {
    const { spec, ds } = specOf("revue-mensuelle-norme", (r) => {
      r.style = { ...r.style, overrides: { "e:Réel (€)|mars 2026": { color: "#FF0000" }, "e:Budget (€)|mars 2026": { color: "#7C3AED" }, "e:Prévision (€)|nov. 2026": { color: "#0070C0" } } };
    });
    const at = draw(spec, ds);
    expect(at("e:Réel (€)|mars 2026")?.getAttribute("fill")).toBe("#FF0000");
    expect(at("e:Budget (€)|mars 2026")?.getAttribute("fill")).toBe("none");
    expect(at("e:Budget (€)|mars 2026")?.getAttribute("stroke")).toBe("#7C3AED");
    const fc = at("e:Prévision (€)|nov. 2026");
    expect(fc?.getAttribute("stroke")).toBe("#0070C0");
    expect(fc?.getAttribute("fill")).toMatch(/^url\(#/);
    expect(at("e:Réel (€)|avr. 2026")?.getAttribute("fill")).not.toBe("#FF0000");
  });

  it("mode norme : couleur de série appliquée à toutes les barres de la série", () => {
    const { spec, ds } = specOf("revue-mensuelle-norme", (r) => {
      r.style = { ...r.style, overrides: { "s:N-1 (€)": { color: "#00B050" } } };
    });
    const at = draw(spec, ds);
    expect(at("e:N-1 (€)|janv. 2026")?.getAttribute("fill")).toBe("#00B050");
    expect(at("e:N-1 (€)|juin 2026")?.getAttribute("fill")).toBe("#00B050");
  });

  it("mise en avant d'un autre élément : la barre colorée garde sa couleur, les autres passent en gris", () => {
    const { spec, ds } = specOf("renouvelables", (r) => {
      r.mode = { kind: "static" } as never;
      r.style = { ...r.style, focus: { key: "Suède" }, overrides: { "e:Danemark": { color: "#FF0000" } } } as never;
    });
    const at = draw(spec, ds);
    expect(at("e:Danemark")?.getAttribute("fill")).toBe("#FF0000");
    expect(at("e:Finlande")?.getAttribute("fill")).not.toBe(at("e:Suède")?.getAttribute("fill"));
  });

  it("camembert avec mise en avant : la part colorée garde sa couleur", () => {
    const { spec, ds } = specOf("canaux", (r) => {
      r.type = "pie";
      r.style = { ...r.style, focus: { key: "Google Ads" }, overrides: { "e:LinkedIn Ads": { color: "#FF0000" } } } as never;
    });
    const at = draw(spec, ds);
    expect(at("e:LinkedIn Ads")?.getAttribute("fill")).toBe("#FF0000");
  });

  const labels = (spec: ChartSpec, ds: ReturnType<typeof buildDataset>, k: string) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    render.renderChart(svg, spec, ds, render.prepareCache(spec, ds, null, 1), { build: 1, timePos: null, focus: 1 } as never, { now: new Date(2026, 9, 9) });
    return [...svg.querySelectorAll('[data-sel="label"]')].filter((e) => e.getAttribute("data-sel-key") === k).map((e) => e.getAttribute("fill"));
  };

  it("couleur du texte du libellé : camembert (nom et valeur), mode norme (valeur du réel)", () => {
    const pie = specOf("canaux", (r) => {
      r.type = "pie";
      r.style = { ...r.style, overrides: { "e:LinkedIn Ads": { labelColor: "#3FA7C4" } } } as never;
    });
    const lp = labels(pie.spec, pie.ds, "e:LinkedIn Ads");
    expect(lp.length).toBeGreaterThanOrEqual(2);
    expect(lp.every((c) => c === "#3FA7C4")).toBe(true);
    const nm = specOf("revue-mensuelle-norme", (r) => {
      r.style = { ...r.style, overrides: { "e:Réel (€)|mars 2026": { labelColor: "#3FA7C4" } } };
    });
    expect(labels(nm.spec, nm.ds, "e:Réel (€)|mars 2026")).toEqual(["#3FA7C4"]);
  });
});
