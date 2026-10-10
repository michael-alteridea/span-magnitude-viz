/** Projets d'exemple intégrés (?projet=<id>) : catalogue, adresse, lecture du fichier livré, ouverture sans doublon. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECTS, exampleProjectById, exampleProjectUrl, loadExampleProject, withoutProjectParam } from "../src/project/examples";
import { ProjectController } from "../src/project/controller";
import { MemoryProjectRepo } from "../src/project/repo";
import type { Project } from "../src/project/project";

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
const BASE = "https://alteridea-dashboard.web.app/reporting/?projet=petrole-mazout";

describe("projets d'exemple : catalogue et adresses", () => {
  it("petrole-mazout est listé, trouvé sans tenir compte de la casse ; inconnu ou vide → null", () => {
    expect(EXAMPLE_PROJECTS.map((e) => e.id)).toContain("petrole-mazout");
    expect(exampleProjectById("petrole-mazout")?.name).toBe("Pétrole et mazout, en euros");
    expect(exampleProjectById(" Petrole-Mazout ")?.id).toBe("petrole-mazout");
    expect(exampleProjectById("inconnu")).toBeNull();
    expect(exampleProjectById("")).toBeNull();
    expect(exampleProjectById(null)).toBeNull();
    expect(exampleProjectById("../index")).toBeNull();
  });

  it("adresse relative à la page du Studio (sous-chemin /reporting/ gardé, paramètres ignorés)", () => {
    const e = exampleProjectById("petrole-mazout")!;
    expect(exampleProjectUrl(e, BASE)).toBe("https://alteridea-dashboard.web.app/reporting/exemples/petrole-mazout.datanime");
    expect(exampleProjectUrl(e, "http://localhost:4174/")).toBe("http://localhost:4174/exemples/petrole-mazout.datanime");
  });

  it("retire seulement le paramètre projet de l'adresse", () => {
    expect(withoutProjectParam(BASE)).toBe("/reporting/");
    expect(withoutProjectParam("https://x.test/reporting/?reset&projet=petrole-mazout&donnees=exemples#/revues")).toBe("/reporting/?reset=&donnees=exemples#/revues");
  });

  it("chaque exemple du catalogue existe dans public/ et se lit comme un .datanime", async () => {
    for (const e of EXAMPLE_PROJECTS) {
      const p = await loadExampleProject(e, BASE, fileFetcher);
      expect(p.sequence.snapshots.length).toBeGreaterThan(0);
    }
  });
});

describe("projets d'exemple : petrole-mazout", () => {
  it("jeu de données inclus (8 années, Brent et mazout) et une scène « Pétrole et mazout, en euros » à deux séries", async () => {
    const p = await loadExampleProject(exampleProjectById("petrole-mazout")!, BASE, fileFetcher);
    expect(p.id).toBe("prj-petrole-mazout");
    expect(p.source?.sampleId).toBeNull();
    expect(p.source?.rows?.length).toBe(8);
    expect(Object.keys(p.source!.rows![0]!)).toEqual(expect.arrayContaining(["Année", "Brent (€/baril)", "Mazout Belgique (€/litre)"]));
    expect(p.sequence.snapshots).toHaveLength(1);
    const s = p.sequence.snapshots[0]!;
    expect(s.title).toBe("Pétrole et mazout, en euros");
    const enc = (s.spec as { encoding: { y: string[]; y2: string } }).encoding;
    expect(enc.y).toEqual(["Mazout Belgique (€/litre)"]);
    expect(enc.y2).toBe("Brent (€/baril)");
  });

  it("fichier absent → erreur lisible", async () => {
    const e = { id: "x", name: "X", description: "", file: "exemples/absent.datanime", scenes: [] };
    await expect(loadExampleProject(e, BASE, fileFetcher)).rejects.toThrow(/introuvable \(HTTP 404\)/);
  });

  it("ancienne configuration refusée", async () => {
    const e = exampleProjectById("petrole-mazout")!;
    await expect(loadExampleProject(e, BASE, async () => ({ ok: true, status: 200, json: async () => ({ type: "bar" }) }))).rejects.toThrow(/fichier de projet attendu/);
  });
});

describe("projets d'exemple : ouverture (ProjectController.openExample)", () => {
  function controller(repo: MemoryProjectRepo) {
    const applied: unknown[] = [];
    const store = { state: { spec: {}, ds: null, sampleId: null, provenance: null, story: { title: "", snapshots: [], sameScale: false }, datasets: [], dsVersion: 0 }, setDatasets() {}, setStory(st: unknown) { (store.state as { story: unknown }).story = st; } };
    const c = new ProjectController({
      store: store as never,
      repo,
      morph: () => false,
      setMorph() {},
      chartThumb: async () => null,
      applySource: async (src, spec) => void applied.push([src, spec]),
      loadDefault() {},
      settle: async () => {},
      onChange() {},
    });
    return { c, applied };
  }

  it("1re visite : importé et ouvert ; visites suivantes : même projet rouvert, pas de doublon ; copie modifiée gardée", async () => {
    const ex = await loadExampleProject(exampleProjectById("petrole-mazout")!, BASE, fileFetcher);
    const repo = new MemoryProjectRepo();
    const { c, applied } = controller(repo);
    const a = await c.openExample(structuredClone(ex));
    expect(a.id).toBe("prj-petrole-mazout");
    expect(c.saved?.id).toBe("prj-petrole-mazout");
    expect(applied).toHaveLength(1);
    await c.openExample(structuredClone(ex));
    expect((await repo.list()).length).toBe(1);
    // copie enregistrée modifiée : l'exemple est importé à côté, la copie n'est pas écrasée
    const mod: Project = { ...(await repo.get("prj-petrole-mazout"))!, spec: { type: "bar" } };
    await repo.put(mod);
    const b = await c.openExample(structuredClone(ex));
    expect(b.id).not.toBe("prj-petrole-mazout");
    const list = await repo.list();
    expect(list.length).toBe(2);
    expect((await repo.get("prj-petrole-mazout"))!.spec).toEqual({ type: "bar" });
  });
});
