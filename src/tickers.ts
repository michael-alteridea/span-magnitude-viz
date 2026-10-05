import type { NormalizedDocument, TickerKind, TickerState } from "./types.js";
import { formatMagnitude } from "./layout.js";

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
  theme: "dark" | "light"
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
    box.innerHTML = `<div class="smv-ticker-value" data-role="span">0</div><div class="smv-ticker-label">${escapeHtml(doc.spanLabel)} (sum)</div>`;
    spanEl = box.querySelector("[data-role=span]");
    root.appendChild(box);
  }

  container.appendChild(root);
  return { root, countEl, magnitudeEl, spanEl };
}

export function updateTickers(
  els: TickerElements,
  state: TickerState,
  unit: "date" | "number"
): void {
  if (els.countEl) {
    els.countEl.textContent = String(Math.round(state.count));
  }
  if (els.magnitudeEl) {
    els.magnitudeEl.textContent = formatMagnitude(state.magnitudeSum);
  }
  if (els.spanEl) {
    if (unit === "date") {
      const days = state.spanSum / (1000 * 60 * 60 * 24);
      els.spanEl.textContent =
        days >= 365 ? `${(days / 365).toFixed(1)}y` : `${Math.round(days)}d`;
    } else {
      els.spanEl.textContent = formatMagnitude(state.spanSum);
    }
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
.smv-tickers--dark .smv-ticker-value { color: #f5a623; }
.smv-tickers--dark .smv-ticker-label { color: #c4b5a0; }
.smv-tickers--dark .smv-ticker--count .smv-ticker-value { color: #fde68a; }
.smv-tickers--light .smv-ticker-value { color: #b45309; }
.smv-tickers--light .smv-ticker-label { color: #78716c; }
`;
