/**
 * Fond de carte « Monde (pays) » (Natural Earth 1:110m, domaine public) : couche, jointure par code ISO
 * alpha-2 (même casse que l'Europe), projection Equal Earth, barre d'échelle, cartouche ; l'Europe et
 * France · Belgique restent inchangées.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoArea, geoEqualEarth, type GeoPermissibleObjects } from "d3";
import { worldLayer, worldRegionIdAt, worldCountryBorders, WORLD_ATTRIBUTION_FR } from "../../src/geo/world";
import { europeLayer, europeRegionIdAt, frBeRegionLayer } from "../../src/geo/europe";
import { computeMapLayout, computeScaleBar } from "../../src/render/map";
import { parseSpec } from "../src/spec";
import { mapSourceLines } from "../src/charts/cartouche";
import { chartKindOf } from "../src/publish/manifest";

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("fond Monde (pays)", () => {
  const world = worldLayer();
  const ids = world.features.map((f) => f.properties.id);

  it("236 pays et territoires (Antarctique exclu), identifiants uniques", () => {
    expect(world.features).toHaveLength(236);
    expect(new Set(ids).size).toBe(236);
    expect(ids).not.toContain("AQ");
    expect(world.features.some((f) => f.properties.continent === "Antarctica")).toBe(false);
  });

  it("53 pays africains, dont NG, KE, ZA, CD, EG, MA, NA (Namibie)", () => {
    const africa = world.features.filter((f) => f.properties.continent === "Africa").map((f) => f.properties.id);
    expect(africa).toHaveLength(53);
    for (const c of ["NG", "KE", "ZA", "CD", "EG", "MA", "NA", "ET", "SN", "SO"]) expect(africa).toContain(c);
  });

  it("propriétés et casse identiques au fond Europe (ISO alpha-2 en majuscules, name, nameFr, continent)", () => {
    for (const f of world.features) {
      expect(f.properties.id).toMatch(/^[A-Z]{2}$/);
      expect(f.properties.name).toBeTruthy();
      expect(f.properties.nameFr).toBeTruthy();
    }
    const eu = new Set(europeLayer().features.map((f) => f.properties.id));
    for (const c of ["FR", "BE", "DE", "GR", "GB", "UA", "CY", "XK", "NO"]) {
      expect(eu.has(c)).toBe(true);
      expect(ids).toContain(c);
    }
    // Eurostat EL / UK : jointure sur GR / GB, comme pour l'Europe
    expect(ids).not.toContain("EL");
    expect(ids).not.toContain("UK");
    expect(world.features.find((f) => f.properties.id === "CD")!.properties.nameFr).toMatch(/Congo/);
  });

  it("aucune entité ne couvre un hémisphère (orientation d3)", () => {
    for (const f of world.features) expect(geoArea(f as unknown as GeoPermissibleObjects)).toBeLessThan(2 * Math.PI);
    expect(worldCountryBorders().coordinates.length).toBeGreaterThan(100);
  });

  it("point dans polygone : capitales africaines et européennes, Crimée → Ukraine", () => {
    expect(worldRegionIdAt(3.38, 6.52)).toBe("NG"); // Lagos
    expect(worldRegionIdAt(36.82, -1.29)).toBe("KE"); // Nairobi
    expect(worldRegionIdAt(28.04, -26.2)).toBe("ZA"); // Johannesburg
    expect(worldRegionIdAt(15.31, -4.32)).toBe("CD"); // Kinshasa
    expect(worldRegionIdAt(23.73, 37.98)).toBe("GR"); // Athènes
    expect(worldRegionIdAt(2.35, 48.86)).toBe("FR");
    expect(worldRegionIdAt(-77.04, 38.9)).toBe("US");
    expect(worldRegionIdAt(34.1, 44.95)).toBe("UA"); // Simferopol
    expect(worldRegionIdAt(-30, -30)).toBeNull(); // Atlantique sud
  });
});

describe("Europe et France · Belgique inchangées", () => {
  it("Europe : 93 pays, France · Belgique : 16 régions", () => {
    expect(europeLayer().features).toHaveLength(93);
    expect(frBeRegionLayer().features).toHaveLength(16);
    expect(europeRegionIdAt("country", 23.73, 37.98)).toBe("GR");
  });
  it("le fond par défaut reste France · Belgique ; « world » est accepté", () => {
    const d = parseSpec({ type: "map" });
    expect(d.ok && d.spec.special.mapRegion).toBe("fr-be");
    const w = parseSpec({ type: "map", special: { mapRegion: "world" } });
    expect(w.ok && w.spec.special.mapRegion).toBe("world");
  });
  it("texte alternatif : Europe et FR·BE inchangés, Monde ajouté", () => {
    expect(chartKindOf({ type: "map", special: { mapRegion: "europe" } })).toBe("Carte d'Europe");
    expect(chartKindOf({ type: "map", special: { mapRegion: "fr-be" } })).toBe("Carte France · Belgique");
    expect(chartKindOf({ type: "map", special: { mapRegion: "world" } })).toBe("Carte du monde");
  });
});

describe("carte Monde : projection, barre d'échelle, source", () => {
  const doc = { magnitudeMax: 1, defaults: { colorScheme: "default" }, groups: [], cohorts: [] } as never;

  it("Equal Earth, planisphère entier, barre d'échelle mesurée à l'équateur", () => {
    const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: "world", width: 960, height: 540 }, []);
    expect(layout.mapRegion).toBe("world");
    expect(layout.regions.features).toHaveLength(236);
    expect(layout.attribution).toBe(WORLD_ATTRIBUTION_FR);
    expect(layout.attribution).toMatch(/Natural Earth/);
    const sb = computeScaleBar(layout)!;
    expect(sb).not.toBeNull();
    expect(sb.km).toBeGreaterThanOrEqual(1000);
    expect(sb.km).toBeLessThanOrEqual(5000);
    expect(norm(sb.label)).toBe(`${sb.km.toLocaleString("fr-FR").replace(/[\u00a0\u202f]/g, " ")} km`);
    expect(sb.note).toBe("à l'équateur");
    // Longueur cohérente : 1° de longitude à l'équateur ≈ 111,2 km
    const p = geoEqualEarth().fitExtent([[6, 6], [layout.innerWidth - 6, layout.innerHeight - 6]], layout.regions as never);
    const pxPerDeg = p([1, 0])![0] - p([0, 0])![0];
    expect(Math.abs(sb.px - (sb.km / 111.195) * pxPerDeg) / sb.px).toBeLessThan(0.02);
  });

  it("Europe : pas de mention « à l'équateur », layout inchangé", () => {
    const layout = computeMapLayout(doc, { viewMode: "map", mapRegion: "europe", width: 960, height: 540 }, []);
    expect(layout.regions.features).toHaveLength(93);
    expect("scaleBarAt" in layout).toBe(false);
    expect(computeScaleBar(layout)!.note).toBeUndefined();
  });

  it("cartouche : Natural Earth, jamais GISCO", () => {
    const spec = (r: string) => ({ type: "map" as const, special: { mapRegion: r } as never });
    expect(mapSourceLines(spec("world"))).toEqual(["Fond : Natural Earth (domaine public)"]);
    expect(mapSourceLines(spec("europe"))).toEqual(["Fond : Natural Earth (domaine public)"]);
    for (const p of ["../../src/geo/world/countries.topo.json", "../../src/geo/world/build-info.json", "../../src/geo/world.ts"])
      expect(read(p)).not.toMatch(/gisco/i);
  });
});
