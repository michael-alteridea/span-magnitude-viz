/**
 * Types spéciaux (carte, film de la bibliothèque) hors de l'aperçu : film de la Séquence, mode lecture.
 *
 * `renderChart` ne dessine que le cadre d'un type spécial (la zone `plot` est remplie par la bibliothèque,
 * montée à part dans l'aperçu). Ici, la bibliothèque est montée dans un hôte hors champ (mêmes options que
 * l'aperçu : fond, maille, cadrage, couleurs), puis son SVG est recopié dans la zone `plot` du SVG du graphique
 * (styles calculés en ligne, comme l'export) — le film montre donc la même carte que l'exploration.
 */
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { effectiveDataset } from "../data/transform";
import type { Theme } from "../theme";
import { fontStack } from "../theme";
import type { PlotRect } from "./context";
import type { SpecialMount } from "./special";
import { embedSpecial } from "../export";

const SVGNS = "http://www.w3.org/2000/svg";

type SpecialModule = typeof import("./special");
let mod: SpecialModule | null = null;
let loading: Promise<SpecialModule> | null = null;

/** Module de la bibliothèque (chargé à la demande, comme dans l'aperçu). */
export function specialModule(): SpecialModule | null {
  return mod;
}

export function loadSpecialModule(): Promise<SpecialModule> {
  if (mod) return Promise.resolve(mod);
  loading ??= import("./special").then((m) => (mod = m));
  return loading;
}

export class SpecialLayer {
  private host: HTMLElement | null = null;
  private mount: SpecialMount | null = null;
  private key = "";
  /** Rendu recopié pour une progression donnée (réutilisé tant qu'elle ne change pas). */
  private cached: { p: number; nodes: Element[] } | null = null;

  /**
   * Recopie la carte / le film à la progression `progress` (0…1) dans `target`, zone `plot`.
   * Retourne false si le module n'est pas encore chargé (appeler `loadSpecialModule()` puis redessiner).
   */
  paint(target: SVGSVGElement, spec: ChartSpec, ds: Dataset, plot: PlotRect, theme: Theme, progress: number): boolean {
    const m = mod;
    if (!m) return false;
    const key = JSON.stringify([spec.type, spec.encoding, spec.transform, spec.dataset ?? null, spec.special, spec.mode.kind, spec.mode.fourD.durationMs, spec.style.palette, spec.style.background, spec.style.backgroundCustom, theme.dark, Math.round(plot.w), Math.round(plot.h), ds.rows.length, ds.columns.length]);
    if (key !== this.key) {
      this.dispose();
      this.key = key;
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("data-testid", "special-frame-host");
      // hors champ mais mis en page (styles calculés et position des compteurs HTML)
      host.style.cssText = `position:fixed;left:-30000px;top:0;width:${plot.w}px;height:${plot.h}px;overflow:hidden;pointer-events:none;opacity:0`;
      document.body.append(host);
      this.host = host;
      this.mount = m.mountSpecial(host, spec, effectiveDataset(spec, ds), plot, theme, { animate: false });
    }
    const mount = this.mount!;
    if (mount.error || !mount.handle) {
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("class", "r4d-empty");
      t.setAttribute("x", String(plot.x + plot.w / 2));
      t.setAttribute("y", String(plot.y + plot.h / 2));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "16");
      t.setAttribute("fill", theme.muted);
      t.textContent = mount.error ?? "Encodage incomplet.";
      target.append(t);
      return true;
    }
    const p = mount.timeless ? 1 : Math.max(0, Math.min(1, progress));
    if (!this.cached || Math.abs(this.cached.p - p) > 1e-4) {
      mount.handle.setProgress(p);
      const tmp = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
      embedSpecial(tmp, this.host!, plot, fontStack(spec.style.font));
      this.cached = { p, nodes: [...tmp.children] };
    }
    for (const n of this.cached.nodes) target.append(n.cloneNode(true));
    return true;
  }

  dispose(): void {
    this.mount?.destroy();
    this.mount = null;
    this.host?.remove();
    this.host = null;
    this.key = "";
    this.cached = null;
  }
}
