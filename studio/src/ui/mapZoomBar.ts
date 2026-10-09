/**
 * Carte : boutons de zoom de la vue (+, −, cadre entier), posés à droite de la carte dans l'aperçu.
 *
 * Le zoom est une vue seulement : il ne touche ni au spec, ni aux empreintes, ni aux liens profonds ;
 * exports et snapshots repassent au cadre entier (voir `Preview.fullFrame`). Les gestes (pincer, molette ou
 * trackpad au-dessus de la carte, glisser une fois zoomé) sont branchés par la bibliothèque (`mapZoom: true`) ;
 * pas de zoom au double-clic (réservé au saut vers l'élément de la sélection par touchers successifs).
 */
import type { MapZoom } from "span-magnitude-viz";
import { h } from "./dom";

/** Commandes de zoom exposées par la bibliothèque (poignée de la carte). */
export interface MapZoomHandle {
  getMapZoom(): MapZoom;
  zoomMapBy(factor: number): void;
  resetMapZoom(): void;
}

/** Facteur d'un clic sur + / −. */
export const ZOOM_STEP = 1.6;
export const ZOOM_MAX = 8;

const STROKE = `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

export function isIdentity(z: MapZoom): boolean {
  return z.k === 1 && z.x === 0 && z.y === 0;
}

export class MapZoomBar {
  readonly root: HTMLElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly reset: HTMLButtonElement;

  constructor(private handle: () => MapZoomHandle | null) {
    const btn = (testid: string, title: string, icon: string, fn: () => void) =>
      h("button", { class: "map-zoom-btn", type: "button", title, "aria-label": title, "data-testid": testid, html: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${icon}</svg>`, onclick: (e: Event) => (e.stopPropagation(), fn()) }) as HTMLButtonElement;
    this.zoomIn = btn("map-zoom-in", "Zoomer (aussi : pincer, molette ou trackpad sur la carte)", `<path d="M12 5v14M5 12h14" ${STROKE}/>`, () => this.handle()?.zoomMapBy(ZOOM_STEP));
    this.zoomOut = btn("map-zoom-out", "Dézoomer", `<path d="M5 12h14" ${STROKE}/>`, () => this.handle()?.zoomMapBy(1 / ZOOM_STEP));
    this.reset = btn("map-zoom-reset", "Cadre entier", `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" ${STROKE}/>`, () => this.handle()?.resetMapZoom());
    this.root = h("div", { class: "map-zoom", role: "group", "aria-label": "Zoom de la carte", "data-testid": "map-zoom", hidden: true }, this.zoomIn, this.zoomOut, this.reset);
    // un toucher sur les boutons ne remonte pas au fond de la scène (qui remonterait d'un niveau de sélection)
    this.root.addEventListener("click", (e) => e.stopPropagation());
    this.root.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  /** Visible sur une carte dessinée ; boutons actifs selon le zoom courant. */
  sync(visible: boolean): void {
    const hd = visible ? this.handle() : null;
    this.root.hidden = !hd;
    if (!hd) return;
    const z = hd.getMapZoom();
    this.zoomIn.disabled = z.k >= ZOOM_MAX - 1e-6;
    this.zoomOut.disabled = z.k <= 1 + 1e-6;
    this.reset.disabled = isIdentity(z);
    this.root.dataset.k = z.k.toFixed(2);
  }

  /** Position (pixels de la boîte de la scène) : bord droit de la carte, à mi-hauteur. */
  place(x: number, y: number): void {
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }
}
