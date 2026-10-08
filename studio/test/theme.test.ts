import { describe, expect, it } from "vitest";
import { defaultSpec, parseSpec } from "../src/spec";
import { libColorScheme, paletteColors, themeFor, PALETTE_LABELS, PETROLE_COLORS, VARIANCE_NEG, VARIANCE_POS } from "../src/theme";
import { migrateSessionSpec } from "../src/state";
import { PETROLE, BRAND, BRAND_PETROLE, brandForScheme, resolveMarkColor } from "span-magnitude-viz/colors";
import type { NormalizedMark } from "span-magnitude-viz";

const withStyle = (style: Record<string, unknown>) => {
  const r = parseSpec({ style });
  if (!r.ok) throw new Error(r.issues.join("\n"));
  return r.spec;
};

describe("identité bleu pétrole", () => {
  it("palette par défaut : pétrole, LIGHT sur fond sombre, MAIN sur fond clair", () => {
    const dark = defaultSpec();
    expect(dark.style.palette).toBe("petrole");
    expect(paletteColors(dark, themeFor(dark))[0]).toBe("#3FA7C4");
    expect(themeFor(dark).accent).toBe("#3FA7C4");
    const light = withStyle({ background: "light" });
    expect(paletteColors(light, themeFor(light))[0]).toBe("#0E6E8C");
    expect(themeFor(light).accent).toBe("#0E6E8C");
    expect(PETROLE_COLORS).toMatchObject({ main: "#0E6E8C", light: "#3FA7C4", dark: "#08465A" });
  });
  it("palettes pétrole sans rouge ni vert (réservés aux écarts)", () => {
    for (const p of ["petrole", "petroleMono", "petroleGris"] as const) {
      for (const background of ["dark", "light"] as const) {
        const s = withStyle({ palette: p, background });
        const cols = paletteColors(s, themeFor(s)).map((c) => c.toLowerCase());
        expect(cols).not.toContain(VARIANCE_NEG);
        expect(cols).not.toContain(VARIANCE_POS);
        expect(new Set(cols).size).toBe(cols.length);
      }
    }
  });
  it("préréglage « Alteridea (rouge) » conservé, avec accent rouge", () => {
    expect(PALETTE_LABELS.alteridea).toBe("Alteridea (rouge)");
    const s = withStyle({ palette: "alteridea" });
    expect(paletteColors(s, themeFor(s))[0]).toBe("#d62839");
    expect(themeFor(s).accent).toBe("#d62839");
    expect(libColorScheme("alteridea")).toBe("altairady");
    expect(libColorScheme("petrole")).toBe("petrole");
  });
  it("constantes d'écart IBCS", () => {
    expect(VARIANCE_NEG).toBe("#d62839");
    expect(VARIANCE_POS).toBe("#2e9e4f");
  });
  it("sessions v1 : « alteridea » (ancien défaut) → « petrole » ; v2 inchangée", () => {
    const old = { style: { palette: "alteridea", title: "x" } };
    expect(migrateSessionSpec(old, 1)).toEqual({ style: { palette: "petrole", title: "x" } });
    expect(migrateSessionSpec(old, 2)).toBe(old);
    const vives = { style: { palette: "vives" } };
    expect(migrateSessionSpec(vives, 1)).toBe(vives);
  });
});

describe("bibliothèque : schéma « petrole »", () => {
  const mk = (id: string, group: string, magnitude = 1) =>
    ({ id, group, cohort: "c", magnitude, spanLength: 1, meta: {} }) as unknown as NormalizedMark;
  const marks = [mk("a", "A", 1), mk("b", "B", 5), mk("c", "C", 9)];
  it("couleurs catégorielles pétrole, « altairady » toujours rouge", () => {
    expect(resolveMarkColor(marks[0]!, marks, { colorScheme: "petrole", colorBy: "group" })).toBe(PETROLE[0]);
    expect(resolveMarkColor(marks[1]!, marks, { colorScheme: "petrole", colorBy: "group" })).toBe(PETROLE[1]);
    expect(resolveMarkColor(marks[0]!, marks, { colorScheme: "altairady", colorBy: "group" })).toBe("#3a0a10");
    expect(resolveMarkColor(marks[0]!, marks, { colorBy: "group" })).toBe("#3a0a10");
  });
  it("échelle continue pétrole (pas de rouge)", () => {
    const hi = resolveMarkColor(marks[2]!, marks, { colorScheme: "petrole", colorBy: "magnitude" });
    expect(hi).toBe("#8ECFE2");
    const hot = resolveMarkColor(marks[2]!, marks, { colorScheme: "altairady", colorBy: "magnitude" });
    expect(hot).toBe("#d62839");
  });
  it("jetons d'accent par schéma", () => {
    expect(brandForScheme("petrole")).toBe(BRAND_PETROLE);
    expect(brandForScheme("altairady")).toBe(BRAND);
    expect(BRAND_PETROLE.accent).toBe("#0E6E8C");
  });
});
