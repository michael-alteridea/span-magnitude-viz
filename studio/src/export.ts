/**
 * Exports 100 % côté client :
 *  - SVG autonome (polices en base64, styles en attributs) = exactement l'aperçu ;
 *  - PNG 1× / 2× / 3× (rasterisation du même SVG) ;
 *  - configuration JSON (spec ± données) ;
 *  - vidéo WebM (MediaRecorder sur un canevas alimenté image par image) ;
 *  - GIF animé (`recordGif`, encodeur gifenc) : même boucle d'images que la vidéo.
 */
import { stripTips } from "./charts/tip";
import type { ChartSpec, StudioFile } from "./spec";
import { embeddedFontCss, fontStack } from "./theme";
import type { PlotRect } from "./charts/context";
import { PLATFORM_URL, PRODUCT_LABEL } from "./brand";
import { verifyInfoFor, verifyUrl } from "./provenance";

const SVG_NS = "http://www.w3.org/2000/svg";

const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "visibility",
  "display",
] as const;

/** Copie les styles calculés (CSS de la bibliothèque) en attributs, pour un SVG autonome. */
function inlineComputedStyles(src: Element, dst: Element, font: string) {
  const cs = getComputedStyle(src);
  const parts: string[] = [];
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v && v !== "normal" && v !== "auto") parts.push(`${p}:${v}`);
  }
  if (src.tagName.toLowerCase() === "text" || src.tagName.toLowerCase() === "tspan") parts.push(`font-family:${font}`);
  (dst as SVGElement).setAttribute("style", parts.join(";"));
  dst.removeAttribute("class");
  const sk = src.children;
  const dk = dst.children;
  for (let i = 0; i < sk.length && i < dk.length; i++) inlineComputedStyles(sk[i]!, dk[i]!, font);
}

/** Convertit les compteurs HTML (tickers) superposés en texte SVG. */
function overlayHtmlText(host: HTMLElement, libSvg: SVGSVGElement, plot: PlotRect, target: SVGSVGElement, font: string) {
  const ref = libSvg.getBoundingClientRect();
  if (!ref.width) return;
  const k = plot.w / ref.width;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "r4d-tickers");
  host.querySelectorAll<HTMLElement>(".smv-ticker-value, .smv-ticker-label").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !el.textContent?.trim()) return;
    const cs = getComputedStyle(el);
    const box = el.closest<HTMLElement>(".smv-ticker");
    const alignRight = box ? getComputedStyle(box).textAlign === "right" || getComputedStyle(box).textAlign === "end" : false;
    const fsz = parseFloat(cs.fontSize) * k * (ref.width / libSvg.clientWidth || 1);
    const t = document.createElementNS(SVG_NS, "text");
    const x = plot.x + ((alignRight ? r.right : r.left) - ref.left) * k;
    const y = plot.y + (r.top - ref.top) * k + fsz * 0.85;
    t.setAttribute("x", x.toFixed(1));
    t.setAttribute("y", y.toFixed(1));
    t.setAttribute("text-anchor", alignRight ? "end" : "start");
    t.setAttribute("font-size", fsz.toFixed(1));
    t.setAttribute("font-weight", cs.fontWeight);
    t.setAttribute("fill", cs.color);
    t.setAttribute("font-family", font);
    if (cs.letterSpacing && cs.letterSpacing !== "normal") t.setAttribute("letter-spacing", cs.letterSpacing);
    t.textContent = el.textContent.trim();
    g.appendChild(t);
  });
  target.appendChild(g);
}

export interface ComposeInput {
  svg: SVGSVGElement;
  spec: ChartSpec;
  plot: PlotRect;
  /** Hôte de la bibliothèque (types spéciaux). */
  specialHost?: HTMLElement | null;
  /** Polices en base64 (défaut : oui). Non pour les snapshots stockés (ré-embarquées à l'export). */
  embedFonts?: boolean;
  /** Date de génération inscrite dans les métadonnées (défaut : maintenant ; snapshot : sa date de génération). */
  created?: Date;
}

const FONT_MARKER = "/*r4d-fonts*/";

/** Ré-embarque les polices dans un SVG composé sans elles (snapshots). */
export async function embedFontsInto(svgText: string, fontKey: ChartSpec["style"]["font"]): Promise<string> {
  if (!svgText.includes(FONT_MARKER)) return svgText;
  const css = await embeddedFontCss(fontKey);
  return svgText.replace(FONT_MARKER, css);
}

/** Construit la chaîne SVG autonome de l'état courant. */
export async function composeSvg(input: ComposeInput): Promise<string> {
  const { svg, spec, plot, specialHost } = input;
  const font = fontStack(spec.style.font);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.removeAttribute("style");
  clone.removeAttribute("class");

  const libSvg = specialHost?.querySelector<SVGSVGElement>(".smv-chart-area svg") ?? specialHost?.querySelector<SVGSVGElement>("svg");
  if (specialHost && libSvg) {
    const nested = libSvg.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(libSvg, nested, font);
    nested.setAttribute("x", String(plot.x));
    nested.setAttribute("y", String(plot.y));
    nested.setAttribute("width", String(plot.w));
    nested.setAttribute("height", String((plot.w / libSvg.viewBox.baseVal.width) * libSvg.viewBox.baseVal.height || plot.h));
    nested.removeAttribute("style");
    nested.setAttribute("overflow", "hidden");
    clone.appendChild(nested);
    overlayHtmlText(specialHost, libSvg, plot, clone, font);
  }

  const defs = document.createElementNS(SVG_NS, "defs");
  const style = document.createElementNS(SVG_NS, "style");
  style.setAttribute("type", "text/css");
  style.textContent = (input.embedFonts === false ? FONT_MARKER : await embeddedFontCss(spec.style.font)) + `\ntext{font-family:${font};}`;
  defs.appendChild(style);
  clone.insertBefore(defs, clone.firstChild);
  const meta = document.createElementNS(SVG_NS, "metadata");
  const created = input.created ?? new Date();
  const prov = spec.provenance;
  meta.textContent = JSON.stringify({
    generator: `${PRODUCT_LABEL} Studio (alteridea)`,
    url: PLATFORM_URL,
    type: spec.type,
    created: created.toISOString(),
    ...(prov ? { data: { sha256: prov.hash, importedAt: prov.importedAt, rows: prov.rows, cols: prov.cols, kind: prov.kind }, verify: verifyUrl(verifyInfoFor(prov, created)) } : {}),
  });
  clone.insertBefore(meta, clone.firstChild);
  stripTips(clone);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "graphique"
  );
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function svgToImage(svgText: string): Promise<HTMLImageElement> {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Vignette JPEG (data URL) d'un SVG composé. */
export async function svgToJpegDataUrl(svgText: string, width: number, height: number, targetW: number, bg: string, quality = 0.82): Promise<string> {
  const img = await svgToImage(svgText);
  const k = targetW / width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export async function svgToPngBlob(svgText: string, width: number, height: number, scale: number): Promise<Blob> {
  const img = await svgToImage(svgText);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de la rasterisation PNG"))), "image/png"));
}

/**
 * Image PNG au format fixe W × H (images publiées 1600 × 900) : rendu W/H ajusté, centré sur le fond
 * si les proportions diffèrent (graphiques non 16:9).
 */
/** Identifiants internes stables (motifs de hachures numérotés dans l'ordre) : SVG publié reproductible. */
export function stableSvgIds(svg: string): string {
  const map = new Map<string, string>();
  return svg.replace(/r4d-hatch-\d+-[a-z0-9]*/g, (id) => {
    if (!map.has(id)) map.set(id, `r4d-hatch-p${map.size + 1}`);
    return map.get(id)!;
  });
}

export async function pngFit(src: string, width: number, height: number, W: number, H: number, bg = "#ffffff"): Promise<Blob> {
  let img: HTMLImageElement;
  if (src.startsWith("data:")) {
    img = new Image();
    img.src = src;
    await img.decode();
  } else img = await svgToImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const k = Math.min(W / width, H / height);
  const dw = Math.round(width * k);
  const dh = Math.round(height * k);
  if (dw < W || dh < H) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.drawImage(img, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de la rasterisation PNG"))), "image/png"));
}

export function studioFile(spec: ChartSpec, opts: { data?: StudioFile["data"]; sampleId?: string | null; story?: StudioFile["story"] }): StudioFile {
  return {
    kind: "reporting-4d-studio",
    version: 1,
    savedAt: new Date().toISOString(),
    spec,
    data: opts.data ?? null,
    sampleId: opts.sampleId ?? null,
    ...(opts.story ? { story: opts.story } : {}),
  };
}

export function webmSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/**
 * Enregistre une vidéo WebM : `frameSvg(p)` fournit le SVG de la frame à la progression p ∈ [0,1].
 * Le canevas est alimenté au rythme `fps` (temps réel), donc la durée vidéo ≈ durée d'animation.
 */
/**
 * Boucle d'images commune à la vidéo WebM et au GIF : `total` images régulières de p = 0 à 1, puis une
 * pause sur l'image finale (`holdFrames`). `onFrame` reçoit l'image SVG décodée ; elle peut attendre
 * (cadence temps réel du WebM) ou non (encodage GIF, aussi rapide que possible).
 */
export async function frameLoop(
  frameSvg: (p: number) => Promise<string>,
  opts: { durationMs: number; fps: number; holdFrames: number },
  onFrame: (img: HTMLImageElement, i: number, count: number, p: number) => Promise<void> | void
): Promise<void> {
  const total = Math.max(2, Math.round((opts.durationMs / 1000) * opts.fps));
  const count = total + 1 + opts.holdFrames;
  for (let i = 0; i < count; i++) {
    const p = Math.min(1, i / total);
    const img = await svgToImage(await frameSvg(p));
    await onFrame(img, i, count, p);
  }
}

export async function recordWebm(
  frameSvg: (p: number) => Promise<string>,
  opts: { width: number; height: number; durationMs: number; fps?: number; onProgress?: (p: number) => void; bg: string }
): Promise<Blob> {
  if (!webmSupported()) throw new Error("L'export vidéo nécessite MediaRecorder (Chrome, Edge, Firefox récents).");
  const fps = opts.fps ?? 30;
  const canvas = document.createElement("canvas");
  canvas.width = opts.width % 2 ? opts.width + 1 : opts.width;
  canvas.height = opts.height % 2 ? opts.height + 1 : opts.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(fps);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  // Pré-rendu de la 1re image avant de démarrer l'enregistrement
  ctx.drawImage(await svgToImage(await frameSvg(0)), 0, 0, canvas.width, canvas.height);
  rec.start(250);
  const t0 = performance.now();
  await frameLoop(frameSvg, { durationMs: opts.durationMs, fps, holdFrames: Math.round(fps * 1.2) }, async (img, i, count) => {
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    opts.onProgress?.(i / count);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  });
  rec.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}

/** Réglages du GIF : 12 images/s, 960 px de large au plus (poids raisonnable), pause finale de 2 s. */
export const GIF_FPS = 12;
export const GIF_MAX_W = 960;

/**
 * GIF animé (boucle infinie) : mêmes images que la vidéo, encodées côté client (gifenc, MIT) avec une palette
 * de 256 couleurs par image. Aucune donnée ne quitte le navigateur.
 */
export async function recordGif(
  frameSvg: (p: number) => Promise<string>,
  opts: { width: number; height: number; durationMs: number; fps?: number; maxWidth?: number; onProgress?: (p: number) => void; bg: string }
): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const fps = opts.fps ?? GIF_FPS;
  const k = Math.min(1, (opts.maxWidth ?? GIF_MAX_W) / opts.width);
  const w = Math.max(2, Math.round(opts.width * k));
  const h = Math.max(2, Math.round(opts.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  await frameLoop(frameSvg, { durationMs: opts.durationMs, fps, holdFrames: 0 }, async (img, i, count) => {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay: i === count - 1 ? 2000 : delay, repeat: 0 });
    opts.onProgress?.((i + 1) / count);
    // rend la main à l'interface (barre de progression)
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
