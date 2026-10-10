/** Projet d'exemple « HE Louvain en Hainaut : le V et le rebond » (?projet=louvain-hainaut) : 6 datasets, 7 scènes, valeurs exactes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECTS, exampleProjectById, exampleProjectUrl, loadExampleProject } from "../src/project/examples";
import { applyRecipe } from "../src/data/transform";
import { buildDataset } from "../src/data/table";

const PUBLIC = resolve(__dirname, "../public");
const fileFetcher = async (url: string) => {
  const path = new URL(url).pathname.replace(/^\/reporting\//, "");
  try {
    const txt = readFileSync(resolve(PUBLIC, path), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt) as unknown };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};
const BASE = "https://alteridea-dashboard.web.app/reporting/?projet=louvain-hainaut";

describe("projet d'exemple louvain-hainaut", () => {
  it("listé après les exemples existants, adresse du fichier livré sous exemples/", () => {
    expect(EXAMPLE_PROJECTS.map((e) => e.id).slice(0, 4)).toEqual(["petrole-mazout", "mazout-decroche", "jeunes-belgique", "louvain-hainaut"]);
    const e = exampleProjectById("louvain-hainaut")!;
    expect(e.name).toBe("HE Louvain en Hainaut : le V et le rebond");
    expect(exampleProjectById(" Louvain-Hainaut ")?.id).toBe("louvain-hainaut");
    expect(exampleProjectUrl(e, BASE)).toBe("https://alteridea-dashboard.web.app/reporting/exemples/louvain-hainaut.datanime");
  });

  it("source unique : 99 lignes, valeurs exactes de Louvain en Hainaut et des sites", async () => {
    const p = await loadExampleProject(exampleProjectById("louvain-hainaut")!, BASE, fileFetcher);
    expect(p.name).toBe("HE Louvain en Hainaut : le V et le rebond");
    const rows = p.source!.rows!;
    expect(rows).toHaveLength(99);
    const course = rows.filter((r) => r["Vue"] === "Course");
    expect(course).toHaveLength(70);
    expect(course.filter((r) => r["Établissement"] === "Louvain en Hainaut").map((r) => r["Étudiants pondérés"])).toEqual([1512.6, 1573.6, 1689.6, 1486, 1406.7, 1382.2, 1449.2]);
    const sites = rows.filter((r) => r["Vue"] === "Sites");
    expect(sites.map((r) => r["Charleroi (CIBI)"])).toEqual([null, 22, 24, 34, 33, 44, 42]);
    const txt = JSON.stringify(p);
    expect(txt).not.toMatch(/certifi|authenticit|Michaël|Michael/i);
  });

  it("6 datasets, 7 scènes dans l'ordre", async () => {
    const p = await loadExampleProject(exampleProjectById("louvain-hainaut")!, BASE, fileFetcher);
    expect(p.datasets?.map((d) => d.id)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6"]);
    const src = buildDataset(p.source!.name, p.source!.rows as never, p.source!.typeOverrides as never);
    expect(applyRecipe(src, p.datasets![0]!).rows.length).toBeGreaterThan(0);
    const sc = p.sequence.snapshots;
    expect(sc).toHaveLength(7);
    expect(sc.map((s) => (s.spec as { type: string }).type)).toEqual(["barH", "bar", "stackedArea", "stackedBar", "groupedBar", "line", "bar"]);
    expect(sc[0]!.title).toBe("Louvain en Hainaut : 3e en RP2020, 4e en RP2026");
    expect(sc[6]!.title).toBe("Après trois ans de baisse, +4,8 % : le rebond est là.");
    // tampon 4D en compteur à rouleaux (scènes 1 à 6)
    expect(sc.slice(0, 6).map((s) => (s.spec as { mode: { fourD: { stampStyle?: string } } }).mode.fourD.stampStyle)).toEqual(Array(6).fill("odometer"));
  });
});
