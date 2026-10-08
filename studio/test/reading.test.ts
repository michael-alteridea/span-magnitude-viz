/**
 * Mode lecture (liens profonds #/lire/…, démos autonomes) et export PowerPoint Morph
 * (nommage « !! », injection de la transition avec repli fondu, formes natives, QR vers le mode lecture).
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { DEMO_STORIES, LOCAL_STORY_ID, READING_PUBLIC_BASE, demoStoryOf, parseReadRoute, readHash, readUrl, readingStoryIdFor, snapshotReadUrl } from "../src/story/reading";
import { parseRoute } from "../src/review/model";
import { demoPipelineReview, demoReadingStory, scenarioSnapshots } from "../src/review/demo";
import { SCENARIO_DIRCOM } from "../src/story/scenarios";
import { MORPH_TRANSITION_XML, cssColorHex, drillStepAdded, injectMorphTransition, markName, slideNumber, uniqueNames, zoomName, type NativeSlide } from "../src/story/morph";
import { readingSize } from "../src/ui/storyFilm";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("liens du mode lecture", () => {
  it("route #/lire/<histoire>/<snapshot> : lecture, écriture, encodage", () => {
    expect(parseReadRoute("#/lire/demo-dircom/dircom-03-mois-focus-88z5ap")).toEqual({ storyId: "demo-dircom", snapId: "dircom-03-mois-focus-88z5ap" });
    expect(parseReadRoute("#/lire/demo-daf")).toEqual({ storyId: "demo-daf", snapId: null });
    expect(parseReadRoute("#/lire")).toBeNull();
    expect(parseReadRoute("#/revues/x")).toBeNull();
    expect(parseReadRoute("#/lire/%E9")).toBeNull();
    const h = readHash("revue été", "s/1");
    expect(h).toBe("#/lire/revue%20%C3%A9t%C3%A9/s%2F1");
    expect(parseReadRoute(h)).toEqual({ storyId: "revue été", snapId: "s/1" });
    // l'espace Revues ignore les routes de lecture
    expect(parseRoute("#/lire/demo-dircom/x")).toBeNull();
    expect(readUrl(READING_PUBLIC_BASE, "demo-daf", "daf-05")).toBe("https://alteridea-dashboard.web.app/reporting/#/lire/demo-daf/daf-05");
  });

  it("histoire de lecture : démo intégrée (scénario + exemple d'origine), sinon revue / histoire locale", () => {
    expect(readingStoryIdFor({ scenario: "dircom", sampleId: "demo-pipeline" })).toBe("demo-dircom");
    expect(readingStoryIdFor({ scenario: "daf", sampleId: "demo-finance" })).toBe("demo-daf");
    // même scénario sur d'autres données : pas de lien universel
    expect(readingStoryIdFor({ scenario: "dircom", sampleId: null }, "norvia-x")).toBe("norvia-x");
    expect(readingStoryIdFor({ scenario: undefined, sampleId: "demo-pipeline" })).toBe(LOCAL_STORY_ID);
    expect(demoStoryOf([{ scenario: "daf", sampleId: "demo-finance" }, { scenario: "daf", sampleId: "demo-finance" }])).toBe("demo-daf");
    expect(demoStoryOf([{ scenario: "daf", sampleId: "demo-finance" }, { scenario: undefined, sampleId: null }])).toBeNull();
    expect(demoStoryOf([])).toBeNull();
    expect(snapshotReadUrl("https://x/reporting/", { id: "s1", scenario: undefined, sampleId: null }, "rev-1")).toBe("https://x/reporting/#/lire/rev-1/s1");
  });

  it("démos autonomes : recalculées depuis les données embarquées, mêmes identifiants que le Studio et les revues", async () => {
    const d = await demoReadingStory("demo-dircom");
    expect(d?.title).toBe(SCENARIO_DIRCOM.storyTitle);
    const ids = d!.snapshots.map((s) => s.id);
    expect(ids).toContain("dircom-03-mois-focus-88z5ap");
    expect(ids).toHaveLength(7);
    // identifiants stables : indépendants de la date de génération
    const again = await scenarioSnapshots("demo-pipeline", SCENARIO_DIRCOM, "2030-01-01T00:00:00Z");
    expect(again.snaps.map((s) => s.id)).toEqual(ids);
    expect((await demoPipelineReview()).snapshots.map((s) => s.id)).toEqual(ids);
    // chaque snapshot renvoie vers sa démo (QR universel)
    for (const s of d!.snapshots) expect(readingStoryIdFor(s)).toBe("demo-dircom");
    const f = await demoReadingStory("demo-daf");
    expect(f!.snapshots.map((s) => s.id).every((id) => /^daf-\d\d-.+-1051jsm$/.test(id))).toBe(true);
    expect(await demoReadingStory("inconnue")).toBeNull();
    expect(DEMO_STORIES.map((x) => x.id)).toEqual(["demo-dircom", "demo-daf"]);
  });

  it("format adapté à l'écran : 16:9 en paysage, portrait sur téléphone / tablette", () => {
    expect(readingSize(1400, 760, 1440)).toBeNull();
    const pad = readingSize(740, 880, 768)!;
    expect(pad.width).toBe(1000);
    expect(pad.height).toBeGreaterThan(pad.width);
    const phone = readingSize(378, 690, 390)!;
    expect(phone.width).toBe(640);
    expect(phone.height).toBeLessThanOrEqual(640 * 1.8);
    expect(phone.boost).toBeGreaterThan(pad.boost);
  });
});

describe("PowerPoint Morph", () => {
  const SLIDE = `<?xml version="1.0"?><p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  it("transition Morph avec repli fondu, insérée après p:clrMapOvr, idempotente", () => {
    const x = injectMorphTransition(SLIDE);
    expect(x).toContain(`</p:clrMapOvr>${MORPH_TRANSITION_XML}</p:sld>`);
    expect(x).toMatch(/<mc:Choice [^>]*Requires="p159"><p:transition [^>]*><p159:morph option="byObject"\/><\/p:transition><\/mc:Choice>/);
    expect(x).toContain(`<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback>`);
    expect(injectMorphTransition(x)).toBe(x);
    // avant p:timing quand il n'y a pas de clrMapOvr
    expect(injectMorphTransition(`<p:sld><p:cSld/><p:timing/></p:sld>`)).toBe(`<p:sld><p:cSld/>${MORPH_TRANSITION_XML}<p:timing/></p:sld>`);
    expect(slideNumber("ppt/slides/slide12.xml")).toBe(12);
    expect(slideNumber("ppt/slides/_rels/slide12.xml.rels")).toBeNull();
  });

  it("noms « !! » : clés de données, uniques par diapositive ; zoom entre deux étapes du chemin", () => {
    expect(markName("barre", ["1767225600000"], 0)).toBe("!!barre:1767225600000#0");
    expect(markName("ref", ["commercial=Julie M."], 0)).toBe("!!ref:commercial=Julie_M.#0");
    expect(uniqueNames(["!!a", "!!b", "!!a", "!!a"])).toEqual(["!!a", "!!b", "!!a~2", "!!a~3"]);
    expect(zoomName(3)).toBe("!!zoom-3");
    expect(cssColorHex("rgb(14, 110, 140)")).toBe("#0E6E8C");
    expect(cssColorHex("#3fa7c4")).toBe("#3FA7C4");
    expect(cssColorHex("none")).toBeNull();
    expect(cssColorHex('url("#hachures")')).toBeNull();
    expect(cssColorHex("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("étape ajoutée au chemin : zoom de la barre cliquée vers le détail", async () => {
    const { snaps } = await scenarioSnapshots("demo-pipeline", SCENARIO_DIRCOM, "2026-10-08T06:30:00+02:00");
    const step = drillStepAdded(snaps[0]!.spec, snaps[1]!.spec);
    expect(step?.kind).toBe("period");
    expect(drillStepAdded(snaps[1]!.spec, snaps[0]!.spec)).toBeNull();
    expect(drillStepAdded({ type: "bar" }, snaps[1]!.spec)).toBeNull();
  });

  it("export : formes natives nommées, séquence de construction, transitions, QR / lien vers le mode lecture", async () => {
    const { buildPptx } = await import("../src/story/pptx");
    const { snaps } = await scenarioSnapshots("demo-pipeline", SCENARIO_DIRCOM, "2026-10-08T06:30:00+02:00");
    const two = snaps.slice(0, 2);
    const bar = (name: string, h: number) => ({ name, x: 0.1, y: 0.8 - h, w: 0.05, h, fill: "#3FA7C4", opacity: 1, stroke: null, dash: false });
    const native = new Map<string, NativeSlide[]>([
      [two[0]!.id, [{ stage: "amorce", bg: { data: PNG, width: 1200, height: 675 }, marks: [bar("!!barre:q1#0", 0)] }, { stage: "complet", bg: { data: PNG, width: 1200, height: 675 }, marks: [bar("!!zoom-0", 0.5)] }]],
      [two[1]!.id, [{ stage: "complet", bg: { data: PNG, width: 1200, height: 675 }, marks: [{ ...bar("!!zoom-0", 0.6), opacity: 0 }, { ...bar("!!ref:x#0", 0.3), fill: null, stroke: "#0E6E8C", dash: true }] }]],
    ]);
    const links = new Map(two.map((s) => [s.id, readUrl(READING_PUBLIC_BASE, "demo-dircom", s.id)]));
    const buf = (await buildPptx({ title: "Revue du pipeline", snapshots: two }, { images: new Map(), native, links, morph: true, outputType: "nodebuffer", now: new Date(2026, 9, 8) })) as Uint8Array;
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((p) => slideNumber(p) !== null);
    expect(slides).toHaveLength(5); // couverture, sommaire, amorce + complet, complet
    const xml = async (n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async("string");
    expect(await xml(1)).not.toContain("p159:morph");
    for (const n of [2, 3, 4, 5]) expect(await xml(n)).toContain("<p159:morph");
    const s3 = await xml(3);
    const s4 = await xml(4);
    const s5 = await xml(5);
    // amorce : titre et barres, commentaires à venir ; complet : commentaires
    expect(s3).toContain('name="!!titre"');
    expect(s3).toContain('name="!!barre:q1#0"');
    expect(s3).not.toContain('name="!!commentaires"');
    expect(s4).toContain('name="!!commentaires"');
    // zoom : même nom sur les deux diapositives, zone du détail transparente
    expect(s4).toContain('name="!!zoom-0"');
    expect(s5).toContain('name="!!zoom-0"');
    expect(s5).toMatch(/name="!!zoom-0"[\s\S]*?<a:alpha val="0"\/>/);
    expect(s5).toMatch(/name="!!ref:x#0"[\s\S]*?<a:prstDash val="dash"\/>/);
    // lien de lecture : image du graphique et pied de page
    const rels = await zip.file("ppt/slides/_rels/slide4.xml.rels")!.async("string");
    expect(rels).toContain(`${READING_PUBLIC_BASE}#/lire/demo-dircom/${two[0]!.id}`);
    expect(s4).toContain("Mode lecture ›");
    expect(s4 + rels).not.toMatch(/certifi|authenticit|preuve|conforme/i);
    // numérotation des diapositives sur le total réel
    expect(s5).toContain("5 / 5");
  });

  it("export classique inchangé : ni transition ni nom « !! »", async () => {
    const { buildPptx } = await import("../src/story/pptx");
    const { snaps } = await scenarioSnapshots("demo-pipeline", SCENARIO_DIRCOM, "2026-10-08T06:30:00+02:00");
    const buf = (await buildPptx({ title: "R", snapshots: snaps.slice(0, 1) }, { images: new Map([[snaps[0]!.id, { data: PNG, width: 1200, height: 675 }]]), outputType: "nodebuffer" })) as Uint8Array;
    const zip = await JSZip.loadAsync(buf);
    const x = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(x).not.toContain("p159");
    expect(x).not.toContain('name="!!');
  });
});
