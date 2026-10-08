/**
 * Bandeau « Histoire » (sous l'aperçu) : snapshots ordonnés — vignettes glissables, renommage,
 * suppression, rechargement au clic, « Ordonner en récit », export PowerPoint.
 */
import type { Store } from "../state";
import { NARRATIVE_ROLES, type NarrativeRole } from "../spec";
import { assignNarrativeOrder, moveSnapshot, ROLE_LABELS, type Snapshot } from "../story/snapshots";
import { h, svgIcon, ICONS } from "./dom";
import type { ScaleInfo } from "../norme";

export interface StoryActions {
  snapshot(): void;
  open(s: Snapshot): void;
  exportPptx(btn: HTMLButtonElement): void;
  /** Groupes d'échelle (graphiques de même mesure). */
  scales?(): Map<string, ScaleInfo>;
  /** Rejoue l'histoire en plein écran. */
  film?(): void;
  /** Mode lecture plein écran (lien profond par diapositive). */
  read?(): void;
  /** « Envoyer vers Cadencer » (manifeste de revue). */
  cadencer?(): void;
  /** « Créer un Reel » (mini-film réseaux sociaux ; exemple public si l'histoire est vide). */
  reel?(): void;
  /** « Dupliquer et mettre en avant » : copie juste après, mise en avant active, choix de l'élément ouvert. */
  duplicateFocus?(s: Snapshot): void;
}

const MORPH_PREF = "datanime:pptx-morph";

export class StoryStrip {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private count: HTMLElement;
  private titleInp: HTMLInputElement;
  private filmBtn: HTMLButtonElement;
  private readBtn: HTMLButtonElement;
  private cadBtn: HTMLButtonElement;
  private reelBtn: HTMLButtonElement;
  private morphBox: HTMLInputElement;
  private morphLabel: HTMLElement;
  private orderBtn: HTMLButtonElement;
  private sameScale: HTMLInputElement;
  private sameScaleLabel: HTMLElement;
  private key = "";
  private dragFrom = -1;

  constructor(private store: Store, private actions: StoryActions) {
    this.count = h("span", { class: "story-count", "data-testid": "story-count" }, "0");
    this.titleInp = h("input", { type: "text", class: "story-title-input", maxlength: "200", "aria-label": "Titre de l'histoire", "data-testid": "story-name" });
    this.titleInp.addEventListener("input", () => this.store.setStory({ ...this.store.state.story, title: this.titleInp.value }));
    this.list = h("div", { class: "story-list", "data-testid": "story-list" });
    this.orderBtn = h("button", { class: "btn btn-small", "data-testid": "story-order", title: "Contexte → tension → révélation → recommandation", onclick: () => this.order() }, "Ordonner en récit");
    this.filmBtn = h("button", { class: "btn btn-small", "data-testid": "story-film", title: "Rejouer l'histoire en plein écran (animations, commentaires) — ←/→, espace, Échap", onclick: () => this.actions.film?.() }, "▶ Film");
    this.readBtn = h("button", { class: "btn btn-small", "data-testid": "story-read", title: "Mode lecture plein écran : une diapositive par snapshot, au rythme du lecteur (toucher, balayage, ←/→), lien partageable par diapositive", onclick: () => this.actions.read?.() }, "Mode lecture");
    this.cadBtn = h("button", { class: "btn btn-small", "data-testid": "story-cadencer", title: "Envoyer l'histoire vers Cadencer : URL du manifeste publié (démos) ou manifeste à télécharger (images intégrées)", onclick: () => this.actions.cadencer?.() }, "Envoyer vers Cadencer");
    this.reelBtn = h("button", { class: "btn btn-small story-reel", "data-testid": "story-reel", title: "Mini-film de 15 à 30 s pour Instagram, TikTok ou LinkedIn (MP4) : une scène par snapshot, titres courts, chiffres qui comptent, carte de fin avec QR", onclick: () => this.actions.reel?.() }, h("span", { html: svgIcon(ICONS.reel, 14) }), "Créer un Reel");
    this.morphBox = h("input", { type: "checkbox", "data-testid": "story-morph" }) as HTMLInputElement;
    try {
      this.morphBox.checked = localStorage.getItem(MORPH_PREF) === "1";
    } catch {
      /* stockage indisponible */
    }
    this.morphBox.addEventListener("change", () => {
      try {
        localStorage.setItem(MORPH_PREF, this.morphBox.checked ? "1" : "0");
      } catch {
        /* stockage indisponible */
      }
    });
    this.morphLabel = h("label", { class: "check mini story-morph", title: "PowerPoint : barres en formes natives animées par la transition Morph (PowerPoint 2019 / Microsoft 365), séquence de construction, QR vers le mode lecture ; fondu dans les autres logiciels" }, this.morphBox, h("span", null, "Transitions Morph"));
    this.sameScale = h("input", { type: "checkbox", "data-testid": "story-same-scale" });
    this.sameScale.addEventListener("change", () => this.store.setStory({ ...this.store.state.story, sameScale: this.sameScale.checked }));
    this.sameScaleLabel = h("label", { class: "check mini story-same-scale", title: "Graphiques de même mesure : même échelle dans l'histoire et le PowerPoint (lecture comparable)" }, this.sameScale, h("span", null, "Même échelle"));
    const toggle = h(
      "button",
      { class: "story-toggle", "data-testid": "story-toggle", title: "Afficher / masquer l'histoire", onclick: () => this.store.setUi({ openSections: { ...this.store.state.ui.openSections, histoire: !this.isOpen() } }) },
      h("span", { html: svgIcon(ICONS.story, 16) }),
      h("strong", null, "Histoire"),
      this.count
    );
    this.root = h(
      "section",
      { class: "story-strip", "data-testid": "story-strip" },
      h(
        "header",
        { class: "story-bar" },
        toggle,
        this.titleInp,
        h("span", { class: "spacer" }),
        h("button", { class: "btn btn-small btn-accent", "data-testid": "snapshot", title: "Ajouter le graphique courant à l'histoire", onclick: () => this.actions.snapshot() }, "📸 Snapshot"),
        this.sameScaleLabel,
        this.orderBtn,
        this.filmBtn,
        this.readBtn,
        this.morphLabel,
        this.reelBtn,
        this.cadBtn
      ),
      this.list
    );
  }

  /** Option d'export « Transitions Morph ». */
  get morph(): boolean {
    return this.morphBox.checked;
  }

  private isOpen(): boolean {
    return this.store.state.ui.openSections.histoire ?? true;
  }

  private order(): void {
    const st = this.store.state.story;
    this.store.setStory({ ...st, snapshots: assignNarrativeOrder(st.snapshots) });
  }

  update(): void {
    const st = this.store.state.story;
    const open = this.isOpen();
    this.root.classList.toggle("collapsed", !open);
    this.count.textContent = String(st.snapshots.length);
    if (document.activeElement !== this.titleInp) this.titleInp.value = st.title;
    this.orderBtn.disabled = st.snapshots.length < 2;
    this.filmBtn.disabled = !st.snapshots.length;
    this.reelBtn.title = st.snapshots.length
      ? "Mini-film de 15 à 30 s pour Instagram, TikTok ou LinkedIn (MP4) : une scène par snapshot, titres courts, chiffres qui comptent, carte de fin avec QR"
      : "Histoire vide : essayez le Reel d'exemple sur données publiques (énergies renouvelables, Eurostat, CC BY 4.0)";
    this.readBtn.disabled = !st.snapshots.length;
    this.cadBtn.disabled = !st.snapshots.length;
    this.sameScale.checked = !!st.sameScale;
    const scales = this.actions.scales?.() ?? new Map<string, ScaleInfo>();
    this.sameScaleLabel.classList.toggle("dim", scales.size === 0);
    const key = JSON.stringify([open, !!st.sameScale, st.snapshots.map((s) => [s.id, s.name, s.role, !!s.thumb, scales.get(s.id)?.differs ?? null])]);
    if (key === this.key) return;
    this.key = key;
    if (!st.snapshots.length) {
      this.list.replaceChildren(h("p", { class: "story-empty" }, "Aucun snapshot : cliquez « 📸 Snapshot » pour ajouter le graphique courant, puis ordonnez votre récit. « Créer un Reel » propose un exemple sur données publiques (Eurostat)."));
      return;
    }
    this.list.replaceChildren(...st.snapshots.map((s, i) => this.card(s, i, scales.get(s.id), !!st.sameScale)));
  }

  private patch(id: string, p: Partial<Snapshot>): void {
    const st = this.store.state.story;
    this.store.setStory({ ...st, snapshots: st.snapshots.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }

  private card(s: Snapshot, i: number, scale?: ScaleInfo, same = false): HTMLElement {
    const name = h("input", { type: "text", class: "story-card-name", value: s.name, maxlength: "200", title: "Renommer", "data-testid": "story-card-name" });
    name.addEventListener("change", () => this.patch(s.id, { name: name.value.trim() || s.title || `Snapshot ${i + 1}` }));
    name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur());
    const role = h("select", { class: `story-role role-${s.role}`, title: "Rôle dans le récit", "data-testid": "story-card-role" }, ...NARRATIVE_ROLES.map((r) => h("option", { value: r, selected: r === s.role }, ROLE_LABELS[r])));
    role.addEventListener("change", () => this.patch(s.id, { role: role.value as NarrativeRole }));
    const del = h("button", { class: "icon-btn story-del", title: "Supprimer", "data-testid": "story-card-delete", html: svgIcon(ICONS.trash, 15), onclick: () => this.store.setStory({ ...this.store.state.story, snapshots: this.store.state.story.snapshots.filter((x) => x.id !== s.id) }) });
    const dup = this.actions.duplicateFocus
      ? h("button", { class: "icon-btn story-focus", title: "Dupliquer et mettre en avant : copie juste après ce snapshot, un élément en avant et son commentaire (transition animée)", "aria-label": "Dupliquer et mettre en avant", "data-testid": "story-card-focus", html: svgIcon(ICONS.focus, 15), onclick: () => this.actions.duplicateFocus?.(s) })
      : null;
    const thumb = h("button", { class: "story-thumb", title: "Recharger ce graphique dans l'éditeur", "data-testid": "story-card-open", onclick: () => this.actions.open(s) }, s.thumb ? h("img", { src: s.thumb, alt: s.title, draggable: "false" }) : h("span", { class: "muted" }, s.title.slice(0, 60)));
    const card = h("article", { class: "story-card", draggable: "true", "data-testid": "story-card", "data-id": s.id, "data-index": String(i) }, h("span", { class: "story-num" }, String(i + 1)), thumb, scale ? this.scaleBadge(scale, same) : null, h("div", { class: "story-card-foot" }, role, dup, del), name);
    card.addEventListener("dragstart", (e) => {
      this.dragFrom = i;
      card.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const from = this.dragFrom >= 0 ? this.dragFrom : Number(e.dataTransfer?.getData("text/plain"));
      this.dragFrom = -1;
      if (!Number.isFinite(from) || from === i) return;
      this.move(from, i);
    });
    return card;
  }

  /** Pastille d'échelle : « = échelle » (commune) ou « ≠ échelle » (même mesure, maxima différents). */
  private scaleBadge(sc: ScaleInfo, same: boolean): HTMLElement {
    const eq = same || !sc.differs;
    return h(
      "span",
      { class: `story-scale ${eq ? "eq" : "ne"}`, "data-testid": "story-scale", title: eq ? `Même échelle que les ${sc.size - 1} autre(s) graphique(s) de même mesure` : `Échelle différente des ${sc.size - 1} autre(s) graphique(s) de même mesure — cochez « Même échelle »` },
      eq ? "= échelle" : "≠ échelle"
    );
  }

  /** Déplace un snapshot (aussi utilisé par l'API de test). */
  move(from: number, to: number): void {
    const st = this.store.state.story;
    this.store.setStory({ ...st, snapshots: moveSnapshot(st.snapshots, from, to) });
  }
}
