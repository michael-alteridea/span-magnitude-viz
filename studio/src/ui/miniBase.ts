/** Briques communes des vignettes de l'Explorer (taille, couleurs, création SVG). */
export const MINI_W = 320;
export const MINI_H = 160;
const NS = "http://www.w3.org/2000/svg";
export const MINI_COLORS = { accent: "#3FA7C4", soft: "#8ECFE2", muted: "#2E4D58", muted2: "#3D5F6B", text: "#F4FAFC", label: "#A9BCC4", base: "#2a3034" };

type Attrs = Record<string, string | number>;
export function svgAdd<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Attrs = {}, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
}

export function miniSvg(label: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "explorer-thumb-svg");
  svg.setAttribute("viewBox", `0 0 ${MINI_W} ${MINI_H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  return svg;
}

