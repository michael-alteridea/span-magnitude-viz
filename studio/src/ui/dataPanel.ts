/**
 * Panneau Données (gauche) : glisser-déposer / sélection de fichier, collage depuis Excel ou
 * Google Sheets, jeux d'exemple, et aperçu du tableau avec types détectés (modifiables).
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

    const sampleBtn = (s: Sample) => {
      const b = h("button", { class: "sample", "data-sample": s.id, "data-testid": `sample-${s.id}`, onclick: () => actions.loadSample(s.id) }, h("strong", null, s.name), h("small", null, s.description));
      this.sampleBtns.push(b);
      return b;
    };
    const samples = h("div", { class: "samples" }, ...SAMPLES.filter((s) => !s.publicData).map(sampleBtn));
    // Données publiques : exemples ouverts (licences compatibles avec un usage commercial), groupés par thème
    const pub = SAMPLES.filter((s) => s.publicData);
    const themes = PUBLIC_THEMES.filter((t) => pub.some((s) => s.publicData!.theme === t));
    const publicBlock = h(
      "div",
      { class: "block public-data", "data-testid": "public-data" },
      h("h3", null, h("span", { html: svgIcon(ICONS.globe, 15) }), " Données publiques"),
      h("p", { class: "public-intro" }, "Données ouvertes, réutilisables y compris commercialement : modifiables comme vos propres données, source et licence déjà dans le cartouche."),
      ...themes.map((t) =>
        h(
          "section",
          { class: "public-theme", "data-testid": "public-theme", "data-theme": t },
          h("h4", null, t),
          h(
            "div",
            { class: "samples" },
            ...pub
              .filter((s) => s.publicData!.theme === t)
              .map((s) =>
                h(
                  "div",
                  { class: "public-sample" },
                  sampleBtn(s),
                  h("div", { class: "public-meta" },
                    h("span", { class: "public-licence", title: s.publicData!.sourceLabel }, s.publicData!.licenceShort),
                    s.publicData!.reel
                      ? h("button", { class: "btn btn-mini public-reel", type: "button", "data-testid": `public-reel-${s.id}`, title: `Créer un Reel avec l'histoire suggérée (${s.publicData!.reelCount ?? "3 à 5"} snapshots)`, onclick: () => actions.reelSample(s.id) }, h("span", { html: svgIcon(ICONS.reel, 14) }), "Créer un Reel")
                      : null
                  )
                )
              )
          )
        )
      )
    );

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
        h(
          "div",
          { class: "block" },
          h("h3", null, "Importer"),
          drop,
          fileInput,
          h("button", { class: "btn btn-reshape", "data-testid": "reshape-open", title: "Choisir l'onglet, le tableau, les axes X / Y, regrouper des lignes — aperçu en direct", onclick: () => actions.reshape() }, h("span", { html: svgIcon(ICONS.sliders, 15) }), "Mise en forme des données…")
        ),
        h("div", { class: "block" }, h("h3", null, h("span", { html: svgIcon(ICONS.paste, 15) }), " Coller un tableau"), ta, pasteBtn),
        h("div", { class: "block" }, h("h3", null, "Exemples"), samples),
        ...(themes.length ? [publicBlock] : []),
        h(
          "div",
          { class: "block" },
          h("button", { class: "btn btn-explore", "data-testid": "explore-data", title: "Pistes de graphiques calculées sur vos données (tendance, concentration, écarts, pipeline…)", onclick: () => actions.explore() }, h("span", { html: svgIcon(ICONS.explore, 18) }), "Explorer mes données")
        ),
        h(
          "div",
          { class: "block grow" },
          h("h3", { class: "preview-head" }, "Aperçu", this.editBtn),
          this.info,
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
