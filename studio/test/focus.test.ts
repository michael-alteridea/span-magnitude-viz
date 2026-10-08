/**
 * Mise en avant généralisée (étape L) : barres, parts, arcs, points, séries, points de courbe et régions.
 * Fonctions pures (choix, transitions, bulle) et rendu SVG sous linkedom.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { parseSpec, type ChartSpec } from "../src/spec";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { focusChoices, focusDelta, focusKindOf, FOCUS_LABELS, mixHex, placeCallout, resolveFocus, sameExceptFocus, overlap, type Rect } from "../src/charts/focus";
import { pptAngle } from "../src/story/morph";
import { autoSceneDuration, T } from "../src/reel/plan";

let render: typeof import("../src/charts/render");
let focusInfo: typeof import("../src/ui/focusUi").focusInfo;
let drillLinks: typeof import("../src/reel/charts").drillLinks;

beforeAll(async () => {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { document, window });
  render = await import("../src/charts/render");
  focusInfo = (await import("../src/ui/focusUi")).focusInfo;
  drillLinks = (await import("../src/reel/charts")).drillLinks;
});

function setup(sampleId: string, over: Record<string, unknown> = {}, focus: Record<string, unknown> | null = null) {
  const s = sampleById(sampleId)!;
  const base = (s.spec ?? {}) as Record<string, unknown>;
  const style = { ...((base.style as object) ?? {}), ...((over.style as object) ?? {}), ...(focus ? { focus: { key: null, title: "", note: "", average: true, ...focus } } : {}) };
  const r = parseSpec({ ...base, ...over, style });
  if (!r.ok) throw new Error(r.issues.join("; "));
  return { spec: r.spec, ds: buildDataset(s.name, s.rows()) };
}

function draw(spec: ChartSpec, ds: ReturnType<typeof buildDataset>, focus?: number) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = render.prepareCache(spec, ds, null, 1);
  render.renderChart(svg, spec, ds, cache, { build: 1, timePos: null, ...(focus !== undefined ? { focus } : {}) }, { now: new Date(2026, 9, 8, 9) });
  return svg;
}

const fills = (svg: Element, sel: string) => [...svg.querySelectorAll(sel)].map((e) => e.getAttribute("fill"));
const FORBIDDEN = /certifi|conforme|authenticit|preuve/i;

describe("mise en avant : choix et résolution", () => {
  it("type de mise en avant selon le graphique", () => {
    const sp = (type: string) => ({ type, norme: { enabled: false } }) as unknown as ChartSpec;
    expect(focusKindOf(sp("bar"))).toBe("bar");
    expect(focusKindOf(sp("bar"), 3)).toBeNull();
    expect(focusKindOf(sp("pie"))).toBe("slice");
    expect(focusKindOf(sp("donut"))).toBe("slice");
    expect(focusKindOf(sp("radialBar"))).toBe("arc");
    expect(focusKindOf(sp("scatter"))).toBe("point");
    expect(focusKindOf(sp("line"))).toBe("linePoint");
    expect(focusKindOf(sp("line"), 4)).toBe("series");
    expect(focusKindOf(sp("area"), 2)).toBe("series");
    expect(focusKindOf(sp("drill"), 1, "map")).toBe("region");
    expect(focusKindOf(sp("drill"), 1, "breakdown")).toBeNull();
    expect(focusKindOf({ type: "bar", norme: { enabled: true } } as unknown as ChartSpec)).toBeNull();
    for (const l of Object.values(FOCUS_LABELS)) expect(`${l.row} ${l.hint} ${l.auto}`).not.toMatch(FORBIDDEN);
  });

  it("« @max » vise la plus grande valeur ; une clé inconnue ne met rien en avant", () => {
    expect(resolveFocus("@max", ["a", "b", "c"], [3, 9, 1])).toBe(1);
    expect(resolveFocus("c", ["a", "b", "c"], [3, 9, 1])).toBe(2);
    expect(resolveFocus("z", ["a", "b"], [1, 2])).toBeNull();
    expect(resolveFocus(null, ["a"], [1])).toBeNull();
    expect(resolveFocus("@max", ["a", "b"], [NaN, 2])).toBe(1);
  });

  it("choix proposés : catégories, séries, points ou régions", () => {
    const model = { kind: "cat", labels: ["Nord", "Sud"], series: ["2025", "2026"] } as never;
    expect(focusChoices("bar", model)).toEqual(["Nord", "Sud"]);
    expect(focusChoices("series", model)).toEqual(["2025", "2026"]);
    expect(focusChoices("region", null, ["BE1", "BE2"])).toEqual(["BE1", "BE2"]);
    expect(focusChoices(null, model)).toEqual([]);
  });

  it("mélange de couleurs vers le gris", () => {
    expect(mixHex("#0E6E8C", "#c4c4c8", 0).toLowerCase()).toBe("#0e6e8c");
    expect(mixHex("#0E6E8C", "#c4c4c8", 1)).toBe("#c4c4c8");
    expect(mixHex("#000000", "#ffffff", 0.5)).toMatch(/^#(7f7f7f|808080)$/);
  });

  it("transition entre snapshots : seule la mise en avant change → « in » / « out »", () => {
    const a = { type: "pie", style: { title: "A", focus: { key: null, title: "", note: "" } }, story: { comments: [] } };
    const b = { type: "pie", style: { title: "B", focus: { key: "Nord", title: "", note: "Pic" } }, story: { comments: ["x"] } };
    expect(focusDelta(a, b)).toBe("in");
    expect(focusDelta(b, a)).toBe("out");
    expect(focusDelta(a, a)).toBeNull();
    expect(focusDelta(a, { ...b, type: "donut" })).toBeNull();
    expect(sameExceptFocus(a, b)).toBe(true);
    expect(sameExceptFocus(a, { ...a, type: "bar" })).toBe(false);
    const c = { ...b, style: { ...b.style, focus: { key: "Sud", title: "", note: "" } } };
    expect(focusDelta(b, c)).toBe("in");
  });

  it("bulle : évite les obstacles et reste dans le cadre", () => {
    const bounds: Rect = { x: 0, y: 0, w: 600, h: 400 };
    const target: Rect = { x: 280, y: 180, w: 40, h: 40 };
    const obstacles: Rect[] = [{ x: 0, y: 0, w: 600, h: 170 }];
    const box = placeCallout({ w: 160, h: 60 }, target, bounds, obstacles, 12);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(600);
    expect(box.y + box.h).toBeLessThanOrEqual(400);
    expect(overlap(box, obstacles[0]!)).toBe(0);
    expect(overlap(box, target)).toBe(0);
  });

  it("PowerPoint : angles d3 (midi) → angles PowerPoint (3 h), dans [0, 360)", () => {
    expect(pptAngle(0)).toBe(270);
    expect(pptAngle(90)).toBe(0);
    expect(pptAngle(180)).toBe(90);
    expect(pptAngle(450)).toBe(0);
  });
});

describe("mise en avant : rendu", () => {
  it("donut : la part se détache, les autres passent en gris, bulle reliée", () => {
    const { spec, ds } = setup("canaux", {}, { key: "@max", note: "Le plus gros budget" });
    const svg = draw(spec, ds);
    const f = svg.querySelector(".r4d-focus-slice")!;
    expect(f).toBeTruthy();
    expect(f.getAttribute("transform")).toMatch(/^translate\(/);
    const others = [...svg.querySelectorAll(".r4d-marks path[data-slice]")].filter((e) => e !== f);
    expect(others.length).toBeGreaterThan(2);
    const plain = draw(setup("canaux").spec, ds);
    const plainFills = fills(plain, ".r4d-marks path[data-slice]");
    expect(fills(svg, ".r4d-marks path[data-slice]").filter((c, i) => c !== plainFills[i]).length).toBe(others.length);
    expect(svg.querySelector(".r4d-callout")).toBeTruthy();
    expect(svg.querySelector(".r4d-callout-link")).toBeTruthy();
    expect(svg.querySelector(".r4d-callout")!.textContent).toContain("Le plus gros budget");
  });

  it("valeurs par défaut inchangées : sans mise en avant, focus = 0 donne le rendu d'origine", () => {
    const { spec, ds } = setup("canaux", {}, { key: "@max" });
    const plain = draw(setup("canaux").spec, ds);
    const zero = draw(spec, ds, 0);
    expect(fills(zero, ".r4d-marks path[data-slice]")).toEqual(fills(plain, ".r4d-marks path[data-slice]"));
    expect(zero.querySelector(".r4d-callout")).toBeNull();
    expect(plain.querySelector(".r4d-focus-slice, .r4d-callout")).toBeNull();
  });

  it("camembert et arcs radiaux", () => {
    for (const type of ["pie", "radialBar"]) {
      const { spec, ds } = setup("canaux", { type }, { key: "@max" });
      const svg = draw(spec, ds);
      expect(svg.querySelector(type === "pie" ? ".r4d-focus-slice" : ".r4d-focus-arc"), type).toBeTruthy();
      expect(svg.querySelector(".r4d-callout"), type).toBeTruthy();
      expect(svg.querySelectorAll("[data-focus-key]").length, type).toBeGreaterThan(3);
    }
  });

  it("nuage de points : halo, autres points estompés, étiquette et bulle", () => {
    const { spec, ds } = setup("canaux", { type: "scatter", encoding: { x: "Leads", y: ["Clients signés"], label: "Canal", series: null, aggregate: "sum" } }, { key: "@max" });
    const svg = draw(spec, ds);
    expect(svg.querySelector(".r4d-focus-halo")).toBeTruthy();
    expect(svg.querySelector(".r4d-focus-point")).toBeTruthy();
    expect(svg.querySelector(".r4d-callout")).toBeTruthy();
    const keys = focusInfo(spec, ds);
    expect(keys.kind).toBe("point");
    expect(keys.choices.length).toBeGreaterThan(3);
  });

  it("courbes : une série mise en avant (plusieurs séries), un point sinon", () => {
    const multi = setup("ventes", { type: "line", encoding: { x: "Mois", y: ["Chiffre d'affaires (€)"], series: "Région", time: null, aggregate: "sum" } }, { key: "@max" });
    const fi = focusInfo(multi.spec, multi.ds);
    expect(fi.kind).toBe("series");
    const svg = draw({ ...multi.spec, style: { ...multi.spec.style, focus: { ...multi.spec.style.focus, key: fi.choices[0]! } } }, multi.ds);
    expect(svg.querySelector(".r4d-focus-series")).toBeTruthy();
    expect(svg.querySelector(".r4d-callout")).toBeTruthy();
    const one = setup("ventes", { type: "area", encoding: { x: "Mois", y: ["Chiffre d'affaires (€)"], series: null, time: null, aggregate: "sum" } }, { key: "@max" });
    expect(focusInfo(one.spec, one.ds).kind).toBe("linePoint");
    const s2 = draw(one.spec, one.ds);
    expect(s2.querySelector(".r4d-focus-halo")).toBeTruthy();
    expect(s2.querySelector(".r4d-callout")).toBeTruthy();
  });

  it("barres : même interface (choix proposés depuis le graphique)", () => {
    const { spec, ds } = setup("ventes", { type: "bar", encoding: { x: "Région", y: ["Chiffre d'affaires (€)"], series: null, time: null, aggregate: "sum" } }, { key: "@max" });
    const fi = focusInfo(spec, ds);
    expect(fi.kind).toBe("bar");
    expect(fi.choices.length).toBeGreaterThan(2);
    const svg = draw(spec, ds);
    expect(svg.querySelectorAll("[data-focus-key]").length).toBe(fi.choices.length);
    expect(svg.querySelector(".r4d-callout")).toBeTruthy();
  });
});

describe("Reel : liaison « focus » et rythme resserré", () => {
  it("scène dupliquée et mise en avant : liée à la précédente (pas de fondu du graphique)", () => {
    const base = { type: "pie", style: { title: "A", focus: { key: null } }, story: { comments: [] } };
    const hi = { ...base, style: { title: "A", focus: { key: "Nord" } } };
    const snap = (id: string, spec: unknown) => ({ id, spec }) as never;
    const links = drillLinks([snap("a", base), snap("b", hi), snap("c", { ...base, type: "bar" })]);
    expect(links.map((l) => `${l.linkIn ?? "-"}/${l.linkOut ?? "-"}`)).toEqual(["-/focus", "focus/-", "-/-"]);
  });

  it("rythme : comptage rapide, entrées courtes, scènes de 2,8 à 5,2 s", () => {
    expect(T.numberTo - T.numberFrom).toBeLessThanOrEqual(1);
    expect(T.chartTo - T.chartFrom).toBeLessThanOrEqual(1.2);
    expect(T.fadeOut).toBeLessThanOrEqual(0.25);
    expect(autoSceneDuration({ title: "Court", caption: "", number: null, marks: 3 } as never)).toBeGreaterThanOrEqual(2.8);
    expect(autoSceneDuration({ title: "Un titre très long ".repeat(8), caption: "x ".repeat(80), number: "12 %", marks: 40 } as never)).toBeLessThanOrEqual(5.2);
  });
});
