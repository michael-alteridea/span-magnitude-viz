/**
 * Offline FR/BE postal → coordinates geocoder.
 *
 * Approach:
 * 1. Exact / prefix city overrides (compact table of major cities).
 * 2. France: 5-digit code → département from the first two digits
 *    (Corsica 200xx→2A, 201xx→2A, 202–206→2B; DOM 97x skipped if absent).
 * 3. Belgium: 4-digit code → province via official postal ranges → province id (« BE-BE21 »…).
 * 4. Fallback: region centroid from the embedded FR+BE basemap.
 *
 * No network calls — safe for standalone / file:// demos.
 */

import regionCentroids from "./regionCentroids.json";
import postalCityOverrides from "./postalCityOverrides.json";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Region id matching basemap properties.id, e.g. "FR-75", "BE-BE21". */
  regionId: string;
  /** How the point was resolved. */
  source: "latlon" | "postal-city" | "postal-region" | "none";
}

type CentroidRow = {
  lat: number;
  lon: number;
  name: string;
  country: string;
  code: string;
};

const CENTROIDS = regionCentroids as Record<string, CentroidRow>;
const CITY = postalCityOverrides as Record<
  string,
  { lat: number; lon: number; regionId: string }
>;

/** Normalize postal / ZIP-like strings (strip spaces, keep digits + A/B for Corsica). */
export function normalizePostal(raw: unknown): string {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s.-]/g, "");
}

function fromRegion(regionId: string, source: GeoPoint["source"]): GeoPoint | null {
  const c = CENTROIDS[regionId];
  if (!c) return null;
  return { lat: c.lat, lon: c.lon, regionId, source };
}

/** France département code from a 5-digit postal. */
export function frDepartmentFromPostal(postal: string): string | null {
  const p = normalizePostal(postal);
  if (!/^\d{4,5}$/.test(p)) return null;
  const five = p.padStart(5, "0").slice(0, 5);
  const prefix2 = five.slice(0, 2);
  if (prefix2 === "20") {
    const n = Number(five);
    if (n >= 20000 && n <= 20199) return "2A";
    if (n >= 20200 && n <= 20699) return "2B";
    return "2A";
  }
  // Corsica alternate spellings already handled; overseas 97x / 98x
  if (prefix2 === "97" || prefix2 === "98") {
    const prefix3 = five.slice(0, 3);
    return prefix3; // FR-971 etc. — may be absent from mainland basemap
  }
  return prefix2;
}

/**
 * Belgium province id from a 4-digit postal (lightweight range table).
 * Accurate enough for province choropleth + centroid dots; city overrides refine hubs.
 */
export function beProvinceFromPostal(postal: string): string | null {
  const p = normalizePostal(postal);
  if (!/^\d{4}$/.test(p)) return null;
  const n = Number(p);
  if (n >= 1000 && n <= 1299) return "BE10"; // Bruxelles
  if (n >= 1300 && n <= 1499) return "BE31"; // Brabant wallon
  if (n >= 1500 && n <= 1999) return "BE24"; // Vlaams-Brabant
  if (n >= 2000 && n <= 2999) return "BE21"; // Antwerpen
  if (n >= 3000 && n <= 3499) return "BE24"; // Vlaams-Brabant
  if (n >= 3500 && n <= 3999) return "BE22"; // Limburg
  if (n >= 4000 && n <= 4999) return "BE33"; // Liège
  if (n >= 5000 && n <= 5999) return "BE35"; // Namur
  if (n >= 6000 && n <= 6599) return "BE32"; // Hainaut
  if (n >= 6600 && n <= 6999) return "BE34"; // Luxembourg
  if (n >= 7000 && n <= 7999) return "BE32"; // Hainaut
  if (n >= 8000 && n <= 8999) return "BE25"; // West-Vlaanderen
  if (n >= 9000 && n <= 9999) return "BE23"; // Oost-Vlaanderen
  return null;
}

/** Lookup postal → point (city override, else region centroid). */
export function lookupPostal(raw: unknown): GeoPoint | null {
  const p = normalizePostal(raw);
  if (!p) return null;

  // Exact city override
  if (CITY[p]) {
    const c = CITY[p]!;
    return { lat: c.lat, lon: c.lon, regionId: c.regionId, source: "postal-city" };
  }
  // Prefix match for FR 5-digit when override is a city centre (e.g. 75008 → 75001)
  if (p.length === 5) {
    const prefix4 = p.slice(0, 4) + "0";
    const prefixCity = p.slice(0, 2) + "000";
    for (const key of [prefix4, prefixCity, p.slice(0, 4) + "1"]) {
      if (CITY[key]) {
        const c = CITY[key]!;
        // Prefer department centroid jitter later — still use city as attractor
        return { lat: c.lat, lon: c.lon, regionId: c.regionId, source: "postal-city" };
      }
    }
  }

  // France
  if (/^\d{5}$/.test(p) || (p.length === 4 && Number(p) >= 1000)) {
    // Ambiguous 4-digit: try BE first if in BE ranges, else FR padded
  }

  if (/^\d{5}$/.test(p)) {
    const dept = frDepartmentFromPostal(p);
    if (dept) {
      const id = `FR-${dept}`;
      const hit = fromRegion(id, "postal-region");
      if (hit) return hit;
    }
  }

  if (/^\d{4}$/.test(p)) {
    const prov = beProvinceFromPostal(p);
    if (prov) {
      const id = `BE-${prov}`;
      const hit = fromRegion(id, "postal-region");
      if (hit) return hit;
    }
    // Maybe French département written without leading zero? Unlikely for 4-digit.
  }

  return null;
}

export function lookupLatLon(lat: unknown, lon: unknown): GeoPoint | null {
  const la =
    typeof lat === "number"
      ? lat
      : typeof lat === "string" && lat.trim() !== ""
        ? Number(String(lat).replace(",", "."))
        : NaN;
  const lo =
    typeof lon === "number"
      ? lon
      : typeof lon === "string" && lon.trim() !== ""
        ? Number(String(lon).replace(",", "."))
        : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < 41 || la > 52 || lo < -5.5 || lo > 10.5) {
    // Still accept — may be Corsica / far edges; region match optional
  }
  const regionId = nearestRegionId(la, lo) ?? "FR-75";
  return { lat: la, lon: lo, regionId, source: "latlon" };
}

function nearestRegionId(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, c] of Object.entries(CENTROIDS)) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Resolve coordinates for a mark from explicit lat/lon, postal, or meta keys.
 * Precedence: lat+lon → postal → meta.lat/lon → meta.postal / code_postal / zip.
 */
export function resolveMarkGeo(meta: Record<string, unknown>): GeoPoint | null {
  const lat = meta.lat ?? meta.latitude ?? meta.Lat ?? meta.Latitude;
  const lon =
    meta.lon ?? meta.lng ?? meta.longitude ?? meta.Lon ?? meta.Longitude ?? meta.long;
  const fromLl = lookupLatLon(lat, lon);
  if (fromLl) return fromLl;

  const postal =
    meta.postal ??
    meta.postalCode ??
    meta.code_postal ??
    meta.codePostal ??
    meta.zip ??
    meta.ZIP ??
    meta.cp;
  return lookupPostal(postal);
}

export function listRegionIds(): string[] {
  return Object.keys(CENTROIDS);
}

export function getRegionCentroid(regionId: string): CentroidRow | null {
  return CENTROIDS[regionId] ?? null;
}
