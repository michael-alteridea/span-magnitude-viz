/** Projet d'exemple « Six chantiers, en spans » (?projet=spans-exemple) : données inventées, film span × magnitude, 1 scène. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECTS, exampleProjectById, exampleProjectUrl, loadExampleProject } from "../src/project/examples";
import { buildDataset } from "../src/data/table";
import { parseSpec } from "../src/spec";
import { buildSpanDocument } from "../src/charts/special";

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
const BASE = "https://alteridea-dashboard.web.app/reporting/?projet=spans-exemple";
const SUB = "Chaque barre va du début à la fin. L’épaisseur est le coût, en millions. Exemple inventé.";

describe("projet d'exemple spans-exemple", () => {
  it("listé après les exemples existants, adresse du fichier livré sous exemples/", () => {
    expect(EXAMPLE_PROJECTS.map((e) => e.id)).toEqual(["petrole-mazout", "mazout-decroche", "jeunes-belgique", "louvain-hainaut", "spans-exemple"]);
    const e = exampleProjectById("spans-exemple")!;
    expect(e.name).toBe("Six chantiers, en spans");
    expect(exampleProjectById(" Spans-Exemple ")?.id).toBe("spans-exemple");
    expect(exampleProjectUrl(e, BASE)).toBe("https://alteridea-dashboard.web.app/reporting/exemples/spans-exemple.datanime");
  });

  it("6 chantiers inventés, valeurs exactes, source « Exemple inventé »", async () => {
    const p = await loadExampleProject(exampleProjectById("spans-exemple")!, BASE, fileFetcher);
    expect(p.name).toBe("Six chantiers, en spans");
    const rows = p.source!.rows!;
    expect(rows.map((r) => [r["Nom"], r["Début"], r["Fin"], r["Grandeur (millions €)"]])).toEqual([
      ["Pont de Nivelles", "2019-03", "2021-11", 42],
      ["Ligne de bus 4", "2020-01", "2020-09", 8],
      ["Rénovation école", "2021-06", "2023-02", 27],
      ["Piste cyclable", "2022-04", "2024-08", 15],
      ["Médiathèque", "2023-01", "2025-06", 33],
      ["Éclairage communal", "2024-02", "2024-12", 6],
    ]);
    expect(rows.every((r) => r["Source"] === "Exemple inventé")).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/certifi|authenticit|Michaël|Michael/i);
  });

  it("1 scène film (span × magnitude) : début, fin, épaisseur = grandeur, révélée dans le temps", async () => {
    const p = await loadExampleProject(exampleProjectById("spans-exemple")!, BASE, fileFetcher);
    const sc = p.sequence.snapshots;
    expect(sc).toHaveLength(1);
    const parsed = parseSpec(sc[0]!.spec);
    if (!parsed.ok) throw new Error(parsed.issues.join(" ; "));
    const spec = parsed.spec;
    expect(spec.type).toBe("film");
    expect(spec.encoding).toMatchObject({ x: "Début", end: "Fin", y: ["Grandeur (millions €)"], label: "Nom" });
    expect(spec.mode.kind).toBe("dynamic");
    expect(spec.style.title).toBe("Six chantiers, en spans");
    expect(spec.style.subtitle).toBe(SUB);
    expect(spec.style.source).toBe("Exemple inventé");
    expect(sc[0]!.subtitle).toBe(SUB);
    const ds = buildDataset(p.source!.name, p.source!.rows as never, p.source!.typeOverrides as never);
    const { doc, error } = buildSpanDocument(spec, ds);
    expect(error).toBeNull();
    const marks = (doc as { marks: { label: string; magnitude: number; span: { start: string; end: string } }[] }).marks;
    expect(marks.map((m) => [m.label, m.magnitude])).toEqual([["Pont de Nivelles", 42], ["Ligne de bus 4", 8], ["Rénovation école", 27], ["Piste cyclable", 15], ["Médiathèque", 33], ["Éclairage communal", 6]]);
    expect(marks.every((m) => m.span.end > m.span.start)).toBe(true);
  });
});
