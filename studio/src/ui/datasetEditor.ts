/**
 * Fenêtre Données, étape « ② Filtrer » puis « ③ Enregistrer le dataset » (modèle « dataset d'abord ») :
 * - à gauche : la source chargée (jamais modifiée), les colonnes gardées, les datasets de cette source ;
 * - au centre : les filtres permanents en **pastilles empilées** (chaque pastille montre les lignes restantes),
 *   « + Filtre », le compte de lignes en direct (barre de progression) et l'aperçu des lignes gardées ;
 * - en bas : le nom du dataset (proposé d'après les filtres), Annuler, « Utiliser sans enregistrer »
 *   (filtre de vue du graphique) et « Enregistrer comme dataset ».
 * Les filtres sont des `FilterSpec` (mêmes règles que le filtre de vue) : catégories → valeurs gardées,
 * dates et années → période.
 */
import type { Store } from "../state";
import type { FilterSpec } from "../spec";
import type { Column, Dataset } from "../data/table";
import { COLUMN_TYPE_LABELS } from "../data/table";
import { applyRecipe } from "../data/transform";
import { formatCell } from "../format";
import { chipGroups, chipText, datasetsOf, findDataset, proposeName, rangeChipText, rowsLabel, sceneRef, scenesLabel, stackedCounts, valueCounts, valuesChipText, type DatasetRecipe } from "../data/datasets";
import { h, svgIcon, ICONS } from "./dom";

export interface DatasetDraft {
  /** Dataset modifié (null : nouveau dataset depuis la source). */
  editId: string | null;
  name: string;
  filters: FilterSpec[];
  /** Colonnes gardées ; vide = toutes. */
  columns: string[];
}

export interface DatasetEditorActions {
  /** « Enregistrer comme dataset » (asNew : nouveau même en modification). */
  save(d: DatasetDraft, asNew: boolean): void | Promise<void>;
  /** « Utiliser sans enregistrer » : filtres appliqués au graphique comme filtre de vue. */
  useWithoutSaving(d: DatasetDraft): void;
  close(): void;
}

const MAX_ROWS = 60;

export class DatasetEditor {
  readonly root: HTMLElement;
  private draft: DatasetDraft = { editId: null, name: "", filters: [], columns: [] };
  private nameTouched = false;
  private srcHost: HTMLElement;
  private colsHost: HTMLElement;
  private colsCount: HTMLElement;
  private dsList: HTMLElement;
  private dsListCount: HTMLElement;
  private chips: HTMLElement;
  private countBig: HTMLElement;
  private countSub: HTMLElement;
  private bar: HTMLElement;
  private table: HTMLElement;
  private nameInp: HTMLInputElement;
  private nameHint: HTMLElement;
  private saveBtn: HTMLButtonElement;
  private saveNewBtn: HTMLButtonElement;
  private pop: HTMLElement;
  private popField: string | null = null;
  private main: HTMLElement;

  constructor(private store: Store, private actions: DatasetEditorActions) {
    this.srcHost = h("div", { class: "dse-src", "data-testid": "dse-source" });
    this.colsCount = h("span", { class: "dse-n" });
    this.colsHost = h("div", { class: "dse-cols", "data-testid": "dse-columns" });
    this.dsListCount = h("span", { class: "dse-n" });
    this.dsList = h("div", { class: "dse-dslist", "data-testid": "dse-datasets" });
    this.chips = h("div", { class: "dse-chips", "data-testid": "dse-chips" });
    this.countBig = h("b", { class: "dse-count-n", "data-testid": "dse-count" });
    this.countSub = h("span", { class: "dse-count-sub", "data-testid": "dse-count-sub" });
    this.bar = h("span", { class: "dse-bar-fill" });
    this.table = h("div", { class: "dse-table table-wrap", "data-testid": "dse-table" });
    this.pop = h("div", { class: "dse-pop", hidden: true, role: "dialog", "aria-label": "Valeurs du filtre", "data-testid": "dse-pop" });
    this.nameInp = h("input", { type: "text", class: "dse-name-in", maxlength: "80", "aria-label": "Nom du dataset", "data-testid": "dse-name" }) as HTMLInputElement;
    this.nameInp.addEventListener("input", () => {
      this.nameTouched = true;
      this.draft.name = this.nameInp.value;
    });
    this.nameHint = h("small", { class: "dse-name-hint" });
    this.saveBtn = h("button", { type: "button", class: "btn btn-accent", "data-testid": "dse-save", onclick: () => void this.doSave(false) }, h("span", { html: svgIcon(ICONS.save, 15) }), "Enregistrer comme dataset") as HTMLButtonElement;
    this.saveNewBtn = h("button", { type: "button", class: "btn", "data-testid": "dse-save-new", hidden: true, onclick: () => void this.doSave(true) }, "Enregistrer comme nouveau dataset") as HTMLButtonElement;
    this.main = h(
      "div",
      { class: "dse-main" },
      h("div", { class: "dse-chipbar" }, this.chips),
      h("div", { class: "dse-count" }, this.countBig, this.countSub, h("span", { class: "dse-bar", "aria-hidden": "true" }, this.bar), h("span", { class: "dse-live" }, h("i", { "aria-hidden": "true" }), "mis à jour en direct")),
      this.table,
      this.pop
    );
    this.root = h(
      "section",
      { class: "dse", "data-testid": "dataset-editor", hidden: true, "aria-label": "Filtrer la source et enregistrer le dataset" },
      h(
        "div",
        { class: "dse-body" },
        h(
          "aside",
          { class: "dse-side" },
          h("h4", { class: "dse-h" }, "Source chargée"),
          this.srcHost,
          h("p", { class: "dse-note" }, "La source n'est ", h("b", null, "jamais modifiée"), ". Chaque dataset en dérive par des filtres et un choix de colonnes."),
          h("h4", { class: "dse-h" }, "Colonnes gardées", this.colsCount),
          this.colsHost,
          h("h4", { class: "dse-h" }, "Datasets de cette source", this.dsListCount),
          this.dsList
        ),
        this.main
      ),
      h(
        "footer",
        { class: "dse-foot" },
        h("label", { class: "dse-name" }, h("span", { class: "dse-name-l" }, "Nom du dataset"), this.nameInp, this.nameHint),
        h("div", { class: "dse-btns" },
          h("button", { type: "button", class: "btn btn-ghost", "data-testid": "dse-cancel", onclick: () => this.actions.close() }, "Annuler"),
          h("button", { type: "button", class: "btn", "data-testid": "dse-use", title: "Applique ces filtres au graphique courant seulement (filtre de vue), sans créer de dataset", onclick: () => this.actions.useWithoutSaving(this.snapshotDraft()) }, "Utiliser sans enregistrer"),
          this.saveNewBtn,
          this.saveBtn
        )
      )
    );
    this.root.addEventListener("click", (e) => {
      if (this.pop.hidden) return;
      const t = e.target as HTMLElement;
      // cible retirée du DOM (liste du popover redessinée) : le clic venait du popover
      if (!t.isConnected) return;
      if (!t.closest(".dse-pop") && !t.closest(".dse-chip-open") && !t.closest(".dse-add")) this.closePop();
    });
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.pop.hidden) {
        e.stopPropagation();
        this.closePop();
      }
    });
  }

  private get src(): Dataset | null {
    return this.store.state.ds;
  }

  get editing(): string | null {
    return this.draft.editId;
  }

  /** Démarre l'étape Filtrer : nouveau dataset (null) ou modification d'un dataset existant. */
  start(editId: string | null): void {
    const src = this.src;
    const d = src && editId ? findDataset(this.store.state.datasets, src.name, editId) : undefined;
    this.draft = d ? { editId: d.id, name: d.name, filters: structuredClone(d.filters), columns: [...d.columns] } : { editId: null, name: "", filters: [], columns: [] };
    this.nameTouched = !!d;
    this.closePop();
    this.render();
  }

  private snapshotDraft(): DatasetDraft {
    const src = this.src;
    const all = src?.columns.map((c) => c.name) ?? [];
    const columns = this.draft.columns.length && this.draft.columns.length < all.length ? all.filter((c) => this.draft.columns.includes(c)) : [];
    return { editId: this.draft.editId, name: (this.nameInp.value || this.proposed()).trim(), filters: structuredClone(this.draft.filters), columns };
  }

  private async doSave(asNew: boolean): Promise<void> {
    await this.actions.save(this.snapshotDraft(), asNew);
  }

  private proposed(): string {
    return proposeName(this.draft.filters, this.src ? `${this.src.name} · toutes les lignes` : "Toutes les lignes");
  }

  /* ---------------------------------------------------------------- rendu */

  private keptCols(src: Dataset): Column[] {
    return this.draft.columns.length ? src.columns.filter((c) => this.draft.columns.includes(c.name)) : src.columns;
  }

  /** Colonnes filtrables : catégories / texte (≤ 500 valeurs), dates, années numériques. */
  private filterable(src: Dataset): Column[] {
    return src.columns.filter((c) => ((c.type === "category" || c.type === "text") && c.cardinality <= 500) || c.type === "date" || (c.type === "number" && this.yearLike(src, c.name)));
  }

  private yearLike(src: Dataset, col: string): boolean {
    if (!/ann[ée]e|year|exercice|mill[ée]sime/i.test(col)) return false;
    return src.rows.every((r) => r[col] == null || (Number.isInteger(r[col]) && (r[col] as number) >= 1800 && (r[col] as number) <= 2200));
  }

  render(): void {
    const src = this.src;
    const st = this.store.state;
    if (!src) {
      this.srcHost.replaceChildren(h("p", { class: "muted" }, "Aucune source chargée : choisissez d'abord une source (étape ①)."));
      return;
    }
    const editing = this.draft.editId ? findDataset(st.datasets, src.name, this.draft.editId) : undefined;
    // Source chargée
    const p = st.provenance;
    const when = p?.importedAt ? new Date(p.importedAt) : null;
    this.srcHost.replaceChildren(
      h("div", { class: "dse-src-card" }, h("span", { class: "dse-src-ic", html: svgIcon(ICONS.table, 18) }), h("div", null, h("strong", null, src.name), h("small", null, `${rowsLabel(src.rows.length)} · ${src.columns.length} colonnes`))),
      ...(when && Number.isFinite(when.getTime()) ? [h("small", { class: "dse-src-date" }, `Importée le ${when.toLocaleDateString("fr-FR")} à ${when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`)] : [])
    );
    // Colonnes gardées
    const kept = this.keptCols(src);
    this.colsCount.textContent = `${kept.length} sur ${src.columns.length}`;
    this.colsHost.replaceChildren(
      ...src.columns.map((c) => {
        const on = kept.includes(c);
        const cb = h("input", { type: "checkbox", checked: on, "data-col": c.name, "aria-label": `Garder la colonne ${c.name}` }) as HTMLInputElement;
        cb.addEventListener("change", () => {
          const cur = new Set(this.keptCols(src).map((x) => x.name));
          if (cb.checked) cur.add(c.name);
          else if (cur.size > 1) cur.delete(c.name);
          else cb.checked = true;
          this.draft.columns = cur.size === src.columns.length ? [] : src.columns.filter((x) => cur.has(x.name)).map((x) => x.name);
          this.render();
        });
        return h("label", { class: "dse-col" }, cb, h("span", { class: "dse-col-n", title: c.name }, c.name), h("small", null, COLUMN_TYPE_LABELS[c.type].toLowerCase()));
      })
    );
    // Datasets de cette source
    const list = datasetsOf(st.datasets, src.name);
    this.dsListCount.textContent = list.length ? String(list.length) : "aucun";
    const used = (id: string) => st.story.snapshots.filter((s) => sceneRef(s)?.id === id).length;
    this.dsList.replaceChildren(
      ...(list.length
        ? list.map((d: DatasetRecipe) =>
            h(
              "button",
              { type: "button", class: `dse-ds${d.id === this.draft.editId ? " active" : ""}`, "data-id": d.id, title: `Modifier ${d.id} « ${d.name} »`, onclick: () => this.start(d.id) },
              h("span", { class: "ds-dot", style: `background:${d.color}` }),
              h("span", null, h("b", null, `${d.id} · ${d.name}`), h("small", null, `${rowsLabel(applyRecipe(src, d).rows.length)}${used(d.id) ? ` · ${scenesLabel(used(d.id))}` : ""}`))
            )
          )
        : [h("p", { class: "dse-note" }, "Ce sera le premier. Vous pourrez en créer d'autres (autre filtre, autre dimension) depuis le panneau Datasets.")]),
      ...(this.draft.editId ? [h("button", { type: "button", class: "btn btn-mini dse-ds-new", "data-testid": "dse-new", onclick: () => this.start(null) }, h("span", { html: svgIcon(ICONS.add, 13) }), "Nouveau dataset")] : [])
    );
    // Pastilles empilées
    this.paintChips(src);
    // Compte en direct
    const out = applyRecipe(src, { filters: this.draft.filters, columns: this.draft.columns });
    const n = out.rows.length;
    const total = src.rows.length;
    const pct = total ? Math.round((n / total) * 100) : 0;
    this.countBig.textContent = rowsLabel(n);
    this.countSub.textContent = `sur ${total.toLocaleString("fr-FR")} · ${pct} %`;
    this.bar.style.width = `${total ? (n / total) * 100 : 0}%`;
    // Aperçu des lignes gardées
    const cols = out.columns;
    const filtered = new Set(this.draft.filters.map((f) => f.field));
    const ic = (c: Column) => (c.type === "number" ? "#" : c.type === "date" ? "📅" : "Aa");
    // colonne de dates annuelles (1er janvier) : « 2025 » plutôt que « 01/01/2025 »
    const yearly = new Set(cols.filter((c) => c.type === "date" && out.rows.every((r) => { const v = r[c.name]; if (typeof v !== "number") return true; const d = new Date(v); return d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0; })).map((c) => c.name));
    const cell = (c: Column, v: unknown) => (yearly.has(c.name) && typeof v === "number" ? String(new Date(v).getUTCFullYear()) : formatCell(v as never, c.type));
    this.table.replaceChildren(
      h(
        "table",
        null,
        h("thead", null, h("tr", null, ...cols.map((c) => h("th", { class: filtered.has(c.name) ? "dse-th-f" : null }, h("span", { class: "dse-th-ic" }, ic(c)), " ", c.name, filtered.has(c.name) ? h("span", { class: "dse-th-fi", html: svgIcon(ICONS.filter, 12), title: "Colonne filtrée" }) : null)))),
        h("tbody", null, ...out.rows.slice(0, MAX_ROWS).map((r) => h("tr", null, ...cols.map((c) => h("td", { class: c.type === "number" ? "num" : null }, cell(c, r[c.name]))))))
      ),
      ...(n > MAX_ROWS ? [h("p", { class: "muted small" }, `… ${(n - MAX_ROWS).toLocaleString("fr-FR")} lignes de plus`)] : []),
      ...(n === 0 ? [h("p", { class: "muted small" }, "Aucune ligne : retirez ou élargissez un filtre.")] : [])
    );
    // Nom
    if (!this.nameTouched) this.draft.name = this.proposed();
    if (document.activeElement !== this.nameInp) this.nameInp.value = this.draft.name;
    this.nameInp.placeholder = this.proposed();
    this.nameHint.textContent = editing ? `${editing.id} v${editing.version} · dérivé de ${src.name}` : `Nom proposé d'après les filtres · dérivé de ${src.name}`;
    this.saveBtn.lastChild!.textContent = editing ? `Enregistrer ${editing.id}` : "Enregistrer comme dataset";
    this.saveNewBtn.hidden = !editing;
  }

  private paintChips(src: Dataset): void {
    const groups = chipGroups(this.draft.filters);
    const counts = stackedCounts(src, this.draft.filters);
    const kids: Node[] = [];
    groups.forEach((g, i) => {
      if (i > 0) kids.push(h("span", { class: "dse-sep", "aria-hidden": "true" }, "›"));
      const open = this.popField === g.field;
      kids.push(
        h(
          "span",
          { class: `dse-chip${open ? " open" : ""}`, "data-testid": "dse-chip", "data-field": g.field },
          h("button", { type: "button", class: "dse-chip-open", title: `Modifier le filtre « ${g.field} »`, "aria-expanded": open ? "true" : "false", onclick: (e: Event) => this.openPop(g.field, e.currentTarget as HTMLElement) }, h("b", null, g.field), h("span", { class: "dse-chip-t" }, chipText(g)), h("small", { class: "dse-chip-n", "data-testid": "dse-chip-count" }, (counts[i] ?? 0).toLocaleString("fr-FR"))),
          h("button", { type: "button", class: "dse-chip-x", "aria-label": `Retirer le filtre « ${g.field} »`, title: "Retirer ce filtre", onclick: () => this.removeField(g.field) }, "×")
        )
      );
    });
    const free = this.filterable(src).filter((c) => !groups.some((g) => g.field === c.name));
    if (free.length) {
      if (groups.length) kids.push(h("span", { class: "dse-sep", "aria-hidden": "true" }, "›"));
      kids.push(h("button", { type: "button", class: "dse-add", "data-testid": "dse-add", onclick: (e: Event) => this.openAddMenu(e.currentTarget as HTMLElement, free) }, h("span", { html: svgIcon(ICONS.add, 13) }), "Filtre"));
    }
    if (!groups.length) kids.push(h("span", { class: "dse-chips-hint" }, "Ajoutez des filtres permanents : pays, années, secteurs… Chaque pastille montre les lignes restantes."));
    this.chips.replaceChildren(...kids);
  }

  private removeField(field: string): void {
    this.draft.filters = this.draft.filters.filter((f) => f.field !== field);
    if (this.popField === field) this.closePop();
    this.render();
  }

  /** Lignes avant la pastille d'une colonne (pastilles précédentes appliquées). */
  private rowsBefore(src: Dataset, field: string): Dataset["rows"] {
    const groups = chipGroups(this.draft.filters);
    const i = groups.findIndex((g) => g.field === field);
    const before = (i < 0 ? groups : groups.slice(0, i)).flatMap((g) => g.filters);
    return applyRecipe(src, { filters: before, columns: [] }).rows;
  }

  private placePop(anchor: HTMLElement): void {
    const host = this.main.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    this.pop.hidden = false;
    const w = this.pop.offsetWidth || 280;
    const left = Math.max(8, Math.min(a.left - host.left, host.width - w - 8));
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${a.bottom - host.top + 6}px`;
  }

  private closePop(): void {
    this.pop.hidden = true;
    this.popField = null;
    this.chips.querySelectorAll(".dse-chip.open").forEach((c) => c.classList.remove("open"));
  }

  private openAddMenu(anchor: HTMLElement, free: Column[]): void {
    this.popField = null;
    this.pop.replaceChildren(
      h("p", { class: "dse-pop-h" }, "Filtrer sur la colonne…"),
      h("div", { class: "dse-pop-list" }, ...free.map((c) => h("button", { type: "button", class: "dse-pop-col", "data-col": c.name, onclick: () => this.openPop(c.name, anchor) }, h("span", null, c.name), h("small", null, c.type === "date" || c.type === "number" ? "période" : `${c.cardinality} valeurs`))))
    );
    this.pop.dataset.mode = "add";
    this.placePop(anchor);
  }

  /** Popover d'une pastille : valeurs à cocher (Tout / Aucun / Inverser) ou période (De / À). */
  openPop(field: string, anchor?: HTMLElement): void {
    const src = this.src;
    if (!src) return;
    const col = src.columns.find((c) => c.name === field);
    if (!col) return;
    this.popField = field;
    this.pop.dataset.mode = "values";
    this.pop.dataset.field = field;
    const rows = this.rowsBefore(src, field);
    const mine = this.draft.filters.filter((f) => f.field === field);
    const setMine = (next: FilterSpec[]) => {
      const others = this.draft.filters.filter((f) => f.field !== field);
      const at = this.draft.filters.findIndex((f) => f.field === field);
      // la pastille garde sa place dans la pile
      if (at < 0) this.draft.filters = [...others, ...next];
      else {
        const head = this.draft.filters.slice(0, at).filter((f) => f.field !== field);
        this.draft.filters = [...head, ...next, ...others.filter((f) => !head.includes(f))];
      }
      this.render();
      this.chips.querySelector(`.dse-chip[data-field="${CSS.escape(field)}"]`)?.classList.add("open");
    };
    if (col.type === "date" || col.type === "number") {
      const isDate = col.type === "date";
      const years = [...new Set(rows.map((r) => r[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map((v) => (isDate ? new Date(v).getUTCFullYear() : v)))].sort((a, b) => a - b);
      const yOf = (v: number | null) => (v == null ? null : isDate ? new Date(v).getUTCFullYear() : v);
      const lo = mine.find((f) => f.op === "gte" || f.op === "gt");
      const hi = mine.find((f) => f.op === "lt" || f.op === "lte");
      let from = yOf(lo?.value ?? null);
      let to = hi ? (hi.op === "lt" ? yOf(hi.value)! - 1 : yOf(hi.value)) : null;
      const apply = () => {
        if (from == null && to == null) return setMine([]);
        const label = `${field} : ${rangeChipText(from, to)}`;
        const add: FilterSpec[] = [];
        if (from != null) add.push({ field, op: "gte", values: [], value: isDate ? Date.UTC(from, 0, 1) : from, label });
        if (to != null) add.push(isDate ? { field, op: "lt", values: [], value: Date.UTC(to + 1, 0, 1), label } : { field, op: "lte", values: [], value: to, label });
        setMine(add);
      };
      const sel = (cur: number | null, testid: string, lab: string, on: (v: number | null) => void) => {
        const s = h("select", { "aria-label": lab, "data-testid": testid }, h("option", { value: "" }, "—"), ...years.map((y) => h("option", { value: String(y), selected: y === cur }, String(y)))) as HTMLSelectElement;
        s.addEventListener("change", () => on(s.value ? Number(s.value) : null));
        return s;
      };
      this.pop.replaceChildren(
        h("p", { class: "dse-pop-h" }, h("span", null, `${field} · parmi ${rowsLabel(rows.length)}`), h("small", null, years.length ? `${years[0]} → ${years[years.length - 1]}` : "")),
        h(
          "div",
          { class: "dse-range" },
          h("label", null, h("span", null, "De"), sel(from, "dse-from", "Période : de", (v) => { from = v; if (to != null && v != null && to < v) to = v; apply(); })),
          h("label", null, h("span", null, "À"), sel(to, "dse-to", "Période : à", (v) => { to = v; if (from != null && v != null && from > v) from = v; apply(); }))
        ),
        h("div", { class: "dse-pop-foot" }, h("button", { type: "button", class: "dse-link", onclick: () => { from = null; to = null; apply(); this.closePop(); } }, "Toutes les années"))
      );
    } else {
      const counts = valueCounts(rows, field);
      const all = counts.map((c) => c.value);
      const ex = mine.find((f) => f.op === "in" || f.op === "notIn");
      const picked = new Set(ex ? (ex.op === "in" ? ex.values : all.filter((v) => !ex.values.includes(v))) : all);
      const write = () => {
        if (picked.size === all.length) return setMine([]);
        const vals = all.filter((v) => picked.has(v));
        setMine([{ field, op: "in", values: vals, value: null, label: `${field} : ${vals.length ? valuesChipText(vals, all) : "aucune valeur"}` }]);
      };
      const list = h("div", { class: "dse-vals", role: "group", "aria-label": `Valeurs de ${field}` });
      let q = "";
      const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const paint = () => {
        const shown = counts.filter((c) => !q || norm(c.value).includes(norm(q)));
        list.replaceChildren(
          ...shown.slice(0, 200).map((c) => {
            const cb = h("input", { type: "checkbox", checked: picked.has(c.value), "data-value": c.value }) as HTMLInputElement;
            cb.addEventListener("change", () => {
              if (cb.checked) picked.add(c.value);
              else picked.delete(c.value);
              write();
            });
            return h("label", { class: "dse-val" }, cb, h("span", null, c.value), h("small", null, c.n.toLocaleString("fr-FR")));
          }),
          ...(shown.length ? [] : [h("p", { class: "muted small" }, "Aucune valeur ne correspond.")])
        );
      };
      const search = counts.length > 10 ? (h("input", { type: "search", class: "dse-search", placeholder: `Rechercher (${counts.length} valeurs)…`, "aria-label": "Rechercher une valeur", "data-testid": "dse-search" }) as HTMLInputElement) : null;
      search?.addEventListener("input", () => {
        q = search.value;
        paint();
      });
      paint();
      const bulk = (f: () => void) => () => {
        f();
        write();
        paint();
      };
      this.pop.replaceChildren(
        h("p", { class: "dse-pop-h" }, h("span", null, `${field} · parmi ${rowsLabel(rows.length)}`), h("small", null, `${counts.length} valeur${counts.length > 1 ? "s" : ""}`)),
        ...(search ? [search] : []),
        list,
        h(
          "div",
          { class: "dse-pop-foot" },
          h("button", { type: "button", class: "dse-link", "data-testid": "dse-all", onclick: bulk(() => all.forEach((v) => picked.add(v))) }, "Tout"),
          h("button", { type: "button", class: "dse-link", "data-testid": "dse-none", onclick: bulk(() => picked.clear()) }, "Aucun"),
          h("button", { type: "button", class: "dse-link", "data-testid": "dse-invert", onclick: bulk(() => all.forEach((v) => (picked.has(v) ? picked.delete(v) : picked.add(v)))) }, "Inverser")
        )
      );
    }
    const a = anchor && document.contains(anchor) ? anchor : this.chips.querySelector<HTMLElement>(`.dse-chip[data-field="${CSS.escape(field)}"]`) ?? this.chips;
    this.chips.querySelectorAll(".dse-chip").forEach((c) => c.classList.toggle("open", (c as HTMLElement).dataset.field === field));
    this.placePop(a);
  }
}
