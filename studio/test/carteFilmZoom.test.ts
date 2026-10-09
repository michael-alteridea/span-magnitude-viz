/**
 * Carte dans le film / mode lecture et zoom de la carte.
 *
 * - Film : une scène « carte » (type spécial) était un cadre vide — `renderChart` ne dessine que le cadre des
 *   types spéciaux, la bibliothèque n'était montée que dans l'aperçu. Le film recopie désormais la carte de la
 *   bibliothèque dans la zone du graphique : cas utilisateur Burundi (« Prov. » + « N° », 10 provinces, sans
 *   date ou avec le contournement Début = N°), et non-régression Monde / Europe / FR·BE / carte datée.
 * - Zoom (vue seulement) : boutons +, −, cadre entier ; transformation, barre d'échelle juste, identité au retour.
 * Valeurs de « N° » FICTIVES (inventées pour le test ; total 59 000, moyenne 5 900).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { buildDataset, type Dataset } from "../src/data/table";
import { parseSpec, type ChartSpec } from "../src/spec";
import type { Snapshot } from "../src/story/snapshots";
import { fingerprintSpec } from "../src/publish/manifest";

const PROVS = ["Gitega", "Buja rural", "Bururi", "Karusi", "Bubanza", "Kirundo", "Ngozi", "Buja", "Makamba", "Rumonge"];
const VALS = [7200, 6100, 5300, 4800, 6600, 5000, 6900, 5500, 6400, 5200];
const ds = buildDataset("Feuil1", PROVS.map((p, i) => ({ "Prov.": p, "N°": VALS[i] })));

function spec(raw: Record<string, unknown>): ChartSpec {
  const r = parseSpec(raw);
  if (!r.ok) throw new Error(r.issues.join(" ; "));
  return r.spec;
}
const burundi = (x: string | null, kind: "static" | "dynamic" = "static") =>
  spec({ type: "map", encoding: { x, y: ["N°"], series: "Prov." }, special: { mapRegion: "burundi" }, mode: { kind } });

function snap(sp: ChartSpec, id = "s1"): Snapshot {
  return { id, name: "Carte", createdAt: "2026-10-09T15:57:00.000Z", spec: sp, svg: null, thumb: null, width: 1200, height: 675, title: "N° : 59 k au total", subtitle: "", comments: ["10 lignes ; moyenne 5 900."], source: "", kind: null, role: "context", sampleId: null, dataName: "Feuil1", generatedAt: "2026-10-09T15:57:00.000Z" };
}

let StoryFilm: typeof import("../src/ui/storyFilm").StoryFilm;
let loadSpecialModule: typeof import("../src/charts/specialFrame").loadSpecialModule;
let mountSpecial: typeof import("../src/charts/special").mountSpecial;
let MapZoomBar: typeof import("../src/ui/mapZoomBar").MapZoomBar;
let themeFor: typeof import("../src/theme").themeFor;

beforeAll(async () => {
  const { document, window, Node, HTMLElement, SVGElement, Element, Event, MouseEvent } = parseHTML("<!doctype html><html><body></body></html>");
  // linkedom : pas de moteur de styles ni de mise en page — styles calculés vides, boîtes nulles
  const getComputedStyle = () => ({ getPropertyValue: () => "" });
  Object.assign(window, { getComputedStyle, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, innerWidth: 1600, innerHeight: 960 });
  class MutationObserver { observe() {} disconnect() {} }
  if (typeof globalThis.navigator === "undefined") Object.assign(globalThis, { navigator: { maxTouchPoints: 0 } });
  Object.assign(globalThis, { MutationObserver, document, window, Node, HTMLElement, SVGElement, Element, Event, MouseEvent, getComputedStyle, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  ({ StoryFilm } = await import("../src/ui/storyFilm"));
  ({ loadSpecialModule } = await import("../src/charts/specialFrame"));
  ({ mountSpecial } = await import("../src/charts/special"));
  ({ MapZoomBar } = await import("../src/ui/mapZoomBar"));
  ({ themeFor } = await import("../src/theme"));
  await loadSpecialModule();
});

/** Ouvre le film sur une scène et rend son image finale. */
function filmOf(sp: ChartSpec, data: Dataset = ds, reading = false) {
  const film = new StoryFilm(() => data, reading ? { reading: true } : {});
  document.body.append(film.root);
  film.open([snap(sp)]);
  film.finishNow();
  const svg = film.root.querySelector("svg.film-svg") as SVGSVGElement;
  const ids = new Set([...svg.querySelectorAll("circle[data-id]")].map((c) => c.getAttribute("data-id")));
  return { film, svg, regions: svg.querySelectorAll("path[data-region]").length, labels: [...svg.querySelectorAll("text[data-region]")].map((t) => t.textContent), points: ids.size, scale: svg.querySelector("[data-km]") };
}

describe("film : scène carte du Burundi (cas utilisateur, 10 provinces)", () => {
  for (const [why, x] of [
    ["sans Début (branche carte sans date)", null],
    ["Début = N° (contournement en ligne)", "N°"],
  ] as const) {
    it(`${why} : la carte remplit le cadre (18 provinces, 10 nommées, 10 points, barre d'échelle)`, () => {
      const f = filmOf(burundi(x));
      expect(f.regions).toBe(18);
      expect(f.labels.sort()).toEqual([...PROVS].sort());
      expect(f.points).toBe(10);
      expect(f.scale?.getAttribute("data-km")).toBeTruthy();
      // la carte est posée dans la zone du graphique, sous le titre de la scène
      const nested = f.svg.querySelector("svg[x]");
      expect(nested).not.toBeNull();
      expect(f.svg.textContent).toContain("N° : 59 k au total");
      f.film.close();
      // fermeture : l'hôte hors champ de la bibliothèque est retiré
      expect(document.querySelector("[data-testid=special-frame-host]")).toBeNull();
    });
  }

  it("mode lecture : même carte", () => {
    const f = filmOf(burundi(null), ds, true);
    expect(f.regions).toBe(18);
    expect(f.points).toBe(10);
    f.film.close();
  });

  it("carte datée (lecture 4D) : dessinée, remplie en fin de construction", () => {
    const dated = buildDataset("daté", PROVS.map((p, i) => ({ Province: p, Date: `2026-0${(i % 9) + 1}-01`, v: i + 1 })));
    const f = filmOf(spec({ type: "map", encoding: { x: "Date", y: ["v"], series: "Province" }, special: { mapRegion: "burundi" }, mode: { kind: "dynamic" } }), dated);
    expect(f.regions).toBe(18);
    expect(f.points).toBe(10);
    f.film.close();
  });
});

describe("film : autres fonds inchangés (non vides)", () => {
  const pts = buildDataset("pts", [
    { Ville: "Bruxelles", lat: 50.85, lon: 4.35, v: 4 },
    { Ville: "Paris", lat: 48.86, lon: 2.35, v: 7 },
    { Ville: "Berlin", lat: 52.52, lon: 13.4, v: 2 },
  ]);
  for (const [region, minRegions] of [["world", 200], ["europe", 40]] as const) {
    it(`${region} : fond et 3 points`, () => {
      const f = filmOf(spec({ type: "map", encoding: { x: null, y: ["v"], lat: "lat", lon: "lon", label: "Ville" }, special: { mapRegion: region } }), pts);
      expect(f.regions).toBeGreaterThan(minRegions);
      expect(f.points).toBe(3);
      f.film.close();
    });
  }
  it("fr-be : fond et 2 points (codes postaux)", () => {
    const cp = buildDataset("cp", [{ CP: "75001", v: 3 }, { CP: "1000", v: 5 }]);
    const f = filmOf(spec({ type: "map", encoding: { x: null, y: ["v"], postal: "CP" }, special: { mapRegion: "fr-be" } }), cp);
    expect(f.regions).toBeGreaterThan(90);
    expect(f.points).toBe(2);
    f.film.close();
  });
  it("encodage incomplet : message dans le cadre, pas d'exception", () => {
    const f = filmOf(spec({ type: "map", encoding: { x: null, y: ["v"] }, special: { mapRegion: "fr-be" } }), buildDataset("x", [{ v: 1 }]));
    expect(f.regions).toBe(0);
    expect(f.svg.querySelector(".r4d-empty")?.textContent ?? "").toMatch(/Code postal/);
    f.film.close();
  });
});

describe("zoom de la carte (vue seulement)", () => {
  const mount = (sp = burundi(null)) => {
    const host = document.createElement("div");
    document.body.append(host);
    const m = mountSpecial(host, sp, ds, { x: 0, y: 0, w: 800, h: 600 }, themeFor(sp), { animate: false, zoom: true });
    const bar = new MapZoomBar(() => m.handle);
    bar.sync(true);
    const g = () => host.querySelector(".smv-map-zoom")!;
    const scale = () => host.querySelector(".smv-map-scale")!;
    const km = () => Number(scale().getAttribute("data-km"));
    const px = () => Number(scale().getAttribute("data-px"));
    return { host, m, bar, g, km, px, kmPerPx: () => km() / px() };
  };

  it("boutons : + agrandit (transformation, échelle), − réduit, cadre entier revient à l'identité", () => {
    const { m, bar, g, kmPerPx } = mount();
    expect(bar.root.hidden).toBe(false);
    expect(g().getAttribute("transform")).toBeNull();
    expect(bar.zoomOut.disabled).toBe(true);
    expect(bar.reset.disabled).toBe(true);
    const k0 = kmPerPx();
    bar.zoomIn.click();
    bar.sync(true);
    const z1 = m.handle!.getMapZoom();
    expect(z1.k).toBeCloseTo(1.6, 6);
    expect(g().getAttribute("transform")).toMatch(/scale\(1\.6\)/);
    // barre d'échelle juste : 1,6 fois moins de km par pixel
    expect(kmPerPx()).toBeCloseTo(k0 / 1.6, 3);
    expect(bar.zoomOut.disabled).toBe(false);
    expect(bar.reset.disabled).toBe(false);
    bar.zoomIn.click();
    expect(m.handle!.getMapZoom().k).toBeCloseTo(2.56, 6);
    expect(kmPerPx()).toBeCloseTo(k0 / 2.56, 3);
    bar.zoomOut.click();
    expect(m.handle!.getMapZoom().k).toBeCloseTo(1.6, 6);
    bar.reset.click();
    bar.sync(true);
    expect(m.handle!.getMapZoom()).toEqual({ k: 1, x: 0, y: 0 });
    expect(g().getAttribute("transform")).toBeNull();
    expect(kmPerPx()).toBeCloseTo(k0, 6);
    expect(bar.reset.disabled).toBe(true);
    m.destroy();
  });

  it("borné à 1–8 ; traits, points et noms gardent leur taille à l'écran", () => {
    const { m, bar, host } = mount();
    for (let i = 0; i < 10; i++) bar.zoomIn.click();
    bar.sync(true);
    expect(m.handle!.getMapZoom().k).toBeCloseTo(8, 6);
    expect(bar.zoomIn.disabled).toBe(true);
    const dot = host.querySelector(".smv-map-dots circle")!;
    expect(Number(dot.getAttribute("stroke-width"))).toBeCloseTo(0.1, 6);
    const label = host.querySelector("text.smv-map-label")!;
    const fs = Math.max(8, Math.min(13, (800 - 40) / 70));
    expect(Number(label.getAttribute("font-size"))).toBeCloseTo(fs / 8, 6);
    for (let i = 0; i < 10; i++) bar.zoomOut.click();
    expect(m.handle!.getMapZoom().k).toBe(1);
    expect(Number(label.getAttribute("font-size"))).toBeCloseTo(fs, 6);
    m.destroy();
  });

  it("vue seulement : spec et empreinte inchangés ; pas de zoom au double-clic", () => {
    const sp = burundi(null);
    const before = JSON.stringify(fingerprintSpec(sp));
    const { m, host } = mount(sp);
    m.handle!.zoomMapBy(3);
    expect(JSON.stringify(fingerprintSpec(sp))).toBe(before);
    const svg = host.querySelector(".smv-chart-area svg") as unknown as { __on?: { type: string; name: string }[] };
    const handlers = (svg.__on ?? []).map((o) => `${o.type}.${o.name}`);
    expect(handlers).toContain("wheel.zoom");
    expect(handlers).not.toContain("dblclick.zoom");
    m.destroy();
  });

  it("sans option zoom (film, exports) : aucun geste branché, boutons masqués", () => {
    const host = document.createElement("div");
    const sp = burundi(null);
    const m = mountSpecial(host, sp, ds, { x: 0, y: 0, w: 800, h: 600 }, themeFor(sp), { animate: false });
    const svg = host.querySelector(".smv-chart-area svg") as unknown as { __on?: unknown[] };
    expect(svg.__on ?? []).toHaveLength(0);
    m.handle!.zoomMapBy(2);
    expect(m.handle!.getMapZoom().k).toBe(1);
    const bar = new MapZoomBar(() => null);
    bar.sync(true);
    expect(bar.root.hidden).toBe(true);
    m.destroy();
  });
});
