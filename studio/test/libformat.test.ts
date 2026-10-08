import { describe, expect, it } from "vitest";
import { formatAxisValueLocale, formatCountLocale, formatMagnitude, formatMagnitudeFr, formatSpanSumLocale, magnitudeFormatter } from "span-magnitude-viz";
import { magnitudeUnitOf } from "../src/charts/special";
import { chartSpecSchema } from "../src/spec";

const N = "\u202f";

describe("bibliothèque : format des compteurs (Film 4D)", () => {
  it("français : virgule, espace fine insécable, unité", () => {
    expect(formatMagnitudeFr(10_600_000, "€")).toBe(`10,6${N}M€`);
    expect(formatMagnitudeFr(15_000_000, "€")).toBe(`15${N}M€`);
    expect(formatMagnitudeFr(152_400_000, "€")).toBe(`152${N}M€`);
    expect(formatMagnitudeFr(84_200, "€")).toBe(`84,2${N}k€`);
    expect(formatMagnitudeFr(8_450, "€")).toBe(`8${N}450${N}€`);
    expect(formatMagnitudeFr(1_234)).toBe(`1${N}234`);
    expect(formatMagnitudeFr(-2_500_000)).toBe(`\u22122,5${N}M`);
    expect(formatCountLocale(1234, "fr")).toBe(`1${N}234`);
    expect(formatSpanSumLocale(400 * 86400000, "date", { locale: "fr" })).toBe(`1,1${N}an`);
    expect(formatAxisValueLocale(Date.UTC(2025, 1, 1), "date", "fr")).toBe("févr. 2025");
    expect(magnitudeFormatter({ locale: "fr", magnitudeUnit: "€" })(10_600_000)).toBe(`10,6${N}M€`);
    expect(magnitudeFormatter({ formatMagnitude: (v) => `#${v}` })(3)).toBe("#3");
  });
  it("anglais par défaut inchangé (compatibilité de la bibliothèque)", () => {
    expect(formatMagnitude(10_600_000)).toBe("10.6M");
    expect(magnitudeFormatter()(10_600_000)).toBe("10.6M");
    expect(formatCountLocale(1234)).toBe("1234");
    expect(formatSpanSumLocale(400 * 86400000, "date")).toBe("1.1y");
    expect(formatAxisValueLocale(Date.UTC(2025, 1, 1), "date")).toBe("2025-02");
  });
  it("Studio : unité du compteur déduite de l'axe ou de la colonne", () => {
    const spec = chartSpecSchema.parse({ type: "film", axes: { y: { unit: "none" } } });
    expect(magnitudeUnitOf(spec, "Montant (€)")).toBe("€");
    expect(magnitudeUnitOf(spec, "Durée")).toBe("");
    expect(magnitudeUnitOf(chartSpecSchema.parse({ axes: { y: { unit: "keur" } } }), "Valeur")).toBe("€");
  });
});
