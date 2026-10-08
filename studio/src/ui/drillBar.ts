/**
 * Barre d'exploration (au-dessus de l'aperçu, type « drill ») : fil d'Ariane cliquable avec retour,
 * vues Temps / Répartir dans l'espace / Historique, « Détailler par… », piste suggérée et snapshot.
 * Cibles tactiles ≥ 44 px (iPad).
 */
import type { Store } from "../state";
import type { DrillSpec, DrillView } from "../spec";
import { columnOf } from "../data/table";
import { drillDefaultView as defaultViewFor, detailFields, drillPathLabels, drillTo, drillView, guessPersonField, guessRegionField, rootGrain } from "../data/drill";
import { drillStory } from "../story/drillStory";
import { applySuggestion } from "../story/drillScenario";
import { nounOf } from "../story/fr";
import { h, svgIcon, ICONS } from "./dom";

export interface DrillBarActions {
  snapshot(): void;
  /** Guidage du scénario en cours (étape k/n, étape suivante). */
  guide?(): string | null;
}

export class DrillBar {
  readonly root: HTMLElement;
  private key = "";

  constructor(private store: Store, private actions: DrillBarActions) {
    this.root = h("nav", { class: "drill-bar", "data-testid": "drill-bar", "aria-label": "Exploration guidée", hidden: true });
  }

  private set(d: DrillSpec): void {
    this.store.set("drill", d);
  }

  private root0(): ReturnType<typeof rootGrain> {
    const { spec, ds } = this.store.state;
    return ds && spec.drill.date && columnOf(ds, spec.drill.date) ? rootGrain(ds, spec.drill.date) : spec.drill.grain;
  }

  update(): void {
    const { spec, ds, dsVersion } = this.store.state;
    const on = spec.type === "drill" && !!ds;
    this.root.hidden = !on;
    if (!on || !ds) return;
    const d = spec.drill;
    const guide = this.actions.guide?.() ?? null;
    const key = JSON.stringify([dsVersion, d, guide]);
    if (key === this.key) return;
    this.key = key;
    const labels = drillPathLabels(d);
    const crumbs = h(
      "ol",
      { class: "drill-crumbs", "data-testid": "drill-crumbs" },
      ...labels.map((l, i) => {
        const last = i === labels.length - 1;
        return h(
          "li",
          null,
          i ? h("span", { class: "drill-sep", "aria-hidden": "true" }, "›") : null,
          h("button", { class: `drill-crumb${last ? " current" : ""}`, type: "button", "data-testid": `drill-crumb-${i}`, "aria-current": last ? "page" : null, disabled: last && d.view === defaultViewFor(d, this.root0()).view, onclick: () => this.set(drillTo(d, i, this.root0())) }, l)
        );
      })
    );
    const back = h("button", { class: "drill-btn drill-back", type: "button", title: "Revenir d'un niveau", "aria-label": "Retour", "data-testid": "drill-back", disabled: !d.path.length && (d.view === "periods" || d.view === "bridge"), html: svgIcon(ICONS.back, 20), onclick: () => this.back() });

    const region = guessRegionField(ds);
    const person = guessPersonField(ds);
    const timeActive = d.view === "periods" || d.view === "month";
    const viewBtn = (view: DrillView, label: string, icon: string, testid: string, by?: string | null, disabled = false) =>
      h("button", { class: `drill-btn${(view === "periods" ? timeActive : d.view === view && (!by || d.by === by)) ? " active" : ""}`, type: "button", "data-testid": testid, disabled, onclick: () => this.set(view === "periods" ? { ...d, ...defaultViewFor(d, this.root0()) } : drillView(d, view, by ?? d.by)) }, h("span", { html: svgIcon(icon, 18) }), label);
    const views = h(
      "div",
      { class: "drill-views", role: "group", "aria-label": "Vue" },
      viewBtn("periods", "Temps", ICONS.bar, "drill-view-time"),
      viewBtn("map", "Répartir dans l'espace", ICONS.globe, "drill-view-map", region, !region),
      viewBtn("history", region ? `Historique par ${nounOf(region).sg}` : "Historique", ICONS.history, "drill-view-history", d.by && d.view !== "map" && d.by !== person ? d.by : region, !region && !d.by)
    );
    const fields = detailFields(ds, [d.date, d.measure, ...d.path.filter((p) => p.kind === "cat").map((p) => p.field)]);
    const sel = h(
      "select",
      { class: "drill-select", "data-testid": "drill-detail", "aria-label": "Détailler par…" },
      h("option", { value: "" }, "Détailler par…"),
      ...fields.map((c) => h("option", { value: c.name, selected: d.view === "breakdown" && d.by === c.name }, nounOf(c.name).sg.replace(/^./, (x) => x.toLocaleUpperCase("fr-FR"))))
    );
    sel.addEventListener("change", () => sel.value && this.set(drillView(d, "breakdown", sel.value)));
    const st = drillStory({ drill: d, transform: spec.transform }, ds);
    const sug = st?.suggestion;
    const chip = sug
      ? h("button", { class: "drill-btn drill-suggest", type: "button", "data-testid": "drill-suggest", title: "Piste suivante calculée sur les données", onclick: () => this.suggest() }, h("span", { html: svgIcon(ICONS.next, 18) }), sug.label)
      : null;
    const snap = h("button", { class: "drill-btn drill-snap", type: "button", "data-testid": "drill-snapshot", title: "Ajouter cette vue à l'histoire", onclick: () => this.actions.snapshot() }, "📸 Snapshot");
    this.root.replaceChildren(
      h("div", { class: "drill-row" }, back, crumbs, h("span", { class: "spacer" }), snap),
      h("div", { class: "drill-row" }, views, sel, h("span", { class: "spacer" }), chip),
      ...(guide ? [h("div", { class: "drill-guide", "data-testid": "drill-guide" }, guide)] : [])
    );
  }

  back(): void {
    const d = this.store.state.spec.drill;
    const def = defaultViewFor(d, this.root0());
    // Vue « carte / historique / détail » : retour à la vue temps du même niveau, sinon niveau précédent
    if (d.view !== def.view || (d.view === "periods" && d.grain !== def.grain)) this.set({ ...d, ...def });
    else if (d.path.length) this.set(drillTo(d, d.path.length - 1, this.root0()));
  }

  suggest(): void {
    const { spec, ds } = this.store.state;
    if (!ds) return;
    const next = applySuggestion(spec.drill, ds);
    if (next) this.set(next);
  }
}
