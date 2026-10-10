/**
 * Panneau gauche « Datasets » (modèle « dataset d'abord ») :
 * - la **source** en tête (une seule par projet) : nom, taille, Remplacer (fenêtre Données), Aperçu ;
 * - ses **datasets dérivés** en arbre (point de couleur, D1 · lignes · scènes, filtres en pastilles ; l'actif,
 *   celui du graphique, est surligné ; toucher = le graphique l'utilise) et « + Nouveau dataset depuis la source » ;
 * - les **colonnes** du dataset actif et « Explorer ce dataset » ;
 * - l'aperçu de la source (types détectés modifiables, cellules modifiables).
 */
import type { Store } from "../state";
import { SAMPLES, PUBLIC_THEMES, type Sample } from "../data/samples";
import { COLUMN_TYPE_LABELS, type ColumnType } from "../data/table";
import { ACCEPTED_EXT } from "../data/files";
import { formatCell } from "../format";
import { datasetBase } from "../data/transform";
import { chipGroups, chipText, datasetsOf, findDataset, isFrozenRef, rowsLabel, sceneRef, scenesLabel, toRef } from "../data/datasets";
import { h, svgIcon, ICONS } from "./dom";
import { openBrowse } from "./browse";

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
  /** Fenêtre Données, étape « Filtrer » : modifier un dataset (id) ou en créer un depuis la source (null). */
  editDataset?(id: string | null): void;
  deleteRow?(index: number): void;
  deleteColumn?(name: string): void;
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

    this.tree = h("div", { class: "ds-tree", role: "list", "aria-label": "Datasets dérivés de la source", "data-testid": "ds-tree" });
    this.treeCount = h("span", { class: "ds-sec-n", "data-testid": "ds-tree-count" });
    this.colsHead = h("h3", { class: "ds-sec-h" }, "Colonnes");
    this.colsHost = h("ul", { class: "ds-cols", "data-testid": "ds-cols" });
    const previewBlock = h(
      "div",
      { class: "block grow ds-preview" },
      h("h3", { class: "preview-head" }, "Aperçu de la source", this.editBtn),
      sheetHost,
      this.filterRow,
      this.table
    );
    this.previewBlock = previewBlock;
    this.root = h(
      "aside",
      { class: "panel panel-left", "data-testid": "data-panel" },
      h(
        "header",
        { class: "panel-head" },
        h("span", { class: "panel-icon", html: svgIcon(ICONS.table, 18) }),
        h("h2", null, "Datasets"),
        h("button", { class: "icon-btn collapse-btn", title: "Replier le panneau", html: svgIcon(ICONS.chevronL, 18), onclick: () => store.setUi({ leftCollapsed: !store.state.ui.leftCollapsed }) })
      ),
      h(
        "div",
        { class: "panel-body" },
        // Source (une seule par projet) : jamais modifiée ; « Remplacer » ouvre la fenêtre Données
        h(
          "div",
          { class: "block ds-current", "data-testid": "ds-current" },
          h("h3", { class: "ds-sec-h" }, "Source", h("small", null, "une seule par projet")),
          h(
            "div",
            { class: "ds-src-card" },
            h("span", { class: "ds-src-ic", html: svgIcon(ICONS.table, 18) }),
            this.info
          ),
          h(
            "div",
            { class: "ds-src-btns" },
            h("button", { type: "button", class: "btn ds-change", "data-testid": "data-open", title: "Remplacer la source : importer un fichier, coller un tableau, rouvrir un jeu récent, choisir un exemple ou des données publiques", onclick: () => actions.openData?.() }, h("span", { html: svgIcon(ICONS.folder, 15) }), "Remplacer"),
            h("button", { type: "button", class: "btn", "data-testid": "ds-preview", title: "Aperçu des lignes de la source (types détectés, cellules modifiables)", onclick: () => openBrowse({ current: () => this.store.state.ds, deleteRow: (i) => this.actions.deleteRow?.(i), deleteColumn: (n) => this.actions.deleteColumn?.(n) }) }, h("span", { html: svgIcon(ICONS.table, 15) }), "Aperçu")
          )
        ),
        // Datasets dérivés (arbre) : l'actif est celui du graphique
        h(
          "div",
          { class: "block ds-derived", "data-testid": "ds-derived" },
          h("h3", { class: "ds-sec-h" }, "Datasets dérivés", this.treeCount),
          this.tree,
          h("button", { type: "button", class: "btn ds-new", "data-testid": "ds-new", title: "Filtres permanents et colonnes gardées, enregistrés comme un dataset réutilisable par plusieurs graphiques", onclick: () => actions.editDataset?.(null) }, h("span", { html: svgIcon(ICONS.add, 14) }), "Nouveau dataset depuis la source")
        ),
        // Colonnes du dataset actif + Explorer ce dataset
        h(
          "div",
          { class: "block ds-columns" },
          this.colsHead,
          this.colsHost,
          h("button", { type: "button", class: "btn btn-explore-panel", "data-testid": "explore-data", title: "Pistes de graphiques calculées sur ce dataset (tendance, concentration, écarts, pipeline…)", onclick: () => actions.explore() }, h("span", { html: svgIcon(ICONS.explore, 16) }), "Explorer ce dataset")
        ),
        previewBlock
      )
    );
  }

  private tree: HTMLElement;
  private treeCount: HTMLElement;
  private colsHead: HTMLElement;
  private colsHost: HTMLElement;
  private previewBlock: HTMLElement;
  private treeKey = "";

  /** Arbre des datasets et colonnes du dataset actif. */
  private updateTree(): void {
    const st = this.store.state;
    const ds = st.ds;
    const ref = st.spec.dataset;
    const list = ds ? datasetsOf(st.datasets, ds.name) : [];
    const key = JSON.stringify([st.dsVersion, ds?.name, ref, list, st.story.snapshots.map((s) => sceneRef(s)?.id ?? "")]);
    if (key === this.treeKey) return;
    this.treeKey = key;
    this.treeCount.textContent = String(list.length);
    const used = (id: string) => st.story.snapshots.filter((s) => sceneRef(s)?.id === id).length;
    const select = (id: string | null) => {
      const d = list.find((x) => x.id === id);
      this.store.set("dataset", d ? toRef(d) : null);
    };
    const srcItem = ds
      ? h(
          "div",
          { class: `ds-node ds-node-src${!ref ? " active" : ""}`, role: "listitem", "data-testid": "ds-tree-item", "data-id": "", "aria-current": !ref ? "true" : null },
          h("button", { type: "button", class: "ds-node-main", title: "Le graphique utilise toutes les lignes de la source", onclick: () => select(null) }, h("span", { class: "ds-dot ds-dot-src", "aria-hidden": "true" }), h("span", { class: "ds-node-t" }, h("b", null, "Source entière"), h("small", null, `${rowsLabel(ds.rows.length)}`)))
        )
      : null;
    const items = list.map((d) => {
      const on = ref?.id === d.id;
      const frozen = on && isFrozenRef(ref, d);
      const n = ds ? datasetBase({ dataset: toRef(d) }, ds).rows.length : 0;
      const u = used(d.id);
      const chips = chipGroups(d.filters).map((g) => h("span", { class: "ds-chip", title: `${g.field} : ${chipText(g)}` }, `${g.field} : ${chipText(g)}`));
      return h(
        "div",
        { class: `ds-node${on ? " active" : ""}`, role: "listitem", "data-testid": "ds-tree-item", "data-id": d.id, "aria-current": on ? "true" : null },
        h(
          "button",
          { type: "button", class: "ds-node-main", title: `Le graphique utilise ${d.id} « ${d.name} »`, onclick: () => select(d.id) },
          h("span", { class: "ds-dot", style: `background:${d.color}`, "aria-hidden": "true" }),
          h("span", { class: "ds-node-t" }, h("b", null, d.name), h("small", null, `${d.id}${d.version > 1 ? ` v${d.version}` : ""} · ${rowsLabel(n)}${u ? ` · ${scenesLabel(u)}` : ""}${frozen ? ` · graphique sur v${ref!.version}` : ""}`), chips.length ? h("span", { class: "ds-chips" }, ...chips) : h("span", { class: "ds-chips" }, h("span", { class: "ds-chip ds-chip-none" }, d.columns.length ? `${d.columns.length} colonnes` : "Sans filtre")))
        ),
        h("button", { type: "button", class: "icon-btn ds-node-edit", title: `Modifier ${d.id} (filtres, colonnes, nom)`, "aria-label": `Modifier le dataset ${d.id}`, "data-testid": "ds-tree-edit", html: svgIcon(ICONS.edit, 14), onclick: () => this.actions.editDataset?.(d.id) })
      );
    });
    this.tree.replaceChildren(...(srcItem ? [srcItem] : []), ...items, ...(ds && !list.length ? [h("p", { class: "ds-empty" }, "Aucun dataset dérivé : la source entière sert de dataset. Créez-en un pour garder des filtres permanents (pays, années, secteurs…).")] : []));
    // Colonnes du dataset actif
    const base = ds ? datasetBase(st.spec, ds) : null;
    const cur = ds && ref ? findDataset(st.datasets, ds.name, ref.id) : undefined;
    this.colsHead.replaceChildren(document.createTextNode(ref ? `Colonnes de ${ref.id}` : "Colonnes de la source"), h("span", { class: "ds-sec-n" }, String(base?.columns.length ?? 0)));
    if (cur) this.colsHead.title = cur.name;
    const short = (v: number) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k` : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    this.colsHost.replaceChildren(
      ...(base?.columns ?? []).map((c) => {
        const vals = base!.rows.map((r) => r[c.name]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        let meta = "";
        if (c.type === "date" && vals.length) {
          const a = new Date(Math.min(...vals)).getUTCFullYear();
          const b = new Date(Math.max(...vals)).getUTCFullYear();
          meta = a === b ? String(a) : `${a}–${b}`;
        } else if (c.type === "number" && vals.length) {
          const yearLike = vals.every((v) => Number.isInteger(v) && v >= 1800 && v <= 2200);
          meta = yearLike ? `${Math.min(...vals)}–${Math.max(...vals)}` : `somme ${short(vals.reduce((a, b) => a + b, 0))}`;
        } else meta = `${c.cardinality.toLocaleString("fr-FR")} valeur${c.cardinality > 1 ? "s" : ""}`;
        const ic = c.type === "number" ? "#" : c.type === "date" ? "📅" : "Aa";
        return h("li", { class: "ds-col", "data-col": c.name }, h("span", { class: `ds-col-ic t-${c.type}`, title: COLUMN_TYPE_LABELS[c.type] }, ic), h("span", { class: "ds-col-n", title: c.name }, c.name), h("small", null, meta));
      })
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
    this.updateTree();
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
      ...(sampleId ? [h("small", { class: "ds-kind" }, "Exemple intégré")] : []),
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
