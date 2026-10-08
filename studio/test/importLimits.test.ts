/** Import sécurisé : version SheetJS corrigée, limites de taille / lignes / cellules, source du fond de carte. */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { IMPORT_LIMITS, checkFileSize, checkTableSize, parseText, parseWorkbook } from "../src/data/files";
import { mapSourceLines } from "../src/charts/cartouche";
import { parseSpec } from "../src/spec";

const req = createRequire(import.meta.url);

describe("SheetJS", () => {
  it("version ≥ 0.20.2 (CVE-2023-30533, CVE-2024-22363)", () => {
    const v = (req("xlsx") as { version: string }).version.split(".").map(Number);
    expect(v[0]! > 0 || v[1]! > 20 || (v[1] === 20 && v[2]! >= 2)).toBe(true);
  });
});

describe("limites d'import", () => {
  it("refuse un fichier > 20 Mo avec un message français", () => {
    expect(() => checkFileSize(IMPORT_LIMITS.maxBytes + 1, "« gros.xlsx »")).toThrow(/trop volumineux .*20 Mo/);
    expect(() => checkFileSize(IMPORT_LIMITS.maxBytes)).not.toThrow();
  });
  it("refuse trop de lignes, de colonnes ou de cellules", () => {
    expect(() => checkTableSize(IMPORT_LIMITS.maxRows + 1, 3)).toThrow(/plus de 100\u202f000 lignes|plus de 100 000 lignes/);
    expect(() => checkTableSize(10, IMPORT_LIMITS.maxCols + 1)).toThrow(/colonnes/);
    expect(() => checkTableSize(50_000, 100)).toThrow(/cellules/);
    expect(() => checkTableSize(1000, 20)).not.toThrow();
  });
  it("classeur : feuille trop longue refusée (sheetRows + !fullref)", async () => {
    const X = req("xlsx") as typeof import("xlsx");
    const aoa: unknown[][] = [["a", "b"]];
    for (let i = 0; i < IMPORT_LIMITS.maxRows + 5; i++) aoa.push([i, i * 2]);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), "Données");
    const buf = X.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await expect(parseWorkbook(buf, "gros")).rejects.toThrow(/lignes/);
  });
  it("classeur normal lu", async () => {
    const X = req("xlsx") as typeof import("xlsx");
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Mois", "CA"], ["janv. 2026", 12], ["févr. 2026", 14]]), "F1");
    const buf = X.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const r = await parseWorkbook(buf, "petit");
    expect(r.rows).toHaveLength(2);
  });
  it("texte collé trop long refusé", () => {
    expect(() => parseText("x".repeat(IMPORT_LIMITS.maxChars + 1))).toThrow(/trop long/);
  });
});

describe("source du fond de carte dans le cartouche", () => {
  const spec = (special: Record<string, unknown>, type = "map") => {
    const r = parseSpec({ type, special });
    if (!r.ok) throw new Error(r.issues.join(";"));
    return r.spec;
  };
  it("carte FR·BE et NUTS : © EuroGeographics + usage non commercial", () => {
    expect(mapSourceLines(spec({ mapRegion: "fr-be" }))).toEqual(["Fond : © EuroGeographics, Natural Earth", "Limites GISCO : usage non commercial"]);
    expect(mapSourceLines(spec({ mapRegion: "europe", mapLevel: "nuts2" }))[1]).toMatch(/non commercial/);
  });
  it("Europe pays : Natural Earth (domaine public) ; autres graphiques : rien", () => {
    expect(mapSourceLines(spec({ mapRegion: "europe", mapLevel: "country" }))).toEqual(["Fond : Natural Earth (domaine public)"]);
    expect(mapSourceLines(spec({}, "bar"))).toEqual([]);
  });
});
