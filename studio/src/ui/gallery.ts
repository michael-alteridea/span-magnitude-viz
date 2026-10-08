/** Galerie des types de graphiques (au-dessus de l'aperçu). */
import type { Store } from "../state";
import { CHART_FAMILIES, CHART_TYPE_LABELS, type ChartType } from "../spec";
import { h, svgIcon, ICONS } from "./dom";
import { DISCOURAGED_TIP, isDiscouraged } from "../norme";

const SHORT: Record<ChartType, string> = {
  bar: "Barres",
  barH: "Horizontales",
  groupedBar: "Groupées",
  stackedBar: "Empilées",
  line: "Lignes",
  area: "Aires",
  stackedArea: "Aires emp.",
  scatter: "Points",
  pie: "Camembert",
  donut: "Donut",
  radialBar: "Arcs radiaux",
  variance: "Écarts",
  film: "Film 4D",
  map: "Carte",
  drill: "Zoom",
};

export class Gallery {
  readonly root: HTMLElement;
  private btns = new Map<ChartType, HTMLButtonElement>();

  constructor(private store: Store, onPick: (t: ChartType) => void) {
    this.root = h(
      "nav",
      { class: "gallery", "aria-label": "Type de graphique", "data-testid": "gallery" },
      ...CHART_FAMILIES.map((f) =>
        h(
          "div",
          { class: `family${f.label === "Spéciaux" ? " special" : ""}` },
          h("span", { class: "family-label" }, f.label),
          h(
            "div",
            { class: "family-items" },
            ...f.types.map((t) => {
              const b = h(
                "button",
                { class: "type-tile", title: CHART_TYPE_LABELS[t], "data-type": t, "data-testid": `type-${t}`, onclick: () => onPick(t) },
                h("span", { class: "tile-icon", html: svgIcon(ICONS[t], 22) }),
                h("span", { class: "tile-label" }, SHORT[t])
              );
              this.btns.set(t, b);
              return b;
            })
          )
        )
      )
    );
  }

  update(): void {
    const { type: cur, norme } = this.store.state.spec;
    for (const [t, b] of this.btns) {
      b.classList.toggle("active", t === cur);
      b.setAttribute("aria-pressed", t === cur ? "true" : "false");
      // Mode norme : camembert, donut, arcs radiaux déconseillés (le clic propose des barres)
      const off = norme.enabled && isDiscouraged(t);
      b.classList.toggle("disabled", off);
      if (off) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
      b.title = off ? `${CHART_TYPE_LABELS[t]} : ${DISCOURAGED_TIP}` : CHART_TYPE_LABELS[t];
    }
  }
}
