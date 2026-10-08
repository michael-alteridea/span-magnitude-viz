/**
 * Cartouche neutre : identité de l'hôte (logo, nom, lien), QR, dates, source.
 * Rien n'est ajouté par défaut : aucune mention de marque tant qu'elle n'est pas passée en option.
 */
import { esc, fit, tag, textWidth } from "./svg";
import { qrSvgPath } from "./qr";
import { resolveTheme, type Theme, type ThemeInput } from "./theme";
import { svgToPng } from "./png";

export interface CartoucheOptions {
  /** Logo : URL ou data URL (préférer une data URL pour l'export PNG). */
  logo?: string;
  /** Nom de l'hôte ou de l'organisation. */
  name?: string;
  /** Lien affiché (texte) — et cible du QR si qr === true. */
  link?: string;
  /** Contenu du QR (URL) ; true = reprendre link. */
  qr?: string | boolean;
  /** Dates : texte libre (« Données au 8 octobre 2026 ») ou liste de lignes. */
  dates?: string | string[];
  /** Source des données. */
  source?: string;
}

export interface CartoucheBlock {
  svg: string;
  height: number;
}

const has = (o?: CartoucheOptions): boolean => !!o && !!(o.logo || o.name || o.link || o.qr || (Array.isArray(o.dates) ? o.dates.length : o.dates) || o.source);

/** Bloc de cartouche (fragment <g>) pour une largeur donnée, à placer en y. */
export function cartoucheBlock(o: CartoucheOptions | undefined, width: number, y: number, t: Theme, pad = 16): CartoucheBlock {
  if (!has(o)) return { svg: "", height: 0 };
  const opt = o!;
  const qrText = opt.qr === true ? opt.link : typeof opt.qr === "string" ? opt.qr : "";
  const qrSize = qrText ? 54 : 0;
  const logoSize = opt.logo ? 30 : 0;
  const dates = (Array.isArray(opt.dates) ? opt.dates : opt.dates ? [opt.dates] : []).filter(Boolean);
  const leftLines = [opt.name ? 1 : 0, opt.link ? 1 : 0].reduce((a, b) => a + b, 0);
  const rightLines = (opt.source ? 1 : 0) + dates.length;
  // écran étroit : une seule colonne (nom, lien, puis dates et source) pour ne rien tronquer
  const stack = width < 520 && leftLines > 0 && rightLines > 0;
  const lines = stack ? leftLines + rightLines : Math.max(leftLines, rightLines, 1);
  const h = Math.max(qrSize + 16, logoSize + 16, 14 + lines * 15);
  const parts: string[] = [];
  parts.push(tag("line", { x1: pad, x2: width - pad, y1: 0.5, y2: 0.5, stroke: t.grey, "stroke-opacity": 0.45, "stroke-width": 1 }));
  let x = pad;
  if (opt.logo) {
    parts.push(tag("image", { href: opt.logo, x, y: (h - logoSize) / 2, width: logoSize, height: logoSize, preserveAspectRatio: "xMidYMid meet" }));
    x += logoSize + 10;
  }
  const right = width - pad - (qrSize ? qrSize + 12 : 0);
  const avail = Math.max(60, right - x);
  const leftW = rightLines && !stack ? avail * 0.46 : avail;
  let ly = h / 2 - (((stack ? lines : leftLines) - 1) * 15) / 2 + 4;
  if (opt.name) {
    parts.push(tag("text", { x, y: ly, "font-size": 12, "font-weight": 700, fill: t.text }, esc(fit(opt.name, 12, leftW, true))));
    ly += 15;
  }
  if (opt.link) {
    const label = opt.link.replace(/^https?:\/\//, "").replace(/\/$/, "");
    parts.push(tag("a", { href: opt.link }, tag("text", { x, y: ly, "font-size": 11, fill: t.primary }, esc(fit(label, 11, leftW)))));
    ly += 15;
  }
  if (stack) {
    for (const d of dates) {
      parts.push(tag("text", { x, y: ly, "font-size": 11, fill: t.text }, esc(fit(d, 11, avail))));
      ly += 15;
    }
    if (opt.source) parts.push(tag("text", { x, y: ly, "font-size": 10.5, fill: t.grey }, esc(fit(`Source : ${opt.source}`, 10.5, avail))));
  } else if (rightLines) {
    const rx = right;
    const rw = leftLines ? avail * 0.52 : avail;
    let ry = h / 2 - ((rightLines - 1) * 15) / 2 + 4;
    for (const d of dates) {
      parts.push(tag("text", { x: rx, y: ry, "text-anchor": "end", "font-size": 11, fill: t.text }, esc(fit(d, 11, rw))));
      ry += 15;
    }
    if (opt.source) parts.push(tag("text", { x: rx, y: ry, "text-anchor": "end", "font-size": 10.5, fill: t.grey }, esc(fit(`Source : ${opt.source}`, 10.5, rw))));
  }
  if (qrText) {
    const q = qrSvgPath(qrText);
    const s = qrSize / (q.size + 2);
    parts.push(
      tag(
        "g",
        { class: "ac-qr", transform: `translate(${width - pad - qrSize} ${(h - qrSize) / 2}) scale(${s})` },
        tag("rect", { x: 0, y: 0, width: q.size + 2, height: q.size + 2, fill: "#ffffff" }) + tag("path", { d: q.d, transform: "translate(1 1)", fill: "#000000" })
      )
    );
  }
  return { svg: tag("g", { class: "ac-cartouche", transform: `translate(0 ${y})`, "font-family": t.font }, parts.join("")), height: h };
}

export interface CartoucheRenderOptions {
  width?: number;
  theme?: ThemeInput;
}

/** Cartouche seul, en SVG autonome (pour jsPDF / svg2pdf). */
export function toSVG(o: CartoucheOptions, opts: CartoucheRenderOptions = {}): string {
  const t = resolveTheme(opts.theme);
  const width = Math.max(240, opts.width ?? 640);
  const b = cartoucheBlock(o, width, 0, t);
  const h = Math.max(b.height, 1);
  const bg = t.bg === "transparent" ? "" : tag("rect", { width, height: h, fill: t.bg });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(cartoucheText(o))}">${bg}${b.svg}</svg>`;
}

/** Cartouche seul en PNG (data URL). */
export function toPNG(o: CartoucheOptions, opts: CartoucheRenderOptions & { scale?: number } = {}): Promise<string> {
  return svgToPng(toSVG(o, opts), { scale: opts.scale });
}

/** Texte lisible du cartouche (accessibilité). */
export function cartoucheText(o?: CartoucheOptions): string {
  if (!o) return "";
  const d = Array.isArray(o.dates) ? o.dates.join(", ") : o.dates;
  return [o.name, o.link, d, o.source ? `Source : ${o.source}` : ""].filter(Boolean).join(" · ");
}

export { textWidth };
