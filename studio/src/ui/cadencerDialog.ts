/**
 * Fenêtre « Envoyer vers Cadencer » (revues et histoire du Studio).
 *
 * Cadencer anime la réunion (salle en direct, QR /join, accusés de lecture, tâches, PV) ; Datanime fournit les
 * snapshots. V1 en tirage, sans secret partagé : Cadencer importe par URL le « manifeste de revue » publié.
 *  - revue / démo publiée : URL du manifeste (copier) + marche à suivre dans Cadencer ;
 *  - histoire ou revue locale : « Télécharger le manifeste » (même JSON, images intégrées en data:).
 */
import { h } from "./dom";
import { ic } from "../review/view";

export interface CadencerTarget {
  /** Histoire à télécharger (revue, histoire courante, démo). */
  storyId: string;
  title: string;
  count: number;
  /** URL du manifeste publié, null pour une histoire locale. */
  manifestUrl: string | null;
  /** Lien du mode lecture (même appareil pour une histoire locale). */
  readUrl: string | null;
  /** Remarque affichée sous l'URL (version publiée = démonstration d'origine, démo partielle…). */
  note?: string | null;
}

export interface CadencerActions {
  download(storyId: string): Promise<void>;
  copy(text: string, label: string): void;
}

export const CADENCER_STEPS = ["Ordre du jour › Ajouter › Revue Datanime", "Coller l'URL du manifeste", "Un point d'ordre du jour par snapshot : image, titre, commentaire, lien de lecture"];
export const LOCAL_PUBLISH_NOTE = "Les histoires personnelles restent sur cet appareil : leur publication en ligne arrive avec l'enregistrement en ligne. En attendant, le manifeste téléchargé a le même format, images intégrées (12 Mo au plus) ; les liens de lecture de cet appareil n'y figurent pas.";

export class CadencerDialog {
  readonly root: HTMLElement;
  private target: CadencerTarget | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
  };

  constructor(private actions: CadencerActions) {
    this.root = h("div", { class: "rv-overlay cad-overlay", hidden: true, "data-testid": "cadencer-dialog", onclick: (e: Event) => e.target === this.root && this.close() });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(t: CadencerTarget): void {
    this.target = t;
    this.render();
    this.root.hidden = false;
    document.addEventListener("keydown", this.onKey);
    this.root.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    document.removeEventListener("keydown", this.onKey);
  }

  private render(): void {
    const t = this.target!;
    const published = !!t.manifestUrl;
    const dlBtn = (accent: boolean) => {
      const b = h("button", { class: `btn${accent ? " btn-accent" : ""}`, type: "button", "data-testid": "cad-download", ...(accent ? { "data-autofocus": "" } : {}) }, ic("download", 14), "Télécharger le manifeste") as HTMLButtonElement;
      b.addEventListener("click", () => {
        const label = b.innerHTML;
        b.disabled = true;
        b.textContent = "Préparation des images…";
        void this.actions.download(t.storyId).finally(() => {
          b.disabled = false;
          b.innerHTML = label;
        });
      });
      return b;
    };
    const steps = h("ol", { class: "cad-steps" }, ...CADENCER_STEPS.map((s, i) => h("li", null, h("span", { class: "rv-num" }, String(i + 1)), h("span", null, s))));
    const body = published
      ? h(
          "div",
          { class: "cad-body" },
          h("h4", null, "MANIFESTE PUBLIÉ"),
          h(
            "div",
            { class: "rv-linkbox cad-linkbox" },
            ic("link", 15),
            h("code", { "data-testid": "cad-url", title: t.manifestUrl! }, t.manifestUrl!),
            h("button", { class: "btn btn-accent", type: "button", "data-testid": "cad-copy", "data-autofocus": "", onclick: () => this.actions.copy(t.manifestUrl!, "URL du manifeste copiée") }, ic("copy", 14), "Copier")
          ),
          t.note ? h("p", { class: "rv-hint cad-note", "data-testid": "cad-note" }, t.note) : null,
          h("h4", null, "DANS CADENCER"),
          steps,
          h("p", { class: "cad-instr", "data-testid": "cad-instr" }, "Dans Cadencer : ordre du jour › Ajouter › Revue Datanime › coller l'URL"),
          h("p", { class: "rv-hint" }, `${t.count} snapshot${t.count > 1 ? "s" : ""} · images PNG 1600 × 900 avec cartouche · un lien de lecture par snapshot · JSON public, sans compte ni secret partagé`)
        )
      : h(
          "div",
          { class: "cad-body" },
          h("h4", null, "HISTOIRE LOCALE"),
          h("p", null, `« ${t.title} » (${t.count} snapshot${t.count > 1 ? "s" : ""}) n'est pas publiée en ligne.`),
          h("div", { class: "cad-row" }, dlBtn(true)),
          h("p", { class: "rv-local-note", "data-testid": "cad-local-note" }, ic("link", 14), LOCAL_PUBLISH_NOTE),
          t.note ? h("p", { class: "rv-hint cad-note", "data-testid": "cad-note" }, t.note) : null,
          h("h4", null, "DANS CADENCER (REVUES PUBLIÉES)"),
          steps
        );
    this.root.replaceChildren(
      h(
        "div",
        { class: "rv-dialog cad-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Envoyer vers Cadencer" },
        h(
          "header",
          { class: "rv-dialog-head" },
          ic("send", 20),
          h("div", null, h("h2", null, "Envoyer vers Cadencer"), h("small", null, `Cadencer anime la réunion (salle en direct, QR, accusés de lecture, tâches, PV) ; Datanime fournit les snapshots de « ${t.title} ».`)),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Fermer", onclick: () => this.close() }, "×")
        ),
        body,
        h(
          "footer",
          { class: "rv-dialog-foot" },
          published ? h("a", { class: "btn btn-ghost", href: t.manifestUrl!, target: "_blank", rel: "noopener", "data-testid": "cad-open-json" }, "Voir le JSON") : null,
          t.readUrl ? h("a", { class: "btn btn-ghost cad-read", href: t.readUrl, "data-testid": "cad-read", onclick: () => this.close() }, ic("book", 14), "Mode lecture") : null,
          h("span", { class: "rv-spacer" }),
          published ? dlBtn(false) : null,
          h("button", { class: "btn", type: "button", "data-testid": "cad-close", onclick: () => this.close() }, "Fermer")
        )
      )
    );
  }
}
