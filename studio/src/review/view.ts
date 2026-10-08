/**
 * Revues : éléments d'interface partagés (avatars, icônes, rendu des graphiques de snapshot, QR).
 */
import { ChartTooltip } from "../ui/tooltip";
import { parseSpec, type ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, renderChart } from "../charts/render";
import type { Snapshot } from "../story/snapshots";
import { qrMatrix, qrPath } from "../qr";
import { h } from "../ui/dom";
import { initials, type Person } from "./model";

export const RV_ICONS = {
  eye: `<path d="M2 12 C5 6 9 4 12 4 S19 6 22 12 C19 18 15 20 12 20 S5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/>`,
  share: `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5 L15.4 17.5 M15.4 6.5 L8.6 10.5"/>`,
  chat: `<path d="M21 15 A2 2 0 0 1 19 17 H8 L4 21 V5 A2 2 0 0 1 6 3 H19 A2 2 0 0 1 21 5 Z"/>`,
  question: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5 A2.5 2.5 0 1 1 12 12 V13.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>`,
  flag: `<path d="M5 21 V4 M5 4 H17 L15 8 L17 12 H5"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`,
  users: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 C3 16 6 14 9 14 S15 16 15.5 20"/><path d="M16 4.5 A3.5 3.5 0 0 1 16 11.5 M18 14.5 C20 15.3 21.3 17.3 21.5 20"/>`,
  qr: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14 H17 V17 H14 Z M20 14 V21 H17 M14 20 V21"/>`,
  link: `<path d="M10 14 A4 4 0 0 0 15.7 14 L19 10.7 A4 4 0 0 0 13.3 5 L12 6.3"/><path d="M14 10 A4 4 0 0 0 8.3 10 L5 13.3 A4 4 0 0 0 10.7 19 L12 17.7"/>`,
  copy: `<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8 V5 A2 2 0 0 0 14 3 H5 A2 2 0 0 0 3 5 V14 A2 2 0 0 0 5 16 H8"/>`,
  print: `<path d="M6 9 V3 H18 V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14 H17 V21 H7 Z"/>`,
  check: `<path d="M4 12.5 L9.5 18 L20 6"/>`,
  thumb: `<path d="M7 11 V20 H4 V11 Z M7 11 L11 3 C12.5 3 13.5 4 13.2 5.6 L12.5 9 H19 A2 2 0 0 1 21 11.3 L19.7 18.3 A2 2 0 0 1 17.7 20 H7"/>`,
  bulb: `<path d="M9 18 H15 M10 21 H14 M12 3 A6 6 0 0 0 8 13.5 C8.8 14.3 9 15 9 16 H15 C15 15 15.2 14.3 16 13.5 A6 6 0 0 0 12 3 Z"/>`,
  alert: `<path d="M12 3 L22 20 H2 Z"/><path d="M12 10 V14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>`,
  plus: `<path d="M12 5 V19 M5 12 H19"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10 H21 M8 3 V7 M16 3 V7"/>`,
  screen: `<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20 H16 M12 16 V20"/>`,
  doc: `<path d="M6 3 H14 L19 8 V21 H6 Z"/><path d="M14 3 V8 H19 M9 13 H16 M9 17 H16"/>`,
  bell: `<path d="M6 16 V11 A6 6 0 0 1 18 11 V16 L20 18 H4 Z"/><path d="M10 21 H14"/>`,
  pen: `<path d="M4 20 L8 19 L19 8 L16 5 L5 16 Z"/><path d="M14 7 L17 10"/>`,
  sparkle: `<path d="M12 3 L13.6 9.4 L20 11 L13.6 12.6 L12 19 L10.4 12.6 L4 11 L10.4 9.4 Z"/>`,
  book: `<path d="M3 5 C6 4 9 4.5 12 6.5 C15 4.5 18 4 21 5 V19 C18 18 15 18.5 12 20.5 C9 18.5 6 18 3 19 Z"/><path d="M12 6.5 V20.5"/>`,
  replay: `<path d="M4 12 A8 8 0 1 0 7 5.8"/><path d="M4 4 V9 H9"/>`,
  arrowUp: `<path d="M12 19 V5 M6 11 L12 5 L18 11"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7 L12 13 L21 7"/>`,
  send: `<path d="M21 3 L10 14"/><path d="M21 3 L14.5 21 L10 14 L3 9.5 Z"/>`,
  download: `<path d="M12 4 V16 M7 11 L12 16 L17 11"/><path d="M4 20 H20"/>`,
};

export function ic(name: keyof typeof RV_ICONS, size = 16): HTMLElement {
  return h("span", { class: "rv-ic", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${RV_ICONS[name]}</svg>` });
}

export function avatar(p: Person | null, size = 30, title = true): HTMLElement {
  const name = p?.name ?? "?";
  return h("span", { class: "rv-av", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${p?.color ?? "#3f3f46"}`, title: title ? name : null, "aria-hidden": title ? null : "true" }, initials(name));
}

export interface ChartOpts {
  thumb?: boolean;
  /** Format de rendu imposé (page participant sur téléphone / tablette). */
  size?: { width: number; height: number };
  boost?: number;
}

function specFor(s: Snapshot, o: ChartOpts): ChartSpec | null {
  const r = parseSpec(s.spec);
  if (!r.ok) return null;
  const spec = r.spec;
  const style = { ...spec.style, title: s.title, subtitle: s.subtitle, ...(o.size ? { size: { ...spec.style.size, preset: "custom" as const, width: o.size.width, height: o.size.height } } : {}) };
  return { ...spec, style, story: { ...spec.story, comments: s.comments } };
}

/**
 * Graphique d'un snapshot : rendu recalculé depuis les données d'origine (net à toute taille, animable),
 * sinon le rendu conservé (SVG), sinon la vignette.
 */
export function chartBox(s: Snapshot, ds: Dataset | null, o: ChartOpts = {}): { el: HTMLElement; play: (ms?: number) => void; stop: () => void } {
  const spec = ds ? specFor(s, o) : null;
  const box = h("div", { class: `rv-chart${o.thumb ? " thumb" : ""}` });
  if (!spec || !ds) {
    if (s.svg && !o.thumb) box.innerHTML = s.svg;
    else if (s.thumb) box.append(h("img", { src: s.thumb, alt: s.title }));
    else box.append(h("div", { class: "rv-chart-missing" }, "Graphique indisponible : données d'origine absentes sur cet appareil"));
    const svg = box.querySelector("svg");
    svg?.removeAttribute("width");
    svg?.removeAttribute("height");
    return { el: box, play: () => {}, stop: () => {} };
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", s.title);
  box.append(svg);
  const cache = prepareCache(spec, ds, null, -1);
  const now = s.generatedAt ? new Date(s.generatedAt) : new Date();
  const draw = (build: number) => {
    renderChart(svg, spec, ds, cache, { build, timePos: null }, o.thumb ? { thumb: true, now } : { bare: true, now, textBoost: o.boost });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
  };
  draw(1);
  // Revue, réunion, compte rendu, page participant : infobulles (pas sur les vignettes)
  if (!o.thumb) new ChartTooltip(box, { hints: false });
  let raf = 0;
  const stop = () => cancelAnimationFrame(raf);
  const play = (ms = 1300) => {
    stop();
    const t0 = performance.now();
    const frame = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      draw(t);
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    frame();
  };
  return { el: box, play, stop };
}

/** QR en SVG (fond blanc, marge de 3 modules). */
export function qrSvg(url: string, px: number): string {
  const m = qrMatrix(url);
  const q = 3;
  const n = m.size + 2 * q;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR : ${url.replace(/"/g, "")}"><rect x="${-q}" y="${-q}" width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(m)}" fill="#0b1114"/></svg>`;
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Points de lecture : un par snapshot (vu / pas encore). */
export function dots(seen: boolean[]): HTMLElement {
  return h("span", { class: "rv-dots", "aria-label": `${seen.filter(Boolean).length} sur ${seen.length} vus` }, ...seen.map((v) => h("i", { class: v ? "on" : "" })));
}

/** Anneau de progression (x / n). */
export function ring(x: number, n: number, size = 64): HTMLElement {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const p = n ? x / n : 0;
  return h("span", {
    class: "rv-ring",
    html: `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-2)" stroke-width="7"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`,
  });
}
