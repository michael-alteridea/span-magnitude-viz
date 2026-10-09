/**
 * Fonds de carte européens (hors ligne, TopoJSON embarqué).
 *
 * - Pays : Natural Earth 1:50m admin-0 (domaine public), découpé sur l'Europe et son
 *   contexte (Afrique du Nord, Proche-Orient), Crimée rattachée à l'Ukraine.
 * - Régions France · Belgique (vue d'exploration) : IGN ADMIN EXPRESS (Licence Ouverte)
 *   et NGI-IGN AdminVector (CC BY 4.0), voir `frBeRegionLayer`.
 *
 * Les anciens niveaux « nuts1 / nuts2 / nuts3 » restent acceptés pour compatibilité des
 * configurations enregistrées : ils affichent désormais la maille pays.
 *
 * Construit par `scripts/build-geo.mjs` (mapshaper) ; voir `src/geo/europe/SOURCES.md`.
 * Anneaux dans le sens horaire (convention sphérique d3) ; un garde-fou ré-oriente toute
 * entité dont l'aire sphérique dépasse un hémisphère.
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
import frBeRegionsTopo from "./frBe/regions.topo.json";

import type { MapLevel, MapRegion } from "../types.js";

export type { MapLevel, MapRegion };

export interface EuropeRegionProps {
  /** Code ISO 3166 alpha-2 (« FR », « GB ») ; clé interne pour les régions France · Belgique (« FR1 », « BE2 »). */
  id: string;
  name: string;
  /** Code pays ISO alpha-2. */
  country: string;
  level: MapLevel;
  /** Nom français (pays). */
  nameFr?: string;
  /** Code officiel (INSEE, NIS) pour les régions France · Belgique. */
  code?: string;
  /** Continent Natural Earth (fonds pays : « Europe », « Africa »…). */
  continent?: string;
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

export const EUROPE_ATTRIBUTION_FR = "Fond : Natural Earth (domaine public)";
export const EUROPE_ATTRIBUTION_EN = "Basemap: Natural Earth (public domain)";
export const FRBE_ATTRIBUTION_FR = "Fond : IGN (Licence Ouverte), NGI-Statbel (CC BY 4.0)";
export const FRBE_ATTRIBUTION_EN = "Basemap: IGN (Licence Ouverte), NGI-Statbel (CC BY 4.0)";

/** Emprise par défaut de la carte Europe (longitude −11…32, latitude 35…71). */
export const EUROPE_FIT_EXTENT: GeoJSON.MultiPoint = {
  type: "MultiPoint",
  coordinates: [
    [-11, 35],
    [32, 35],
    [-11, 71],
    [32, 71],
    [10, 71.5],
    [10, 34.5],
  ],
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

/** Décode un TopoJSON de pays / régions (garde-fou d'orientation, bbox et centroïdes en cache). */
export function decodeBasemapTopo(topo: unknown, object: string, level: MapLevel): EuropeCollection {
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
        country: String(p.cntr ?? p.id ?? ""),
        level,
        ...(p.nameFr ? { nameFr: String(p.nameFr) } : {}),
        ...(p.code ? { code: String(p.code) } : {}),
        ...(p.continent ? { continent: String(p.continent) } : {}),
      },
    };
    const [[x0, y0], [x1, y1]] = geoBounds(ef as unknown as GeoPermissibleObjects);
    ef.bbox = [x0, y0, x1, y1];
    ef.centroid = geoCentroid(ef as unknown as GeoPermissibleObjects) as [number, number];
    features.push(ef);
  }
  return { type: "FeatureCollection", features };
}

/**
 * Couche pays (décodée une fois). Les niveaux historiques « nuts* » renvoient
 * la même couche pays (compatibilité des configurations).
 */
export function europeLayer(_level: MapLevel = "country"): EuropeCollection {
  const hit = cache.get("country");
  if (hit) return hit;
  const out = decodeBasemapTopo(countriesTopo, "countries", "country");
  cache.set("country", out);
  return out;
}

let frBeCache: EuropeCollection | null = null;
/**
 * Régions France (13, IGN ADMIN EXPRESS) et Belgique (3, NGI-IGN AdminVector),
 * identifiants internes « FR1 »…« FRM », « BE1 »…« BE3 », `code` = INSEE / NIS.
 */
export function frBeRegionLayer(): EuropeCollection {
  if (!frBeCache) frBeCache = decodeBasemapTopo(frBeRegionsTopo, "regions", "country");
  return frBeCache;
}

/** Ensemble vide (compatibilité : plus aucune couche infra-nationale en Europe). */
export function nutsCoveredCountries(_level: MapLevel): Set<string> {
  return new Set<string>();
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
export function nearestFeature(
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
 * Pays contenant [lon, lat] (point dans polygone sur la couche embarquée), sinon
 * pays dont le centroïde est le plus proche à moins d'environ 60 km (côtes simplifiées), sinon null.
 */
export function europeRegionIdAt(level: MapLevel, lon: number, lat: number): string | null {
  const layer = europeLayer(level);
  const f = featureAtPoint(layer, lon, lat);
  if (f) return f.properties.id;
  const near = nearestFeature(layer, lon, lat, 60 / 6371);
  if (near) return near.properties.id;
  // Point côtier hors du tracé simplifié : pays le plus proche à moins d'environ 150 km.
  const far = nearestFeature(layer, lon, lat, 150 / 6371);
  return far ? far.properties.id : null;
}

let borderCache: GeoJSON.MultiLineString | null = null;

/**
 * Frontières terrestres entre pays (arcs partagés par deux pays Natural Earth),
 * tracées en tirets par-dessus les régions France · Belgique.
 */
export function europeCountryBorders(_level?: MapLevel): GeoJSON.MultiLineString {
  if (borderCache) return borderCache;
  const t = countriesTopo as unknown as Topology<Record<string, GeometryCollection>>;
  borderCache = mesh(t, t.objects.countries!, (a, b) => a !== b) as GeoJSON.MultiLineString;
  return borderCache;
}
