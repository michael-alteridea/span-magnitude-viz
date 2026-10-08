/**
 * Exports 100 % côté client :
 *  - SVG autonome (polices en base64, styles en attributs) = exactement l'aperçu ;
 *  - PNG 1× / 2× / 3× (rasterisation du même SVG) ;
 *  - configuration JSON (spec ± données) ;
 *  - vidéo WebM (MediaRecorder sur un canevas alimenté image par image) ;
 *  - GIF : réservé à la V2 (voir `exportGif`).
 */
import type { ChartSpec, StudioFile } from "./spec";
import { embeddedFontCss, fontStack } from "./theme";
import type { PlotRect } from "./charts/context";

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
  style.textContent = (await embeddedFontCss(spec.style.font)) + `\ntext{font-family:${font};}`;
  defs.appendChild(style);
  clone.insertBefore(defs, clone.firstChild);
  const meta = document.createElementNS(SVG_NS, "metadata");
  meta.textContent = JSON.stringify({ generator: "Reporting 4D Studio (alteridea)", type: spec.type, created: new Date().toISOString() });
  clone.insertBefore(meta, clone.firstChild);
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

export async function svgToPngBlob(svgText: string, width: number, height: number, scale: number): Promise<Blob> {
  const img = await svgToImage(svgText);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de la rasterisation PNG"))), "image/png"));
}

export function studioFile(spec: ChartSpec, opts: { data?: StudioFile["data"]; sampleId?: string | null }): StudioFile {
  return {
    kind: "reporting-4d-studio",
    version: 1,
    savedAt: new Date().toISOString(),
    spec,
    data: opts.data ?? null,
    sampleId: opts.sampleId ?? null,
  };
}

export function webmSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/**
 * Enregistre une vidéo WebM : `frameSvg(p)` fournit le SVG de la frame à la progression p ∈ [0,1].
 * Le canevas est alimenté au rythme `fps` (temps réel), donc la durée vidéo ≈ durée d'animation.
 */
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
  const total = Math.max(2, Math.round((opts.durationMs / 1000) * fps));
  const holdFrames = Math.round(fps * 1.2); // pause sur l'image finale
  // Pré-rendu de la 1re image avant de démarrer l'enregistrement
  ctx.drawImage(await svgToImage(await frameSvg(0)), 0, 0, canvas.width, canvas.height);
  rec.start(250);
  const t0 = performance.now();
  for (let i = 0; i <= total + holdFrames; i++) {
    const p = Math.min(1, i / total);
    const img = await svgToImage(await frameSvg(p));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    opts.onProgress?.(i / (total + holdFrames));
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  rec.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}

/** GIF animé : prévu en V2 (encodeur côté client, ex. palette + LZW). */
export async function exportGif(): Promise<never> {
  throw new Error("Export GIF : prévu pour la V2. Utilisez l'export vidéo WebM en attendant.");
}
