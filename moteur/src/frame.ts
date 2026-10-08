/**
 * Cadre commun des graphiques : titre, sous-titre, zone de tracé, cartouche, accessibilité (title/desc).
 * Tout est produit en chaîne SVG : toSVG fonctionne sans DOM (serveur, jsPDF / svg2pdf).
 */
import { cartoucheBlock, type CartoucheOptions } from "./cartouche";
import { compact, euro, number, percent } from "./format";
import { esc, hashId, tag, wrap } from "./svg";
import { resolveTheme, type Theme, type ThemeInput } from "./theme";

export interface ChartOptions {
  /** Largeur du SVG (px, 720 par défaut ; animate() prend la largeur du conteneur). */
  width?: number;
  /** Hauteur du SVG (px ; par défaut proportionnelle à la largeur). */
  height?: number;
  title?: string;
  subtitle?: string;
  /** Jetons de thème (sinon variables CSS --ac-* du conteneur, sinon pétrole). */
  theme?: ThemeInput;
  /** Cartouche neutre (logo, nom, lien, QR, dates, source) : rien n'est affiché s'il est absent. */
  cartouche?: CartoucheOptions;
  /** Format des valeurs : « euro » (défaut), « number » ou « percent » (valeurs en points). */
  format?: "euro" | "number" | "percent";
  /** Unité affichée après le nombre (« € » par défaut pour euro, rien sinon). */
  unit?: string;
  /** Écriture compacte k / M / Md (vrai par défaut). */
  compact?: boolean;
  decimals?: number;
  /** Texte alternatif ; sinon titre + résumé calculé. */
  ariaLabel?: string;
  /** Durée totale de l'animation en ms (1 600 par défaut ; 0 = pas d'animation). */
  duration?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ctx {
  t: Theme;
  o: ChartOptions;
  width: number;
  height: number;
  /** Échelle typographique (0,85 en petit écran). */
  k: number;
  /** Préfixe d'identifiants stables (clipPath, title, desc). */
  id: string;
  fmt: (v: number, signed?: boolean) => string;
}

export interface Plot {
  /** Contenu SVG de la zone de tracé. */
  svg: string;
  /** Résumé textuel (desc) pour les lecteurs d'écran. */
  summary: string;
  /** Définitions (clipPath…) */
  defs?: string;
}

export function defaultHeight(width: number): number {
  return Math.round(Math.max(300, Math.min(480, width * 0.56)));
}

/** Formateur de valeurs selon les options (euro compact par défaut). */
export function valueFormatter(o: ChartOptions): (v: number, signed?: boolean) => string {
  const fmt = o.format ?? "euro";
  const isCompact = o.compact !== false;
  return (v, signed = false) => {
    if (fmt === "percent") return percent(v, { points: true, decimals: o.decimals ?? (Math.abs(v) < 10 ? 1 : 0), signed });
    const unit = o.unit ?? (fmt === "euro" ? "€" : "");
    if (isCompact) return compact(v, { unit, decimals: o.decimals, signed });
    if (fmt === "euro") return euro(v, { unit, decimals: o.decimals, signed });
    const n = number(v, { decimals: o.decimals, signed });
    return unit ? `${n}\u202f${unit}` : n;
  };
}

export function makeCtx(kind: string, data: unknown, o: ChartOptions = {}, theme?: Theme): Ctx {
  const width = Math.round(Math.max(280, Math.min(2400, o.width ?? 720)));
  // hauteur par défaut : zone de tracé proportionnelle à la largeur, plus le titre et le cartouche
  const extra = (o.title ? 30 : 0) + (o.subtitle ? 20 : 0) + (o.cartouche ? 70 : 0);
  const height = Math.round(Math.max(220, Math.min(1800, o.height ?? defaultHeight(width) + extra)));
  const t = theme ?? resolveTheme(o.theme);
  return { t, o, width, height, k: width < 480 ? 0.85 : 1, id: hashId(`ac-${kind}`, data, width, height, o.title ?? "", t), fmt: valueFormatter(o) };
}

/** Assemble le SVG complet : fond, titre, sous-titre, tracé, cartouche. */
export function compose(kind: string, c: Ctx, draw: (box: Box) => Plot): string {
  const { t, o, width, height, k } = c;
  const pad = width < 480 ? 12 : 18;
  const parts: string[] = [];
  let y = pad;
  if (o.title) {
    const fs = 18 * k;
    const lines = wrap(o.title, fs, width - pad * 2, 2, true);
    lines.forEach((l, i) => parts.push(tag("text", { class: "ac-title", x: pad, y: y + fs * 0.85 + i * fs * 1.2, "font-size": fs, "font-weight": 700, fill: t.text }, esc(l))));
    y += lines.length * fs * 1.2 + 2;
  }
  if (o.subtitle) {
    const fs = 12.5 * k;
    const lines = wrap(o.subtitle, fs, width - pad * 2, 2);
    lines.forEach((l, i) => parts.push(tag("text", { class: "ac-subtitle", x: pad, y: y + fs * 0.9 + i * fs * 1.25, "font-size": fs, fill: t.grey }, esc(l))));
    y += lines.length * fs * 1.25 + 4;
  }
  if (o.title || o.subtitle) y += 8 * k;
  const cart = cartoucheBlock(o.cartouche, width, 0, t, pad);
  const cartH = cart.height ? cart.height + 6 : 0;
  const box: Box = { x: pad, y, w: width - pad * 2, h: Math.max(80, height - y - pad * 0.6 - cartH) };
  const plot = draw(box);
  const total = Math.round(box.y + box.h + pad * 0.6 + cartH);
  const cartSvg = cart.height ? cartoucheBlock(o.cartouche, width, total - cart.height, t, pad).svg : "";
  const label = o.ariaLabel ?? [o.title, plot.summary].filter(Boolean).join(". ");
  const tid = `${c.id}-t`;
  const did = `${c.id}-d`;
  const bg = t.bg === "transparent" ? "" : tag("rect", { class: "ac-bg", width, height: total, fill: t.bg });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ac-svg ac-${kind}" viewBox="0 0 ${width} ${total}" width="${width}" height="${total}" role="img" aria-labelledby="${tid} ${did}" font-family="${esc(t.font)}">` +
    tag("title", { id: tid }, esc(o.title ?? label)) +
    tag("desc", { id: did }, esc(plot.summary)) +
    (plot.defs ? `<defs>${plot.defs}</defs>` : "") +
    bg +
    parts.join("") +
    plot.svg +
    cartSvg +
    `</svg>`
  );
}

/** Attributs d'animation lus par animate() : type, début et durée en fraction de la durée totale. */
export function anim(a: "gy" | "gx" | "draw" | "wipe" | "fade", t0: number, d: number, base?: number): Record<string, string | number> {
  const r: Record<string, string | number> = { "data-ac-a": a, "data-ac-t": Math.round(t0 * 1000) / 1000, "data-ac-d": Math.round(d * 1000) / 1000 };
  if (base != null) r["data-ac-b"] = Math.round(base * 100) / 100;
  return r;
}

/** Graduations « rondes » pour un axe de valeurs. */
export function ticks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Domaine arrondi aux graduations, zéro inclus. */
export function niceDomain(values: number[], count = 5): [number, number] {
  const f = values.filter(Number.isFinite);
  let lo = Math.min(0, ...f);
  let hi = Math.max(0, ...f);
  if (lo === hi) hi = lo + 1;
  const tk = ticks(lo, hi, count);
  const step = tk.length > 1 ? tk[1]! - tk[0]! : 1;
  if (tk[0]! > lo) lo = tk[0]! - step;
  else lo = tk[0]!;
  const last = tk[tk.length - 1]!;
  hi = last < hi ? last + step : last;
  return [lo, hi];
}
