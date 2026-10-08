import { axisBottom, scaleLinear, select } from "d3";
import type { Selection } from "d3";
import {
  computeLayout,
  type LayoutResult,
} from "../layout.js";
import {
  buildRevealSchedule,
  createAnimation,
  effectiveDrawProgress,
  markProgress,
  persistenceFactor,
  prefersReducedMotion,
  tickerAt,
  type AnimationController,
  type RevealSchedule,
} from "../animate.js";
import { formatAxisValueLocale, formatSpanRangeLocale, magnitudeFormatter } from "../numberFormat.js";
import {
  createTickerDom,
  updateTickers,
  TICKER_CSS,
  type TickerElements,
} from "../tickers.js";
import {
  createFacetSummaryDom,
  FACET_SUMMARY_CSS,
  type FacetSummaryElements,
} from "../facetSummary.js";
import type {
  GeometryMode,
  LayoutMark,
  NormalizedDocument,
  NormalizedMark,
  PersistenceMode,
  SpanMagnitudeDocument,
  TickerKind,
  TickerState,
  ViewMode,
  VizHandle,
  VizOptions,
} from "../types.js";
import { parseDocument } from "../parse.js";
import {
  applyMapFrame,
  computeMapLayout,
  documentHasGeo,
  mapAnnotationTargets,
  mapLayerCss,
  paintMapLayers,
  paintScaleBar,
  type MapLayout,
  type MapMark,
  type MapPaintContext,
} from "./map.js";

const THEME_CSS = `
.smv-root {
  position: relative;
  width: 100%;
  overflow: hidden;
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  border-radius: 8px;
}
.smv-root--dark {
  background: #0b0b0c;
  color: #f4f4f5;
}
.smv-root--light {
  background: #fafaf9;
  color: #1c1917;
}
.smv-root svg {
  display: block;
  width: 100%;
  height: auto;
}
.smv-mark {
  cursor: pointer;
  transition: opacity 120ms ease, filter 120ms ease;
}
.smv-mark--point {
  transition: opacity 160ms ease, filter 120ms ease;
}
.smv-mark--dim { opacity: 0.15 !important; }
.smv-mark--active {
  filter: brightness(1.35) drop-shadow(0 0 6px rgba(214, 40, 57, 0.55));
}
.smv-axis path, .smv-axis line { stroke: #57534e; }
.smv-axis text { fill: #a8a29e; font-size: 11px; }
.smv-baseline { stroke: #44403c; stroke-width: 1; }
.smv-annotation text {
  fill: #f4a0a8;
  font-size: 11px;
  pointer-events: none;
}
.smv-tooltip {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  max-width: 280px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0;
  transition: opacity 100ms ease;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
}
.smv-root--dark .smv-tooltip {
  background: #1c1917;
  border: 1px solid #44403c;
  color: #fafaf9;
}
.smv-root--light .smv-tooltip {
  background: #fff;
  border: 1px solid #d6d3d1;
  color: #1c1917;
}
.smv-tooltip.visible { opacity: 1; }
.smv-tooltip-title { font-weight: 600; margin-bottom: 4px; color: #e9374a; }
.smv-tooltip-row { opacity: 0.85; }
.smv-tooltip-meta { margin-top: 6px; opacity: 0.7; font-size: 11px; }
.smv-chart-title {
  position: absolute;
  bottom: 10px;
  left: 16px;
  font-size: 12px;
  opacity: 0.45;
  pointer-events: none;
}
.smv-marks-layer {
  transition: opacity 80ms linear;
}
.smv-marks--morphing-out {
  opacity: 0;
  transition: opacity var(--smv-morph-ms, 550ms) ease;
}
.smv-marks--morphing-in {
  opacity: 0;
}
.smv-marks--morphing-in.smv-marks--morph-visible {
  opacity: 1;
  transition: opacity var(--smv-morph-ms, 550ms) ease;
}
.smv-root--entrance .smv-chart-area {
  opacity: 0;
  transform: scale(0.985);
}
.smv-root--entrance-ready .smv-chart-area {
  opacity: 1;
  transform: scale(1);
  transition: opacity 480ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  .smv-marks--morphing-out,
  .smv-marks--morphing-in,
  .smv-marks--morphing-in.smv-marks--morph-visible,
  .smv-root--entrance .smv-chart-area,
  .smv-root--entrance-ready .smv-chart-area {
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
`;

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("smv-styles")) return;
  const style = document.createElement("style");
  style.id = "smv-styles";
  style.textContent = THEME_CSS + TICKER_CSS + FACET_SUMMARY_CSS + mapLayerCss();
  document.head.appendChild(style);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filterMarks(
  doc: NormalizedDocument,
  options: VizOptions
): NormalizedMark[] {
  if (options.cohortFilter) {
    return doc.marks.filter((m) => m.cohort === options.cohortFilter);
  }
  return doc.marks;
}

function resolveTickers(
  doc: NormalizedDocument,
  options: VizOptions
): TickerKind[] {
  if (options.tickers === false) return [];
  if (Array.isArray(options.tickers)) return options.tickers;
  return doc.defaults.tickers;
}

function isNormalized(doc: unknown): doc is NormalizedDocument {
  return (
    !!doc &&
    typeof doc === "object" &&
    Array.isArray((doc as NormalizedDocument).marks) &&
    Array.isArray((doc as NormalizedDocument).xDomain)
  );
}

export function mountSvg(
  container: HTMLElement,
  docInput: NormalizedDocument | SpanMagnitudeDocument,
  options: VizOptions = {}
): VizHandle {
  ensureStyles();

  let currentDoc: NormalizedDocument = isNormalized(docInput)
    ? docInput
    : parseDocument(docInput);
  let currentOpts: VizOptions = { ...options };
  const theme = currentOpts.theme ?? "dark";

  const root = document.createElement("div");
  root.className = `smv-root smv-root--${theme}`;
  container.innerHTML = "";
  container.appendChild(root);

  let layout!: LayoutResult;
  let schedule!: RevealSchedule;
  let anim: AnimationController | null = null;
  let tickerEls: TickerElements | null = null;
  let gMarks!: Selection<SVGGElement, unknown, null, undefined>;
  let hoveredId: string | null = null;
  let mapLayout: MapLayout | null = null;
  let mapCtx: MapPaintContext | null = null;
  let viewMode: ViewMode = currentOpts.viewMode ?? "chart";

  const tooltip = document.createElement("div");
  tooltip.className = "smv-tooltip";
  tooltip.setAttribute("role", "tooltip");
  root.appendChild(tooltip);

  const chartArea = document.createElement("div");
  chartArea.className = "smv-chart-area";
  root.appendChild(chartArea);

  const titleEl = document.createElement("div");
  titleEl.className = "smv-chart-title";
  chartArea.appendChild(titleEl);

  let facetSummaryEls: FacetSummaryElements | null = null;

  function showTooltip(lm: { mark: NormalizedMark }, event: MouseEvent): void {
    const m = lm.mark;
    const geoBits: string[] = [];
    const lat = m.meta.lat ?? m.meta.latitude;
    const lon = m.meta.lon ?? m.meta.lng ?? m.meta.longitude;
    const postal = m.meta.postal ?? m.meta.code_postal ?? m.meta.postalCode;
    if (postal != null && String(postal) !== "") geoBits.push(`CP ${escapeHtml(String(postal))}`);
    if (lat != null && lon != null) geoBits.push(`${escapeHtml(String(lat))}, ${escapeHtml(String(lon))}`);
    const colon = currentOpts.locale === "fr" ? "\u00a0: " : ": ";
    const metaRows = Object.entries(m.meta)
      .filter(([k]) => !["lat","lon","lng","latitude","longitude","postal","postalCode","code_postal","codePostal","zip","ZIP","cp"].includes(k))
      .map(
        ([k, v]) =>
          `<div>${escapeHtml(k)}${colon}${escapeHtml(String(v))}</div>`
      )
      .join("");
    tooltip.innerHTML = `
      <div class="smv-tooltip-title">${escapeHtml(m.label)}</div>
      <div class="smv-tooltip-row">${escapeHtml(currentDoc.spanLabel)}${colon}${escapeHtml(formatSpanRangeLocale(m.start, m.end, currentDoc.unit, currentOpts.locale))}</div>
      <div class="smv-tooltip-row">${escapeHtml(currentDoc.magnitudeLabel)}${colon}${escapeHtml(magnitudeFormatter(currentOpts)(m.magnitude))}</div>
      <div class="smv-tooltip-row">${currentOpts.locale === "fr" ? `Cohorte : ${escapeHtml(m.cohort)} · Groupe : ${escapeHtml(m.group)}` : `Cohort: ${escapeHtml(m.cohort)} · Group: ${escapeHtml(m.group)}`}</div>
      ${geoBits.length ? `<div class="smv-tooltip-row">${geoBits.join(" · ")}</div>` : ""}
      ${metaRows ? `<div class="smv-tooltip-meta">${metaRows}</div>` : ""}
    `;
    tooltip.classList.add("visible");
    const rect = root.getBoundingClientRect();
    const x = event.clientX - rect.left + 12;
    const y = event.clientY - rect.top + 12;
    tooltip.style.left = `${Math.min(x, rect.width - 290)}px`;
    tooltip.style.top = `${Math.min(y, rect.height - 120)}px`;
  }

  function hideTooltip(): void {
    tooltip.classList.remove("visible");
  }

  function bindHover(sel: Selection<SVGElement, any, SVGGElement, unknown>): void {
    sel
      .on("mouseenter", function (event, d) {
        hoveredId = d.mark.id;
        showTooltip(d, event as MouseEvent);
        currentOpts.onHover?.(d.mark, event as MouseEvent);
        const t = anim?.getProgress() ?? 1;
        applyFrame(t, tickerAt(schedule, t));
      })
      .on("mousemove", function (event, d) {
        showTooltip(d, event as MouseEvent);
      })
      .on("mouseleave", function () {
        hoveredId = null;
        hideTooltip();
        currentOpts.onHover?.(null);
        const t = anim?.getProgress() ?? 1;
        applyFrame(t, tickerAt(schedule, t));
      })
      .on("click", function (_event, d) {
        currentOpts.onSelect?.(d.mark);
      });
  }

  function applyFrame(t: number, state: TickerState): void {
    const slowFirst = currentOpts.slowFirst ?? 2;
    const persistence: PersistenceMode = currentOpts.persistence ?? "keep";

    if (viewMode === "map" && mapCtx && mapLayout) {
      applyMapFrame(mapCtx, t, hoveredId);
      gMarks.selectAll(".smv-annotation").remove();
      for (const ann of mapAnnotationTargets(
        mapLayout,
        schedule,
        t,
        slowFirst,
        persistence
      )) {
        gMarks
          .append("g")
          .attr("class", "smv-annotation")
          .attr("opacity", ann.opacity)
          .append("text")
          .attr("x", ann.x)
          .attr("y", ann.y)
          .attr("text-anchor", "middle")
          .text(ann.label);
      }
      if (tickerEls) updateTickers(tickerEls, state, currentDoc.unit, currentOpts);
      currentOpts.onTick?.(state);
      return;
    }

    if (!gMarks) return;

    gMarks.selectAll<SVGElement, LayoutMark>(".smv-mark").each(function (d) {
      const p = effectiveDrawProgress(schedule, d.mark.id, t, persistence);
      const persist = persistenceFactor(schedule, d.mark.id, t, persistence);
      const el = select(this);
      if (layout.geometry === "arc") {
        const path = this as unknown as SVGPathElement;
        let len = 200;
        try {
          len = path.getTotalLength();
        } catch {
          /* ignore */
        }
        const baseOp = p > 0 ? 0.38 + 0.37 * p : 0;
        el.attr("stroke-dasharray", `${len}`)
          .attr("stroke-dashoffset", `${len * (1 - p)}`)
          .style("opacity", String(baseOp * persist))
          .attr("stroke-width", d.strokeWidth * (0.25 + 0.75 * p))
          .attr(
            "transform",
            currentOpts.entrance === false || p <= 0
              ? null
              : `translate(${(d.x0 + d.x1) / 2}, ${d.yBase}) scale(${0.92 + 0.08 * p}) translate(${-(d.x0 + d.x1) / 2}, ${-d.yBase})`
          );
      } else if (layout.geometry === "point") {
        const r = Math.max(0.4, d.point.r * (currentOpts.entrance === false ? p : 0.35 + 0.65 * p));
        const op = (p > 0 ? 0.55 + 0.4 * p : 0) * persist;
        el.attr("r", r)
          .attr("stroke-width", d.point.strokeWidth * (0.4 + 0.6 * p))
          .style("opacity", String(op))
          .attr(
            "transform",
            currentOpts.entrance === false || p <= 0
              ? null
              : `translate(${d.point.cx}, ${d.point.cy}) scale(${0.7 + 0.3 * p}) translate(${-d.point.cx}, ${-d.point.cy})`
          );
      } else {
        const barOp =
          (currentOpts.entrance === false ? p : Math.min(1, p * 1.05)) * persist;
        el.style("opacity", String(barOp))
          .attr("width", Math.max(1, d.bar.width * Math.max(p, 0.001)))
          .attr("height", Math.max(0.5, d.bar.height * (0.85 + 0.15 * p)));
      }
      const visible = p > 0 && persist > 0.02;
      el.classed("smv-mark--dim", hoveredId != null && hoveredId !== d.mark.id && visible);
      el.classed("smv-mark--active", hoveredId === d.mark.id);
    });

    gMarks.selectAll(".smv-annotation").remove();
    const annotateGeom =
      layout.geometry === "arc" || layout.geometry === "point";
    if (t < 0.32 && annotateGeom) {
      schedule.entries.slice(0, slowFirst).forEach((e) => {
        const p = markProgress(schedule, e.id, t);
        const persist = persistenceFactor(schedule, e.id, t, persistence);
        if (p <= 0 || persist <= 0.05) return;
        const lm = layout.marks.find((m) => m.mark.id === e.id);
        if (!lm) return;
        let mx: number;
        let my: number;
        if (layout.geometry === "point") {
          mx = lm.point.cx;
          my = lm.point.cy - lm.point.r - 10;
        } else {
          mx = (lm.x0 + lm.x1) / 2;
          my = lm.yBase - lm.bulge * lm.side - 10 * lm.side;
        }
        gMarks
          .append("g")
          .attr("class", "smv-annotation")
          .attr("opacity", Math.min(1, p * 1.4) * persist)
          .append("text")
          .attr("x", mx)
          .attr("y", my)
          .attr("text-anchor", "middle")
          .text(lm.mark.label);
      });
    }

    if (tickerEls) updateTickers(tickerEls, state, currentDoc.unit, currentOpts);
    currentOpts.onTick?.(state);
  }

  function rebuild(opts: { preserveProgress?: number; runEntrance?: boolean } = {}): void {
    anim?.destroy();
    anim = null;
    chartArea.querySelector("svg")?.remove();
    tickerEls?.root.remove();
    tickerEls = null;
    facetSummaryEls?.root.remove();
    facetSummaryEls = null;
    hoveredId = null;
    hideTooltip();

    viewMode = currentOpts.viewMode ?? "chart";
    mapLayout = null;
    mapCtx = null;

    const visible = filterMarks(currentDoc, currentOpts);
    const mapVisible =
      viewMode === "map"
        ? visible.filter((m) => {
            // layout filter via computeMapLayout / marksWithGeo
            return true;
          })
        : visible;

    if (viewMode === "map") {
      mapLayout = computeMapLayout(currentDoc, currentOpts, mapVisible);
      // Reveal only geocoded marks so tickers match dots
      const geoMarks = mapLayout.marks.map((m) => m.mark);
      schedule = buildRevealSchedule(geoMarks, {
        durationMs: currentOpts.durationMs,
        slowFirst: currentOpts.slowFirst ?? 2,
        slowOpen: currentOpts.slowOpen,
        cascadeSpeed: currentOpts.cascadeSpeed,
      });
      // Keep a dummy chart layout for morph helpers
      layout = computeLayout(currentDoc, { ...currentOpts, geometry: "point" }, geoMarks.length ? geoMarks : visible);

      root.style.width = "100%";
      root.style.maxWidth = `${mapLayout.width}px`;
      titleEl.textContent = currentDoc.title || "";

      const kinds = resolveTickers(currentDoc, currentOpts);
      if (kinds.length) {
        tickerEls = createTickerDom(root, currentDoc, kinds, theme, currentOpts);
      }

      const svg = select(chartArea)
        .append("svg")
        .attr("viewBox", `0 0 ${mapLayout.width} ${mapLayout.height}`)
        .attr("width", mapLayout.width)
        .attr("height", mapLayout.height)
        .attr("role", "img")
        .attr(
          "aria-label",
          (currentDoc.title || "Span-magnitude map") +
            (mapLayout.mapRegion === "europe" ? " — Europe" : " — France / Belgique")
        );

      const g = svg
        .append("g")
        .attr(
          "transform",
          `translate(${mapLayout.margin.left},${mapLayout.margin.top})`
        );

      const gBasemap = g.append("g").attr("class", "smv-map-basemap");
      // Keep the soft heat halos inside the map frame (no bleed over caption / attribution)
      const clipId = `smv-map-clip-${Math.random().toString(36).slice(2, 9)}`;
      g.append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", mapLayout.innerWidth)
        .attr("height", mapLayout.innerHeight);
      const gHeat = g
        .append("g")
        .attr("class", "smv-map-heat")
        .attr("clip-path", `url(#${clipId})`);
      gMarks = g.append("g").attr("class", "smv-marks smv-marks-layer smv-map-dots");
      // annotations share gMarks parent; paintMapLayers uses separate gDots — reassign
      const gDots = gMarks;

      mapCtx = {
        gBasemap,
        gHeat,
        gDots,
        layout: mapLayout,
        schedule,
        options: currentOpts,
        onHoverMark: (sel) =>
          bindHover(
            sel as unknown as Selection<
              SVGElement,
              { mark: NormalizedMark },
              SVGGElement,
              unknown
            >
          ),
      };
      paintMapLayers(mapCtx);
      // Every map carries a km scale bar matching the current projection / framing
      paintScaleBar(g, mapLayout, (currentOpts.theme ?? "dark") === "light");

      g.append("text")
        .attr("x", mapLayout.innerWidth / 2)
        .attr("y", mapLayout.innerHeight + 22)
        .attr("text-anchor", "middle")
        .attr("fill", "#78716c")
        .attr("font-size", 11)
        .text(mapLayout.caption);
      if (mapLayout.attribution) {
        g.append("text")
          .attr("class", "smv-map-attribution")
          .attr("x", mapLayout.innerWidth)
          .attr("y", mapLayout.innerHeight + 34)
          .attr("text-anchor", "end")
          .text(mapLayout.attribution);
      }
    } else {
      layout = computeLayout(currentDoc, currentOpts, visible);
      schedule = buildRevealSchedule(visible, {
        durationMs: currentOpts.durationMs,
        slowFirst: currentOpts.slowFirst ?? 2,
        slowOpen: currentOpts.slowOpen,
        cascadeSpeed: currentOpts.cascadeSpeed,
      });

      root.style.width = "100%";
      root.style.maxWidth = `${layout.width}px`;
      titleEl.textContent = currentDoc.title || "";

      const kinds = resolveTickers(currentDoc, currentOpts);
      if (kinds.length) {
        tickerEls = createTickerDom(root, currentDoc, kinds, theme, currentOpts);
      }

      const svg = select(chartArea)
        .append("svg")
        .attr("viewBox", `0 0 ${layout.width} ${layout.height}`)
        .attr("width", layout.width)
        .attr("height", layout.height)
        .attr("role", "img")
        .attr("aria-label", currentDoc.title || "Span-magnitude visualization");

      const g = svg
        .append("g")
        .attr("transform", `translate(${layout.margin.left},${layout.margin.top})`);

      g.append("line")
        .attr("class", "smv-baseline")
        .attr("x1", 0)
        .attr("x2", layout.innerWidth)
        .attr("y1", layout.yBase)
        .attr("y2", layout.yBase);

      const xAxisScale = scaleLinear()
        .domain(layout.xDomain)
        .range([0, layout.innerWidth]);

      g.append("g")
        .attr("class", "smv-axis")
        .attr("transform", `translate(0,${layout.innerHeight})`)
        .call(
          axisBottom(xAxisScale)
            .ticks(8)
            .tickFormat((d) => formatAxisValueLocale(Number(d), currentDoc.unit, currentOpts.locale))
        );

      g.append("text")
        .attr("x", layout.innerWidth / 2)
        .attr("y", layout.innerHeight + 36)
        .attr("text-anchor", "middle")
        .attr("fill", "#78716c")
        .attr("font-size", 11)
        .text(currentDoc.spanLabel);

      gMarks = g.append("g").attr("class", "smv-marks smv-marks-layer");
      paintMarks(gMarks, layout);

      const facetEnabled =
        currentOpts.facetSummary !== false && currentOpts.yearSummary !== false;
      if (facetEnabled) {
        facetSummaryEls = createFacetSummaryDom(
          root,
          currentDoc,
          visible,
          theme,
          {
            facetBy: currentOpts.facetBy,
            onFacetChange: (key) => {
              currentOpts.facetBy = key;
            },
          }
        );
      }
    }

    const shouldAnimate =
      (currentOpts.animate ?? currentDoc.defaults.animate) &&
      !prefersReducedMotion();

    anim = createAnimation(schedule, applyFrame, () =>
      currentOpts.onComplete?.()
    );

    if (opts.preserveProgress != null) {
      anim.setProgress(opts.preserveProgress);
    } else if (shouldAnimate && (currentOpts.autoplay ?? true)) {
      anim.play();
    } else {
      anim.setProgress(1);
    }

    if (opts.runEntrance && currentOpts.entrance !== false && !prefersReducedMotion()) {
      root.classList.add("smv-root--entrance");
      requestAnimationFrame(() => {
        root.classList.add("smv-root--entrance-ready");
        window.setTimeout(() => {
          root.classList.remove("smv-root--entrance", "smv-root--entrance-ready");
        }, 600);
      });
    }
  }

  function paintMarks(
    target: Selection<SVGGElement, unknown, null, undefined>,
    lay: LayoutResult
  ): void {
    target.selectAll("*").remove();
    if (lay.geometry === "arc") {
      const paths = target
        .selectAll<SVGPathElement, LayoutMark>("path.smv-mark")
        .data(lay.marks, (d) => d.mark.id)
        .join("path")
        .attr("class", "smv-mark")
        .attr("d", (d) => d.pathD)
        .attr("fill", "none")
        .attr("stroke", (d) => d.color)
        .attr("stroke-linecap", "round")
        .attr("stroke-width", (d) => d.strokeWidth)
        .attr("data-id", (d) => d.mark.id);
      bindHover(paths as unknown as Selection<SVGElement, LayoutMark, SVGGElement, unknown>);
    } else if (lay.geometry === "point") {
      const strokeMode = currentOpts.pointStyle === "stroke";
      const circles = target
        .selectAll<SVGCircleElement, LayoutMark>("circle.smv-mark")
        .data(lay.marks, (d) => d.mark.id)
        .join("circle")
        .attr("class", "smv-mark smv-mark--point")
        .attr("cx", (d) => d.point.cx)
        .attr("cy", (d) => d.point.cy)
        .attr("r", (d) => d.point.r)
        .attr("fill", (d) => d.color)
        .attr("fill-opacity", strokeMode ? 0.22 : 0.82)
        .attr("stroke", (d) => d.color)
        .attr("stroke-width", (d) => d.point.strokeWidth)
        .attr("data-id", (d) => d.mark.id);
      bindHover(circles as unknown as Selection<SVGElement, LayoutMark, SVGGElement, unknown>);
    } else {
      const rects = target
        .selectAll<SVGRectElement, LayoutMark>("rect.smv-mark")
        .data(lay.marks, (d) => d.mark.id)
        .join("rect")
        .attr("class", "smv-mark")
        .attr("x", (d) => d.bar.x)
        .attr("y", (d) => d.bar.y)
        .attr("width", (d) => d.bar.width)
        .attr("height", (d) => d.bar.height)
        .attr("rx", 2)
        .attr("fill", (d) => d.color)
        .attr("fill-opacity", 0.78)
        .attr("data-id", (d) => d.mark.id);
      bindHover(rects as unknown as Selection<SVGElement, LayoutMark, SVGGElement, unknown>);
    }
  }

  let morphTimer = 0;

  function normalizeGeom(mode: GeometryMode | undefined): GeometryMode {
    if (mode === "lane") return "bar";
    return mode ?? "arc";
  }

  function morphGeometry(mode: GeometryMode): void {
    if (viewMode === "map") {
      currentOpts.geometry = mode;
      return;
    }
    const currentMode = normalizeGeom(layout?.geometry ?? currentOpts.geometry);
    const nextMode = normalizeGeom(mode);
    if (currentMode === nextMode) {
      currentOpts.geometry = mode;
      return;
    }
    currentOpts.geometry = mode;
    const morphMs = Math.max(200, Math.min(1200, currentOpts.morphDurationMs ?? 550));
    root.style.setProperty("--smv-morph-ms", `${morphMs}ms`);

    if (prefersReducedMotion() || !gMarks) {
      rebuild({ preserveProgress: anim?.getProgress() ?? 1 });
      return;
    }

    const progress = anim?.getProgress() ?? 1;
    anim?.pause();
    if (morphTimer) window.clearTimeout(morphTimer);

    const visible = filterMarks(currentDoc, currentOpts);
    const nextLayout = computeLayout(currentDoc, currentOpts, visible);
    const parentNode = gMarks.node()?.parentNode as SVGGElement | null;
    if (!parentNode) {
      layout = nextLayout;
      rebuild({ preserveProgress: progress });
      return;
    }

    const oldMarks = gMarks;
    oldMarks
      .attr("class", "smv-marks smv-marks-layer smv-marks--morphing-out")
      .style("pointer-events", "none");

    gMarks = select(parentNode)
      .append("g")
      .attr("class", "smv-marks smv-marks-layer smv-marks--morphing-in");

    layout = nextLayout;
    paintMarks(gMarks, layout);
    applyFrame(progress, tickerAt(schedule, progress));

    requestAnimationFrame(() => {
      gMarks.classed("smv-marks--morph-visible", true);
    });

    morphTimer = window.setTimeout(() => {
      oldMarks.remove();
      gMarks
        .attr("class", "smv-marks smv-marks-layer")
        .classed("smv-marks--morphing-in", false)
        .classed("smv-marks--morph-visible", false);
      applyFrame(progress, tickerAt(schedule, progress));
      morphTimer = 0;
    }, morphMs + 30);
  }

  function rebuildColors(): void {
    const progress = anim?.getProgress() ?? 1;
    if (viewMode === "map") {
      rebuild({ preserveProgress: progress });
      return;
    }
    const visible = filterMarks(currentDoc, currentOpts);
    layout = computeLayout(currentDoc, currentOpts, visible);
    if (gMarks) {
      paintMarks(gMarks, layout);
      applyFrame(progress, tickerAt(schedule, progress));
    } else {
      rebuild({ preserveProgress: progress });
    }
  }

  rebuild({ runEntrance: true });

  return {
    play() {
      anim?.play();
    },
    pause() {
      anim?.pause();
    },
    reset() {
      anim?.reset();
      if (currentOpts.autoplay ?? true) anim?.play();
    },
    setGeometry(mode: GeometryMode) {
      morphGeometry(mode);
    },
    setPersistence(mode: PersistenceMode) {
      currentOpts.persistence = mode;
      rebuild({ preserveProgress: anim?.getProgress() ?? 0 });
      if ((currentOpts.autoplay ?? true) && (anim?.getProgress() ?? 0) < 1) {
        anim?.play();
      }
    },
    setColorBy(colorBy) {
      currentOpts.colorBy = colorBy;
      rebuildColors();
    },
    setColorScheme(scheme) {
      currentOpts.colorScheme = scheme;
      rebuildColors();
    },
    setFilter(opts) {
      if ("cohort" in opts) currentOpts.cohortFilter = opts.cohort ?? null;
      if ("mirrorSplit" in opts)
        currentOpts.mirrorSplit = opts.mirrorSplit ?? false;
      if ("mirrorCohort" in opts)
        currentOpts.mirrorCohort = opts.mirrorCohort ?? null;
      rebuild();
    },
    setFacetBy(facetBy) {
      currentOpts.facetBy = facetBy;
      rebuild();
    },
    setViewMode(mode) {
      currentOpts.viewMode = mode;
      viewMode = mode;
      rebuild({ runEntrance: true });
    },
    setMap(opts) {
      if (opts.region) currentOpts.mapRegion = opts.region;
      if (opts.level) currentOpts.mapLevel = opts.level;
      if (opts.fit) currentOpts.mapFit = opts.fit;
      if (viewMode !== "map") return;
      const progress = anim?.getProgress() ?? 1;
      rebuild({ preserveProgress: progress });
      if ((currentOpts.autoplay ?? true) && progress < 1) anim?.play();
    },
    setProgress(t: number) {
      anim?.pause();
      anim?.setProgress(t);
    },
    getState() {
      return tickerAt(schedule, anim?.getProgress() ?? 1);
    },
    destroy() {
      if (morphTimer) window.clearTimeout(morphTimer);
      anim?.destroy();
      root.remove();
    },
    update(nextDoc, nextOpts) {
      currentDoc = isNormalized(nextDoc)
        ? nextDoc
        : parseDocument(nextDoc);
      if (nextOpts) currentOpts = { ...currentOpts, ...nextOpts };
      rebuild();
    },
  };
}
