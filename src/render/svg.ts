import { axisBottom, scaleLinear, select } from "d3";
import type { Selection } from "d3";
import {
  computeLayout,
  formatAxisValue,
  formatMagnitude,
  formatSpanRange,
  type LayoutResult,
} from "../layout.js";
import {
  buildRevealSchedule,
  createAnimation,
  markProgress,
  prefersReducedMotion,
  tickerAt,
  type AnimationController,
  type RevealSchedule,
} from "../animate.js";
import {
  createTickerDom,
  updateTickers,
  TICKER_CSS,
  type TickerElements,
} from "../tickers.js";
import type {
  GeometryMode,
  LayoutMark,
  NormalizedDocument,
  NormalizedMark,
  SpanMagnitudeDocument,
  TickerKind,
  TickerState,
  VizHandle,
  VizOptions,
} from "../types.js";
import { parseDocument } from "../parse.js";

const THEME_CSS = `
.smv-root {
  position: relative;
  width: 100%;
  overflow: hidden;
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  border-radius: 8px;
}
.smv-root--dark {
  background: #0c0b09;
  color: #e7e5e4;
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
.smv-mark--dim { opacity: 0.15 !important; }
.smv-mark--active {
  filter: brightness(1.4) drop-shadow(0 0 5px rgba(245, 166, 35, 0.6));
}
.smv-axis path, .smv-axis line { stroke: #57534e; }
.smv-axis text { fill: #a8a29e; font-size: 11px; }
.smv-baseline { stroke: #44403c; stroke-width: 1; }
.smv-annotation text {
  fill: #fde68a;
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
.smv-tooltip-title { font-weight: 600; margin-bottom: 4px; color: #f5a623; }
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
`;

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("smv-styles")) return;
  const style = document.createElement("style");
  style.id = "smv-styles";
  style.textContent = THEME_CSS + TICKER_CSS;
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

  const tooltip = document.createElement("div");
  tooltip.className = "smv-tooltip";
  tooltip.setAttribute("role", "tooltip");
  root.appendChild(tooltip);

  const titleEl = document.createElement("div");
  titleEl.className = "smv-chart-title";
  root.appendChild(titleEl);

  function showTooltip(lm: LayoutMark, event: MouseEvent): void {
    const m = lm.mark;
    const metaRows = Object.entries(m.meta)
      .map(
        ([k, v]) =>
          `<div>${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`
      )
      .join("");
    tooltip.innerHTML = `
      <div class="smv-tooltip-title">${escapeHtml(m.label)}</div>
      <div class="smv-tooltip-row">${escapeHtml(currentDoc.spanLabel)}: ${escapeHtml(formatSpanRange(m.start, m.end, currentDoc.unit))}</div>
      <div class="smv-tooltip-row">${escapeHtml(currentDoc.magnitudeLabel)}: ${escapeHtml(formatMagnitude(m.magnitude))}</div>
      <div class="smv-tooltip-row">Cohort: ${escapeHtml(m.cohort)} · Group: ${escapeHtml(m.group)}</div>
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

  function bindHover(
    sel: Selection<SVGElement, LayoutMark, SVGGElement, unknown>
  ): void {
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
    if (!gMarks) return;
    const slowFirst = currentOpts.slowFirst ?? 2;

    gMarks.selectAll<SVGElement, LayoutMark>(".smv-mark").each(function (d) {
      const p = markProgress(schedule, d.mark.id, t);
      const el = select(this);
      if (layout.geometry === "arc") {
        const path = this as unknown as SVGPathElement;
        let len = 200;
        try {
          len = path.getTotalLength();
        } catch {
          /* ignore */
        }
        el.attr("stroke-dasharray", `${len}`)
          .attr("stroke-dashoffset", `${len * (1 - p)}`)
          .style("opacity", p > 0 ? String(0.38 + 0.37 * p) : "0")
          .attr("stroke-width", d.strokeWidth * (0.25 + 0.75 * p));
      } else {
        el.style("opacity", String(p)).attr("width", Math.max(1, d.bar.width * p));
      }
      el.classed("smv-mark--dim", hoveredId != null && hoveredId !== d.mark.id && p > 0);
      el.classed("smv-mark--active", hoveredId === d.mark.id);
    });

    gMarks.selectAll(".smv-annotation").remove();
    if (t < 0.32 && layout.geometry === "arc") {
      schedule.entries.slice(0, slowFirst).forEach((e) => {
        const p = markProgress(schedule, e.id, t);
        if (p <= 0) return;
        const lm = layout.marks.find((m) => m.mark.id === e.id);
        if (!lm) return;
        const mx = (lm.x0 + lm.x1) / 2;
        const my = lm.yBase - lm.bulge * lm.side - 10 * lm.side;
        gMarks
          .append("g")
          .attr("class", "smv-annotation")
          .attr("opacity", Math.min(1, p * 1.4))
          .append("text")
          .attr("x", mx)
          .attr("y", my)
          .attr("text-anchor", "middle")
          .text(lm.mark.label);
      });
    }

    if (tickerEls) updateTickers(tickerEls, state, currentDoc.unit);
    currentOpts.onTick?.(state);
  }

  function rebuild(): void {
    anim?.destroy();
    anim = null;
    root.querySelector("svg")?.remove();
    tickerEls?.root.remove();
    tickerEls = null;
    hoveredId = null;
    hideTooltip();

    const visible = filterMarks(currentDoc, currentOpts);
    layout = computeLayout(currentDoc, currentOpts, visible);
    schedule = buildRevealSchedule(visible, {
      durationMs: currentOpts.durationMs,
      slowFirst: currentOpts.slowFirst ?? 2,
    });

    root.style.width = "100%";
    root.style.maxWidth = `${layout.width}px`;
    titleEl.textContent = currentDoc.title || "";

    const kinds = resolveTickers(currentDoc, currentOpts);
    if (kinds.length) {
      tickerEls = createTickerDom(root, currentDoc, kinds, theme);
    }

    const svg = select(root)
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
          .tickFormat((d) => formatAxisValue(Number(d), currentDoc.unit))
      );

    // Axis label
    g.append("text")
      .attr("x", layout.innerWidth / 2)
      .attr("y", layout.innerHeight + 36)
      .attr("text-anchor", "middle")
      .attr("fill", "#78716c")
      .attr("font-size", 11)
      .text(currentDoc.spanLabel);

    gMarks = g.append("g").attr("class", "smv-marks");

    if (layout.geometry === "arc") {
      const paths = gMarks
        .selectAll<SVGPathElement, LayoutMark>("path.smv-mark")
        .data(layout.marks, (d) => d.mark.id)
        .join("path")
        .attr("class", "smv-mark")
        .attr("d", (d) => d.pathD)
        .attr("fill", "none")
        .attr("stroke", (d) => d.color)
        .attr("stroke-linecap", "round")
        .attr("stroke-width", (d) => d.strokeWidth)
        .attr("data-id", (d) => d.mark.id);
      bindHover(paths as unknown as Selection<SVGElement, LayoutMark, SVGGElement, unknown>);
    } else {
      const rects = gMarks
        .selectAll<SVGRectElement, LayoutMark>("rect.smv-mark")
        .data(layout.marks, (d) => d.mark.id)
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

    const shouldAnimate =
      (currentOpts.animate ?? currentDoc.defaults.animate) &&
      !prefersReducedMotion();

    anim = createAnimation(schedule, applyFrame, () =>
      currentOpts.onComplete?.()
    );

    if (shouldAnimate && (currentOpts.autoplay ?? true)) {
      anim.play();
    } else {
      anim.setProgress(1);
    }
  }

  rebuild();

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
      currentOpts.geometry = mode;
      rebuild();
    },
    setFilter(opts) {
      if ("cohort" in opts) currentOpts.cohortFilter = opts.cohort ?? null;
      if ("mirrorSplit" in opts)
        currentOpts.mirrorSplit = opts.mirrorSplit ?? false;
      if ("mirrorCohort" in opts)
        currentOpts.mirrorCohort = opts.mirrorCohort ?? null;
      rebuild();
    },
    setProgress(t: number) {
      anim?.pause();
      anim?.setProgress(t);
    },
    getState() {
      return tickerAt(schedule, anim?.getProgress() ?? 1);
    },
    destroy() {
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
