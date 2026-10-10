/**
 * Panneau de réglages (droite), en accordéon (étape H) :
 * ① Graphique (dataset, axes, mesure, filtre de vue, nombre d'éléments, puis forme) → ② Récit → ③ Style → ④ Export,
 * une seule section ouverte à la fois,
 * un résumé d'une ligne par section, l'essentiel en haut et « Plus d'options » replié,
 * une recherche de réglages, plus aucun doublon (un réglage = un seul contrôle, cf. `data-path` unique).
 * Toucher un élément du graphique ouvre la bonne section et met le réglage en avant (`reveal`).
 * Chaque contrôle est lié à un chemin du spec ; le panneau n'est reconstruit que lorsque
 * la structure change (type, colonnes, options qui affichent / masquent des champs).
 */
import { elementNotes } from "../story/elementNotes";
import { withOverride } from "../charts/overrides";
import { colorPicker, type Swatch } from "./nuancier";
import type { Store } from "../state";
import {
  AGGREGATES,
  AGGREGATE_LABELS,
  FONT_KEYS,
  PALETTE_KEYS,
  UNITS,
  UNIT_LABELS,
  isBarType,
  isCartesian,
  isRadial,
  isSpecial,
  isVariance,
  type ChartSpec,
} from "../spec";
import type { Column } from "../data/table";
import { COLUMN_TYPE_LABELS } from "../data/table";
import { FONTS, PALETTE_LABELS, paletteColors, themeFor } from "../theme";
import { h, svgIcon, ICONS } from "./dom";
import { guessUnit } from "../format";
import { effectiveDataset, datasetBase, describeTransform } from "../data/transform";
import { datasetsOf, findDataset, isFrozenRef, rowsLabel, toRef } from "../data/datasets";
import { KIND_LABELS, type InsightKind } from "../story/insights";
import { PRODUCT_LABEL } from "../brand";
import { detectScenario, NORME_WORDING_F, SCENARIO_CODES, SCENARIO_NAMES, type ScenarioCode } from "../norme";
import { iconFor, iconSvg } from "../charts/icons";
import { iconPickLabel, openIconPicker } from "./iconPicker";
import { defaultPointIcon, effectivePointShape, groupIcons } from "../charts/pointIcons";
import { focusInfo, type FocusInfo } from "./focusUi";
import { FOCUS_LABELS } from "../charts/focus";
import { count, nounOf } from "../story/fr";
import type { FilterSpec } from "../spec";
import { DEFAULT_SECTION, SECTION_IDS, SECTION_TITLES, animKind, sectionAlias, searchMatch, sectionSummaries, sizeNote, typeShort, type PanelTarget, type SectionId } from "./panelMap";

const STORY_TEXT_PATHS = ["style.title", "style.subtitle", "story.comments.0", "story.comments.1", "story.comments.2"];

type Opt = [string, string];
type Kid = Node | null | false | undefined;

/** Actions d'export branchées par main (boutons « Télécharger » de la section Export). */
/** Fonds proposés en ligne (le nuancier donne le reste). */
const BACKGROUND_COLORS: Swatch[] = [
  ["#0B0B0D", "noir profond"],
  ["#18181B", "anthracite"],
  ["#08465A", "pétrole foncé"],
  ["#FAFAF9", "blanc cassé"],
  ["#F1F5F9", "gris bleuté clair"],
  ["#FEF3C7", "crème"],
];

export interface PanelActions {
  exportSvg: () => void;
  exportPng: () => void;
  exportWebm: (btn: HTMLButtonElement) => void;
  exportPptx: (btn: HTMLButtonElement) => void;
  snapshots: () => number;
  /** Mise en avant : le prochain toucher sur une marque du graphique la choisit. */
  pickFocus?: () => void;
  /** Fenêtre Données, étape « Filtrer » : modifier un dataset (id) ou en créer un depuis la source (null). */
  editDataset?: (id: string | null) => void;
}

interface Sec {
  root: HTMLElement;
  head: HTMLButtonElement;
  bd: HTMLElement;
  sum: HTMLElement;
  num: HTMLElement;
  more: HTMLElement | null;
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private store: Store;
  private actions: PanelActions | null;
  private key = "";
  private secs = new Map<SectionId, Sec>();
  private moreOpen = new Set<SectionId>();
  readonly search: HTMLInputElement;
  private searchInfo: HTMLElement;
  private flashTimer = 0;
  /** Contrôle « Filtrer » : colonne choisie et recherche (conservées quand le panneau se reconstruit). */
  private filterUi: { field: string | null; q: string; mode: "in" | "notIn" } = { field: null, q: "", mode: "in" };

  constructor(store: Store, actions: PanelActions | null = null) {
    this.store = store;
    this.actions = actions;
    this.body = h("div", { class: "panel-body settings-body acc" });
    this.search = h("input", { type: "search", class: "acc-search-in", placeholder: "Rechercher un réglage…", title: "Rechercher un réglage (ex. « décimales », « légende », « unité »)", "aria-label": "Rechercher un réglage", "data-testid": "settings-search", autocomplete: "off", spellcheck: "false" });
    this.search.addEventListener("input", () => this.applySearch());
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.search.value) {
        e.stopPropagation();
        this.clearSearch();
      }
    });
    this.searchInfo = h("p", { class: "acc-search-info", "data-testid": "settings-search-info", hidden: true, "aria-live": "polite" });
    this.root = h(
      "aside",
      { class: "panel panel-right", "data-testid": "settings-panel" },
      h(
        "header",
        { class: "panel-head" },
        h("span", { class: "panel-icon", html: svgIcon(ICONS.sliders, 18) }),
        h("h2", null, "Réglages"),
        h("button", { class: "icon-btn collapse-btn", title: "Replier le panneau", "aria-label": "Replier le panneau", html: svgIcon(ICONS.chevronR, 18), onclick: () => store.setUi({ rightCollapsed: !store.state.ui.rightCollapsed }) })
      ),
      h("div", { class: "acc-search" }, h("span", { class: "acc-search-ic", html: svgIcon(ICONS.search, 16) }), this.search),
      this.body
    );
  }

  /** Section ouverte (ou null : toutes repliées). */
  get openSection(): SectionId | null {
    const s = this.store.state.ui.panelSection;
    return s === "" ? null : sectionAlias(s) ?? DEFAULT_SECTION;
  }

  private seqOptions: HTMLElement | null = null;

  /** Options de la séquence (Même échelle, Transitions Morph) affichées dans la carte Export. */
  setSequenceOptions(el: HTMLElement): void {
    this.seqOptions = el;
    this.key = "";
    this.update();
  }

  update(): void {
    const { spec, ds, dsVersion } = this.store.state;
    const key = JSON.stringify([
      dsVersion,
      spec.type,
      spec.encoding,
      spec.mode.kind,
      spec.mode.fourD.enabled,
      spec.mode.buildIn,
      spec.style.background,
      spec.style.palette,
      spec.style.size.preset,
      spec.axes.x.unit,
      spec.axes.y.unit,
      spec.axes.y2.unit,
      spec.axes.x.scale,
      spec.axes.y.scale,
      spec.transform,
      spec.dataset,
      this.store.state.datasets.map((d) => [d.id, d.name, d.version, d.source]),
      spec.story.showComments,
      spec.style.horizontal,
      spec.variance,
      spec.norme.enabled,
      spec.norme.autoSwitch,
      spec.special.mapRegion,
      spec.style.barCap,
      spec.style.barCap === "icon" || spec.style.barCap === "picto" ? spec.style.capIcons : null,
      spec.type === "scatter" ? [spec.style.pointShape, spec.style.pointIcon, spec.style.pointIcons] : null,
      !!spec.style.focus.key,
      spec.type === "drill" ? [spec.drill.view, spec.drill.by, spec.drill.path.length] : null,
      ds?.columns.map((c) => c.type),
    ]);
    if (key !== this.key) {
      this.key = key;
      const scroll = this.body.scrollTop;
      const cols = ds ? effectiveDataset(spec, ds).columns : [];
      this.secs.clear();
      this.body.replaceChildren(...this.build(spec, cols), this.searchInfo);
      this.indexItems();
      this.applyOpen();
      if (this.search.value.trim()) this.applySearch();
      this.body.scrollTop = scroll;
    }
    this.syncControls();
    this.syncStory();
    this.syncSummaries();
  }

  /* ------------------------------------------------------------ accordéon */

  /** Ouvre une section (les autres se replient) ; `null` replie tout. */
  open(idIn: SectionId | "donnees" | null, scroll = true): void {
    const id = idIn == null ? null : sectionAlias(idIn);
    this.store.state.ui.panelSection = id ?? "";
    this.store.save();
    this.applyOpen();
    if (id && scroll) this.secs.get(id)?.root.scrollIntoView?.({ block: "nearest" });
  }

  private applyOpen(): void {
    const cur = this.openSection;
    for (const [id, s] of this.secs) {
      const on = id === cur;
      s.root.classList.toggle("open", on);
      s.head.setAttribute("aria-expanded", on ? "true" : "false");
      s.bd.hidden = !on;
      if (s.more) this.paintMore(id);
    }
  }

  private setMore(id: SectionId, on: boolean): void {
    if (on) this.moreOpen.add(id);
    else this.moreOpen.delete(id);
    this.paintMore(id);
  }

  private paintMore(id: SectionId): void {
    const m = this.secs.get(id)?.more;
    if (!m) return;
    const on = this.moreOpen.has(id);
    m.classList.toggle("open", on);
    m.querySelector(".more-btn")?.setAttribute("aria-expanded", on ? "true" : "false");
    const bd = m.querySelector<HTMLElement>(".more-bd");
    if (bd) bd.hidden = !on;
  }

  /**
   * Toucher / cliquer un élément du graphique : ouvre la section, déplie « Plus d'options » au besoin,
   * fait défiler jusqu'au réglage et le met brièvement en surbrillance (sans prendre le focus).
   */
  reveal(t: PanelTarget): Element | null {
    if (this.store.state.ui.rightCollapsed) this.store.setUi({ rightCollapsed: false });
    if (this.search.value) this.clearSearch();
    this.open(t.section, false);
    const sec = this.secs.get(t.section);
    if (!sec) return null;
    let el: Element | null = t.group ? sec.root.querySelector(`[data-group="${t.group}"]`) : null;
    let which = t.group ?? "";
    if (!el)
      for (const p of t.paths) {
        const c = sec.root.querySelector(`[data-path="${p}"], [data-target="${p}"]`);
        if (c) {
          el = c.closest("[data-item]") ?? c;
          which = p;
          break;
        }
      }
    if (!el) el = sec.head;
    if (el.closest(".more")) this.setMore(t.section, true);
    this.root.setAttribute("data-revealed", `${t.section}:${which}`);
    for (const x of this.root.querySelectorAll(".flash, .flash-sec")) x.classList.remove("flash", "flash-sec");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("flash");
    sec.root.classList.add("flash-sec");
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      el?.classList.remove("flash");
      sec.root.classList.remove("flash-sec");
    }, 1900);
    const target = el;
    // après l'éventuel dépliage du panneau (mise en page)
    window.setTimeout(() => (target as HTMLElement).scrollIntoView?.({ block: "center" }), 30);
    return el;
  }

  /* ------------------------------------------------------------ recherche */

  clearSearch(): void {
    this.search.value = "";
    this.applySearch();
  }

  private applySearch(): void {
    const q = this.search.value.trim();
    this.body.classList.toggle("searching", !!q);
    let total = 0;
    for (const s of this.secs.values()) {
      let n = 0;
      for (const it of s.root.querySelectorAll<HTMLElement>("[data-item]")) {
        const ok = !q || searchMatch(it.dataset.kw ?? "", q);
        it.classList.toggle("s-miss", !ok);
        if (ok) n++;
      }
      for (const g of s.root.querySelectorAll<HTMLElement>("[data-group]")) g.classList.toggle("s-miss", !!q && !g.querySelector("[data-item]:not(.s-miss)"));
      s.more?.classList.toggle("s-hit", !!q && !!s.more.querySelector("[data-item]:not(.s-miss)"));
      s.root.classList.toggle("s-hit", !!q && n > 0);
      s.root.classList.toggle("s-none", !!q && n === 0);
      total += q ? n : 0;
    }
    this.searchInfo.hidden = !q;
    this.searchInfo.textContent = !q ? "" : total ? `${total} réglage${total > 1 ? "s" : ""} pour « ${q} »` : `Aucun réglage ne correspond à « ${q} » — essayez « unité », « légende », « couleurs », « format »…`;
    this.searchInfo.classList.toggle("empty", !!q && !total);
  }

  /** Mots-clés de recherche : libellés et aides visibles (sans les options des listes) + synonymes. */
  private indexItems(): void {
    const mark = (parent: Element) => {
      for (const c of [...parent.children]) {
        if (!(c instanceof HTMLElement)) continue;
        if (c.matches(".more")) {
          const bd = c.querySelector(".more-bd");
          if (bd) mark(bd);
          continue;
        }
        if (c.matches("[data-group]")) {
          mark(c);
          continue;
        }
        if (c.matches("h4, .acc-search-info")) continue;
        c.setAttribute("data-item", "");
      }
    };
    for (const s of this.secs.values()) mark(s.bd);
    for (const it of this.body.querySelectorAll<HTMLElement>("[data-item]")) {
      const clone = it.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("select, textarea, input, .swatches, .tile-sw").forEach((x) => x.remove());
      const group = it.closest("[data-group]")?.querySelector("h4")?.textContent ?? "";
      const sec = it.closest<HTMLElement>("[data-section]")?.dataset.section as SectionId | undefined;
      it.dataset.kw = [it.dataset.kw ?? "", clone.textContent ?? "", group, sec ? SECTION_TITLES[sec] : ""].join(" ").replace(/\s+/g, " ").trim();
    }
    // « Plus d'options · N » et l'aperçu des réglages repliés
    for (const s of this.secs.values()) {
      if (!s.more) continue;
      const bd = s.more.querySelector(".more-bd")!;
      // les notes (paragraphes d'aide) ne comptent pas comme des réglages
      const n = bd.querySelectorAll("[data-item]:not(p)").length;
      const opts = [...bd.children].filter((c) => !c.matches("p"));
      const names: string[] = [];
      for (const c of opts) {
        const t = c.matches("[data-group]") ? c.querySelector("h4")?.textContent : (c.querySelector(".field-label, .check > span") ?? c.querySelector("b, strong"))?.textContent;
        if (t && names.length < 6) names.push(t.replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase());
      }
      const note = bd.querySelector("p")?.textContent?.trim() ?? "";
      s.more.querySelector(".more-n")!.textContent = n ? `Plus d’options · ${n}` : "À savoir";
      s.more.querySelector(".more-list")!.textContent = n ? names.join(", ") + (opts.length > names.length ? "…" : "") : note.length > 64 ? `${note.slice(0, 62).replace(/\s+\S*$/, "")}…` : note;
    }
  }

  /* ------------------------------------------------------------ synchronisation */

  /** Contrôles reflétant le spec même sans reconstruction (choix faits ailleurs : toucher, Explorer…). */
  /** Champ de couleur (charte + nuancier) lié à un chemin du spec ; resynchronisé par `syncControls`. */
  private colorField(path: string, charter: Swatch[], testid: string, title: string): HTMLElement {
    const el = h("div", { class: "nz-field", "data-path": path });
    const paint = () => {
      const v = String(this.store.get(path) ?? "");
      el.dataset.cur = v;
      el.replaceChildren(colorPicker({ value: v, charter, onPick: (c) => this.store.set(path, c), testid, base: v || undefined, title }));
    };
    (el as HTMLElement & { _paint?: () => void })._paint = paint;
    paint();
    return el;
  }

  private syncControls(): void {
    for (const f of this.body.querySelectorAll<HTMLElement & { _paint?: () => void }>(".nz-field[data-path]")) {
      if (String(this.store.get(f.dataset.path!) ?? "") !== f.dataset.cur) f._paint?.();
    }
    for (const g of this.body.querySelectorAll<HTMLElement>("[role=radiogroup][data-path]")) {
      const cur = String(this.store.get(g.dataset.path!));
      for (const b of g.querySelectorAll<HTMLElement>("[data-value]")) {
        const on = b.dataset.value === cur;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      }
    }
    for (const c of this.body.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-path]")) c.checked = !!this.store.get(c.dataset.path!);
    for (const s of this.body.querySelectorAll<HTMLSelectElement>("select[data-path]")) {
      if (document.activeElement === s || s.dataset.path!.startsWith("encoding.y")) continue;
      const v = String(this.store.get(s.dataset.path!) ?? "");
      if (s.value !== v && [...s.options].some((o) => o.value === v)) s.value = v;
    }
    for (const st of this.body.querySelectorAll<HTMLElement>(".stepper[data-path]")) {
      const v = this.store.get(st.dataset.path!) as number | null;
      const out = st.querySelector("output");
      if (out) out.textContent = v == null ? "auto" : String(v);
    }
  }

  /**
   * Récit › À retenir : puces par élément (pastille de leur couleur), modifiables ici — texte calculé en placeholder,
   * « Rétablir le texte calculé ». Reconstruit quand les puces changent (sauf pendant une saisie dans la liste).
   */
  private syncElementNotes(): void {
    const box = this.body.querySelector<HTMLElement>("[data-testid=story-elements]");
    if (!box) return;
    const { spec, ds } = this.store.state;
    const notes = elementNotes(spec, ds);
    const sig = JSON.stringify(notes.map((n) => [n.keys, n.color, n.auto, n.edited ? n.text : null]));
    if (box.dataset.sig === sig) return;
    if (box.contains(document.activeElement) && document.activeElement?.tagName === "TEXTAREA") return;
    box.dataset.sig = sig;
    const label = h("span", { class: "field-label" }, "Puces des éléments en couleur");
    if (!notes.length) {
      box.replaceChildren(label, h("small", { class: "muted small", "data-testid": "story-elements-empty" }, "Donnez sa propre couleur à une barre, une part ou une série (touchez-la sur le graphique) ou mettez un élément en avant : une puce à sa couleur s'ajoute ici et sous « À retenir »."));
      return;
    }
    box.replaceChildren(
      label,
      ...notes.map((n, i) => {
        const ta = h("textarea", { rows: "2", maxlength: "300", placeholder: n.auto, "data-target": `story.elements.${i}`, "data-testid": `story-element-text-${i}`, "aria-label": `Commentaire de ${n.labels.join(", ")}` }) as HTMLTextAreaElement;
        ta.value = n.edited ? n.text : "";
        const set = (v: string | undefined) => {
          let o = this.store.state.spec.style.overrides;
          for (const k of n.keys) o = withOverride(o, k, { comment: v });
          this.store.set("style.overrides", o);
        };
        const reset = h("button", { type: "button", class: "selp-link", "data-testid": `story-element-reset-${i}`, hidden: !n.edited, onclick: () => { ta.value = ""; reset.hidden = true; set(undefined); } }, "Rétablir le texte calculé");
        ta.addEventListener("input", () => {
          const v = ta.value.trim() ? ta.value.slice(0, 300) : undefined;
          reset.hidden = !v;
          set(v);
        });
        ta.addEventListener("blur", () => queueMicrotask(() => this.syncElementNotes()));
        return h(
          "div",
          { class: "story-elem", "data-testid": `story-element-${i}`, "data-color": n.color },
          h("div", { class: "story-elem-head" }, h("span", { class: "story-elem-dot", style: `background:${n.color}` }), h("span", { class: "story-elem-name" }, n.labels.join(", "))),
          ta,
          reset
        );
      })
    );
  }

  /** Recopie les textes calculés dans les champs (sauf celui en cours de saisie) et les badges. */
  private syncStory(): void {
    this.syncElementNotes();
    const spec = this.store.state.spec;
    for (const path of STORY_TEXT_PATHS) {
      const el = this.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-path="${path}"]`);
      if (!el || document.activeElement === el) continue;
      const v = String(this.store.get(path) ?? "");
      if (el.value !== v) el.value = v;
    }
    const ed = spec.story.edited;
    const badge = (which: "title" | "subtitle" | "comments") => {
      const b = this.body.querySelector<HTMLElement>(`[data-badge="${which}"]`);
      if (!b) return;
      b.textContent = ed[which] ? "modifié" : "calculé";
      b.classList.toggle("edited", ed[which]);
      b.title = ed[which] ? "Saisie conservée lors des changements de données — « Régénérer » rétablit le texte calculé" : "Texte calculé à partir des données";
    };
    badge("title");
    badge("subtitle");
    badge("comments");
    const k = this.body.querySelector<HTMLElement>("[data-story-kind]");
    if (k) k.textContent = spec.story.kind && KIND_LABELS[spec.story.kind as InsightKind] ? `Piste : ${KIND_LABELS[spec.story.kind as InsightKind]}` : "Récit générique (selon la forme du graphique)";
  }

  private syncSummaries(): void {
    const { spec, ds } = this.store.state;
    const sums = sectionSummaries(spec, !!ds);
    for (const [id, s] of this.secs) {
      const txt = s.sum.querySelector<HTMLElement>(".acc-sum-t") ?? s.sum;
      if (txt.textContent !== sums[id]) txt.textContent = sums[id];
      s.sum.title = sums[id];
      s.num.textContent = String(SECTION_IDS.indexOf(id) + 1);
    }
    const sw = this.secs.get("style")?.sum.querySelector(".acc-sum-sw");
    if (sw) sw.replaceChildren(...this.swatchList(spec, 3));
  }

  /* ------------------------------------------------------------ contrôles */

  private sectionEl(id: SectionId, main: Kid[], more: Kid[]): HTMLElement {
    const bid = `acc-${id}-h`;
    const pid = `acc-${id}-p`;
    const sum = h("small", { class: "acc-sum", "data-summary": id }, id === "style" ? h("span", { class: "acc-sum-sw", "aria-hidden": "true" }) : null, h("span", { class: "acc-sum-t" }));
    const num = h("span", { class: "acc-num", "aria-hidden": "true" }, String(SECTION_IDS.indexOf(id) + 1));
    const head = h(
      "button",
      { type: "button", class: "acc-hd", id: bid, "aria-controls": pid, "aria-expanded": "false", "data-testid": `acc-${id}`, onclick: () => this.open(this.openSection === id ? null : id) },
      num,
      h("span", { class: "acc-t" }, h("b", null, SECTION_TITLES[id]), sum),
      h("span", { class: "acc-chev", html: svgIcon(ICONS.chevronD, 16) })
    );
    const moreKids = more.filter(Boolean) as Node[];
    let moreEl: HTMLElement | null = null;
    if (moreKids.length) {
      moreEl = h(
        "div",
        { class: "more", "data-more": id },
        h(
          "button",
          { type: "button", class: "more-btn", "aria-expanded": "false", "data-testid": `more-${id}`, onclick: () => this.setMore(id, !this.moreOpen.has(id)) },
          h("span", { class: "more-car", html: svgIcon(ICONS.chevronR, 14) }),
          h("span", { class: "more-txt" }, h("b", { class: "more-n" }, "Plus d’options"), h("small", { class: "more-list" }))
        ),
        h("div", { class: "more-bd", hidden: true }, ...moreKids)
      );
    }
    const bd = h("div", { class: "acc-bd", id: pid, role: "region", "aria-labelledby": bid, hidden: true }, ...(main.filter(Boolean) as Node[]), moreEl);
    const root = h("section", { class: "acc-s", "data-section": id }, h("h3", { class: "acc-h3" }, head), bd);
    this.secs.set(id, { root, head, bd, sum, num, more: moreEl });
    return root;
  }

  private group(id: string, title: string, ...kids: Kid[]): HTMLElement {
    return h("div", { class: "acc-group", "data-group": id }, h("h4", null, title), ...(kids.filter(Boolean) as Node[]));
  }

  private kw<T extends HTMLElement>(el: T, words: string): T {
    el.dataset.kw = `${el.dataset.kw ?? ""} ${words}`.trim();
    return el;
  }

  private row(label: string, control: Node, hint?: string, kw?: string): HTMLElement {
    const el = h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("small", { class: "hint" }, hint) : null);
    return kw ? this.kw(el, kw) : el;
  }

  /** Ligne avec plusieurs contrôles (pas de <label> englobant : un clic ne doit pas activer le premier bouton). */
  private line(label: string, ...controls: Node[]): HTMLElement {
    return h("div", { class: "field" }, h("span", { class: "field-label" }, label), h("div", { class: "field-line" }, ...controls));
  }

  private select(path: string, opts: Opt[], nullable = false, after?: (v: string | null) => void): HTMLSelectElement {
    const cur = this.store.get(path);
    const sel = h(
      "select",
      { "data-path": path },
      ...(nullable ? [h("option", { value: "" }, "— aucun —")] : []),
      ...opts.map(([v, l]) => h("option", { value: v, selected: String(cur ?? "") === v }, l))
    );
    if (cur == null && nullable) sel.value = "";
    sel.addEventListener("change", () => {
      const v = sel.value === "" && nullable ? null : sel.value;
      this.store.set(path, v);
      after?.(v);
    });
    return sel;
  }

  private text(path: string, placeholder = "", max = 300): HTMLInputElement {
    const inp = h("input", { type: "text", value: String(this.store.get(path) ?? ""), placeholder, maxlength: String(max), "data-path": path });
    inp.addEventListener("input", () => this.store.set(path, inp.value));
    return inp;
  }

  private textarea(path: string, placeholder = ""): HTMLTextAreaElement {
    const ta = h("textarea", { rows: "2", placeholder, "data-path": path });
    ta.value = String(this.store.get(path) ?? "");
    ta.addEventListener("input", () => this.store.set(path, ta.value));
    return ta;
  }

  private number(path: string, opts: { nullable?: boolean; min?: number; max?: number; step?: number; scale?: number; placeholder?: string } = {}): HTMLInputElement {
    const sc = opts.scale ?? 1;
    const cur = this.store.get(path) as number | null;
    const inp = h("input", {
      type: "number",
      value: cur == null ? "" : String(cur / sc),
      min: opts.min != null ? String(opts.min) : null,
      max: opts.max != null ? String(opts.max) : null,
      step: String(opts.step ?? "any"),
      placeholder: opts.placeholder ?? (opts.nullable ? "auto" : ""),
      inputmode: "decimal",
      "data-path": path,
    });
    inp.addEventListener("change", () => {
      const raw = inp.value.replace(",", ".").trim();
      if (raw === "" && opts.nullable) {
        this.store.set(path, null);
        return;
      }
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (opts.min != null) n = Math.max(opts.min, n);
      if (opts.max != null) n = Math.min(opts.max, n);
      const errs = this.store.set(path, Math.round(n * sc * 1e6) / 1e6);
      inp.classList.toggle("invalid", errs.length > 0);
    });
    return inp;
  }

  /** Interrupteur (case à cocher stylée). */
  private check(path: string, label: string, hint?: string, kw?: string): HTMLElement {
    const inp = h("input", { type: "checkbox", role: "switch", checked: !!this.store.get(path), "data-path": path });
    inp.addEventListener("change", () => this.store.set(path, inp.checked));
    const el = h("label", { class: "check" }, inp, h("span", null, label), hint ? h("small", { class: "hint" }, hint) : null);
    return kw ? this.kw(el, kw) : el;
  }

  /** Choix exclusif (boutons) ; `parse` convertit la valeur (booléens). */
  private segmented(path: string, opts: (Opt | [string, string, string])[], o: { after?: (v: string) => void; parse?: (v: string) => unknown; cls?: string; testid?: string } = {}): HTMLElement {
    const cur = String(this.store.get(path));
    return h(
      "div",
      { class: `segmented ${o.cls ?? ""}`.trim(), role: "radiogroup", "data-path": path, "data-testid": o.testid ?? null },
      ...opts.map(([v, l, title]) =>
        h(
          "button",
          {
            type: "button",
            class: v === cur ? "active" : "",
            role: "radio",
            "aria-checked": v === cur ? "true" : "false",
            "data-value": v,
            title: title ?? null,
            onclick: () => {
              this.store.set(path, o.parse ? o.parse(v) : v);
              o.after?.(v);
            },
          },
          l
        )
      )
    );
  }

  /** Décimales : − / auto / + (0 à 4 ; « auto » = format par défaut). */
  private stepper(path: string, max = 4): HTMLElement {
    const get = () => this.store.get(path) as number | null;
    const out = h("output", null, get() == null ? "auto" : String(get()));
    const set = (d: number) => {
      const v = get();
      const n = v == null ? (d > 0 ? 1 : 0) : v + d;
      this.store.set(path, n < 0 ? null : Math.min(max, n));
    };
    return h(
      "div",
      { class: "stepper", "data-path": path, role: "group", "aria-label": "Décimales" },
      h("button", { type: "button", title: "Moins de décimales", "aria-label": "Moins de décimales", onclick: () => set(-1) }, "−"),
      out,
      h("button", { type: "button", title: "Plus de décimales", "aria-label": "Plus de décimales", onclick: () => set(1) }, "+")
    );
  }

  private colOpts(cols: Column[], filter?: (c: Column) => boolean): Opt[] {
    return cols.filter((c) => !filter || filter(c)).map((c) => [c.name, `${c.name} · ${COLUMN_TYPE_LABELS[c.type].toLowerCase()}`]);
  }

  /* -------------------------------------------------------------- sections */

  private build(spec: ChartSpec, cols: Column[]): HTMLElement[] {
    return [this.buildGraphique(spec, cols), this.buildRecit(spec), this.buildStyle(spec), this.buildExport(spec, cols)];
  }

  /** Données du dataset du graphique (recette appliquée à la source, avant le filtre de vue). */
  private baseDs() {
    return datasetBase(this.store.state.spec, this.store.state.ds);
  }

  /**
   * « Dataset ▾ » en tête de ① Graphique : la source entière ou un dataset dérivé de la source (D1, D2…).
   * Une scène figée sur une version antérieure garde sa version (option « v1 · figée »).
   */
  private datasetRow(spec: ChartSpec): HTMLElement | null {
    const st = this.store.state;
    const src = st.ds;
    if (!src) return null;
    const list = datasetsOf(st.datasets, src.name);
    const ref = spec.dataset;
    const cur = ref ? findDataset(st.datasets, src.name, ref.id) : undefined;
    const frozen = isFrozenRef(ref, cur);
    const sel = h(
      "select",
      { "aria-label": "Dataset du graphique", "data-testid": "dataset-select", "data-target": "dataset" },
      h("option", { value: "" }, `Source entière · ${rowsLabel(src.rows.length)}`),
      ...list.map((d) => h("option", { value: d.id, selected: !frozen && ref?.id === d.id }, `${d.id} · ${d.name}`)),
      ...(frozen && ref ? [h("option", { value: `@${ref.id}`, selected: true }, `${ref.id} v${ref.version} · figée (actuelle : v${cur!.version})`)] : [])
    ) as HTMLSelectElement;
    if (ref && !cur && !frozen) sel.append(h("option", { value: `@${ref.id}`, selected: true }, `${ref.id} · ${ref.name}`));
    sel.addEventListener("change", () => {
      const v = sel.value;
      if (v.startsWith("@")) return;
      const d = list.find((x) => x.id === v);
      this.store.set("dataset", d ? toRef(d) : null);
    });
    const dot = h("span", { class: "ds-dot", style: `background:${cur?.color ?? "transparent"}`, "aria-hidden": "true" });
    const edit = this.actions?.editDataset
      ? h("button", { type: "button", class: "btn btn-mini ds-edit", "data-testid": "dataset-edit", title: ref ? `Modifier le dataset ${ref.id} (filtres permanents, colonnes)` : "Nouveau dataset depuis la source : filtres permanents, colonnes gardées", onclick: () => this.actions?.editDataset?.(cur ? cur.id : null) }, ref && cur ? "Modifier" : "+ Nouveau")
      : null;
    const n = this.baseDs()?.rows.length ?? 0;
    return this.kw(
      h("div", { class: "field ds-field" }, h("span", { class: "field-label" }, "Dataset"), h("div", { class: "ds-pick" }, dot, sel, edit), h("small", { class: "hint", "data-testid": "dataset-hint" }, ref ? `${rowsLabel(n)} · ${frozen ? `version ${ref.version} (scène figée)` : "filtre permanent du dataset"}` : "Toutes les lignes de la source")),
      "dataset source données jeu filtre permanent d1 d2"
    );
  }


  /** Navigation par dimension : une carte par colonne. Axe ou couleur. Dit ce que ça fait. */
  private dimensionNav(spec: ChartSpec, cols: Column[]): HTMLElement {
    const dims = cols.filter((c) => c.type !== "number" && c.cardinality > 1 && c.cardinality <= 40);
    if (!dims.length) return h("div");
    const ds = this.store.state.ds;
    const measure = spec.encoding.y[0] ?? null;
    const top = (name: string): string => {
      if (!ds || !measure) return "";
      const acc = new Map<string, number>();
      for (const r of ds.rows) {
        const k = r[name];
        const v = r[measure];
        if (k == null || k === "" || typeof v !== "number") continue;
        acc.set(String(k), (acc.get(String(k)) ?? 0) + v);
      }
      let best = "", max = -Infinity;
      for (const [k, v] of acc) if (v > max) { max = v; best = k; }
      return best ? `Plus haut : ${best}` : "";
    };
    const cards = dims.map((c) => {
      const axe = c.name === spec.encoding.x;
      const couleur = c.name === spec.encoding.series;
      const hi = top(c.name);
      const role = axe ? "Axe" : couleur ? "Couleur" : "";
      return h(
        "div",
        { class: `dim-card${axe ? " is-on" : ""}${couleur ? " is-color" : ""}`, "data-dim": c.name },
        h("span", { class: "dim-name" }, c.name, role ? h("span", { class: "dim-role" }, role) : null),
        h("span", { class: "dim-meta" }, `${c.cardinality} valeurs${hi ? " · " + hi : ""}`),
        h("span", { class: "dim-actions" },
          h("button", { type: "button", class: axe ? "active" : "", onclick: () => this.store.set("encoding.x", c.name) }, "Axe"),
          h("button", { type: "button", class: couleur ? "active" : "", onclick: () => this.store.set("encoding.series", couleur ? null : c.name) }, "Couleur")
        )
      );
    });
    return this.kw(
      h("div", { class: "field dim-nav", "data-testid": "dim-nav" }, h("span", { class: "field-label" }, "Naviguer par dimension"), h("div", { class: "dim-cards" }, ...cards)),
      "dimension naviguer axe catégorie couleur"
    );
  }

  /* ① Graphique, partie données (ancienne carte « Données ») : dataset, axes, mesure, filtre de vue, nombre d'éléments */
  private dataFields(spec: ChartSpec, cols: Column[]): { main: Kid[]; more: Kid[] } {
    const t = spec.type;
    const num = (c: Column) => c.type === "number";
    const main: Kid[] = [];
    const more: Kid[] = [];
    const tr = spec.transform;
    if (tr.filters.length || tr.calculate.length) {
      const chips: HTMLElement[] = [];
      const labels = describeTransform(tr);
      // une période (≥ début et < fin, même libellé) = une seule pastille
      const seen = new Map<string, number[]>();
      tr.filters.forEach((f, i) => {
        const k = f.label ? `${f.field}|${f.label}` : `#${i}`;
        seen.set(k, [...(seen.get(k) ?? []), i]);
      });
      for (const idx of seen.values()) {
        const i = idx[0]!;
        const f = tr.filters[i]!;
        chips.push(
          h("span", { class: "chip", "data-testid": "transform-chip" }, h("span", null, labels[i] || f.field), h("button", { type: "button", class: "chip-x", title: "Retirer ce filtre", "aria-label": `Retirer le filtre « ${labels[i] || f.field} »`, onclick: () => this.store.set("transform.filters", tr.filters.filter((_, k) => !idx.includes(k))) }, "×"))
        );
      }
      tr.calculate.forEach((c) => chips.push(h("span", { class: "chip chip-calc", title: "Colonne calculée" }, h("span", null, `ƒ ${c.as}`))));
      main.push(this.kw(h("div", { class: "field", "data-testid": "transform-chips" }, h("span", { class: "field-label" }, tr.calculate.length ? "Filtres et calculs actifs" : "Filtres actifs"), h("div", { class: "chips" }, ...chips)), "filtre filtrer calcul colonne calculée"));
    }
    if (!cols.length) main.push(h("p", { class: "muted" }, "Chargez des données (panneau de gauche) pour choisir les colonnes."));
    else main.push(this.dimensionNav(spec, cols));
    if (t === "drill") {
      main.push(this.row("Date (axe du temps)", this.select("drill.date", this.colOpts(cols, (c) => c.type === "date"), true), "Date de création, de commande…"));
      main.push(this.row("Mesure", this.select("drill.measure", this.colOpts(cols, num), true), "Vide : nombre de lignes"));
      main.push(this.row("Répartir / détailler par", this.select("drill.by", this.colOpts(cols, (c) => c.type === "category" || (c.type === "text" && c.cardinality <= 60)), true), "Région → carte ; commercial, produit… → barres"));
      main.push(this.row("Version (Réel / Budget…)", this.select("drill.version", this.colOpts(cols, (c) => c.type === "category" || c.type === "text"), true), "Vide : exploration temporelle simple"));
      more.push(this.row("Nom de la mesure", this.text("drill.label", "ex. Pipeline créé", 60)));
      more.push(this.row("De (référence)", this.text("drill.from", "Réel 2025", 40)));
      more.push(this.row("À (comparé)", this.text("drill.to", "Budget 2026", 40)));
      more.push(this.row("Nature (Revenus / Coûts)", this.select("drill.nature", this.colOpts(cols, (c) => c.type === "category" || c.type === "text"), true), "Les coûts sont soustraits"));
      more.push(this.row("Référence : moyenne des", this.number("drill.compare", { min: 1, max: 12, step: 1 }), "périodes précédentes (hors comparaison de versions)"));
    } else if (isVariance(t)) {
      main.push(this.row("Catégories ou période (X)", this.select("encoding.x", this.colOpts(cols, (c) => c.type !== "number" || c.cardinality <= 40), true), undefined, "axe x"));
      main.push(this.row("Réel (Y1)", this.yAt(cols, 0), undefined, "mesure"));
      main.push(this.row("Référence (Y2)", this.yAt(cols, 1), "Budget (contour), N-1 (gris) ou prévision (hachuré)", "mesure budget"));
      main.push(...this.topNRows(spec, cols));
      const xc = cols.find((c) => c.name === spec.encoding.x);
      if (xc?.type === "date") more.push(this.row("Regrouper les dates par", this.select("encoding.xGrain", [["none", "Mois (auto)"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]]), undefined, "période mois trimestre année"));
    } else if (isSpecial(t)) {
      main.push(this.kw(h("p", { class: "hint ds-help" }, "La période et le filtre se règlent sur le dataset, à gauche."), "période filtre dataset"));
      main.push(this.row("Magnitude (épaisseur)", this.ySingle(cols), undefined, "mesure valeur"));
      main.push(this.row("Groupe / couleur", this.select("encoding.series", this.colOpts(cols, (c) => c.type !== "number" || c.cardinality <= 20), true), undefined, "série"));
      more.push(this.row("Libellé", this.select("encoding.label", this.colOpts(cols), true)));
      more.push(this.row("Code postal FR/BE", this.select("encoding.postal", this.colOpts(cols), true), undefined, "carte localisation"));
      more.push(this.row("Latitude", this.select("encoding.lat", this.colOpts(cols, num), true), undefined, "carte gps"));
      more.push(this.row("Longitude", this.select("encoding.lon", this.colOpts(cols, num), true), undefined, "carte gps"));
    } else {
      const xFilter = t === "scatter" ? (c: Column) => c.type !== "text" || c.cardinality <= 60 : undefined;
      main.push(this.row(t === "race" ? "Dimension (qui court)" : isRadial(t) ? "Catégories (parts)" : t === "barH" || (isBarType(t) && spec.style.horizontal) ? "Catégories (axe vertical)" : "Dimension (axe X)", this.select("encoding.x", this.colOpts(cols, xFilter), true, (v) => t === "scatter" && this.hintUnit("axes.x", v)), undefined, "axe x dimension"));
      main.push(this.row(t === "scatter" ? "Axe Y" : isRadial(t) ? "Valeur(s)" : "Mesure(s) — axe Y", t === "scatter" ? this.ySingle(cols) : this.yMulti(cols), undefined, "mesure valeur"));
      if (t === "race") {
        main.push(this.row("Période (temps)", this.select("encoding.time", this.colOpts(cols, (c) => c.type === "date" || c.type === "number"), true), "Le champ qui fait avancer la course"));
        main.push(this.row("Compteur", this.segmented("special.raceCounter", [["bas-droite", "Bas droite"], ["haut-droite", "Haut droite"], ["centre", "Centre"]])));
        main.push(this.row("Couleur du compteur", this.select("special.raceCounterColor", [["", "Texte"], ["#ffffff", "Blanc"], ["#f5c16c", "Or"], ["#7eb6ff", "Bleu"], ["#ff8a7a", "Rouge"]])));
      }
      if (t !== "scatter") main.push(this.row("Calcul", this.select("encoding.aggregate", AGGREGATES.map((a) => [a, AGGREGATE_LABELS[a]] as Opt)), undefined, "agrégat somme moyenne nombre"));
      main.push(...this.topNRows(spec, cols));
      if (!isRadial(t)) {
        const multiY = spec.encoding.y.length > 1;
        main.push(this.row("Couleur par (série)", this.select("encoding.series", this.colOpts(cols, (c) => c.type !== "number" || c.cardinality <= 24), true), multiY ? "Ignoré : plusieurs mesures forment déjà les séries" : undefined, "série groupe"));
      }
      const xc = cols.find((c) => c.name === spec.encoding.x);
      if (xc?.type === "date")
        more.push(this.row("Regrouper les dates par", this.select("encoding.xGrain", [["none", "Aucun (valeurs brutes)"], ["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]]), undefined, "période jour semaine mois trimestre année"));
      if (isCartesian(t) && t !== "scatter") {
        more.push(this.row("Axe Y secondaire (droite)", this.select("encoding.y2", this.colOpts(cols, num), true, (v) => this.hintUnit("axes.y2", v)), "Seconde série, échelle indépendante, tracée en ligne", "y2 deuxième axe"));
        if (spec.encoding.y2) more.push(this.row("Calcul de l'axe secondaire", this.select("encoding.y2Aggregate", AGGREGATES.map((a) => [a, AGGREGATE_LABELS[a]] as Opt)), undefined, "agrégat y2"));
      }
      if (t === "scatter") {
        more.push(this.row("Taille des bulles", this.select("encoding.size", this.colOpts(cols, num), true), undefined, "bulle"));
        more.push(this.row("Libellé des points", this.select("encoding.label", this.colOpts(cols), true), undefined, "étiquette"));
      }
    }
    /* Filtre de vue : sur le dataset, à gauche */
    /* Filtre de vue déplacé sur le dataset */
    if (cols.length && !isSpecial(t) && spec.norme.enabled && spec.encoding.y.length) more.push(this.scenarioRows(spec));
    const ds = this.datasetRow(spec);
    return { main: [ds, ...main], more };
  }

  /**
   * « Nombre d'éléments » (Tous / Top 5 / 10 / 20 / Perso), « Classement » (plus grands / plus petits),
   * « Autres » : graphiques à catégories (barres, secteurs, anneau, arcs, écarts), axe non temporel.
   */
  private topNRows(spec: ChartSpec, cols: Column[]): HTMLElement[] {
    const t = spec.type;
    if (!(isBarType(t) || isRadial(t) || isVariance(t))) return [];
    const x = spec.encoding.x;
    const xc = cols.find((c) => c.name === x);
    if (!xc || xc.type === "date" || xc.type === "number") return [];
    const ds = this.store.state.ds;
    const eff = ds ? effectiveDataset(spec, ds) : null;
    const total = eff ? new Set(eff.rows.map((r) => r[x!]).filter((v) => v != null && v !== "")).size : xc.cardinality;
    const n = spec.encoding.topN;
    const presets = [5, 10, 20];
    const mode = n == null ? "all" : presets.includes(n) ? String(n) : "custom";
    const kw = "top nombre d'éléments nombre de barres classement premiers derniers plus grands plus petits autres limiter";
    const setN = (v: number | null) => this.store.set("encoding.topN", v);
    const seg = h(
      "div",
      { class: "segmented seg-topn", role: "radiogroup", "aria-label": "Nombre d'éléments", "data-target": "encoding.topN", "data-testid": "topn" },
      ...([["all", "Tous"], ["5", "Top 5"], ["10", "Top 10"], ["20", "Top 20"], ["custom", "Perso"]] as Opt[]).map(([v, l]) =>
        h(
          "button",
          {
            type: "button",
            class: v === mode ? "active" : "",
            role: "radio",
            "aria-checked": v === mode ? "true" : "false",
            "data-value": v,
            onclick: () => setN(v === "all" ? null : v === "custom" ? (n != null && !presets.includes(n) ? n : Math.min(100, Math.max(1, Math.min(total - 1, 15)) || 15)) : Number(v)),
          },
          l
        )
      )
    );
    const out: HTMLElement[] = [this.kw(this.line("Nombre d'éléments", seg), kw)];
    if (n != null) {
      if (mode === "custom") {
        const inp = h("input", { type: "number", min: "1", max: "100", step: "1", value: String(n), inputmode: "numeric", "aria-label": "Nombre d'éléments affichés (1 à 100)", "data-testid": "topn-custom" }) as HTMLInputElement;
        inp.addEventListener("change", () => {
          const v = Math.round(Number(inp.value.replace(",", ".")));
          if (Number.isFinite(v)) setN(Math.max(1, Math.min(100, v)));
          else inp.value = String(n);
        });
        out.push(this.kw(this.row("Nombre perso (1 à 100)", inp), kw));
      }
      out.push(this.kw(this.line("Classement", this.segmented("encoding.topOrder", [["top", "Les plus grands"], ["bottom", "Les plus petits"]], { testid: "topn-order" })), kw));
      const additive = spec.encoding.aggregate === "sum" || spec.encoding.aggregate === "count";
      out.push(this.check("encoding.others", "Regrouper le reste en « Autres »", additive ? undefined : "Sommes et comptages seulement (une moyenne ne s'additionne pas)", kw));
    }
    const noun = nounOf(x!);
    const shown = n != null ? Math.min(n, total) : total;
    const hint = n != null && n < total ? `${shown} sur ${count(total, noun.sg, noun.pl)} ${shown > 1 ? "affichés" : "affiché"}`.replace(/affichés$/, noun.f ? "affichées" : "affichés").replace(/affiché$/, noun.f ? "affichée" : "affiché") : `${count(total, noun.sg, noun.pl)}, ${total > 1 ? (noun.f ? "toutes affichées" : "tous affichés") : noun.f ? "affichée" : "affiché"}`;
    out.push(this.kw(h("p", { class: "hint topn-hint", "data-testid": "topn-hint" }, hint), kw));
    return out;
  }

  /** Colonnes filtrables : catégories / texte (≤ 500 valeurs), dates, années numériques. */
  private filterColumns(): Column[] {
    const ds = this.baseDs();
    if (!ds) return [];
    return ds.columns.filter((c) => ((c.type === "category" || c.type === "text") && c.cardinality <= 500) || c.type === "date" || (c.type === "number" && this.yearLike(c.name)));
  }

  private yearLike(col: string): boolean {
    const ds = this.baseDs();
    if (!ds || !/ann[ée]e|year|exercice|mill[ée]sime/i.test(col)) return false;
    return ds.rows.every((r) => r[col] == null || (Number.isInteger(r[col]) && (r[col] as number) >= 1800 && (r[col] as number) <= 2200));
  }

  /**
   * « Filtrer » : une colonne → garder / exclure des valeurs (liste à cocher avec recherche) ; date ou année →
   * une année ou une période. Écrit dans `transform.filters` (mêmes pastilles que l'Explorer).
   */
  private filterBlock(spec: ChartSpec): HTMLElement {
    const ds = this.baseDs()!;
    const cols = this.filterColumns();
    const ui = this.filterUi;
    if (ui.field && !cols.some((c) => c.name === ui.field)) ui.field = null;
    const filters = spec.transform.filters;
    const kw = "filtre filtrer garder exclure valeurs année période sauf seulement";
    const colSel = h(
      "select",
      { "aria-label": "Colonne à filtrer", "data-testid": "filter-col" },
      h("option", { value: "" }, "— choisir une colonne —"),
      ...cols.map((c) => {
        const active = filters.some((f) => f.field === c.name);
        return h("option", { value: c.name, selected: c.name === ui.field }, `${c.name}${active ? " · filtré" : ""}`);
      })
    ) as HTMLSelectElement;
    colSel.addEventListener("change", () => {
      ui.field = colSel.value || null;
      ui.q = "";
      const ex = filters.find((f) => f.field === ui.field && (f.op === "in" || f.op === "notIn"));
      ui.mode = ex?.op === "notIn" ? "notIn" : "in";
      this.key = "";
      this.update();
    });
    const kids: Node[] = [colSel];
    const col = cols.find((c) => c.name === ui.field);
    const setFilters = (next: FilterSpec[]) => this.store.set("transform.filters", next);
    if (col && (col.type === "date" || col.type === "number")) {
      const isDate = col.type === "date";
      const years = [...new Set(ds.rows.map((r) => r[col.name]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map((v) => (isDate ? new Date(v).getUTCFullYear() : v)))].sort((a, b) => a - b);
      const mine = filters.filter((f) => f.field === col.name && (f.op === "gte" || f.op === "gt" || f.op === "lt" || f.op === "lte"));
      const yOf = (v: number | null) => (v == null ? null : isDate ? new Date(v).getUTCFullYear() : v);
      const lo = mine.find((f) => f.op === "gte" || f.op === "gt");
      const hi = mine.find((f) => f.op === "lt" || f.op === "lte");
      let from = yOf(lo?.value ?? null);
      let to = hi ? (hi.op === "lt" ? yOf(hi.value)! - (isDate ? 1 : 1) : yOf(hi.value)) : null;
      if (lo?.op === "gt" && from != null) from += 1;
      const apply = (a: number | null, b: number | null) => {
        const rest = filters.filter((f) => !mine.includes(f));
        if (a == null && b == null) return setFilters(rest);
        const lab = a != null && b != null ? (a === b ? `${col.name} : ${a}` : `${col.name} : ${a} → ${b}`) : a != null ? `${col.name} : depuis ${a}` : `${col.name} : jusqu'à ${b}`;
        const add: FilterSpec[] = [];
        if (a != null) add.push({ field: col.name, op: "gte", values: [], value: isDate ? Date.UTC(a, 0, 1) : a, label: lab });
        if (b != null) add.push(isDate ? { field: col.name, op: "lt", values: [], value: Date.UTC(b + 1, 0, 1), label: lab } : { field: col.name, op: "lte", values: [], value: b, label: lab });
        setFilters([...rest, ...add]);
      };
      const ySel = (cur: number | null, testid: string, label: string, onPick: (v: number | null) => void) => {
        const sel = h("select", { "aria-label": label, "data-testid": testid }, h("option", { value: "" }, "—"), ...years.map((y) => h("option", { value: String(y), selected: y === cur }, String(y)))) as HTMLSelectElement;
        sel.addEventListener("change", () => onPick(sel.value ? Number(sel.value) : null));
        return sel;
      };
      const single = from != null && from === to;
      const one = ySel(single ? from : null, "filter-year", "Une seule année", (v) => apply(v, v));
      kids.push(
        h("div", { class: "filter-years" },
          h("label", { class: "filter-y" }, h("span", null, "Année"), one),
          h("span", { class: "filter-or" }, "ou période"),
          h("label", { class: "filter-y" }, h("span", null, "De"), ySel(from, "filter-from", "Période : de", (v) => apply(v, to != null && v != null && to < v ? v : to))),
          h("label", { class: "filter-y" }, h("span", null, "À"), ySel(to, "filter-to", "Période : à", (v) => apply(from != null && v != null && from > v ? v : from, v)))
        )
      );
      if (mine.length) kids.push(h("button", { type: "button", class: "btn btn-mini filter-clear", "data-testid": "filter-clear", onclick: () => apply(null, null) }, "Toutes les années"));
    } else if (col) {
      const counts = new Map<string, number>();
      for (const r of ds.rows) {
        const v = r[col.name];
        if (v == null || v === "") continue;
        counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      }
      const values = [...counts.keys()].sort((a, b) => a.localeCompare(b, "fr"));
      const ex = filters.find((f) => f.field === col.name && (f.op === "in" || f.op === "notIn"));
      if (ex) ui.mode = ex.op as "in" | "notIn";
      const picked = new Set(ex?.values ?? []);
      const write = (mode: "in" | "notIn", set: Set<string>) => {
        const rest = filters.filter((f) => f !== ex);
        if (!set.size) return setFilters(rest);
        const vals = values.filter((v) => set.has(v));
        const head = vals.slice(0, 3).join(", ") + (vals.length > 3 ? ` (+${vals.length - 3})` : "");
        const label = mode === "in" ? `${col.name} : ${head}` : `${col.name} : sauf ${head}`;
        const at = ex ? filters.indexOf(ex) : -1;
        const f: FilterSpec = { field: col.name, op: mode, values: vals, value: null, label };
        setFilters(at >= 0 ? filters.map((x, k) => (k === at ? f : x)) : [...rest, f]);
      };
      const modeSeg = h(
        "div",
        { class: "segmented", role: "radiogroup", "aria-label": "Garder ou exclure", "data-testid": "filter-mode" },
        ...([["in", "Garder"], ["notIn", "Exclure"]] as ["in" | "notIn", string][]).map(([v, l]) =>
          h("button", { type: "button", class: ui.mode === v ? "active" : "", role: "radio", "aria-checked": ui.mode === v ? "true" : "false", "data-value": v, onclick: () => { ui.mode = v; if (picked.size) write(v, picked); else { this.key = ""; this.update(); } } }, l)
        )
      );
      const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const search = h("input", { type: "search", class: "filter-search", placeholder: `Rechercher (${values.length} valeurs)…`, value: ui.q, "aria-label": "Rechercher une valeur", "data-testid": "filter-search", autocomplete: "off" }) as HTMLInputElement;
      const list = h("div", { class: "filter-values", role: "group", "aria-label": `Valeurs de ${col.name}`, "data-testid": "filter-values" });
      const paint = () => {
        const q = norm(ui.q.trim());
        const shown = values.filter((v) => !q || norm(v).includes(q));
        list.replaceChildren(
          ...shown.slice(0, 200).map((v) => {
            const cb = h("input", { type: "checkbox", checked: picked.has(v), "data-value": v }) as HTMLInputElement;
            cb.addEventListener("change", () => {
              if (cb.checked) picked.add(v);
              else picked.delete(v);
              write(ui.mode, picked);
            });
            return h("label", { class: "filter-val" }, cb, h("span", null, v), h("small", null, String(counts.get(v))));
          }),
          ...(shown.length ? [] : [h("p", { class: "hint" }, "Aucune valeur ne correspond.")]),
          ...(shown.length > 200 ? [h("p", { class: "hint" }, `… ${shown.length - 200} de plus : affinez la recherche.`)] : [])
        );
      };
      search.addEventListener("input", () => {
        ui.q = search.value;
        paint();
      });
      paint();
      kids.push(modeSeg, search, list);
      if (picked.size) kids.push(h("button", { type: "button", class: "btn btn-mini filter-clear", "data-testid": "filter-clear", onclick: () => write(ui.mode, new Set()) }, `Retirer ce filtre (${picked.size} ${picked.size > 1 ? "valeurs" : "valeur"})`));
    }
    return this.kw(h("div", { class: "field filter-block", "data-testid": "filter-block" }, h("span", { class: "field-label" }, "Filtre de vue"), ...kids), `${kw} vue`);
  }

  /* ② Graphique : forme, tri, unités ; axes et légende dans « Plus d'options » */
  private buildGraphique(spec: ChartSpec, cols: Column[]): HTMLElement {
    const t = spec.type;
    const data = this.dataFields(spec, cols);
    const main: Kid[] = [...data.main, h("hr", { class: "acc-sep" })];
    const more: Kid[] = [...data.more];
    main.push(this.kw(h("p", { class: "acc-type" }, h("span", { class: "acc-type-k" }, "Type"), h("b", null, typeShort(t)), h("small", null, "· bande du haut")), "type de graphique"));
    if (isBarType(t) || isRadial(t))
      main.push(this.kw(this.line("Trier", this.segmented("style.sort", [["none", "Données", "Ordre des données"], ["desc", "Décr.", "Décroissant"], ["asc", "Croiss.", "Croissant"], ["alpha", "A→Z", "Alphabétique"]])), "tri ordre décroissant croissant alphabétique classement"));
    if (t === "groupedBar" || t === "stackedBar")
      main.push(this.kw(this.line("Orientation", this.segmented("style.horizontal", [["false", "Verticales"], ["true", "Horizontales"]], { parse: (v) => v === "true" })), "barres horizontales verticales"));
    if (isCartesian(t) && t !== "scatter") main.push(this.check("style.valueLabels", "Étiquettes de valeur", undefined, "valeurs libellés chiffres sur les barres"));
    if ((t === "bar" || t === "barH" || t === "race") && !spec.norme.enabled) {
      main.push(this.capTiles(spec));
      if (spec.style.barCap === "icon" || spec.style.barCap === "picto") {
        const g = this.iconRows(spec, cols);
        if (g) main.push(g);
      }
    }
    if (t === "scatter") main.push(...this.pointShapeFields(spec));
    if (t === "line" || t === "area" || t === "stackedArea" || (isCartesian(t) && spec.encoding.y2)) main.push(this.kw(this.line("Courbe", this.segmented("style.curve", [["monotone", "Lissée"], ["linear", "Droite"], ["step", "Marches"]])), "ligne lissage"));
    if (isCartesian(t) || isRadial(t)) {
      main.push(this.kw(this.line("Unité et décimales", this.select("axes.y.unit", UNITS.map((u) => [u, UNIT_LABELS[u]] as Opt)), this.stepper("axes.y.decimals")), "unité euros € k€ M€ pourcentage % décimales virgule format nombre"));
      if (spec.axes.y.unit === "custom") main.push(this.row("Suffixe personnalisé", this.text("axes.y.unitCustom", "ex. t CO₂, h, pts", 12), undefined, "unité"));
    }
    // Sens favorable et écarts : un seul contrôle (graphique d'écarts ou mode norme) — plus de doublon « Hausse = défavorable »
    if (isVariance(t) || (spec.norme.enabled && !isSpecial(t) && t !== "drill")) {
      main.push(this.row("Sens favorable", this.segmented("variance.polarity", [["higher", "Plus = mieux"], ["lower", "Moins = mieux"]], { testid: "polarity" }), "Coûts, délais, réclamations : « Moins = mieux » (une hausse s'affiche en rouge)", "hausse défavorable baisse rouge vert écart"));
      main.push(this.row("Écarts", this.segmented("variance.show", [["abs", "Absolus (barres)"], ["rel", "Relatifs % (épingles)"]]), undefined, "écart pourcentage épingle"));
      if (isVariance(t)) main.push(this.check("variance.total", "Ligne « Total »", undefined, "somme"));
    }
    if (t === "film") main.push(this.line("Géométrie", this.segmented("special.geometry", [["arc", "Arcs"], ["bar", "Barres"], ["point", "Points"]])));
    if (t === "map") main.push(this.kw(this.line("Fond de carte", this.segmented("special.mapRegion", [["fr-be", "France · Belgique"], ["europe", "Europe (pays)"], ["world", "Monde (pays)"], ["burundi", "Burundi (provinces)"]], { cls: "segmented--grid2" })), "carte pays régions monde burundi provinces"));
    if (t === "map") main.push(this.kw(this.line("Affichage", this.segmented("special.mapMark", [["point", "Point"], ["region", "Province entière"]])), "point rond province colorier région"));
    if (t === "map") main.push(this.kw(this.line("Dégradé", this.segmented("special.mapScale", [["froid-chaud", "Bleu → rouge"], ["rouge", "Rouge"], ["bleu", "Bleu"], ["vert", "Vert"], ["blanc-noir", "Blanc → noir"], ["petrole", "Pétrole"]], { cls: "segmented--grid2" })), "dégradé couleur échelle chaud froid"));
    if (t === "map") main.push(this.kw(this.line("Apparition", this.segmented("special.mapReveal", [["all", "Toutes ensemble"], ["sequence", "Une par une"]])), "apparition séquence une par une temps"));
    if (t === "map") {
      const minIn = h("input", { type: "number", step: "any", placeholder: "auto", value: spec.special.mapScaleMin ?? "", style: "width:90px" }) as HTMLInputElement;
      const maxIn = h("input", { type: "number", step: "any", placeholder: "auto", value: spec.special.mapScaleMax ?? "", style: "width:90px" }) as HTMLInputElement;
      const read = (el: HTMLInputElement, path: string) => { const n = el.value.trim() === "" ? null : Number(el.value); this.store.set(path, n != null && Number.isFinite(n) ? n : null); };
      minIn.addEventListener("change", () => read(minIn, "special.mapScaleMin"));
      maxIn.addEventListener("change", () => read(maxIn, "special.mapScaleMax"));
      main.push(this.kw(h("div", { class: "field" }, h("span", { class: "field-label" }, "Minimum et maximum de l'échelle"), h("div", { style: "display:flex;gap:8px;align-items:center" }, minIn, h("span", null, "→"), maxIn)), "échelle minimum maximum bornes comparer"));
    }
    if (isSpecial(t)) {
      main.push(this.row("Persistance", this.select("special.persistence", [["keep", "Garder (keep)"], ["ephemeral", "Éphémère"], ["finale", "Final en nuage"]])));
      main.push(this.check("special.tickers", "Compteurs (nombre, somme)"));
    }
    if (t === "drill") main.push(h("p", { class: "muted small" }, "Cliquez une barre pour zoomer (trimestre → mois → jour), une région ou une ligne pour la focaliser. Le fil d'Ariane au-dessus de l'aperçu permet de revenir en arrière."));

    if (!isSpecial(t)) more.push(this.row("Légende", this.select("style.legend", [["auto", "Auto"], ["top", "En haut"], ["bottom", "En bas"], ["right", "À droite"], ["none", "Aucune"]]), undefined, "légende position"));
    if (t === "stackedBar" || t === "stackedArea") more.push(this.check("style.normalize", "Empilement 100 %", undefined, "pourcentage part"));
    if (isCartesian(t)) {
      const xc = cols.find((c) => c.name === spec.encoding.x);
      const xContinuous = (t === "scatter" || t === "line" || t === "area" || t === "stackedArea") && (xc?.type === "number" || xc?.type === "date");
      more.push(this.axisGroup("x", isBarType(t) ? "Axe X (catégories)" : "Axe X", { scale: xContinuous, scaleOpts: xc?.type === "date" ? [["auto", "Temps (auto)"]] : [["auto", "Auto"], ["linear", "Linéaire"], ["log", "Logarithmique"]], numeric: xContinuous && xc?.type === "number", format: true }));
      more.push(this.axisGroup("y", isBarType(t) ? "Axe Y (valeurs)" : "Axe Y", { scale: true, scaleOpts: [["auto", "Linéaire (auto)"], ["log", "Logarithmique"]], numeric: true, format: false }));
      if (spec.encoding.y2) more.push(this.axisGroup("y2", "Axe Y secondaire", { scale: true, scaleOpts: [["auto", "Linéaire (auto)"], ["log", "Logarithmique"]], numeric: true, format: true }));
    }
    if (isCartesian(t) || isRadial(t)) more.push(h("p", { class: "muted small" }, "Format français : 1 234 567,8 — espace pour les milliers, virgule décimale."));
    return this.sectionEl("graphique", main, more);
  }

  /* ③ Récit : titre, sous-titre, points à retenir */
  private buildRecit(spec: ChartSpec): HTMLElement {
    const labelWithBadge = (label: string, which: "title" | "subtitle" | "comments") => h("span", { class: "field-label" }, label, " ", h("span", { class: "story-badge", "data-badge": which }, ""));
    const fieldB = (label: string, which: "title" | "subtitle" | "comments", control: Node) => h("label", { class: "field" }, labelWithBadge(label, which), control);
    const comments = [0, 1, 2].map((i) => {
      const ta = h("textarea", { rows: "2", placeholder: `Point à retenir ${i + 1}`, maxlength: "300", "data-path": `story.comments.${i}`, "data-testid": `story-comment-${i}` });
      ta.value = spec.story.comments[i] ?? "";
      ta.addEventListener("input", () => {
        const vals = [0, 1, 2].map((k) => (this.body.querySelector<HTMLTextAreaElement>(`[data-path="story.comments.${k}"]`)?.value ?? "").slice(0, 300));
        while (vals.length && !vals[vals.length - 1]!.trim()) vals.pop();
        this.store.set("story.comments", vals);
      });
      return ta;
    });
    const regen = h("button", { type: "button", class: "btn btn-small", "data-testid": "story-regenerate", title: "Rétablir les textes calculés à partir des données", onclick: () => this.store.regenerate() }, h("span", { html: svgIcon(ICONS.refresh, 14) }), "Régénérer");
    const titleInp = this.text("style.title", "Titre du graphique", 200);
    titleInp.setAttribute("data-testid", "story-title");
    const subInp = this.textarea("style.subtitle", "Entité · mesure · unité · période");
    subInp.setAttribute("data-testid", "story-subtitle");
    const main: Kid[] = [
      this.kw(h("div", { class: "story-head" }, h("small", { class: "muted", "data-story-kind": "" }, ""), regen), "régénérer recalculer piste"),
      this.kw(fieldB("Titre (message)", "title", titleInp), "titre message"),
      this.kw(fieldB("Sous-titre", "subtitle", subInp), "sous-titre ibcs unité période"),
      this.kw(h("div", { class: "field" }, labelWithBadge("À retenir (1 à 3 points)", "comments"), ...comments), "commentaires points à retenir"),
      this.kw(h("div", { class: "field story-elems", "data-testid": "story-elements" }), "puces couleur élément commentaire barre à retenir"),
      this.check("story.showComments", "Afficher sur le graphique", undefined, "commentaires à retenir"),
    ];
    const more: Kid[] = [];
    const fi = focusInfo(spec, this.store.state.ds);
    if (fi.kind) more.push(this.focusGroup(spec, fi));
    more.push(this.row("Source / note", this.text("style.source", "Source : …", 300), undefined, "source note pied"));
    if (spec.norme.enabled) {
      more.push(this.row("Entité (qui)", this.text("norme.entity", "ex. Norvia SA (sinon : nom de l'organisation)", 80), "Alimente le sous-titre de la norme", "norme sous-titre"));
      more.push(this.row("Mesure (quoi)", this.text("norme.measure", "ex. Chiffre d’affaires (sinon : nom de colonne)", 80), undefined, "norme sous-titre"));
    }
    more.push(h("p", { class: "muted small" }, "Double-cliquez sur le titre, le sous-titre ou un point à retenir du graphique pour le modifier directement ; un simple clic (ou toucher) ouvre son réglage ici."));
    return this.sectionEl("recit", main, more);
  }

  /* ④ Style : rendu libre / norme, fond, couleurs */
  private buildStyle(spec: ChartSpec): HTMLElement {
    const main: Kid[] = [];
    const more: Kid[] = [];
    main.push(
      this.kw(
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Rendu"),
          this.segmented("norme.enabled", [["false", "Libre"], ["true", "Norme (IBCS)"]], { parse: (v) => v === "true", testid: "norme-toggle" }),
          h("small", { class: "hint", "data-testid": "norme-wording" }, `Notation ${NORME_WORDING_F}. IBCS® est une marque déposée.`)
        ),
        "norme ibcs notation scénarios réel budget n-1 prévision"
      )
    );
    main.push(this.kw(this.line("Fond", this.segmented("style.background", [["dark", "Sombre"], ["light", "Clair"], ["custom", "Perso"]])), "fond thème sombre clair arrière-plan"));
    if (spec.style.background === "custom") {
      const c = this.colorField("style.backgroundCustom", BACKGROUND_COLORS, "bg-color", "Couleur de fond");
      main.push(this.row("Couleur de fond", c, undefined, "fond perso pipette nuancier"));
    }
    if (spec.norme.enabled) main.push(this.kw(h("p", { class: "muted small" }, "Mode norme : données en gris, pétrole pour l'interface, rouge et vert réservés aux écarts. Camemberts, anneaux et arcs sont remplacés par des barres."), "couleurs palette norme"));
    else {
      const theme = themeFor(spec);
      const tiles = PALETTE_KEYS.map((p) => {
        const cols = paletteColors({ ...spec, style: { ...spec.style, palette: p } }, theme).slice(0, 4);
        return h(
          "button",
          { type: "button", class: `pal${p === spec.style.palette ? " active" : ""}`, role: "radio", "aria-checked": p === spec.style.palette ? "true" : "false", "data-value": p, title: PALETTE_LABELS[p], onclick: () => this.store.set("style.palette", p) },
          h("span", { class: "tile-sw" }, ...(cols.length ? cols : ["#3FA7C4", "#8A9BA3"]).map((c) => h("i", { style: `background:${c}` }))),
          h("span", { class: "pal-l" }, PALETTE_LABELS[p].replace(/\s*\(défaut\)/, ""))
        );
      });
      main.push(this.kw(h("div", { class: "field" }, h("span", { class: "field-label" }, "Couleurs"), h("div", { class: "pals", role: "radiogroup", "aria-label": "Palette", "data-path": "style.palette" }, ...tiles)), "palette couleurs teintes"));
      if (spec.style.palette === "custom") {
        const inp = h("input", { type: "text", value: spec.style.paletteCustom.join(", "), placeholder: "#0E6E8C, #3FA7C4, #8A9BA3, …" });
        inp.addEventListener("change", () => {
          const list = inp.value.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^#[0-9a-fA-F]{6}$/.test(x));
          this.store.set("style.paletteCustom", list);
          this.key = "";
          this.update();
        });
        main.push(this.row("Couleurs perso (hex, séparées par des virgules)", inp, undefined, "palette personnalisée"));
      }
    }
    more.push(this.row("Police", this.select("style.font", FONT_KEYS.map((f) => [f, FONTS[f].label] as Opt)), undefined, "typographie font"));
    more.push(this.check("style.accentBar", "Filet d'accent devant le titre", undefined, "trait titre"));
    if (spec.norme.enabled) more.push(this.check("norme.autoSwitch", "Orientation automatique (norme)", "Temps à l'horizontale (colonnes, lignes), structure à la verticale (barres)", "norme barres colonnes"));
    return this.sectionEl("style", main, more);
  }

  /* ⑤ Export : format, téléchargements, animation, QR */
  private buildExport(spec: ChartSpec, cols: Column[]): HTMLElement {
    const t = spec.type;
    const special = isSpecial(t);
    const main: Kid[] = [];
    const more: Kid[] = [];
    const ratio: Record<string, [number, number]> = { "16:9": [30, 17], "1:1": [20, 20], "4:5": [18, 22], custom: [26, 18] };
    const fmt = h(
      "div",
      { class: "segmented tiles-fmt", role: "radiogroup", "data-path": "style.size.preset", "aria-label": "Format" },
      ...(["16:9", "1:1", "4:5", "custom"] as const).map((p) =>
        h(
          "button",
          { type: "button", role: "radio", class: p === spec.style.size.preset ? "active" : "", "aria-checked": p === spec.style.size.preset ? "true" : "false", "data-value": p, onclick: () => this.store.set("style.size.preset", p) },
          h("i", { class: "fmt-ic", style: `width:${ratio[p]![0]}px;height:${ratio[p]![1]}px` }),
          p === "custom" ? "Perso" : p
        )
      )
    );
    main.push(this.kw(h("div", { class: "field" }, h("span", { class: "field-label" }, "Format"), fmt, spec.style.size.preset === "custom" ? null : h("small", { class: "hint" }, sizeNote(spec))), "taille format dimensions 16:9 carré portrait"));
    if (spec.style.size.preset === "custom")
      main.push(this.kw(h("div", { class: "two" }, this.row("Largeur (px)", this.number("style.size.width", { min: 320, max: 4000, step: 10 })), this.row("Hauteur (px)", this.number("style.size.height", { min: 240, max: 4000, step: 10 }))), "taille largeur hauteur px pixels"));
    if (this.actions) {
      const a = this.actions;
      const webm: HTMLButtonElement = h("button", { type: "button", class: "btn", "data-testid": "panel-export-webm", onclick: () => a.exportWebm(webm) }, h("span", { html: svgIcon(ICONS.film2, 15) }), "Vidéo");
      const pptx: HTMLButtonElement = h("button", { type: "button", class: "btn", "data-testid": "panel-export-pptx", disabled: a.snapshots() === 0, title: a.snapshots() ? "PowerPoint de la séquence (une diapositive par scène)" : "Ajoutez d'abord des scènes à la séquence (📸)", onclick: () => a.exportPptx(pptx) }, h("span", { html: svgIcon(ICONS.story, 15) }), "PowerPoint");
      main.push(
        this.kw(
          h(
            "div",
            { class: "field" },
            h("span", { class: "field-label" }, "Télécharger"),
            h(
              "div",
              { class: "dl-grid" },
              h("button", { type: "button", class: "btn btn-accent", "data-testid": "panel-export-svg", onclick: () => a.exportSvg() }, h("span", { html: svgIcon(ICONS.download, 15) }), "SVG"),
              h("button", { type: "button", class: "btn", "data-testid": "panel-export-png", onclick: () => a.exportPng() }, h("span", { html: svgIcon(ICONS.image, 15) }), `PNG ${this.store.state.ui.pngScale}×`),
              webm,
              pptx
            )
          ),
          "télécharger exporter svg png image vidéo webm powerpoint pptx"
        )
      );
    }
    if (this.seqOptions) main.push(this.kw(h("div", { class: "field", "data-target": "sequence" }, h("span", { class: "field-label" }, "Séquence (film et PowerPoint)"), this.seqOptions), "séquence scènes même échelle transitions morph powerpoint film"));
    // Animation : fixe, entrée animée, 4D (dans le temps)
    const cur = animKind(spec);
    const timeCol = this.timeCandidate(spec, cols);
    const can4d = !special && !isVariance(t) && t !== "drill" && !!timeCol;
    const setAnim = (k: "static" | "build" | "4d") => {
      if (k === "static") return void this.store.set("mode.kind", "static");
      this.store.set("mode.kind", "dynamic");
      if (k === "build") {
        if (!this.store.state.spec.mode.buildIn) this.store.set("mode.buildIn", true);
        this.store.set("mode.fourD.enabled", false);
      } else {
        if (!this.store.state.spec.encoding.time && timeCol) this.store.set("encoding.time", timeCol);
        this.store.set("mode.fourD.enabled", true);
      }
    };
    const opts: ["static" | "build" | "4d", string, string][] = special ? [["static", "Fixe", "Image fixe"], ["build", "Animé", "Film / carte animés"]] : [["static", "Fixe", "Image fixe"], ["build", "Entrée animée", "Les marques apparaissent"], ["4d", "4D", can4d ? "Animation dans le temps" : "Indisponible : il faut une colonne de date, de période ou de catégorie"]];
    main.push(
      this.kw(
        h(
          "div",
          { class: "field", "data-target": "anim" },
          h("span", { class: "field-label" }, "Animation"),
          h(
            "div",
            { class: "segmented", role: "radiogroup", "aria-label": "Animation", "data-testid": "anim-mode" },
            ...opts.map(([k, l, title]) => h("button", { type: "button", role: "radio", class: k === cur ? "active" : "", "aria-checked": k === cur ? "true" : "false", "data-anim": k, title, disabled: k === "4d" && !can4d, onclick: () => setAnim(k) }, k === "4d" ? h("span", { class: "badge-4d" }, "4D") : l))
          )
        ),
        "animation fixe dynamique entrée 4d temps vidéo mode"
      )
    );
    if (cur === "4d") main.push(this.row("Temps (animation 4D)", this.select("encoding.time", this.colOpts(cols, (c) => c.type === "date" || c.type === "number" || c.type === "category"), true), undefined, "4d date période"));
    main.push(this.check("style.authQr", "QR d’empreinte des données", "Lien « Vérifier l'empreinte » vers la page de vérification", "qr code empreinte vérification"));
    if (spec.mode.kind === "dynamic") {
      if (special) more.push(this.row("Durée du film (s)", this.number("mode.fourD.durationMs", { min: 1, max: 120, step: 0.5, scale: 1000 }), undefined, "durée secondes"));
      else {
        if (cur === "4d") more.push(this.check("mode.buildIn", "Animation d'entrée avant la 4D", undefined, "entrée"));
        if (spec.mode.buildIn || cur === "build") more.push(this.row("Durée d'entrée (s)", this.number("mode.buildInMs", { min: 0.2, max: 10, step: 0.1, scale: 1000 }), undefined, "durée secondes animation"));
        if (cur === "4d") {
          more.push(this.row("Mode 4D", this.segmented("mode.fourD.mode", [["cumulative", "Cumulatif"], ["snapshot", "Instantané"]]), spec.encoding.time === spec.encoding.x ? "X = temps : révélation le long de l'axe" : undefined, "4d cumul"));
          more.push(this.row("Pas de temps", this.select("mode.fourD.step", [["auto", "Auto"], ["raw", "Valeurs brutes"], ["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]]), undefined, "4d"));
          more.push(this.row("Durée de la 4D (s)", this.number("mode.fourD.durationMs", { min: 1, max: 120, step: 0.5, scale: 1000 }), undefined, "durée secondes"));
          more.push(this.check("mode.fourD.loop", "Lecture en boucle", undefined, "4d"));
          more.push(this.check("mode.fourD.stamp", "Tampon de date (filigrane)", undefined, "4d"));
          if (spec.mode.fourD.stamp) more.push(this.row("Forme du tampon", this.segmented("mode.fourD.stampStyle", [["watermark", "Filigrane"], ["odometer", "Compteur"]]), "Compteur : chiffres qui roulent, au-dessus du graphique", "4d tampon compteur odomètre"));
          more.push(this.check("mode.fourD.freezeScales", "Échelles figées (pas de sauts)", undefined, "4d axes"));
        }
      }
    }
    more.push(h("p", { class: "muted small", "data-testid": "signature-note" }, `Cartouche ${PRODUCT_LABEL} toujours présent : logo, lien vers la plateforme, date de génération, date d'import des données, source et empreinte. L'option QR masque seulement le QR.`));
    return this.sectionEl("export", main, more);
  }

  /** Catégories (axe X) du jeu de données courant, dans l'ordre d'apparition (12 au plus). */
  private categories(spec: ChartSpec, max = 40): string[] {
    const ds = this.store.state.ds;
    const x = spec.encoding.x;
    if (!ds || !x) return [];
    const seen = new Set<string>();
    for (const r of effectiveDataset(spec, ds).rows) {
      const v = r[x];
      if (v == null || v === "") continue;
      seen.add(String(v));
      if (seen.size >= max) break;
    }
    return [...seen];
  }

  /** Nuage de points : « Forme des points » (Ronds / Une icône / Une icône par groupe) et choix des icônes. */
  private pointShapeFields(spec: ChartSpec): HTMLElement[] {
    const cur = spec.style.pointShape;
    const grp = spec.encoding.series;
    const circle = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>`;
    const opts: [string, string, string, boolean, string][] = [
      ["circle", circle, "Ronds", true, "Points ronds (par défaut)"],
      ["icon", iconSvg("star", 18), "Une icône", true, "La même icône pour tous les points, à la couleur de leur groupe"],
      ["iconByGroup", iconSvg("users-three", 18), "Par groupe", !!grp, grp ? `Une icône par valeur de « ${grp} » (Couleur par), avec légende des icônes` : "Choisissez d'abord une colonne « Couleur par (série) » dans ① Données"],
    ];
    const tiles = h(
      "div",
      { class: "segmented tiles-cap tiles-pt", role: "radiogroup", "aria-label": "Forme des points", "data-path": "style.pointShape", "data-testid": "point-shape" },
      ...opts.map(([v, ic, l, ok, title]) =>
        h("button", { type: "button", role: "radio", class: v === cur ? "active" : "", "aria-checked": v === cur ? "true" : "false", "data-value": v, title, disabled: !ok && v !== cur, onclick: () => this.store.set("style.pointShape", v) }, h("span", { class: "cap-ic", html: ic }), l)
      )
    );
    const warn = cur === "iconByGroup" && !grp ? h("small", { class: "hint warn" }, "Par groupe : choisissez une colonne « Couleur par (série) » dans ① Données (une seule icône en attendant).") : null;
    const out: HTMLElement[] = [this.kw(h("div", { class: "field", "data-target": "pointShape" }, h("span", { class: "field-label" }, "Forme des points"), tiles, warn), "forme des points icône icones nuage bulles ronds pictogramme groupe")];
    const shape = effectivePointShape(spec);
    const pickBtn = (label: string, current: string | undefined, auto: string | null, onPick: (v: string) => void, testid: string) => {
      const { icon, label: l, isAuto } = iconPickLabel(current, auto);
      const btn = h(
        "button",
        { type: "button", class: `icon-pick-btn${isAuto ? " is-auto" : ""}`, "data-icon-for": label, "data-testid": testid, "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `Icône pour « ${label} » : ${l}${isAuto ? " (automatique)" : ""}`, title: isAuto ? `${l} (automatique)` : l },
        h("span", { class: "ip-ic", html: icon ? iconSvg(icon, 18) : "" }),
        h("span", { class: "ip-l" }, icon ? l : "Rond"),
        h("span", { class: "ip-chev", "aria-hidden": "true" }, "▾")
      );
      btn.addEventListener("click", () => openIconPicker(btn, { category: label, current, auto, onPick }));
      return h("div", { class: "field field-inline icon-row" }, h("span", { class: "field-label", title: label }, label), btn);
    };
    if (shape === "icon") {
      const auto = defaultPointIcon(spec);
      out.push(
        this.kw(
          pickBtn("Tous les points", spec.style.pointIcon || undefined, auto, (v) => (v === "" ? this.store.set("style.pointShape", "circle") : this.store.set("style.pointIcon", v === "@auto" ? "" : v)), "point-icon-select"),
          "icône des points"
        )
      );
    } else if (shape === "iconByGroup" && grp) {
      const groups = this.seriesValues(spec, 12);
      const autos = groupIcons({ ...spec, style: { ...spec.style, pointIcons: {} } }, groups);
      const rows = groups.map((g, i) =>
        pickBtn(g, spec.style.pointIcons[g], autos[i] ?? null, (v) => {
          const next = { ...this.store.state.spec.style.pointIcons };
          if (v === "@auto") delete next[g];
          else next[g] = v;
          this.store.set("style.pointIcons", next);
        }, "point-icons-select")
      );
      out.push(this.kw(this.group("icones-points", `Icône par groupe (${grp})`, ...rows, h("p", { class: "muted small" }, "En gris : icône automatique (d'après le nom, sinon une icône distincte). « Aucune » garde un rond pour ce groupe. Légende des icônes sur le graphique. ", h("a", { href: "licences/phosphor-icons-MIT.txt", target: "_blank", rel: "noopener", "data-licence": "phosphor" }, "Icônes Phosphor (licence MIT)"), ".")), "icône par groupe série couleur"));
    }
    return out;
  }

  /** Valeurs de « Couleur par » (ordre d'apparition, comme les séries du graphique). */
  private seriesValues(spec: ChartSpec, max = 24): string[] {
    const ds = this.store.state.ds;
    const c = spec.encoding.series;
    if (!ds || !c) return [];
    const seen = new Set<string>();
    for (const r of effectiveDataset(spec, ds).rows) {
      const v = r[c];
      if (v == null || v === "") continue;
      seen.add(String(v));
      if (seen.size >= max) break;
    }
    return [...seen];
  }

  /** « Extrémité des barres » : Aucune / Icône / Pictos / Objectif (étape I). */
  private capTiles(spec: ChartSpec): HTMLElement {
    const multi = !!spec.encoding.series || spec.encoding.y.length > 1;
    const canGoal = spec.encoding.y.length >= 2 && !spec.encoding.series;
    const cur = spec.style.barCap;
    const opts: [string, string, string, boolean, string][] = [
      ["none", "minus", "Aucune", true, "Barres simples"],
      ["icon", "cloud", "Icône", !multi, multi ? "Une seule mesure, sans série" : "Pastille avec icône au bout de chaque barre (choisie d'après le nom)"],
      ["picto", "users-three", "Pictos", !multi, multi ? "Une seule mesure, sans série" : "Pictogrammes : une icône = une unité (isotype)"],
      ["goal", "flag-checkered", "Objectif", canGoal, canGoal ? "1re mesure = réalisé, 2e = objectif : repère et pastille atteint / non atteint" : "Choisissez deux mesures (réalisé, objectif) dans Données"],
    ];
    const tiles = h(
      "div",
      { class: "segmented tiles-cap", role: "radiogroup", "aria-label": "Extrémité des barres", "data-path": "style.barCap", "data-testid": "bar-cap" },
      ...opts.map(([v, ic, l, ok, title]) =>
        h("button", { type: "button", role: "radio", class: v === cur ? "active" : "", "aria-checked": v === cur ? "true" : "false", "data-value": v, title, disabled: !ok && v !== cur, onclick: () => this.store.set("style.barCap", v) }, h("span", { class: "cap-ic", html: iconSvg(ic, 18) }), l)
      )
    );
    const warn = cur === "goal" && !canGoal ? h("small", { class: "hint warn" }, "Objectif : choisissez deux mesures (réalisé, objectif) dans ① Données.") : cur !== "none" && cur !== "goal" && multi ? h("small", { class: "hint warn" }, "Icônes et pictogrammes : une seule mesure, sans série.") : null;
    return this.kw(h("div", { class: "field", "data-target": "barCap" }, h("span", { class: "field-label" }, "Extrémité des barres"), tiles, warn), "extrémité barres icône icones pictogrammes pictos isotype objectif cible coiffe");
  }

  /** Icône par catégorie (Plus d'options) : automatique d'après le nom, ou choisie. */
  private iconRows(spec: ChartSpec, cols: Column[]): HTMLElement | null {
    const xc = cols.find((c) => c.name === spec.encoding.x);
    if (!xc || xc.type === "number" || xc.type === "date") return null;
    const cats = this.categories(spec, 12);
    if (!cats.length) return null;
    const rows = cats.map((c) => {
      const auto = iconFor(c);
      const cur = spec.style.capIcons[c];
      const { icon, label, isAuto } = iconPickLabel(cur, auto);
      const btn = h(
        "button",
        { type: "button", class: `icon-pick-btn${isAuto ? " is-auto" : ""}`, "data-icon-for": c, "data-testid": "icon-select", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `Icône pour « ${c} » : ${label}${isAuto ? " (automatique)" : ""}`, title: isAuto ? `${label} (choisie d'après le nom)` : label },
        h("span", { class: "ip-ic", html: icon ? iconSvg(icon, 18) : "" }),
        h("span", { class: "ip-l" }, label),
        h("span", { class: "ip-chev", "aria-hidden": "true" }, "▾")
      );
      btn.addEventListener("click", () =>
        openIconPicker(btn, {
          category: c,
          current: cur,
          auto,
          onPick: (v) => {
            const next = { ...this.store.state.spec.style.capIcons };
            if (v === "@auto") delete next[c];
            else next[c] = v;
            this.store.set("style.capIcons", next);
          },
        })
      );
      return h("div", { class: "field field-inline icon-row" }, h("span", { class: "field-label", title: c }, c), btn);
    });
    return this.group("icones", "Icône par catégorie", ...rows, h("p", { class: "muted small" }, "En gris : icône automatique, choisie d'après le nom (dictionnaire français / anglais) ; pas de correspondance → pas d'icône. ", h("a", { href: "licences/phosphor-icons-MIT.txt", target: "_blank", rel: "noopener", "data-licence": "phosphor" }, "Icônes Phosphor (licence MIT)"), "."));
  }

  /**
   * Mise en avant (étapes I et L) : barre, part, arc, point, série ou région ; les autres en gris, annotation reliée.
   * « Choisir sur le graphique » : le prochain toucher sur une marque la met en avant.
   */
  private focusGroup(spec: ChartSpec, fi: FocusInfo): HTMLElement {
    const lab = FOCUS_LABELS[fi.kind!];
    const on = !!spec.style.focus.key;
    const cur = spec.style.focus.key;
    const choices = [...fi.choices];
    if (cur && cur !== "@max" && !choices.includes(cur)) choices.unshift(cur);
    const pick = h(
      "button",
      { type: "button", class: "btn btn-small focus-pick-btn", "data-testid": "focus-pick", title: "Touchez ensuite l'élément du graphique à mettre en avant", onclick: () => this.actions?.pickFocus?.() },
      "Choisir sur le graphique"
    );
    return this.group(
      "focus",
      "Mise en avant",
      this.row(lab.row, this.select("style.focus.key", [["@max", lab.auto], ...choices.slice(0, 200).map((c) => [c, c] as Opt)], true), lab.hint, "focus mise en avant barre part point série région annotée annotation"),
      h("div", { class: "field focus-pick-row" }, pick, h("span", { class: "muted small" }, "ou touchez directement une marque quand la mise en avant est active")),
      on && this.row("Titre de l'annotation", this.text("style.focus.title", fi.kind === "bar" || fi.kind === "slice" || fi.kind === "region" ? "Calculé : valeur et part du total" : "Calculé : nom et valeur", 120), undefined, "annotation focus titre bulle"),
      on && this.row("Texte de l'annotation", this.text("style.focus.note", "Calculé : comparaison à la moyenne des autres", 200), undefined, "annotation focus note bulle commentaire"),
      on && fi.kind === "bar" && this.check("style.focus.average", "Ligne « Moyenne des autres »", undefined, "moyenne focus")
    );
  }

  /** Colonne de temps pour la 4D : celle déjà choisie, sinon X si c'est une date, sinon la 1re date. */
  private timeCandidate(spec: ChartSpec, cols: Column[]): string | null {
    if (spec.encoding.time) return spec.encoding.time;
    const x = cols.find((c) => c.name === spec.encoding.x);
    if (x?.type === "date") return x.name;
    return cols.find((c) => c.type === "date")?.name ?? cols.find((c) => c.type === "category" && /ann[ée]e|year|mois|month|p[ée]riode|trimestre/i.test(c.name))?.name ?? null;
  }

  /** Notation des scénarios par mesure : détection automatique d'après le nom, forçage manuel. */
  private scenarioRows(spec: ChartSpec): HTMLElement {
    const opts: Opt[] = [["auto", "Auto"], ...SCENARIO_CODES.map((c) => [c, `${SCENARIO_NAMES[c]} (${c})`] as Opt), ["none", "Aucun (mesure simple)"]];
    const measures = (isVariance(spec.type) ? spec.encoding.y.slice(0, 2) : spec.encoding.y).filter(Boolean);
    const rows = measures.map((m) => {
      const det = detectScenario(m);
      const cur = spec.encoding.scenarios[m] ?? "auto";
      const sel = h("select", { "data-scenario-for": m, "data-testid": "scenario-select" }, ...opts.map(([v, l]) => h("option", { value: v, selected: v === cur }, v === "auto" ? `Auto · ${det ? `${SCENARIO_NAMES[det as ScenarioCode]} (${det})` : "aucun"}` : l)));
      sel.addEventListener("change", () => {
        const next = { ...this.store.state.spec.encoding.scenarios };
        if (sel.value === "auto") delete next[m];
        else next[m] = sel.value as ScenarioCode | "none";
        // objet entier : les noms de colonnes peuvent contenir des points
        this.store.set("encoding", { ...this.store.state.spec.encoding, scenarios: next });
      });
      return h("label", { class: "field field-inline" }, h("span", { class: "field-label" }, m), sel);
    });
    return this.kw(h("div", { class: "field scenario-rows", "data-testid": "scenario-rows" }, h("span", { class: "field-label" }, "Notation des scénarios"), ...rows, h("small", { class: "hint" }, "Réel plein foncé · N-1 gris · Budget contour · Prévision hachurée")), "norme scénarios réel budget");
  }

  private swatchList(spec: ChartSpec, n: number): HTMLElement[] {
    const colors = paletteColors(spec, themeFor(spec));
    return colors.slice(0, n).map((c) => h("i", { style: `background:${c}` }));
  }

  /** Devine l'unité d'axe d'après le nom de colonne (« (€) », « % »). */
  private hintUnit(axisPath: string, col: string | null | undefined) {
    if (!col) return;
    const g = guessUnit(col);
    const u = g === "none" ? null : g;
    const cur = this.store.get(`${axisPath}.unit`);
    if (u && cur !== u && !(u === "eur" && (cur === "keur" || cur === "meur"))) this.store.set(`${axisPath}.unit`, u);
    else if (!u && (cur === "eur" || cur === "keur" || cur === "meur" || cur === "pct")) this.store.set(`${axisPath}.unit`, "none");
  }

  /** Mesure à la position i de `encoding.y` (graphique d'écarts : réel, référence). */
  private yAt(cols: Column[], i: number): HTMLSelectElement {
    const cur = this.store.state.spec.encoding.y[i] ?? "";
    const sel = h("select", { "data-path": `encoding.y.${i}` }, h("option", { value: "" }, "— choisir —"), ...this.colOpts(cols, (c) => c.type === "number").map(([v, l]) => h("option", { value: v, selected: v === cur }, l)));
    sel.addEventListener("change", () => {
      const y = [...this.store.state.spec.encoding.y];
      y[i] = sel.value;
      this.store.set("encoding.y", y.filter(Boolean).slice(0, 2));
      if (i === 0) this.hintUnit("axes.y", sel.value);
    });
    return sel;
  }

  private ySingle(cols: Column[]): HTMLSelectElement {
    const cur = this.store.state.spec.encoding.y[0] ?? "";
    const sel = h("select", { "data-path": "encoding.y" }, h("option", { value: "" }, "— choisir —"), ...this.colOpts(cols, (c) => c.type === "number").map(([v, l]) => h("option", { value: v, selected: v === cur }, l)));
    sel.addEventListener("change", () => {
      this.store.set("encoding.y", sel.value ? [sel.value] : []);
      this.hintUnit("axes.y", sel.value);
    });
    return sel;
  }

  /** Mesures multiples : puces à cocher (ordre de sélection conservé). */
  private yMulti(cols: Column[]): HTMLElement {
    const cur = this.store.state.spec.encoding.y;
    const numeric = cols.filter((c) => c.type === "number");
    if (!numeric.length) return h("p", { class: "muted" }, "Aucune colonne numérique.");
    return h(
      "div",
      { class: "checklist", "data-path": "encoding.y" },
      ...numeric.map((c) => {
        const inp = h("input", { type: "checkbox", checked: cur.includes(c.name), value: c.name });
        inp.addEventListener("change", () => {
          const now = this.store.state.spec.encoding.y.filter((f) => f !== c.name);
          if (inp.checked) now.push(c.name);
          this.store.set("encoding.y", now);
          if (now.length === 1) this.hintUnit("axes.y", now[0]);
        });
        return h("label", { class: "check" }, inp, h("span", null, c.name), c.idLike ? h("small", { class: "hint" }, "identifiant ?") : null);
      })
    );
  }

  /** Axe (Plus d'options) : afficher, grille, titre, échelle, min / max ; unité et décimales si `format`. */
  private axisGroup(axis: "x" | "y" | "y2", title: string, o: { scale: boolean; scaleOpts: Opt[]; numeric: boolean; format: boolean }): HTMLElement {
    const p = `axes.${axis}`;
    const a = this.store.state.spec.axes[axis];
    const k = `axe ${axis === "y2" ? "y2 secondaire droite" : axis}`;
    const rows: Kid[] = [];
    rows.push(this.kw(h("div", { class: "two" }, this.check(`${p}.show`, "Afficher"), this.check(`${p}.grid`, "Grille")), `${k} afficher grille quadrillage`));
    rows.push(this.row("Titre d'axe", this.text(`${p}.title`, "", 120), undefined, k));
    if (o.scale && o.scaleOpts.length > 1) rows.push(this.row("Échelle", this.segmented(`${p}.scale`, o.scaleOpts), undefined, `${k} log logarithmique linéaire`));
    if (o.numeric) {
      rows.push(this.kw(h("div", { class: "two" }, this.row("Min", this.number(`${p}.min`, { nullable: true })), this.row("Max", this.number(`${p}.max`, { nullable: true }))), `${k} minimum maximum bornes`));
      if (o.format) rows.push(this.kw(this.line("Unité et décimales", this.select(`${p}.unit`, UNITS.map((u) => [u, UNIT_LABELS[u]] as Opt)), this.stepper(`${p}.decimals`)), `${k} unité € k€ M€ % décimales format`));
      if (o.format && a.unit === "custom") rows.push(this.row("Suffixe personnalisé", this.text(`${p}.unitCustom`, "ex. t CO₂, h, pts", 12), undefined, k));
    }
    return this.group(`axe-${axis}`, title, ...rows);
  }
}
