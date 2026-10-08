/**
 * Fenêtre « Scénarios » : choix du scénario persona (Directeur commercial…), association des colonnes
 * du fichier courant aux rôles du scénario (date, montant, région, commercial…), puis lancement
 * automatique (snapshots + film) ou pas à pas (clics dans le graphique, guidage dans la barre d'exploration).
 */
import type { Store } from "../state";
import { SCENARIOS, guessBinding, missingRoles, scenarioById, type RoleBinding, type Scenario } from "../story/scenarios";
import { sampleById } from "../data/samples";
import { h, svgIcon, ICONS } from "./dom";

export interface ScenarioDialogActions {
  loadSample(id: string): void;
  start(sc: Scenario, binding: RoleBinding, auto: boolean): void;
}

export class ScenarioDialog {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private current: Scenario = SCENARIOS[0]!;
  private binding: RoleBinding = {};
  private onKey = (e: KeyboardEvent) => e.key === "Escape" && this.close();

  constructor(private store: Store, private actions: ScenarioDialogActions) {
    this.body = h("div", { class: "sc-body" });
    this.root = h(
      "div",
      { class: "mw-overlay sc-overlay hidden", "data-testid": "scenario-dialog", onclick: (e: Event) => e.target === this.root && this.close() },
      h(
        "section",
        { class: "sc", role: "dialog", "aria-modal": "true", "aria-label": "Scénarios de réunion" },
        h(
          "header",
          { class: "mw-head" },
          h("div", null, h("h2", null, h("span", { html: svgIcon(ICONS.clapper, 20) }), "Scénarios de réunion"), h("p", { class: "mw-sub" }, "Un parcours d'exploration rejouable sur n'importe quel fichier : associez vos colonnes aux rôles, puis lancez.")),
          h("button", { class: "icon-btn mw-close", title: "Fermer (Échap)", "aria-label": "Fermer", html: svgIcon(ICONS.close, 20), onclick: () => this.close() })
        ),
        this.body
      )
    );
  }

  open(id?: string): void {
    this.current = scenarioById(id) ?? this.current;
    const ds = this.store.state.ds;
    this.binding = ds ? guessBinding(this.current, ds) : {};
    this.root.classList.remove("hidden");
    document.addEventListener("keydown", this.onKey);
    this.render();
  }

  close(): void {
    this.root.classList.add("hidden");
    document.removeEventListener("keydown", this.onKey);
  }

  /** Lancement direct (tests, bouton de démo) : charge l'exemple si les rôles manquent. */
  run(id: string, auto = true): boolean {
    const sc = scenarioById(id);
    if (!sc) return false;
    let ds = this.store.state.ds;
    if ((!ds || missingRoles(sc, ds, guessBinding(sc, ds)).length) && sc.sampleId) {
      this.actions.loadSample(sc.sampleId);
      ds = this.store.state.ds;
    }
    if (!ds) return false;
    const b = guessBinding(sc, ds);
    if (missingRoles(sc, ds, b).length) return false;
    this.close();
    this.actions.start(sc, b, auto);
    return true;
  }

  private render(): void {
    const ds = this.store.state.ds;
    const sc = this.current;
    const tabs = h(
      "div",
      { class: "sc-list" },
      ...SCENARIOS.map((x) =>
        h("button", { class: `sc-card${x === sc ? " active" : ""}`, type: "button", "data-testid": `scenario-${x.id}`, onclick: () => ((this.current = x), (this.binding = ds ? guessBinding(x, ds) : {}), this.render()) }, h("strong", null, x.label), h("span", null, x.description))
      )
    );
    const cols = ds?.columns ?? [];
    const missing = ds ? missingRoles(sc, ds, this.binding) : sc.roles.filter((r) => r.required);
    const roles = h(
      "div",
      { class: "sc-roles" },
      h("h3", null, "Associer les colonnes aux rôles"),
      ...sc.roles.map((r) => {
        const sel = h(
          "select",
          { "data-testid": `scenario-role-${r.id}` },
          h("option", { value: "" }, r.required ? "— choisir —" : "— aucune —"),
          ...cols.filter((c) => (r.type === "date" ? c.type === "date" : r.type === "number" ? c.type === "number" : c.type === "category" || c.type === "text")).map((c) => h("option", { value: c.name, selected: this.binding[r.id] === c.name }, c.name))
        );
        sel.addEventListener("change", () => {
          this.binding = { ...this.binding, [r.id]: sel.value || null };
          this.render();
        });
        return h("label", { class: `sc-role${missing.includes(r) ? " missing" : ""}` }, h("span", null, r.label, r.required ? " *" : ""), sel, r.help ? h("small", null, r.help) : null);
      })
    );
    const steps = h("ol", { class: "sc-steps" }, ...sc.steps.map((s) => h("li", null, s.name)));
    const sample = sc.sampleId ? sampleById(sc.sampleId) : undefined;
    const onSample = !!sample && this.store.state.sampleId === sample.id;
    const actions = h(
      "div",
      { class: "sc-actions" },
      sample && !onSample ? h("button", { class: "btn", type: "button", "data-testid": "scenario-load-sample", onclick: () => (this.actions.loadSample(sample.id), this.open(sc.id)) }, `Charger « ${sample.name} »`) : null,
      h("span", { class: "spacer" }),
      h("button", { class: "btn", type: "button", "data-testid": "scenario-step", disabled: !ds || missing.length > 0, title: "Vous cliquez vous-même ; la barre d'exploration indique l'étape suivante", onclick: () => (this.close(), this.actions.start(sc, this.binding, false)) }, "Pas à pas"),
      h("button", { class: "btn btn-accent", type: "button", "data-testid": "scenario-run", disabled: !ds || missing.length > 0, title: "Crée les snapshots de chaque étape puis lance le film", onclick: () => (this.close(), this.actions.start(sc, this.binding, true)) }, "▶ Lancer le scénario")
    );
    const note = !ds
      ? h("p", { class: "sc-warn" }, "Chargez d'abord des données (ou la démo).")
      : missing.length
        ? h("p", { class: "sc-warn" }, `À associer : ${missing.map((r) => r.label).join(", ")}.`)
        : h("p", { class: "mw-muted" }, `Données : ${ds.name} · ${ds.rows.length.toLocaleString("fr-FR")} lignes. L'histoire courante est remplacée par « ${sc.storyTitle} ».`);
    this.body.replaceChildren(tabs, h("div", { class: "sc-detail" }, h("h3", null, `${sc.persona} — étapes`), steps, roles, note, actions));
  }
}
