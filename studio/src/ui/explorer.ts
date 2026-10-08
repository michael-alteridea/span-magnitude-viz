/**
 * « Explorer mes données » : panneau superposé à l'aperçu qui propose 5 à 8 pistes classées
 * (vignette SVG, titre calculé, pourquoi c'est important, « Ouvrir »). Détection déterministe.
 */
import type { Store } from "../state";
import { chartSpecSchema, isSpecial, type ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { explore, KIND_LABELS, type Insight, type StoryContext } from "../story/insights";
import { prepareCache, renderChart } from "../charts/render";
import { ROLE_LABELS } from "../story/snapshots";
import { h, svgIcon, ICONS } from "./dom";

const THUMB_W = 480;
const THUMB_H = 270;

/** Vignette : le graphique seul, petit format, sans textes ni signature. */
export function thumbnailSvg(spec: ChartSpec, ds: Dataset): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "explorer-thumb-svg");
  if (isSpecial(spec.type)) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = `<rect width="24" height="24" fill="transparent"/><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(4 4) scale(.66)">${spec.type === "map" ? ICONS.map : ICONS.film}</g>`;
    return svg;
  }
  const small = chartSpecSchema.parse({
    ...spec,
    mode: { ...spec.mode, kind: "static" },
    style: { ...spec.style, size: { preset: "custom", width: THUMB_W, height: THUMB_H }, valueLabels: false, legend: "none" },
    axes: { ...spec.axes, x: { ...spec.axes.x, title: "" }, y: { ...spec.axes.y, title: "" } },
  });
  const cache = prepareCache(small, ds, null, -1);
  renderChart(svg, small, ds, cache, { build: 1, timePos: null }, { thumb: true });
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return svg;
}

export class Explorer {
  readonly root: HTMLElement;
  private grid: HTMLElement;
  private sub: HTMLElement;
  private insights: Insight[] = [];
  isOpen = false;

  constructor(private store: Store, private ctx: () => StoryContext, private onOpenInsight: (ins: Insight) => void) {
    this.grid = h("div", { class: "explorer-grid", "data-testid": "explorer-grid" });
    this.sub = h("p", { class: "explorer-sub" });
    this.root = h(
      "section",
      { class: "explorer hidden", "data-testid": "explorer", role: "dialog", "aria-label": "Explorer mes données" },
      h(
        "header",
        { class: "explorer-head" },
        h("div", null, h("h2", null, h("span", { html: svgIcon(ICONS.explore, 20) }), "Explorer mes données"), this.sub),
        h("button", { class: "icon-btn", title: "Fermer (Échap)", "data-testid": "explorer-close", html: svgIcon(ICONS.close, 18), onclick: () => this.close() })
      ),
      this.grid
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    const { ds } = this.store.state;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    if (!ds || !ds.rows.length) {
      this.sub.textContent = "Chargez des données (fichier, collage ou exemple) pour obtenir des pistes.";
      this.grid.replaceChildren();
      return;
    }
    const t0 = performance.now();
    this.insights = explore(ds, this.ctx(), { min: 5, max: 8 });
    const ms = Math.round(performance.now() - t0);
    this.sub.textContent = this.insights.length
      ? `${this.insights.length} pistes calculées sur ${ds.rows.length.toLocaleString("fr-FR")} lignes de « ${ds.name} », classées par force du constat (${ms} ms).`
      : "Aucune piste nette : essayez d'ajouter une date, une mesure ou des catégories.";
    this.grid.replaceChildren(...this.insights.map((ins, i) => this.card(ins, i, ds)));
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
  }

  private card(ins: Insight, i: number, ds: Dataset): HTMLElement {
    let thumb: Node;
    try {
      thumb = thumbnailSvg(ins.spec, ds);
    } catch {
      thumb = h("div", { class: "explorer-thumb-missing" }, "Aperçu indisponible");
    }
    const open = () => {
      this.onOpenInsight(ins);
      this.close();
    };
    return h(
      "article",
      { class: "explorer-card", "data-testid": "explorer-card", "data-kind": ins.kind, style: `animation-delay:${i * 40}ms` },
      h("button", { class: "explorer-thumb", title: "Ouvrir ce graphique", onclick: open }, thumb),
      h(
        "div",
        { class: "explorer-meta" },
        h("span", { class: "explorer-kind" }, KIND_LABELS[ins.kind]),
        h("span", { class: `explorer-role role-${ins.analysis.role}` }, ROLE_LABELS[ins.analysis.role]),
        h("span", { class: "explorer-score", title: `Force ${Math.round(ins.effect * 100)} % · couverture ${Math.round(ins.coverage * 100)} %` }, "●".repeat(Math.max(1, Math.round(ins.score * 5))))
      ),
      h("h3", { class: "explorer-title" }, ins.analysis.title),
      h("p", { class: "explorer-why" }, ins.analysis.why),
      h("button", { class: "btn btn-accent explorer-open", "data-testid": "explorer-open", onclick: open }, "Ouvrir")
    );
  }
}
