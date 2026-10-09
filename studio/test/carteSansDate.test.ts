/**
 * Carte sans colonne de date (« Début » = — aucun —) : cas utilisateur « Feuil1 », 10 lignes × 2 colonnes
 * (« Prov. » + « N° »), fond « Burundi (provinces) ». La carte doit se dessiner (10 provinces), sans
 * axe temporel ni message « Le début doit être une date ou un nombre. ». Les cartes datées sont inchangées.
 * Valeurs de « N° » FICTIVES (inventées pour le test).
 */
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { buildDataset } from "../src/data/table";
import { parseSpec, type ChartSpec } from "../src/spec";
import { buildSpanDocument, mountSpecial, suggestSpecialEncoding } from "../src/charts/special";
import { computeMapLayout } from "../../src/render/map";
import { parseDocument } from "../../src/parse";
import { burundiProvinceByName } from "../../src/geo/burundi";
import { themeFor } from "../src/theme";

const PROVS = ["Gitega", "Buja rural", "Bururi", "Karusi", "Bubanza", "Kirundo", "Ngozi", "Buja", "Makamba", "Rumonge"];
const rows = PROVS.map((p, i) => ({ "Prov.": p, "N°": 3 + i * 2 }));
const ds = buildDataset("Feuil1", rows);

function mapSpec(enc: Record<string, unknown>, region = "burundi"): ChartSpec {
  const r = parseSpec({ type: "map", encoding: { y: ["N°"], series: "Prov.", ...enc }, special: { mapRegion: region } });
  if (!r.ok) throw new Error(r.issues.join(" ; "));
  return r.spec;
}

describe("carte sans date — cas « Feuil1 » (Prov. + N°), fond Burundi", () => {
  it("jeu de données : une catégorie et un nombre, aucune date", () => {
    expect(ds.columns.map((c) => [c.name, c.type])).toEqual([
      ["Prov.", "category"],
      ["N°", "number"],
    ]);
  });

  it("suggestion : magnitude = N°, groupe = Prov., pas de début imposé", () => {
    const s = suggestSpecialEncoding(ds);
    expect(s.x).toBeNull();
    expect(s.end).toBeNull();
    expect(s.y).toEqual(["N°"]);
    expect(s.series).toBe("Prov.");
  });

  for (const [why, x] of [
    ["Début = — aucun —", null],
    ["Début = colonne texte (ancien état enregistré)", "Prov."],
  ] as const) {
    it(`${why} : document sans erreur, 10 provinces placées`, () => {
      const built = buildSpanDocument(mapSpec({ x }), ds);
      expect(built.error).toBeNull();
      expect(built.timeless).toBe(true);
      const doc = parseDocument(built.doc);
      expect(doc.marks).toHaveLength(10);
      const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: "burundi", width: 800, height: 600 }, doc.marks);
      expect(layout.marks).toHaveLength(10);
      const ids = layout.marks.map((m) => m.geo.regionId).sort();
      expect(ids).toEqual(PROVS.map((p) => burundiProvinceByName(p)!.properties.id).sort());
      expect(new Set(ids).size).toBe(10);
    });
  }

  it("rendu Studio (linkedom) : pas de message d'erreur, 10 provinces dessinées, pas d'axe temporel", () => {
    const { document, window } = parseHTML("<!doctype html><html><body><div id=h></div></body></html>");
    Object.assign(globalThis, { document, window, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
    const host = document.getElementById("h") as unknown as HTMLElement;
    const spec = mapSpec({ x: null });
    const m = mountSpecial(host, spec, ds, { x: 0, y: 0, w: 800, h: 600 }, themeFor(spec), { animate: false });
    expect(m.error).toBeNull();
    expect(m.handle).not.toBeNull();
    expect(m.xDomain).toBeNull();
    expect(host.textContent ?? "").not.toMatch(/Le début doit être/);
    const marks = host.querySelectorAll(".smv-map-dots circle");
    expect(marks.length).toBe(10);
    m.destroy();
  });

  it("le message d'erreur d'origine n'apparaît plus pour une carte", () => {
    for (const region of ["burundi", "world", "europe", "fr-be"]) {
      expect(buildSpanDocument(mapSpec({ x: "Prov." }, region), ds).error ?? "").not.toMatch(/Le début doit être/);
    }
  });
});

describe("carte sans date — autres fonds (lat/lon, code postal)", () => {
  it("Monde / Europe : lat/lon sans date → points placés", () => {
    const pts = [
      { Ville: "Bruxelles", lat: 50.85, lon: 4.35, v: 4 },
      { Ville: "Paris", lat: 48.86, lon: 2.35, v: 7 },
      { Ville: "Nairobi", lat: -1.29, lon: 36.82, v: 2 },
    ];
    for (const [region, n] of [["world", 3], ["europe", 2]] as const) {
      const d = buildDataset("pts", pts.slice(0, n));
      const r = parseSpec({ type: "map", encoding: { x: null, y: ["v"], lat: "lat", lon: "lon", label: "Ville" }, special: { mapRegion: region } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const built = buildSpanDocument(r.spec, d);
      expect(built.error).toBeNull();
      const doc = parseDocument(built.doc);
      const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: region, width: 800, height: 600 }, doc.marks);
      expect(layout.marks.length).toBe(n);
    }
  });

  it("France · Belgique : code postal sans date → points placés", () => {
    const d = buildDataset("cp", [
      { CP: "75001", v: 3 },
      { CP: "1000", v: 5 },
    ]);
    const r = parseSpec({ type: "map", encoding: { x: null, y: ["v"], postal: "CP" }, special: { mapRegion: "fr-be" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const built = buildSpanDocument(r.spec, d);
    expect(built.error).toBeNull();
    const doc = parseDocument(built.doc);
    expect(computeMapLayout(doc, { viewMode: "map", mapRegion: "fr-be", width: 800, height: 600 }, doc.marks).marks.length).toBe(2);
  });
});

describe("cartes et films datés : inchangés", () => {
  const dated = buildDataset("daté", PROVS.map((p, i) => ({ Province: p, Date: `2026-0${(i % 9) + 1}-01`, v: i + 1 })));
  it("carte datée : unité date, domaine temporel conservé", () => {
    const r = parseSpec({ type: "map", encoding: { x: "Date", y: ["v"] }, special: { mapRegion: "burundi" } });
    if (!r.ok) throw new Error();
    const built = buildSpanDocument(r.spec, dated);
    expect(built.error).toBeNull();
    expect(built.unit).toBe("date");
    expect(built.timeless).toBe(false);
    expect(parseDocument(built.doc).xDomain[1]).toBeGreaterThan(parseDocument(built.doc).xDomain[0]);
    expect(suggestSpecialEncoding(dated).x).toBe("Date");
  });
  it("film : début obligatoire (messages inchangés)", () => {
    const f = parseSpec({ type: "film", encoding: { x: null, y: ["N°"] } });
    if (!f.ok) throw new Error();
    expect(buildSpanDocument(f.spec, ds).error).toMatch(/choisissez la colonne de début/);
    const g = parseSpec({ type: "film", encoding: { x: "Prov.", y: ["N°"] } });
    if (!g.ok) throw new Error();
    expect(buildSpanDocument(g.spec, ds).error).toBe("Le début doit être une date ou un nombre.");
  });
});
