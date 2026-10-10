/**
 * Map layer (D3 geo + same film reveal schedule).
 * Basemaps: France + Belgium (legacy, `mapRegion: "fr-be"`), Europe
 * (`mapRegion: "europe"`, countries), World (`mapRegion: "world"`, countries, Equal Earth) or
 * Burundi (`mapRegion: "burundi"`, 18 pre-2025 provinces, placement by lat/lon or province name).
 * Modes: animated dots; optional choropleth / soft heatmap intensity at finale.
 */
import {
  geoAzimuthalEqualArea,
  geoDistance,
  geoEqualEarth,
  geoMercator,
  geoPath,
  type GeoProjection,
  interpolateRgb,
  scaleSqrt,
  select,
  type GeoPermissibleObjects,
  type Selection,
} from "d3";
import frBeRegions from "../geo/frBeRegions.json";
import { resolveMarkGeo, type GeoPoint } from "../geo/postalLookup.js";
import {
  EUROPE_ATTRIBUTION_FR,
  EUROPE_FIT_EXTENT,
  FRBE_ATTRIBUTION_FR,
  europeLayer,
  europeRegionIdAt,
} from "../geo/europe.js";
import { WORLD_ATTRIBUTION_FR, worldLayer, worldRegionIdAt } from "../geo/world.js";
import {
  BURUNDI_ATTRIBUTION_FR,
  burundiAnchor,
  burundiLayer,
  burundiProvinceOfMark,
  burundiRegionIdAt,
} from "../geo/burundi.js";
import {
  effectiveDrawProgress,
  FINALE_START,
  markProgress,
  persistenceFactor,
  type RevealSchedule,
} from "../animate.js";
import { ALTAIRADY_REDS, BRAND, PETROLE_SEQUENTIAL, brandForScheme, isPetroleScheme, resolveMarkColor } from "../colors.js";
import type {
  MapLevel,
  MapRegion,
  NormalizedDocument,
  NormalizedMark,
  PersistenceMode,
  VizOptions,
} from "../types.js";

export interface MapMark {
  mark: NormalizedMark;
  geo: GeoPoint;
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface RegionProps {
  id: string;
  country: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RegionFeature {
  type: "Feature";
  properties: RegionProps;
  geometry: GeoPermissibleObjects;
}

export interface RegionCollection {
  type: "FeatureCollection";
  features: RegionFeature[];
}

/** Minimal feature shape shared by the FR+BE and European basemaps. */
export interface BasemapFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    country?: string;
    nameFr?: string;
    /** Burundi: short display name, highlight flag, interior anchor. */
    label?: string;
    highlight?: boolean;
    lon?: number;
    lat?: number;
  };
  geometry: GeoPermissibleObjects | GeoJSON.Geometry;
}

export interface BasemapCollection {
  type: "FeatureCollection";
  features: BasemapFeature[];
}

export interface MapLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
  marks: MapMark[];
  projection: GeoProjection;
  path: ReturnType<typeof geoPath>;
  /** Choropleth layer (FR+BE départements/provinces, or the European level). */
  regions: BasemapCollection;
  /** Background layer drawn underneath (unused since the country-only Europe map). */
  background: BasemapCollection | null;
  /** Inner country borders (heavier stroke), or null. */
  countryBorders: GeoJSON.MultiLineString | null;
  mapRegion: MapRegion;
  mapLevel: MapLevel | null;
  /** Caption under the map. */
  caption: string;
  /** Required data attribution (Europe), or null. */
  attribution: string | null;
  /**
   * Where the scale bar measures ground distance: at the bar (default) or along the equator
   * (world map: the Equal Earth scale varies strongly with latitude, the label says so).
   */
  scaleBarAt?: "bar" | "equator";
  /** Zoom-dependent factor for dots / heat halos (1 = FR+BE framing). */
  markScale: number;
  /** regionId → sum of magnitudes (all marks, for scale domain). */
  regionTotals: Map<string, number>;
}

const REGIONS = frBeRegions as unknown as RegionCollection;

const MAP_CSS = `
.smv-map-region {
  stroke: #3f3a36;
  stroke-width: 0.6;
  vector-effect: non-scaling-stroke;
}
.smv-root--light .smv-map-region {
  stroke: #d6d3d1;
  fill: #f5f5f4;
}
.smv-map-region--bg {
  stroke: #2e2a27;
}
.smv-map-borders {
  fill: none;
  stroke: #57534e;
  stroke-width: 0.8;
  pointer-events: none;
  vector-effect: non-scaling-stroke;
}
.smv-root--light .smv-map-borders {
  stroke: #a8a29e;
}
.smv-map-attribution {
  font-size: 9px;
  fill: #57534e;
}
.smv-map-label {
  fill: #e7e5e4;
  paint-order: stroke;
  stroke: #1c1917;
  stroke-width: 2.5px;
  stroke-linejoin: round;
}
.smv-root--light .smv-map-label {
  fill: #0b4f66;
  stroke: #ffffff;
}
.smv-root--light .smv-map-region--bg {
  fill: #ebe9e7;
}
.smv-map-region--active {
  stroke: ${BRAND.accent};
  stroke-width: 1.2;
}
.smv-map-dots .smv-mark {
  cursor: pointer;
}
.smv-map-heat {
  pointer-events: none;
  mix-blend-mode: screen;
}
.smv-root--light .smv-map-heat {
  mix-blend-mode: multiply;
}
.smv-map-legend text {
  font-size: 10px;
  fill: #a8a29e;
}
`;

export function mapLayerCss(): string {
  return MAP_CSS;
}

function defaultMargin(opts: VizOptions) {
  return (
    opts.margin ?? {
      top: 28,
      right: 20,
      bottom: 36,
      left: 20,
    }
  );
}

/** Stable tiny jitter so overlapping department centroids separate slightly. */
function hashJitter(id: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 10) % 1000) / 1000);
  return [(a - 0.5) * 0.35, (b - 0.5) * 0.35];
}

export function marksWithGeo(marks: NormalizedMark[]): Array<{
  mark: NormalizedMark;
  geo: GeoPoint;
}> {
  const out: Array<{ mark: NormalizedMark; geo: GeoPoint }> = [];
  for (const m of marks) {
    const geo = resolveMarkGeo(m.meta);
    if (geo && geo.source !== "none") out.push({ mark: m, geo });
  }
  return out;
}

/**
 * Fond Burundi : lat/lon explicites (point dans polygone), sinon nom de province (« Buja »,
 * « Bujumbura Mairie », « Karusi »… → point d'ancrage intérieur), sinon point d'origine (code postal)
 * marqué hors fond (`?…`).
 */
export function burundiGeocode(marks: NormalizedMark[]): Array<{ mark: NormalizedMark; geo: GeoPoint }> {
  const out: Array<{ mark: NormalizedMark; geo: GeoPoint }> = [];
  for (const m of marks) {
    const geo = resolveMarkGeo(m.meta ?? {});
    if (geo && geo.source === "latlon") {
      out.push({ mark: m, geo: { ...geo, regionId: burundiRegionIdAt(geo.lon, geo.lat) ?? `?${geo.regionId}` } });
      continue;
    }
    const f = burundiProvinceOfMark(m);
    if (f) {
      const [lon, lat] = burundiAnchor(f);
      out.push({ mark: m, geo: { lat, lon, regionId: f.properties.id, source: "place" } });
      continue;
    }
    if (geo && geo.source !== "none") out.push({ mark: m, geo: { ...geo, regionId: `?${geo.regionId}` } });
  }
  return out;
}

export function documentHasGeo(marks: NormalizedMark[]): boolean {
  return marksWithGeo(marks).length > 0;
}

/** Base fills (dark theme) — background countries recede slightly. */
export const MAP_FILL = "#1c1917";
export const MAP_FILL_BG = "#151312";

export function computeMapLayout(
  doc: NormalizedDocument,
  options: VizOptions,
  visible: NormalizedMark[]
): MapLayout {
  const width = options.width ?? 960;
  const height = options.height ?? 540;
  const margin = defaultMargin(options);
  const innerWidth = Math.max(40, width - margin.left - margin.right);
  const innerHeight = Math.max(40, height - margin.top - margin.bottom);
  const mapRegion: MapRegion =
    options.mapRegion === "europe"
      ? "europe"
      : options.mapRegion === "world"
        ? "world"
        : options.mapRegion === "burundi"
          ? "burundi"
          : "fr-be";

  let geocoded = marksWithGeo(visible);
  let projection: GeoProjection;
  let regions: BasemapCollection;
  const background: BasemapCollection | null = null;
  const countryBorders: GeoJSON.MultiLineString | null = null;
  let mapLevel: MapLevel | null = null;
  let caption = "France · Belgique — lat/lon ou code postal";
  let attribution: string | null = FRBE_ATTRIBUTION_FR;

  if (mapRegion === "europe") {
    // Maille unique : pays (les niveaux historiques « nuts* » sont lus comme « country »).
    const level: MapLevel = "country";
    mapLevel = level;
    regions = europeLayer(level) as unknown as BasemapCollection;
    // Re-assign every point to the region of the active level (point-in-polygon).
    geocoded = geocoded.map(({ mark, geo }) => ({
      mark,
      geo: {
        ...geo,
        regionId: europeRegionIdAt(level, geo.lon, geo.lat) ?? `?${geo.regionId}`,
      },
    }));

    projection = geoAzimuthalEqualArea().rotate([-10, -52]);
    const pad = 6;
    const extent: [[number, number], [number, number]] = [
      [pad, pad],
      [innerWidth - pad, innerHeight - pad],
    ];
    let fitTarget: unknown = EUROPE_FIT_EXTENT;
    if (options.mapFit === "data" && geocoded.length) {
      const ids = new Set(geocoded.map((g) => g.geo.regionId));
      const hit = regions.features.filter((f) =>
        ids.has(f.properties.id)
      );
      if (hit.length) fitTarget = { type: "FeatureCollection", features: hit };
    }
    projection.fitExtent(extent, fitTarget as GeoPermissibleObjects);
    projection.clipExtent([
      [0, 0],
      [innerWidth, innerHeight],
    ]);
    caption = "Europe · pays — lat/lon (code postal FR/BE)";
    attribution = EUROPE_ATTRIBUTION_FR;
  } else if (mapRegion === "world") {
    // Monde : maille pays (Natural Earth 1:110m), projection équivalente Equal Earth.
    mapLevel = "country";
    regions = worldLayer() as unknown as BasemapCollection;
    geocoded = geocoded.map(({ mark, geo }) => ({
      mark,
      geo: { ...geo, regionId: worldRegionIdAt(geo.lon, geo.lat) ?? `?${geo.regionId}` },
    }));
    projection = geoEqualEarth();
    const pad = 6;
    let fitTarget: unknown = regions;
    if (options.mapFit === "data" && geocoded.length) {
      const ids = new Set(geocoded.map((g) => g.geo.regionId));
      const hit = regions.features.filter((f) => ids.has(f.properties.id));
      if (hit.length) fitTarget = { type: "FeatureCollection", features: hit };
    }
    projection.fitExtent(
      [
        [pad, pad],
        [innerWidth - pad, innerHeight - pad],
      ],
      fitTarget as GeoPermissibleObjects
    );
    projection.clipExtent([
      [0, 0],
      [innerWidth, innerHeight],
    ]);
    caption = "Monde · pays — lat/lon (code postal FR/BE)";
    attribution = WORLD_ATTRIBUTION_FR;
  } else if (mapRegion === "burundi") {
    // Burundi : 18 provinces d'avant 2025 ; placement par lat/lon (prioritaire) ou par nom de province.
    mapLevel = "country";
    regions = burundiLayer() as unknown as BasemapCollection;
    geocoded = burundiGeocode(visible);
    projection = geoMercator();
    const pad = 6;
    let fitTarget: unknown = regions;
    if (options.mapFit === "data" && geocoded.length) {
      const ids = new Set(geocoded.map((g) => g.geo.regionId));
      const hit = regions.features.filter((f) => ids.has(f.properties.id));
      if (hit.length) fitTarget = { type: "FeatureCollection", features: hit };
    }
    projection.fitExtent(
      [
        [pad, pad],
        [innerWidth - pad, innerHeight - pad],
      ],
      fitTarget as GeoPermissibleObjects
    );
    projection.clipExtent([
      [0, 0],
      [innerWidth, innerHeight],
    ]);
    caption = "Burundi · provinces (avant 2025) — nom de province ou lat/lon";
    attribution = BURUNDI_ATTRIBUTION_FR;
  } else {
    regions = REGIONS as unknown as BasemapCollection;
    projection = geoMercator().fitSize(
      [innerWidth, innerHeight],
      REGIONS as unknown as GeoPermissibleObjects
    );
  }
  const path = geoPath(projection);

  // Dot / heat size follows zoom: full size at the FR+BE framing, smaller for all-Europe.
  let markScale = 1;
  if (mapRegion === "europe" || mapRegion === "world" || mapRegion === "burundi") {
    const ref = geoMercator()
      .fitSize([innerWidth, innerHeight], REGIONS as unknown as GeoPermissibleObjects)
      .scale();
    markScale = Math.max(0.42, Math.min(1, Math.sqrt(projection.scale() / ref)));
  }

  const magMax = Math.max(1, ...geocoded.map((g) => g.mark.magnitude), doc.magnitudeMax);
  const rScale = scaleSqrt()
    .domain([0, magMax])
    .range([Math.max(1.2, 2.2 * markScale), 11 * markScale]);

  const regionTotals = new Map<string, number>();
  const marks: MapMark[] = geocoded.map(({ mark, geo }) => {
    const [jx, jy] = hashJitter(mark.id);
    // Small geographic jitter (~km scale) so stacked dept centroids fan out
    const lon = geo.lon + jx * 0.08;
    const lat = geo.lat + jy * 0.06;
    const projected = projection([lon, lat]);
    const cx = projected?.[0] ?? innerWidth / 2;
    const cy = projected?.[1] ?? innerHeight / 2;
    regionTotals.set(
      geo.regionId,
      (regionTotals.get(geo.regionId) ?? 0) + mark.magnitude
    );
    return {
      mark,
      geo,
      cx,
      cy,
      r: rScale(mark.magnitude),
      color: resolveMarkColor(mark, visible, {
        colorScheme: options.colorScheme ?? doc.defaults.colorScheme,
        colorBy: options.colorBy ?? "group",
        groups: doc.groups,
        cohorts: doc.cohorts,
      }),
    };
  });

  return {
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    marks,
    projection,
    path,
    regions,
    background,
    countryBorders,
    mapRegion,
    mapLevel,
    caption,
    attribution,
    ...(mapRegion === "world" ? { scaleBarAt: "equator" as const } : {}),
    markScale,
    regionTotals,
  };
}

/* ------------------------------------------------------------------ scale bar */

export interface ScaleBar {
  /** Distance shown (km, "nice" value). */
  km: number;
  /** Bar length in px (layout inner coordinates). */
  px: number;
  /** French label, e.g. "100 km". */
  label: string;
  /** Bottom-left anchor (inner coordinates). */
  x: number;
  y: number;
  /** Validity note painted right of the bar (world map: "à l'équateur"). */
  note?: string;
}

const NICE_KM = [1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 500, 750, 1000, 1500, 2000, 2500, 5000];
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Scale bar in km for the current projection / framing: measures the ground distance of a
 * horizontal pixel span at the bar position (Mercator scale varies with latitude), then picks a
 * round distance whose length is close to ~16 % of the map width.
 */
export function computeScaleBar(
  layout: Pick<MapLayout, "projection" | "innerWidth" | "innerHeight"> & Partial<Pick<MapLayout, "scaleBarAt">>
): ScaleBar | null {
  const { projection, innerWidth: w, innerHeight: h } = layout;
  if (!projection.invert) return null;
  const x = Math.max(8, Math.min(18, w * 0.02));
  const y = h - Math.max(8, Math.min(16, h * 0.03));
  const span = Math.max(20, w * 0.2);
  const measureAt = (px: number, py: number): number | null => {
    const a = projection.invert!([px, py]);
    const b = projection.invert!([px + span, py]);
    if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
    const d = geoDistance(a, b) * EARTH_RADIUS_KM;
    return d > 0 && Number.isFinite(d) ? d / span : null;
  };
  if (layout.scaleBarAt === "equator") {
    // Monde : échelle vraie le long de l'équateur (centrée sur le méridien de Greenwich)
    const eq = projection([0, 0]);
    const kmEq = eq && eq.every(Number.isFinite) ? measureAt(eq[0] - span / 2, eq[1]) : null;
    if (!kmEq) return null;
    const targetEq = kmEq * Math.max(36, Math.min(160, w * 0.16));
    let kmE = NICE_KM[0]!;
    for (const n of NICE_KM) if (n <= targetEq) kmE = n;
    const label = `${kmE.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}\u00a0km`;
    return { km: kmE, px: kmE / kmEq, label, x, y, note: "à l'équateur" };
  }
  // At the bar's latitude, else at the map centre
  const kmPerPx = measureAt(x, y - 6) ?? measureAt(w / 2 - span / 2, h / 2);
  if (!kmPerPx) return null;
  const targetKm = kmPerPx * Math.max(36, Math.min(160, w * 0.16));
  let km = NICE_KM[0]!;
  for (const n of NICE_KM) if (n <= targetKm) km = n;
  const px = km / kmPerPx;
  return { km, px, label: `${km.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}\u00a0km`, x, y };
}

/** Map view transform (inner map coordinates): screen = k · p + (x, y). */
export interface MapZoomTransform {
  k: number;
  x: number;
  y: number;
}

/**
 * Projection seen through a view zoom (forward and inverse), for the scale bar of a zoomed map:
 * a ground distance spans k times more pixels.
 */
export function zoomedProjection(projection: GeoProjection, z: MapZoomTransform): GeoProjection {
  if (z.k === 1 && z.x === 0 && z.y === 0) return projection;
  const f = ((p: [number, number]) => {
    const q = projection(p);
    return q ? [q[0] * z.k + z.x, q[1] * z.k + z.y] : null;
  }) as unknown as GeoProjection;
  (f as { invert?: GeoProjection["invert"] }).invert = projection.invert
    ? (p: [number, number]) => projection.invert!([(p[0] - z.x) / z.k, (p[1] - z.y) / z.k])
    : undefined;
  return f;
}

/**
 * Keeps Burundi province labels readable under a view zoom: same on-screen size and offset above the anchor.
 */
export function applyMapLabelZoom(ctx: MapPaintContext, k: number): void {
  const { layout } = ctx;
  if (layout.mapRegion !== "burundi") return;
  const fs = Math.max(8, Math.min(13, layout.innerWidth / 70));
  ctx.gBasemap.selectAll<SVGTextElement, BasemapFeature>("text.smv-map-label")
    .attr("font-size", fs / k)
    .attr("y", (d) => (layout.projection([d.properties.lon ?? 0, d.properties.lat ?? 0]) ?? [0, 0])[1] - (fs * 0.6 + 7) / k)
    .style("stroke-width", () => (k === 1 ? null : `${2.5 / k}px`));
}

/** Paints the km scale bar (always shown on maps) into `g` (inner map coordinates). */
export function paintScaleBar(
  g: Selection<SVGGElement, unknown, null, undefined>,
  layout: Pick<MapLayout, "projection" | "innerWidth" | "innerHeight"> & Partial<Pick<MapLayout, "scaleBarAt">>,
  light: boolean
): ScaleBar | null {
  g.selectAll("g.smv-map-scale").remove();
  const sb = computeScaleBar(layout);
  if (!sb) return null;
  const ink = light ? "#44403c" : "#d6d3d1";
  const paper = light ? "#ffffff" : "#1c1917";
  const hgt = 4;
  const gs = g
    .append("g")
    .attr("class", "smv-map-scale")
    .attr("data-km", sb.km)
    .attr("data-px", sb.px.toFixed(1))
    .attr("transform", `translate(${sb.x},${sb.y})`)
    .style("pointer-events", "none");
  // Two-tone bar (half / half) with end ticks, label above
  gs.append("rect").attr("x", 0).attr("y", -hgt).attr("width", sb.px).attr("height", hgt).attr("fill", paper).attr("stroke", ink).attr("stroke-width", 0.8);
  gs.append("rect").attr("x", 0).attr("y", -hgt).attr("width", sb.px / 2).attr("height", hgt).attr("fill", ink);
  gs.append("text")
    .attr("x", 0)
    .attr("y", -hgt - 4)
    .attr("font-size", 10)
    .attr("fill", ink)
    .attr("font-family", "inherit")
    .text("0");
  gs.append("text")
    .attr("class", "smv-map-scale-label")
    .attr("x", sb.px)
    .attr("y", -hgt - 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .attr("font-weight", 600)
    .attr("fill", ink)
    .attr("font-family", "inherit")
    .text(sb.label);
  if (sb.note) {
    gs.append("text")
      .attr("class", "smv-map-scale-note")
      .attr("x", sb.px + 6)
      .attr("y", 0)
      .attr("font-size", 9)
      .attr("fill", ink)
      .attr("font-family", "inherit")
      .text(sb.note);
  }
  return sb;
}

const SCALE_STOPS: Record<string, readonly string[]> = {
  rouge: ["#fbd5d9", "#f0707c", "#e9374a", "#d62839", "#7a1520"],
  bleu: ["#dbeafe", "#7dd3fc", "#0ea5e9", "#0369a1", "#0c4a6e"],
  vert: ["#dcfce7", "#86efac", "#22c55e", "#15803d", "#14532d"],
  "froid-chaud": ["#1d4ed8", "#38bdf8", "#fef3c7", "#f97316", "#b91c1c"],
  "blanc-noir": ["#fafafa", "#d4d4d4", "#a3a3a3", "#525252", "#171717"],
  petrole: ["#C3E4EE", "#8ECFE2", "#3FA7C4", "#0E6E8C", "#08465A"],
};
function choroplethColor(t: number, scheme?: string): string {
  const stops = SCALE_STOPS[scheme ?? ""] ?? SCALE_STOPS["froid-chaud"]!;
  const u = Math.max(0, Math.min(1, t));
  const x = u * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= stops.length - 1) return stops[stops.length - 1]!;
  return interpolateRgb(stops[i]!, stops[i + 1]!)(f);
}

export interface MapPaintContext {
  /** View zoom factor (dots, halos and labels keep their on-screen size). Default 1. */
  zoomK?: number;
  gBasemap: Selection<SVGGElement, unknown, null, undefined>;
  gHeat: Selection<SVGGElement, unknown, null, undefined>;
  gDots: Selection<SVGGElement, unknown, null, undefined>;
  layout: MapLayout;
  schedule: RevealSchedule;
  options: VizOptions;
  onHoverMark: (
    sel: Selection<SVGElement, MapMark, SVGGElement, unknown>
  ) => void;
}

export function paintMapLayers(ctx: MapPaintContext): void {
  const { gBasemap, gHeat, gDots, layout, options, onHoverMark } = ctx;

  gBasemap.selectAll("*").remove();
  gHeat.selectAll("*").remove();
  gDots.selectAll("*").remove();

  gBasemap.attr(
    "class",
    `smv-map-basemap smv-map-basemap--${layout.mapRegion}${
      layout.mapLevel ? ` smv-map-basemap--${layout.mapLevel}` : ""
    }`
  );

  const paintRegions = (
    features: BasemapFeature[],
    cls: string,
    baseFill: string
  ) => {
    const sel = gBasemap
      .append("g")
      .attr("class", cls)
      .selectAll<SVGPathElement, BasemapFeature>("path")
      .data(features, (d) => d.properties.id)
      .join("path")
      .attr("class", `smv-map-region${cls.endsWith("--bg") ? " smv-map-region--bg" : ""}`)
      .attr("d", (d) => layout.path(d as unknown as GeoPermissibleObjects) ?? "")
      .attr("data-region", (d) => d.properties.id)
      .attr("data-base-fill", baseFill)
      .attr("fill", baseFill)
      .attr("fill-opacity", 1);
    sel
      .append("title")
      .text((d) =>
        d.properties.label && d.properties.label !== d.properties.name
          ? `${d.properties.label} — ${d.properties.name} (${d.properties.id})`
          : `${d.properties.nameFr ?? d.properties.name} (${d.properties.id})`
      );
  };

  if (layout.background) {
    paintRegions(layout.background.features, "smv-map-layer smv-map-layer--bg", MAP_FILL_BG);
  }
  if (layout.mapRegion === "burundi") {
    // Provinces non mises en avant : gris discret, sans nom ; les 10 autres : fond normal + étiquette
    const all = layout.regions.features;
    paintRegions(all.filter((f) => f.properties.highlight === false), "smv-map-layer smv-map-layer--bg", MAP_FILL_BG);
    paintRegions(all.filter((f) => f.properties.highlight !== false), "smv-map-layer", MAP_FILL);
  } else {
    paintRegions(layout.regions.features, "smv-map-layer", MAP_FILL);
  }
  if (layout.countryBorders) {
    gBasemap
      .append("path")
      .attr("class", "smv-map-borders")
      .attr("d", layout.path(layout.countryBorders as unknown as GeoPermissibleObjects) ?? "");
  }

  if (layout.mapRegion === "burundi") {
    const labelled = layout.regions.features.filter((f) => f.properties.highlight && f.properties.label);
    const fs = Math.max(8, Math.min(13, layout.innerWidth / 70));
    gBasemap
      .append("g")
      .attr("class", "smv-map-labels")
      .style("pointer-events", "none")
      .selectAll("text")
      .data(labelled)
      .join("text")
      .attr("class", "smv-map-label")
      .attr("data-region", (d) => d.properties.id)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", fs)
      .attr("font-weight", 600)
      .attr("x", (d) => (layout.projection([d.properties.lon ?? 0, d.properties.lat ?? 0]) ?? [0, 0])[0])
      // Au-dessus du point d'ancrage (où se posent les points placés par nom)
      .attr("y", (d) => (layout.projection([d.properties.lon ?? 0, d.properties.lat ?? 0]) ?? [0, 0])[1] - (fs * 0.6 + 7))
      .text((d) => d.properties.label!);
  }

  const regionMode = options.mapMark === "region";
  // Province entière : pas de ronds. Point : ronds dont la taille suit la magnitude.
  if (!regionMode && options.mapHeatmap !== false) {
    gHeat
      .attr("class", "smv-map-heat")
      .selectAll("circle")
      .data(layout.marks as MapMark[], (d) => (d as MapMark).mark.id)
      .join("circle")
      .attr("cx", (d) => d.cx)
      .attr("cy", (d) => d.cy)
      .attr("r", (d) => d.r * 4.5 * layout.markScale)
      .attr("fill", brandForScheme(options.colorScheme).accent)
      .attr("fill-opacity", 0)
      .attr("data-id", (d) => d.mark.id);
  }

  if (!regionMode) {
  const dots = gDots
    .attr("class", "smv-map-dots")
    .selectAll<SVGCircleElement, MapMark>("circle.smv-mark")
    .data(layout.marks as MapMark[], (d) => (d as MapMark).mark.id)
    .join("circle")
    .attr("class", "smv-mark smv-mark--point")
    .attr("cx", (d) => d.cx)
    .attr("cy", (d) => d.cy)
    .attr("r", (d) => d.r)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", 0.88)
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", 0.8)
    .attr("data-id", (d) => d.mark.id)
    .style("opacity", 0);

  onHoverMark(
    dots as unknown as Selection<SVGElement, MapMark, SVGGElement, unknown>
  );
  }
}

/**
 * Apply film-clock frame to map: dots reveal + finale choropleth/heatmap.
 */
export function applyMapFrame(
  ctx: MapPaintContext,
  t: number,
  hoveredId: string | null
): void {
  const { gBasemap, gHeat, gDots, layout, schedule, options } = ctx;
  const zk = ctx.zoomK ?? 1;
  const persistence: PersistenceMode = options.persistence ?? "keep";
  const choroplethOn = options.mapChoropleth !== false;
  const provincesOnly = options.mapMark === "region";
  const heatmapOn = options.mapHeatmap !== false;

  // Per-region revealed magnitude for choropleth
  const revealed = new Map<string, number>();
  for (const mm of layout.marks) {
    const p = effectiveDrawProgress(schedule, mm.mark.id, t, persistence);
    const persist = persistenceFactor(schedule, mm.mark.id, t, persistence);
    if (p > 0.5 && persist > 0.05) {
      revealed.set(
        mm.geo.regionId,
        (revealed.get(mm.geo.regionId) ?? 0) + mm.mark.magnitude
      );
    }
  }
  const maxRegion = Math.max(
    1,
    ...layout.regionTotals.values(),
    ...revealed.values()
  );

  // Finale factor for choropleth / heatmap (also show under keep when t near 1 if finale mode)
  let intensity = provincesOnly ? 1 : 0;
  if (!provincesOnly && (choroplethOn || heatmapOn)) {
    if (persistence === "finale" && t >= FINALE_START) {
      const u = (t - FINALE_START) / Math.max(1e-6, 1 - FINALE_START);
      intensity = u * u * (3 - 2 * u);
    } else if (persistence !== "finale" && t >= 0.88) {
      // Soft late choropleth even in keep/ephemeral so the option is visible
      const u = (t - 0.88) / 0.12;
      intensity = Math.max(0, Math.min(1, u * u * (3 - 2 * u)));
    }
  }

  const scaleVals = [...layout.regionTotals.values()].filter((v) => v > 0);
  const dataMin = scaleVals.length ? Math.min(...scaleVals) : 0;
  const dataMax = maxRegion;
  const scaleMin = options.mapScaleMin != null && Number.isFinite(options.mapScaleMin) ? options.mapScaleMin : dataMin;
  const scaleMax = options.mapScaleMax != null && Number.isFinite(options.mapScaleMax) ? options.mapScaleMax : dataMax;
  const scaleSpan = Math.max(1e-9, scaleMax - scaleMin);
  const sequence = options.mapReveal === "sequence" && provincesOnly;
  const order = sequence
    ? [...layout.regionTotals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    : [];
  const slot = order.length ? 1 / order.length : 1;
  gBasemap.selectAll<SVGPathElement, BasemapFeature>("path.smv-map-region")
    .style("fill", function (d) {
      const base = this.getAttribute("data-base-fill") || MAP_FILL;
      if (!choroplethOn || intensity <= 0.01) return base;
      const v = (provincesOnly ? layout.regionTotals : revealed).get(d.properties.id) ?? 0;
      if (v <= 0) return base;
      if (sequence) {
        const i = order.indexOf(d.properties.id);
        if (i < 0) return base;
        const local = (t - i * slot) / slot;
        if (local <= 0) return base;
        const color = choroplethColor((v - scaleMin) / scaleSpan, options.mapScale ?? "froid-chaud");
        return local >= 1 ? color : color;
      }
      return choroplethColor((v - scaleMin) / scaleSpan, options.mapScale ?? "froid-chaud");
    })
    .style("fill-opacity", function (d) {
      const v = (provincesOnly ? layout.regionTotals : revealed).get(d.properties.id) ?? 0;
      if (!choroplethOn || intensity <= 0.01 || v <= 0) return null;
      if (sequence) {
        const i = order.indexOf(d.properties.id);
        const local = i < 0 ? 0 : (t - i * slot) / slot;
        if (local <= 0) return null;
        return String((0.35 + 0.55 * intensity) * Math.min(1, local));
      }
      return String(0.35 + 0.55 * intensity);
    });

  const scale = options.mapScale ?? "froid-chaud";
  const vals = [...layout.regionTotals.values()].filter((v) => v > 0);
  const vmin = scaleMin;
  const legend = gBasemap.selectAll<SVGGElement, number>("g.smv-map-choropleth-legend").data(choroplethOn && provincesOnly && maxRegion > 0 ? [1] : []);
  legend.exit().remove();
  const lg = legend.enter().append("g").attr("class", "smv-map-choropleth-legend").merge(legend);
  const barW = Math.min(220, layout.innerWidth - 24);
  lg.attr("transform", `translate(12,${layout.height - 58})`);
  const stops = 48;
  lg.selectAll("rect.ramp").data(Array.from({ length: stops }, (_, i) => i)).join("rect").attr("class", "ramp")
    .attr("x", (i) => (i * barW) / stops).attr("y", 16).attr("width", barW / stops + 0.5).attr("height", 14)
    .attr("fill", (i) => choroplethColor(i / (stops - 1), scale));
  const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const ink = options.theme === "light" ? "#1c1917" : "#f4f4f5";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({ p, v: scaleMin + (scaleMax - scaleMin) * p }));
  lg.selectAll("text.tick").data(ticks).join("text").attr("class", "tick")
    .attr("x", (d) => d.p * barW).attr("y", 44).attr("font-size", 11).attr("font-weight", 600).attr("fill", ink)
    .attr("text-anchor", (d) => (d.p === 0 ? "start" : d.p === 1 ? "end" : "middle"))
    .text((d) => fmt(d.v));
  lg.selectAll("text.caption").data([options.magnitudeUnit ? `Échelle · ${options.magnitudeUnit}` : "Échelle"]).join("text").attr("class", "caption")
    .attr("x", 0).attr("y", 10).attr("font-size", 11).attr("font-weight", 700).attr("fill", ink)
    .text((s) => s);

  if (heatmapOn) {
    gHeat.selectAll<SVGCircleElement, MapMark>("circle").each(function (d) {
      const p = effectiveDrawProgress(schedule, d.mark.id, t, persistence);
      const persist = persistenceFactor(schedule, d.mark.id, t, persistence);
      const el = select(this);
      const heatOp =
        intensity * persist * (p > 0 ? 0.08 + 0.14 * p : 0);
      el.attr("fill-opacity", heatOp).attr(
        "r",
        (d.r * (3.5 + 2.5 * intensity) * layout.markScale) / zk
      );
    });
  }

  gDots.selectAll<SVGCircleElement, MapMark>("circle.smv-mark").each(function (d) {
    const p = effectiveDrawProgress(schedule, d.mark.id, t, persistence);
    const persist = persistenceFactor(schedule, d.mark.id, t, persistence);
    const el = select(this);
    const r = Math.max(
      0.5,
      d.r * (options.entrance === false ? p : 0.35 + 0.65 * p)
    ) / zk;
    const op = (p > 0 ? 0.55 + 0.4 * p : 0) * persist;
    el.attr("r", r)
      .attr("stroke-width", 0.8 / zk)
      .style("opacity", String(op))
      .attr(
        "transform",
        options.entrance === false || p <= 0
          ? null
          : `translate(${d.cx}, ${d.cy}) scale(${0.7 + 0.3 * p}) translate(${-d.cx}, ${-d.cy})`
      );
    const visible = p > 0 && persist > 0.02;
    el.classed(
      "smv-mark--dim",
      hoveredId != null && hoveredId !== d.mark.id && visible
    );
    el.classed("smv-mark--active", hoveredId === d.mark.id);
  });
}

export function mapAnnotationTargets(
  layout: MapLayout,
  schedule: RevealSchedule,
  t: number,
  slowFirst: number,
  persistence: PersistenceMode
): Array<{ x: number; y: number; label: string; opacity: number }> {
  const out: Array<{ x: number; y: number; label: string; opacity: number }> =
    [];
  if (t >= 0.32) return out;
  for (const e of schedule.entries.slice(0, slowFirst)) {
    const p = markProgress(schedule, e.id, t);
    const persist = persistenceFactor(schedule, e.id, t, persistence);
    if (p <= 0 || persist <= 0.05) continue;
    const mm = layout.marks.find((m) => m.mark.id === e.id);
    if (!mm) continue;
    out.push({
      x: mm.cx,
      y: mm.cy - mm.r - 10,
      label: mm.mark.label,
      opacity: Math.min(1, p * 1.4) * persist,
    });
  }
  return out;
}
