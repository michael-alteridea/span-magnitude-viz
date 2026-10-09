/** Nuancier : grille par teinte, noms français uniques, sans code affiché, récentes. */
import { describe, expect, it } from "vitest";
import { CHARTE, NUANCIER, RECENT_MAX, colorName, pushRecent } from "../src/ui/nuancier";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

describe("nuancier", () => {
  it("10 colonnes de teintes dans l'ordre demandé, 6 nuances chacune (60 + 6 de la charte ≈ 64)", () => {
    expect(NUANCIER.map((c) => c.hue)).toEqual(["Rouges", "Oranges", "Jaunes", "Verts", "Turquoises", "Bleus", "Violets", "Roses", "Bruns", "Gris"]);
    expect(NUANCIER.every((c) => c.swatches.length === 6)).toBe(true);
    expect(NUANCIER.flatMap((c) => c.swatches).length + CHARTE.length).toBe(66);
  });
  it("chaque colonne va du clair au foncé", () => {
    for (const col of NUANCIER) {
      const l = col.swatches.map(([c]) => lum(c));
      for (let i = 1; i < l.length; i++) expect(l[i]!, `${col.hue} ${i}`).toBeLessThan(l[i - 1]!);
    }
  });
  it("noms français uniques, sans code hexadécimal ; couleurs valides et uniques", () => {
    const all = [...CHARTE, ...NUANCIER.flatMap((c) => c.swatches)];
    const grid = NUANCIER.flatMap((c) => c.swatches);
    expect(new Set(grid.map(([, n]) => n)).size).toBe(grid.length);
    expect(new Set(grid.map(([c]) => c.toUpperCase())).size).toBe(grid.length);
    for (const [c, n] of all) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/i);
      expect(n).not.toMatch(/#|[0-9a-f]{6}/i);
    }
    expect(colorName("#1e3a8a")).toBe("bleu nuit");
    expect(colorName("#0E6E8C")).toBe("pétrole");
    expect(colorName("#123456")).toBe("couleur personnalisée");
  });
  it("la charte (pétrole) reste la première rangée", () => {
    expect(CHARTE[0]).toEqual(["#0E6E8C", "pétrole"]);
  });
  it("récentes : la dernière en tête, sans doublon, 8 au plus", () => {
    let r: string[] = [];
    for (const c of ["#111111", "#222222", "#111111"]) r = pushRecent(r, c);
    expect(r).toEqual(["#111111", "#222222"]);
    for (let i = 0; i < 12; i++) r = pushRecent(r, `#0000${String(i).padStart(2, "0")}`);
    expect(r.length).toBe(RECENT_MAX);
    expect(r[0]).toBe("#000011");
  });
});
