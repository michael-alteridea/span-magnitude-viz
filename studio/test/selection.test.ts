/** Sélection par touchers successifs : surcharges par élément (couleur, libellé), empreinte, fil d'Ariane. */
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec";
import { elemKey, labelLook, markColor, seriesKey, withOverride } from "../src/charts/overrides";
import { fingerprintSpec } from "../src/publish/manifest";
import { crumbs, levelNames } from "../src/ui/selection";

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
