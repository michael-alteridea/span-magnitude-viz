/**
 * Identité Datanime (logo C15 « DatAnime » : A capitale jaune à œil ▶, bleu pétrole) et signature « label qualité » :
 * nom du produit, lien vers la plateforme, date de génération et source.
 * Le nom du produit n'existe qu'ici (les noms techniques — dépôt, paquet, clés — restent « reporting-4d »).
 */
import iconSvgRaw from "./assets/brand/tell4d-h1-icon.svg?raw";
import { TELL4D_ICON_PNG_64 } from "./assets/brand/icon-png";
import logoAnimLightRaw from "./assets/brand/logo-anim-light.svg?raw";
import logoAnimDarkRaw from "./assets/brand/logo-anim-dark.svg?raw";
import { WORDMARK_COLORS, WORDMARK_PATHS, WORDMARK_PNG, WORDMARK_RATIO, WORDMARK_VIEWBOX } from "./assets/brand/wordmark";

export { WORDMARK_PNG, WORDMARK_RATIO };

export const PRODUCT_LABEL = "Datanime";
export const PLATFORM_URL = "https://datanime.io/reporting/";
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
 * Mot-symbole C15 « DatAnime » (« Dat » neutre, A jaune à œil ▶, « nime » pétrole) en SVG inline, `height` = hauteur des
 * capitales en px. Accessible : role="img", aria-label et <title> « Datanime ».
 */
export function wordmarkMarkup(theme: WordmarkTheme, height: number, cls = "wordmark"): string {
  const c = WORDMARK_COLORS[theme];
  const w = Math.round(height * WORDMARK_RATIO * 10) / 10;
  const paths = WORDMARK_PATHS.map((p) => `<path d="${p.d}" fill="${c[p.part]}"${p.rule ? ` fill-rule="${p.rule}"` : ""}/>`).join("");
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
  for (const p of WORDMARK_PATHS) {
    const el = g.append("path").attr("d", p.d).attr("fill", c[p.part]);
    if (p.rule) el.attr("fill-rule", p.rule);
  }
  return g;
}

/** Largeur du mot-symbole pour une hauteur de capitales `h`. */
export const wordmarkWidth = (h: number): number => h * WORDMARK_RATIO;

/* ------------------------------------------------------------------ animation du logo (CSS seul) */

/** Durée de l'animation du logo C15 (s) : « Data » + « anime » se rejoignent, le a devient A, jaunit, puis l'œil ▶. */
export const LOGO_ANIM_S = 2;
/** viewBox des SVG animés (même repère que le mot-symbole, avec marge pour les glissements). */
export const LOGO_ANIM_VIEWBOX: [number, number, number, number] = [135.33, 13.26, 624.87, 133.48];
const ANIM_NAMES = ["animeF", "animeX", "cap", "datS", "dataF", "dataX", "eye", "l2", "mCap", "mLow", "nimS"];
const ANIM_RE = new RegExp(`\\b(${ANIM_NAMES.join("|")})\\b`, "g");

/**
 * Logo animé (CSS seul, `prefers-reduced-motion` : image finale fixe). Classes, keyframes et masques préfixés par
 * `prefix` (plusieurs instances par page sans collision). `seek` (s) fige l'animation à cet instant (rendu image par
 * image du Reel) ; `duration` (s) la joue plus vite ou plus lentement. `width`/`height` : taille affichée.
 */
export function logoAnimMarkup(theme: WordmarkTheme, prefix: string, o: { seek?: number; duration?: number; width?: number; height?: number; x?: number; y?: number; cls?: string } = {}): string {
  const raw = (theme === "dark" ? logoAnimDarkRaw : logoAnimLightRaw).trim();
  const [, , vw, vh] = LOGO_ANIM_VIEWBOX;
  const h = o.height ?? (o.width ? (o.width * vh) / vw : vh);
  const w = o.width ?? (h * vw) / vh;
  let s = raw
    .replace(/<style>([\s\S]*?)<\/style>/, (_m, css: string) => `<style>${css.replace(ANIM_RE, `${prefix}-$1`)}</style>`)
    .replace(/class="([^"]+)"/g, (_m, c: string) => `class="${c.replace(ANIM_RE, `${prefix}-$1`)}"`)
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);
  const extra: string[] = [];
  const dur = o.duration ?? LOGO_ANIM_S;
  if (o.duration !== undefined) extra.push(`animation-duration:${dur}s!important`);
  if (o.seek !== undefined) {
    const t = Math.max(0, Math.min(dur - 0.001, o.seek));
    extra.push(`animation-delay:-${t.toFixed(3)}s!important`, "animation-play-state:paused!important");
  }
  if (extra.length) s = s.replace("</style>", `${ANIM_NAMES.map((n) => `.${prefix}-${n}`).join(",")}{${extra.join(";")}}</style>`);
  const pos = `${o.x !== undefined ? ` x="${o.x}"` : ""}${o.y !== undefined ? ` y="${o.y}"` : ""}`;
  return s.replace(/^<svg([^>]*?)\swidth="\d+"\sheight="\d+"/, `<svg$1${pos} width="${Math.round(w * 100) / 100}" height="${Math.round(h * 100) / 100}" class="${o.cls ?? "logo-anim"}"`);
}

/** Position du logo animé qui recouvre exactement le mot-symbole statique placé en (x, y) avec `h` = hauteur des capitales. */
export function logoAnimBoxForWordmark(x: number, y: number, h: number): { x: number; y: number; width: number; height: number } {
  const [wx, wy, , wh] = WORDMARK_VIEWBOX;
  const [ax, ay, aw, ah] = LOGO_ANIM_VIEWBOX;
  const k = h / wh;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(x - (wx - ax) * k), y: r(y - (wy - ay) * k), width: r(aw * k), height: r(ah * k) };
}
