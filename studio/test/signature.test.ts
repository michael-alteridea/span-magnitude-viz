/**
 * Label qualité : signature (logo, lien plateforme), date de génération et source sur chaque
 * graphique ; barre d'échelle en km sur chaque carte ; export PowerPoint valide.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import JSZip from "jszip";
import { geoAzimuthalEqualArea, geoMercator } from "d3";
import { ICON_PNG_2X, LOGO_ANIM_S, PLATFORM_URL, PRODUCT_LABEL, logoAnimMarkup, showSignature, tell4dIconMarkup, wordmarkMarkup } from "../src/brand";
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

describe("identité Datanime", () => {
  it("nom du produit et icône C15 (A capitale jaune à œil ▶ sur pétrole)", () => {
    expect(PRODUCT_LABEL).toBe("Datanime");
    expect(ICON_PNG_2X).toMatch(/^data:image\/png;base64,/);
    const file = readFileSync(fileURLToPath(new URL("../src/assets/brand/tell4d-h1-icon-64.png", import.meta.url)));
    expect(ICON_PNG_2X.slice("data:image/png;base64,".length)).toBe(file.toString("base64"));
    const a = tell4dIconMarkup("hdr", 30);
    expect(a).toMatch(/^<svg[^>]* width="30" height="30"/);
    expect(a).toContain('viewBox="0 0 32 32"');
    expect(a).toContain('fill="#08465A"');
    expect(a).toContain('fill="#FFD000"');
    expect(a).toContain('fill-rule="evenodd"');
  });
  it("mot-symbole C15 « DatAnime » : jaune or sur fond clair, jaune vif sur fond sombre, œil ▶ évidé", () => {
    const l = wordmarkMarkup("light", 20);
    const d = wordmarkMarkup("dark", 20);
    expect(l).toContain('fill="#E3A600" fill-rule="evenodd"');
    expect(d).toContain('fill="#FFD000" fill-rule="evenodd"');
    expect(l).toContain('fill="#16232A"');
    expect(l).toContain('fill="#0E6E8C"');
    expect(d).toContain('fill="#FFFFFF"');
    expect(d).toContain('fill="#3FA7C4"');
    expect(l).not.toMatch(/#E8870E|#FF9F1C/);
    expect(l).toMatch(/aria-label="Datanime"/);
  });
  it("logo animé : CSS seul, préfixé, réduit les animations, figeable à l'instant t", () => {
    const a = logoAnimMarkup("dark", "x1");
    const b = logoAnimMarkup("light", "x2");
    expect(a).toContain("@keyframes x1-dataF");
    expect(a).toContain("prefers-reduced-motion");
    expect(a).toContain('class="x1-cap"');
    expect(a).toContain('id="x1-eye1dark"');
    expect(a).toContain("url(#x1-eye1dark)");
    expect(a).not.toMatch(/[.\s"]dataF\b/);
    expect(b).toContain("@keyframes x2-dataF");
    expect(a).not.toContain("<script");
    const f = logoAnimMarkup("dark", "r", { seek: 1.3, duration: 2.6, x: 10, y: 20, width: 300 });
    expect(f).toContain("animation-delay:-1.300s!important");
    expect(f).toContain("animation-play-state:paused!important");
    expect(f).toContain("animation-duration:2.6s!important");
    expect(f).toMatch(/^<svg[^>]* x="10" y="20" width="300"/);
    expect(LOGO_ANIM_S).toBeCloseTo(4.2);
  });
});

describe("signature « label qualité »", () => {
  it("présente sur chaque graphique : logo, produit, lien <a href>, date, source", () => {
    for (const type of ["bar", "line", "pie", "scatter", "variance"]) {
      const { html, res, svg } = draw({ type, encoding: { x: type === "scatter" ? "Budget (€)" : "Région", y: type === "variance" ? ["Réel (€)", "Budget (€)"] : ["Réel (€)"] }, style: { source: "Source : CRM" } });
      expect(html, type).toContain('class="r4d-cartouche"');
      const logo = svg.querySelector(".r4d-logo");
      expect(logo, type).toBeTruthy();
      // icône Datanime C15 inline (SVG imbriqué : carré pétrole, A jaune à œil ▶), pas une image
      expect(logo!.tagName.toLowerCase()).toBe("svg");
      expect(logo!.getAttribute("viewBox")).toBe("0 0 32 32");
      expect(logo!.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");
      expect(svg.querySelector(".r4d-brand")?.textContent).toBe(PRODUCT_LABEL);
      expect(svg.querySelector("a.r4d-cartouche-link")?.getAttribute("href")).toBe(PLATFORM_URL);
      expect(norm(svg.querySelector(".r4d-cartouche-date")?.textContent ?? "")).toBe("Généré le 8 oct. 2026");
      expect(norm(svg.querySelector(".r4d-cartouche .r4d-source")?.textContent ?? "")).toBe("Source : CRM");
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
    // identité Datanime : couverture, sommaire et pied de page (logo PNG 2× + mot-symbole en image, texte alternatif « Datanime »)
    const agenda = await zip.file("ppt/slides/slide2.xml")!.async("string");
    for (const x of [cover, agenda, s3]) {
      expect(x).toMatch(/descr="Datanime"/);
      expect(x.match(/<p:pic>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(x).not.toContain("Reporting 4D");
    }
    const media = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/media\/image.*\.png$/.test(f)).map((f) => zip.file(f)!.async("uint8array")));
    // le PNG 64 px de l'icône (2×) figure parmi les médias
    expect(media.some((m) => m.length > 100 && new DataView(m.buffer, m.byteOffset).getUint32(16) === 64)).toBe(true);
  });
});
