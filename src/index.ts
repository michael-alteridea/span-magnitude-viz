import { parseDocument, tryParseDocument } from "./parse.js";
import { mountSvg } from "./render/svg.js";
import type {
  NormalizedDocument,
  SpanMagnitudeDocument,
  VizHandle,
  VizOptions,
} from "./types.js";

export type {
  SpanUnit,
  GeometryMode,
  PersistenceMode,
  ViewMode,
  MapRegion,
  MapLevel,
  ColorByField,
  TickerKind,
  SpanEndpoints,
  SpanMark,
  SpanMagnitudeDefaults,
  SpanMagnitudeDocument,
  NormalizedMark,
  NormalizedDocument,
  LayoutMark,
  VizOptions,
  TickerState,
  VizHandle,
} from "./types.js";

export { ParseError } from "./types.js";
export { parseDocument, tryParseDocument } from "./parse.js";
export {
  computeLayout,
  arcPath,
  formatMagnitude,
  formatAxisValue,
  formatSpanRange,
} from "./layout.js";
export {
  buildRevealSchedule,
  createAnimation,
  markProgress,
  persistenceFactor,
  effectiveDrawProgress,
  FINALE_START,
  tickerAt,
  prefersReducedMotion,
} from "./animate.js";
export { mountSvg } from "./render/svg.js";

export {
  ALTAIRADY_REDS,
  ALTERIDEA_REDS,
  WARM_PALETTE,
  COLD_HOT,
  BRAND,
  resolveMarkColor,
  discoverColorByAxes,
} from "./colors.js";

export {
  computeFacetSummaries,
  computeYearSummaries,
  yearsForMark,
  keysForMark,
  discoverFacetAxes,
  defaultFacetBy,
  resolveFacetBy,
  quantileSorted,
  formatAvgSpan,
  createFacetSummaryDom,
} from "./facetSummary.js";

export type {
  FacetAxis,
  FacetSummaryRow,
  FacetQuartileArc,
  FacetSummaryElements,
  FacetSummaryDomOptions,
} from "./facetSummary.js";

/**
 * Create a span-magnitude visualization inside `container`.
 *
 * @param container - DOM element to mount into (contents replaced)
 * @param document - Raw or already-normalized span-magnitude document
 * @param options - Visual / interaction options
 */
export function createSpanMagnitudeViz(
  container: HTMLElement,
  document: SpanMagnitudeDocument | NormalizedDocument | unknown,
  options: VizOptions = {}
): VizHandle {
  const doc =
    document &&
    typeof document === "object" &&
    Array.isArray((document as NormalizedDocument).xDomain)
      ? (document as NormalizedDocument)
      : parseDocument(document);

  return mountSvg(container, doc, options);
}

/** Alias matching DESIGN.md sketch. */
export const mount = createSpanMagnitudeViz;

export default createSpanMagnitudeViz;

export {
  parseCsv,
  parseDelimited,
  parseDelimitedMatrix,
  detectDelimiter,
  matrixToRows,
  guessMapping,
  isIdLikeColumnName,
  rowsToDocument,
  columnsFromRows,
  analyzeColumns,
  validateMapping,
  rememberMapping,
  loadRememberedMapping,
  resolveInitialMapping,
  computeSpanPreview,
  spanPreviewFormulaFr,
  formatSpanLengthFr,
  FIELD_ROLES,
  FIELD_ROLE_LABELS_FR,
} from "./fileImport.js";
export type {
  ColumnMapping,
  ImportDocumentOptions,
  DetectedType,
  Suitability,
  FieldRole,
  RoleSuitability,
  ColumnAnalysis,
  MappingValidation,
  SpanPreviewMode,
  SpanPreviewStats,
} from "./fileImport.js";

export {
  lookupPostal,
  lookupLatLon,
  resolveMarkGeo,
  normalizePostal,
  frDepartmentFromPostal,
  beProvinceFromPostal,
} from "./geo/postalLookup.js";
export type { GeoPoint } from "./geo/postalLookup.js";
export { documentHasGeo, marksWithGeo, computeMapLayout } from "./render/map.js";
export {
  europeLayer,
  europeRegionIdAt,
  featureAtPoint,
  EUROPE_ATTRIBUTION_EN,
  EUROPE_ATTRIBUTION_FR,
} from "./geo/europe.js";
export type { EuropeFeature, EuropeCollection, EuropeRegionProps } from "./geo/europe.js";
