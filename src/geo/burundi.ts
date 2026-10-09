/**
 * Fond de carte « Burundi (provinces) » (hors ligne, TopoJSON embarqué).
 *
 * geoBoundaries gbOpen BDI ADM1 (CC0 1.0, domaine public) : les 18 provinces ANTÉRIEURES à la
 * réforme de 2025 (Rumonge incluse, créée en 2015). Le découpage en 5 provinces issu de la loi
 * organique n° 1/05 du 16 mars 2023 (appliquée en 2025) n'est pas représenté.
 *
 * Propriétés : `id` (ISO 3166-2, « BI-GI »), `name` (nom officiel de la source), `label` (nom affiché :
 * nom court pour les 10 provinces mises en avant — « Buja », « Buja rural », « Karusi »… — sinon nom
 * officiel), `highlight` (10 provinces mises en avant), `lon` / `lat` (point d'ancrage intérieur).
 *
 * Construit par `scripts/build-geo-burundi.mjs` ; voir `src/geo/europe/SOURCES.md`.
 * Projection : Mercator ajustée au pays (pays équatorial de ~250 km, déformation négligeable).
 */
import { mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import burundiTopo from "./burundi/provinces.topo.json";
import { decodeBasemapTopo, featureAtPoint, nearestFeature, type EuropeCollection, type EuropeFeature } from "./europe.js";

export const BURUNDI_ATTRIBUTION_FR = "Fond : geoBoundaries (CC0), provinces d'avant 2025";
export const BURUNDI_ATTRIBUTION_EN = "Basemap: geoBoundaries (CC0), pre-2025 provinces";

/** Les 10 provinces mises en avant : nom affiché (court) → nom officiel (source). */
export const BURUNDI_HIGHLIGHT: Readonly<Record<string, string>> = {
  Gitega: "Gitega",
  "Buja rural": "Bujumbura Rural",
  Bururi: "Bururi",
  Kirundo: "Kirundo",
  Karusi: "Karuzi",
  Bubanza: "Bubanza",
  Rumonge: "Rumonge",
  Makamba: "Makamba",
  Ngozi: "Ngozi",
  Buja: "Bujumbura Mairie",
};

let cache: EuropeCollection | null = null;

/** Couche des 18 provinces du Burundi (décodée une fois). */
export function burundiLayer(): EuropeCollection {
  if (!cache) cache = decodeBasemapTopo(burundiTopo, "provinces", "country");
  return cache;
}

/** Minuscules, sans accents, espaces / tirets / apostrophes normalisés. */
export function normalizePlaceName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let nameIndex: Map<string, EuropeFeature> | null = null;
function index(): Map<string, EuropeFeature> {
  if (nameIndex) return nameIndex;
  const m = new Map<string, EuropeFeature>();
  const add = (k: string, f: EuropeFeature) => {
    const n = normalizePlaceName(k);
    if (n && !m.has(n)) m.set(n, f);
  };
  for (const f of burundiLayer().features) {
    const p = f.properties;
    add(p.name, f);
    if (p.label) add(p.label, f);
    add(p.id, f);
    add(p.id.replace(/^BI-/, ""), f);
  }
  // Variantes usuelles (même province, pas de nouveau contour)
  const alias: Record<string, string> = {
    "Bujumbura Mairie": "BI-BM",
    "Bujumbura ville": "BI-BM",
    "Bujumbura": "BI-BM",
    "Mairie de Bujumbura": "BI-BM",
    "Buja mairie": "BI-BM",
    "Bujumbura Rural": "BI-BL",
    "Bujumbura rurale": "BI-BL",
    "Karusi": "BI-KR",
    "Karuzi": "BI-KR",
    "Kitega": "BI-GI",
    "Muhinga": "BI-MY",
    "Muramviya": "BI-MU",
  };
  const byId = new Map(burundiLayer().features.map((f) => [f.properties.id, f]));
  for (const [k, id] of Object.entries(alias)) add(k, byId.get(id)!);
  nameIndex = m;
  return m;
}

/**
 * Province d'après un nom (nom court « Buja », « Buja rural », « Karusi », nom officiel
 * « Bujumbura Mairie », « Karuzi », ou code ISO « BI-GI »), insensible à la casse et aux accents.
 * Préfixe « Province de » / « Province » accepté. null si inconnu.
 */
export function burundiProvinceByName(name: unknown): EuropeFeature | null {
  let n = normalizePlaceName(name);
  if (!n) return null;
  n = n.replace(/^province (de |du |d )?/, "").trim();
  return index().get(n) ?? null;
}

/** Province contenant [lon, lat], sinon la plus proche (≈ 5 km, contours simplifiés), sinon null. */
export function burundiRegionIdAt(lon: number, lat: number): string | null {
  const layer = burundiLayer();
  const f = featureAtPoint(layer, lon, lat);
  if (f) return f.properties.id;
  const near = nearestFeature(layer, lon, lat, 5 / 6371);
  return near ? near.properties.id : null;
}

/** Clés de méta lues en priorité pour le nom de province (puis libellé, groupe, autres textes). */
const PLACE_KEYS = /^(province|provinces|place|lieu|nom|name|region|r[ée]gion|zone|territoire|localit[ée])$/i;

/**
 * Province d'une ligne (marque) par son nom : `meta.place`, puis colonnes de méta dont le nom
 * évoque un lieu (« Province », « Nom », « Lieu »…), puis libellé, groupe, autres textes de méta.
 */
export function burundiProvinceOfMark(m: { label?: string; group?: string; meta?: Record<string, unknown> }): EuropeFeature | null {
  const meta = m.meta ?? {};
  const tries: unknown[] = [meta.place];
  for (const [k, v] of Object.entries(meta)) if (PLACE_KEYS.test(k.trim())) tries.push(v);
  tries.push(m.label, m.group);
  for (const [k, v] of Object.entries(meta)) if (typeof v === "string" && !PLACE_KEYS.test(k.trim())) tries.push(v);
  for (const v of tries) {
    if (v == null || v === "") continue;
    const f = burundiProvinceByName(v);
    if (f) return f;
  }
  return null;
}

/** Point d'ancrage intérieur [lon, lat] d'une province (étiquette, placement par nom). */
export function burundiAnchor(f: EuropeFeature): [number, number] {
  const p = f.properties as EuropeFeature["properties"] & { lon?: number; lat?: number };
  return p.lon != null && p.lat != null ? [p.lon, p.lat] : (f.centroid ?? [29.9, -3.4]);
}

let borderCache: GeoJSON.MultiLineString | null = null;
/** Limites entre provinces (arcs partagés). */
export function burundiProvinceBorders(): GeoJSON.MultiLineString {
  if (borderCache) return borderCache;
  const t = burundiTopo as unknown as Topology<Record<string, GeometryCollection>>;
  borderCache = mesh(t, t.objects.provinces!, (a, b) => a !== b) as GeoJSON.MultiLineString;
  return borderCache;
}
