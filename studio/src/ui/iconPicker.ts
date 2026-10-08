/**
 * Choix d'une icône (Graphique › Plus d'options › Icône par catégorie) : liste déroulante illustrée — chaque
 * entrée montre le pictogramme Phosphor dessiné à côté de son libellé (une liste <select> native ne peut afficher
 * que du texte). Fenêtre unique réutilisée, position fixe, recherche, clavier (↑ ↓ Entrée Échap).
 */
import { iconChoices, iconSvg, ICON_LABELS } from "../charts/icons";
import { h } from "./dom";

/** Valeur choisie : « @auto » (d'après le nom), « » (aucune) ou nom d'icône Phosphor. */
export type IconPick = string;

export interface IconPickOptions {
  category: string;
  /** Icône forcée (undefined : automatique ; « » : aucune). */
  current: string | undefined;
  /** Icône trouvée automatiquement d'après le nom (null : aucune). */
  auto: string | null;
  onPick(v: IconPick): void;
}

/** Libellé et pictogramme du bouton d'une catégorie. */
export function iconPickLabel(current: string | undefined, auto: string | null): { icon: string | null; label: string; isAuto: boolean } {
  if (current === undefined) return { icon: auto, label: auto ? ICON_LABELS[auto] ?? auto : "Aucune", isAuto: true };
  if (current === "") return { icon: null, label: "Aucune", isAuto: false };
  return { icon: current, label: ICON_LABELS[current] ?? current, isAuto: false };
}

let pop: HTMLElement | null = null;
let list: HTMLElement;
let search: HTMLInputElement;
let anchorEl: HTMLElement | null = null;
let opts: IconPickOptions | null = null;

function rows(): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>(".ip-it:not([hidden])")];
}

function close(focus = false): void {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  anchorEl?.setAttribute("aria-expanded", "false");
  if (focus) anchorEl?.focus();
  anchorEl = null;
  opts = null;
}

function ensure(): void {
  if (pop) return;
  search = h("input", { type: "search", class: "ip-search", placeholder: "Rechercher une icône…", "aria-label": "Rechercher une icône", "data-testid": "icon-pick-search" }) as HTMLInputElement;
  list = h("div", { class: "ip-list", role: "listbox", "aria-label": "Icônes" });
  pop = h("div", { class: "icon-pick-pop", hidden: true, "data-testid": "icon-pick-pop" }, h("div", { class: "ip-head" }, h("strong", { class: "ip-cat" }), search), list);
  document.body.append(pop);
  search.addEventListener("input", () => {
    const q = search.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    for (const b of list.querySelectorAll<HTMLButtonElement>(".ip-it")) b.hidden = !!q && !(b.dataset.q ?? "").includes(q);
  });
  pop.addEventListener("keydown", (e) => {
    const r = rows();
    const i = r.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = r.length;
      if (!n) return;
      r[i < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (pop && !pop.hidden && !pop.contains(t) && !anchorEl?.contains(t)) close();
  });
  window.addEventListener("resize", () => close());
}

function item(value: IconPick, icon: string | null, label: string, selected: boolean, dim = false): HTMLButtonElement {
  const q = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() + " " + (icon ?? "");
  return h(
    "button",
    { type: "button", class: `ip-it${selected ? " on" : ""}${dim ? " dim" : ""}`, role: "option", "aria-selected": selected ? "true" : "false", "data-icon": value, "data-q": q, onclick: () => { const o = opts; close(true); o?.onPick(value); } },
    h("span", { class: "ip-ic", html: icon ? iconSvg(icon, 22) : "" }),
    h("span", { class: "ip-l" }, label)
  ) as HTMLButtonElement;
}

/** Ouvre la liste illustrée sous `anchor`. */
export function openIconPicker(anchor: HTMLElement, o: IconPickOptions): void {
  ensure();
  if (anchorEl === anchor && !pop!.hidden) return close();
  anchorEl = anchor;
  opts = o;
  anchor.setAttribute("aria-expanded", "true");
  (pop!.querySelector(".ip-cat") as HTMLElement).textContent = `Icône pour « ${o.category} »`;
  search.value = "";
  const autoLabel = o.auto ? `Auto · ${ICON_LABELS[o.auto] ?? o.auto}` : "Auto · aucune icône trouvée";
  list.replaceChildren(
    item("@auto", o.auto, autoLabel, o.current === undefined),
    item("", "minus", "Aucune", o.current === "", true),
    h("div", { class: "ip-sep", role: "separator" }),
    ...iconChoices().map(([n, l]) => item(n, n, l, o.current === n))
  );
  pop!.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 16);
  pop!.style.width = `${w}px`;
  const maxH = Math.min(380, window.innerHeight - 24);
  pop!.style.maxHeight = `${maxH}px`;
  const below = window.innerHeight - r.bottom - 10;
  const top = below >= Math.min(maxH, 260) ? r.bottom + 6 : Math.max(8, r.top - 6 - Math.min(maxH, pop!.offsetHeight));
  pop!.style.top = `${Math.round(top)}px`;
  pop!.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
  const sel = list.querySelector<HTMLElement>(".ip-it.on");
  sel?.scrollIntoView({ block: "nearest" });
  (sel ?? search).focus({ preventScroll: true });
}

export function closeIconPicker(): void {
  close();
}
