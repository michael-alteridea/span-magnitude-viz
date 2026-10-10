/** Projet d'exemple « Le mazout décroche du pétrole » (?projet=mazout-decroche) : données D1 / D2, 7 scènes, valeurs exactes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleProjectById, exampleProjectUrl, loadExampleProject } from "../src/project/examples";
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
const BASE = "https://alteridea-dashboard.web.app/reporting/?projet=mazout-decroche";

describe("projet d'exemple mazout-decroche", () => {
  it("listé, adresse du fichier livré sous exemples/", () => {
    const e = exampleProjectById("mazout-decroche")!;
    expect(e.name).toBe("Le mazout décroche du pétrole");
    expect(exampleProjectById(" Mazout-Decroche ")?.id).toBe("mazout-decroche");
    expect(exampleProjectUrl(e, BASE)).toBe("https://alteridea-dashboard.web.app/reporting/exemples/mazout-decroche.datanime");
  });

  it("source unique : 7 années + 10 mois (pas de septembre 2026), valeurs exactes", async () => {
    const p = await loadExampleProject(exampleProjectById("mazout-decroche")!, BASE, fileFetcher);
    expect(p.id).toBe("prj-mazout-decroche");
    const rows = p.source!.rows!;
    expect(rows).toHaveLength(17);
    expect(Object.keys(rows[0]!)).toEqual(["Période", "Granularité", "Date", "Mazout €/L", "Brent €/baril", "Rapport", "Source"]);
    const years = rows.filter((r) => r["Granularité"] === "Année");
    const months = rows.filter((r) => r["Granularité"] === "Mois");
    expect(years.map((r) => r["Mazout €/L"])).toEqual([0.7, 0.49, 0.68, 1.23, 1, 0.93, 0.84]);
    expect(years.map((r) => r["Brent €/baril"])).toEqual([57.5, 36.6, 59.9, 95.7, 76.3, 74.4, 61.3]);
    expect(years.map((r) => r["Rapport"])).toEqual([1.93, 2.13, 1.8, 2.04, 2.08, 1.99, 2.18]);
    expect(months.map((r) => r["Période"])).toEqual(["nov. 2025", "déc. 2025", "janv. 2026", "févr. 2026", "mars 2026", "avr. 2026", "mai 2026", "juin 2026", "juil. 2026", "août 2026"]);
    expect(months.map((r) => r["Mazout €/L"])).toEqual([0.89, 0.78, 0.78, 0.83, 1.22, 1.39, 1.27, 1.09, 1.23, 1.34]);
    expect(months.map((r) => r["Brent €/baril"])).toEqual([55, 52.7, 55.1, 58.7, 85.6, 87.1, 88.6, 73.3, 73.5, 75.9]);
    expect(months.map((r) => r["Rapport"])).toEqual([2.57, 2.36, 2.25, 2.25, 2.27, 2.54, 2.28, 2.36, 2.66, 2.81]);
    // rapport = mazout ÷ (Brent ÷ 159), arrondi à 0,01 près
    for (const r of rows) expect(Math.abs((r["Mazout €/L"] as number) / ((r["Brent €/baril"] as number) / 159) - (r["Rapport"] as number))).toBeLessThanOrEqual(0.01);
    const txt = JSON.stringify(p);
    expect(txt).not.toMatch(/certifi|authenticit|Michaël/i);
  });

  it("datasets D1 (annuel) et D2 (mensuel), 7 scènes dans l'ordre", async () => {
    const p = await loadExampleProject(exampleProjectById("mazout-decroche")!, BASE, fileFetcher);
    expect(p.datasets?.map((d) => d.id)).toEqual(["D1", "D2"]);
    const src = buildDataset(p.source!.name, p.source!.rows as never, p.source!.typeOverrides as never);
    expect(applyRecipe(src, p.datasets![0]!).rows).toHaveLength(7);
    expect(applyRecipe(src, p.datasets![1]!).rows).toHaveLength(10);
    const sc = p.sequence.snapshots;
    expect(sc).toHaveLength(7);
    expect(sc[0]!.title).toBe("Le mazout décroche du pétrole");
    expect(sc[0]!.subtitle).toBe("Belgique, prix officiel. Brent en euros.");
    const spec = (i: number) => sc[i]!.spec as { type: string; dataset: { id: string }; encoding: { y: string[]; y2: string | null }; style: { focus: { key: string | null } } };
    expect(spec(1).encoding).toMatchObject({ y: ["Mazout €/L"], y2: "Brent €/baril" });
    expect(spec(1).dataset.id).toBe("D1");
    expect(spec(2).style.focus.key).toBe("2022");
    expect(spec(3).dataset.id).toBe("D2");
    expect(spec(4).encoding.y).toEqual(["Rapport"]);
    expect(sc[1]!.comments).toEqual(["Les deux tombent après 2022."]);
    expect(sc[3]!.comments).toEqual(["Septembre 2026 : inconnu pour le Brent en euros."]);
    expect(sc[5]!.comments).toEqual(["De janvier à août 2026, le rapport passe de 2,25 à 2,81."]);
    expect(sc[6]!.title).toBe("Depuis janvier, le mazout grimpe plus vite que le pétrole.");
  });
});
