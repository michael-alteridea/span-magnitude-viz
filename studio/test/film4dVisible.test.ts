/** Films 4D visibles : chaque scène d'exemple désigne la source de son projet ; arcs assez épais pour lire la magnitude. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECTS, loadExampleProject } from "../src/project/examples";
import { computeLayout } from "../../src/layout";
import { tryParseDocument } from "../../src/index";

const PUBLIC = resolve(__dirname, "../public");
const fileFetcher = async (url: string) => {
  const path = new URL(url).pathname.replace(/^\/reporting\//, "");
  const txt = readFileSync(resolve(PUBLIC, path), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(txt) as unknown };
};

describe("films 4D visibles", () => {
  it("chaque scène des exemples intégrés désigne la source de son projet (sinon Film, lecture et Reel sont vides)", async () => {
    for (const e of EXAMPLE_PROJECTS) {
      const p = await loadExampleProject(e, "https://alteridea-dashboard.web.app/reporting/", fileFetcher);
      for (const s of p.sequence.snapshots) if (!s.sampleId) expect(`${e.id}:${s.dataName}`).toBe(`${e.id}:${p.source!.name}`);
    }
  });

  it("arcs : épaisseur lisible pour quelques marques, plus fine quand elles sont nombreuses", () => {
    const mk = (n: number) => {
      const r = tryParseDocument({
        version: 1, unit: "number", title: "", magnitudeLabel: "m", spanLabel: "s",
        marks: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, label: `M${i}`, magnitude: i + 1, span: { start: i, end: i + 3 } })),
      });
      if (!r.ok) throw new Error(r.error.issues.join(";"));
      return computeLayout(r.data, { geometry: "arc", width: 1000, height: 500 });
    };
    const few = mk(6).marks.map((m) => m.strokeWidth);
    expect(Math.max(...few)).toBeGreaterThan(20);
    expect(Math.min(...few)).toBeGreaterThan(3);
    const many = mk(300).marks.map((m) => m.strokeWidth);
    expect(Math.max(...many)).toBeLessThan(5);
  });
});
