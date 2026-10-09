/**
 * Fond de carte « Monde (pays) » (hors ligne, TopoJSON embarqué).
 *
 * Natural Earth 1:110m admin-0 v5.1.1 (domaine public), pack « Monde » Datanime : 236 entités
 * (pays souverains + territoires ayant un code ISO), Antarctique exclu, Crimée rattachée à l'Ukraine,
 * petites entités absentes du 110m reprises du 50m. Mêmes propriétés que le fond Europe :
 * `id` (ISO 3166 alpha-2 en majuscules : « FR », « GR », « GB », « NG »), `name`, `nameFr`, `continent`.
 * Les codes Eurostat « EL » / « UK » se joignent donc comme pour l'Europe (« GR » / « GB »).
 *
 * Construit par `scripts/build-geo-world.mjs` ; voir `src/geo/europe/SOURCES.md`.
 * Projection conseillée : Equal Earth (`d3.geoEqualEarth`), équivalente.
 */
import { mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldTopo from "./world/countries.topo.json";
import { decodeBasemapTopo, featureAtPoint, nearestFeature, type EuropeCollection } from "./europe.js";

export const WORLD_ATTRIBUTION_FR = "Fond : Natural Earth (domaine public)";
export const WORLD_ATTRIBUTION_EN = "Basemap: Natural Earth (public domain)";

let cache: EuropeCollection | null = null;

/** Couche pays du monde (décodée une fois). */
export function worldLayer(): EuropeCollection {
  if (!cache) cache = decodeBasemapTopo(worldTopo, "countries", "country");
  return cache;
}

/**
 * Pays contenant [lon, lat] sur le fond Monde, sinon pays dont le centroïde est le plus proche
 * (≈ 60 km, puis ≈ 150 km : côtes simplifiées du 1:110m), sinon null.
 */
export function worldRegionIdAt(lon: number, lat: number): string | null {
  const layer = worldLayer();
  const f = featureAtPoint(layer, lon, lat);
  if (f) return f.properties.id;
  const near = nearestFeature(layer, lon, lat, 60 / 6371) ?? nearestFeature(layer, lon, lat, 150 / 6371);
  return near ? near.properties.id : null;
}

let borderCache: GeoJSON.MultiLineString | null = null;
/** Frontières terrestres entre pays du fond Monde (arcs partagés). */
export function worldCountryBorders(): GeoJSON.MultiLineString {
  if (borderCache) return borderCache;
  const t = worldTopo as unknown as Topology<Record<string, GeometryCollection>>;
  borderCache = mesh(t, t.objects.countries!, (a, b) => a !== b) as GeoJSON.MultiLineString;
  return borderCache;
}
