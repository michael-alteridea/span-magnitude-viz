/**
 * Fenêtre « Mise en forme des données » (étape d'import) :
 *  1. choix de l'onglet (aperçu miniature, onglet « tableau de données » proposé, Lisez-moi / Sources en dernier) ;
 *  2. recalcul des formules dans le navigateur (Web Worker, progression) + rapport de couverture en français ;
 *  3. tableau détecté (principal, totaux annuels, résumé…) affiché en grille ;
 *  4. rôles : toucher un libellé de ligne → série Y ; toucher un en-tête / un champ → X, Y, Y axe 2, Couleur, Facette ;
 *     ⇄ X / Y ; cocher des lignes → « Regrouper » (somme, moyenne, max, dernier) ; filtres Section / Indicateur / Entité ;
 *  5. aperçu en direct (rendu du Studio, différé) ; « Appliquer » charge le résultat dans le Studio.
 * Utilisable au doigt (iPad) : pas de survol obligatoire, cibles ≥ 36 px ; clavier : Entrée, Échap.
 */
import { parseSpec, chartSize, CHART_TYPE_LABELS, type ChartSpec, type ChartType } from "../spec";
import { buildDataset } from "../data/table";
import { prepareCache, renderChart } from "../charts/render";
import { h, svgIcon, ICONS } from "./dom";
import { toast } from "./toast";
import type { Matrix, SheetGuess, WorkbookData, RecalcReport } from "../data/workbook";
import type { Scalar } from "../data/formula/values";
import { detectStructure, toLongTable, F, type DetectedTable, type LongTable, type Structure } from "../data/structure";
import {
  GROUP_AGGS,
  GROUP_AGG_LABELS,
  assignField,
  defaultMapping,
  distinct,
  groupSeries,
  pivot,
  removeSeries,
  renameSeries,
  setFilter,
  setSeriesAxis,
  suggestCurve,
  swapXY,
  toggleRowSeries,
  type GroupAgg,
  type MappingState,
  type PivotResult,
  type Role,
} from "../data/mapping";

export interface MappingSource {
  kind: "file" | "paste";
  /** Nom affiché (fichier sans extension, ou « Collage »). */
  name: string;
  fileName: string;
  workbook?: WorkbookData;
  matrix?: Matrix;
}
export interface MappingApply {
  name: string;
  rows: Record<string, string | number | null>[];
  spec: ChartSpec;
  pivot: PivotResult;
  state: MappingState;
  sheet: string | null;
  note: string;
}

const PREVIEW_TYPES: ChartType[] = ["line", "area", "stackedArea", "bar", "groupedBar", "stackedBar", "barH", "scatter", "pie", "donut"];
const CURVES: [MappingState["curve"], string][] = [
  ["monotone", "Lissée"],
  ["linear", "Droite"],
  ["step", "Escalier"],
];
const ROLE_LABELS: Record<Exclude<Role, "none">, string> = { x: "X", y: "Y", y2: "Y axe 2", color: "Couleur / Groupe", facet: "Facette" };
const FILTER_FIELDS = [F.section, F.indicator, F.entity, F.variant];
const MAX_COLS = 36;
const fmtNum = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("fr-FR");

/** Spec Studio pour un résultat de mise en forme (aperçu = résultat appliqué). */
export function mappingSpec(base: ChartSpec, p: PivotResult, st: MappingState, facetValue: string | null = null): ChartSpec | null {
  const r = parseSpec({
    ...base,
    type: st.type,
    encoding: {
      ...base.encoding,
      x: p.x,
      y: p.y,
      y2: p.y2,
      series: p.series,
      time: null,
      size: null,
      label: null,
      end: null,
      lat: null,
      lon: null,
      postal: null,
      xGrain: p.xIsDate ? p.xGrain : "none",
      topN: null,
      aggregate: "sum",
      y2Aggregate: "sum",
      scenarios: {},
      scale: 1,
    },
    transform: { calculate: [], filters: p.facet && facetValue !== null ? [{ field: p.facet, op: "in", values: [facetValue], label: facetValue }] : [] },
    axes: { x: { grid: false }, y: { unit: p.unit }, y2: { grid: false, unit: p.unit } },
    story: {},
    norme: { ...base.norme, entity: "", measure: "" },
    style: { ...base.style, title: st.title.slice(0, 160), subtitle: p.facet && facetValue !== null ? `${p.facet} : ${facetValue}` : "", source: "", curve: st.curve },
    mode: { ...base.mode, fourD: { ...base.mode.fourD, enabled: false } },
    // Provenance : posée par le Studio à l'application (empreinte du fichier brut), jamais celle des données précédentes
    provenance: null,
  });
  return r.ok ? r.spec : null;
}

export class MappingWindow {
  readonly root: HTMLElement;
  isOpen = false;
  private src: MappingSource | null = null;
  private computed: Map<number, Scalar>[] | null = null;
  private report: RecalcReport | null = null;
  private recalcWhere: "worker" | "main" | null = null;
  private guesses: SheetGuess[] = [];
  private matrices = new Map<string, Matrix>();
  private sheet: string | null = null;
  private structure: Structure | null = null;
  private tableIdx = 0;
  private lt: LongTable | null = null;
  private st: MappingState | null = null;
  private selected = new Set<string>();
  private withOpening = false;
  private busy = false;
  private previewTimer = 0;
  private lastPivot: PivotResult | null = null;

  private elSub: HTMLElement;
  private elSheets: HTMLElement;
  private elTables: HTMLElement;
  private elStatus: HTMLElement;
  private elFields: HTMLElement;
  private elFilters: HTMLElement;
  private elGroupBar: HTMLElement;
  private elGrid: HTMLElement;
  private elRoles: HTMLElement;
  private elPreview: HTMLElement;
  private elPrevMsg: HTMLElement;
  private menu: HTMLElement;
  private applyBtn: HTMLButtonElement;

  constructor(private baseSpec: () => ChartSpec, private recalc: (wb: WorkbookData, onProgress: (d: number, t: number) => void) => Promise<{ values: Map<number, Scalar>[]; report: RecalcReport; where: "worker" | "main" }>, private onApply: (a: MappingApply) => void) {
    this.elSub = h("p", { class: "mw-sub", "data-testid": "mw-sub" });
    this.elSheets = h("div", { class: "mw-sheets", "data-testid": "mw-sheets", role: "listbox", "aria-label": "Onglets du classeur" });
    this.elTables = h("div", { class: "mw-tables", "data-testid": "mw-tables" });
    this.elStatus = h("div", { class: "mw-status", "data-testid": "mw-status", "aria-live": "polite" });
    this.elFields = h("div", { class: "mw-fields", "data-testid": "mw-fields" });
    this.elFilters = h("div", { class: "mw-filters", "data-testid": "mw-filters" });
    this.elGroupBar = h("div", { class: "mw-groupbar", "data-testid": "mw-groupbar" });
    this.elGrid = h("div", { class: "mw-grid", "data-testid": "mw-grid" });
    this.elRoles = h("div", { class: "mw-roles", "data-testid": "mw-roles" });
    this.elPreview = h("div", { class: "mw-preview", "data-testid": "mw-preview" });
    this.elPrevMsg = h("p", { class: "mw-prev-msg", "data-testid": "mw-prev-msg" });
    this.menu = h("div", { class: "mw-menu hidden", role: "menu", "data-testid": "mw-menu" });
    this.applyBtn = h("button", { class: "btn btn-accent mw-apply", "data-testid": "mw-apply", onclick: () => this.apply() }, "Appliquer");
    this.root = h(
      "div",
      { class: "mw-overlay hidden", "data-testid": "mapping-window" },
      h(
        "section",
        { class: "mw", role: "dialog", "aria-modal": "true", "aria-label": "Mise en forme des données" },
        h(
          "header",
          { class: "mw-head" },
          h("div", null, h("h2", null, h("span", { html: svgIcon(ICONS.table, 20) }), "Mise en forme des données"), this.elSub),
          h("button", { class: "icon-btn mw-close", title: "Fermer (Échap)", "aria-label": "Fermer", "data-testid": "mw-close", html: svgIcon(ICONS.close, 20), onclick: () => this.close() })
        ),
        h(
          "div",
          { class: "mw-body" },
          h("aside", { class: "mw-left" }, h("h3", null, "Onglet"), this.elSheets, h("h3", null, "Tableau"), this.elTables),
          h("div", { class: "mw-center" }, this.elStatus, this.elFields, this.elFilters, this.elGroupBar, this.elGrid),
          h(
            "aside",
            { class: "mw-right" },
            h("div", { class: "mw-prev-wrap" }, h("span", { class: "mw-label" }, "Aperçu en direct"), this.elPreview, this.elPrevMsg),
            this.elRoles,
            h("div", { class: "mw-actions" }, h("button", { class: "btn", "data-testid": "mw-cancel", onclick: () => this.close() }, "Annuler"), this.applyBtn)
          )
        ),
        this.menu
      )
    );
    document.addEventListener("keydown", (e) => {
      if (!this.isOpen || e.key !== "Escape") return;
      if (!this.menu.classList.contains("hidden")) this.hideMenu();
      else this.close();
      e.preventDefault();
    });
    this.root.addEventListener("pointerdown", (e) => {
      if (!this.menu.classList.contains("hidden") && !(e.target as HTMLElement).closest(".mw-menu, [data-menu-anchor]")) this.hideMenu();
    });
  }

  /* ------------------------------------------------------------ ouverture */

  async open(src: MappingSource): Promise<void> {
    this.src = src;
    this.computed = null;
    this.report = null;
    this.recalcWhere = null;
    this.matrices.clear();
    this.guesses = [];
    this.sheet = null;
    this.lt = null;
    this.st = null;
    this.selected.clear();
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.elSub.textContent = src.fileName ? `« ${src.fileName} »` : "Tableau collé";
    fill(this.elGrid);
    fill(this.elPreview);
    const wb = src.workbook;
    if (wb && wb.missingCached > 0) {
      this.busy = true;
      this.renderAll();
      const bar = h("div", { class: "mw-progress-bar" });
      const label = h("span", null, `Recalcul de ${fmtInt(wb.formulas)} formules…`);
      this.elStatus.className = "mw-status";
      fill(this.elStatus, h("div", { class: "mw-progress", "data-testid": "mw-progress" }, bar), label);
      try {
        const res = await this.recalc(wb, (d, t) => {
          bar.style.width = `${Math.round((d / Math.max(1, t)) * 100)}%`;
          label.textContent = `Recalcul des formules… ${fmtInt(d)} / ${fmtInt(t)}`;
        });
        this.computed = res.values;
        this.report = res.report;
        this.recalcWhere = res.where;
      } catch (e) {
        toast("Recalcul impossible : " + (e instanceof Error ? e.message : String(e)), "error", 6000);
      }
      this.busy = false;
    }
    if (wb) {
      const { sheetMatrix, guessSheet } = await import("../data/workbook");
      wb.sheets.forEach((s, i) => {
        const m = sheetMatrix(s, this.computed?.[i] ?? null);
        this.matrices.set(s.name, m);
        this.guesses.push(guessSheet(s.name, m, s.formulas));
      });
    } else if (src.matrix) {
      this.matrices.set(src.name, src.matrix);
    }
    const best = [...this.guesses].sort((a, b) => b.score - a.score)[0]?.name ?? src.name;
    this.selectSheet(best);
  }

  close(): void {
    this.isOpen = false;
    this.hideMenu();
    this.root.classList.add("hidden");
    window.clearTimeout(this.previewTimer);
  }

  /* ------------------------------------------------------------ navigation */

  selectSheet(name: string): void {
    const m = this.matrices.get(name);
    if (!m) return;
    this.sheet = name;
    this.structure = detectStructure(m, name);
    this.selectTable(this.structure.main);
  }

  selectTable(i: number): void {
    if (!this.structure) return;
    const t = this.structure.tables[i];
    this.tableIdx = i;
    this.selected.clear();
    if (!t) {
      this.lt = null;
      this.st = null;
      this.renderAll();
      return;
    }
    this.lt = toLongTable(t, this.tableTitle(t), { opening: this.withOpening });
    const st = defaultMapping(this.lt, this.tableTitle(t));
    // Plusieurs variantes de dates (mêmes années deux fois) : on garde la première par défaut
    this.st = t.variants.length > 1 ? setFilter(st, F.variant, [t.variants[0]!]) : st;
    this.renderAll();
  }

  private tableTitle(t: DetectedTable): string {
    const sheet = this.sheet && this.src?.workbook ? this.sheet : this.src?.name ?? "Tableau";
    return t.kind === "main" && t.title === sheet ? sheet : t.title && t.title !== sheet ? t.title.replace(/^\d+\.\s*/, "") : sheet;
  }

  private update(st: MappingState): void {
    this.st = st;
    this.renderRoles();
    this.renderGrid();
    this.renderFields();
    this.schedulePreview();
  }

  /* ------------------------------------------------------------ rendu */

  private renderAll(): void {
    this.renderSheets();
    this.renderTables();
    this.renderStatus();
    this.renderFields();
    this.renderFilters();
    this.renderGroupBar();
    this.renderGrid();
    this.renderRoles();
    this.schedulePreview(0);
  }

  private renderSheets(): void {
    const wb = this.src?.workbook;
    if (!wb) {
      fill(this.elSheets, h("p", { class: "mw-muted" }, this.src?.kind === "paste" ? "Tableau collé (une seule feuille)." : "Fichier texte (une seule feuille)."));
      return;
    }
    const best = [...this.guesses].sort((a, b) => b.score - a.score)[0]?.name;
    fill(this.elSheets, 
      ...this.guesses.map((g) => {
        const m = this.matrices.get(g.name) ?? [];
        const active = g.name === this.sheet;
        return h(
          "button",
          { class: `mw-sheet${active ? " active" : ""}${g.isData ? "" : " dim"}`, role: "option", "aria-selected": active ? "true" : "false", "data-sheet": g.name, "data-testid": "mw-sheet", disabled: this.busy, onclick: () => this.selectSheet(g.name) },
          h("span", { class: "mw-sheet-name" }, g.name, g.name === best ? h("em", { class: "mw-badge" }, "conseillé") : null),
          h("span", { class: "mw-sheet-hint" }, `${g.hint} · ${fmtInt(g.rows)} × ${g.cols}`),
          miniPreview(m)
        );
      })
    );
  }

  private renderTables(): void {
    const s = this.structure;
    if (!s || !s.tables.length) {
      fill(this.elTables, h("p", { class: "mw-muted" }, this.busy ? "…" : "Aucun tableau détecté sur cet onglet."));
      return;
    }
    const t0 = s.tables[this.tableIdx];
    fill(this.elTables, 
      ...s.tables.map((t, i) =>
        h(
          "button",
          { class: `mw-table-chip${i === this.tableIdx ? " active" : ""}`, "data-testid": "mw-table", "data-kind": t.kind, onclick: () => this.selectTable(i) },
          h("strong", null, i === s.main ? "Principal" : t.kind === "summary" ? "Résumé" : /totaux annuels/.test(t.title) ? "Totaux annuels" : `Bloc ${i + 1}`),
          h("small", null, `${this.tableTitle(t)} · ${t.rows.length} lignes${t.layout === "wide" ? ` × ${t.timeCols.length} périodes` : ""}`)
        )
      ),
      t0 && t0.openingCol !== null && t0.layout === "wide"
        ? h(
            "label",
            { class: "mw-check" },
            h("input", {
              type: "checkbox",
              checked: this.withOpening,
              "data-testid": "mw-opening",
              onchange: (e: Event) => {
                this.withOpening = (e.target as HTMLInputElement).checked;
                this.selectTable(this.tableIdx);
              },
            }),
            "Inclure la colonne « Ouverture » (avant M1)"
          )
        : null
    );
  }

  private renderStatus(): void {
    if (this.busy) return;
    const wb = this.src?.workbook;
    const r = this.report;
    const t = this.structure?.tables[this.tableIdx];
    const struct = t ? describeTable(t) : "";
    if (!wb || !wb.formulas) {
      this.elStatus.className = "mw-status";
      fill(this.elStatus, h("span", null, struct));
      return;
    }
    if (!r) {
      this.elStatus.className = "mw-status";
      fill(this.elStatus, h("span", null, `${fmtInt(wb.formulas)} formules : valeurs enregistrées par Excel utilisées. ${struct}`));
      return;
    }
    if (r.failed === 0) {
      this.elStatus.className = "mw-status ok";
      fill(this.elStatus, 
        h("strong", { "data-testid": "mw-recalc-ok" }, `✓ ${fmtInt(r.evaluated)} formules recalculées dans le navigateur (${(r.ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s${this.recalcWhere === "worker" ? ", en arrière-plan" : ""}).`),
        h("span", null, ` Le fichier ne contenait pas les résultats des formules. ${struct}`)
      );
      return;
    }
    const fns = Object.entries(r.unknownFunctions).map(([f, n]) => `${f} (${n})`);
    this.elStatus.className = "mw-status warn";
    fill(this.elStatus, 
      h("strong", { "data-testid": "mw-recalc-warn" }, `⚠ ${fmtInt(r.failed)} formule${r.failed > 1 ? "s" : ""} sur ${fmtInt(r.formulas)} n'ont pas pu être recalculées : les cellules concernées restent vides.`),
      fns.length ? h("span", null, ` Fonctions non prises en charge : ${fns.slice(0, 6).join(", ")}.`) : null,
      h("ul", { class: "mw-examples" }, ...r.examples.slice(0, 4).map((e) => h("li", null, `${e.sheet}!${e.addr} « =${e.formula.slice(0, 60)}${e.formula.length > 60 ? "…" : ""} » — ${e.reason}`)))
    );
  }

  private renderFields(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) {
      fill(this.elFields);
      return;
    }
    const roleOf = (f: string): string => {
      if (st.x === f) return "X";
      const s = st.series.find((x) => x.rowIds === null && x.measures.includes(f));
      if (s) return s.axis === 2 ? "Y2" : "Y";
      if (st.color === f) return "Couleur";
      if (st.facet === f) return "Facette";
      return "";
    };
    fill(this.elFields, 
      h("span", { class: "mw-label" }, "Champs"),
      ...lt.fields
        .filter((f) => f.name !== F.poste || !lt.wide)
        .map((f) => {
          const role = roleOf(f.name);
          return h(
            "button",
            { class: `mw-field k-${f.kind}${role ? " on" : ""}`, "data-field": f.name, "data-testid": "mw-field", "data-menu-anchor": "1", "aria-haspopup": "menu", onclick: (e: Event) => this.showMenu(e.currentTarget as HTMLElement, f.name) },
            f.name,
            role ? h("em", null, role) : null
          );
        }),
      h("button", { class: "btn mw-swap", "data-testid": "mw-swap", title: "Permuter X et Y : les séries deviennent les catégories de l'axe X", onclick: () => this.update(swapXY(this.st!)) }, "⇄ X / Y")
    );
  }

  private renderFilters(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) {
      fill(this.elFilters);
      return;
    }
    const fields = FILTER_FIELDS.filter((f) => lt.fields.some((x) => x.name === f));
    fill(this.elFilters, 
      ...fields.map((f) => {
        const vals = distinct(lt, f);
        if (vals.length < 2) return null;
        const cur = st.filters[f]?.[0] ?? "";
        const sel = h("select", { "data-filter": f, "data-testid": "mw-filter", "aria-label": `Filtre ${f}` }, h("option", { value: "" }, `${f} : ${f === F.section || f === F.variant ? "toutes" : "tous"}`), ...vals.map((v) => h("option", { value: v, selected: v === cur }, `${f} : ${v.length > 56 ? v.slice(0, 54) + "…" : v}`)));
        sel.addEventListener("change", () => {
          this.selected.clear();
          this.update(setFilter(this.st!, f, sel.value ? [sel.value] : []));
          this.renderFilters();
          this.renderGroupBar();
        });
        return h("label", { class: "mw-filter" }, sel);
      })
    );
  }

  private renderGroupBar(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st || !lt.wide) {
      fill(this.elGroupBar, lt && !lt.wide ? h("span", { class: "mw-muted" }, "Touchez un en-tête de colonne pour lui donner un rôle (X, Y, Couleur, Facette).") : "");
      return;
    }
    const n = this.selected.size;
    const agg = h("select", { "data-testid": "mw-agg", "aria-label": "Agrégat du regroupement" }, ...GROUP_AGGS.map((a) => h("option", { value: a }, GROUP_AGG_LABELS[a])));
    const name = h("input", { type: "text", class: "mw-group-name", placeholder: "Nom (facultatif)", "data-testid": "mw-group-name", "aria-label": "Nom du regroupement", maxlength: "80" });
    const doGroup = () => {
      if (!this.selected.size || !this.st) return;
      const next = groupSeries(this.st, lt, { rowIds: [...this.selected] }, agg.value as GroupAgg, name.value);
      this.selected.clear();
      this.update({ ...next, curve: next.curve });
      this.renderGroupBar();
    };
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doGroup();
    });
    fill(this.elGroupBar, 
      h("span", { class: "mw-sel-count", "data-testid": "mw-sel-count" }, n ? `${n} ligne${n > 1 ? "s" : ""} cochée${n > 1 ? "s" : ""}` : "Cochez des lignes pour les regrouper"),
      agg,
      name,
      h("button", { class: "btn btn-accent", "data-testid": "mw-group", disabled: !n, onclick: doGroup }, "Regrouper"),
      n ? h("button", { class: "btn", onclick: () => (this.selected.clear(), this.renderGrid(), this.renderGroupBar()) }, "Décocher") : null
    );
  }

  private visibleWideRows(): number[] {
    const lt = this.lt!;
    const st = this.st!;
    const w = lt.wide!;
    const f = st.filters;
    return w.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => (!f[F.section]?.length || f[F.section]!.includes(r.section)) && (!f[F.indicator]?.length || f[F.indicator]!.includes(r.indicator ?? r.label)) && (!f[F.entity]?.length || f[F.entity]!.includes(r.entity ?? "")))
      .map(({ i }) => i);
  }

  private renderGrid(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) {
      fill(this.elGrid, this.busy ? h("p", { class: "mw-muted" }, "Recalcul en cours…") : h("p", { class: "mw-muted" }, "Rien à afficher."));
      return;
    }
    if (lt.wide) {
      const w = lt.wide;
      const visCols = w.cols
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !st.filters[F.variant]?.length || !c.variant || st.filters[F.variant]!.includes(c.variant))
        .slice(0, MAX_COLS);
      const rows = this.visibleWideRows();
      const inSeries = new Map<string, number>();
      st.series.forEach((s, k) => s.rowIds?.forEach((id) => inSeries.set(id, k)));
      const allChecked = rows.length > 0 && rows.every((i) => this.selected.has(w.rows[i]!.id));
      const head = h(
        "tr",
        null,
        h(
          "th",
          { class: "mw-c-check" },
          h("input", {
            type: "checkbox",
            checked: allChecked,
            "aria-label": "Tout cocher",
            "data-testid": "mw-check-all",
            onchange: (e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              rows.forEach((i) => (on ? this.selected.add(w.rows[i]!.id) : this.selected.delete(w.rows[i]!.id)));
              this.renderGrid();
              this.renderGroupBar();
            },
          })
        ),
        h("th", { class: "mw-c-label" }, "Poste"),
        h("th", { class: "mw-c-unit" }, "Unité"),
        ...visCols.map(({ c }) => h("th", { class: "mw-c-time" }, h("button", { class: "mw-th-btn", "data-menu-anchor": "1", "data-testid": "mw-time-head", onclick: (e: Event) => this.showMenu(e.currentTarget as HTMLElement, lt.fields.some((f) => f.name === F.date) ? F.date : F.period) }, c.label))),
        w.cols.length > visCols.length ? h("th", { class: "mw-c-more" }, `+${w.cols.length - visCols.length}`) : null
      );
      const body: HTMLElement[] = [];
      let lastSection: string | null = null;
      for (const i of rows) {
        const r = w.rows[i]!;
        if (r.section !== lastSection && r.section) {
          lastSection = r.section;
          body.push(h("tr", { class: "mw-sec" }, h("td", { colspan: String(visCols.length + 4) }, r.section)));
        }
        const k = inSeries.get(r.id);
        const checked = this.selected.has(r.id);
        body.push(
          h(
            "tr",
            { class: `${k !== undefined ? "in-series" : ""}${checked ? " checked" : ""}`, "data-row": r.id },
            h(
              "td",
              { class: "mw-c-check" },
              h("input", {
                type: "checkbox",
                checked,
                "aria-label": `Cocher ${r.label}`,
                "data-testid": "mw-row-check",
                onchange: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) this.selected.add(r.id);
                  else this.selected.delete(r.id);
                  (e.target as HTMLElement).closest("tr")?.classList.toggle("checked");
                  this.renderGroupBar();
                },
              })
            ),
            h(
              "td",
              { class: "mw-c-label" },
              h(
                "button",
                { class: "mw-row-btn", "data-testid": "mw-row", "data-label": r.label, title: k !== undefined ? "Retirer de Y" : "Ajouter en Y", onclick: () => this.update(toggleRowSeries(this.st!, lt, r.id)) },
                k !== undefined ? h("i", { class: "mw-swatch", style: `--k:${k}` }) : null,
                r.label
              )
            ),
            h("td", { class: "mw-c-unit" }, r.unit),
            ...visCols.map(({ i: ci }) => {
              const v = w.values[i]![ci];
              return h("td", { class: "num" }, v == null ? "" : r.unit === "%" ? `${fmtNum.format(v * 100)} %` : fmtNum.format(v));
            }),
            w.cols.length > visCols.length ? h("td", { class: "mw-c-more" }, "…") : null
          )
        );
      }
      fill(this.elGrid, h("table", { class: "mw-table wide" }, h("thead", null, head), h("tbody", null, ...body)));
      return;
    }
    // Disposition longue : colonnes = champs (en-têtes cliquables)
    const fields = lt.fields;
    const roleOf = (f: string) => (st.x === f ? "X" : st.series.some((s) => s.rowIds === null && s.measures.includes(f)) ? "Y" : st.color === f ? "Couleur" : st.facet === f ? "Facette" : "");
    const head = h(
      "tr",
      null,
      ...fields.map((f) => {
        const role = roleOf(f.name);
        return h("th", { class: role ? "on" : "" }, h("button", { class: "mw-th-btn", "data-menu-anchor": "1", "data-testid": "mw-col-head", "data-field": f.name, onclick: (e: Event) => this.showMenu(e.currentTarget as HTMLElement, f.name) }, f.name, role ? h("em", null, role) : null));
      })
    );
    const body = lt.rows.slice(0, 200).map((r) =>
      h(
        "tr",
        null,
        ...fields.map((f) => {
          const v = r[f.name];
          return h("td", { class: f.kind === "measure" ? "num" : "" }, v == null ? "" : f.kind === "date" && typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : typeof v === "number" ? fmtNum.format(v) : String(v));
        })
      )
    );
    fill(this.elGrid, h("table", { class: "mw-table long" }, h("thead", null, head), h("tbody", null, ...body)), lt.rows.length > 200 ? h("p", { class: "mw-muted" }, `… ${fmtInt(lt.rows.length - 200)} lignes de plus`) : "");
  }

  private renderRoles(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) {
      fill(this.elRoles);
      this.applyBtn.disabled = true;
      return;
    }
    this.applyBtn.disabled = false;
    const dims = lt.fields.filter((f) => f.kind !== "measure").map((f) => f.name);
    const sel = (label: string, testid: string, value: string | null, opts: string[], on: (v: string | null) => void, none = "Aucun") => {
      const s = h("select", { "data-testid": testid, "aria-label": label }, h("option", { value: "" }, none), ...opts.map((o) => h("option", { value: o, selected: o === value }, o)));
      s.addEventListener("change", () => on(s.value || null));
      return h("label", { class: "mw-role" }, h("span", null, label), s);
    };
    const type = h("select", { "data-testid": "mw-type", "aria-label": "Type de graphique" }, ...PREVIEW_TYPES.map((t) => h("option", { value: t, selected: t === st.type }, CHART_TYPE_LABELS[t])));
    type.addEventListener("change", () => this.update({ ...this.st!, type: type.value as ChartType }));
    const curve = h("select", { "data-testid": "mw-curve", "aria-label": "Courbe" }, ...CURVES.map(([c, l]) => h("option", { value: c, selected: c === st.curve }, l)));
    curve.addEventListener("change", () => this.update({ ...this.st!, curve: curve.value as MappingState["curve"] }));
    const title = h("input", { type: "text", value: st.title, "data-testid": "mw-title", "aria-label": "Titre", maxlength: "160" });
    title.addEventListener("input", () => {
      this.st = { ...this.st!, title: title.value };
      this.schedulePreview();
    });
    const xOpts = st.swapped ? [] : dims;
    fill(this.elRoles, 
      h("label", { class: "mw-role mw-role-title" }, h("span", null, "Titre"), title),
      h("div", { class: "mw-role-row" }, h("label", { class: "mw-role" }, h("span", null, "Type"), type), h("label", { class: "mw-role" }, h("span", null, "Courbe"), curve)),
      st.swapped
        ? h("p", { class: "mw-role mw-swapped", "data-testid": "mw-swapped" }, h("span", null, "X"), "Séries (permuté ⇄)")
        : sel("X", "mw-x", this.st!.x, xOpts, (v) => this.update(assignField(this.st!, lt, v ?? this.st!.x ?? "", v ? "x" : "none"))),
      h(
        "div",
        { class: "mw-series", "data-testid": "mw-series" },
        h("span", { class: "mw-label" }, `Y (${st.series.length})`),
        st.series.length
          ? st.series.map((s, k) => {
              const name = h("input", { type: "text", value: s.label, "aria-label": "Nom de la série", maxlength: "80" });
              name.addEventListener("change", () => this.update(renameSeries(this.st!, s.id, name.value)));
              name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur());
              return h(
                "div",
                { class: "mw-serie", "data-testid": "mw-serie" },
                h("i", { class: "mw-swatch", style: `--k:${k}` }),
                name,
                h("button", { class: `mw-mini${s.axis === 2 ? " on" : ""}`, title: "Axe secondaire (à droite)", "aria-pressed": s.axis === 2 ? "true" : "false", onclick: () => this.update(setSeriesAxis(this.st!, s.id, s.axis === 2 ? 1 : 2)) }, "axe 2"),
                h("button", { class: "mw-mini", title: "Retirer", "aria-label": `Retirer ${s.label}`, onclick: () => this.update(removeSeries(this.st!, s.id)) }, "✕")
              );
            })
          : h("p", { class: "mw-muted" }, lt.wide ? "Touchez un libellé de ligne pour l'ajouter." : "Touchez un en-tête de colonne → Y.")
      ),
      sel("Couleur / Groupe", "mw-color", this.st!.color, dims.filter((d) => d !== this.st!.x), (v) => this.update({ ...this.st!, color: v }), "Aucune"),
      sel("Facette", "mw-facet", this.st!.facet, dims.filter((d) => d !== this.st!.x), (v) => this.update({ ...this.st!, facet: v }), "Aucune")
    );
  }

  /* ------------------------------------------------------------ menu des rôles */

  private showMenu(anchor: HTMLElement, field: string): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) return;
    const isMeasure = lt.fields.find((f) => f.name === field)?.kind === "measure";
    const roles: Role[] = isMeasure ? ["y", "y2", "x", "none"] : ["x", "color", "facet", "none"];
    fill(this.menu, 
      h("p", { class: "mw-menu-title" }, field),
      ...roles.map((r) =>
        h(
          "button",
          {
            role: "menuitem",
            class: "mw-menu-item",
            "data-role": r,
            onclick: () => {
              this.hideMenu();
              if (r === "x" && this.st!.swapped) this.update(swapXY(assignField(this.st!, lt, field, "x")));
              else this.update(assignField(this.st!, lt, field, r));
              this.renderFilters();
            },
          },
          r === "none" ? "Aucun rôle" : ROLE_LABELS[r]
        )
      )
    );
    const box = anchor.getBoundingClientRect();
    const host = this.root.querySelector(".mw")!.getBoundingClientRect();
    this.menu.style.left = `${Math.min(box.left - host.left, host.width - 200)}px`;
    this.menu.style.top = `${box.bottom - host.top + 4}px`;
    this.menu.classList.remove("hidden");
    (this.menu.querySelector("button") as HTMLButtonElement | null)?.focus();
  }
  private hideMenu(): void {
    this.menu.classList.add("hidden");
  }

  /* ------------------------------------------------------------ aperçu */

  private schedulePreview(delay = 160): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.renderPreview(), delay);
  }

  private renderPreview(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) {
      fill(this.elPreview);
      this.elPrevMsg.textContent = this.busy ? "" : "Aucun tableau exploitable sur cet onglet : choisissez-en un autre.";
      return;
    }
    const p = pivot(lt, st);
    this.lastPivot = p;
    if (p.empty) {
      fill(this.elPreview);
      this.elPrevMsg.textContent = p.empty;
      this.elPrevMsg.className = "mw-prev-msg warn";
      return;
    }
    try {
      const ds = buildDataset(st.title || lt.name, p.rows);
      const facets = p.facet ? p.facetValues.slice(0, 6) : [null];
      const svgs = facets.map((fv) => {
        const spec = mappingSpec(this.baseSpec(), p, st, fv);
        if (!spec) throw new Error("réglages incompatibles");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
        renderChart(svg, spec, ds, prepareCache(spec, ds, null, -1), { build: 1, timePos: null }, { thumb: facets.length > 1, bare: true, now: new Date() });
        const { width, height } = chartSize(spec);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        return svg;
      });
      this.elPreview.className = `mw-preview${svgs.length > 1 ? " facets" : ""}`;
      fill(this.elPreview, ...svgs);
      const n = p.rows.length;
      const extra = p.facet && p.facetValues.length > 6 ? ` · ${p.facetValues.length - 6} facettes non affichées` : "";
      this.elPrevMsg.className = "mw-prev-msg";
      this.elPrevMsg.textContent = `${fmtInt(n)} points · ${p.y.length + (p.y2 ? 1 : 0)} série(s)${p.series ? ` par ${p.series}` : ""}${extra}${p.facet ? " · « Appliquer » garde la 1re facette (filtre modifiable)" : ""}`;
    } catch (e) {
      fill(this.elPreview);
      this.elPrevMsg.className = "mw-prev-msg warn";
      this.elPrevMsg.textContent = "Aperçu impossible : " + (e instanceof Error ? e.message : String(e));
    }
  }

  /* ------------------------------------------------------------ appliquer */

  apply(): void {
    const lt = this.lt;
    const st = this.st;
    if (!lt || !st) return;
    const p = pivot(lt, st);
    if (p.empty) {
      toast(p.empty, "info", 4000);
      return;
    }
    const spec = mappingSpec(this.baseSpec(), p, st, p.facet ? p.facetValues[0] ?? null : null);
    if (!spec) {
      toast("Réglages incompatibles avec ce type de graphique.", "error");
      return;
    }
    const parts = [this.sheet && this.src?.workbook ? `Onglet « ${this.sheet} »` : null, this.report ? `${fmtInt(this.report.evaluated)} formules recalculées${this.report.failed ? `, ${fmtInt(this.report.failed)} non évaluées` : ""}` : null, `mise en forme : ${[...st.series.map((s) => s.label)].slice(0, 3).join(", ")}${st.series.length > 3 ? "…" : ""}`];
    // Nom du jeu de données = onglet (ou fichier) : il sert d'entité dans le sous-titre calculé, sans répéter le titre
    const dsName = (this.src?.workbook ? this.sheet : null) ?? this.src?.name ?? lt.name;
    this.onApply({ name: dsName || st.title || lt.name, rows: p.rows, spec, pivot: p, state: st, sheet: this.src?.workbook ? this.sheet : null, note: parts.filter(Boolean).join(" · ") });
    this.close();
  }

  /* ------------------------------------------------------------ API de test (window.r4d.mapping) */

  get state(): { sheet: string | null; table: number; tables: string[]; mapping: MappingState | null; pivot: PivotResult | null; report: RecalcReport | null; where: string | null; guesses: SheetGuess[]; selected: string[] } {
    return { sheet: this.sheet, table: this.tableIdx, tables: this.structure?.tables.map((t) => `${t.kind}:${t.title}`) ?? [], mapping: this.st, pivot: this.lastPivot, report: this.report, where: this.recalcWhere, guesses: this.guesses, selected: [...this.selected] };
  }
  /** Coche les lignes visibles dont l'indicateur (ou le libellé) correspond. */
  selectRows(pred: { indicator?: string; label?: RegExp | string }): number {
    const w = this.lt?.wide;
    if (!w) return 0;
    for (const i of this.visibleWideRows()) {
      const r = w.rows[i]!;
      const ok = (pred.indicator === undefined || (r.indicator ?? r.label) === pred.indicator) && (pred.label === undefined || (typeof pred.label === "string" ? r.label === pred.label : pred.label.test(r.label)));
      if (ok) this.selected.add(r.id);
    }
    this.renderGrid();
    this.renderGroupBar();
    return this.selected.size;
  }
  setState(patch: Partial<MappingState>): void {
    if (this.st) this.update({ ...this.st, ...patch });
  }
  clearSeries(): void {
    if (this.st) this.update({ ...this.st, series: [] });
  }
  setFilterValue(field: string, value: string | null): void {
    if (!this.st) return;
    this.selected.clear();
    this.update(setFilter(this.st, field, value ? [value] : []));
    this.renderFilters();
    this.renderGroupBar();
  }
  suggestCurve(): void {
    if (this.st && this.lastPivot) this.update({ ...this.st, curve: suggestCurve(pivot(this.lt!, this.st)) });
  }
}

/* ---------------------------------------------------------------- utilitaires */

type Kid = Node | string | null | undefined | false | Kid[];
function fill(el: HTMLElement, ...kids: Kid[]): void {
  el.replaceChildren(...(kids.flat(3) as (Node | string | null | undefined | false)[]).filter((k): k is Node | string => k !== null && k !== undefined && k !== false));
}

function describeTable(t: DetectedTable): string {
  const bits: string[] = [];
  if (t.layout === "wide") bits.push(`tableau large : ${t.rows.length} postes × ${t.timeCols.length} périodes`);
  else bits.push(`tableau en colonnes : ${t.rows.length} lignes`);
  if (t.timeSource === "row") bits.push("ligne « Mois » datée");
  if (t.sections.length) bits.push(`${t.sections.length} sections`);
  if (t.unitCol !== null) bits.push("colonne d'unités");
  if (t.split) bits.push("libellés découpés en Entité + Indicateur");
  if (t.notes.length) bits.push(`${t.notes.length} ligne(s) de titre / notes ignorée(s)`);
  return "Détecté : " + bits.join(" · ") + ".";
}

/** Aperçu miniature (6 × 6 premières cellules non vides). */
function miniPreview(m: Matrix): HTMLElement {
  const rows = m.filter((r) => r.some((v) => v !== null && v !== "")).slice(0, 6);
  const cell = (v: unknown) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 7);
    if (typeof v === "number") return fmtNum.format(v);
    const s = String(v);
    return s.length > 14 ? s.slice(0, 13) + "…" : s;
  };
  return h("table", { class: "mw-mini-table", "aria-hidden": "true" }, h("tbody", null, ...rows.map((r) => h("tr", null, ...Array.from({ length: 6 }, (_, c) => h("td", null, cell(r[c])))))));
}
