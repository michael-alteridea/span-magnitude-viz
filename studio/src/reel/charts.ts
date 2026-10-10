/**
 * Mode « Reel » : graphique d'une scène re-rendu pour le cadre (taille et textes adaptés au format vertical,
 * carré ou paysage), avec les animations existantes — construction des barres / remplissage de la carte
 * (progression `build`) et « zoom dans la marque » entre deux étapes d'exploration parent / enfant.
 * Rendu dans un SVG hors champ (mesures getBBox), puis sérialisé pour l'image composée.
 */
import { isSpecial, parseSpec, type ChartSpec, type DrillStep } from "../spec";
import type { Dataset } from "../data/table";
import { prepareCache, renderChart, type PrepCache } from "../charts/render";
import type { PlotRect } from "../charts/context";
import type { Snapshot } from "../story/snapshots";
import { clearZoom, dominantFill, easeOut, markFill, markForStep, markShape, paintCollapse, paintDive, paintFold, paintVeil, pathDelta } from "../ui/drillZoom";
import { T as T0, type DrillLink, type ReelScene, type Timings } from "./plan";
import { focusDelta } from "../charts/focus";
import { REEL_COLORS } from "./compose";

const SVGNS = "http://www.w3.org/2000/svg";

export interface ReelItem {
  snap: Snapshot;
  ds: Dataset | null;
}

/** Liaison d'exploration entre deux snapshots (descente « in », remontée « out ») et l'étape concernée. */
export function drillLinkOf(a: Snapshot | undefined, b: Snapshot | undefined): { dir: "in" | "out"; step: DrillStep } | null {
  if (!a || !b) return null;
  const x = a.spec as Partial<ChartSpec>;
  const y = b.spec as Partial<ChartSpec>;
  if (x?.type !== "drill" || y?.type !== "drill" || !x.drill || !y.drill) return null;
  return pathDelta(x.drill.path, y.drill.path);
}

/** Liens d'exploration de chaque scène (avec la précédente et la suivante). */
export function drillLinks(snaps: Snapshot[]): { linkIn: DrillLink; linkOut: DrillLink }[] {
  const link = (a: Snapshot | undefined, b: Snapshot | undefined): DrillLink => drillLinkOf(a, b)?.dir ?? (a && b && focusDelta(a.spec, b.spec) === "in" ? "focus" : null);
  return snaps.map((s, i) => ({ linkIn: link(snaps[i - 1], s), linkOut: link(s, snaps[i + 1]) }));
}

interface Prepared {
  key: string;
  spec: ChartSpec;
  cache: PrepCache;
  boost: number;
  /** Cadrage serré sur le contenu (graphique construit) : les marges du rendu « page » ne servent pas dans le Reel. */
  vb: { x: number; y: number; w: number; h: number } | null;
}

export class ReelCharts {
  private host: HTMLElement;
  private svg: SVGSVGElement;
  private prep = new Map<number, Prepared>();
  private fills = new Map<number, string>();

  constructor(
    private items: ReelItem[],
    private scenes: () => ReelScene[],
    private timing: () => Timings = () => ({ ...T0 })
  ) {
    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.host.setAttribute("data-testid", "reel-chart-host");
    this.host.style.cssText = "position:fixed;left:-20000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none";
    this.svg = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
    this.host.append(this.svg);
    document.body.append(this.host);
  }

  dispose(): void {
    this.host.remove();
  }

  /** Spec adaptée au cadre : fond transparent, sans titre ni cartouche (le Reel a les siens). */
  private prepared(i: number, w: number, h: number, textPx: number): Prepared | null {
    const it = this.items[i];
    if (!it || !it.ds) return null;
    const W = Math.max(320, Math.round(w));
    const H = Math.max(240, Math.round(h));
    const key = `${W}x${H}:${textPx}`;
    const hit = this.prep.get(i);
    if (hit && hit.key === key) return hit;
    const parsed = parseSpec(it.snap.spec);
    if (!parsed.ok || isSpecial(parsed.spec.type)) return null;
    const base = parsed.spec;
    const make = (h: number): Prepared => {
      const spec: ChartSpec = {
        ...base,
        branding: "pro",
        style: { ...base.style, title: "", subtitle: "", source: "", brandMark: false, authQr: false, background: "custom", backgroundCustom: REEL_COLORS.bg1, size: { ...base.style.size, preset: "custom", width: W, height: h } },
        story: { ...base.story, comments: [], showComments: false },
      };
      const cache = prepareCache(spec, it.ds, null, -1);
      // secteurs et arcs : étiquettes extérieures nombreuses → textes un peu moins agrandis, le graphique garde de la place
      const radial = base.type === "pie" || base.type === "donut" || base.type === "radialBar";
      const boost = (textPx / 13 / (Math.sqrt(W * h) / 900)) * (radial ? 0.72 : 1);
      const p: Prepared = { key, spec, cache, boost, vb: null };
      // cadrage : boîte englobante du contenu une fois construit (identique pour toutes les images de la scène)
      this.draw(i, p, 1);
      p.vb = this.contentBox(W, h);
      return p;
    };
    let p = make(H);
    // hauteur de rendu ajustée pour que le contenu cadré ait les proportions de la zone (pas de bande vide)
    if (p.vb) {
      const mH = H - p.vb.h;
      const want = Math.round(Math.max(240, Math.min(H * 3, mH + p.vb.w / (W / H))));
      if (Math.abs(want - H) > 12) {
        const q = make(want);
        if (q.vb) p = q;
      }
    }
    this.prep.set(i, p);
    return p;
  }

  private draw(i: number, p: Prepared, build: number, focus?: number, timePos: number | null = null, stampPos: number | null = null): PlotRect {
    clearZoom(this.svg);
    const it = this.items[i]!;
    const res = renderChart(this.svg, p.spec, it.ds, p.cache, { build, timePos, stampPos, ...(focus !== undefined ? { focus } : {}) }, { bare: true, textBoost: p.boost, now: it.snap.generatedAt ? new Date(it.snap.generatedAt) : new Date() });
    return res.plot;
  }

  /** Couleur de la marque parente d'une descente (voile d'émergence de la scène enfant). */
  private parentFill(i: number, w: number, h: number, textPx: number): string {
    const hit = this.fills.get(i);
    if (hit) return hit;
    let fill = "#0E6E8C";
    const prev = this.prepared(i - 1, w, h, textPx);
    const link = drillLinkOf(this.items[i - 1]?.snap, this.items[i]?.snap);
    if (prev && link) {
      this.draw(i - 1, prev, 1);
      const el = markForStep(this.svg, link.step);
      fill = el ? markFill(markShape(el)) : dominantFill(this.svg);
    }
    this.fills.set(i, fill);
    return fill;
  }

  /** Balisage `<svg>` du graphique de la scène i à l'instant local t (s). */
  frame(i: number, t: number, dur: number, box: { w: number; h: number; textPx: number }): string {
    const it = this.items[i];
    const sc = this.scenes()[i];
    if (!it || !sc) return "";
    const T = this.timing();
    // scène « avant mise en avant » : rendue avec le cadrage de la suivante, mise en avant à 0 (coupe sans saut)
    const src = sc.linkOut === "focus" && sc.linkIn !== "focus" && this.items[i + 1]?.ds ? i + 1 : i;
    const p = this.prepared(src, box.w, box.h, box.textPx);
    if (!p) return this.fallback(it.snap, box);
    // descente vers la scène suivante : la scène parente reste construite pendant le zoom
    const build = sc.linkIn === "out" || sc.linkIn === "focus" ? 1 : Math.max(0, Math.min(1, (t - (sc.linkIn === "in" ? 0 : T.chartFrom)) / (T.chartTo - T.chartFrom)));
    const focus = src !== i ? 0 : sc.linkIn === "focus" ? Math.max(0, Math.min(1, (t - T.focusFrom) / T.focus)) : undefined;
    const fill = sc.linkIn === "in" && t < T.emerge ? this.parentFill(i, box.w, box.h, box.textPx) : null;
    // 4D : les pas de temps défilent un à un (valeurs réelles, sans interpolation) entre l'entrée du graphique et la fin de la scène
    const nSteps = p.cache.time?.steps.length ?? 0;
    const span = Math.max(0.5, dur - T.chartFrom - 0.5);
    const cont = nSteps >= 2 ? Math.max(0, Math.min(1, (t - T.chartFrom) / span)) * (nSteps - 1) : null;
    const timePos = cont != null ? Math.min(nSteps - 1, Math.floor(cont + 1e-6)) : null;
    const plot = this.draw(src, p, nSteps >= 2 ? 1 : build, focus, timePos, cont);
    const tail = t - (dur - T.dive);
    if (sc.linkOut === "in" && tail > 0) {
      const link = drillLinkOf(it.snap, this.items[i + 1]?.snap);
      const el = link ? markForStep(this.svg, link.step) : null;
      if (el) paintDive(this.svg, el, plot, tail / T.dive);
    } else if (sc.linkOut === "out" && tail > 0) {
      paintFold(this.svg, plot, dominantFill(this.svg), tail / T.dive);
    } else if (fill) {
      paintVeil(this.svg, plot, fill, 0.92 * (1 - easeOut(t / T.emerge)), "emerge");
    } else if (sc.linkIn === "out" && t < T.emerge) {
      const link = drillLinkOf(this.items[i - 1]?.snap, it.snap);
      paintCollapse(this.svg, link ? markForStep(this.svg, link.step) : null, plot, t / T.emerge);
    }
    return this.serialize(p, box);
  }

  /** Boîte englobante des textes et marques (hors fond), avec une petite marge, bornée au cadre. */
  private contentBox(W: number, H: number): Prepared["vb"] {
    const root = [...this.svg.children].find((c) => c.tagName.toLowerCase() === "g") as SVGGElement | undefined;
    if (!root) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of root.children) {
      if (c.classList.contains("r4d-bg")) continue;
      try {
        const b = (c as SVGGraphicsElement).getBBox();
        if (!(b.width > 0 && b.height > 0)) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
      } catch {
        /* élément non mesurable */
      }
    }
    if (!Number.isFinite(x0)) return null;
    const m = 8;
    x0 = Math.max(0, x0 - m);
    y0 = Math.max(0, y0 - m);
    x1 = Math.min(W, x1 + m);
    y1 = Math.min(H, y1 + m);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private serialize(p: Prepared, box: { w: number; h: number }): string {
    const clone = this.svg.cloneNode(true) as SVGSVGElement;
    if (p.vb) {
      clone.setAttribute("viewBox", `${p.vb.x.toFixed(1)} ${p.vb.y.toFixed(1)} ${p.vb.w.toFixed(1)} ${p.vb.h.toFixed(1)}`);
      clone.setAttribute("width", String(box.w));
      clone.setAttribute("height", String(box.h));
      clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
      clone.setAttribute("overflow", "visible");
    }
    clone.querySelector(".r4d-bg")?.setAttribute("fill-opacity", "0");
    for (const n of clone.querySelectorAll("title, [data-r4d-tip]")) if (n.tagName.toLowerCase() === "title") n.remove();
    clone.removeAttribute("role");
    return new XMLSerializer().serializeToString(clone);
  }

  /** Types spéciaux (carte, film) ou données absentes : rendu conservé du snapshot, légère avancée. */
  private fallback(s: Snapshot, box: { w: number; h: number }): string {
    if (s.svg) {
      const inner = s.svg.replace(/^<\?xml[^>]*>\s*/, "").replace(/<metadata>[\s\S]*?<\/metadata>/, "").replace(/\/\*r4d-fonts\*\//, "");
      const m = /viewBox="([^"]+)"/.exec(inner);
      const vb = m ? m[1] : `0 0 ${s.width} ${s.height}`;
      return `<svg x="0" y="0" width="${box.w}" height="${box.h}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="none"/>${inner.replace(/^<svg[^>]*>/, "<g>").replace(/<\/svg>\s*$/, "</g>")}</svg>`;
    }
    if (s.thumb) return `<svg width="${box.w}" height="${box.h}"><image href="${s.thumb}" x="0" y="0" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    return "";
  }
}
