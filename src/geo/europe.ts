/**
 * European basemap layers (offline, bundled TopoJSON).
 *
 * - countries: Natural Earth 1:50m admin-0 (public domain), clipped to Europe.
 * - nuts1 / nuts2 / nuts3: Eurostat GISCO NUTS 2024 1:10M (© EuroGeographics
 *   for the administrative boundaries), far-overseas units excluded.
 *
 * Built by `scripts/build-europe-geo.mjs` (mapshaper); see `src/geo/europe/SOURCES.md`.
 * Rings are CW (d3 spherical convention); a runtime guard rewinds any feature
 * whose spherical area exceeds a hemisphere (classic mis-wound ring symptom).
 */
import {
  geoArea,
  geoBounds,
  geoCentroid,
  geoContains,
  geoDistance,
  type GeoPermissibleObjects,
} from "d3";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countriesTopo from "./europe/countries.topo.json";
import nuts1Topo from "./europe/nuts1.topo.json";
import nuts2Topo from "./europe/nuts2.topo.json";
import nuts3Topo from "./europe/nuts3.topo.json";

import type { MapLevel, MapRegion } from "../types.js";

export type { MapLevel, MapRegion };

export interface EuropeRegionProps {
  /** NUTS_ID (e.g. "FR101", "BE24") or ISO-3166 alpha-2 for countries ("FR", "GB"). */
  id: string;
  name: string;
  /** GISCO country code (NUTS layers: "EL" for Greece) or ISO alpha-2 for countries. */
  country: string;
  level: MapLevel;
  /** French display name (countries layer only). */
  nameFr?: string;
}

export interface EuropeFeature {
  type: "Feature";
  properties: EuropeRegionProps;
  geometry: GeoJSON.Geometry;
  /** Cached [[west, south], [east, north]] for point-in-polygon pre-filtering. */
  bbox?: [number, number, number, number];
  /** Cached spherical centroid [lon, lat] (nearest-region fallback). */
  centroid?: [number, number];
}

export interface EuropeCollection {
  type: "FeatureCollection";
  features: EuropeFeature[];
}

export const EUROPE_ATTRIBUTION_FR =
  "© EuroGeographics pour les limites administratives (Eurostat GISCO NUTS 2024) · Natural Earth";
export const EUROPE_ATTRIBUTION_EN =
  "© EuroGeographics for the administrative boundaries (Eurostat GISCO NUTS 2024) · Natural Earth";

/** GISCO country codes that differ from ISO 3166 alpha-2. */
const GISCO_TO_ISO: Record<string, string> = { EL: "GR", UK: "GB" };
export function giscoToIso(code: string): string {
  return GISCO_TO_ISO[code] ?? code;
}

const TOPOS: Record<MapLevel, { topo: unknown; object: string }> = {
  country: { topo: countriesTopo, object: "countries" },
  nuts1: { topo: nuts1Topo, object: "nuts1" },
  nuts2: { topo: nuts2Topo, object: "nuts2" },
  nuts3: { topo: nuts3Topo, object: "nuts3" },
};

const cache = new Map<MapLevel, EuropeCollection>();

function reverseRings(geom: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geom.type === "Polygon") {
    return { ...geom, coordinates: geom.coordinates.map((r) => [...r].reverse()) };
  }
  if (geom.type === "MultiPolygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((p) => p.map((r) => [...r].reverse())),
    };
  }
  return geom;
}

/** Decode (once) and return a European layer as a d3-ready FeatureCollection. */
export function europeLayer(level: MapLevel): EuropeCollection {
  const hit = cache.get(level);
  if (hit) return hit;
  const { topo, object } = TOPOS[level];
  const t = topo as unknown as Topology<Record<string, GeometryCollection>>;
  const fc = feature(t, t.objects[object]!) as unknown as GeoJSON.FeatureCollection;
  const features: EuropeFeature[] = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    let geometry = f.geometry;
    // Rewind guard: a feature covering > half the sphere is inside-out for d3.
    if (geoArea(f as GeoPermissibleObjects) > 2 * Math.PI) geometry = reverseRings(geometry);
    const ef: EuropeFeature = {
      type: "Feature",
      geometry,
      properties: {
        id: String(p.id ?? f.id ?? ""),
        name: String(p.name ?? ""),
        country: String(level === "country" ? p.id ?? "" : p.cntr ?? ""),
        level,
        ...(p.nameFr ? { nameFr: String(p.nameFr) } : {}),
      },
    };
    const [[x0, y0], [x1, y1]] = geoBounds(ef as unknown as GeoPermissibleObjects);
    ef.bbox = [x0, y0, x1, y1];
    ef.centroid = geoCentroid(ef as unknown as GeoPermissibleObjects) as [number, number];
    features.push(ef);
  }
  const out: EuropeCollection = { type: "FeatureCollection", features };
  cache.set(level, out);
  return out;
}

/** ISO alpha-2 codes of countries covered by a NUTS layer (for background masking). */
export function nutsCoveredCountries(level: MapLevel): Set<string> {
  const s = new Set<string>();
  if (level === "country") return s;
  for (const f of europeLayer(level).features) s.add(giscoToIso(f.properties.country));
  return s;
}

function inBbox(b: [number, number, number, number] | undefined, lon: number, lat: number): boolean {
  if (!b) return true;
  const [x0, y0, x1, y1] = b;
  if (lat < y0 || lat > y1) return false;
  // Antimeridian-crossing boxes have x0 > x1 (not expected after the Europe clip)
  return x0 <= x1 ? lon >= x0 && lon <= x1 : lon >= x0 || lon <= x1;
}

/** Feature of `layer` containing [lon, lat], or null. */
export function featureAtPoint(
  layer: EuropeCollection,
  lon: number,
  lat: number
): EuropeFeature | null {
  for (const f of layer.features) {
    if (!inBbox(f.bbox, lon, lat)) continue;
    if (geoContains(f as unknown as GeoPermissibleObjects, [lon, lat])) return f;
  }
  return null;
}

/** Nearest feature by centroid (great-circle), within `maxRad` radians. */
function nearestFeature(
  layer: EuropeCollection,
  lon: number,
  lat: number,
  maxRad: number
): EuropeFeature | null {
  let best: EuropeFeature | null = null;
  let bestD = maxRad;
  for (const f of layer.features) {
    if (!f.centroid) continue;
    const d = geoDistance(f.centroid, [lon, lat]);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * Region id for a point at `level` (point-in-polygon on the bundled layer).
 * Fallbacks, in order:
 *  - NUTS levels: the country layer (no NUTS coverage there, e.g. United Kingdom, Ukraine);
 *  - country level: the NUTS-3 unit's country (coastal points the 1:50m outline misses);
 *  - nearest region centroid within ~60 km (coastal / simplified-outline misses);
 *  - null.
 */
export function europeRegionIdAt(level: MapLevel, lon: number, lat: number): string | null {
  const layer = europeLayer(level);
  const f = featureAtPoint(layer, lon, lat);
  if (f) return f.properties.id;
  if (level !== "country") {
    const c = featureAtPoint(europeLayer("country"), lon, lat);
    if (c) return c.properties.id;
  } else {
    const n = featureAtPoint(europeLayer("nuts3"), lon, lat);
    if (n) {
      const iso = giscoToIso(n.properties.country);
      if (layer.features.some((x) => x.properties.id === iso)) return iso;
    }
  }
  const near = nearestFeature(layer, lon, lat, 60 / 6371);
  return near ? near.properties.id : null;
}

const borderCache = new Map<MapLevel, GeoJSON.MultiLineString>();

/**
 * Inner country borders derived from a NUTS topology (arcs shared by units of
 * two different countries) — drawn slightly heavier over the NUTS mesh.
 */
export function europeCountryBorders(level: MapLevel): GeoJSON.MultiLineString | null {
  if (level === "country") return null;
  const hit = borderCache.get(level);
  if (hit) return hit;
  const { topo, object } = TOPOS[level];
  const t = topo as unknown as Topology<Record<string, GeometryCollection>>;
  const cntrOf = (g: unknown) =>
    (g as { properties?: { cntr?: string } }).properties?.cntr ?? "";
  const m = mesh(
    t,
    t.objects[object]!,
    (a, b) => a !== b && cntrOf(a) !== cntrOf(b)
  ) as GeoJSON.MultiLineString;
  borderCache.set(level, m);
  return m;
}
