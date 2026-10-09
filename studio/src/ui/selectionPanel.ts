/**
 * Panneau de droite contextuel de la sélection par touchers : il répète le fil d'Ariane et n'affiche que les réglages
 * de l'objet sélectionné — graphique (type, tri, axes, légende), série (couleur, forme, étiquettes), élément (couleur
 * propre, mise en avant), libellé (texte avec jeton {valeur}, police, couleur, portée « ce libellé / toute la série »).
 * Les réglages d'un seul élément s'écrivent dans `style.overrides[clé]` (hors empreinte tant qu'ils sont vides).
 */
import type { Store } from "../state";
import { CHART_FAMILIES, CHART_TYPE_LABELS, type ChartSpec, type ChartType, type MarkOverride } from "../spec";
import { withOverride } from "../charts/overrides";
import { crumbs, levelNames, seriesNameOf, SEL_LEVELS, type Sel, type Selection } from "./selection";
import { focusInfo } from "./focusUi";
import { h, svgIcon, ICONS } from "./dom";
import { colorPicker } from "./nuancier";
import { elementAutoText, elementNotes } from "../story/elementNotes";

/** Couleurs proposées : bleu pétrole (charte) et neutres ; le rouge et le vert restent réservés aux écarts. */
export const MARK_COLORS: [string, string][] = [
  ["#0E6E8C", "Pétrole"],
  ["#3FA7C4", "Pétrole clair"],
  ["#08465A", "Pétrole foncé"],
  ["#7FC8DC", "Bleu glacier"],
  ["#9CA3AF", "Gris"],
  ["#52525B", "Gris foncé"],
];
export const LABEL_COLORS: [string, string][] = [
  ["#FFFFFF", "Blanc"],
  ["#18181B", "Noir"],
  ["#3FA7C4", "Pétrole clair"],
  ["#0E6E8C", "Pétrole"],
  ["#9CA3AF", "Gris"],
];

const BARS: ChartType[] = ["bar", "barH", "groupedBar", "stackedBar"];

export interface SelectionPanelActions {
  /** Montre tous les réglages (sortie du mode contextuel). */
  showAll(): void;
  /** Change de type de graphique (même chemin que la galerie). */
  pickType(t: ChartType): void;
}

export class SelectionPanel {
  readonly root: HTMLElement;
  private store: Store;
  private selection: Selection;
  private actions: SelectionPanelActions;
  private key = "";
  /** Portée des réglages de libellé : ce libellé seulement, ou toute la série. */
  private scope: "one" | "series" = "one";

  constructor(store: Store, selection: Selection, actions: SelectionPanelActions) {
    this.store = store;
    this.selection = selection;
    this.actions = actions;
    this.root = h("div", { class: "selp", "data-testid": "sel-panel", hidden: true });
    selection.onChange(() => {
      this.scope = "one";
      this.update(true);
    });
  }

  get active(): boolean {
    const s = this.selection.sel;
    return !!s && s.level !== "page";
  }

  update(force = false): void {
    const s = this.selection.sel;
    const spec = this.store.state.spec;
    this.root.hidden = !s;
    this.root.classList.toggle("selp-page", s?.level === "page");
    if (!s) {
      this.key = "";
      this.root.replaceChildren();
      return;
    }
    if (s.level === "page") {
      if (this.key === "page") return;
      this.key = "page";
      this.root.replaceChildren(
        h(
          "div",
          { class: "selp-head" },
          h("nav", { class: "selp-crumbs", "data-testid": "sel-crumbs" }, h("b", null, "Page")),
          h("small", { class: "selp-sub" }, "Touchez encore le graphique : il est sélectionné, puis ses barres, une barre, son libellé. Échap : désélectionner."),
        )
      );
      return;
    }
    const o = spec.style.overrides;
    const key = JSON.stringify([s, this.scope, spec.type, spec.style.valueLabels, spec.style.focus.key, spec.style.focus.note, spec.style.sort, spec.style.legend, spec.axes.x.show, spec.axes.y.show, spec.style.barCap, spec.style.pointShape, spec.style.curve, s.ek ? o[s.ek] : null, s.sk ? o[s.sk] : null]);
    if (!force && key === this.key) return;
    // saisie en cours dans le panneau : on ne reconstruit pas (le texte suit déjà)
    const a = document.activeElement as HTMLElement | null;
    if (!force && a && this.root.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "checkbox") return;
    this.key = key;
    this.root.replaceChildren(...this.build(s, spec));
  }

  /* ------------------------------------------------------------ helpers */

  private ovr(k: string | null): MarkOverride {
    return (k && this.store.state.spec.style.overrides[k]) || {};
  }

  private patch(k: string, p: Partial<Record<keyof MarkOverride, unknown>>): void {
    this.store.set("style.overrides", withOverride(this.store.state.spec.style.overrides, k, p));
  }

  private card(title: string, ...kids: (Node | null)[]): HTMLElement {
    return h("section", { class: "selp-card" }, h("h4", null, title), ...(kids.filter(Boolean) as Node[]));
  }

  /** Choix de couleur : charte en ligne + « Nuancier » (grille par teinte, récentes, plus de couleurs). */
  private swatches(cur: string | undefined, list: [string, string][], pick: (c: string | null) => void, testid: string, base?: string, title?: string): HTMLElement {
    return colorPicker({ value: cur ?? null, charter: list, onPick: (c) => pick(c), testid, base, title });
  }

  private seg(cur: string, opts: [string, string][], pick: (v: string) => void, testid: string): HTMLElement {
    return h(
      "div",
      { class: "segmented", role: "radiogroup", "data-testid": testid },
      ...opts.map(([v, l]) => h("button", { type: "button", class: v === cur ? "active" : "", role: "radio", "aria-checked": v === cur ? "true" : "false", "data-value": v, onclick: () => pick(v) }, l))
    );
  }

  private toggle(on: boolean, label: string, set: (v: boolean) => void, testid: string): HTMLElement {
    const inp = h("input", { type: "checkbox", role: "switch", checked: on, "data-testid": testid });
    inp.addEventListener("change", () => set(inp.checked));
    return h("label", { class: "check" }, inp, h("span", null, label));
  }

  private field(label: string, ...controls: Node[]): HTMLElement {
    return h("div", { class: "field" }, h("span", { class: "field-label" }, label), h("div", { class: "field-line" }, ...controls));
  }

  private valueOf(s: Sel): string {
    const svg = document.querySelector("[data-testid=chart-svg]");
    const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v);
    const el = svg?.querySelector(`[data-sel-key="${esc(s.ek ?? "")}"][data-sel-value]`);
    return el?.getAttribute("data-sel-value") ?? "";
  }

  /* --------------------------------------------------------------- build */

  private build(s: Sel, spec: ChartSpec): Node[] {
    const t = spec.type;
    const names = levelNames(t);
    const cr = crumbs(s, t);
    const i = SEL_LEVELS.indexOf(s.level);
    const go = (j: number) => {
      let x: Sel | null = s;
      for (let k = i; k > j && x; k--) x = this.selection.parentOf(x);
      this.selection.set(x);
    };
    const parent = this.selection.parentOf(s);
    const parentName = parent ? cr[cr.length - 2] ?? "Page" : "";
    const head = h(
      "div",
      { class: "selp-head" },
      h("nav", { class: "selp-crumbs", "aria-label": "Fil d'Ariane", "data-testid": "sel-crumbs" }, ...cr.flatMap((c, j) => [j ? h("span", { class: "sel-sep" }, "›") : null, j === cr.length - 1 ? h("b", null, c) : h("button", { type: "button", class: "selp-crumb", onclick: () => go(j) }, c)].filter(Boolean) as HTMLElement[])),
      h(
        "div",
        { class: "selp-title" },
        h("strong", { "data-testid": "sel-title" }, this.title(s, t)),
        parent ? h("button", { type: "button", class: "btn btn-small selp-up", "data-testid": "sel-up", title: "Niveau parent (Échap)", onclick: () => this.selection.up() }, h("span", { html: svgIcon(ICONS.up, 13) }), parentName) : null
      ),
      h("small", { class: "selp-sub" }, this.subtitle(s, spec))
    );
    const body = s.level === "chart" ? this.chartCards(spec) : s.level === "series" ? this.seriesCards(s, spec) : s.level === "mark" ? this.markCards(s, spec) : this.labelCards(s, spec);
    const foot = h(
      "div",
      { class: "selp-foot" },
      h("small", null, "Toucher un objet de la sélection : niveau suivant · double-toucher une barre : cette barre · Échap ou ↑ : niveau parent"),
      h("button", { type: "button", class: "btn btn-small btn-ghost", "data-testid": "sel-all", onclick: () => this.actions.showAll() }, "Tous les réglages")
    );
    void names;
    return [head, ...body, foot];
  }

  private title(s: Sel, t: ChartType): string {
    const n = levelNames(t);
    if (s.level === "chart") return "Graphique";
    if (s.level === "series") return n.series === "Série" ? `Série « ${seriesNameOf(s.sk)} »` : n.series;
    if (s.level === "mark") return `${n.mark} « ${s.name} »`;
    return `Libellé de « ${s.name} »`;
  }

  private subtitle(s: Sel, spec: ChartSpec): string {
    if (s.level === "chart") return `${CHART_TYPE_LABELS[spec.type]} · ${spec.encoding.y.join(", ") || "—"}`;
    if (s.level === "series") return `Série « ${seriesNameOf(s.sk)} »`;
    const v = this.valueOf(s);
    if (s.level === "mark") return `${v ? `${v} · ` : ""}1 élément de la série`;
    return "Étiquette de valeur";
  }

  private chartCards(spec: ChartSpec): HTMLElement[] {
    const fam = CHART_FAMILIES.find((f) => f.types.includes(spec.type));
    const types = (fam?.types ?? [spec.type]).filter((x) => x !== "drill");
    const typeSel = h("select", { "data-testid": "sel-type" }, ...types.map((x) => h("option", { value: x, selected: x === spec.type }, CHART_TYPE_LABELS[x])));
    typeSel.addEventListener("change", () => this.actions.pickType(typeSel.value as ChartType));
    const out = [this.card("Type", this.field("Type de graphique", typeSel))];
    if (BARS.includes(spec.type) || spec.type === "pie" || spec.type === "donut" || spec.type === "radialBar")
      out.push(this.card("Tri", this.seg(spec.style.sort, [["none", "Données"], ["desc", "Décr."], ["asc", "Croiss."], ["alpha", "A→Z"]], (v) => this.store.set("style.sort", v), "sel-sort")));
    if (!["pie", "donut", "radialBar"].includes(spec.type))
      out.push(this.card("Axes", this.toggle(spec.axes.x.show, "Axe X visible", (v) => this.store.set("axes.x.show", v), "sel-axis-x"), this.toggle(spec.axes.y.show, "Axe Y visible", (v) => this.store.set("axes.y.show", v), "sel-axis-y")));
    out.push(this.card("Cadre", this.field("Légende", this.seg(spec.style.legend, [["auto", "Auto"], ["top", "Haut"], ["bottom", "Bas"], ["right", "Droite"], ["none", "Aucune"]], (v) => this.store.set("style.legend", v), "sel-legend"))));
    return out;
  }

  private seriesCards(s: Sel, spec: ChartSpec): HTMLElement[] {
    const sk = s.sk!;
    const o = this.ovr(sk);
    const out: HTMLElement[] = [];
    const radial = ["pie", "donut", "radialBar"].includes(spec.type);
    if (!radial)
      out.push(
        this.card(
          "Couleur de la série",
          this.swatches(o.color, MARK_COLORS, (c) => this.patch(sk, { color: c }), "sel-series-color", undefined, "Couleur de la série"),
          o.color ? h("button", { type: "button", class: "selp-link", "data-testid": "sel-series-color-reset", onclick: () => this.patch(sk, { color: undefined }) }, "Couleur de la palette") : null
        )
      );
    if (BARS.includes(spec.type) && (spec.type === "bar" || spec.type === "barH"))
      out.push(this.card("Forme", this.field("Extrémité", this.seg(spec.style.barCap, [["none", "Aucune"], ["icon", "Icône"], ["picto", "Pictos"]], (v) => this.store.set("style.barCap", v), "sel-barcap"))));
    if (spec.type === "scatter") out.push(this.card("Forme", this.field("Forme des points", this.seg(spec.style.pointShape, [["circle", "Ronds"], ["icon", "Une icône"], ["iconByGroup", "Par groupe"]], (v) => this.store.set("style.pointShape", v), "sel-pointshape"))));
    if (spec.type === "line" || spec.type === "area" || spec.type === "stackedArea") {
      out.push(this.card("Forme", this.field("Courbe", this.seg(spec.style.curve, [["linear", "Droite"], ["monotone", "Lissée"], ["step", "Marches"]], (v) => this.store.set("style.curve", v), "sel-curve"))));
      const fi = focusInfo(spec, this.store.state.ds);
      const name = seriesNameOf(sk);
      if (fi.kind === "series" && fi.choices.includes(name))
        out.push(this.card("Mise en avant", this.toggle(spec.style.focus.key === name, `Mettre en avant ${name}`, (v) => this.store.set("style.focus.key", v ? name : null), "sel-focus")));
    }
    const sc = radial ? null : this.commentCard(sk, seriesNameOf(sk), spec);
    if (sc) out.push(sc);
    out.push(this.card("Étiquettes", this.toggle(spec.style.valueLabels, "Étiquettes de valeur", (v) => this.store.set("style.valueLabels", v), "sel-valuelabels")));
    return out;
  }

  /**
   * « Commentaire » d'un élément (ou d'une série) : texte calculé en placeholder, saisie libre, « Rétablir le texte
   * calculé ». Il s'affiche en puce colorée sous « À retenir » dès que l'élément a sa propre couleur (ou est mis en avant).
   */
  private commentCard(key: string, name: string, spec: ChartSpec): HTMLElement | null {
    const ds = this.store.state.ds;
    const auto = elementAutoText(spec, ds, key);
    if (!auto) return null;
    const o = this.ovr(key);
    const ta = h("textarea", { rows: "3", maxlength: "300", placeholder: auto, "data-testid": "sel-comment", "aria-label": `Commentaire de ${name}` }) as HTMLTextAreaElement;
    ta.value = o.comment ?? "";
    const reset = h("button", { type: "button", class: "selp-link", "data-testid": "sel-comment-reset", hidden: !o.comment, onclick: () => { ta.value = ""; reset.hidden = true; this.patch(key, { comment: undefined }); } }, "Rétablir le texte calculé");
    ta.addEventListener("input", () => {
      const v = ta.value.trim() ? ta.value.slice(0, 300) : undefined;
      reset.hidden = !v;
      this.patch(key, { comment: v });
    });
    const shown = elementNotes(spec, ds).some((n) => n.keys.includes(key));
    return this.card(
      "Commentaire",
      ta,
      h("small", { class: "hint", "data-testid": "sel-comment-hint" }, shown ? "Puce colorée sous le graphique (« À retenir »), à la couleur de l'élément. Vide : texte calculé." : "Apparaît en puce colorée sous « À retenir » dès que l'élément a sa propre couleur (ou est mis en avant)."),
      reset
    );
  }

  private markCards(s: Sel, spec: ChartSpec): HTMLElement[] {
    const ek = s.ek!;
    const o = this.ovr(ek);
    const n = levelNames(spec.type);
    const out: HTMLElement[] = [
      this.card(
        ({ Barre: "Couleur de cette barre", Part: "Couleur de cette part", Point: "Couleur de ce point", Arc: "Couleur de cet arc" } as Record<string, string>)[n.mark] ?? "Couleur",
        this.swatches(o.color, MARK_COLORS, (c) => this.patch(ek, { color: c }), "sel-mark-color", undefined, "Couleur de l'élément"),
        h(
          "small",
          { class: "hint" },
          `Remplace la couleur de la série pour ${s.name} seulement`,
          o.color ? " · " : "",
          o.color ? h("button", { type: "button", class: "selp-link", "data-testid": "sel-mark-color-reset", onclick: () => this.patch(ek, { color: undefined }) }, "revenir à la série") : ""
        )
      ),
    ];
    const fi = focusInfo(spec, this.store.state.ds);
    const fkey = ek.slice(2);
    if (fi.kind && fi.kind !== "series" && !ek.includes("|") && fi.choices.includes(fkey)) {
      const on = spec.style.focus.key === fkey;
      const note = h("input", { type: "text", value: on ? spec.style.focus.note : "", placeholder: "Commentaire (calculé si vide)", maxlength: "200", "data-testid": "sel-focus-note", disabled: !on });
      note.addEventListener("input", () => this.store.set("style.focus.note", note.value));
      out.push(this.card("Mise en avant", this.toggle(on, `Mettre en avant ${s.name}`, (v) => this.store.set("style.focus.key", v ? fkey : null), "sel-focus"), this.field("Note", note)));
    }
    const cc = this.commentCard(ek, s.name, spec);
    if (cc) out.splice(1, 0, cc);
    out.push(this.card("Libellé", h("button", { type: "button", class: "btn btn-small", "data-testid": "sel-to-label", onclick: () => this.selection.set({ ...s, level: "label" }) }, "Modifier le libellé ›")));
    return out;
  }

  private labelCards(s: Sel, spec: ChartSpec): HTMLElement[] {
    const k = this.scope === "series" && s.sk ? s.sk : s.ek!;
    const o = this.ovr(k);
    const v = this.valueOf(s);
    const out: HTMLElement[] = [];
    const showsLabels = spec.style.valueLabels || spec.type === "pie" || spec.type === "donut" || spec.type === "radialBar" || spec.type === "scatter";
    if (!showsLabels)
      out.push(this.card("Étiquettes masquées", h("small", { class: "hint" }, "Les étiquettes de valeur sont masquées sur ce graphique."), h("button", { type: "button", class: "btn btn-small", "data-testid": "sel-show-labels", onclick: () => this.store.set("style.valueLabels", true) }, "Afficher les étiquettes")));
    const txt = h("input", { type: "text", value: o.label ?? "", placeholder: "{valeur}", maxlength: "120", "data-testid": "sel-label-text" });
    txt.addEventListener("input", () => this.patch(k, { label: txt.value }));
    const tok = h("button", { type: "button", class: "btn btn-small selp-token", title: "Insérer le jeton {valeur}", onclick: () => { txt.value = `${txt.value}{valeur}`; this.patch(k, { label: txt.value }); } }, "{valeur}");
    out.push(this.card("Texte du libellé", h("div", { class: "field-line" }, txt, tok), h("small", { class: "hint" }, v ? `{valeur} = ${v} · texte libre autour` : "{valeur} = la valeur de l'élément · texte libre autour")));
    const size = h("select", { "data-testid": "sel-label-size" }, h("option", { value: "" }, "auto"), ...[10, 11, 12, 13, 14, 16, 18, 20, 24].map((n) => h("option", { value: String(n), selected: o.labelSize === n }, String(n))));
    size.addEventListener("change", () => this.patch(k, { labelSize: size.value ? Number(size.value) : undefined }));
    out.push(
      this.card(
        "Police",
        this.field("Taille", size),
        this.field("Graisse", this.seg(o.labelBold === false ? "normal" : o.labelBold ? "bold" : "auto", [["auto", "Auto"], ["normal", "Normal"], ["bold", "Gras"]], (x) => this.patch(k, { labelBold: x === "auto" ? undefined : x === "bold" }), "sel-label-weight")),
        this.field("Couleur", this.swatches(o.labelColor, LABEL_COLORS, (c) => this.patch(k, { labelColor: c }), "sel-label-color", undefined, "Couleur du libellé")),
        o.labelColor ? h("button", { type: "button", class: "selp-link", onclick: () => this.patch(k, { labelColor: undefined }) }, "Couleur automatique") : null,
        this.toggle(!!o.hideLabel, "Masquer ce libellé", (x) => this.patch(k, { hideLabel: x || undefined }), "sel-label-hide")
      )
    );
    if (s.sk)
      out.push(this.card("Appliquer à", this.seg(this.scope, [["one", "Ce libellé"], ["series", "Toute la série"]], (x) => {
        this.scope = x as "one" | "series";
        this.update(true);
      }, "sel-label-scope")));
    const any = Object.keys(this.ovr(s.ek)).length || (s.sk && Object.keys(this.ovr(s.sk)).some((x) => x.startsWith("label")));
    if (any)
      out.push(h("button", { type: "button", class: "selp-link selp-reset", "data-testid": "sel-label-reset", onclick: () => { this.patch(k, { label: undefined, labelColor: undefined, labelBold: undefined, labelSize: undefined, hideLabel: undefined }); } }, "Rétablir le libellé calculé"));
    return out;
  }
}
