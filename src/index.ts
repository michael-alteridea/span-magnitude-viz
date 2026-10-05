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
  tickerAt,
  prefersReducedMotion,
} from "./animate.js";
export { mountSvg } from "./render/svg.js";

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
