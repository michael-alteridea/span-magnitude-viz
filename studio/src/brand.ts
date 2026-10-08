/**
 * Identité Datanime (logo « Bulle + barres », bleu pétrole) et signature « label qualité » :
 * nom du produit, lien vers la plateforme, date de génération et source.
 * Le nom du produit n'existe qu'ici (les noms techniques — dépôt, paquet, clés — restent « reporting-4d »).
 */
import iconSvgRaw from "./assets/brand/tell4d-h1-icon.svg?raw";
import { TELL4D_ICON_PNG_64 } from "./assets/brand/icon-png";
import { WORDMARK_COLORS, WORDMARK_PATHS, WORDMARK_PNG, WORDMARK_RATIO, WORDMARK_VIEWBOX } from "./assets/brand/wordmark";

export { WORDMARK_PNG, WORDMARK_RATIO };

export const PRODUCT_LABEL = "Datanime";
export const PLATFORM_URL = "https://alteridea-dashboard.web.app/reporting/";
/** Libellé court du lien affiché dans les exports (PowerPoint…). */
export const PLATFORM_HOST = PLATFORM_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
/** Couleurs du logo (bleu pétrole). */
export const LOGO_COLOR = "#0E6E8C";
export const LOGO_COLORS = { petrol: "#0E6E8C", light: "#3FA7C4", dark: "#08465A" } as const;
/** Icône PNG 64 px (data URL) : logo 2× des diapositives PowerPoint. */
export const ICON_PNG_2X: string = TELL4D_ICON_PNG_64;

/** La signature ne peut être masquée qu'en offre « pro » (aucune option d'interface pour l'instant). */
export function showSignature(spec: { branding?: "free" | "pro"; style: { brandMark: boolean } }): boolean {
  return spec.branding !== "pro" || spec.style.brandMark;
}

/* ------------------------------------------------------------------ icône SVG inline */

export interface SvgNode {
  tag: string;
  attrs: [string, string][];
  children: SvgNode[];
}

/** Préfixe les identifiants internes (dégradés « i-… ») pour pouvoir inclure l'icône plusieurs fois par page. */
function prefixed(prefix: string): string {
  return iconSvgRaw.replace(/id="i-/g, `id="${prefix}-`).replace(/url\(#i-/g, `url(#${prefix}-`);
}

/** Mini-analyseur du SVG de l'icône (balises et attributs simples, sans texte). */
export function parseSvg(src: string): SvgNode {
  const root: SvgNode = { tag: "#root", attrs: [], children: [] };
  const stack: SvgNode[] = [root];
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, self] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: SvgNode = { tag: tag!, attrs: [...rest!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!] as [string, string]), children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!self) stack.push(node);
  }
  const svg = root.children[0];
  if (!svg) throw new Error("icône Datanime illisible");
  return svg;
}

/** Arbre de l'icône Datanime (élément <svg viewBox="0 0 512 512">), identifiants préfixés. */
export function tell4dIconTree(prefix: string): SvgNode {
  return parseSvg(prefixed(prefix));
}

/** Balisage de l'icône Datanime à la taille voulue (en-tête de l'interface). */
export function tell4dIconMarkup(prefix: string, size: number, extra = 'aria-hidden="true" focusable="false"'): string {
  return prefixed(prefix)
    .trim()
    .replace(/^<svg([^>]*?)\swidth="\d+"\sheight="\d+"/, `<svg$1 width="${size}" height="${size}" ${extra}`);
}

export interface Appendable {
  append(name: string): Appendable;
  attr(name: string, value: string | number): Appendable;
}

/** Ajoute l'icône Datanime (SVG imbriqué, net à toute échelle) sous `parent` (sélection d3). */
export function appendTell4dIcon(parent: Appendable, prefix: string): Appendable {
  const build = (sel: Appendable, node: SvgNode, isRoot: boolean): Appendable => {
    const el = sel.append(node.tag);
    // racine : taille et position fixées par l'appelant (x, y, width, height)
    for (const [k, v] of node.attrs) if (!(isRoot && (k === "xmlns" || k === "width" || k === "height"))) el.attr(k, v);
    node.children.forEach((c) => build(el, c, false));
    return el;
  };
  return build(parent, tell4dIconTree(prefix), true);
}

/* ------------------------------------------------------------------ mot-symbole */

export type WordmarkTheme = "light" | "dark";

/**
 * Mot-symbole « Datanime » (« Dat » neutre, « a » orange, « nime » pétrole) en SVG inline, `height` = hauteur des
 * capitales en px. Accessible : role="img", aria-label et <title> « Datanime ».
 */
export function wordmarkMarkup(theme: WordmarkTheme, height: number, cls = "wordmark"): string {
  const c = WORDMARK_COLORS[theme];
  const w = Math.round(height * WORDMARK_RATIO * 10) / 10;
  const paths = WORDMARK_PATHS.map((p) => `<path d="${p.d}" fill="${c[p.part]}"/>`).join("");
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK_VIEWBOX.join(" ")}" width="${w}" height="${height}" role="img" aria-label="${PRODUCT_LABEL}"><title>${PRODUCT_LABEL}</title>${paths}</svg>`;
}

/** Ajoute le mot-symbole sous `parent` (sélection d3) : coin haut-gauche (x, y), hauteur des capitales `h`. */
export function appendWordmark(parent: Appendable, theme: WordmarkTheme, x: number, y: number, h: number): Appendable {
  const [vx, vy, , vh] = WORDMARK_VIEWBOX;
  const k = h / vh;
  const g = parent
    .append("g")
    .attr("class", "r4d-brand r4d-wordmark")
    .attr("role", "img")
    .attr("aria-label", PRODUCT_LABEL)
    .attr("transform", `translate(${(x - vx * k).toFixed(2)} ${(y - vy * k).toFixed(2)}) scale(${k.toFixed(5)})`);
  const c = WORDMARK_COLORS[theme];
  for (const p of WORDMARK_PATHS) g.append("path").attr("d", p.d).attr("fill", c[p.part]);
  return g;
}

/** Largeur du mot-symbole pour une hauteur de capitales `h`. */
export const wordmarkWidth = (h: number): number => h * WORDMARK_RATIO;
