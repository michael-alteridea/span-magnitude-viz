/**
 * Export Morph, côté navigateur : rendu du graphique d'un snapshot, extraction des barres (rectangles SVG)
 * en formes natives nommées « !!… » d'après leurs clés de données, et image de fond sans ces barres
 * (axes, libellés, cartouche avec QR vers le mode lecture). Séquence de construction facultative :
 * amorce (barres à zéro) puis graphique complet.
 */
import type { ChartSpec } from "../spec";
import { chartSize } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, renderChart } from "../charts/render";
import { composeSvg, svgToPngBlob, blobToDataUrl } from "../export";
import { cssColorHex, markName, uniqueNames, zoomName, type NativeMark, type NativeSlide } from "./morph";

type DrillStep = ChartSpec["drill"]["path"][number];

const MARK_SEL = "rect.r4d-drill-mark, rect.r4d-drill-ref, rect.r4d-drill-var, g.r4d-drill-ref > rect, .r4d-marks rect";

export interface NativeInput {
  spec: ChartSpec;
  ds: Dataset;
  now: Date;
  sharedMax: number | null;
  scaleNote: string | null;
  qrUrl: string | null;
  /** Séquence de construction : amorce + complet. */
  build: boolean;
  /** Étape de zoom vers la diapositive suivante : la barre correspondante prend le nom `zoomName(zoomOutIndex)`. */
  zoomOut: { step: DrillStep; index: number } | null;
  /** Zoom depuis la diapositive précédente : zone du détail nommée `zoomName(zoomInIndex)` sur la première étape. */
  zoomInIndex: number | null;
}

function kindOf(el: Element): string {
  const c = el.getAttribute("class") ?? "";
  const p = el.parentElement?.getAttribute("class") ?? "";
  if (/r4d-drill-var/.test(c)) return "ecart";
  if (/r4d-drill-ref/.test(c) || /r4d-drill-ref/.test(p)) return "ref";
  if (/r4d-drill-mark/.test(c)) return "barre";
  return "marque";
}

function keysOf(el: Element, svg: SVGSVGElement): string[] {
  const keys: string[] = [];
  const panels = [...svg.querySelectorAll("g.r4d-drill-panel")];
  for (let a: Element | null = el.parentElement; a && a !== svg; a = a.parentElement) {
    const k = a.getAttribute("data-drill-key");
    const v = a.getAttribute("data-drill-value");
    if (k) keys.unshift(k);
    else if (v) keys.unshift(`${a.getAttribute("data-drill-field") ?? ""}=${v}`);
    if (a.classList.contains("r4d-drill-panel")) keys.unshift(`panneau${panels.indexOf(a)}`);
  }
  return keys;
}

function opacityOf(el: Element, svg: SVGSVGElement): number {
  let o = Number(getComputedStyle(el).fillOpacity || 1);
  for (let a: Element | null = el; a && a !== svg; a = a.parentElement) {
    const v = Number(getComputedStyle(a).opacity);
    if (Number.isFinite(v)) o *= v;
  }
  return o;
}

function zoomTargetEl(svg: SVGSVGElement, step: DrillStep): Element | null {
  if (step.kind === "period") return svg.querySelector(`[data-drill-key="${step.start}"] .r4d-drill-mark`);
  const g = [...svg.querySelectorAll(`[data-drill-kind="cat"]`)].find((el) => el.getAttribute("data-drill-value") === step.value) ?? null;
  if (!g) return null;
  return g.matches("rect") ? g : g.querySelector("rect.r4d-drill-mark");
}

/** Rendu d'une étape : marques extraites (fractions de l'image) et PNG de fond sans elles. */
async function renderStage(inp: NativeInput, build: number, stage: NativeSlide["stage"], first: boolean, last: boolean): Promise<NativeSlide> {
  const { width: W, height: H } = chartSize(inp.spec);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;opacity:0;pointer-events:none;overflow:hidden;`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  host.append(svg);
  document.body.append(host);
  try {
    const cache = prepareCache(inp.spec, inp.ds, null, -1);
    const res = renderChart(svg, inp.spec, inp.ds, cache, { build, timePos: null }, { bare: true, sharedMax: inp.sharedMax, scaleNote: inp.scaleNote, now: inp.now, qrUrl: inp.qrUrl });
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    const toSvg = svg.getScreenCTM()?.inverse() ?? null;
    const zoomEl = inp.zoomOut ? zoomTargetEl(svg, inp.zoomOut.step) : null;
    const found: { el: SVGGraphicsElement; mark: NativeMark }[] = [];
    const counts = new Map<string, number>();
    for (const node of svg.querySelectorAll(MARK_SEL)) {
      const el = node as SVGGraphicsElement;
      if (el.closest(".r4d-cartouche, defs, pattern, clipPath, mask")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const fill = cssColorHex(cs.fill);
      const stroke = cssColorHex(cs.stroke);
      const fillAttr = cs.fill ?? "";
      if (!fill && (!stroke || fillAttr.startsWith("url"))) continue; // hachures : restent dans l'image
      const bb = el.getBBox();
      const m = toSvg && el.getScreenCTM() ? toSvg.multiply(el.getScreenCTM()!) : null;
      const pts = [
        [bb.x, bb.y],
        [bb.x + bb.width, bb.y],
        [bb.x, bb.y + bb.height],
        [bb.x + bb.width, bb.y + bb.height],
      ].map(([x, y]) => (m ? { x: m.a * x! + m.c * y! + m.e, y: m.b * x! + m.d * y! + m.f } : { x: x!, y: y! }));
      const x0 = Math.min(...pts.map((p) => p.x));
      const y0 = Math.min(...pts.map((p) => p.y));
      const x1 = Math.max(...pts.map((p) => p.x));
      const y1 = Math.max(...pts.map((p) => p.y));
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
      const kind = kindOf(el);
      const keys = keysOf(el, svg);
      const base = `${kind}|${keys.join("/")}`;
      const idx = counts.get(base) ?? 0;
      counts.set(base, idx + 1);
      const name = el === zoomEl && inp.zoomOut ? zoomName(inp.zoomOut.index) : markName(kind, keys, idx);
      const dash = !!cs.strokeDasharray && cs.strokeDasharray !== "none";
      found.push({ el, mark: { name, x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H, fill, opacity: Math.max(0, Math.min(1, opacityOf(el, svg))), stroke: fill ? null : stroke, dash } });
    }
    for (const f of found) f.el.setAttribute("visibility", "hidden");
    const marks = found.map((f) => f.mark);
    const names = uniqueNames(marks.map((m) => m.name));
    marks.forEach((m, k) => (m.name = names[k]!));
    if (first && inp.zoomInIndex !== null) {
      // zone du détail : la barre cliquée de la diapositive précédente s'y déploie en s'effaçant
      const p = res.plot;
      const color = marks.find((m) => m.fill)?.fill ?? "#0E6E8C";
      marks.unshift({ name: zoomName(inp.zoomInIndex), x: p.x / W, y: p.y / H, w: p.w / W, h: p.h / H, fill: color, opacity: 0, stroke: null, dash: false });
    }
    const text = await composeSvg({ svg, spec: inp.spec, plot: res.plot, specialHost: null, embedFonts: true });
    const blob = await svgToPngBlob(text, W, H, 3);
    return { bg: { data: await blobToDataUrl(blob), width: W, height: H }, marks, stage };
  } finally {
    host.remove();
  }
}

/** Étapes natives d'un snapshot (amorce + complet, ou complet seul). */
export async function nativeStages(inp: NativeInput): Promise<NativeSlide[]> {
  const out: NativeSlide[] = [];
  if (inp.build) out.push(await renderStage(inp, 0, "amorce", true, false));
  out.push(await renderStage(inp, 1, "complet", !inp.build, true));
  return out;
}
