/** Liens « Rejouer » : lecture universelle des projets d'exemple, QR du Reel, lien de présentation, origine `src`. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCOVER_URL, PLATFORM_HOST, PLATFORM_URL } from "../src/brand";
import { EXAMPLE_PROJECTS, exampleProjectById } from "../src/project/examples";
import { discoverUrl, exampleOfScenes, exampleReadUrl, exampleSceneOf, exampleSnapshotUrl, parseLectureParams, reelLinks, shortUrl, studioUrl, withoutShareParams } from "../src/project/shareLinks";
import { parseReadRoute } from "../src/story/reading";

const P = "https://alteridea-dashboard.web.app/reporting/";

describe("liens de lecture universels des exemples", () => {
  it("format exact : ?projet=<id>&lecture=1[&scene=N][&src=…], scène 1 implicite", () => {
    expect(exampleReadUrl("mazout-decroche")).toBe(`${P}?projet=mazout-decroche&lecture=1`);
    expect(exampleReadUrl("mazout-decroche", { scene: 1 })).toBe(`${P}?projet=mazout-decroche&lecture=1`);
    expect(exampleReadUrl("mazout-decroche", { scene: 4, src: "qr" })).toBe(`${P}?projet=mazout-decroche&lecture=1&scene=4&src=qr`);
    expect(exampleReadUrl("petrole-mazout", { src: "reel" })).toBe(`${P}?projet=petrole-mazout&lecture=1&src=reel`);
    expect(exampleReadUrl("mazout-decroche", { scene: 2.5 })).toBe(`${P}?projet=mazout-decroche&lecture=1`);
    expect(exampleReadUrl("x", { base: "http://localhost:4174/" })).toBe("http://localhost:4174/?projet=x&lecture=1");
  });

  it("les scènes du catalogue sont exactement celles des fichiers livrés, dans l'ordre", () => {
    for (const e of EXAMPLE_PROJECTS) {
      const f = JSON.parse(readFileSync(resolve(__dirname, "../public", e.file), "utf8"));
      expect(f.project.sequence.snapshots.map((s: { id: string }) => s.id)).toEqual([...e.scenes]);
    }
    const all = EXAMPLE_PROJECTS.flatMap((e) => e.scenes);
    expect(new Set(all).size).toBe(all.length);
  });

  it("scène d'exemple → lien universel avec son numéro ; scène locale → null (lien de cet appareil gardé)", () => {
    expect(exampleSceneOf("snap-mazout-decroche-mensuel")).toMatchObject({ example: { id: "mazout-decroche" }, scene: 4 });
    expect(exampleSnapshotUrl("snap-mazout-decroche-titre", "qr")).toBe(`${P}?projet=mazout-decroche&lecture=1&src=qr`);
    expect(exampleSnapshotUrl("snap-mazout-decroche-conclusion", "qr")).toBe(`${P}?projet=mazout-decroche&lecture=1&scene=7&src=qr`);
    expect(exampleSnapshotUrl("snap-petrole-mazout")).toBe(`${P}?projet=petrole-mazout&lecture=1`);
    expect(exampleSnapshotUrl("snap-1234-local")).toBeNull();
    expect(exampleSnapshotUrl("dircom-03-mois-focus")).toBeNull();
  });

  it("exemple d'un ensemble de scènes : un seul exemple, sinon null", () => {
    expect(exampleOfScenes(["snap-mazout-decroche-titre", "snap-mazout-decroche-conclusion"])?.id).toBe("mazout-decroche");
    expect(exampleOfScenes(["snap-mazout-decroche-titre", "snap-petrole-mazout"])).toBeNull();
    expect(exampleOfScenes(["snap-mazout-decroche-titre", "snap-local"])).toBeNull();
    expect(exampleOfScenes([])).toBeNull();
  });
});

describe("lecture des paramètres d'un lien partagé", () => {
  it("lecture, scène, origine", () => {
    expect(parseLectureParams("?projet=mazout-decroche&lecture=1&scene=3&src=qr")).toEqual({ projet: "mazout-decroche", lecture: true, scene: 3, src: "qr" });
    expect(parseLectureParams("?projet=mazout-decroche")).toEqual({ projet: "mazout-decroche", lecture: false, scene: null, src: null });
    expect(parseLectureParams("?projet=a&lecture").lecture).toBe(true);
    expect(parseLectureParams("?projet=a&lecture=true").lecture).toBe(true);
    expect(parseLectureParams("?projet=a&lecture=0").lecture).toBe(false);
    expect(parseLectureParams("?scene=0").scene).toBeNull();
    expect(parseLectureParams("?scene=").scene).toBeNull();
    expect(parseLectureParams("?scene=abc").scene).toBeNull();
    expect(parseLectureParams("?src=pub").src).toBeNull();
    expect(parseLectureParams("?src=site").src).toBe("site");
    expect(parseLectureParams("").projet).toBeNull();
  });

  it("un lien de lecture d'exemple n'est pas une route #/lire (anciens liens profonds inchangés)", () => {
    expect(parseReadRoute(new URL(exampleReadUrl("mazout-decroche")).hash)).toBeNull();
    expect(parseReadRoute("#/lire/demo-daf/daf-05-baisse-mois")).toEqual({ storyId: "demo-daf", snapId: "daf-05-baisse-mois" });
  });

  it("adresse nettoyée après ouverture : projet, lecture, scene, src retirés ; le reste gardé", () => {
    expect(withoutShareParams(`${P}?projet=mazout-decroche&lecture=1&scene=3&src=qr`)).toBe("/reporting/");
    expect(withoutShareParams("https://x.test/reporting/?reset&projet=a&lecture=1&donnees=exemples#/revues")).toBe("/reporting/?reset=&donnees=exemples#/revues");
  });
});

describe("Studio, présentation et Reel", () => {
  it("Studio et présentation avec origine", () => {
    expect(studioUrl()).toBe(PLATFORM_URL);
    expect(studioUrl("partage")).toBe(`${P}?src=partage`);
    expect(DISCOVER_URL).toBe("https://alteridea-dashboard.web.app/datanime-apercu/");
    expect(discoverUrl("reel")).toBe("https://alteridea-dashboard.web.app/datanime-apercu/?src=reel");
    expect(shortUrl(DISCOVER_URL)).toBe("alteridea-dashboard.web.app/datanime-apercu");
  });

  it("Reel d'un exemple : QR vers le film, lien visible en deux morceaux, ligne de présentation", () => {
    const l = reelLinks(exampleProjectById("mazout-decroche"));
    expect(l.qr).toBe(`${P}?projet=mazout-decroche&lecture=1&src=reel`);
    expect(l.label).toEqual(["alteridea-dashboard.web.app/reporting/", "?projet=mazout-decroche&lecture=1"]);
    expect(l.cta).toMatch(/rejouer le film/);
    expect(l.pitch).toBe("Découvrir Datanime : alteridea-dashboard.web.app/datanime-apercu");
    expect(l.pitchUrl).toBe(`${DISCOVER_URL}?src=reel`);
  });

  it("Reel d'un projet local : QR vers le Studio", () => {
    const l = reelLinks(null);
    expect(l.qr).toBe(`${P}?src=reel`);
    expect(l.label).toEqual([PLATFORM_HOST]);
    expect(l.cta).toBe("Scannez pour essayer");
  });

  it("aucun mot interdit dans les libellés", () => {
    const txt = JSON.stringify([reelLinks(null), reelLinks(exampleProjectById("mazout-decroche"))]);
    expect(txt).not.toMatch(/certifi|authenticit/i);
  });
});
