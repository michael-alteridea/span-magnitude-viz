/**
 * Label qualité : signature (logo, lien plateforme), date de génération et source sur chaque
 * graphique ; barre d'échelle en km sur chaque carte ; export PowerPoint valide.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import JSZip from "jszip";
import { geoAzimuthalEqualArea, geoMercator } from "d3";
import { PLATFORM_URL, PRODUCT_LABEL, showSignature } from "../src/brand";
import { parseSpec } from "../src/spec";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { computeScaleBar } from "../../src/render/map";

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
let render: typeof import("../src/charts/render");

beforeAll(async () => {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { document, window });
  render = await import("../src/charts/render");
});

function draw(specInput: unknown, sampleId = "business-review", opts = {}) {
  const r = parseSpec(specInput);
  if (!r.ok) throw new Error(r.issues.join("; "));
  const s = sampleById(sampleId)!;
  const ds = buildDataset(s.name, s.rows());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  const cache = render.prepareCache(r.spec, ds, null, 1);
  const res = render.renderChart(svg, r.spec, ds, cache, { build: 1, timePos: null }, { now: new Date(2026, 9, 8, 9), ...opts });
  return { svg, res, html: svg.outerHTML };
}

describe("signature « label qualité »", () => {
  it("présente sur chaque graphique : logo, produit, lien <a href>, date, source", () => {
    for (const type of ["bar", "line", "pie", "scatter", "variance"]) {
      const { html, res, svg } = draw({ type, encoding: { x: type === "scatter" ? "Budget (€)" : "Région", y: type === "variance" ? ["Réel (€)", "Budget (€)"] : ["Réel (€)"] }, style: { source: "Source : CRM" } });
      expect(html, type).toContain('class="r4d-cartouche"');
      expect(svg.querySelector(".r4d-logo"), type).toBeTruthy();
      expect(svg.querySelector(".r4d-brand")?.textContent).toBe(PRODUCT_LABEL);
      expect(svg.querySelector("a.r4d-cartouche-link")?.getAttribute("href")).toBe(PLATFORM_URL);
      expect(norm(svg.querySelector(".r4d-cartouche-date")?.textContent ?? "")).toMatch(/^Généré le 8 oct\. 2026 · Source : CRM$/);
      expect(res.cartouche && res.cartouche.x + res.cartouche.w).toBeGreaterThan(1100);
      expect(res.cartouche!.y + res.cartouche!.h).toBeGreaterThan(620);
    }
  });
  it("aussi sur les rendus « nus » (snapshots / diapositives), pas sur les vignettes", () => {
    expect(draw({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] } }, "business-review", { bare: true }).html).toContain("r4d-cartouche");
    expect(draw({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] } }, "business-review", { bare: true }).html).not.toContain("r4d-title");
    expect(draw({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] } }, "business-review", { thumb: true }).html).not.toContain("r4d-cartouche");
  });
  it("seule l'offre « pro » peut la masquer (aucune option d'interface)", () => {
    expect(showSignature({ branding: "free", style: { brandMark: false } })).toBe(true);
    expect(showSignature({ style: { brandMark: false } })).toBe(true);
    expect(showSignature({ branding: "pro", style: { brandMark: false } })).toBe(false);
    expect(draw({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, style: { brandMark: false } }).html).toContain("r4d-cartouche");
    expect(draw({ type: "bar", branding: "pro", encoding: { x: "Région", y: ["Réel (€)"] }, style: { brandMark: false } }).html).not.toContain("r4d-cartouche");
  });
  it("commentaires « À retenir » dessinés et éditables (data-index)", () => {
    const { svg } = draw({ type: "bar", encoding: { x: "Région", y: ["Réel (€)"] }, story: { comments: ["Un", "Deux"] } });
    expect(svg.querySelectorAll(".r4d-comment")).toHaveLength(2);
    expect(svg.querySelector('.r4d-comment[data-index="1"]')?.textContent).toContain("Deux");
  });
  it("écarts IBCS : rouge / vert uniquement sur les barres d'écart", () => {
    const { svg } = draw({ type: "variance", encoding: { x: "Région", y: ["Réel (€)", "Budget (€)"] }, transform: { calculate: [{ as: "Année", op: "year", a: "Mois" }], filters: [{ field: "Année", op: "in", values: ["2026"] }] } });
    const bars = [...svg.querySelectorAll(".r4d-variance-bar")];
    expect(bars.length).toBeGreaterThanOrEqual(5);
    for (const b of bars) expect(["#d62839", "#2e9e4f"]).toContain(b.getAttribute("fill"));
    for (const a of svg.querySelectorAll(".r4d-variance-actual")) expect(["#d62839", "#2e9e4f"]).not.toContain(a.getAttribute("fill"));
  });
});

describe("barre d'échelle des cartes (km)", () => {
  it("France · Belgique (Mercator) : distance ronde, ~15 % de la largeur", () => {
    const proj = geoMercator().center([2.5, 47.5]).scale(2600).translate([480, 270]);
    const sb = computeScaleBar({ projection: proj, innerWidth: 960, innerHeight: 540 })!;
    expect([50, 75, 100, 150, 200, 250]).toContain(sb.km);
    expect(sb.px).toBeGreaterThan(50);
    expect(sb.px).toBeLessThan(260);
    expect(norm(sb.label)).toBe(`${sb.km} km`);
  });
  it("s'adapte au zoom : plus on zoome, plus la distance affichée est courte", () => {
    const a = computeScaleBar({ projection: geoMercator().center([2.5, 47.5]).scale(2600).translate([480, 270]), innerWidth: 960, innerHeight: 540 })!;
    const b = computeScaleBar({ projection: geoMercator().center([2.5, 47.5]).scale(20000).translate([480, 270]), innerWidth: 960, innerHeight: 540 })!;
    expect(b.km).toBeLessThan(a.km);
  });
  it("Europe (azimutale équivalente) : centaines de km", () => {
    const proj = geoAzimuthalEqualArea().rotate([-10, -52]).scale(900).translate([480, 270]);
    const sb = computeScaleBar({ projection: proj, innerWidth: 960, innerHeight: 540 })!;
    expect(sb.km).toBeGreaterThanOrEqual(100);
    expect(sb.km).toBeLessThanOrEqual(1000);
  });
});

describe("export PowerPoint", () => {
  it("zip valide : couverture, sommaire, une diapositive par snapshot, image, lien plateforme", async () => {
    const { buildPptx } = await import("../src/story/pptx");
    const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const mk = (id: string, role: "context" | "tension") => ({ id, name: id, createdAt: "", spec: parseSpec({}).ok ? (parseSpec({}) as { spec: unknown }).spec : {}, svg: null, thumb: null, width: 1200, height: 675, title: `Titre ${id}`, subtitle: "Sous-titre", comments: ["Point 1", "Point 2"], source: "", kind: null, role, sampleId: null, dataName: "Démo", generatedAt: "" });
    const story = { title: "Revue T3", snapshots: [mk("s1", "context"), mk("s2", "tension"), mk("s3", "context")] };
    const images = new Map(story.snapshots.map((s) => [s.id, { data: png1x1, width: 1200, height: 675 }]));
    const buf = (await buildPptx(story, { images, outputType: "nodebuffer", now: new Date(2026, 9, 8) })) as Uint8Array;
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(5);
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    const s3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(s3).toContain("Titre s1");
    expect(s3).toContain("Point 2");
    const rels = (await Promise.all(Object.keys(zip.files).filter((f) => /slides\/_rels\/slide\d+\.xml\.rels$/.test(f)).map((f) => zip.file(f)!.async("string")))).join("\n");
    expect(rels).toContain(PLATFORM_URL);
    expect(Object.keys(zip.files).some((f) => /^ppt\/media\/image/.test(f))).toBe(true);
    const cover = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(cover).toContain("Revue T3");
    expect(norm(cover)).toContain("Généré le 8 oct. 2026");
  });
});
