/**
 * Mode norme (notation inspirée d'IBCS® / de la notation ISO 24896) : détection des scénarios,
 * signe et couleur des écarts (inversion « Hausse = défavorable »), orientation, sous-titre,
 * échelles communes, et rendu SVG (motif hachuré, contours, rouge / vert réservés aux écarts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { parseSpec, type ChartSpec } from "../src/spec";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { VARIANCE_NEG, VARIANCE_POS } from "../src/theme";
import {
  DISCOURAGED_TIP,
  detectScenario,
  isDiscouraged,
  isGood,
  normeAdvice,
  normeDeltaFormatter,
  normeFormatter,
  normeSubtitle,
  scaleGroups,
  scaleKey,
  scenarioOf,
  scenarioPhrase,
  scenarioStyle,
  specScenarios,
  varianceColor,
  varianceOf,
} from "../src/norme";

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const spec = (input: unknown): ChartSpec => {
  const r = parseSpec(input);
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.spec;
};
const br = sampleById("business-review")!;
const brDs = buildDataset(br.name, br.rows());

describe("détection des scénarios", () => {
  it.each([
    ["Réel (€)", "AC"],
    ["Reel 2026", "AC"],
    ["Actual", "AC"],
    ["AC", "AC"],
    ["Réalisé", "AC"],
    ["Budget (€)", "PL"],
    ["Plan", "PL"],
    ["PL", "PL"],
    ["Objectif", "PL"],
    ["N-1 (€)", "PY"],
    ["N - 1", "PY"],
    ["PY", "PY"],
    ["Année précédente", "PY"],
    ["Prior year", "PY"],
    ["Prévision (€)", "FC"],
    ["Forecast", "FC"],
    ["FC", "FC"],
    ["Landing Q4", "FC"],
    ["Atterrissage", "FC"],
  ])("« %s » → %s", (name, code) => {
    expect(detectScenario(name)).toBe(code);
  });
  it("priorité : « Réel N-1 » est du N-1, « Prévision budget » une prévision", () => {
    expect(detectScenario("Réel N-1")).toBe("PY");
    expect(detectScenario("Prévision budget")).toBe("FC");
  });
  it("aucun scénario pour une mesure simple", () => {
    for (const n of ["Chiffre d'affaires (€)", "Marge", "Région", "Placement", "Actualités", "", null]) expect(detectScenario(n as string)).toBeNull();
  });
  it("choix manuel prioritaire (encodages), « aucun » désactive", () => {
    expect(scenarioOf("Montant", { Montant: "FC" })).toBe("FC");
    expect(scenarioOf("Réel (€)", { "Réel (€)": "none" })).toBeNull();
    expect(scenarioOf("Réel (€)", {})).toBe("AC");
  });
  it("styles : Réel plein foncé, N-1 gris, Budget contour, Prévision hachurée", () => {
    const dark = { dark: true };
    const light = { dark: false };
    expect(scenarioStyle("AC", light).fill).toBe("#2b2b2e");
    expect(scenarioStyle("AC", dark).fill).toBe("#e4e4e7");
    expect(scenarioStyle("PY", light).fill).toBe("#b8b8bd");
    expect(scenarioStyle("PL", light)).toMatchObject({ fill: "none", stroke: "#2b2b2e", hatch: false });
    expect(scenarioStyle("FC", light, "url(#h)")).toMatchObject({ fill: "url(#h)", hatch: true });
  });
  it("phrase des scénarios et scénarios d'un spec", () => {
    expect(scenarioPhrase(["AC", "PL"])).toBe("Réel vs Budget");
    expect(scenarioPhrase(["AC", "FC", "PL", "PY"])).toBe("Réel + Prévision vs Budget, N-1");
    expect(specScenarios(spec({ type: "bar", encoding: { x: "Mois", y: ["Réel (€)", "Prévision (€)", "Budget (€)", "N-1 (€)"] } }), brDs)).toEqual(["AC", "FC", "PL", "PY"]);
  });
});

describe("écarts : signe, couleur, inversion « Hausse = défavorable »", () => {
  it("écart absolu et relatif", () => {
    expect(varianceOf(110, 100)).toEqual({ delta: 10, rel: 0.1 });
    expect(varianceOf(90, 100).delta).toBe(-10);
    expect(varianceOf(90, 100).rel).toBeCloseTo(-0.1);
    expect(Number.isNaN(varianceOf(5, 0).rel)).toBe(true);
  });
  it("vert si favorable, rouge si défavorable", () => {
    expect(isGood(10, false)).toBe(true);
    expect(isGood(-10, false)).toBe(false);
    expect(varianceColor(10, "higher")).toBe(VARIANCE_POS);
    expect(varianceColor(-10, "higher")).toBe(VARIANCE_NEG);
  });
  it("inversion : une hausse de coûts est défavorable", () => {
    expect(isGood(10, true)).toBe(false);
    expect(isGood(-10, true)).toBe(true);
    expect(varianceColor(10, "lower")).toBe(VARIANCE_NEG);
    expect(varianceColor(-10, "lower")).toBe(VARIANCE_POS);
  });
  it("formats unifiés : sans unité (dans le sous-titre), signe moins typographique", () => {
    const axis = { unit: "keur" as const, unitCustom: "", decimals: 0 };
    expect(norm(normeFormatter(axis)(1234567))).toBe("1 235");
    expect(norm(normeDeltaFormatter(axis)(-12000))).toBe("\u221212");
    expect(norm(normeDeltaFormatter(axis)(12000))).toBe("+12");
  });
});

describe("types, orientation, sous-titre, échelles", () => {
  it("camembert, donut, arcs déconseillés ; le film reste permis", () => {
    expect(isDiscouraged("pie")).toBe(true);
    expect(isDiscouraged("donut")).toBe(true);
    expect(isDiscouraged("radialBar")).toBe(true);
    expect(isDiscouraged("film")).toBe(false);
    expect(DISCOURAGED_TIP).toBe("déconseillé par la notation IBCS — utilisez des barres");
  });
  it("bascules : camembert → barres horizontales, catégories → barres, temps → colonnes", () => {
    const pie = normeAdvice(spec({ type: "pie", encoding: { x: "Région", y: ["Réel (€)"] }, norme: { enabled: true } }), brDs);
    expect(pie?.patch.type).toBe("barH");
    expect(pie?.notice).toContain(DISCOURAGED_TIP);
    expect(normeAdvice(spec({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, norme: { enabled: true } }), brDs)?.patch.type).toBe("barH");
    expect(normeAdvice(spec({ type: "barH", encoding: { x: "Mois", y: ["Réel (€)"] }, norme: { enabled: true } }), brDs)?.patch.type).toBe("bar");
    expect(normeAdvice(spec({ type: "bar", encoding: { x: "Mois", y: ["Réel (€)"] }, norme: { enabled: true } }), brDs)).toBeNull();
    const soft = normeAdvice(spec({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, norme: { enabled: true, autoSwitch: false } }), brDs);
    expect(soft?.soft).toBe(true);
    expect(soft?.patch).toEqual({});
    expect(normeAdvice(spec({ type: "pie", encoding: { x: "Région", y: ["Réel (€)"] } }), brDs)).toBeNull();
  });
  it("sous-titre qui · quoi en unité · quand + scénarios", () => {
    const s = spec({ type: "variance", encoding: { x: "Région", y: ["Réel (€)", "Budget (€)"] }, axes: { y: { unit: "keur" } }, norme: { enabled: true, entity: "Alteridea SA", measure: "Chiffre d’affaires" } });
    expect(normeSubtitle(s, { period: "2026", scenarios: ["AC", "PL"] })).toBe("Alteridea SA · Chiffre d’affaires en k€ · 2026 Réel vs Budget");
    const t = spec({ type: "bar", encoding: { x: "Mois", y: ["Réel (€)"] }, axes: { y: { unit: "keur" } }, norme: { enabled: true } });
    expect(normeSubtitle(t, { entity: "Données", period: "2026", scenarios: ["AC"] })).toBe("Données · Montant en k€ · 2026 Réel");
  });
  it("échelles : même mesure → groupe ; maxima différents signalés", () => {
    const a = spec({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, axes: { y: { unit: "keur" } } });
    const b = spec({ type: "variance", encoding: { x: "Mois", y: ["Réel (€)", "Budget (€)"] }, axes: { y: { unit: "keur" } } });
    const c = spec({ type: "pie", encoding: { x: "Région", y: ["Réel (€)"] } });
    expect(scaleKey(a)).toBe(scaleKey(b));
    expect(scaleKey(c)).toBeNull();
    const g = scaleGroups([
      { id: "a", key: scaleKey(a), max: 1000 },
      { id: "b", key: scaleKey(b), max: 400 },
      { id: "c", key: null, max: 50 },
    ]);
    expect(g.get("a")).toMatchObject({ size: 2, max: 1000, own: 1000, differs: true });
    expect(g.get("b")?.own).toBe(400);
    expect(g.has("c")).toBe(false);
    expect(scaleGroups([{ id: "x", key: "k", max: 100 }, { id: "y", key: "k", max: 99.5 }]).get("x")?.differs).toBe(false);
  });
});

describe("rendu SVG en mode norme", () => {
  let render: typeof import("../src/charts/render");
  beforeAll(async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window });
    render = await import("../src/charts/render");
  });

  function draw(input: unknown, sampleId = "business-review", opts = {}) {
    const s = spec(input);
    const sm = sampleById(sampleId)!;
    const ds = buildDataset(sm.name, sm.rows());
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const cache = render.prepareCache(s, ds, null, 1);
    render.renderChart(svg, s, ds, cache, { build: 1, timePos: null }, { now: new Date(2026, 9, 8, 9), ...opts });
    return svg;
  }
  const RED_GREEN = new Set([VARIANCE_NEG.toLowerCase(), VARIANCE_POS.toLowerCase()]);
  const VARIANCE_SEL = ".r4d-variance-bar, .r4d-variance-needle, .r4d-variance-value, .r4d-hatch-var";
  function redGreenOutsideVariance(svg: SVGSVGElement): string[] {
    const bad: string[] = [];
    for (const el of svg.querySelectorAll("*")) {
      const paints = [el.getAttribute("fill"), el.getAttribute("stroke")].map((v) => (v ?? "").toLowerCase());
      if (!paints.some((p) => RED_GREEN.has(p))) continue;
      if (!el.closest(VARIANCE_SEL)) bad.push(`${el.tagName}.${el.getAttribute("class") ?? ""}`);
    }
    return bad;
  }

  const preset = sampleById("revue-mensuelle-norme")!;

  it("préréglage « Revue mensuelle (norme) » : motif hachuré, contours, écarts, signature", () => {
    const svg = draw(preset.spec, preset.id);
    const pattern = svg.querySelector("pattern.r4d-hatch");
    expect(pattern).toBeTruthy();
    const id = pattern!.getAttribute("id")!;
    const fc = [...svg.querySelectorAll('[data-scenario="FC"]')];
    expect(fc.length).toBeGreaterThan(0);
    expect(fc.some((r) => r.getAttribute("fill") === `url(#${id})`)).toBe(true);
    const pl = [...svg.querySelectorAll('[data-scenario="PL"]')];
    expect(pl.length).toBe(12);
    for (const r of pl) expect(r.getAttribute("fill")).toBe("none");
    expect(svg.querySelectorAll('[data-scenario="AC"]').length).toBe(9);
    expect(svg.querySelectorAll('[data-scenario="PY"]').length).toBe(12);
    expect(svg.querySelectorAll(".r4d-variance .r4d-variance-bar").length).toBe(12);
    expect(redGreenOutsideVariance(svg)).toEqual([]);
    expect(svg.querySelector(".r4d-cartouche")).toBeTruthy();
    // unité dans le sous-titre, pas sur chaque étiquette
    for (const t of svg.querySelectorAll(".r4d-value")) expect(norm(t.textContent ?? "")).not.toMatch(/€/);
  });

  it("écarts (business review) : rouge / vert réservés aux écarts, inversion appliquée", () => {
    const base = { ...br.spec, norme: { enabled: true, entity: "Alteridea SA", measure: "Chiffre d’affaires" } };
    const svg = draw(base);
    expect(redGreenOutsideVariance(svg)).toEqual([]);
    const fills = (s: SVGSVGElement) => [...s.querySelectorAll(".r4d-variance-bar")].map((e) => e.getAttribute("fill"));
    const inv = draw({ ...base, variance: { polarity: "lower" } });
    const a = fills(svg);
    const b = fills(inv);
    expect(a.length).toBeGreaterThan(0);
    a.forEach((f, i) => expect(b[i]).toBe(f === VARIANCE_POS ? VARIANCE_NEG : VARIANCE_POS));
    expect(svg.querySelector(".r4d-cartouche")).toBeTruthy();
  });

  it("épingles relatives (aiguille + point) en %", () => {
    const svg = draw({ ...preset.spec, variance: { show: "rel" } }, preset.id);
    expect(svg.querySelectorAll(".r4d-variance-pin").length).toBe(12);
    expect(svg.querySelectorAll(".r4d-variance-needle").length).toBe(12);
    expect(norm(svg.querySelector(".r4d-variance-value")?.textContent ?? "")).toMatch(/%$/);
  });

  it("palette grise pour les données hors scénarios ; échelle commune et indicateur", () => {
    const s = { type: "bar", encoding: { x: "Mois", y: ["Réel (€)"] }, axes: { y: { unit: "keur" } }, norme: { enabled: true } };
    const svg = draw(s, "business-review", { sharedMax: 50_000_000, scaleNote: "Même échelle pour les 2 graphiques" });
    expect(svg.querySelector(".r4d-scale-indicator")?.textContent).toContain("Même échelle");
    expect(redGreenOutsideVariance(svg)).toEqual([]);
    const max = render.valueMaxOf(spec(s), brDs);
    expect(max).toBeGreaterThan(0);
  });
});
