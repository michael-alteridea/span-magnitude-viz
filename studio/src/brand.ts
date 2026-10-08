/**
 * Identité Tell4D (logo « Bulle + barres », bleu pétrole) et signature « label qualité » :
 * nom du produit, lien vers la plateforme, date de génération et source.
 * Le nom du produit n'existe qu'ici (les noms techniques — dépôt, paquet, clés — restent « reporting-4d »).
 */
import iconSvgRaw from "./assets/brand/tell4d-h1-icon.svg?raw";
import { TELL4D_ICON_PNG_64 } from "./assets/brand/icon-png";

export const PRODUCT_LABEL = "Tell4D";
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
  if (!svg) throw new Error("icône Tell4D illisible");
  return svg;
}

/** Arbre de l'icône Tell4D (élément <svg viewBox="0 0 512 512">), identifiants préfixés. */
export function tell4dIconTree(prefix: string): SvgNode {
  return parseSvg(prefixed(prefix));
}

/** Balisage de l'icône Tell4D à la taille voulue (en-tête de l'interface). */
export function tell4dIconMarkup(prefix: string, size: number, extra = 'aria-hidden="true" focusable="false"'): string {
  return prefixed(prefix)
    .trim()
    .replace(/^<svg([^>]*?)\swidth="\d+"\sheight="\d+"/, `<svg$1 width="${size}" height="${size}" ${extra}`);
}

export interface Appendable {
  append(name: string): Appendable;
  attr(name: string, value: string | number): Appendable;
}

/** Ajoute l'icône Tell4D (SVG imbriqué, net à toute échelle) sous `parent` (sélection d3). */
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
