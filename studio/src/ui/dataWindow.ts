/**
 * Fenêtre « Données » (pleine page, adaptée à l'iPad) : une seule porte d'entrée pour choisir ses données.
 * Onglets : Importer un fichier · Coller un tableau · Récents · Exemples · Données publiques.
 * Étapes (modèle « dataset d'abord ») : ① Source ✓ › ② Filtrer › ③ Enregistrer le dataset — l'étape Filtrer
 * (voir datasetEditor.ts) s'ouvre aussi depuis le panneau Datasets (« + Nouveau dataset », « Modifier »).
 * S'ouvre depuis la barre du haut (« Ouvrir des données »), le panneau Données (« Changer de données »)
 * et par lien direct (?donnees=publiques, ?donnees=ouvrir…). Rien n'est envoyé : tout reste dans le navigateur.
 */
import { SAMPLES, PUBLIC_THEMES, type Sample } from "../data/samples";
import { ACCEPTED_EXT } from "../data/files";
import { canReopen, loadRecents, pushRecent, recentDate, removeRecent, saveRecents, RECENT_KIND_LABEL, type KV, type RecentEntry } from "../data/recents";
import { h, svgIcon, ICONS } from "./dom";

export type DataTab = "fichier" | "coller" | "recents" | "exemples" | "publiques";
export const DATA_TABS: DataTab[] = ["fichier", "coller", "recents", "exemples", "publiques"];

/** Valeur de ?donnees=… → onglet (« ouvrir » : Récents s'il y en a, sinon Importer un fichier). */
export function tabFromParam(v: string | null, hasRecents: boolean): DataTab | null {
  if (v == null) return null;
  const k = v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const map: Record<string, DataTab> = { publiques: "publiques", publique: "publiques", public: "publiques", exemples: "exemples", exemple: "exemples", recents: "recents", recent: "recents", fichier: "fichier", importer: "fichier", import: "fichier", coller: "coller", collage: "coller" };
  if (map[k]) return map[k]!;
  if (k === "" || k === "ouvrir" || k === "1" || k === "oui") return hasRecents ? "recents" : "fichier";
  return null;
}

export interface DataWindowActions {
  loadSample(id: string): void;
  importText(text: string): void;
  importFile(file: File): void;
  reshape(): void;
  reelSample(id: string): void;
  scenarios?(): void;
  reopenRecent(e: RecentEntry): void;
  /** Projets d'exemple intégrés (jeu de données + scènes), ouverts sans import. */
  exampleProjects?(): readonly { id: string; name: string; description: string }[];
  openExampleProject?(id: string): void;
}

const TAB_META: Record<DataTab, { label: string; icon: string; hint: string }> = {
  fichier: { label: "Importer un fichier", icon: ICONS.upload, hint: "CSV, TSV, JSON, Excel" },
  coller: { label: "Coller un tableau", icon: ICONS.paste, hint: "Depuis Excel ou Google Sheets" },
  recents: { label: "Récents", icon: ICONS.clock, hint: "Gardés dans ce navigateur" },
  exemples: { label: "Exemples", icon: ICONS.table, hint: "Données d'entreprise fictives" },
  publiques: { label: "Données publiques", icon: ICONS.globe, hint: "Eurostat, NOAA, ONU…" },
};

const kv = (): KV | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export class DataWindow {
  readonly root: HTMLElement;
  private body!: HTMLElement;
  private editorHost: HTMLElement = h("div", { class: "dw-editor-host" });
  private stepBtns: HTMLButtonElement[] = [];
  private step: "source" | "filtrer" = "source";
  private hasSource: () => boolean = () => false;
  private onFilter: ((editId: string | null) => void) | null = null;
  private headP!: HTMLElement;
  private tab: DataTab = "fichier";
  private tabBtns = new Map<DataTab, HTMLButtonElement>();
  private panels = new Map<DataTab, HTMLElement>();
  private sampleBtns: HTMLButtonElement[] = [];
  private recentsHost: HTMLElement;
  private recentsCount: HTMLElement;
  private fileInput: HTMLInputElement;
  private paste: HTMLTextAreaElement;
  private lastFocus: HTMLElement | null = null;
  private recents: RecentEntry[] = loadRecents(kv());

  constructor(private actions: DataWindowActions) {
    const done = <T extends unknown[]>(f: (...a: T) => void) => (...a: T) => {
      this.close();
      f(...a);
    };

    /* 1. Importer un fichier */
    this.fileInput = h("input", { type: "file", accept: ACCEPTED_EXT.join(","), class: "hidden", "data-testid": "file-input" });
    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (f) done(actions.importFile)(f);
    });
    const pick = () => this.fileInput.click();
    const drop = h(
      "div",
      { class: "dropzone dw-drop", tabindex: "0", role: "button", "aria-label": "Déposer un fichier ou parcourir", "data-testid": "dropzone", onclick: pick, onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()) },
      h("span", { class: "drop-icon", html: svgIcon(ICONS.upload, 34) }),
      h("strong", null, "Déposez un fichier ici"),
      h("span", null, "ou touchez pour parcourir vos fichiers"),
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
      if (f) done(actions.importFile)(f);
    });
    // glisser-déposer n'importe où sur la page (fenêtre ouverte ou non)
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      if ((e.target as HTMLElement)?.closest?.(".dropzone")) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) done(actions.importFile)(f);
    });
    const filePanel = h(
      "div",
      { class: "dw-file" },
      drop,
      this.fileInput,
      h("p", { class: "dw-note" }, h("span", { html: svgIcon(ICONS.check, 14) }), "Vos fichiers restent dans votre navigateur : rien n'est envoyé."),
      h(
        "div",
        { class: "dw-card dw-reshape" },
        h("div", null, h("strong", null, "Mise en forme des données"), h("small", null, "Onglet, tableau, axes X / Y, regroupement de lignes — aperçu en direct. Pour un classeur « humain » (titres, sections, totaux) ou le tableau courant.")),
        h("button", { type: "button", class: "btn", "data-testid": "reshape-open", onclick: done(() => actions.reshape()) }, h("span", { html: svgIcon(ICONS.sliders, 15) }), "Mise en forme des données…")
      )
    );

    /* 2. Coller un tableau */
    this.paste = h("textarea", {
      class: "paste dw-paste",
      rows: "10",
      spellcheck: "false",
      placeholder: "Collez ici un tableau copié depuis Excel ou Google Sheets (Ctrl+V ou appui long › Coller)…\nSéparateurs tabulation, « ; » ou « , » — virgule décimale acceptée.",
      "aria-label": "Tableau à coller",
      "data-testid": "paste-area",
    });
    const apply = () => {
      const v = this.paste.value;
      if (!v.trim()) return;
      done(actions.importText)(v);
    };
    this.paste.addEventListener("paste", () => setTimeout(apply, 0));
    const pastePanel = h(
      "div",
      { class: "dw-pastebox" },
      this.paste,
      h("div", { class: "dw-row" }, h("small", { class: "dw-muted" }, "La première ligne donne les noms de colonnes. Un tableau mis en page (titres, sections) ouvre la mise en forme."), h("button", { type: "button", class: "btn btn-accent", "data-testid": "paste-apply", onclick: apply }, "Utiliser ces données"))
    );

    /* 3. Récents */
    this.recentsHost = h("div", { class: "dw-recents", "data-testid": "recents" });
    this.recentsCount = h("span", { class: "dw-tab-count" });
    const recentsPanel = h(
      "div",
      null,
      h("p", { class: "dw-intro" }, "Les 10 derniers jeux de données ouverts ou importés, gardés dans ce navigateur uniquement (rien n'est envoyé). Un fichier trop volumineux est listé sans son contenu : réimportez-le."),
      this.recentsHost
    );

    /* 4. Exemples */
    const sampleCard = (s: Sample) => {
      const b = h("button", { type: "button", class: "sample dw-sample", "data-sample": s.id, "data-testid": `sample-${s.id}`, onclick: done(() => actions.loadSample(s.id)) }, h("strong", null, s.name), h("small", null, s.description));
      this.sampleBtns.push(b);
      return b;
    };
    const examplesPanel = h(
      "div",
      null,
      h(
        "div",
        { class: "dw-row dw-row-head" },
        h("p", { class: "dw-intro" }, "Jeux d'exemple d'entreprise (Norvia, données fictives) : ventes, pipeline, budget, revue mensuelle…"),
        actions.scenarios
          ? h("button", { type: "button", class: "btn btn-scenario btn-scenario-sm", "data-testid": "scenario-open", title: "Scénarios de réunion (Directeur commercial…) : exploration guidée, snapshots, film et PowerPoint", onclick: done(() => actions.scenarios?.()) }, h("span", { html: svgIcon(ICONS.clapper, 14) }), "Scénarios")
          : null
      ),
      h("div", { class: "dw-grid" }, ...SAMPLES.filter((s) => !s.publicData).map(sampleCard)),
      ...(() => {
        const list = actions.exampleProjects?.() ?? [];
        if (!list.length || !actions.openExampleProject) return [];
        return [
          h("p", { class: "dw-intro", style: "margin-top:14px" }, "Projets d'exemple : données et scènes prêtes, ouverts directement (aussi par le lien ?projet=<nom>)."),
          h(
            "div",
            { class: "dw-grid", "data-testid": "example-projects" },
            ...list.map((e) => h("button", { type: "button", class: "sample dw-project", "data-project": e.id, "data-testid": `example-project-${e.id}`, onclick: done(() => actions.openExampleProject?.(e.id)) }, h("strong", null, e.name), h("small", null, e.description)))
          ),
        ];
      })()
    );

    /* 5. Données publiques */
    const pub = SAMPLES.filter((s) => s.publicData);
    const themes = PUBLIC_THEMES.filter((t) => pub.some((s) => s.publicData!.theme === t));
    const publicPanel = h(
      "div",
      { class: "public-data", "data-testid": "public-data" },
      h("p", { class: "dw-intro" }, "Données ouvertes, réutilisables y compris commercialement : modifiables comme vos propres données, source et licence déjà dans le cartouche. « Créer un Reel » propose une histoire suggérée."),
      ...themes.map((t) =>
        h(
          "section",
          { class: "public-theme", "data-testid": "public-theme", "data-theme": t },
          h("h4", null, t),
          h(
            "div",
            { class: "dw-grid" },
            ...pub
              .filter((s) => s.publicData!.theme === t)
              .map((s) =>
                h(
                  "div",
                  { class: "public-sample" },
                  sampleCard(s),
                  h(
                    "div",
                    { class: "public-meta" },
                    h("span", { class: "public-licence", title: s.publicData!.sourceLabel }, s.publicData!.licenceShort),
                    s.publicData!.reel
                      ? h("button", { class: "btn btn-mini public-reel", type: "button", "data-testid": `public-reel-${s.id}`, title: `Créer un Reel avec l'histoire suggérée (${s.publicData!.reelCount ?? "3 à 5"} snapshots)`, onclick: done(() => actions.reelSample(s.id)) }, h("span", { html: svgIcon(ICONS.reel, 14) }), "Créer un Reel")
                      : null
                  )
                )
              )
          )
        )
      )
    );

    const content: Record<DataTab, HTMLElement> = { fichier: filePanel, coller: pastePanel, recents: recentsPanel, exemples: examplesPanel, publiques: publicPanel };
    const tablist = h("div", { class: "dw-tabs", role: "tablist", "aria-label": "Source des données" });
    for (const t of DATA_TABS) {
      const m = TAB_META[t];
      const b = h(
        "button",
        { type: "button", class: "dw-tab", role: "tab", id: `dw-tab-${t}`, "aria-controls": `dw-panel-${t}`, "aria-selected": "false", tabindex: "-1", "data-testid": `dw-tab-${t}`, onclick: () => this.show(t) },
        h("span", { class: "dw-tab-ic", html: svgIcon(m.icon, 18) }),
        h("span", { class: "dw-tab-txt" }, h("b", null, m.label), h("small", null, m.hint)),
        t === "recents" ? this.recentsCount : null
      ) as HTMLButtonElement;
      b.addEventListener("keydown", (e) => {
        const i = DATA_TABS.indexOf(t);
        const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? DATA_TABS[(i + 1) % DATA_TABS.length] : e.key === "ArrowLeft" || e.key === "ArrowUp" ? DATA_TABS[(i - 1 + DATA_TABS.length) % DATA_TABS.length] : null;
        if (next) {
          e.preventDefault();
          this.show(next);
          this.tabBtns.get(next)?.focus();
        }
      });
      this.tabBtns.set(t, b);
      tablist.append(b);
      const p = h("section", { class: "dw-panel", role: "tabpanel", id: `dw-panel-${t}`, "aria-labelledby": `dw-tab-${t}`, "data-testid": `dw-panel-${t}`, hidden: true }, h("h3", { class: "dw-panel-title" }, m.label), content[t]);
      this.panels.set(t, p);
    }

    // Étapes : ① Source › ② Filtrer › ③ Enregistrer le dataset
    const stepBtn = (n: string, label: string, testid: string, on: () => void) => {
      const b = h("button", { type: "button", class: "dw-step", "data-testid": testid, onclick: on }, h("span", { class: "dw-step-n" }, n), h("span", { class: "dw-step-t" }, label)) as HTMLButtonElement;
      this.stepBtns.push(b);
      return b;
    };
    const steps = h(
      "nav",
      { class: "dw-steps", "aria-label": "Étapes" },
      stepBtn("1", "Source", "dw-step-source", () => this.showSource()),
      h("span", { class: "dw-step-line", "aria-hidden": "true" }),
      stepBtn("2", "Filtrer", "dw-step-filtrer", () => this.hasSource() && this.onFilter?.(null)),
      h("span", { class: "dw-step-line", "aria-hidden": "true" }),
      stepBtn("3", "Enregistrer le dataset", "dw-step-save", () => {
        if (!this.hasSource()) return;
        if (this.step !== "filtrer") this.onFilter?.(null);
        requestAnimationFrame(() => this.editorHost.querySelector<HTMLInputElement>("[data-testid=dse-name]")?.focus());
      })
    );
    this.headP = h("p", null, "Choisissez une source : votre fichier, un tableau collé, vos données récentes, un exemple ou des données publiques.");
    this.body = h("div", { class: "dw-body" }, tablist, h("div", { class: "dw-panels" }, ...this.panels.values()));
    const sheet = h(
      "div",
      { class: "dw-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "dw-title" },
      h(
        "header",
        { class: "dw-head" },
        h("span", { class: "dw-head-ic", html: svgIcon(ICONS.table, 20) }),
        h("div", { class: "dw-head-txt" }, h("h2", { id: "dw-title" }, "Données"), this.headP),
        steps,
        h("button", { type: "button", class: "icon-btn dw-close", "aria-label": "Fermer", title: "Fermer (Échap)", "data-testid": "data-window-close", html: svgIcon(ICONS.close, 20), onclick: () => this.close() })
      ),
      this.body,
      this.editorHost
    );
    this.root = h("div", { class: "dw-overlay", hidden: true, "data-testid": "data-window", onclick: (e: Event) => e.target === this.root && this.close() }, sheet);
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    });
    this.renderRecents();
  }

  /** Étape « Filtrer » : éditeur de dataset (fourni par main) et accès à la source courante. */
  attachEditor(el: HTMLElement, hasSource: () => boolean, onFilter: (editId: string | null) => void): void {
    this.editorHost.replaceChildren(el);
    this.hasSource = hasSource;
    this.onFilter = onFilter;
    this.paintSteps();
  }

  get currentStep(): "source" | "filtrer" {
    return this.step;
  }

  private paintSteps(): void {
    const src = this.hasSource();
    const [b1, b2, b3] = this.stepBtns;
    const f = this.step === "filtrer";
    b1?.classList.toggle("done", src);
    b1?.classList.toggle("active", !f);
    b1!.querySelector(".dw-step-n")!.innerHTML = src ? svgIcon(ICONS.check, 13) : "1";
    b2?.classList.toggle("active", f);
    if (b2) b2.disabled = !src;
    if (b3) b3.disabled = !src;
    b3?.classList.toggle("next", f);
    this.root.classList.toggle("dw-filtering", f);
  }

  /** Affiche l'étape ① Source (onglets). */
  showSource(tab?: DataTab): void {
    this.step = "source";
    this.body.hidden = false;
    const ed = this.editorHost.firstElementChild as HTMLElement | null;
    if (ed) ed.hidden = true;
    this.headP.hidden = false;
    this.paintSteps();
    if (tab) this.show(tab);
  }

  /** Affiche l'étape ② Filtrer (l'éditeur est déjà démarré par main). */
  showFilter(): void {
    if (!this.isOpen) {
      this.lastFocus = document.activeElement as HTMLElement | null;
      this.root.hidden = false;
      document.body.classList.add("dw-open");
    }
    this.step = "filtrer";
    this.body.hidden = true;
    const ed = this.editorHost.firstElementChild as HTMLElement | null;
    if (ed) ed.hidden = false;
    this.headP.hidden = true;
    this.paintSteps();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get currentTab(): DataTab {
    return this.tab;
  }

  get recentEntries(): RecentEntry[] {
    return [...this.recents];
  }

  open(tab?: DataTab): void {
    if (!this.isOpen) this.lastFocus = document.activeElement as HTMLElement | null;
    const store = kv();
    if (store) this.recents = loadRecents(store);
    this.renderRecents();
    this.root.hidden = false;
    document.body.classList.add("dw-open");
    this.showSource();
    this.show(tab ?? (this.recents.length ? "recents" : "fichier"));
    requestAnimationFrame(() => this.tabBtns.get(this.tab)?.focus({ preventScroll: true }));
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.body.classList.remove("dw-open");
    const f = this.lastFocus;
    this.lastFocus = null;
    if (f && document.contains(f)) f.focus({ preventScroll: true });
  }

  show(t: DataTab): void {
    this.tab = t;
    for (const [k, b] of this.tabBtns) {
      const on = k === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const [k, p] of this.panels) p.hidden = k !== t;
    if (t === "coller") requestAnimationFrame(() => this.paste.focus({ preventScroll: true }));
  }

  /** Exemple actif (surligné). */
  update(sampleId: string | null): void {
    this.sampleBtns.forEach((b) => b.classList.toggle("active", b.dataset.sample === sampleId));
    if (this.stepBtns.length) this.paintSteps();
  }

  /** Mémorise un jeu ouvert ou importé (en tête de « Récents »). */
  remember(e: RecentEntry): void {
    const store = kv();
    this.recents = saveRecents(store, pushRecent(store ? loadRecents(store) : this.recents, e));
    this.renderRecents();
  }

  forget(id: string): void {
    this.recents = saveRecents(kv(), removeRecent(this.recents, id));
    this.renderRecents();
  }

  private renderRecents(): void {
    const list = this.recents;
    this.recentsCount.textContent = list.length ? String(list.length) : "";
    if (!list.length) {
      this.recentsHost.replaceChildren(h("p", { class: "dw-empty" }, "Aucune donnée récente pour l'instant : importez un fichier, collez un tableau ou ouvrez un exemple."));
      return;
    }
    this.recentsHost.replaceChildren(
      ...list.map((e) => {
        const ok = canReopen(e);
        const meta = `${RECENT_KIND_LABEL[e.kind]} · ${recentDate(e.at)} · ${e.rows.toLocaleString("fr-FR")} lignes × ${e.cols} colonnes`;
        const main = ok
          ? h("button", { type: "button", class: "dw-recent-open", "data-testid": "recent-open", title: `Rouvrir « ${e.name} »`, onclick: () => { this.close(); this.actions.reopenRecent(e); } }, h("strong", null, e.name), h("small", null, meta))
          : h("div", { class: "dw-recent-open is-off" }, h("strong", null, e.name), h("small", null, meta), h("small", { class: "dw-reimport-hint", "data-testid": "recent-reimport" }, "Fichier trop volumineux pour être gardé ici : réimportez le fichier."));
        return h(
          "div",
          { class: `dw-recent${ok ? "" : " off"}`, "data-testid": "recent-item", "data-id": e.id, "data-kind": e.kind },
          h("span", { class: "dw-recent-ic", html: svgIcon(e.kind === "public" ? ICONS.globe : e.kind === "sample" ? ICONS.table : e.kind === "paste" ? ICONS.paste : ICONS.upload, 18) }),
          main,
          ok ? null : h("button", { type: "button", class: "btn btn-mini", "data-testid": "recent-reimport-btn", onclick: () => { this.show("fichier"); this.fileInput.click(); } }, "Réimporter le fichier"),
          h("button", { type: "button", class: "icon-btn dw-recent-del", "aria-label": `Retirer « ${e.name} » des récents`, title: "Retirer de la liste", "data-testid": "recent-remove", html: svgIcon(ICONS.close, 16), onclick: () => this.forget(e.id) })
        );
      })
    );
  }
}
