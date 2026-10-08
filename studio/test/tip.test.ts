/**
 * Infobulles des graphiques : données (data-tip), tons des écarts, nettoyage des exports, présence sur les marques.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { parseSpec } from "../src/spec";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { parseTip, rows, shareRow, stripTips, tip, tipText, toneOf, toneGood, TIP_ATTR } from "../src/charts/tip";

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
let render: typeof import("../src/charts/render");

beforeAll(async () => {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { document, window });
  render = await import("../src/charts/render");
});

function draw(sampleId: string, over: Record<string, unknown> = {}) {
  const s = sampleById(sampleId)!;
  const r = parseSpec({ ...(s.spec ?? {}), ...over });
  if (!r.ok) throw new Error(r.issues.join("; "));
  const ds = buildDataset(s.name, s.rows());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = render.prepareCache(r.spec, ds, null, 1);
  render.renderChart(svg, r.spec, ds, cache, { build: 1, timePos: null }, { now: new Date(2026, 9, 8, 9) });
  return svg;
}
const tipsOf = (svg: Element, sel: string) => [...svg.querySelectorAll(sel)].map((e) => parseTip(e.getAttribute(TIP_ATTR)));

describe("données d'infobulle", () => {
  it("aller-retour JSON compact ; lecture tolérante", () => {
    const attrs: Record<string, string | null> = {};
    tip({ attr: (k: string, v: string | null) => (attrs[k] = v) }, { t: "T2 2026", v: "5,2 M€", rows: rows(null, { k: "Part", v: "23 %" }, false), h: "Cliquer pour zoomer" });
    const d = parseTip(attrs[TIP_ATTR]);
    expect(d).toEqual({ t: "T2 2026", sub: undefined, v: "5,2 M€", rows: [{ k: "Part", v: "23 %" }], h: "Cliquer pour zoomer" });
    expect(tipText(d!)).toBe("T2 2026 ; 5,2 M€ ; Part : 23 % ; Cliquer pour zoomer");
    expect(parseTip("{pas du json")).toBeNull();
    expect(parseTip('{"v":"1"}')).toBeNull();
    expect(parseTip(null)).toBeNull();
  });
  it("tons : stable sous ±3 %, coûts inversés (une hausse est défavorable)", () => {
    expect(toneOf(0.02)).toBe("neutral");
    expect(toneOf(-0.029)).toBe("neutral");
    expect(toneOf(0.05)).toBe("pos");
    expect(toneOf(-0.22)).toBe("neg");
    expect(toneOf(0.05, { costs: true })).toBe("neg");
    expect(toneOf(NaN)).toBe("neutral");
    expect(toneGood(true)).toBe("pos");
    expect(toneGood(null)).toBe("neutral");
  });
  it("part du total (rien si total nul ou valeur négative)", () => {
    expect(norm(shareRow(35, 100)!.v)).toBe("35 %");
    expect(norm(shareRow(4.2, 100)!.v)).toBe("4,2 %");
    expect(shareRow(5, 0)).toBeNull();
    expect(shareRow(-5, 100)).toBeNull();
  });
  it("export : attributs d'infobulle et d'accessibilité retirés", () => {
    const { document: doc } = parseHTML('<svg><g data-tip=\'{"t":"a"}\' data-tip-a11y="1" tabindex="0" role="img" aria-label="a" class="r4d-tip-on"><rect data-tip=\'{"t":"b"}\'/></g><a role="link"/></svg>');
    const svg = doc.querySelector("svg")!;
    stripTips(svg);
    expect(svg.outerHTML).not.toMatch(/data-tip|tabindex|aria-label|role="img"|r4d-tip-on/);
    expect(svg.outerHTML).toMatch(/role="link"/);
  });
});

describe("infobulles sur les marques", () => {
  it("barres : chaque barre porte catégorie, valeur et part ; pas d'infobulle native <title> en double", () => {
    const svg = draw("ventes");
    const bars = tipsOf(svg, ".r4d-marks rect[data-tip]");
    expect(bars.length).toBe(5);
    expect(bars[0]!.t).toBe("Île-de-France");
    expect(norm(bars[0]!.v!)).toBe("7,6 M€");
    expect(bars[0]!.rows?.[0]?.k).toBe("Part du total");
    expect(svg.querySelectorAll(".r4d-marks title").length).toBe(0);
  });
  it("anneau, lignes, nuage : segments et points", () => {
    expect(tipsOf(draw("ventes", { type: "donut" }), ".r4d-marks path[data-tip]").length).toBe(5);
    expect(tipsOf(draw("ventes", { type: "line" }), ".r4d-marks circle[data-tip]").length).toBeGreaterThan(0);
    for (const type of ["bar", "barH", "groupedBar", "stackedBar", "line", "area", "stackedArea", "pie", "donut", "radialBar", "variance"]) {
      const n = draw("business-review", { type }).querySelectorAll("[data-tip]").length;
      expect(n, type).toBeGreaterThan(0);
    }
    const st = tipsOf(draw("business-review", { type: "stackedArea" }), ".r4d-hits rect[data-tip]");
    expect(st.length).toBeGreaterThan(0);
    expect(st[0]!.sub).toBe("Total (toutes séries)");
  });
  it("exploration (démo pipeline) : périodes avec nombre, écart et « Cliquer pour zoomer »", () => {
    const svg = draw("demo-pipeline");
    const t = tipsOf(svg, ".r4d-drill-bar[data-tip]");
    expect(t.length).toBe(7);
    const f = parseTip(svg.querySelector('.r4d-drill-bar[data-focus="1"]')!.getAttribute(TIP_ATTR))!;
    expect(f.t).toBe("T2 2026");
    expect(f.h).toBe("Cliquer pour zoomer");
    expect(f.rows!.some((r) => /opportunités/.test(r.v))).toBe(true);
    const v = f.rows!.find((r) => r.k === "vs T1 2026")!;
    expect(norm(v.v)).toMatch(/· −3,8 %$/);
    expect(v.tone).toBe("neg");
  });
  it("cascade (démo finance) : marches avec versions, part de l'écart et indication « détailler par »", () => {
    const svg = draw("demo-finance");
    const cloud = parseTip(svg.querySelector('.r4d-drill-bridge-item[data-key="Cloud"]')!.getAttribute(TIP_ATTR))!;
    expect(norm(cloud.v!)).toBe("+2,1 M€");
    expect(cloud.rows!.map((r) => r.k)).toEqual(expect.arrayContaining(["Réel 2025", "Budget 2026", "Poids dans les écarts"]));
    expect(cloud.h).toMatch(/^Cliquer pour détailler par /);
    const n = svg.querySelectorAll(".r4d-drill-bridge-item[data-tip]").length;
    expect(n).toBe(svg.querySelectorAll(".r4d-drill-bridge-item").length);
  });
  it("mode norme : barres AC avec écarts vs PL / PY colorés", () => {
    const svg = draw("revue-mensuelle-norme");
    const ac = tipsOf(svg, '.r4d-scn-AC[data-tip]');
    expect(ac.length).toBeGreaterThan(0);
    expect(ac.some((d) => d!.rows?.some((r) => /^vs /.test(r.k) && (r.tone === "pos" || r.tone === "neg")))).toBe(true);
  });
});
