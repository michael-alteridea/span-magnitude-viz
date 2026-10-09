/** Sélection par touchers successifs : surcharges par élément (couleur, libellé), empreinte, fil d'Ariane. */
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec";
import { elemKey, labelLook, markColor, seriesKey, withOverride } from "../src/charts/overrides";
import { fingerprintSpec } from "../src/publish/manifest";
import { crumbs, isDouble, levelNames, nextSelection, type Sel } from "../src/ui/selection";

const spec = (overrides: Record<string, unknown> = {}) => {
  const r = parseSpec({ type: "barH", encoding: { x: "Pays", y: ["Part (%)"] }, style: { overrides } });
  if (!r.ok) throw new Error(r.issues.join());
  return r.spec;
};

describe("surcharges par élément", () => {
  it("clés stables : série, élément, élément d'une série", () => {
    expect(seriesKey("Part (%)")).toBe("s:Part (%)");
    expect(elemKey("Belgique")).toBe("e:Belgique");
    expect(elemKey("Belgique", "2025")).toBe("e:2025|Belgique");
  });
  it("couleur : élément > série > palette", () => {
    const sp = spec({ "s:Part (%)": { color: "#08465A" }, "e:Belgique": { color: "#9CA3AF" } });
    expect(markColor(sp, "#3FA7C4", "e:Belgique", "s:Part (%)")).toBe("#9CA3AF");
    expect(markColor(sp, "#3FA7C4", "e:France", "s:Part (%)")).toBe("#08465A");
    expect(markColor(spec(), "#3FA7C4", "e:France", "s:Part (%)")).toBe("#3FA7C4");
  });
  it("libellé : jeton {valeur}, portée série, élément prioritaire, masquage", () => {
    const sp = spec({ "s:Part (%)": { label: "{valeur} en 2024", labelColor: "#FFFFFF" }, "e:Belgique": { label: "{ valeur } · objectif 2030 : 21 %", labelBold: true } });
    expect(labelLook(sp, "14,3 %", "e:Belgique", "s:Part (%)")).toMatchObject({ text: "14,3 % · objectif 2030 : 21 %", color: "#FFFFFF", bold: true, hidden: false });
    expect(labelLook(sp, "23,2 %", "e:France", "s:Part (%)").text).toBe("23,2 % en 2024");
    expect(labelLook(spec(), "23,2 %", "e:France", "s:Part (%)", "France").text).toBe("France");
    expect(labelLook(spec({ "e:France": { hideLabel: true } }), "1", "e:France", null).hidden).toBe(true);
  });
  it("withOverride : champ retiré par undefined / chaîne vide, surcharge vide supprimée", () => {
    let o = withOverride({}, "e:Belgique", { color: "#9CA3AF", label: "{valeur}" });
    expect(o).toEqual({ "e:Belgique": { color: "#9CA3AF", label: "{valeur}" } });
    o = withOverride(o, "e:Belgique", { color: undefined });
    expect(o).toEqual({ "e:Belgique": { label: "{valeur}" } });
    o = withOverride(o, "e:Belgique", { label: "" });
    expect(o).toEqual({});
  });
  it("schéma : couleur hexadécimale, 300 surcharges au plus", () => {
    expect(parseSpec({ style: { overrides: { "e:A": { color: "rouge" } } } }).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`e:${i}`, { color: "#000000" }]));
    expect(parseSpec({ style: { overrides: many } }).ok).toBe(false);
  });
  it("empreinte : surcharges vides absentes (empreintes publiées inchangées), présentes dès qu'il y en a", () => {
    const a = fingerprintSpec(spec()) as { style: Record<string, unknown> };
    expect("overrides" in a.style).toBe(false);
    const b = fingerprintSpec(spec({ "e:Belgique": { color: "#9CA3AF" } })) as { style: Record<string, unknown> };
    expect(b.style.overrides).toEqual({ "e:Belgique": { color: "#9CA3AF" } });
  });
});

describe("fil d'Ariane", () => {
  it("Page › Graphique › Barres › Belgique › Libellé", () => {
    expect(crumbs({ level: "label", ek: "e:Belgique", sk: "s:Part (%)", name: "Belgique" }, "barH")).toEqual(["Page", "Graphique", "Barres", "Belgique", "Libellé"]);
    expect(crumbs({ level: "series", ek: null, sk: "s:France", name: "France" }, "line")).toEqual(["Page", "Graphique", "France"]);
    expect(crumbs({ level: "mark", ek: "e:Web", sk: "s:CA", name: "Web" }, "donut")).toEqual(["Page", "Graphique", "Parts", "Web"]);
    expect(levelNames("scatter").mark).toBe("Point");
  });
});

describe("transitions d'un toucher (nextSelection)", () => {
  const page: Sel = { level: "page", ek: null, sk: null, name: "" };
  const chart: Sel = { level: "chart", ek: null, sk: null, name: "" };
  const series = (sk: string): Sel => ({ level: "series", ek: null, sk, name: sk.slice(2) });
  const mark = (name: string, sk = "s:Part (%)"): Sel => ({ level: "mark", ek: `e:${name}`, sk, name });
  const label = (name: string, sk = "s:Part (%)"): Sel => ({ level: "label", ek: `e:${name}`, sk, name });
  /** Chaîne sous le pointeur : fond (page, graphique) ou une barre (page › graphique › série › barre › libellé). */
  const onBar = (name: string, sk = "s:Part (%)") => [page, chart, series(sk), mark(name, sk), label(name, sk)];
  const onPlot = [page, chart];
  const outside = [page];

  it("scénario signalé : page, puis le graphique, puis une barre à un AUTRE endroit, puis la même barre, puis son libellé", () => {
    let s = nextSelection(null, outside, "page");
    expect(s?.level).toBe("page");
    s = nextSelection(s, onPlot, "chart");
    expect(s?.level).toBe("chart");
    s = nextSelection(s, onBar("Belgique"), "mark");
    expect(s).toEqual(series("s:Part (%)"));
    s = nextSelection(s, onBar("Belgique"), "mark");
    expect(s).toEqual(mark("Belgique"));
    s = nextSelection(s, onBar("Belgique"), "label");
    expect(s).toEqual(label("Belgique"));
    // le libellé est le niveau le plus fin : on y reste
    expect(nextSelection(s, onBar("Belgique"), "label")).toEqual(label("Belgique"));
  });
  it("hors de la sélection : l'objet touché, au même niveau (autre barre, autre série)", () => {
    expect(nextSelection(mark("Belgique"), onBar("France"), "mark")).toEqual(mark("France"));
    expect(nextSelection(series("s:2024"), onBar("France", "s:2025"), "mark")).toEqual(series("s:2025"));
    // libellé choisi, toucher la barre d'un autre élément : cette barre (pas son libellé)
    expect(nextSelection(label("Belgique"), onBar("France"), "mark")).toEqual(mark("France"));
    expect(nextSelection(label("Belgique"), onBar("France"), "label")).toEqual(label("France"));
  });
  it("hors de la sélection, sur le fond : le graphique ; hors du graphique : la page", () => {
    expect(nextSelection(mark("Belgique"), onPlot, "chart")).toEqual(chart);
    expect(nextSelection(series("s:Part (%)"), outside, "page")).toEqual(page);
  });
  it("double-clic / double-toucher sur une barre : directement l'élément, quel que soit le niveau", () => {
    expect(nextSelection(null, onBar("Belgique"), "mark", true)).toEqual(mark("Belgique"));
    expect(nextSelection(chart, onBar("Belgique"), "mark", true)).toEqual(mark("Belgique"));
    expect(nextSelection(label("France"), onBar("Belgique"), "label", true)).toEqual(mark("Belgique"));
    // double-clic sur le fond : comportement d'un toucher simple
    expect(nextSelection(page, onPlot, "chart", true)).toEqual(chart);
  });
  it("double : compteur du navigateur, ou deux touchers rapprochés hors souris (règle des ~1/3 s)", () => {
    const prev = { x: 100, y: 100, t: 1000 };
    expect(isDouble(prev, 300, 300, 5000, 2, "mouse")).toBe(true);
    // souris : le compteur fait foi, deux clics simples restent deux clics simples
    expect(isDouble(prev, 100, 100, 1100, 1, "mouse")).toBe(false);
    // toucher, ou Safari iPad sans pointerType : < 320 ms et < 24 px
    expect(isDouble(prev, 105, 104, 1250, 1, "touch")).toBe(true);
    expect(isDouble(prev, 105, 104, 1250, 1, undefined)).toBe(true);
    expect(isDouble(prev, 105, 104, 1400, 1, "touch")).toBe(false);
    expect(isDouble(prev, 140, 100, 1100, 1, "touch")).toBe(false);
    expect(isDouble(null, 100, 100, 1100, 1, "touch")).toBe(false);
  });
  it("double-clic : l'élément même quand les deux clics simples ont déjà descendu les niveaux", () => {
    // clic 1 (page → graphique), clic 2 = double : l'élément ; depuis la série, clic 1 donne déjà l'élément, clic 2 le garde
    for (const start of [null, page, chart, series("s:Part (%)")] as (Sel | null)[]) {
      const after1 = nextSelection(start, onBar("Belgique"), "mark");
      expect(nextSelection(after1, onBar("Belgique"), "mark", true)).toEqual(mark("Belgique"));
    }
  });
  it("graphique sans série (pas de data-sel-series) : graphique → élément directement", () => {
    const chain = [page, chart, { level: "mark", ek: "e:A", sk: null, name: "A" } as Sel, { level: "label", ek: "e:A", sk: null, name: "A" } as Sel];
    expect(nextSelection(chart, chain, "mark")?.level).toBe("mark");
  });
});
