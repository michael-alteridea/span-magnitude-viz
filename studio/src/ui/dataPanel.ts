/**
 * Panneau Données (gauche) : glisser-déposer / sélection de fichier, collage depuis Excel ou
 * Google Sheets, jeux d'exemple, et aperçu du tableau avec types détectés (modifiables).
 */
import type { Store } from "../state";
import { SAMPLES } from "../data/samples";
import { COLUMN_TYPE_LABELS, type ColumnType } from "../data/table";
import { ACCEPTED_EXT } from "../data/files";
import { formatCell } from "../format";
import { h, svgIcon, ICONS } from "./dom";

export interface DataActions {
  loadSample(id: string): void;
  importText(text: string): void;
  importFile(file: File): void;
  changeSheet(name: string): void;
}

const TYPE_ORDER: ColumnType[] = ["number", "date", "category", "text"];

export class DataPanel {
  readonly root: HTMLElement;
  private store: Store;
  private info: HTMLElement;
  private table: HTMLElement;
  private sampleBtns: HTMLButtonElement[] = [];
  private key = "";

  constructor(store: Store, actions: DataActions) {
    this.store = store;
    const fileInput = h("input", { type: "file", accept: ACCEPTED_EXT.join(","), class: "hidden", "data-testid": "file-input" });
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) actions.importFile(f);
      fileInput.value = "";
    });
    const drop = h(
      "div",
      { class: "dropzone", tabindex: "0", role: "button", "data-testid": "dropzone", onclick: () => fileInput.click(), onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && fileInput.click() },
      h("span", { class: "drop-icon", html: svgIcon(ICONS.upload, 26) }),
      h("strong", null, "Déposez un fichier"),
      h("span", null, "ou cliquez pour parcourir"),
      h("small", null, "CSV · TSV · JSON · XLSX · XLS")
    );
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = e.dataTransfer?.files?.[0];
      if (f) actions.importFile(f);
    });
    // Glisser-déposer n'importe où sur la page
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      if ((e.target as HTMLElement)?.closest?.(".dropzone")) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) actions.importFile(f);
    });

    const ta = h("textarea", {
      class: "paste",
      rows: "5",
      spellcheck: "false",
      placeholder: "Collez ici un tableau copié depuis Excel ou Google Sheets (Ctrl+V)…\nSéparateurs tabulation, « ; » ou « , » — virgule décimale acceptée.",
      "data-testid": "paste-area",
    });
    const pasteBtn = h("button", { class: "btn btn-accent", "data-testid": "paste-apply", onclick: () => ta.value.trim() && actions.importText(ta.value) }, "Utiliser ces données");
    ta.addEventListener("paste", () => setTimeout(() => ta.value.trim() && actions.importText(ta.value), 0));

    const samples = h(
      "div",
      { class: "samples" },
      ...SAMPLES.map((s) => {
        const b = h("button", { class: "sample", "data-sample": s.id, "data-testid": `sample-${s.id}`, onclick: () => actions.loadSample(s.id) }, h("strong", null, s.name), h("small", null, s.description));
        this.sampleBtns.push(b);
        return b;
      })
    );

    this.info = h("div", { class: "ds-info", "data-testid": "ds-info" });
    this.table = h("div", { class: "table-wrap", "data-testid": "data-table" });
    const sheetHost = h("div", { class: "sheet-host" });
    this.sheetHost = sheetHost;
    this.actions = actions;

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
        h("div", { class: "block" }, h("h3", null, "Importer"), drop, fileInput),
        h("div", { class: "block" }, h("h3", null, h("span", { html: svgIcon(ICONS.paste, 15) }), " Coller un tableau"), ta, pasteBtn),
        h("div", { class: "block" }, h("h3", null, "Exemples"), samples),
        h("div", { class: "block grow" }, h("h3", null, "Aperçu"), this.info, sheetHost, this.table)
      )
    );
  }

  private sheetHost: HTMLElement;
  private actions: DataActions;

  update(): void {
    const { ds, dsVersion, sampleId, importNote, sheets, sheet } = this.store.state;
    const key = `${dsVersion}`;
    this.sampleBtns.forEach((b) => b.classList.toggle("active", b.dataset.sample === sampleId));
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
      h("span", null, ` · ${ds.rows.length.toLocaleString("fr-FR")} lignes × ${ds.columns.length} colonnes`),
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
    const body = ds.rows.slice(0, MAX).map((r) =>
      h(
        "tr",
        null,
        ...ds.columns.map((c) => {
          const v = r[c.name];
          const txt = formatCell(v, c.type);
          const bad = v == null && ds.raw[ds.rows.indexOf(r)]?.[c.name] !== "" && ds.raw[ds.rows.indexOf(r)]?.[c.name] != null;
          return h("td", { class: `${c.type === "number" ? "num" : ""}${bad ? " bad" : ""}`, title: bad ? `Valeur non reconnue : ${String(ds.raw[ds.rows.indexOf(r)]?.[c.name])}` : null }, txt);
        })
      )
    );
    this.table.replaceChildren(
      h("table", null, h("thead", null, head), h("tbody", null, ...body)),
      ...(ds.rows.length > MAX ? [h("p", { class: "muted small" }, `… ${ds.rows.length - MAX} lignes de plus`)] : [])
    );
  }
}
