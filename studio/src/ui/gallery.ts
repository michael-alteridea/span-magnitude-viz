/**
 * Bande des types de graphiques (au-dessus de l'aperçu) — variante B « Deux niveaux calmes ».
 * Une seule ligne de 46 px : pictogrammes 19 px (cibles 34 px), filet de 1 px entre familles,
 * libellé uniquement sur le type sélectionné, info-bulle au survol, débordement dans « Plus +n ▾ ».
 */
import type { Store } from "../state";
import { CHART_FAMILIES, CHART_TYPE_LABELS, type ChartType } from "../spec";
import { h, svgIcon, ICONS } from "./dom";
import { DISCOURAGED_TIP, isDiscouraged } from "../norme";

export const SHORT: Record<ChartType, string> = {
  bar: "Barres",
  barH: "Horizontales",
  groupedBar: "Groupées",
  stackedBar: "Empilées",
  line: "Lignes",
  area: "Aires",
  stackedArea: "Aires empilées",
  scatter: "Points",
  pie: "Camembert",
  donut: "Donut",
  radialBar: "Arcs radiaux",
  variance: "Écarts",
  film: "Film 4D",
  map: "Carte",
  drill: "Zoom",
  race: "Course",
};

/**
 * Ordre de remplissage de la bande : les types courants d'abord, les spéciaux en dernier.
 * À 1366 px : Zoom | 4 barres | Lignes, Aires | Points | Camembert, Donut | Écarts | Carte (Plus = 3) ;
 * sous 1200 px : Barres, Horizontales, Groupées | Lignes, Aires | Points | Camembert (Plus = 8).
 * L'affichage, lui, suit toujours l'ordre des familles.
 */
export const STRIP_PRIORITY: ChartType[] = ["bar", "barH", "groupedBar", "line", "area", "scatter", "pie", "stackedBar", "drill", "donut", "variance", "map", "stackedArea", "radialBar", "film", "race"];

const ORDER: ChartType[] = CHART_FAMILIES.flatMap((f) => f.types);
const FAMILY = new Map<ChartType, number>(CHART_FAMILIES.flatMap((f, i) => f.types.map((t) => [t, i] as [ChartType, number])));
const GAP = 2;
const DIVIDER = 11; // 1 px + marges 5 px

/** Nombre maximal de pictogrammes visibles selon la largeur de fenêtre (maquette B : 12 dès 1200 px, 7 en dessous). */
export const stripMax = (viewport: number): number => (viewport >= 1200 ? 12 : 7);

/** Types visibles pour une largeur donnée (fonction pure, testée). */
export function stripVisible(avail: number, cur: ChartType, width: (t: ChartType) => number, moreWidth: number, maxCount = STRIP_PRIORITY.length): ChartType[] {
  const fits = (set: Set<ChartType>, withMore: boolean): boolean => {
    let w = 0;
    let prev: number | null = null;
    let n = 0;
    for (const t of ORDER) {
      if (!set.has(t)) continue;
      const fam = FAMILY.get(t) ?? 0;
      if (prev !== null) w += fam !== prev ? DIVIDER + 2 * GAP : GAP;
      w += width(t);
      prev = fam;
      n++;
    }
    if (withMore) w += (n ? 12 : 0) + moreWidth;
    return w <= avail;
  };
  for (let k = Math.min(maxCount, STRIP_PRIORITY.length); k >= 1; k--) {
    const pick = STRIP_PRIORITY.slice(0, k);
    if (!pick.includes(cur)) pick[pick.length - 1] = cur; // le type sélectionné reste toujours visible
    const set = new Set(pick);
    if (fits(set, k < STRIP_PRIORITY.length)) return ORDER.filter((t) => set.has(t));
  }
  return [cur];
}

export class Gallery {
  readonly root: HTMLElement;
  private btns = new Map<ChartType, HTMLButtonElement>();
  private dividers = new Map<number, HTMLElement>();
  private items = new Map<ChartType, HTMLButtonElement>();
  private moreBtn: HTMLButtonElement;
  private moreCount: HTMLElement;
  private menu: HTMLElement;
  private visible: ChartType[] = ORDER;

  constructor(private store: Store, private onPick: (t: ChartType) => void) {
    const children: HTMLElement[] = [];
    CHART_FAMILIES.forEach((f, i) => {
      if (i > 0) {
        const dv = h("span", { class: "type-dv", "aria-hidden": "true" });
        this.dividers.set(i, dv);
        children.push(dv);
      }
      for (const t of f.types) {
        const b = h(
          "button",
          { class: "type-tile", type: "button", "aria-label": CHART_TYPE_LABELS[t], "data-tip": CHART_TYPE_LABELS[t], "data-type": t, "data-testid": `type-${t}`, onclick: () => onPick(t) },
          h("span", { class: "tile-icon", html: svgIcon(ICONS[t], 19) }),
          h("span", { class: "tile-label" }, SHORT[t])
        ) as HTMLButtonElement;
        this.btns.set(t, b);
        children.push(b);
      }
    });
    this.moreCount = h("small", null, "");
    this.moreBtn = h(
      "button",
      { class: "type-more", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "data-testid": "type-more", title: "Autres types de graphiques", onclick: (e: Event) => { e.stopPropagation(); this.toggleMenu(); } },
      "Plus ",
      this.moreCount,
      h("span", { class: "type-more-chev", html: svgIcon(ICONS.chevronD, 13) })
    ) as HTMLButtonElement;
    this.menu = h(
      "div",
      { class: "type-menu", role: "menu", "aria-label": "Autres types de graphiques", "data-testid": "type-menu", hidden: true },
      h("div", { class: "type-menu-hd" }, "Autres types"),
      ...ORDER.map((t) => {
        const it = h(
          "button",
          { class: "type-menu-item", type: "button", role: "menuitem", "data-type": t, "data-testid": `type-menu-${t}`, onclick: () => { this.closeMenu(); onPick(t); } },
          h("span", { class: "tmi-ic", html: svgIcon(ICONS[t], 18) }),
          h("span", { class: "tmi-lbl" }, CHART_TYPE_LABELS[t])
        ) as HTMLButtonElement;
        this.items.set(t, it);
        return it;
      })
    );
    this.root = h("nav", { class: "gallery strip", "aria-label": "Type de graphique", "data-testid": "gallery" }, ...children, this.moreBtn, this.menu);

    document.addEventListener("pointerdown", (e) => {
      if (this.menu.hidden) return;
      const tg = e.target as Node;
      if (!this.menu.contains(tg) && !this.moreBtn.contains(tg)) this.closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.menu.hidden) { this.closeMenu(); this.moreBtn.focus(); }
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.layout()).observe(this.root);
    window.addEventListener("resize", () => this.layout());
  }

  /** Types actuellement visibles dans la bande (les autres sont dans « Plus »). */
  get visibleTypes(): ChartType[] {
    return [...this.visible];
  }

  private toggleMenu(): void {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  private openMenu(): void {
    this.menu.hidden = false;
    this.moreBtn.classList.add("open");
    this.moreBtn.setAttribute("aria-expanded", "true");
    (this.menu.querySelector(".type-menu-item:not([hidden])") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.moreBtn.classList.remove("open");
    this.moreBtn.setAttribute("aria-expanded", "false");
  }

  /** Remplit la bande selon la place disponible (le type sélectionné est toujours visible). */
  layout(): void {
    const avail = this.root.clientWidth;
    if (!avail) return;
    const cs = getComputedStyle(this.root);
    const inner = avail - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const cur = this.store.state.spec.type;
    // mesures réelles (tous visibles le temps de la mesure, sans repeindre)
    for (const b of this.btns.values()) b.hidden = false;
    this.moreBtn.hidden = false;
    const widths = new Map<ChartType, number>();
    for (const [t, b] of this.btns) widths.set(t, b.getBoundingClientRect().width || 34);
    const moreW = this.moreBtn.getBoundingClientRect().width || 80;
    const vis = stripVisible(inner - 1, cur, (t) => widths.get(t) ?? 34, Math.max(moreW, 84), stripMax(window.innerWidth));
    this.visible = vis;
    const set = new Set(vis);
    for (const [t, b] of this.btns) b.hidden = !set.has(t);
    for (const [t, it] of this.items) it.hidden = set.has(t);
    // filets : seulement entre deux familles visibles
    const famVis = new Set(vis.map((t) => FAMILY.get(t) ?? 0));
    const firstFam = Math.min(...famVis);
    for (const [i, dv] of this.dividers) dv.hidden = !(famVis.has(i) && i > firstFam);
    const rest = ORDER.length - vis.length;
    this.moreBtn.hidden = rest === 0;
    this.moreCount.textContent = `+${rest}`;
    this.moreBtn.setAttribute("aria-label", `Plus : ${rest} autre${rest > 1 ? "s" : ""} type${rest > 1 ? "s" : ""} de graphique`);
    if (rest === 0) this.closeMenu();
  }

  update(): void {
    const { type: cur, norme } = this.store.state.spec;
    const mark = (t: ChartType, b: HTMLButtonElement): void => {
      b.classList.toggle("active", t === cur);
      // Mode norme : camembert, donut, arcs radiaux déconseillés (le clic propose des barres)
      const off = norme.enabled && isDiscouraged(t);
      b.classList.toggle("disabled", off);
      if (off) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
      const tip = off ? `${CHART_TYPE_LABELS[t]} : ${DISCOURAGED_TIP}` : CHART_TYPE_LABELS[t];
      b.dataset.tip = tip;
      b.setAttribute("aria-label", tip);
    };
    for (const [t, b] of this.btns) {
      mark(t, b);
      b.setAttribute("aria-pressed", t === cur ? "true" : "false");
    }
    for (const [t, it] of this.items) mark(t, it);
    this.layout();
  }
}
