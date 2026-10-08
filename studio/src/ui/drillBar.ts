/**
 * Barre d'exploration (au-dessus de l'aperçu, type « drill ») : fil d'Ariane cliquable avec retour,
 * vues Temps / Répartir dans l'espace / Historique, « Détailler par… », piste suggérée et snapshot.
 * Cibles tactiles ≥ 44 px (iPad).
 */
import type { Store } from "../state";
import type { DrillSpec, DrillView } from "../spec";
import { columnOf } from "../data/table";
import { drillDefaultView as defaultViewFor, detailFields, drillPathLabels, drillTo, drillView, guessPersonField, guessRegionField, isVersionMode, rootGrain } from "../data/drill";
import { drillStory } from "../story/drillStory";
import { applySuggestion } from "../story/drillScenario";
import { nounOf } from "../story/fr";
import { h, svgIcon, ICONS } from "./dom";

export interface DrillBarActions {
  snapshot(): void;
  /** Guidage du scénario en cours (étape k/n, étape suivante). */
  guide?(): string | null;
  /** Étape suivante du scénario en cours (pas à pas) : remplace la piste calculée. */
  guideNext?(): { label: string; drill: DrillSpec } | null;
}

export class DrillBar {
  readonly root: HTMLElement;
  private key = "";
  /** Panneau « Tableau croisé » ouvert. */
  private pivotOpen = false;
  private pivotDs = -1;

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

  /** Referme le panneau « Tableau croisé » (début de scénario). */
  closePivot(): void {
    this.pivotOpen = false;
    this.update();
  }

  update(): void {
    const { spec, ds, dsVersion } = this.store.state;
    const on = spec.type === "drill" && !!ds;
    this.root.hidden = !on;
    if (!on || !ds) return;
    const d = spec.drill;
    // Nouvelles données : le panneau « Tableau croisé » se referme
    if (dsVersion !== this.pivotDs) ((this.pivotDs = dsVersion), (this.pivotOpen = false));
    const guide = this.actions.guide?.() ?? null;
    const key = JSON.stringify([dsVersion, d, guide, this.pivotOpen, this.actions.guideNext?.()?.label ?? null]);
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
    const back = h("button", { class: "drill-btn drill-back", type: "button", title: "Revenir d'un niveau", "aria-label": "Retour", "data-testid": "drill-back", disabled: !d.path.length && d.view === defaultViewFor(d, this.root0()).view && (defaultViewFor(d, this.root0()).by === undefined || d.by === defaultViewFor(d, this.root0()).by), html: svgIcon(ICONS.back, 20), onclick: () => this.back() });

    const region = guessRegionField(ds);
    const person = guessPersonField(ds);
    const vm = isVersionMode(d);
    const timeActive = d.view === "periods" || d.view === "month";
    const viewBtn = (view: DrillView, label: string, icon: string, testid: string, by?: string | null, disabled = false) =>
      h("button", { class: `drill-btn${(view === "periods" ? timeActive : d.view === view && (!by || d.by === by)) ? " active" : ""}`, type: "button", "data-testid": testid, disabled, onclick: () => this.set(view === "periods" ? { ...d, ...defaultViewFor(d, this.root0()) } : drillView(d, view, by ?? d.by)) }, h("span", { html: svgIcon(icon, 18) }), label);
    const pivotBtn = h("button", { class: `drill-btn${d.view === "pivot" || this.pivotOpen ? " active" : ""}`, type: "button", "data-testid": "drill-view-pivot", "aria-expanded": String(this.pivotOpen), title: "Tableau croisé : axe X, séries, mesure, graphique", onclick: () => this.togglePivot() }, h("span", { html: svgIcon(ICONS.table, 18) }), "Tableau croisé");
    const views = vm
      ? h(
          "div",
          { class: "drill-views", role: "group", "aria-label": "Vue" },
          h("button", { class: `drill-btn${d.view === "bridge" ? " active" : ""}`, type: "button", "data-testid": "drill-view-bridge", onclick: () => this.set({ ...d, ...this.bridgeView(d) }) }, h("span", { html: svgIcon(ICONS.variance, 18) }), "Cascade"),
          h("button", { class: `drill-btn${d.view === "compare" ? " active" : ""}`, type: "button", "data-testid": "drill-view-compare", onclick: () => this.set(drillView(d, "compare")) }, h("span", { html: svgIcon(ICONS.bar, 18) }), "Par mois"),
          viewBtn("map", "Répartir dans l'espace", ICONS.globe, "drill-view-map", region, !region),
          pivotBtn
        )
      : h(
          "div",
          { class: "drill-views", role: "group", "aria-label": "Vue" },
          viewBtn("periods", "Temps", ICONS.bar, "drill-view-time"),
          viewBtn("map", "Répartir dans l'espace", ICONS.globe, "drill-view-map", region, !region),
          viewBtn("history", region ? `Historique par ${nounOf(region).sg}` : "Historique", ICONS.history, "drill-view-history", d.by && d.view !== "map" && d.by !== person ? d.by : region, !region && !d.by),
          pivotBtn
        );
    const fields = detailFields(ds, [d.date, d.measure, d.version, ...d.path.filter((p) => p.kind === "cat").map((p) => p.field)]);
    const sel = h(
      "select",
      { class: "drill-select", "data-testid": "drill-detail", "aria-label": "Détailler par…" },
      h("option", { value: "" }, "Détailler par…"),
      ...fields.map((c) => h("option", { value: c.name, selected: d.view === "breakdown" && d.by === c.name }, nounOf(c.name).sg.replace(/^./, (x) => x.toLocaleUpperCase("fr-FR"))))
    );
    sel.addEventListener("change", () => sel.value && this.set(drillView(d, "breakdown", sel.value)));
    const st = drillStory({ drill: d, transform: spec.transform }, ds);
    const sug = st?.suggestion;
    const gn = this.actions.guideNext?.() ?? null;
    const chip = gn
      ? h("button", { class: "drill-btn drill-suggest", type: "button", "data-testid": "drill-suggest", title: "Étape suivante du scénario", onclick: () => this.set(gn.drill) }, h("span", { html: svgIcon(ICONS.next, 18) }), gn.label)
      : sug
      ? h("button", { class: "drill-btn drill-suggest", type: "button", "data-testid": "drill-suggest", title: "Piste suivante calculée sur les données", onclick: () => this.suggest() }, h("span", { html: svgIcon(ICONS.next, 18) }), sug.label)
      : null;
    const snap = h("button", { class: "drill-btn drill-snap", type: "button", "data-testid": "drill-snapshot", title: "Ajouter cette vue à l'histoire", onclick: () => this.actions.snapshot() }, "📸 Snapshot");
    this.root.replaceChildren(
      h("div", { class: "drill-row" }, back, crumbs, h("span", { class: "spacer" }), snap),
      h("div", { class: "drill-row" }, views, sel, h("span", { class: "spacer" }), chip),
      ...(this.pivotOpen ? [this.pivotPanel(d, fields.map((c) => c.name), region)] : []),
      ...(guide ? [h("div", { class: "drill-guide", "data-testid": "drill-guide" }, guide)] : [])
    );
  }

  /** Cascade du niveau courant (niveau suivant de la hiérarchie). */
  private bridgeView(d: DrillSpec): Partial<DrillSpec> {
    const def = defaultViewFor(d, this.root0());
    return def.view === "bridge" ? def : { view: "bridge", by: d.levels.find((f) => !d.path.some((p) => p.field === f)) ?? d.by };
  }

  togglePivot(): void {
    const d = this.store.state.spec.drill;
    this.pivotOpen = !this.pivotOpen || d.view !== "pivot";
    if (this.pivotOpen && d.view !== "pivot") this.applyPivot({});
    else this.update();
  }

  /** Applique les réglages du tableau croisé (graphique Cascade / Carte → vues dédiées). */
  private applyPivot(patch: Partial<DrillSpec["pivot"]>): void {
    const { spec, ds } = this.store.state;
    const d = spec.drill;
    const vm = isVersionMode(d);
    const p = { ...d.pivot, ...patch };
    if (!p.x) p.x = vm ? d.levels.find((f) => !d.path.some((s) => s.field === f)) ?? "@quarter" : "@month";
    if (p.agg === "delta" && !vm) p.agg = "sum";
    const region = ds ? guessRegionField(ds) : null;
    if (p.chart === "bridge" && vm && !p.x.startsWith("@")) this.set({ ...d, pivot: p, view: "bridge", by: p.x });
    else if (p.chart === "map" && region) this.set({ ...d, pivot: p, view: "map", by: region });
    else this.set({ ...d, pivot: { ...p, chart: p.chart === "line" ? "line" : "bar" }, view: "pivot" });
  }

  private pivotPanel(d: DrillSpec, fields: string[], region: string | null): HTMLElement {
    const vm = isVersionMode(d);
    const p = d.pivot;
    const cap = (x: string) => x.replace(/^./, (c) => c.toLocaleUpperCase("fr-FR"));
    const field = (name: string, testid: string, value: string, opts: [string, string, boolean?][], onchange: (v: string) => void) => {
      const sel = h("select", { class: "drill-select", "data-testid": testid, "aria-label": name }, ...opts.map(([v, l, dis]) => h("option", { value: v, selected: v === value, disabled: !!dis }, l)));
      sel.addEventListener("change", () => onchange(sel.value));
      return h("label", { class: "pivot-field" }, h("span", null, name), sel);
    };
    const xNow = p.x ?? (vm ? d.levels.find((f) => !d.path.some((s) => s.field === f)) ?? "@quarter" : "@month");
    const xOpts: [string, string][] = [["@month", "Mois"], ["@quarter", "Trimestre"], ...(vm ? [] : ([["@year", "Année"]] as [string, string][])), ...fields.map((f): [string, string] => [f, cap(nounOf(f).sg)])];
    const sOpts: [string, string][] = [["", "Aucune"], ...(vm ? ([["@version", "Versions"]] as [string, string][]) : []), ...fields.filter((f) => f !== xNow).map((f): [string, string] => [f, cap(nounOf(f).sg)])];
    const aOpts: [string, string, boolean?][] = [["sum", "Somme"], ["mean", "Moyenne"], ["count", "Nombre de lignes"], ["delta", vm ? `Écart ${d.to} vs ${d.from}` : "Écart entre versions", !vm]];
    const chartNow = d.view === "bridge" ? "bridge" : d.view === "map" ? "map" : p.chart === "line" ? "line" : "bar";
    const cOpts: [string, string, boolean?][] = [["bar", "Barres"], ["bridge", "Cascade", !vm || xNow.startsWith("@")], ["line", "Lignes"], ["map", "Carte", !region]];
    return h(
      "div",
      { class: "drill-row pivot-panel", "data-testid": "pivot-panel", role: "group", "aria-label": "Tableau croisé" },
      field("X", "pivot-x", xNow, xOpts, (v) => this.applyPivot({ x: v, series: p.series === v ? null : p.series })),
      field("Séries", "pivot-series", p.series ?? "", sOpts, (v) => this.applyPivot({ series: v || null })),
      field("Mesure", "pivot-agg", vm || p.agg !== "delta" ? p.agg : "sum", aOpts, (v) => this.applyPivot({ agg: v as DrillSpec["pivot"]["agg"] })),
      field("Graphique", "pivot-chart", chartNow, cOpts, (v) => this.applyPivot({ chart: v as DrillSpec["pivot"]["chart"] })),
      h("span", { class: "pivot-scope" }, d.path.length ? `Filtres : ${drillPathLabels(d).slice(1).join(" › ")}` : "Toutes les données")
    );
  }

  back(): void {
    const d = this.store.state.spec.drill;
    const def = defaultViewFor(d, this.root0());
    // Vue « carte / historique / détail » : retour à la vue temps du même niveau, sinon niveau précédent
    if (d.view !== def.view || (d.view === "periods" && d.grain !== def.grain) || (def.by !== undefined && d.by !== def.by)) this.set({ ...d, ...def });
    else if (d.path.length) this.set(drillTo(d, d.path.length - 1, this.root0()));
  }

  suggest(): void {
    const { spec, ds } = this.store.state;
    if (!ds) return;
    const next = applySuggestion(spec.drill, ds);
    if (next) this.set(next);
  }
}
