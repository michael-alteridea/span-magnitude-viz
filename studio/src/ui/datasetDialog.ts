/**
 * « Modifier le dataset D1 « … » » quand des scènes l'utilisent (modèle « dataset d'abord », écran 5) :
 * anciennes → nouvelles pastilles, lignes avant → après, scènes concernées (vignettes, revue Cadencer signalée)
 * et trois choix :
 *  1. Mettre à jour les N scènes (chiffres, titres calculés et commentaires recalculés ; textes saisis gardés) ;
 *  2. Garder les scènes figées sur la version actuelle (la modification devient Dn v+1) ;
 *  3. Enregistrer plutôt comme nouveau dataset (Dk).
 * Résout le choix, ou null (Annuler, Échap, clic hors de la boîte).
 */
import type { FilterSpec } from "../spec";
import type { Snapshot } from "../story/snapshots";
import { chipGroups, chipText, rowsLabel, scenesLabel } from "../data/datasets";
import { h, svgIcon, ICONS } from "./dom";

export type DatasetChoice = "update" | "freeze" | "new";

export interface DatasetDialogOptions {
  id: string;
  name: string;
  version: number;
  before: FilterSpec[];
  after: FilterSpec[];
  rowsBefore: number;
  rowsAfter: number;
  /** Scènes qui utilisent ce dataset (avec leur numéro dans la séquence). */
  scenes: { snap: Snapshot; index: number }[];
  /** Identifiants de scènes déjà partagées dans une revue Cadencer. */
  shared: Set<string>;
  /** Identifiant du nouveau dataset proposé (choix 3). */
  nextId: string;
  /** Résumé de ce qui change (« + Distribution »). */
  delta: string;
  /** Date de la version actuelle (« 08/10/2026 22:41 »). */
  since: string;
}

function chips(filters: FilterSpec[]): HTMLElement {
  const g = chipGroups(filters);
  return h("span", { class: "dsd-chips" }, ...(g.length ? g.map((x) => h("span", { class: "ds-chip" }, `${x.field} : ${chipText(x)}`)) : [h("span", { class: "ds-chip ds-chip-none" }, "Sans filtre")]));
}

export function datasetChangeDialog(o: DatasetDialogOptions): Promise<DatasetChoice | null> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    let choice: DatasetChoice = "update";
    const n = o.scenes.length;
    const done = (v: DatasetChoice | null) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    const shared = o.scenes.filter((s) => o.shared.has(s.snap.id));
    const sharedTxt = shared.length ? ` ${shared.length > 1 ? `Les scènes ${shared.map((s) => s.index + 1).join(", ")} sont déjà partagées` : `La scène ${shared[0]!.index + 1} est déjà partagée`} dans une revue Cadencer.` : "";
    const diff = o.rowsAfter - o.rowsBefore;
    const okBtn = h("button", { type: "button", class: "btn btn-accent", "data-testid": "dsd-ok", onclick: () => done(choice) }) as HTMLButtonElement;
    const okLabel: Record<DatasetChoice, string> = { update: `Mettre à jour ${scenesLabel(n)}`, freeze: "Garder figées", new: `Créer ${o.nextId}` };
    const opts: { v: DatasetChoice; t: string; d: string }[] = [
      { v: "update", t: `Mettre à jour ${n > 1 ? `les ${scenesLabel(n)}` : "la scène"}`, d: `Chiffres, titres calculés et commentaires recalculés ; les textes écrits à la main sont gardés.${shared.length ? " Une nouvelle version est publiée : la revue Cadencer affichera « contenu mis à jour »." : ""}` },
      { v: "freeze", t: "Garder les scènes figées sur la version actuelle", d: `${n > 1 ? `Les ${scenesLabel(n)} restent` : "La scène reste"} sur ${o.id} du ${o.since} (${rowsLabel(o.rowsBefore)}). La modification devient ${o.id} v${o.version + 1}, à appliquer plus tard scène par scène.` },
      { v: "new", t: `Enregistrer plutôt comme nouveau dataset (${o.nextId})`, d: `${o.id} ne change pas ; ${o.nextId} = ${o.delta || "les nouveaux filtres"}.` },
    ];
    const radios = opts.map((x) => {
      const inp = h("input", { type: "radio", name: "dsd-choice", value: x.v, checked: x.v === choice, "data-testid": `dsd-${x.v}` }) as HTMLInputElement;
      inp.addEventListener("change", () => {
        if (!inp.checked) return;
        choice = x.v;
        paint();
      });
      return h("label", { class: "dsd-opt", "data-value": x.v }, inp, h("span", null, h("b", null, x.t), h("small", null, x.d)));
    });
    const paint = () => {
      radios.forEach((r) => r.classList.toggle("on", r.dataset.value === choice));
      okBtn.textContent = okLabel[choice];
    };
    const root = h(
      "div",
      { class: "cf-overlay dsd-overlay", "data-testid": "dataset-dialog", role: "presentation", onclick: (e: Event) => e.target === root && done(null) },
      h(
        "div",
        { class: "cf-box dsd-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsd-title" },
        h("h3", { id: "dsd-title" }, `Modifier le dataset ${o.id} « ${o.name} »`),
        h("p", { class: "dsd-diff" }, chips(o.before), h("span", { class: "dsd-arrow", "aria-hidden": "true" }, "→"), chips(o.after), h("span", { class: "dsd-rows" }, " · ", h("b", null, `${o.rowsBefore.toLocaleString("fr-FR")} → ${rowsLabel(o.rowsAfter)}`), diff ? h("small", null, ` (${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("fr-FR")})`) : null)),
        h("p", { class: "dsd-warn", "data-testid": "dsd-warn" }, h("span", { class: "dsd-warn-ic", html: svgIcon(ICONS.filter, 16) }), h("b", null, `${scenesLabel(n)} ${n > 1 ? "utilisent" : "utilise"} ce dataset.`), sharedTxt),
        h(
          "div",
          { class: "dsd-scenes" },
          ...o.scenes.slice(0, 6).map((s) =>
            h(
              "figure",
              { class: "dsd-scene", "data-id": s.snap.id },
              s.snap.thumb ? h("img", { src: s.snap.thumb, alt: "" }) : h("span", { class: "dsd-noimg" }),
              o.shared.has(s.snap.id) ? h("span", { class: "dsd-cad" }, "Cadencer") : null,
              h("figcaption", null, `${s.index + 1} · ${s.snap.title || s.snap.name}`)
            )
          ),
          ...(o.scenes.length > 6 ? [h("span", { class: "dsd-more" }, `+ ${o.scenes.length - 6}`)] : [])
        ),
        h("div", { class: "dsd-opts", role: "radiogroup", "aria-label": "Que faire des scènes ?" }, ...radios),
        h("div", { class: "cf-actions" }, h("button", { type: "button", class: "btn btn-ghost", "data-testid": "dsd-cancel", onclick: () => done(null) }, "Annuler"), okBtn)
      )
    );
    paint();
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    okBtn.focus();
  });
}
