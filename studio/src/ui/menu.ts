/**
 * Menu déroulant de la barre du haut (« Fichier », « Exporter ») : bouton + fenêtre flottante posée
 * sous le bouton (position fixe : la barre d'outils défile horizontalement sur iPad et couperait un menu absolu).
 * Clavier : Entrée / Espace / ↓ ouvrent, ↑ ↓ parcourent, Échap ferme et rend le focus au bouton.
 */
import { h } from "./dom";

export interface MenuHandle {
  button: HTMLButtonElement;
  pop: HTMLElement;
  open(): void;
  close(focus?: boolean): void;
  readonly isOpen: boolean;
}

const all = new Set<MenuHandle>();

export function makeMenu(button: HTMLButtonElement, items: Node[], o: { testid: string; label: string; align?: "left" | "right" }): MenuHandle {
  const pop = h("div", { class: "menu-pop", role: "menu", "aria-label": o.label, hidden: true, "data-testid": `${o.testid}-pop` }, ...items);
  document.body.append(pop);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("data-testid", o.testid);
  const focusables = () => [...pop.querySelectorAll<HTMLElement>(".menu-it:not(:disabled), .menu-row select, .menu-row input")];
  const place = () => {
    const r = button.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    const w = pop.offsetWidth;
    const left = o.align === "left" ? r.left : r.right - w;
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, left)))}px`;
  };
  const m: MenuHandle = {
    button,
    pop,
    get isOpen() {
      return !pop.hidden;
    },
    open() {
      for (const x of all) if (x !== m) x.close();
      pop.hidden = false;
      button.setAttribute("aria-expanded", "true");
      place();
    },
    close(focus = false) {
      if (pop.hidden) return;
      pop.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (focus) button.focus();
    },
  };
  all.add(m);
  button.addEventListener("click", () => (m.isOpen ? m.close() : m.open()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      m.open();
      focusables()[0]?.focus();
    }
  });
  pop.addEventListener("keydown", (e) => {
    const f = focusables();
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      m.close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if ((document.activeElement as HTMLElement)?.tagName === "SELECT") return;
      e.preventDefault();
      const n = f.length;
      f[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    }
  });
  // un choix d'action ferme le menu ; les réglages (liste, case) le laissent ouvert
  pop.addEventListener("click", (e) => {
    const it = (e.target as Element).closest(".menu-it");
    if (it && !(it as HTMLButtonElement).disabled && !it.hasAttribute("data-keep")) m.close();
  });
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (m.isOpen && !pop.contains(t) && !button.contains(t)) m.close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.isOpen && !pop.contains(e.target as Node)) {
      e.stopPropagation();
      m.close(true);
    }
  });
  window.addEventListener("resize", () => m.isOpen && place());
  return m;
}

/** Entrée de menu : icône, libellé, aide facultative. */
export function menuItem(icon: string, label: string, o: { testid?: string; hint?: string; onclick: (btn: HTMLButtonElement) => void; disabled?: boolean; title?: string; accent?: boolean; danger?: boolean }): HTMLButtonElement {
  const b: HTMLButtonElement = h(
    "button",
    { type: "button", class: `menu-it${o.accent ? " menu-it-accent" : ""}${o.danger ? " menu-it-danger" : ""}`, role: "menuitem", "data-testid": o.testid ?? null, disabled: !!o.disabled, title: o.title ?? null, onclick: () => o.onclick(b) },
    h("span", { class: "mi-ic", html: icon }),
    h("span", { class: "mi-t" }, h("span", { class: "mi-l" }, label), o.hint ? h("small", null, o.hint) : null)
  );
  return b;
}

export const menuSep = (): HTMLElement => h("div", { class: "menu-sep", role: "separator" });
export const menuHead = (t: string): HTMLElement => h("div", { class: "menu-h" }, t);
