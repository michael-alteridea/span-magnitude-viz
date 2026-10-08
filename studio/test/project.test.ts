/** Projets (étape 1 du modèle « dataset d'abord ») : signatures, « modifiée », fichier .datanime, stockage. */
import { describe, expect, it } from "vitest";
import { demoReadingStory } from "../src/review/demo";
import { snapshotFingerprint } from "../src/publish/manifest";
import {
  DEFAULT_PROJECT_NAME,
  defaultProjectName,
  formatBytes,
  hhmm,
  parseProjectFile,
  projectFileName,
  projectSig,
  resetScene,
  savedLabel,
  sceneSig,
  sceneStates,
  toProjectFile,
  uniqueName,
  type Project,
} from "../src/project/project";
import { MemoryProjectRepo } from "../src/project/repo";

async function demoProject(): Promise<Project> {
  const story = (await demoReadingStory("demo-dircom"))!;
  return {
    id: "prj-test",
    name: "Revue Norvia",
    createdAt: "2026-10-08T21:00:00.000Z",
    updatedAt: "2026-10-08T21:12:00.000Z",
    source: { name: "Ventes Norvia", sampleId: null, rows: [{ Pays: "Belgique", CA: 12 }, { Pays: "France", CA: 30 }], typeOverrides: {}, provenance: null, note: null, rowCount: 2, colCount: 2 },
    spec: { type: "bar" },
    sequence: { title: story.title, snapshots: story.snapshots, sameScale: false, film: { morph: false } },
    thumb: null,
  };
}

describe("projets : scènes modifiées et réinitialisation", () => {
  it("une scène est « modifiée » si son graphique ou ses textes changent, pas si seuls le rendu ou les dates changent", async () => {
    const p = await demoProject();
    const saved = p.sequence.snapshots;
    const cur = saved.map((s) => ({ ...s }));
    cur[0] = { ...cur[0]!, thumb: "data:image/jpeg;base64,AAAA", generatedAt: "2030-01-01T00:00:00Z", svg: "<svg/>" };
    expect(sceneSig(cur[0]!)).toBe(sceneSig(saved[0]!));
    cur[1] = { ...cur[1]!, title: "Titre retouché" };
    const added = { ...saved[2]!, id: "nouvelle" };
    const st = sceneStates([...cur, added], saved);
    expect(st.get(saved[0]!.id)).toBe("saved");
    expect(st.get(saved[1]!.id)).toBe("modified");
    expect(st.get("nouvelle")).toBe("new");
    // jamais enregistré : tout est « nouvelle »
    expect([...sceneStates(cur, null).values()].every((v) => v === "new")).toBe(true);
    // ↺ : la scène reprend son état enregistré, à sa place, même identifiant
    const back = resetScene([...cur, added], saved, saved[1]!.id);
    expect(back[1]).toEqual(saved[1]);
    expect(back.map((s) => s.id)).toEqual([...cur, added].map((s) => s.id));
    expect(resetScene(cur, saved, "inconnue")).toEqual(cur);
  });

  it("signature du projet : source, graphique, séquence et film ; la provenance du spec n'y entre pas", async () => {
    const p = await demoProject();
    const w = { source: p.source, spec: p.spec, sequence: p.sequence };
    const base = projectSig(w);
    expect(projectSig({ ...w, spec: { ...(p.spec as object), provenance: { hash: "x" } } })).toBe(base);
    expect(projectSig({ ...w, spec: { type: "line" } })).not.toBe(base);
    expect(projectSig({ ...w, sequence: { ...p.sequence, title: "Autre" } })).not.toBe(base);
    expect(projectSig({ ...w, sequence: { ...p.sequence, film: { morph: true } } })).not.toBe(base);
    expect(projectSig({ ...w, sequence: { ...p.sequence, snapshots: p.sequence.snapshots.slice(1) } })).not.toBe(base);
    expect(projectSig({ ...w, source: { ...p.source!, rowCount: 3 } })).not.toBe(base);
  });
});

describe("projets : fichier .datanime", () => {
  it("aller-retour sans perte ; identifiants et empreintes des scènes inchangés (contrat Cadencer 1.1)", async () => {
    const p = await demoProject();
    const file = JSON.parse(JSON.stringify(toProjectFile(p, true, new Date("2026-10-08T21:15:00Z"))));
    expect(file.kind).toBe("datanime-project");
    expect(file.version).toBe(1);
    const r = parseProjectFile(file);
    if ("legacy" in r) throw new Error("legacy");
    expect(r.withData).toBe(true);
    expect(r.project.name).toBe("Revue Norvia");
    expect(r.project.source?.rows).toHaveLength(2);
    expect(r.project.sequence.snapshots.map((s) => s.id)).toEqual(p.sequence.snapshots.map((s) => s.id));
    const before = await Promise.all(p.sequence.snapshots.map((s) => snapshotFingerprint(s)));
    const after = await Promise.all(r.project.sequence.snapshots.map((s) => snapshotFingerprint(s)));
    expect(after).toEqual(before);
    // aucune clé ajoutée aux scènes (rien de nouveau dans l'empreinte)
    for (const [i, s] of r.project.sequence.snapshots.entries()) expect(Object.keys(s).sort()).toEqual(Object.keys(p.sequence.snapshots[i]!).sort());
  });

  it("export sans données : les lignes importées sont retirées ; ancienne configuration .r4d.json reconnue", async () => {
    const p = await demoProject();
    const r = parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(p, false))));
    if ("legacy" in r) throw new Error("legacy");
    expect(r.withData).toBe(false);
    expect(r.project.source?.rows).toBeNull();
    expect(parseProjectFile({ kind: "reporting-4d-studio", version: 1, spec: {} })).toEqual({ legacy: true });
    expect(parseProjectFile({ type: "bar" })).toEqual({ legacy: true });
    expect(() => parseProjectFile({ kind: "datanime-project", version: 99, project: {} })).toThrow(/Version 99/);
    expect(() => parseProjectFile(null)).toThrow();
  });

  it("noms : « Mon projet », unicité, nom de fichier, dates en français", () => {
    expect(defaultProjectName("Notre histoire en données", [])).toBe(DEFAULT_PROJECT_NAME);
    expect(defaultProjectName("Ventes export Norvia", [])).toBe("Ventes export Norvia");
    expect(uniqueName("Mon projet", ["Mon projet", "mon projet 2"])).toBe("Mon projet 3");
    expect(projectFileName("Ventes export Norvia — revue T3 2026")).toBe("ventes-export-norvia-revue-t3-2026.datanime");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2,4\u00a0Mo");
    expect(formatBytes(830 * 1024)).toBe("830\u00a0Ko");
    const now = new Date(2026, 9, 9, 0, 30);
    expect(savedLabel(new Date(2026, 9, 9, 0, 12).toISOString(), now)).toBe("aujourd'hui à 00:12");
    expect(savedLabel(new Date(2026, 9, 8, 23, 12).toISOString(), now)).toBe("hier à 23:12");
    expect(savedLabel(new Date(2026, 9, 6, 10, 5).toISOString(), now)).toBe("06/10/2026 à 10:05");
    expect(hhmm(new Date(2026, 9, 8, 23, 12).toISOString())).toBe("23:12");
  });
});

describe("projets : stockage", () => {
  it("liste triée par date, résumé sans lignes, suppression", async () => {
    const repo = new MemoryProjectRepo();
    const p = await demoProject();
    await repo.put(p);
    await repo.put({ ...p, id: "prj-b", name: "B", updatedAt: "2026-10-08T22:00:00.000Z" });
    const list = await repo.list();
    expect(list.map((m) => m.id)).toEqual(["prj-b", "prj-test"]);
    expect(list[1]).toMatchObject({ name: "Revue Norvia", scenes: 7, sourceName: "Ventes Norvia", rowCount: 2 });
    expect((list[1] as unknown as Record<string, unknown>).source).toBeUndefined();
    const got = await repo.get("prj-test");
    expect(got?.sequence.snapshots).toHaveLength(7);
    got!.name = "modifié hors dépôt";
    expect((await repo.get("prj-test"))!.name).toBe("Revue Norvia");
    await repo.delete("prj-b");
    expect((await repo.list()).map((m) => m.id)).toEqual(["prj-test"]);
  });
});
