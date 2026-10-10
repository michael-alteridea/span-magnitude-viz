/** « Accès au film » (Entrée libre / Mail demandé) : réglage du projet, enregistré dans le .datanime, défaut = mail demandé. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectFile, projectSig, sequenceToStory, toProjectFile, type Project } from "../src/project/project";
import { parseStory, parseFilmAccess, FILM_ACCESS_LABELS } from "../src/story/snapshots";
import { EXAMPLE_PROJECTS } from "../src/project/examples";

const base = (film: Project["sequence"]["film"]): Project => ({
  id: "prj-x", name: "X", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", source: null, spec: null,
  sequence: { title: "T", snapshots: [], sameScale: false, film }, datasets: [], thumb: null,
});

describe("Accès au film", () => {
  it("libellés et lecture tolérante", () => {
    expect(FILM_ACCESS_LABELS).toEqual({ mail: "Mail demandé", libre: "Entrée libre" });
    expect(parseFilmAccess("libre")).toBe("libre");
    expect(parseFilmAccess("mail")).toBe("mail");
    expect(parseFilmAccess("ouvert")).toBeUndefined();
    expect(parseStory({ title: "T", access: "libre" }).access).toBe("libre");
    expect(parseStory({ title: "T" }).access).toBeUndefined();
  });

  it("enregistré dans le .datanime et relu (aller-retour), puis porté par la séquence du Studio", () => {
    for (const access of ["libre", "mail"] as const) {
      const f = JSON.parse(JSON.stringify(toProjectFile(base({ morph: false, access }))));
      expect(f.project.sequence.film.access).toBe(access);
      const r = parseProjectFile(f);
      if ("legacy" in r) throw new Error("legacy");
      expect(r.project.sequence.film.access).toBe(access);
      expect(sequenceToStory(r.project.sequence).access).toBe(access);
    }
  });

  it("absent (anciens fichiers, exemples intégrés) = mail demandé ; valeur inconnue ignorée", () => {
    const r = parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(base({ morph: false })))));
    if ("legacy" in r) throw new Error("legacy");
    expect(r.project.sequence.film.access).toBeUndefined();
    expect(sequenceToStory(r.project.sequence).access ?? "mail").toBe("mail");
    const bad = toProjectFile(base({ morph: false }));
    (bad.project.sequence.film as Record<string, unknown>).access = "ouvert";
    const r2 = parseProjectFile(JSON.parse(JSON.stringify(bad)));
    if ("legacy" in r2) throw new Error("legacy");
    expect(r2.project.sequence.film.access).toBeUndefined();
  });

  it("signature : défaut inchangé (mail = absent), entrée libre = modification", () => {
    const w = (film: Project["sequence"]["film"]) => ({ source: null, spec: null, sequence: base(film).sequence, datasets: [] });
    expect(projectSig(w({ morph: false, access: "mail" }))).toBe(projectSig(w({ morph: false })));
    expect(projectSig(w({ morph: false, access: "libre" }))).not.toBe(projectSig(w({ morph: false })));
  });

  it("exemples intégrés : réglage inchangé (aucun accès libre sans accord)", () => {
    for (const e of EXAMPLE_PROJECTS) {
      const raw = JSON.parse(readFileSync(resolve(__dirname, "../public", e.file), "utf8"));
      expect(`${e.id}:${raw.project.sequence.film?.access ?? "mail"}`).toBe(`${e.id}:mail`);
    }
  });
});
