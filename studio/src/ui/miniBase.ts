/** Briques communes des vignettes de l'Explorer (taille, couleurs, création SVG). */
export const MINI_W = 320;
export const MINI_H = 160;
const NS = "http://www.w3.org/2000/svg";
const MINI_DEFAULT = { accent: "#3FA7C4", soft: "#8ECFE2", muted: "#2E4D58", muted2: "#3D5F6B", text: "#F4FAFC", label: "#A9BCC4", base: "#2a3034" };
/** Mode norme : données en gris (mise en avant par le contraste), rouge / vert réservés aux écarts. */
const MINI_NORME = { accent: "#E4E4E7", soft: "#A1A1AA", muted: "#52525B", muted2: "#6B6B73", text: "#F4F4F5", label: "#A1A1AA", base: "#2a3034" };
export const MINI_COLORS = { ...MINI_DEFAULT };
/** Couleurs des empilements (vignettes). */
export const MINI_STACK = ["#3FA7C4", "#8ECFE2", "#1B8BA8", "#C3E4EE", "#0E6E8C", "#5FB8D1"];
export function setMiniNorme(on: boolean): void {
  Object.assign(MINI_COLORS, on ? MINI_NORME : MINI_DEFAULT);
  MINI_STACK.splice(0, MINI_STACK.length, ...(on ? ["#E4E4E7", "#A1A1AA", "#71717A", "#D4D4D8", "#52525B", "#C4C4C8"] : ["#3FA7C4", "#8ECFE2", "#1B8BA8", "#C3E4EE", "#0E6E8C", "#5FB8D1"]));
}

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

