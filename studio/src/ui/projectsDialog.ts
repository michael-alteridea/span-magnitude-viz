/**
 * Fenêtre « Mes projets » : projets enregistrés sur cet appareil (IndexedDB) — vignette, nom, date,
 * nombre de scènes ; ouvrir, renommer, dupliquer, supprimer (avec confirmation), exporter / importer
 * un fichier `.datanime`. Rien n'est envoyé : bandeau explicite et jauge de stockage.
 */
import { formatBytes, savedLabel, type ProjectMeta } from "../project/project";
import { confirmDialog, promptDialog } from "./confirm";
import { h, svgIcon, ICONS } from "./dom";

export interface ProjectsActions {
  list(): Promise<ProjectMeta[]>;
  currentId(): string | null;
  /** Le projet ouvert a des modifications non enregistrées. */
  dirty(): boolean;
  persistent(): boolean;
  usage(): Promise<{ usage: number; quota: number } | null>;
  open(id: string): Promise<void>;
  duplicate(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportFile(id: string): Promise<void>;
  importFile(file: File): Promise<void>;
  newProject(): Promise<void>;
}

export class ProjectsDialog {
  readonly root: HTMLElement;
  private grid: HTMLElement;
  private search: HTMLInputElement;
  private gauge: HTMLElement;
  private countEl: HTMLElement;
  private fileInput: HTMLInputElement;
  private items: ProjectMeta[] = [];
  private lastFocus: HTMLElement | null = null;

  constructor(private a: ProjectsActions) {
    this.grid = h("div", { class: "pj-grid", "data-testid": "projects-list" });
    this.search = h("input", { type: "search", class: "pj-search", placeholder: "Rechercher un projet, une source…", "aria-label": "Rechercher un projet", "data-testid": "projects-search" });
    this.search.addEventListener("input", () => this.render());
    this.gauge = h("div", { class: "pj-gauge", "data-testid": "projects-usage" });
    this.countEl = h("span", { class: "pj-count" });
    this.fileInput = h("input", { type: "file", accept: ".datanime,.json,application/json", hidden: true, "data-testid": "projects-import-input" }) as HTMLInputElement;
    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (f) void this.run(() => this.a.importFile(f));
    });
    const sheet = h(
      "div",
      { class: "dw-sheet pj-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "pj-title" },
      h(
        "header",
        { class: "dw-head" },
        h("span", { class: "dw-head-ic", html: svgIcon(ICONS.folder, 20) }),
        h("div", { class: "dw-head-txt" }, h("h2", { id: "pj-title" }, "Mes projets ", this.countEl), h("p", null, "Un projet = la source de données, le graphique et la séquence (scènes et réglages du film).")),
        h("button", { class: "icon-btn dw-close", "aria-label": "Fermer", title: "Fermer (Échap)", "data-testid": "projects-close", html: svgIcon(ICONS.close, 18), onclick: () => this.close() })
      ),
      h(
        "div",
        { class: "pj-body" },
        h(
          "div",
          { class: "pj-banner", "data-testid": "projects-banner" },
          h("span", { class: "pj-banner-ic", html: svgIcon(ICONS.save, 16) }),
          h("span", { class: "pj-banner-txt" }, "Stockés ", h("b", null, "uniquement sur cet appareil"), " (ce navigateur). Rien n'est envoyé. Pour garder une copie ou la transmettre : ", h("span", { class: "pj-dl", html: svgIcon(ICONS.download, 13) }), " Exporter le projet (.datanime)."),
          this.gauge
        ),
        h(
          "div",
          { class: "pj-tools" },
          h("label", { class: "pj-search-wrap" }, h("span", { html: svgIcon(ICONS.search, 15) }), this.search),
          h("button", { class: "btn", "data-testid": "projects-import", onclick: () => this.fileInput.click() }, h("span", { html: svgIcon(ICONS.upload, 15) }), "Importer un .datanime"),
          h("button", { class: "btn btn-accent", "data-testid": "projects-new", onclick: () => void this.newProject() }, "+ Nouveau projet"),
          this.fileInput
        ),
        this.grid
      )
    );
    this.root = h("div", { class: "dw-overlay pj-overlay", hidden: true, "data-testid": "projects-dialog", onclick: (e: Event) => e.target === this.root && this.close() }, sheet);
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.querySelector(".cf-overlay")) {
        e.preventDefault();
        this.close();
      }
    });
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(): Promise<void> {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    await this.refresh();
    this.search.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.lastFocus?.focus?.();
  }

  async refresh(): Promise<void> {
    try {
      this.items = await this.a.list();
    } catch {
      this.items = [];
    }
    this.render();
    const u = await this.a.usage();
    this.gauge.replaceChildren(
      h("span", null, this.a.persistent() ? (u ? `${formatBytes(u.usage)} utilisés` : "") : "Stockage local indisponible (navigation privée ?) : exportez vos projets"),
      ...(u && u.quota ? [h("span", { class: "pj-bar" }, h("i", { style: `width:${Math.max(2, Math.min(100, (u.usage / u.quota) * 100)).toFixed(1)}%` }))] : [])
    );
  }

  private async run(f: () => Promise<void>): Promise<void> {
    try {
      await f();
    } finally {
      if (this.isOpen) await this.refresh();
    }
  }

  private async newProject(): Promise<void> {
    if (this.a.dirty() && !(await confirmDialog({ title: "Nouveau projet", message: "Les modifications non enregistrées du projet ouvert seront perdues.", confirm: "Continuer sans enregistrer", danger: true, testid: "confirm-new" }))) return;
    await this.a.newProject();
    this.close();
  }

  private render(): void {
    const q = this.search.value.trim().toLowerCase();
    const list = q ? this.items.filter((m) => `${m.name} ${m.sourceName}`.toLowerCase().includes(q)) : this.items;
    this.countEl.textContent = this.items.length ? String(this.items.length) : "";
    if (!this.items.length) {
      this.grid.replaceChildren(h("p", { class: "pj-empty", "data-testid": "projects-empty" }, "Aucun projet enregistré sur cet appareil. Cliquez « Enregistrer » dans la bande « Séquence », ou importez un fichier .datanime."));
      return;
    }
    if (!list.length) {
      this.grid.replaceChildren(h("p", { class: "pj-empty" }, `Aucun projet ne correspond à « ${this.search.value.trim()} ».`));
      return;
    }
    const cur = this.a.currentId();
    this.grid.replaceChildren(...list.map((m) => this.card(m, m.id === cur)));
  }

  private card(m: ProjectMeta, current: boolean): HTMLElement {
    const open = async () => {
      if (current) return this.close();
      if (this.a.dirty() && !(await confirmDialog({ title: `Ouvrir « ${m.name} »`, message: "Le projet ouvert a des modifications non enregistrées : elles seront perdues.", confirm: "Ouvrir sans enregistrer", danger: true, testid: "confirm-open" }))) return;
      await this.a.open(m.id);
      this.close();
    };
    const rename = async () => {
      const name = await promptDialog({ title: "Renommer le projet", label: "Nom du projet", value: m.name, confirm: "Renommer" });
      if (name && name !== m.name) await this.run(() => this.a.rename(m.id, name));
    };
    const remove = async () => {
      if (!(await confirmDialog({ title: `Supprimer « ${m.name} » ?`, message: `Le projet et ses ${m.scenes} scène(s) seront effacés de cet appareil. Exportez-le d'abord (.datanime) pour en garder une copie.`, confirm: "Supprimer", danger: true, testid: "confirm-delete" }))) return;
      await this.run(() => this.a.remove(m.id));
    };
    const chips = [`Séquence · ${m.scenes} scène${m.scenes > 1 ? "s" : ""}`, m.sourceName ? `${m.sourceName}${m.rowCount ? ` · ${m.rowCount.toLocaleString("fr-FR")} lignes` : ""}` : null].filter(Boolean) as string[];
    return h(
      "article",
      { class: `pj-card${current ? " current" : ""}`, "data-testid": "project-card", "data-id": m.id },
      h("button", { class: "pj-thumb", title: "Ouvrir", "aria-label": `Ouvrir ${m.name}`, onclick: () => void open() }, m.thumb ? h("img", { src: m.thumb, alt: "", draggable: "false" }) : h("span", { html: svgIcon(ICONS.story, 28) })),
      h(
        "div",
        { class: "pj-info" },
        h("strong", { class: "pj-name", "data-testid": "project-name", title: m.name }, m.name),
        h("div", { class: "pj-chips" }, ...chips.map((c) => h("span", { class: "pj-chip" }, c))),
        h("small", { class: "pj-date", "data-testid": "project-date" }, `Modifié ${savedLabel(m.updatedAt)}${current ? " · ouvert" : ""}`)
      ),
      h(
        "div",
        { class: "pj-actions" },
        h("button", { class: "btn btn-accent btn-small", "data-testid": "project-open", onclick: () => void open() }, current ? "Ouvert" : "Ouvrir"),
        h("button", { class: "btn btn-small", "data-testid": "project-duplicate", onclick: () => void this.run(() => this.a.duplicate(m.id)) }, "Dupliquer"),
        h("button", { class: "icon-btn", title: "Exporter le projet (.datanime)", "aria-label": "Exporter le projet", "data-testid": "project-export", html: svgIcon(ICONS.download, 16), onclick: () => void this.a.exportFile(m.id) }),
        h("button", { class: "icon-btn", title: "Renommer", "aria-label": "Renommer le projet", "data-testid": "project-rename", html: svgIcon(ICONS.edit, 16), onclick: () => void rename() }),
        h("button", { class: "icon-btn pj-del", title: "Supprimer de cet appareil", "aria-label": "Supprimer le projet", "data-testid": "project-delete", html: svgIcon(ICONS.trash, 16), onclick: () => void remove() })
      )
    );
  }
}
