/**
 * Panneau Données (gauche), simplifié : jeu de données courant, « Changer de données » (ouvre la fenêtre
 * Données : fichier, collage, récents, exemples, données publiques) et aperçu du tableau avec types détectés
 * (modifiables).
 */
import type { Store } from "../state";
import { SAMPLES, PUBLIC_THEMES, type Sample } from "../data/samples";
import { COLUMN_TYPE_LABELS, type ColumnType } from "../data/table";
import { ACCEPTED_EXT } from "../data/files";
import { formatCell } from "../format";
import { h, svgIcon, ICONS } from "./dom";

export interface DataActions {
  loadSample(id: string): void;
  importText(text: string): void;
  importFile(file: File): void;
  changeSheet(name: string): void;
  explore(): void;
  /** Fenêtre « Mise en forme des données » (dernier fichier ou tableau courant). */
  reshape(): void;
  /** Modifie une cellule (index de ligne brute, colonne, texte saisi). */
  editCell(row: number, column: string, text: string): void;
  /** « Créer un Reel » sur un exemple de données publiques (histoire suggérée de 3 à 5 snapshots). */
  reelSample(id: string): void;
  /** « Scénarios » de réunion (bouton à droite du titre « Exemples », fenêtre Données). */
  scenarios?(): void;
  /** Fenêtre « Données » (Changer de données). */
  openData?(): void;
}

const TYPE_ORDER: ColumnType[] = ["number", "date", "category", "text"];

export class DataPanel {
  readonly root: HTMLElement;
  private store: Store;
  private info: HTMLElement;
  private table: HTMLElement;
  private key = "";

  constructor(store: Store, actions: DataActions) {
    this.store = store;
    this.info = h("div", { class: "ds-info", "data-testid": "ds-info" });
    this.table = h("div", { class: "table-wrap", "data-testid": "data-table" });
    const sheetHost = h("div", { class: "sheet-host" });
    this.sheetHost = sheetHost;
    this.actions = actions;
    this.filterInput.addEventListener("input", () => {
      this.filter = this.filterInput.value;
      this.key = "";
      this.update();
    });

    this.root = h(
      "aside",
      { class: "panel panel-left", "data-testid": "data-panel" },
      h(
        "header",
        { class: "panel-head" },
        h("span", { class: "panel-icon", html: svgIcon(ICONS.table, 18) }),
        h("h2", null, "Données"),
        h("button", { class: "icon-btn collapse-btn", title: "Replier le panneau", html: svgIcon(ICONS.chevronL, 18), onclick: () => store.setUi({ leftCollapsed: !store.state.ui.leftCollapsed }) })
      ),
      h(
        "div",
        { class: "panel-body" },
        // Variante B : « Explorer mes données » en tête du panneau (il quitte la barre du haut)
        h("button", { type: "button", class: "btn btn-explore-panel", "data-testid": "explore-data", title: "Pistes de graphiques calculées sur vos données (tendance, concentration, écarts, pipeline…)", onclick: () => actions.explore() }, h("span", { html: svgIcon(ICONS.explore, 16) }), "Explorer mes données"),
        // Panneau simplifié : jeu courant + « Changer de données » (fichier, collage, récents, exemples, données publiques → fenêtre Données)
        h(
          "div",
          { class: "block ds-current", "data-testid": "ds-current" },
          h("h3", null, "Jeu de données"),
          this.info,
          h("button", { type: "button", class: "btn btn-accent ds-change", "data-testid": "data-open", title: "Importer un fichier, coller un tableau, rouvrir un jeu récent, choisir un exemple ou des données publiques", onclick: () => actions.openData?.() }, h("span", { html: svgIcon(ICONS.folder, 16) }), "Changer de données"),
          h("p", { class: "ds-change-hint" }, "Fichier, collage, récents, exemples, données publiques")
        ),
        h(
          "div",
          { class: "block grow" },
          h("h3", { class: "preview-head" }, "Aperçu", this.editBtn),
          sheetHost,
          this.filterRow,
          this.table
        )
      )
    );
  }

  private sheetHost: HTMLElement;
  private actions: DataActions;
  /** Mode « Modifier les données » : cellules modifiables, filtre des lignes. */
  private editing = false;
  private filter = "";
  private editBtn: HTMLButtonElement = h(
    "button",
    { class: "btn btn-mini data-edit", type: "button", "data-testid": "data-edit", "aria-pressed": "false", title: "Modifier les valeurs et les libellés du tableau (comme vos propres données)", onclick: () => this.toggleEdit() },
    h("span", { html: svgIcon(ICONS.edit, 14) }),
    "Modifier"
  );
  private filterInput: HTMLInputElement = h("input", { type: "search", class: "data-filter", placeholder: "Filtrer les lignes (ex. Belgique 2024)…", "aria-label": "Filtrer les lignes", "data-testid": "data-filter" });
  private filterRow: HTMLElement = h("div", { class: "data-filter-row", hidden: true }, this.filterInput);

  private toggleEdit(on = !this.editing): void {
    this.editing = on;
    this.editBtn.classList.toggle("active", on);
    this.editBtn.setAttribute("aria-pressed", String(on));
    this.editBtn.lastChild!.textContent = on ? "Terminer" : "Modifier";
    this.filterRow.hidden = !on;
    this.key = "";
    this.update();
  }

  update(): void {
    const { ds, dsVersion, sampleId, importNote, sheets, sheet } = this.store.state;
    const key = `${dsVersion}|${this.editing ? 1 : 0}|${this.filter}`;
    if (key === this.key) return;
    this.key = key;
    if (!ds) {
      this.info.textContent = "Aucune donnée chargée.";
      this.table.replaceChildren();
      this.sheetHost.replaceChildren();
      return;
    }
    this.info.replaceChildren(
      h("strong", null, ds.name),
      h("span", { class: "ds-size" }, `${ds.rows.length.toLocaleString("fr-FR")} lignes × ${ds.columns.length} colonnes`),
      ...(importNote ? [h("small", null, importNote)] : [])
    );
    if (sheets && sheets.length > 1) {
      const sel = h("select", { "aria-label": "Feuille" }, ...sheets.map((s) => h("option", { value: s, selected: s === sheet }, s)));
      sel.addEventListener("change", () => this.actions.changeSheet(sel.value));
      this.sheetHost.replaceChildren(h("label", { class: "field" }, h("span", { class: "field-label" }, "Feuille Excel"), sel));
    } else this.sheetHost.replaceChildren();

    const head = h(
      "tr",
      null,
      ...ds.columns.map((c) => {
        const sel = h(
          "select",
          { class: `type-badge t-${c.type}`, title: `Type détecté : ${COLUMN_TYPE_LABELS[c.detected]} — cliquez pour changer`, "data-col": c.name },
          ...TYPE_ORDER.map((t) => h("option", { value: t, selected: t === c.type }, COLUMN_TYPE_LABELS[t] + (t === c.detected ? " ✓" : "")))
        );
        sel.addEventListener("change", () => this.store.retype(c.name, sel.value as ColumnType));
        return h("th", null, h("div", { class: "th-name", title: c.name }, c.name), sel);
      })
    );
    const MAX = 60;
    // Filtre (mode modification) : tous les mots doivent apparaître dans la ligne (casse et accents ignorés)
    const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const words = this.editing ? norm(this.filter).split(/\s+/).filter(Boolean) : [];
    const idx: number[] = [];
    for (let i = 0; i < ds.rows.length && idx.length < MAX; i++) {
      if (words.length) {
        const r = ds.rows[i]!;
        const line = norm(ds.columns.map((c) => formatCell(r[c.name], c.type)).join(" "));
        if (!words.every((w) => line.includes(w))) continue;
      }
      idx.push(i);
    }
    const matching = words.length ? ds.rows.filter((r) => { const line = norm(ds.columns.map((c) => formatCell(r[c.name], c.type)).join(" ")); return words.every((w) => line.includes(w)); }).length : ds.rows.length;
    const body = idx.map((i) => {
      const r = ds.rows[i]!;
      return h(
        "tr",
        null,
        ...ds.columns.map((c) => {
          const v = r[c.name];
          const txt = formatCell(v, c.type);
          const rawV = ds.raw[i]?.[c.name];
          const bad = v == null && rawV !== "" && rawV != null;
          const cls = `${c.type === "number" ? "num" : ""}${bad ? " bad" : ""}`;
          if (!this.editing) return h("td", { class: cls, title: bad ? `Valeur non reconnue : ${String(rawV)}` : null }, txt);
          const inp = h("input", { class: "cell-input", value: txt, "aria-label": `${c.name}, ligne ${i + 1}`, "data-row": String(i), "data-col": c.name, inputmode: c.type === "number" ? "decimal" : null });
          const commit = () => {
            if (inp.value !== txt) this.actions.editCell(i, c.name, inp.value);
          };
          inp.addEventListener("change", commit);
          inp.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") inp.blur();
            else if (e.key === "Escape") (inp.value = txt), inp.blur();
          });
          return h("td", { class: `${cls} editing`, title: bad ? `Valeur non reconnue : ${String(rawV)}` : null }, inp);
        })
      );
    });
    this.table.replaceChildren(
      h("table", { class: this.editing ? "is-editing" : null }, h("thead", null, head), h("tbody", null, ...body)),
      ...(matching > idx.length ? [h("p", { class: "muted small" }, `… ${(matching - idx.length).toLocaleString("fr-FR")} lignes de plus${this.editing ? " : filtrez pour retrouver une ligne" : ""}`)] : []),
      ...(this.editing && !idx.length ? [h("p", { class: "muted small" }, "Aucune ligne ne correspond au filtre.")] : [])
    );
  }
}
