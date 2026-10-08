/**
 * Montage dans un conteneur : SVG + tableau accessible, animation D3 (respecte prefers-reduced-motion),
 * thème lu dans les variables CSS --ac-* du conteneur, nouveau rendu quand la largeur change.
 */
import { easeCubicOut, select } from "d3";
import "d3-transition";
import type { ChartOptions } from "./frame";
import { svgToPng } from "./png";
import { esc } from "./svg";
import { readTheme, type Theme } from "./theme";

export interface ChartModule<D> {
  toSVG(data: D, options?: ChartOptions, theme?: Theme): string;
  tableRows(data: D, options?: ChartOptions): { head: string[]; rows: string[][] };
}

export interface ChartController<D> {
  /** Racine .ac-chart insérée dans le conteneur. */
  readonly root: HTMLElement;
  readonly svg: SVGSVGElement | null;
  /** Nouveau jeu de données (et options) : rendu puis animation. */
  update(data: D, options?: ChartOptions): Promise<void>;
  /** Rejoue l'animation. */
  replay(): Promise<void>;
  /** SVG courant (chaîne, thème du conteneur appliqué). */
  toSVG(): string;
  /** PNG courant (data URL). */
  toPNG(scale?: number): Promise<string>;
  /** Retire le graphique et ses écouteurs. */
  destroy(): void;
}

const CSS_ID = "alteridea-charts-css";
const CSS = `.ac-chart{position:relative;display:block;width:100%;max-width:100%;font-family:var(--ac-font,Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);color:var(--ac-text,#14262E)}
.ac-chart>svg{display:block;width:100%;height:auto;max-width:100%}
.ac-chart a text{cursor:pointer}
.ac-chart a:focus-visible{outline:2px solid var(--ac-primary,#0E6E8C);outline-offset:2px}
.ac-chart .ac-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
@media (prefers-reduced-motion:reduce){.ac-chart *{transition:none!important;animation:none!important}}`;

function injectCss(doc: Document): void {
  if (doc.getElementById(CSS_ID)) return;
  const st = doc.createElement("style");
  st.id = CSS_ID;
  st.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(st);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const num = (el: Element, a: string): number => parseFloat(el.getAttribute(a) ?? "0") || 0;

/** Joue les animations décrites par les attributs data-ac-* ; résout quand tout est en place. */
export function play(svg: SVGSVGElement, total: number): Promise<void> {
  const els = Array.from(svg.querySelectorAll<SVGElement>("[data-ac-a]"));
  if (!els.length || total <= 0) return Promise.resolve();
  const jobs: Promise<void>[] = [];
  for (const el of els) {
    const a = el.getAttribute("data-ac-a");
    const delay = num(el, "data-ac-t") * total;
    const dur = Math.max(60, num(el, "data-ac-d") * total);
    const s = select(el);
    s.interrupt();
    let tr;
    if (a === "gy") {
      const y = num(el, "y"), h = num(el, "height"), b = num(el, "data-ac-b");
      s.attr("y", b).attr("height", 0);
      tr = s.transition().delay(delay).duration(dur).ease(easeCubicOut).attr("y", y).attr("height", h);
    } else if (a === "gx") {
      const x = num(el, "x"), w = num(el, "width"), b = num(el, "data-ac-b");
      s.attr("x", b).attr("width", 0);
      tr = s.transition().delay(delay).duration(dur).ease(easeCubicOut).attr("x", x).attr("width", w);
    } else if (a === "wipe") {
      const w = num(el, "width");
      s.attr("width", 0);
      tr = s.transition().delay(delay).duration(dur).ease(easeCubicOut).attr("width", w);
    } else if (a === "draw" && "getTotalLength" in el) {
      const len = (el as SVGPathElement).getTotalLength();
      s.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len);
      tr = s.transition().delay(delay).duration(dur).ease(easeCubicOut).attr("stroke-dashoffset", 0).on("end", () => s.attr("stroke-dasharray", null).attr("stroke-dashoffset", null));
    } else {
      s.style("opacity", 0);
      tr = s.transition().delay(delay).duration(dur).style("opacity", 1);
    }
    jobs.push(tr.end().catch(() => undefined));
  }
  return Promise.all(jobs).then(() => undefined);
}

function tableHtml(caption: string, t: { head: string[]; rows: string[][] }): string {
  const th = t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const rows = t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("");
  return `<div class="ac-sr"><table><caption>${esc(caption)}</caption><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Monte un graphique dans un conteneur (élément ou sélecteur CSS) et l'anime. */
export function mount<D>(kind: string, mod: ChartModule<D>, container: Element | string, data: D, options: ChartOptions = {}): ChartController<D> & { ready: Promise<void> } {
  const host = typeof container === "string" ? document.querySelector(container) : container;
  if (!host) throw new Error(`AlterideaCharts : conteneur introuvable (${String(container)})`);
  injectCss(host.ownerDocument ?? document);
  const root = (host.ownerDocument ?? document).createElement("div");
  root.className = `ac-chart ac-chart-${kind}`;
  host.appendChild(root);
  let cur = data;
  let opts = options;
  let lastW = 0;
  let theme: Theme = readTheme(root, opts.theme);
  const width = () => Math.round(opts.width ?? (root.clientWidth || (host as HTMLElement).clientWidth || 720));
  const render = (): string => {
    theme = readTheme(root, opts.theme);
    lastW = width();
    const svg = mod.toSVG(cur, { ...opts, width: lastW }, theme);
    root.innerHTML = svg + tableHtml(opts.title ?? "Données du graphique", mod.tableRows(cur, opts));
    return svg;
  };
  const svgEl = () => root.querySelector<SVGSVGElement>("svg");
  const run = (): Promise<void> => {
    const el = svgEl();
    const total = opts.duration ?? 1600;
    if (!el || prefersReducedMotion() || total <= 0) return Promise.resolve();
    return play(el, total);
  };
  render();
  const ready = run();
  let ro: ResizeObserver | null = null;
  let raf = 0;
  if (opts.width == null && typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = width();
        if (w > 0 && Math.abs(w - lastW) >= 24) render(); // nouveau rendu à la nouvelle largeur, sans rejouer
      });
    });
    ro.observe(root);
  }
  return {
    root,
    ready,
    get svg() {
      return svgEl();
    },
    update(d: D, o?: ChartOptions) {
      cur = d;
      if (o) opts = { ...opts, ...o };
      render();
      return run();
    },
    replay() {
      render();
      return run();
    },
    toSVG() {
      return mod.toSVG(cur, { ...opts, width: lastW || width() }, theme);
    },
    toPNG(scale = 2) {
      return svgToPng(mod.toSVG(cur, { ...opts, width: lastW || width() }, theme), { scale });
    },
    destroy() {
      ro?.disconnect();
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
