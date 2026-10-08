/**
 * « Explorer mes données » : panneau superposé à l'aperçu et aux réglages qui propose 5 à 8 pistes classées
 * (mini-graphique lisible, titre calculé, pourquoi c'est important, « Ouvrir »). Détection déterministe.
 */
import type { Store } from "../state";
import type { Dataset } from "../data/table";
import { explore, KIND_LABELS, type Insight, type StoryContext } from "../story/insights";
import { ROLE_LABELS } from "../story/snapshots";
import { miniThumbnail } from "./miniCharts";
import { h, svgIcon, ICONS } from "./dom";
import { setMiniNorme } from "./miniBase";
import { effectiveDataset } from "../data/transform";
import { normeAdvice, normeSubtitle, specScenarios } from "../norme";
import type { ChartSpec } from "../spec";

export class Explorer {
  readonly root: HTMLElement;
  private grid: HTMLElement;
  private sub: HTMLElement;
  private insights: Insight[] = [];
  isOpen = false;

  constructor(private store: Store, private ctx: () => StoryContext, private onOpenInsight: (ins: Insight) => void) {
    this.grid = h("div", { class: "explorer-grid", "data-testid": "explorer-grid" });
    this.sub = h("p", { class: "explorer-sub" });
    this.root = h(
      "section",
      { class: "explorer hidden", "data-testid": "explorer", role: "dialog", "aria-label": "Explorer mes données" },
      h(
        "header",
        { class: "explorer-head" },
        h("div", null, h("h2", null, h("span", { html: svgIcon(ICONS.explore, 20) }), "Explorer mes données"), this.sub),
        h("button", { class: "icon-btn", title: "Fermer (Échap)", "data-testid": "explorer-close", html: svgIcon(ICONS.close, 18), onclick: () => this.close() })
      ),
      this.grid
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    const { ds } = this.store.state;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    if (!ds || !ds.rows.length) {
      this.sub.textContent = "Chargez des données (fichier, collage ou exemple) pour obtenir des pistes.";
      this.grid.replaceChildren();
      return;
    }
    const t0 = performance.now();
    const norme = this.store.state.spec.norme;
    setMiniNorme(norme.enabled);
    this.root.classList.toggle("norme-on", norme.enabled);
    this.insights = explore(ds, this.ctx(), { min: 5, max: 8 });
    // Mode norme : pistes « camembert / arcs » remplacées par des barres, orientation temps / structure
    if (norme.enabled) this.insights = this.insights.map((ins) => ({ ...ins, spec: normeSpec({ ...ins.spec, norme }, ds) }));
    const ms = Math.round(performance.now() - t0);
    this.sub.textContent = this.insights.length
      ? `${this.insights.length} pistes calculées sur ${ds.rows.length.toLocaleString("fr-FR")} lignes de « ${ds.name} », classées par force du constat (${ms} ms).`
      : "Aucune piste nette : essayez d'ajouter une date, une mesure ou des catégories.";
    this.grid.replaceChildren(...this.insights.map((ins, i) => this.card(ins, i, ds)));
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
  }

  /** Sous-titre structuré qui · quoi · quand (mode norme). */
  private ibcsLine(ins: Insight, ds: Dataset): string {
    try {
      const sc = this.ctx();
      const year = ins.spec.transform.filters.map((f) => f.label).find((l) => /^\d{4}$/.test(l)) ?? String(new Date(sc.today).getUTCFullYear());
      return normeSubtitle(ins.spec, { entity: sc.entity, period: year, scenarios: specScenarios(ins.spec, effectiveDataset(ins.spec, ds)) });
    } catch {
      return "";
    }
  }

  private card(ins: Insight, i: number, ds: Dataset): HTMLElement {
    let thumb: Node;
    try {
      thumb = miniThumbnail(ins, ds);
    } catch {
      thumb = h("div", { class: "explorer-thumb-missing" }, "Aperçu indisponible");
    }
    const open = () => {
      this.onOpenInsight(ins);
      this.close();
    };
    return h(
      "article",
      { class: "explorer-card", "data-testid": "explorer-card", "data-kind": ins.kind, style: `animation-delay:${i * 40}ms` },
      h("button", { class: "explorer-thumb", title: "Ouvrir ce graphique", onclick: open }, thumb),
      h(
        "div",
        { class: "explorer-meta" },
        h("span", { class: "explorer-kind" }, KIND_LABELS[ins.kind]),
        h("span", { class: `explorer-role role-${ins.analysis.role}` }, ROLE_LABELS[ins.analysis.role]),
        h("span", { class: "explorer-score", title: `Force ${Math.round(ins.effect * 100)} % · couverture ${Math.round(ins.coverage * 100)} %` }, "●".repeat(Math.max(1, Math.round(ins.score * 5))))
      ),
      h("h3", { class: "explorer-title" }, ins.analysis.title),
      ins.spec.norme?.enabled ? h("p", { class: "explorer-ibcs", "data-testid": "explorer-ibcs" }, this.ibcsLine(ins, ds)) : null,
      h("p", { class: "explorer-why" }, ins.analysis.why),
      h("button", { class: "btn btn-accent explorer-open", "data-testid": "explorer-open", onclick: open }, "Ouvrir")
    );
  }
}

/** Applique les bascules du mode norme à une piste (types déconseillés, orientation). */
function normeSpec(spec: ChartSpec, ds: Dataset): ChartSpec {
  let out = spec;
  for (let k = 0; k < 2; k++) {
    const adv = normeAdvice({ ...out, norme: { ...out.norme, autoSwitch: true } }, effectiveDataset(out, ds));
    if (!adv || (!adv.patch.type && !adv.patch.style)) break;
    out = { ...out, type: adv.patch.type ?? out.type, style: { ...out.style, ...(adv.patch.style ?? {}) } };
  }
  return out;
}
