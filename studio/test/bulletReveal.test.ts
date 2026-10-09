import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { chartSpecSchema, type ChartSpec, type ChartSpecInput } from "../src/spec";
import { buildDataset } from "../src/data/table";
import { SAMPLES } from "../src/data/samples";
import { elementNotes } from "../src/story/elementNotes";
import { BULLET_MIN_STEP_MS, BULLET_STEP_MS, bulletStep, bulletTimes, bulletsDuration, bulletsShownAt } from "../src/story/bulletReveal";

const sample = SAMPLES.find((s) => s.id === "renouvelables")!;
const ds = buildDataset(sample.name, sample.rows());
const COLORS = ["#FF0000", "#0070C0", "#00B050", "#FFC000", "#7030A0", "#00B0F0", "#92D050"];
const PAYS = ["Finlande", "Danemark", "Lettonie", "Autriche", "Estonie", "Lituanie", "Portugal"];
const GENERAL = ["Suède en tête.", "Moyenne par pays : 29 %.", "Belgique sous la moyenne."];

/** Graphique à `g` puces générales et `e` puces colorées (couleurs distinctes : pas de regroupement). */
function specWith(g: number, e: number): ChartSpec {
  const raw = JSON.parse(JSON.stringify(sample.spec)) as ChartSpecInput;
  const overrides = Object.fromEntries(PAYS.slice(0, e).map((p, i) => [`e:${p}`, { color: COLORS[i]! }]));
  raw.style = { ...raw.style, overrides };
  raw.story = { comments: GENERAL.slice(0, g), showComments: true };
  return chartSpecSchema.parse(raw);
}

describe("apparition des puces : une à une, quel que soit leur nombre", () => {
  it("écart normal jusqu'à 4 puces, resserré au-delà, jamais sous le minimum", () => {
    expect(bulletStep(3)).toBe(BULLET_STEP_MS);
    expect(bulletStep(4)).toBe(BULLET_STEP_MS);
    expect(bulletStep(5)).toBeLessThan(BULLET_STEP_MS);
    expect(bulletStep(10)).toBeGreaterThanOrEqual(BULLET_MIN_STEP_MS);
    expect(bulletStep(40)).toBe(BULLET_MIN_STEP_MS);
    expect(bulletsDuration(10)).toBeLessThanOrEqual(4600);
  });
  for (const n of [1, 2, 3, 4, 5, 10, 25]) {
    it(`${n} puces : instants strictement croissants, une puce de plus à chaque instant`, () => {
      const ts = bulletTimes(n, 910);
      for (let i = 1; i < n; i++) expect(ts[i]!).toBeGreaterThan(ts[i - 1]!);
      ts.forEach((t, i) => {
        expect(bulletsShownAt(t - 1, n, 910)).toBe(i);
        expect(bulletsShownAt(t, n, 910)).toBe(i + 1);
      });
      expect(bulletsShownAt(1e9, n, 910)).toBe(n);
    });
  }
});

describe("film / mode lecture : rendu des puces générales puis colorées, une à une", () => {
  let render: typeof import("../src/charts/render");
  beforeAll(async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window });
    render = await import("../src/charts/render");
  });
  const drawn = (sp: ChartSpec, shown: number) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    render.renderChart(svg, sp, ds, render.prepareCache(sp, ds, null, 1), { build: 1, timePos: null }, { now: new Date(2026, 9, 8), commentsAll: sp.story.comments, bulletsShown: shown });
    return [...svg.querySelectorAll(".r4d-comment")].map((g) => `${g.getAttribute("data-r4d-edit")}|${g.getAttribute("data-color")}`);
  };

  for (const [g, e] of [[2, 2], [3, 2], [3, 7]] as const) {
    const n = g + e;
    it(`${n} puces (${g} générales + ${e} colorées) : chaque puce a son propre instant d'apparition, dans l'ordre`, () => {
      const sp = specWith(g, e);
      expect(elementNotes(sp, ds)).toHaveLength(e);
      // instants d'apparition simulés comme dans le film (pas de 10 ms)
      const start = 910;
      const appear: number[] = [];
      let prev: string[] = [];
      const final = drawn(sp, n);
      expect(final).toHaveLength(n);
      expect(final.slice(0, g).every((x) => x.startsWith("comment:"))).toBe(true);
      expect(final.slice(g).every((x) => x.startsWith("elem:"))).toBe(true);
      for (let t = 0; t <= start + bulletsDuration(n) + 100; t += 10) {
        const k = bulletsShownAt(t, n, start);
        if (k > prev.length) {
          expect(k).toBe(prev.length + 1); // jamais deux puces au même instant
          const now = drawn(sp, k);
          expect(now.slice(0, prev.length)).toEqual(prev); // les puces déjà là ne bougent pas
          expect(now).toEqual(final.slice(0, k));
          appear.push(t);
          prev = now;
        }
      }
      expect(appear).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(appear[i]!).toBeGreaterThan(appear[i - 1]!);
    });
  }

  it("10 puces : la colonne « À retenir » tient au-dessus du cartouche (texte réduit)", () => {
    const sp = specWith(3, 7);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    render.renderChart(svg, sp, ds, render.prepareCache(sp, ds, null, 1), { build: 1, timePos: null }, { now: new Date(2026, 9, 8) });
    const ys = [...svg.querySelectorAll(".r4d-comment text")].map((t) => Number(t.getAttribute("y")));
    const cart = svg.querySelector(".r4d-cartouche rect, .r4d-cartouche");
    expect(ys.length).toBeGreaterThanOrEqual(10);
    const top = Number(svg.querySelector(".r4d-cartouche")?.querySelector("rect")?.getAttribute("y") ?? 1e9);
    expect(cart).toBeTruthy();
    expect(Math.max(...ys)).toBeLessThan(top);
  });
});
