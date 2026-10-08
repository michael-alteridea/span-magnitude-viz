/**
 * Pont Cadencer : « manifeste de revue » (schéma Zod, adresses issues de la constante unique, construction,
 * empreintes, index) et exemple du contrat (studio/docs/contrat-cadencer.md) validé par le schéma.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_URL } from "../src/brand";
import { READING_PUBLIC_BASE } from "../src/story/reading";
import { VERIFY_URL } from "../src/provenance";
import { DEMO_FINANCE_ID, DEMO_PIPELINE_ID, demoPipelineReview, demoReadingStory } from "../src/review/demo";
import { DEMO_ANIMATOR_NOTES, demoNotesFor } from "../src/publish/demoNotes";
import {
  CONTRACT_REVISION,
  DATA_URL_MAX_CHARS,
  MANIFEST_MAX_BYTES,
  altOf,
  chartKindOf,
  imageFileOf,
  IMAGE_H,
  IMAGE_W,
  PUBLISHED_STORIES,
  buildIndex,
  buildManifest,
  cheminOf,
  commentaireOf,
  imageUrl,
  indexSchema,
  indexUrl,
  isPublished,
  isoLocal,
  isoOrNull,
  localStoryManifestId,
  manifestSchema,
  manifestUrl,
  snapshotFingerprint,
  type ManifestInput,
} from "../src/publish/manifest";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const here = dirname(fileURLToPath(import.meta.url));

async function pipelineInput(): Promise<ManifestInput> {
  const r = await demoPipelineReview();
  return {
    id: r.id,
    titre: r.title,
    persona: r.persona.audience,
    entreprise: "Norvia",
    date_reunion: r.meetingAt,
    genere_le: "2026-10-08T06:30:00+02:00",
    snapshots: r.snapshots.map((s) => ({ snap: s, note: r.notes[s.id] ?? null, png: PNG, svg: true })),
  };
}

describe("adresses du manifeste", () => {
  it("toutes dérivent de la constante unique PLATFORM_URL", () => {
    expect(PLATFORM_URL).toBe("https://alteridea-dashboard.web.app/reporting/");
    expect(READING_PUBLIC_BASE).toBe(PLATFORM_URL);
    expect(VERIFY_URL).toBe(`${PLATFORM_URL}verifier.html`);
    expect(indexUrl()).toBe("https://alteridea-dashboard.web.app/reporting/publie/index.json");
    expect(manifestUrl("demo-dircom")).toBe("https://alteridea-dashboard.web.app/reporting/publie/demo-dircom/manifeste.json");
    expect(imageUrl("norvia-budget-2026", "daf-05-baisse-mois-14j5oil", "png")).toBe("https://alteridea-dashboard.web.app/reporting/publie/norvia-budget-2026/daf-05-baisse-mois-14j5oil.png");
    // 1.1 : adresse versionnée par l'empreinte du snapshot (12 premiers caractères), nom de fichier inchangé
    const v = imageUrl("norvia-budget-2026", "daf-05-baisse-mois-14j5oil", "png", PLATFORM_URL, "3e82fc50fa44e17e93562b50");
    expect(v).toBe("https://alteridea-dashboard.web.app/reporting/publie/norvia-budget-2026/daf-05-baisse-mois-14j5oil.png?v=3e82fc50fa44");
    expect(imageFileOf(v)).toBe("daf-05-baisse-mois-14j5oil.png");
    expect(CONTRACT_REVISION).toBe("1.1");
    // futur domaine : une seule base à changer
    expect(manifestUrl("demo-daf", "https://datanime.io/")).toBe("https://datanime.io/publie/demo-daf/manifeste.json");
  });

  it("histoires publiées : les 2 démos et les 2 revues Norvia", () => {
    expect([...PUBLISHED_STORIES]).toEqual(["demo-dircom", "demo-daf", DEMO_PIPELINE_ID, DEMO_FINANCE_ID]);
    expect(isPublished("demo-dircom")).toBe(true);
    expect(isPublished("histoire")).toBe(false);
    expect([IMAGE_W, IMAGE_H]).toEqual([1600, 900]);
  });
});

describe("construction du manifeste", () => {
  it("revue pipeline Norvia (publiée) : champs du contrat", async () => {
    const m = await buildManifest(await pipelineInput(), { images: "publie" });
    expect(m.format).toBe("datanime-revue");
    expect(m.version).toBe(1);
    expect(m.id).toBe(DEMO_PIPELINE_ID);
    expect(m.persona).toBe("Directeur commercial");
    expect(m.entreprise).toBe("Norvia");
    expect(m.date_reunion).toBe("2026-10-08T09:00:00+02:00");
    expect(m.lien_lecture).toBe(`${PLATFORM_URL}#/lire/${DEMO_PIPELINE_ID}`);
    expect(m.source).toMatch(/Norvia/);
    // empreinte de la revue = empreinte des données (8 premiers caractères dans le cartouche : d923·bd5f)
    expect(m.empreinte).toMatch(/^d923bd5f[0-9a-f]{56}$/);
    expect(m.snapshots).toHaveLength(7);
    const s3 = m.snapshots[2]!;
    expect(s3.position).toBe(3);
    expect(s3.id).toBe("dircom-03-mois-focus-88z5ap");
    expect(s3.chemin).toBe("Pipeline créé › T2 2026 › Juin 2026");
    expect(s3.a_retenir).toHaveLength(3);
    // 1.1 : synthèse en une phrase (message du snapshot), distincte des puces
    expect(s3.commentaire_genere).toContain(s3.titre);
    expect(s3.commentaire_genere).toMatch(/^(Pour situer|Point d'attention|Ce que montre l'analyse|À décider|Message) \(Pipeline créé › T2 2026 › Juin 2026\) — /);
    expect(s3.a_retenir).not.toContain(s3.commentaire_genere);
    expect(s3.commentaire_genere).not.toBe(s3.a_retenir.join(" "));
    expect(s3.commentaire_genere.match(/[.!?…](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(s3.commentaire_animateur).toMatch(/Pas d'incident CRM/);
    const v = s3.empreinte.slice(0, 12);
    expect(s3.image_png).toBe(`${PLATFORM_URL}publie/${DEMO_PIPELINE_ID}/dircom-03-mois-focus-88z5ap.png?v=${v}`);
    expect(s3.image_svg).toBe(`${PLATFORM_URL}publie/${DEMO_PIPELINE_ID}/dircom-03-mois-focus-88z5ap.svg?v=${v}`);
    // 1.1 : texte alternatif (type de graphique, périmètre, chiffre clé)
    expect(s3.alt).toMatch(/^Courbe du cumul jour par jour/);
    expect(s3.alt).toContain("Pipeline créé › T2 2026 › Juin 2026");
    expect(s3.alt).toMatch(/\d/);
    for (const s of m.snapshots) expect(s.alt.length).toBeGreaterThan(20);
    expect(m.snapshots[3]!.alt).toMatch(/^Carte des régions France · Belgique/);
    expect(s3.lien_lecture).toBe(`${PLATFORM_URL}#/lire/${DEMO_PIPELINE_ID}/dircom-03-mois-focus-88z5ap`);
    expect(s3.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(m.snapshots.map((s) => s.empreinte)).size).toBe(7);
  });

  it("déterministe ; mêmes empreintes de snapshots pour la démo et la revue (même contenu)", async () => {
    const a = await buildManifest(await pipelineInput(), { images: "publie" });
    const b = await buildManifest(await pipelineInput(), { images: "publie" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const demo = (await demoReadingStory("demo-dircom"))!;
    const prints = await Promise.all(demo.snapshots.map((s) => snapshotFingerprint(s)));
    expect(prints).toEqual(a.snapshots.map((s) => s.empreinte));
    const changed = await snapshotFingerprint({ ...demo.snapshots[0]!, title: "Autre titre" });
    expect(changed).not.toBe(prints[0]);
  });

  it("manifeste téléchargé (histoire locale) : images intégrées, sans SVG, liens de lecture null (non partagés)", async () => {
    const input = await pipelineInput();
    const id = await localStoryManifestId(input.snapshots.map((x) => x.snap.id));
    expect(id).toMatch(/^histoire-[0-9a-f]{10}$/);
    const m = await buildManifest({ ...input, id, readId: "histoire", date_reunion: null, persona: "", entreprise: "" }, { images: "integre", readBase: "http://localhost:5174/" });
    expect(m.snapshots[0]!.image_png).toBe(PNG);
    expect("image_svg" in m.snapshots[0]!).toBe(false);
    expect(m.lien_lecture).toBeNull();
    expect(m.snapshots.every((s) => s.lien_lecture === null)).toBe(true);
    expect(m.date_reunion).toBeNull();
    // limites des images intégrées
    expect([DATA_URL_MAX_CHARS, MANIFEST_MAX_BYTES]).toEqual([800_000, 12_000_000]);
    const big = "data:image/png;base64," + "A".repeat(DATA_URL_MAX_CHARS);
    expect(manifestSchema.safeParse({ ...m, snapshots: m.snapshots.map((s, i) => (i ? s : { ...s, image_png: big })) }).success).toBe(false);
  });

  it("index des revues publiées", async () => {
    const m = await buildManifest(await pipelineInput(), { images: "publie" });
    const idx = buildIndex([m], m.genere_le);
    expect(idx).toEqual({
      format: "datanime-index",
      version: 1,
      genere_le: "2026-10-08T06:30:00+02:00",
      revues: [{ id: DEMO_PIPELINE_ID, titre: m.titre, persona: "Directeur commercial", manifeste: manifestUrl(DEMO_PIPELINE_ID), empreinte: m.empreinte, genere_le: m.genere_le, nb_snapshots: 7 }],
    });
    expect(indexSchema.safeParse({ ...idx, version: 2 }).success).toBe(false);
  });
});

describe("schéma Zod du manifeste", () => {
  it("refuse les manifestes hors contrat, ignore les champs inconnus", async () => {
    const m = await buildManifest(await pipelineInput(), { images: "publie" });
    const bad = (patch: (x: typeof m) => unknown) => manifestSchema.safeParse(patch(structuredClone(m))).success;
    expect(manifestSchema.safeParse(m).success).toBe(true);
    expect(bad((x) => ({ ...x, format: "autre" }))).toBe(false);
    expect(bad((x) => ({ ...x, version: 2 }))).toBe(false);
    expect(bad((x) => ({ ...x, snapshots: [] }))).toBe(false);
    expect(bad((x) => ({ ...x, empreinte: "abc" }))).toBe(false);
    expect(bad((x) => ({ ...x, genere_le: "8 oct. 2026" }))).toBe(false);
    expect(bad((x) => ({ ...x, date_reunion: "2026-10-08T09:00:00" }))).toBe(false);
    expect(bad((x) => ({ ...x, lien_lecture: "/reporting/#/lire/x" }))).toBe(false);
    expect(bad((x) => (x.snapshots[1]!.position = 5, x))).toBe(false);
    expect(bad((x) => (x.snapshots[1]!.id = x.snapshots[0]!.id, x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.image_png = "https://exemple.org/a.jpg", x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.image_png = "data:image/jpeg;base64,AAAA", x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.image_svg = "data:image/svg+xml;base64,AAAA", x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.id = "a b", x))).toBe(false);
    // 1.1 : version d'image = empreinte, synthèse ≠ puces, alt obligatoire, lien https obligatoire pour une revue publiée
    expect(bad((x) => (x.snapshots[0]!.image_png = x.snapshots[0]!.image_png.split("?")[0]!, x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.image_png = x.snapshots[0]!.image_png.replace(/v=.*/, "v=000000000000"), x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.commentaire_genere = x.snapshots[0]!.a_retenir.join(" "), x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.commentaire_genere = x.snapshots[0]!.a_retenir[0]!, x))).toBe(false);
    expect(bad((x) => (delete (x.snapshots[0] as Partial<typeof x.snapshots[0]>).alt, x))).toBe(false);
    expect(bad((x) => (x.snapshots[0]!.lien_lecture = null, x))).toBe(false);
    expect(bad((x) => ({ ...x, lien_lecture: null }))).toBe(false);
    // champ absent facultatif, champs inconnus ignorés (évolutions compatibles)
    expect(bad((x) => (delete x.snapshots[0]!.image_svg, x))).toBe(true);
    const extra = manifestSchema.parse({ ...m, nouveau: 1 }) as Record<string, unknown>;
    expect("nouveau" in extra).toBe(false);
  });

  it("l'exemple du contrat (studio/docs/contrat-cadencer.md) est valide", () => {
    const doc = readFileSync(join(here, "../docs/contrat-cadencer.md"), "utf8");
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((b) => JSON.parse(b[1]!));
    const manifest = blocks.find((b) => b.format === "datanime-revue");
    const index = blocks.find((b) => b.format === "datanime-index");
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
    expect(indexSchema.safeParse(index).success).toBe(true);
  });
});

describe("champs dérivés", () => {
  it("chemin, commentaire, dates ISO", () => {
    expect(cheminOf({ subtitle: "Pipeline créé en € · T2 2026 › Juin 2026 · jour par jour", path: ["Tout", "T2 2026", "Juin 2026"] })).toBe("Pipeline créé › T2 2026 › Juin 2026");
    expect(cheminOf({ subtitle: "Marge contributive en € · Réel 2025 → Budget 2026 · cascade par ligne métier", path: ["Tout"] })).toBe("Marge contributive");
    expect(cheminOf({ subtitle: "", path: undefined })).toBe("");
    const snap = { title: "Juin 2026 décroche : 1,3 M€", subtitle: "Pipeline créé en € · T2 2026", path: ["Tout", "T2 2026"], role: "tension", comments: ["Juin : −22 %", " Fin juin : 1,3 M€. ", ""] };
    expect(commentaireOf(snap)).toBe("Point d'attention (Pipeline créé › T2 2026) — Juin 2026 décroche : 1,3 M€.");
    expect(commentaireOf({ ...snap, title: "" })).toBe("");
    expect(chartKindOf({ type: "drill", drill: { view: "bridge" } })).toBe("Cascade des écarts");
    expect(chartKindOf({ type: "pie" })).toBe("Camembert");
    expect(altOf({ ...snap, title: "La Wallonie concentre la baisse", spec: { type: "drill", drill: { view: "map" } } })).toBe(
      "Carte des régions France · Belgique : Pipeline créé › T2 2026. La Wallonie concentre la baisse. Chiffre clé : Juin : −22 %."
    );
    expect(isoOrNull("2026-10-08T09:00:00+02:00")).toBe("2026-10-08T09:00:00+02:00");
    expect(isoOrNull("")).toBeNull();
    expect(isoOrNull("pas une date")).toBeNull();
    expect(isoLocal(new Date("2026-10-08T07:00:00Z"))).toMatch(/^2026-10-08T\d{2}:00:00[+-]\d{2}:\d{2}$/);
    expect(isoOrNull("2026-10-15T09:00")).toMatch(/^2026-10-15T09:00:00[+-]\d{2}:\d{2}$/);
  });
});

describe("démonstrations : notes d'animateur·rice fictives (1.1)", () => {
  it("3 notes par démo intégrée, rattachées aux snapshots publiés", async () => {
    for (const id of ["demo-dircom", "demo-daf"]) {
      const st = (await demoReadingStory(id))!;
      const notes = demoNotesFor(id, st.snapshots.map((s) => s.id));
      expect(Object.keys(notes)).toHaveLength(Object.keys(DEMO_ANIMATOR_NOTES[id]!).length);
      expect(Object.keys(notes).length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(notes).length).toBeLessThanOrEqual(3);
    }
    expect(demoNotesFor("histoire", ["a"])).toEqual({});
  });
});
