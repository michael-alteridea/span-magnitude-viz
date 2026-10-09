/**
 * Fond de carte « Burundi (provinces) » (geoBoundaries gbOpen BDI ADM1, CC0, 18 provinces d'avant 2025) :
 * 10 provinces mises en avant avec leur nom court, point dans polygone, jointure par nom (court / officiel,
 * casse et accents ignorés), projection, barre d'échelle, cartouche ; Monde / Europe / France · Belgique inchangés.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoArea, type GeoPermissibleObjects } from "d3";
import {
  burundiLayer,
  burundiProvinceByName,
  burundiProvinceOfMark,
  burundiRegionIdAt,
  burundiProvinceBorders,
  BURUNDI_ATTRIBUTION_FR,
  BURUNDI_HIGHLIGHT,
} from "../../src/geo/burundi";
import { worldLayer } from "../../src/geo/world";
import { europeLayer, frBeRegionLayer } from "../../src/geo/europe";
import { computeMapLayout, computeScaleBar } from "../../src/render/map";
import { rowsToDocument } from "../../src/fileImport";
import { parseDocument } from "../../src/parse";
import { parseSpec } from "../src/spec";
import { mapSourceLines } from "../src/charts/cartouche";
import { chartKindOf } from "../src/publish/manifest";
import { buildSpanDocument, burundiPlaceColumn } from "../src/charts/special";
import { buildDataset } from "../src/data/table";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const LABELS = ["Gitega", "Buja rural", "Bururi", "Kirundo", "Karusi", "Bubanza", "Rumonge", "Makamba", "Ngozi", "Buja"];

describe("fond Burundi (provinces d'avant 2025)", () => {
  const layer = burundiLayer();

  it("18 provinces, identifiants ISO 3166-2 uniques, Rumonge incluse", () => {
    expect(layer.features).toHaveLength(18);
    const ids = layer.features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(18);
    for (const id of ids) expect(id).toMatch(/^BI-[A-Z]{2}$/);
    expect(ids).toContain("BI-RM");
  });

  it("les 10 noms affichés ont chacun un tracé, nom officiel attendu, mis en avant ; les 8 autres non", () => {
    expect(Object.keys(BURUNDI_HIGHLIGHT)).toEqual(LABELS);
    for (const label of LABELS) {
      const f = layer.features.find((x) => x.properties.label === label);
      expect(f, label).toBeTruthy();
      expect(f!.properties.name).toBe(BURUNDI_HIGHLIGHT[label]);
      expect(f!.properties.highlight).toBe(true);
      expect(geoArea(f as unknown as GeoPermissibleObjects)).toBeGreaterThan(0);
    }
    const others = layer.features.filter((f) => !f.properties.highlight);
    expect(others).toHaveLength(8);
    for (const f of others) expect(f.properties.label).toBe(f.properties.name);
    expect(layer.features.find((f) => f.properties.id === "BI-BM")!.properties.label).toBe("Buja");
    expect(layer.features.find((f) => f.properties.id === "BI-BL")!.properties.label).toBe("Buja rural");
    expect(layer.features.find((f) => f.properties.id === "BI-KR")!.properties.label).toBe("Karusi");
  });

  it("aucune province ne couvre un hémisphère (orientation d3), limites partagées", () => {
    for (const f of layer.features) expect(geoArea(f as unknown as GeoPermissibleObjects)).toBeLessThan(0.01);
    expect(burundiProvinceBorders().coordinates.length).toBeGreaterThan(10);
  });

  it("point dans polygone : Gitega, Ngozi, Bujumbura (→ Buja)", () => {
    const at = (lat: number, lon: number) => burundiRegionIdAt(lon, lat);
    const label = (id: string | null) => layer.features.find((f) => f.properties.id === id)?.properties.label;
    expect(label(at(-3.4271, 29.9246))).toBe("Gitega");
    expect(label(at(-2.9075, 29.8306))).toBe("Ngozi");
    expect(label(at(-3.3822, 29.3644))).toBe("Buja"); // Bujumbura (centre-ville)
    expect(at(-3.3822, 29.3644)).toBe("BI-BM");
    expect(at(0, 0)).toBeNull();
  });

  it("jointure par nom : court et officiel, casse et accents ignorés", () => {
    const id = (s: string) => burundiProvinceByName(s)?.properties.id ?? null;
    for (const l of LABELS) expect(id(l)).not.toBeNull();
    expect(id("Buja")).toBe("BI-BM");
    expect(id("Bujumbura Mairie")).toBe("BI-BM");
    expect(id("BUJUMBURA MAIRIE")).toBe("BI-BM");
    expect(id("buja rural")).toBe("BI-BL");
    expect(id("Bujumbura Rural")).toBe("BI-BL");
    expect(id("Bujumbura-Rural")).toBe("BI-BL");
    expect(id("Karusi")).toBe("BI-KR");
    expect(id("Karuzi")).toBe("BI-KR");
    expect(id("GÍTEGA")).toBe("BI-GI");
    expect(id(" ngozi ")).toBe("BI-NG");
    expect(id("Province de Rumonge")).toBe("BI-RM");
    expect(id("BI-MA")).toBe("BI-MA");
    expect(id("Cibitoke")).toBe("BI-CI");
    expect(id("Kigali")).toBeNull();
    expect(id("")).toBeNull();
    expect(burundiProvinceOfMark({ label: "x", meta: { Province: "Buja rural" } })?.properties.id).toBe("BI-BL");
    expect(burundiProvinceOfMark({ label: "Makamba", meta: {} })?.properties.id).toBe("BI-MA");
  });
});

describe("carte Burundi : placement des lignes, projection, échelle, source", () => {
  // Exemple FICTIF (valeurs inventées pour le test, aucune statistique réelle)
  const rows = LABELS.map((p, i) => ({ Province: i % 2 ? p.toUpperCase() : p, Date: "2026-01-01", "Valeur (exemple fictif)": 10 + i }));
  const doc = parseDocument(
    rowsToDocument(rows, { unit: "date", mapping: { start: "Date", end: "Date", magnitude: "Valeur (exemple fictif)", place: "Province" } })
  );

  it("chaque ligne trouve sa province par son nom ; lat/lon prioritaire", () => {
    const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: "burundi", width: 800, height: 800 }, doc.marks);
    expect(layout.mapRegion).toBe("burundi");
    expect(layout.regions.features).toHaveLength(18);
    expect(layout.marks).toHaveLength(10);
    const got = layout.marks.map((m) => m.geo.regionId).sort();
    const want = LABELS.map((l) => burundiProvinceByName(l)!.properties.id).sort();
    expect(got).toEqual(want);
    for (const m of layout.marks) {
      expect(m.geo.source).toBe("place");
      expect(m.cx).toBeGreaterThan(0);
      expect(m.cx).toBeLessThan(layout.innerWidth);
      expect(m.cy).toBeGreaterThan(0);
      expect(m.cy).toBeLessThan(layout.innerHeight);
    }
    // Lat/lon : Gitega (ville) même si la colonne de nom dit autre chose
    const ll = parseDocument(
      rowsToDocument([{ Province: "Makamba", lat: -3.4271, lon: 29.9246, Date: "2026-01-01", v: 1 }], {
        unit: "date",
        mapping: { start: "Date", end: "Date", magnitude: "v", place: "Province", lat: "lat", lon: "lon" },
      })
    );
    const l2 = computeMapLayout(ll, { viewMode: "map", mapRegion: "burundi" }, ll.marks);
    expect(l2.marks[0]!.geo.regionId).toBe("BI-GI");
    expect(l2.marks[0]!.geo.source).toBe("latlon");
  });

  it("barre d'échelle en km (sans mention « à l'équateur ») et attribution geoBoundaries", () => {
    const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: "burundi", width: 800, height: 600 }, []);
    expect(layout.attribution).toBe(BURUNDI_ATTRIBUTION_FR);
    expect(layout.attribution).toMatch(/geoBoundaries/);
    const sb = computeScaleBar(layout)!;
    expect(sb).not.toBeNull();
    expect(sb.km).toBeGreaterThanOrEqual(10);
    expect(sb.km).toBeLessThanOrEqual(100);
    expect(sb.note).toBeUndefined();
  });

  it("Studio : colonne de noms détectée, document avec meta.place, spec et cartouche", () => {
    const ds = buildDataset("exemple fictif", rows);
    expect(burundiPlaceColumn(ds)).toBe("Province");
    const spec = parseSpec({
      type: "map",
      encoding: { x: "Date", y: ["Valeur (exemple fictif)"] },
      special: { mapRegion: "burundi" },
    });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    const built = buildSpanDocument(spec.spec, ds);
    expect(built.error).toBeNull();
    const marks = (built.doc as { marks: { meta?: Record<string, unknown> }[] }).marks;
    expect(marks.every((m) => typeof m.meta?.place === "string")).toBe(true);
    expect(mapSourceLines(spec.spec)).toEqual(["Fond : geoBoundaries (CC0 1.0)", "Provinces d'avant la réforme de 2025"]);
    expect(chartKindOf({ type: "map", special: { mapRegion: "burundi" } })).toBe("Carte du Burundi (provinces)");
    const settings = read("../src/ui/settings.ts");
    expect(settings).toContain('["burundi", "Burundi (provinces)"]');
  });
});

describe("autres fonds inchangés", () => {
  it("Monde 236, Europe 93, France · Belgique 16 ; défaut fr-be", () => {
    expect(worldLayer().features).toHaveLength(236);
    expect(europeLayer().features).toHaveLength(93);
    expect(frBeRegionLayer().features).toHaveLength(16);
    const d = parseSpec({ type: "map" });
    expect(d.ok && d.spec.special.mapRegion).toBe("fr-be");
    const spec = (r: string) => ({ type: "map" as const, special: { mapRegion: r } as never });
    expect(mapSourceLines(spec("world"))).toEqual(["Fond : Natural Earth (domaine public)"]);
    expect(mapSourceLines(spec("fr-be"))).toEqual(["Fond : IGN, NGI-Statbel, Natural Earth", "Licence Ouverte · CC BY 4.0 · domaine public"]);
  });
  it("pas de jointure par nom hors fond Burundi (meta.place ignoré)", () => {
    const doc = parseDocument(
      rowsToDocument([{ Province: "Gitega", Date: "2026-01-01", v: 1 }], { unit: "date", mapping: { start: "Date", end: "Date", magnitude: "v", place: "Province" } })
    );
    expect(computeMapLayout(doc, { viewMode: "map", mapRegion: "world" }, doc.marks).marks).toHaveLength(0);
    expect(computeMapLayout(doc, { viewMode: "map" }, doc.marks).marks).toHaveLength(0);
  });
});
