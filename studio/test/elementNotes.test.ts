import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import JSZip from "jszip";
import { chartSpecSchema, type ChartSpec, type ChartSpecInput } from "../src/spec";
import { buildDataset } from "../src/data/table";
import { SAMPLES } from "../src/data/samples";
import { elementAutoText, elementNotes, mainColor, rankPhrase } from "../src/story/elementNotes";
import { fingerprintSpec, snapshotFingerprint } from "../src/publish/manifest";

const sample = SAMPLES.find((s) => s.id === "renouvelables")!;
const ds = buildDataset(sample.name, sample.rows());
const specOf = (patch: (s: ChartSpecInput) => void = () => {}): ChartSpec => {
  const raw = JSON.parse(JSON.stringify(sample.spec)) as ChartSpecInput;
  patch(raw);
  return chartSpecSchema.parse(raw);
};
const withO = (o: Record<string, Record<string, unknown>>) => specOf((s) => (s.style = { ...s.style, overrides: o as never }));

describe("puces colorées par élément", () => {
  it("rang en toutes lettres", () => {
    expect(rankPhrase(1, 10)).toBe("le plus élevé");
    expect(rankPhrase(2, 10)).toBe("2e plus élevé");
    expect(rankPhrase(9, 10)).toBe("2e plus faible");
    expect(rankPhrase(10, 10)).toBe("le plus faible");
    expect(rankPhrase(1, 1)).toBe("");
  });

  it("aucune couleur propre ni mise en avant : aucune puce", () => {
    expect(elementNotes(specOf(), ds)).toEqual([]);
  });

  it("deux barres de couleurs différentes : deux puces, texte calculé à partir des données", () => {
    const n = elementNotes(withO({ "e:Finlande": { color: "#FF0000" }, "e:Danemark": { color: "#0070C0" } }), ds);
    expect(n.map((x) => x.color)).toEqual(expect.arrayContaining(["#FF0000", "#0070C0"]));
    expect(n).toHaveLength(2);
    for (const x of n) {
      expect(x.edited).toBe(false);
      expect(x.text).toBe(x.auto);
      expect(x.text).toMatch(/^(Finlande|Danemark)\u00a0: \d+(,\d)?\u00a0%, [+−]\d+,?\d*\u00a0pts? vs la moyenne ; (le plus élevé|\d+e plus (élevé|faible)|le plus faible)$/);
    }
  });

  it("même couleur : une seule puce « A et B : … » ; un commentaire saisi sort l'élément du groupe", () => {
    const n = elementNotes(withO({ "e:Finlande": { color: "#FF0000" }, "e:Danemark": { color: "#ff0000" } }), ds);
    expect(n).toHaveLength(1);
    expect(n[0]!.labels.sort()).toEqual(["Danemark", "Finlande"]);
    expect(n[0]!.text).toMatch(/ et /);
    const m = elementNotes(withO({ "e:Finlande": { color: "#FF0000", comment: "Finlande : record nordique" }, "e:Danemark": { color: "#FF0000" } }), ds);
    expect(m).toHaveLength(2);
    const f = m.find((x) => x.keys[0] === "e:Finlande")!;
    expect(f.edited).toBe(true);
    expect(f.text).toBe("Finlande : record nordique");
    expect(f.auto).toMatch(/^Finlande\u00a0: /);
  });

  it("mise en avant : la barre mise en avant a sa puce, dans sa couleur", () => {
    const sp = specOf((s) => (s.style = { ...s.style, focus: { key: "@max" } }));
    const n = elementNotes(sp, ds);
    expect(n).toHaveLength(1);
    expect(n[0]!.labels).toEqual(["Suède"]);
    expect(n[0]!.color).toBe(mainColor(sp).toUpperCase());
    expect(n[0]!.text).toMatch(/^Suède\u00a0: 65,4\u00a0%.* ; le plus élevé$/);
  });

  it("texte calculé d'un élément sans couleur propre (placeholder du panneau)", () => {
    expect(elementAutoText(specOf(), ds, "e:Finlande")).toMatch(/^Finlande\u00a0: /);
    expect(elementAutoText(specOf(), ds, "e:Inconnu")).toBe("");
  });

  it("mode norme, exploration : pas de puce par élément", () => {
    const sp = withO({ "e:Finlande": { color: "#FF0000" } });
    expect(elementNotes({ ...sp, norme: { ...sp.norme, enabled: true } }, ds)).toEqual([]);
    expect(elementNotes({ ...sp, type: "drill" }, ds)).toEqual([]);
  });

  it("empreinte : un spec sans commentaire ni surcharge garde la même empreinte", async () => {
    const sp = specOf();
    const fp = fingerprintSpec(JSON.parse(JSON.stringify(sp))) as { style: Record<string, unknown> };
    expect("overrides" in fp.style).toBe(false);
    const snap = { id: "x", title: "T", subtitle: "S", comments: ["a"], source: "", spec: sp };
    expect(await snapshotFingerprint(snap)).toBe(await snapshotFingerprint({ ...snap, elements: [] }));
    expect(await snapshotFingerprint(snap)).not.toBe(await snapshotFingerprint({ ...snap, elements: ["Finlande : 1 %"] }));
  });
});

describe("puces colorées : rendu SVG et PowerPoint", () => {
  let render: typeof import("../src/charts/render");
  beforeAll(async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window });
    render = await import("../src/charts/render");
  });
  const draw = (sp: ChartSpec, opts: Record<string, unknown> = {}) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    render.renderChart(svg, sp, ds, render.prepareCache(sp, ds, null, 1), { build: 1, timePos: null }, { now: new Date(2026, 9, 8), ...opts });
    return svg;
  };
  const twoBars = () => {
    const sp = withO({ "e:Finlande": { color: "#FF0000" }, "e:Danemark": { color: "#0070C0", comment: "Danemark : éolien en mer" } });
    return { ...sp, story: { ...sp.story, comments: ["La Suède en tête.", "Dix pays au-dessus de 30 %."] } };
  };

  it("puces générales à la couleur principale, puis une puce par élément à sa couleur", () => {
    const sp = twoBars();
    const svg = draw(sp);
    const gs = [...svg.querySelectorAll(".r4d-comment")];
    expect(gs).toHaveLength(4);
    const main = mainColor(sp);
    expect(gs.slice(0, 2).map((g) => g.querySelector("rect")!.getAttribute("fill"))).toEqual([main, main]);
    const el = gs.slice(2);
    expect(el.every((g) => g.classList.contains("r4d-comment-elem"))).toBe(true);
    expect(el.map((g) => g.querySelector("rect")!.getAttribute("fill")).sort()).toEqual(["#0070C0", "#FF0000"]);
    const dk = el.find((g) => g.getAttribute("data-color") === "#0070C0")!;
    expect(dk.textContent).toContain("éolien en mer");
    expect(el.map((g) => g.getAttribute("data-r4d-edit"))).toEqual(["elem:0", "elem:1"]);
    expect(svg.outerHTML).not.toMatch(/certifi|authenticit/i);
  });

  it("film / mode lecture : les puces par élément arrivent après les puces générales, sans saut de mise en page", () => {
    const sp = twoBars();
    const partial = draw({ ...sp, story: { ...sp.story, comments: sp.story.comments.slice(0, 1) } }, { commentsAll: sp.story.comments });
    expect(partial.querySelectorAll(".r4d-comment")).toHaveLength(1);
    const full = draw(sp, { commentsAll: sp.story.comments });
    expect(full.querySelectorAll(".r4d-comment-elem")).toHaveLength(2);
    const plotX = (svg: SVGSVGElement) => svg.querySelector(".r4d-comments line")?.getAttribute("x1");
    expect(plotX(partial)).toBe(plotX(full));
  });

  it("« Afficher sur le graphique » décoché, image de diapositive (bare) : aucune puce dessinée", () => {
    const sp = twoBars();
    expect(draw({ ...sp, story: { ...sp.story, showComments: false } }).querySelectorAll(".r4d-comment")).toHaveLength(0);
    expect(draw(sp, { bare: true }).querySelectorAll(".r4d-comment")).toHaveLength(0);
  });

  it("PowerPoint : pastilles colorées (couleur principale, couleurs des éléments) devant les puces", async () => {
    const { buildPptx } = await import("../src/story/pptx");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const sp = twoBars();
    const snap = { id: "s1", name: "s1", createdAt: "2026-10-08T11:00:00.000Z", spec: sp, svg: null, thumb: null, width: 1200, height: 675, title: "T", subtitle: "", comments: sp.story.comments, source: "", kind: null, role: "context" as const, sampleId: null, dataName: "Démo", generatedAt: "2026-10-08T11:00:00.000Z" };
    const elements = elementNotes(sp, ds).map((n) => ({ text: n.text, color: n.color }));
    const buf = (await buildPptx({ title: "Revue", snapshots: [snap] }, { images: new Map([["s1", { data: png, width: 1200, height: 675 }]]), outputType: "nodebuffer", now: new Date(2026, 9, 8), bullets: new Map([["s1", { main: "#3FA7C4", elements }]]) })) as Uint8Array;
    const xml = await (await JSZip.loadAsync(buf)).file("ppt/slides/slide3.xml")!.async("string");
    for (const c of ["3FA7C4", "FF0000", "0070C0"]) expect(xml).toMatch(new RegExp(`<a:srgbClr val="${c}"/>[\\s\\S]{0,200}<a:t>\u25A0`));
    expect(xml).toContain("éolien en mer");
    expect(xml).toContain("La Suède en tête.");
  });
});
