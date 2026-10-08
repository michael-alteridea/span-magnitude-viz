import type { NormalizedDocument, TickerKind, TickerState } from "./types.js";
import { formatCountLocale, formatSpanSumLocale, magnitudeFormatter, type NumberFormatOptions } from "./numberFormat.js";

export interface TickerElements {
  root: HTMLElement;
  countEl: HTMLElement | null;
  magnitudeEl: HTMLElement | null;
  spanEl: HTMLElement | null;
}

export function createTickerDom(
  container: HTMLElement,
  doc: NormalizedDocument,
  kinds: TickerKind[],
  theme: "dark" | "light",
  fmt: NumberFormatOptions = {}
): TickerElements {
  const root = document.createElement("div");
  root.className = `smv-tickers smv-tickers--${theme}`;
  root.setAttribute("aria-live", "polite");

  let countEl: HTMLElement | null = null;
  let magnitudeEl: HTMLElement | null = null;
  let spanEl: HTMLElement | null = null;

  if (kinds.includes("count")) {
    const box = document.createElement("div");
    box.className = "smv-ticker smv-ticker--count";
    box.innerHTML = `<div class="smv-ticker-value" data-role="count">0</div><div class="smv-ticker-label">${escapeHtml(doc.countLabel)}</div>`;
    countEl = box.querySelector("[data-role=count]");
    root.appendChild(box);
  }
  if (kinds.includes("magnitudeSum")) {
    const box = document.createElement("div");
    box.className = "smv-ticker smv-ticker--magnitude";
    box.innerHTML = `<div class="smv-ticker-value" data-role="magnitude">0</div><div class="smv-ticker-label">${escapeHtml(doc.magnitudeLabel)}</div>`;
    magnitudeEl = box.querySelector("[data-role=magnitude]");
    root.appendChild(box);
  }
  if (kinds.includes("spanSum")) {
    const box = document.createElement("div");
    box.className = "smv-ticker smv-ticker--span";
    box.innerHTML = `<div class="smv-ticker-value" data-role="span">0</div><div class="smv-ticker-label">${escapeHtml(doc.spanLabel)} (${fmt.locale === "fr" ? "somme" : "sum"})</div>`;
    spanEl = box.querySelector("[data-role=span]");
    root.appendChild(box);
  }

  container.appendChild(root);
  return { root, countEl, magnitudeEl, spanEl };
}

export function updateTickers(
  els: TickerElements,
  state: TickerState,
  unit: "date" | "number",
  fmt: NumberFormatOptions = {}
): void {
  if (els.countEl) {
    els.countEl.textContent = formatCountLocale(state.count, fmt.locale);
  }
  if (els.magnitudeEl) {
    els.magnitudeEl.textContent = magnitudeFormatter(fmt)(state.magnitudeSum);
  }
  if (els.spanEl) {
    els.spanEl.textContent = formatSpanSumLocale(state.spanSum, unit, fmt);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const TICKER_CSS = `
.smv-tickers {
  position: absolute;
  top: 12px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  z-index: 2;
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
}
.smv-ticker--magnitude {
  text-align: right;
  margin-left: auto;
}
.smv-ticker--span {
  text-align: right;
  margin-left: 24px;
}
.smv-ticker-value {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.smv-ticker-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.65;
  margin-top: 2px;
}
.smv-tickers--dark .smv-ticker-value { color: #d62839; }
.smv-tickers--dark .smv-ticker-label { color: #c4a4a8; }
.smv-tickers--dark .smv-ticker--count .smv-ticker-value { color: #e9374a; }
.smv-tickers--light .smv-ticker-value { color: #9a1c28; }
.smv-tickers--light .smv-ticker-label { color: #78716c; }
`;
