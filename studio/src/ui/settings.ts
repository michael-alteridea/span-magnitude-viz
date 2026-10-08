/**
 * Panneau de réglages (droite) : encodages, axes, mode / 4D, style, format, film & carte.
 * Chaque contrôle est lié à un chemin du spec ; le panneau n'est reconstruit que lorsque
 * la structure change (type, colonnes, options qui affichent / masquent des champs).
 */
import type { Store } from "../state";
import {
  AGGREGATES,
  AGGREGATE_LABELS,
  CHART_TYPE_LABELS,
  FONT_KEYS,
  PALETTE_KEYS,
  UNITS,
  UNIT_LABELS,
  isBarType,
  isCartesian,
  isRadial,
  isSpecial,
  SIZE_PRESETS,
  type ChartSpec,
} from "../spec";
import type { Column } from "../data/table";
import { COLUMN_TYPE_LABELS } from "../data/table";
import { FONTS, PALETTE_LABELS, paletteColors, themeFor } from "../theme";
import { h, svgIcon, ICONS } from "./dom";
import { guessUnit } from "../format";

type Opt = [string, string];

export class SettingsPanel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private store: Store;
  private key = "";

  constructor(store: Store) {
    this.store = store;
    this.body = h("div", { class: "panel-body settings-body" });
    this.root = h(
      "aside",
      { class: "panel panel-right", "data-testid": "settings-panel" },
      h(
        "header",
        { class: "panel-head" },
        h("span", { class: "panel-icon", html: svgIcon(ICONS.sliders, 18) }),
        h("h2", null, "Réglages"),
        h("button", { class: "icon-btn collapse-btn", title: "Replier le panneau", html: svgIcon(ICONS.chevronR, 18), onclick: () => store.setUi({ rightCollapsed: !store.state.ui.rightCollapsed }) })
      ),
      this.body
    );
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
      ds?.columns.map((c) => c.type),
    ]);
    if (key === this.key) return;
    this.key = key;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...this.build(spec, ds?.columns ?? []));
    this.body.scrollTop = scroll;
  }

  /* ------------------------------------------------------------ contrôles */

  private section(id: string, title: string, ...content: (Node | null | false)[]): HTMLElement {
    const open = this.store.state.ui.openSections[id] ?? false;
    const d = h("details", { class: "section", open, "data-section": id }, h("summary", null, title), h("div", { class: "section-body" }, ...content));
    d.addEventListener("toggle", () => {
      this.store.state.ui.openSections[id] = d.open;
      this.store.save();
    });
    return d;
  }

  private row(label: string, control: Node, hint?: string): HTMLElement {
    return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("small", { class: "hint" }, hint) : null);
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

  private check(path: string, label: string, hint?: string): HTMLElement {
    const inp = h("input", { type: "checkbox", checked: !!this.store.get(path), "data-path": path });
    inp.addEventListener("change", () => this.store.set(path, inp.checked));
    return h("label", { class: "check" }, inp, h("span", null, label), hint ? h("small", { class: "hint" }, hint) : null);
  }

  private segmented(path: string, opts: Opt[], after?: (v: string) => void): HTMLElement {
    const cur = String(this.store.get(path));
    return h(
      "div",
      { class: "segmented", role: "radiogroup", "data-path": path },
      ...opts.map(([v, l]) =>
        h(
          "button",
          {
            type: "button",
            class: v === cur ? "active" : "",
            role: "radio",
            "aria-checked": v === cur ? "true" : "false",
            "data-value": v,
            onclick: () => {
              this.store.set(path, v);
              after?.(v);
            },
          },
          l
        )
      )
    );
  }

  /* -------------------------------------------------------------- sections */

  private colOpts(cols: Column[], filter?: (c: Column) => boolean): Opt[] {
    return cols.filter((c) => !filter || filter(c)).map((c) => [c.name, `${c.name} · ${COLUMN_TYPE_LABELS[c.type].toLowerCase()}`]);
  }

  private build(spec: ChartSpec, cols: Column[]): HTMLElement[] {
    const t = spec.type;
    const out: HTMLElement[] = [];
    const num = (c: Column) => c.type === "number";
    const special = isSpecial(t);

    /* ---- Encodages */
    const enc: (Node | null)[] = [];
    enc.push(h("p", { class: "section-intro" }, `Type : ${CHART_TYPE_LABELS[t]}`));
    if (!cols.length) enc.push(h("p", { class: "muted" }, "Chargez des données pour choisir les colonnes."));
    else if (special) {
      enc.push(this.row("Début (date ou nombre)", this.select("encoding.x", this.colOpts(cols, (c) => c.type === "date" || c.type === "number"), true)));
      enc.push(this.row("Fin (optionnel)", this.select("encoding.end", this.colOpts(cols, (c) => c.type === "date" || c.type === "number"), true), "Sans fin : événements ponctuels"));
      enc.push(this.row("Magnitude (épaisseur)", this.ySingle(cols)));
      enc.push(this.row("Groupe / couleur", this.select("encoding.series", this.colOpts(cols, (c) => c.type !== "number" || c.cardinality <= 20), true)));
      enc.push(this.row("Libellé", this.select("encoding.label", this.colOpts(cols), true)));
      enc.push(this.row("Code postal FR/BE", this.select("encoding.postal", this.colOpts(cols), true)));
      enc.push(this.row("Latitude", this.select("encoding.lat", this.colOpts(cols, num), true)));
      enc.push(this.row("Longitude", this.select("encoding.lon", this.colOpts(cols, num), true)));
    } else {
      const xFilter = t === "scatter" ? (c: Column) => c.type !== "text" || c.cardinality <= 60 : undefined;
      enc.push(this.row(isRadial(t) ? "Catégories (parts)" : t === "barH" || (isBarType(t) && spec.style.horizontal) ? "Catégories (axe vertical)" : "Axe X", this.select("encoding.x", this.colOpts(cols, xFilter), true, (v) => t === "scatter" && this.hintUnit("axes.x", v))));
      const xc = cols.find((c) => c.name === spec.encoding.x);
      if (xc?.type === "date")
        enc.push(this.row("Regrouper les dates par", this.select("encoding.xGrain", [["none", "Aucun (valeurs brutes)"], ["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]])));
      enc.push(this.row(t === "scatter" ? "Axe Y" : isRadial(t) ? "Valeur(s)" : "Mesure(s) — axe Y", t === "scatter" ? this.ySingle(cols) : this.yMulti(cols)));
      if (t !== "scatter") enc.push(this.row("Agrégat", this.select("encoding.aggregate", AGGREGATES.map((a) => [a, AGGREGATE_LABELS[a]] as Opt))));
      if (!isRadial(t)) {
        const multiY = spec.encoding.y.length > 1;
        enc.push(this.row("Série / couleur", this.select("encoding.series", this.colOpts(cols, (c) => c.type !== "number" || c.cardinality <= 24), true), multiY ? "Ignoré : plusieurs mesures forment déjà les séries" : undefined));
      }
      if (isCartesian(t) && t !== "scatter") {
        enc.push(this.row("Axe Y secondaire (droite)", this.select("encoding.y2", this.colOpts(cols, num), true, (v) => this.hintUnit("axes.y2", v)), "Seconde série, échelle indépendante, tracée en ligne"));
        if (spec.encoding.y2) enc.push(this.row("Agrégat Y secondaire", this.select("encoding.y2Aggregate", AGGREGATES.map((a) => [a, AGGREGATE_LABELS[a]] as Opt))));
      }
      if (t === "scatter") {
        enc.push(this.row("Taille des bulles", this.select("encoding.size", this.colOpts(cols, num), true)));
        enc.push(this.row("Libellé des points", this.select("encoding.label", this.colOpts(cols), true)));
      }
    }
    if (cols.length && !special)
      enc.push(this.row("Temps (animation 4D)", this.select("encoding.time", this.colOpts(cols, (c) => c.type === "date" || c.type === "number" || c.type === "category"), true), "Active la 4D dans « Mode & animation »"));
    out.push(this.section("encodage", "Encodages", ...enc));

    /* ---- Axes */
    if (isCartesian(t)) {
      const xc = cols.find((c) => c.name === spec.encoding.x);
      const xContinuous = (t === "scatter" || t === "line" || t === "area" || t === "stackedArea") && (xc?.type === "number" || xc?.type === "date");
      out.push(this.axisSection("x", isBarType(t) ? "Axe X (catégories)" : "Axe X", { scale: xContinuous, scaleOpts: xc?.type === "date" ? [["auto", "Temps (auto)"]] : [["auto", "Auto"], ["linear", "Linéaire"], ["log", "Logarithmique"]], numeric: xContinuous && xc?.type === "number" }));
      out.push(this.axisSection("y", isBarType(t) ? "Axe Y (valeurs)" : "Axe Y", { scale: true, scaleOpts: [["auto", "Linéaire (auto)"], ["log", "Logarithmique"]], numeric: true }));
      if (spec.encoding.y2) out.push(this.axisSection("y2", "Axe Y secondaire", { scale: true, scaleOpts: [["auto", "Linéaire (auto)"], ["log", "Logarithmique"]], numeric: true }));
    } else if (isRadial(t)) {
      out.push(this.axisSection("y", "Valeurs (format)", { scale: false, scaleOpts: [], numeric: true, formatOnly: true }));
    }

    /* ---- Mode & animation */
    const mode: (Node | null)[] = [];
    mode.push(this.segmented("mode.kind", [["static", "Fixe"], ["dynamic", "Dynamique"]]));
    if (spec.mode.kind === "dynamic") {
      if (special) {
        mode.push(this.row("Durée du film (s)", this.number("mode.fourD.durationMs", { min: 1, max: 120, step: 0.5, scale: 1000 })));
      } else {
        mode.push(this.check("mode.buildIn", "Animation d'entrée"));
        if (spec.mode.buildIn) mode.push(this.row("Durée d'entrée (s)", this.number("mode.buildInMs", { min: 0.2, max: 10, step: 0.1, scale: 1000 })));
        mode.push(h("div", { class: "fourd-title" }, h("span", { class: "badge-4d" }, "4D"), " Animation dans le temps"));
        if (!spec.encoding.time) mode.push(h("p", { class: "muted" }, "Choisissez un champ « Temps » dans les encodages pour activer la 4D."));
        else {
          mode.push(this.check("mode.fourD.enabled", `Animer selon « ${spec.encoding.time} »`));
          if (spec.mode.fourD.enabled) {
            mode.push(this.row("Mode", this.segmented("mode.fourD.mode", [["cumulative", "Cumulatif"], ["snapshot", "Instantané"]]), spec.encoding.time === spec.encoding.x ? "X = temps : révélation le long de l'axe" : undefined));
            mode.push(this.row("Pas de temps", this.select("mode.fourD.step", [["auto", "Auto"], ["raw", "Valeurs brutes"], ["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"]])));
            mode.push(this.row("Durée (s)", this.number("mode.fourD.durationMs", { min: 1, max: 120, step: 0.5, scale: 1000 })));
            mode.push(this.check("mode.fourD.loop", "Lecture en boucle"));
            mode.push(this.check("mode.fourD.stamp", "Tampon de date (filigrane)"));
            mode.push(this.check("mode.fourD.freezeScales", "Échelles figées (pas de sauts)"));
          }
        }
      }
    }
    out.push(this.section("mode", "Mode & animation", ...mode));

    /* ---- Spécial */
    if (special) {
      const sp: (Node | null)[] = [];
      if (t === "film") {
        sp.push(this.row("Géométrie", this.segmented("special.geometry", [["arc", "Arcs"], ["bar", "Barres"], ["point", "Points"]])));
      } else {
        sp.push(this.row("Fond de carte", this.segmented("special.mapRegion", [["fr-be", "France · Belgique"], ["europe", "Europe"]])));
        if (spec.special.mapRegion === "europe") sp.push(this.row("Maille", this.select("special.mapLevel", [["country", "Pays"], ["nuts1", "NUTS 1"], ["nuts2", "NUTS 2"], ["nuts3", "NUTS 3"]])));
      }
      sp.push(this.row("Persistance", this.select("special.persistence", [["keep", "Garder (keep)"], ["ephemeral", "Éphémère"], ["finale", "Final en nuage"]])));
      sp.push(this.check("special.tickers", "Compteurs (nombre, somme)"));
      out.push(this.section("special", t === "film" ? "Film 4D" : "Carte", ...sp));
    }

    /* ---- Textes */
    out.push(
      this.section(
        "textes",
        "Titres & source",
        this.row("Titre", this.text("style.title", "Titre du graphique", 200)),
        this.row("Sous-titre", this.textarea("style.subtitle", "Contexte, période, unité…")),
        this.row("Source / note", this.text("style.source", "Source : …", 300))
      )
    );

    /* ---- Style */
    const st: (Node | null)[] = [];
    st.push(this.row("Fond", this.segmented("style.background", [["dark", "Sombre"], ["light", "Clair"], ["custom", "Perso"]])));
    if (spec.style.background === "custom") {
      const c = h("input", { type: "color", value: spec.style.backgroundCustom, "data-path": "style.backgroundCustom" });
      c.addEventListener("input", () => this.store.set("style.backgroundCustom", c.value));
      st.push(this.row("Couleur de fond", c));
    }
    st.push(this.row("Palette", this.select("style.palette", PALETTE_KEYS.map((p) => [p, PALETTE_LABELS[p]] as Opt))));
    st.push(this.swatches(spec));
    if (spec.style.palette === "custom") {
      const inp = h("input", { type: "text", value: spec.style.paletteCustom.join(", "), placeholder: "#d62839, #1d4ed8, …" });
      inp.addEventListener("change", () => {
        const list = inp.value.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^#[0-9a-fA-F]{6}$/.test(x));
        this.store.set("style.paletteCustom", list);
        this.key = "";
        this.update();
      });
      st.push(this.row("Couleurs (hex, séparées par des virgules)", inp));
    }
    st.push(this.row("Police", this.select("style.font", FONT_KEYS.map((f) => [f, FONTS[f].label] as Opt))));
    st.push(this.row("Légende", this.select("style.legend", [["auto", "Auto"], ["top", "En haut"], ["bottom", "En bas"], ["right", "À droite"], ["none", "Aucune"]])));
    if (isCartesian(t) && t !== "scatter") st.push(this.check("style.valueLabels", "Étiquettes de valeur"));
    if (t === "line" || t === "area" || t === "stackedArea" || spec.encoding.y2) st.push(this.row("Courbe", this.segmented("style.curve", [["monotone", "Lissée"], ["linear", "Droite"], ["step", "Marches"]])));
    if (isBarType(t) || isRadial(t)) st.push(this.row("Tri des catégories", this.select("style.sort", [["none", "Ordre des données"], ["desc", "Décroissant"], ["asc", "Croissant"], ["alpha", "Alphabétique"]])));
    if (t === "groupedBar" || t === "stackedBar") st.push(this.check("style.horizontal", "Barres horizontales"));
    if (t === "stackedBar" || t === "stackedArea") st.push(this.check("style.normalize", "Empilement 100 %"));
    st.push(this.check("style.accentBar", "Filet rouge Alteridea"));
    st.push(this.check("style.brandMark", "Signature « Reporting 4D · alteridea »"));
    out.push(this.section("style", "Style", ...st));

    /* ---- Format */
    const fm: (Node | null)[] = [];
    fm.push(this.segmented("style.size.preset", [["16:9", "16:9"], ["1:1", "1:1"], ["4:5", "4:5"], ["custom", "Perso"]]));
    if (spec.style.size.preset === "custom") {
      fm.push(h("div", { class: "two" }, this.row("Largeur (px)", this.number("style.size.width", { min: 320, max: 4000, step: 10 })), this.row("Hauteur (px)", this.number("style.size.height", { min: 240, max: 4000, step: 10 }))));
    } else {
      const p = SIZE_PRESETS[spec.style.size.preset];
      fm.push(h("p", { class: "muted" }, `${p.width} × ${p.height} px (PNG 2× = ${p.width * 2} × ${p.height * 2})`));
    }
    out.push(this.section("format", "Format", ...fm));
    return out;
  }

  private swatches(spec: ChartSpec): HTMLElement {
    const colors = paletteColors(spec, themeFor(spec));
    return h("div", { class: "swatches" }, ...colors.slice(0, 10).map((c) => h("span", { class: "swatch", style: `background:${c}`, title: c })));
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

  private ySingle(cols: Column[]): HTMLSelectElement {
    const cur = this.store.state.spec.encoding.y[0] ?? "";
    const sel = h("select", { "data-path": "encoding.y" }, h("option", { value: "" }, "— choisir —"), ...this.colOpts(cols, (c) => c.type === "number").map(([v, l]) => h("option", { value: v, selected: v === cur }, l)));
    sel.addEventListener("change", () => {
      this.store.set("encoding.y", sel.value ? [sel.value] : []);
      this.hintUnit("axes.y", sel.value);
    });
    return sel;
  }

  /** Mesures multiples : cases à cocher (ordre de sélection conservé). */
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
          if (now.length === 1 || (inp.checked && now.length === 1)) this.hintUnit("axes.y", now[0]);
        });
        return h("label", { class: "check" }, inp, h("span", null, c.name), c.idLike ? h("small", { class: "hint" }, "identifiant ?") : null);
      })
    );
  }

  private axisSection(axis: "x" | "y" | "y2", title: string, o: { scale: boolean; scaleOpts: Opt[]; numeric: boolean; formatOnly?: boolean }): HTMLElement {
    const p = `axes.${axis}`;
    const a = this.store.state.spec.axes[axis];
    const rows: (Node | null)[] = [];
    if (!o.formatOnly) {
      rows.push(h("div", { class: "two" }, this.check(`${p}.show`, "Afficher"), this.check(`${p}.grid`, "Grille")));
      rows.push(this.row("Titre d'axe", this.text(`${p}.title`, "", 120)));
    }
    if (o.scale && o.scaleOpts.length > 1) rows.push(this.row("Échelle", this.segmented(`${p}.scale`, o.scaleOpts)));
    if (o.numeric) {
      if (!o.formatOnly) rows.push(h("div", { class: "two" }, this.row("Min", this.number(`${p}.min`, { nullable: true })), this.row("Max", this.number(`${p}.max`, { nullable: true }))));
      rows.push(this.row("Unité", this.select(`${p}.unit`, UNITS.map((u) => [u, UNIT_LABELS[u]] as Opt))));
      if (a.unit === "custom") rows.push(this.row("Suffixe personnalisé", this.text(`${p}.unitCustom`, "ex. t CO₂, h, pts", 12)));
      rows.push(this.row("Décimales", this.select(`${p}.decimals`, [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]].map(([v, l]) => [v, l] as Opt), true, (v) => this.store.set(`${p}.decimals`, v == null ? null : Number(v)))));
      rows.push(h("p", { class: "muted small" }, "Format français : 1 234 567,8 — espace pour les milliers, virgule décimale."));
    }
    return this.section(`axe-${axis}`, title, ...rows);
  }
}
