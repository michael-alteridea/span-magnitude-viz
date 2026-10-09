/**
 * Repère « où suis-je ? » au-dessus du graphique (calque HTML, jamais exporté) :
 *  - exploration libre : « Exploration libre · rien n'est enregistré » + « Ajouter la scène », cadre neutre ;
 *  - scène de la Séquence ouverte : « Scène N de la Séquence · en modification » + Annuler / Valider, cadre orange ;
 *  - scène du Reel (« Modifier le graphique ») : « Scène N du Reel · en modification » + Annuler / Valider, cadre orange.
 * Le cadre est posé par la classe `scene-edit` / `scene-explore` de la zone du graphique (`.stage-wrap`).
 */
import { h, svgIcon, ICONS } from "./dom";

export type SceneMode =
  | { kind: "explore" }
  | { kind: "scene"; n: number; name: string }
  | { kind: "reel"; n: number };

export interface SceneBannerActions {
  add(): void;
  validate(): void;
  cancel(): void;
  reelValidate(): void;
  reelCancel(): void;
}

export class SceneBanner {
  readonly root: HTMLElement;
  /** Partie Reel : garde les repères de test historiques (`reel-edit-bar`, `-label`, `-cancel`, `-validate`). */
  readonly reelPart: HTMLElement;
  private explore: HTMLElement;
  private scene: HTMLElement;
  private sceneLabel: HTMLElement;
  private sceneName: HTMLElement;
  readonly reelLabel: HTMLElement;
  private frameHost: HTMLElement;
  mode: SceneMode = { kind: "explore" };

  constructor(frameHost: HTMLElement, a: SceneBannerActions) {
    this.frameHost = frameHost;
    this.explore = h(
      "div",
      { class: "sb-row", "data-testid": "scene-banner-explore" },
      h("span", { class: "sb-dot", "aria-hidden": "true" }),
      h("span", { class: "sb-text" }, h("b", null, "Exploration libre"), h("span", { class: "sb-sub" }, " · rien n'est enregistré")),
      h("button", { type: "button", class: "btn btn-small btn-accent sb-btn", "data-testid": "scene-banner-add", title: "Ajouter le graphique courant à la Séquence", onclick: () => a.add() }, h("span", { html: svgIcon(ICONS.camera, 14) }), "Ajouter la scène")
    );
    this.sceneLabel = h("b", { "data-testid": "scene-banner-label" });
    this.sceneName = h("span", { class: "sb-sub sb-name" });
    this.scene = h(
      "div",
      { class: "sb-row", "data-testid": "scene-banner-edit", hidden: true },
      h("span", { class: "sb-ic", html: svgIcon(ICONS.edit, 15) }),
      h("span", { class: "sb-text" }, this.sceneLabel, this.sceneName),
      h("button", { type: "button", class: "btn btn-small sb-btn", "data-testid": "scene-banner-cancel", title: "Revenir à l'exploration sans changer la scène", onclick: () => a.cancel() }, "Annuler"),
      h("button", { type: "button", class: "btn btn-small sb-btn sb-ok", "data-testid": "scene-banner-validate", title: "Remplacer la scène par le graphique courant (même place)", onclick: () => a.validate() }, h("span", { html: svgIcon(ICONS.check, 14) }), "Valider")
    );
    this.reelLabel = h("b", { class: "reel-edit-label", "data-testid": "reel-edit-label" });
    this.reelPart = h(
      "div",
      { class: "sb-row sb-reel", role: "region", "aria-label": "Modification d'une scène du Reel", "data-testid": "reel-edit-bar", hidden: true },
      h("span", { class: "sb-ic", html: svgIcon(ICONS.reel, 15) }),
      h("span", { class: "sb-text" }, this.reelLabel, h("span", { class: "sb-sub sb-hint" }, " · tout l'éditeur est disponible")),
      h("button", { class: "btn btn-small sb-btn", type: "button", "data-testid": "reel-edit-cancel", onclick: () => a.reelCancel() }, "Annuler"),
      h("button", { class: "btn btn-small sb-btn sb-ok", type: "button", "data-testid": "reel-edit-validate", onclick: () => a.reelValidate() }, h("span", { html: svgIcon(ICONS.check, 14) }), "Valider")
    );
    this.root = h("div", { class: "scene-banner", role: "status", "aria-live": "polite", "data-testid": "scene-banner", "data-mode": "explore" }, this.explore, this.scene, this.reelPart);
    this.set({ kind: "explore" });
  }

  set(m: SceneMode): void {
    this.mode = m;
    this.root.dataset.mode = m.kind;
    this.explore.hidden = m.kind !== "explore";
    this.scene.hidden = m.kind !== "scene";
    this.reelPart.hidden = m.kind !== "reel";
    if (m.kind === "scene") {
      // « de la Séquence » s'efface sur iPad étroit : « Scène N · en modification » reste lisible en entier
      this.sceneLabel.replaceChildren(`Scène ${m.n}`, h("span", { class: "sb-long" }, " de la Séquence"), " · en modification");
      this.sceneName.textContent = m.name ? ` · « ${m.name} »` : "";
    }
    if (m.kind === "reel") this.reelLabel.textContent = `Scène ${m.n} du Reel · en modification`;
    this.frameHost.classList.toggle("scene-edit", m.kind !== "explore");
    this.frameHost.classList.toggle("scene-explore", m.kind === "explore");
  }
}
