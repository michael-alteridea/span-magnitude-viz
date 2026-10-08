/**
 * Bandeau « Séquence » (sous l'aperçu) : scènes ordonnées — vignettes glissables, renommage, suppression,
 * rechargement au clic, « Ordonner en récit » — et le projet : Enregistrer (sur cet appareil), Ouvrir… (Mes projets),
 * Réinitialiser ▾. Chaque scène indique si elle a changé depuis l'enregistrement (« modifiée », ↺).
 * Vocabulaire : « scène » dans l'interface ; « snapshot » dans le code, le manifeste et le contrat Cadencer.
 */
import type { Store } from "../state";
import { NARRATIVE_ROLES, type NarrativeRole } from "../spec";
import { assignNarrativeOrder, moveSnapshot, ROLE_LABELS, type Snapshot } from "../story/snapshots";
import type { SceneState } from "../project/project";
import { h, svgIcon, ICONS } from "./dom";
import { makeMenu, menuItem, type MenuHandle } from "./menu";
import type { ScaleInfo } from "../norme";

export interface ProjectStatus {
  /** Nom du projet ouvert (null : jamais enregistré). */
  name: string | null;
  /** Heure du dernier enregistrement (« 23:12 »), null si jamais enregistré. */
  savedAt: string | null;
  dirty: boolean;
  scenes: Map<string, SceneState>;
}

export interface StoryActions {
  snapshot(): void;
  open(s: Snapshot): void;
  exportPptx(btn: HTMLButtonElement): void;
  /** Groupes d'échelle (graphiques de même mesure). */
  scales?(): Map<string, ScaleInfo>;
  /** Rejoue la séquence en plein écran. */
  film?(): void;
  /** Mode lecture plein écran (lien profond par diapositive). */
  read?(): void;
  /** « Envoyer vers Cadencer » (manifeste de revue). */
  cadencer?(): void;
  /** « Créer un Reel » (mini-film réseaux sociaux ; exemple public si la séquence est vide). */
  reel?(): void;
  /** « Dupliquer et mettre en avant » : copie juste après, mise en avant active, choix de l'élément ouvert. */
  duplicateFocus?(s: Snapshot): void;
  /** Projet : état d'enregistrement. */
  status?(): ProjectStatus;
  save?(): void;
  openProjects?(): void;
  revert?(): void;
  clearSequence?(): void;
  resetAll?(): void;
  resetScene?(id: string): void;
}

const MORPH_PREF = "datanime:pptx-morph";

export class StoryStrip {
  readonly root: HTMLElement;
  /** Options du film et du PowerPoint (Même échelle, Transitions Morph) : affichées dans la carte Export. */
  readonly sequenceOptions: HTMLElement;
  private list: HTMLElement;
  private count: HTMLElement;
  private titleInp: HTMLInputElement;
  private statusEl: HTMLElement;
  private filmBtn: HTMLButtonElement;
  private readBtn: HTMLButtonElement;
  private cadBtn: HTMLButtonElement;
  private reelBtn: HTMLButtonElement;
  private morphBox: HTMLInputElement;
  private orderBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private revertIt: HTMLButtonElement;
  private resetMenu: MenuHandle;
  private sameScale: HTMLInputElement;
  private sameScaleLabel: HTMLElement;
  private key = "";
  private dragFrom = -1;

  constructor(private store: Store, private actions: StoryActions) {
    this.count = h("span", { class: "story-count", "data-testid": "story-count" }, "0");
    this.titleInp = h("input", { type: "text", class: "story-title-input", maxlength: "200", "aria-label": "Titre de la séquence", "data-testid": "story-name" });
    this.titleInp.addEventListener("input", () => this.store.setStory({ ...this.store.state.story, title: this.titleInp.value }));
    this.statusEl = h("span", { class: "seq-status", "data-testid": "seq-status", role: "status" });
    this.list = h("div", { class: "story-list", "data-testid": "story-list" });
    this.orderBtn = h("button", { class: "btn btn-small", "data-testid": "story-order", title: "Ordonner en récit : contexte → tension → révélation → recommandation", onclick: () => this.order() }, "Ordonner");
    this.filmBtn = h("button", { class: "btn btn-small", "data-testid": "story-film", title: "Rejouer la séquence en plein écran (animations, commentaires) — ←/→, espace, Échap", onclick: () => this.actions.film?.() }, "▶ Film");
    this.readBtn = h("button", { class: "btn btn-small", "data-testid": "story-read", title: "Mode lecture plein écran : une diapositive par scène, au rythme du lecteur (toucher, balayage, ←/→), lien partageable par diapositive", onclick: () => this.actions.read?.() }, "Mode lecture");
    this.cadBtn = h("button", { class: "btn btn-small", "data-testid": "story-cadencer", title: "Envoyer la séquence vers Cadencer : URL du manifeste publié (démos) ou manifeste à télécharger (images intégrées)", onclick: () => this.actions.cadencer?.() }, "Cadencer");
    this.reelBtn = h("button", { class: "btn btn-small story-reel", "data-testid": "story-reel", onclick: () => this.actions.reel?.() }, h("span", { html: svgIcon(ICONS.reel, 14) }), "Créer un Reel");
    this.saveBtn = h("button", { class: "btn btn-small", "data-testid": "seq-save", title: "Enregistrer le projet sur cet appareil (source, graphique, séquence)", onclick: () => this.actions.save?.() }, h("span", { html: svgIcon(ICONS.save, 14) }), "Enregistrer");
    const openBtn = h("button", { class: "btn btn-small", "data-testid": "seq-open", title: "Mes projets : ouvrir, renommer, dupliquer, exporter ou importer (.datanime)", onclick: () => this.actions.openProjects?.() }, h("span", { html: svgIcon(ICONS.folder, 14) }), "Ouvrir…");
    const resetBtn = h("button", { class: "btn btn-small menu-btn", title: "Réinitialiser" }, h("span", { html: svgIcon(ICONS.refresh, 14) }), "Réinitialiser", h("span", { class: "menu-car", html: svgIcon(ICONS.chevronD, 12) }));
    this.revertIt = menuItem(svgIcon(ICONS.history, 16), "Revenir au dernier enregistrement", { testid: "seq-reset-revert", hint: "Annule les changements non enregistrés", onclick: () => this.actions.revert?.() });
    this.resetMenu = makeMenu(
      resetBtn,
      [
        this.revertIt,
        menuItem(svgIcon(ICONS.story, 16), "Vider la séquence", { testid: "seq-reset-clear", hint: "Garde la source et le graphique", onclick: () => this.actions.clearSequence?.() }),
        menuItem(svgIcon(ICONS.trash, 16), "Tout réinitialiser", { testid: "seq-reset-all", hint: "Source, graphique et séquence (projet vide)", danger: true, onclick: () => this.actions.resetAll?.() }),
      ],
      { testid: "seq-reset", label: "Réinitialiser", align: "left" }
    );
    this.morphBox = h("input", { type: "checkbox", "data-testid": "story-morph" }) as HTMLInputElement;
    try {
      this.morphBox.checked = localStorage.getItem(MORPH_PREF) === "1";
    } catch {
      /* stockage indisponible */
    }
    this.morphBox.addEventListener("change", () => this.setMorph(this.morphBox.checked));
    const morphLabel = h("label", { class: "check story-morph", title: "PowerPoint : barres en formes natives animées par la transition Morph (PowerPoint 2019 / Microsoft 365), séquence de construction, QR vers le mode lecture ; fondu dans les autres logiciels" }, this.morphBox, h("span", null, "Transitions Morph (PowerPoint)"));
    this.sameScale = h("input", { type: "checkbox", "data-testid": "story-same-scale" });
    this.sameScale.addEventListener("change", () => this.store.setStory({ ...this.store.state.story, sameScale: this.sameScale.checked }));
    this.sameScaleLabel = h("label", { class: "check story-same-scale", title: "Graphiques de même mesure : même échelle dans la séquence et le PowerPoint (lecture comparable)" }, this.sameScale, h("span", null, "Même échelle entre les scènes"));
    this.sequenceOptions = h("div", { class: "seq-options", "data-testid": "seq-options" }, this.sameScaleLabel, morphLabel);
    const toggle = h(
      "button",
      { class: "story-toggle", "data-testid": "story-toggle", title: "Afficher / masquer la séquence", onclick: () => this.store.setUi({ openSections: { ...this.store.state.ui.openSections, histoire: !this.isOpen() } }) },
      h("span", { html: svgIcon(ICONS.story, 16) }),
      h("strong", null, "Séquence"),
      this.count
    );
    this.root = h(
      "section",
      { class: "story-strip", "data-testid": "story-strip" },
      h("header", { class: "story-bar" }, toggle, this.titleInp, this.statusEl),
      h(
        "div",
        { class: "story-actions" },
        h("div", { class: "story-row" }, this.saveBtn, openBtn, resetBtn, h("button", { class: "btn btn-small btn-accent", "data-testid": "snapshot", title: "Ajouter le graphique courant à la séquence", onclick: () => this.actions.snapshot() }, "📸 Ajouter la scène"), this.orderBtn, this.filmBtn),
        h("div", { class: "story-row" }, this.readBtn, this.reelBtn, this.cadBtn)
      ),
      this.list
    );
  }

  /** Option d'export « Transitions Morph ». */
  get morph(): boolean {
    return this.morphBox.checked;
  }

  setMorph(on: boolean): void {
    this.morphBox.checked = on;
    try {
      localStorage.setItem(MORPH_PREF, on ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
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
      ? "Mini-film de 15 à 30 s pour Instagram, TikTok ou LinkedIn (MP4) : une scène par plan, titres courts, chiffres qui comptent, carte de fin avec QR"
      : "Séquence vide : essayez le Reel d'exemple sur données publiques (énergies renouvelables, Eurostat, CC BY 4.0)";
    this.readBtn.disabled = !st.snapshots.length;
    this.cadBtn.disabled = !st.snapshots.length;
    this.sameScale.checked = !!st.sameScale;
    const status = this.actions.status?.() ?? { name: null, savedAt: null, dirty: false, scenes: new Map<string, SceneState>() };
    this.statusEl.className = `seq-status${status.dirty ? " dirty" : status.savedAt ? " saved" : ""}`;
    this.statusEl.textContent = status.savedAt ? (status.dirty ? `Modifications non enregistrées · enregistrée à ${status.savedAt}` : `Enregistrée sur cet appareil · ${status.savedAt}`) : status.dirty ? "Non enregistrée" : "";
    this.statusEl.title = status.name ? `Projet « ${status.name} »` : "Projet pas encore enregistré";
    this.saveBtn.classList.toggle("pending", status.dirty);
    this.revertIt.disabled = !status.savedAt || !status.dirty;
    const scales = this.actions.scales?.() ?? new Map<string, ScaleInfo>();
    this.sameScaleLabel.classList.toggle("dim", scales.size === 0);
    const key = JSON.stringify([open, !!st.sameScale, !!status.savedAt, st.snapshots.map((s) => [s.id, s.name, s.role, !!s.thumb, s.thumb?.length ?? 0, scales.get(s.id)?.differs ?? null, status.scenes.get(s.id) ?? null])]);
    if (key === this.key) return;
    this.key = key;
    if (!st.snapshots.length) {
      this.list.replaceChildren(h("p", { class: "story-empty" }, "Aucune scène : cliquez « 📸 Ajouter la scène » pour ajouter le graphique courant, puis ordonnez votre récit. « Créer un Reel » propose un exemple sur données publiques (Eurostat)."));
      return;
    }
    this.list.replaceChildren(...st.snapshots.map((s, i) => this.card(s, i, scales.get(s.id), !!st.sameScale, status.scenes.get(s.id) ?? null, !!status.savedAt)));
  }

  private patch(id: string, p: Partial<Snapshot>): void {
    const st = this.store.state.story;
    this.store.setStory({ ...st, snapshots: st.snapshots.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }

  private card(s: Snapshot, i: number, scale: ScaleInfo | undefined, same: boolean, state: SceneState | null, saved: boolean): HTMLElement {
    const name = h("input", { type: "text", class: "story-card-name", value: s.name, maxlength: "200", title: "Renommer la scène", "data-testid": "story-card-name" });
    name.addEventListener("change", () => this.patch(s.id, { name: name.value.trim() || s.title || `Scène ${i + 1}` }));
    name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur());
    const role = h("select", { class: `story-role role-${s.role}`, title: "Rôle dans le récit", "data-testid": "story-card-role" }, ...NARRATIVE_ROLES.map((r) => h("option", { value: r, selected: r === s.role }, ROLE_LABELS[r])));
    role.addEventListener("change", () => this.patch(s.id, { role: role.value as NarrativeRole }));
    const del = h("button", { class: "icon-btn story-del", title: "Supprimer la scène", "aria-label": "Supprimer la scène", "data-testid": "story-card-delete", html: svgIcon(ICONS.trash, 15), onclick: () => this.store.setStory({ ...this.store.state.story, snapshots: this.store.state.story.snapshots.filter((x) => x.id !== s.id) }) });
    const dup = this.actions.duplicateFocus
      ? h("button", { class: "icon-btn story-focus", title: "Dupliquer et mettre en avant : copie juste après cette scène, un élément en avant et son commentaire (transition animée)", "aria-label": "Dupliquer et mettre en avant", "data-testid": "story-card-focus", html: svgIcon(ICONS.focus, 15), onclick: () => this.actions.duplicateFocus?.(s) })
      : null;
    const canReset = state === "modified";
    const reset = this.actions.resetScene
      ? h("button", {
          class: "icon-btn story-reset",
          title: canReset ? "↺ Réinitialiser la scène : revenir à son état du dernier enregistrement" : state === "new" ? "Scène ajoutée depuis le dernier enregistrement : rien à réinitialiser" : saved ? "Scène identique au dernier enregistrement" : "Enregistrez le projet pour pouvoir réinitialiser une scène",
          "aria-label": "Réinitialiser la scène",
          "data-testid": "story-card-reset",
          disabled: !canReset,
          html: svgIcon(ICONS.restart, 15),
          onclick: () => this.actions.resetScene?.(s.id),
        })
      : null;
    const badge = saved && state && state !== "saved" ? h("span", { class: `story-state ${state}`, "data-testid": "story-card-modified", "data-state": state, title: state === "new" ? "Ajoutée depuis le dernier enregistrement" : "Modifiée depuis le dernier enregistrement" }, state === "new" ? "nouvelle" : "modifiée") : null;
    const thumb = h("button", { class: "story-thumb", title: "Recharger cette scène dans l'éditeur", "data-testid": "story-card-open", onclick: () => this.actions.open(s) }, s.thumb ? h("img", { src: s.thumb, alt: s.title, draggable: "false" }) : h("span", { class: "muted" }, s.title.slice(0, 60)));
    const card = h(
      "article",
      { class: `story-card${state === "modified" ? " modified" : ""}`, draggable: "true", "data-testid": "story-card", "data-id": s.id, "data-index": String(i), "data-state": state ?? "" },
      h("span", { class: "story-num" }, String(i + 1)),
      badge,
      thumb,
      scale ? this.scaleBadge(scale, same) : null,
      h("div", { class: "story-card-foot" }, role, dup, reset, del),
      name
    );
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
      { class: `story-scale ${eq ? "eq" : "ne"}`, "data-testid": "story-scale", title: eq ? `Même échelle que les ${sc.size - 1} autre(s) graphique(s) de même mesure` : `Échelle différente des ${sc.size - 1} autre(s) graphique(s) de même mesure — cochez « Même échelle » (carte Export)` },
      eq ? "= échelle" : "≠ échelle"
    );
  }

  /** Déplace une scène (aussi utilisé par l'API de test). */
  move(from: number, to: number): void {
    const st = this.store.state.story;
    this.store.setStory({ ...st, snapshots: moveSnapshot(st.snapshots, from, to) });
  }
}
