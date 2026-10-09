/**
 * Nuancier : choix de couleur commun (couleur de série, d'élément, de libellé, de fond).
 *  - en ligne : les couleurs de la charte (pétrole) + un bouton « Nuancier » ;
 *  - fenêtre « Nuancier » : rangée « Couleurs de base » (couleurs franches, comme les couleurs standard d'un tableur), rangée Charte, rangée « Récentes » (8 dernières couleurs choisies, sur cet appareil),
 *    grille de 60 teintes (colonnes : rouges, oranges, jaunes, verts, turquoises, bleus, violets, roses, bruns, gris ;
 *    rangées : du clair au foncé), lien « Plus de couleurs… » vers le sélecteur complet du navigateur, rappel
 *    « rouge et vert réservés aux écarts » (mode norme).
 * Aucun code hexadécimal n'est affiché : chaque pastille porte un nom français (infobulle et aria-label).
 * Pastilles de 34 px (cibles tactiles iPad ≥ 32 px).
 */
import { h } from "./dom";

export type Swatch = [hex: string, name: string];

/** Colonnes du nuancier (du clair au foncé dans chaque colonne). */
export const NUANCIER: { hue: string; swatches: Swatch[] }[] = [
  { hue: "Rouges", swatches: [["#FECACA", "rouge poudré"], ["#FCA5A5", "rouge clair"], ["#F87171", "corail"], ["#DC2626", "rouge"], ["#B91C1C", "rouge carmin"], ["#7F1D1D", "bordeaux"]] },
  { hue: "Oranges", swatches: [["#FED7AA", "pêche"], ["#FDBA74", "abricot"], ["#FB923C", "orange clair"], ["#F97316", "orange"], ["#C2410C", "orange brûlé"], ["#7C2D12", "rouille"]] },
  { hue: "Jaunes", swatches: [["#FEF3C7", "jaune pâle"], ["#FDE68A", "jaune paille"], ["#FACC15", "jaune"], ["#EAB308", "jaune d'or"], ["#CA8A04", "moutarde"], ["#713F12", "ocre foncé"]] },
  { hue: "Verts", swatches: [["#D1FAE5", "vert d'eau"], ["#A7F3D0", "vert menthe"], ["#4ADE80", "vert clair"], ["#16A34A", "vert"], ["#15803D", "vert sapin"], ["#14532D", "vert forêt"]] },
  { hue: "Turquoises", swatches: [["#CCFBF1", "turquoise pâle"], ["#99F6E4", "lagon"], ["#2DD4BF", "turquoise"], ["#14B8A6", "turquoise vif"], ["#0F766E", "sarcelle"], ["#134E4A", "bleu canard"]] },
  { hue: "Bleus", swatches: [["#DBEAFE", "bleu pâle"], ["#93C5FD", "bleu ciel"], ["#60A5FA", "bleu clair"], ["#2563EB", "bleu"], ["#1D4ED8", "bleu roi"], ["#1E3A8A", "bleu nuit"]] },
  { hue: "Violets", swatches: [["#EDE9FE", "lavande pâle"], ["#C4B5FD", "lavande"], ["#A78BFA", "violet clair"], ["#7C3AED", "violet"], ["#6D28D9", "améthyste"], ["#4C1D95", "violet profond"]] },
  { hue: "Roses", swatches: [["#FCE7F3", "rose pâle"], ["#F9A8D4", "rose dragée"], ["#F472B6", "rose"], ["#EC4899", "rose vif"], ["#BE185D", "framboise"], ["#831843", "prune"]] },
  { hue: "Bruns", swatches: [["#F5E6D3", "lin"], ["#E7C9A9", "sable"], ["#C8A27C", "caramel clair"], ["#A47148", "caramel"], ["#7C4A2D", "noisette"], ["#4A2C1A", "chocolat"]] },
  { hue: "Gris", swatches: [["#FFFFFF", "blanc"], ["#E4E4E7", "gris perle"], ["#A1A1AA", "gris"], ["#71717A", "gris moyen"], ["#3F3F46", "anthracite"], ["#18181B", "noir"]] },
];

/** Couleurs de base (franches, à la manière des couleurs standard d'un tableur) : première rangée du nuancier. */
export const BASE: Swatch[] = [
  ["#FF0000", "vrai rouge"],
  ["#FFC000", "orange"],
  ["#FFFF00", "jaune"],
  ["#00B050", "vert"],
  ["#92D050", "vert clair"],
  ["#00B0F0", "bleu clair"],
  ["#0070C0", "bleu"],
  ["#002060", "bleu foncé"],
  ["#7030A0", "violet"],
  ["#000000", "noir"],
  ["#FFFFFF", "blanc"],
  ["#808080", "gris"],
];

/** Couleurs de la charte (pétrole) et neutres : rangée « Charte », la première. */
export const CHARTE: Swatch[] = [
  ["#0E6E8C", "pétrole"],
  ["#3FA7C4", "pétrole clair"],
  ["#08465A", "pétrole foncé"],
  ["#7FC8DC", "bleu glacier"],
  ["#9CA3AF", "gris"],
  ["#52525B", "gris foncé"],
];

export const RECENT_MAX = 8;
const RECENT_KEY = "datanime.couleursRecentes";

const norm = (c: string) => c.trim().toUpperCase();

/** Nom français d'une couleur connue (charte, nuancier, listes passées) ; sinon une description neutre. */
export function colorName(hex: string, extra: Swatch[] = []): string {
  const c = norm(hex);
  for (const [x, n] of [...extra, ...CHARTE, ...BASE, ...NUANCIER.flatMap((col) => col.swatches)]) if (norm(x) === c) return n;
  return "couleur personnalisée";
}

/** Liste des récentes après un choix : la couleur en tête, sans doublon, 8 au plus. */
export function pushRecent(list: string[], c: string): string[] {
  const x = norm(c);
  return [x, ...list.map(norm).filter((y) => y !== x)].slice(0, RECENT_MAX);
}

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberColor(c: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(pushRecent(loadRecent(), c)));
  } catch {
    /* stockage indisponible : pas de récentes */
  }
}

export interface ColorPickerOpts {
  /** Couleur actuelle (pastille entourée). */
  value?: string | null;
  /** Couleurs proposées en ligne et en tête du nuancier (défaut : la charte). */
  charter?: Swatch[];
  onPick: (c: string) => void;
  testid: string;
  /** Titre de la fenêtre (« Couleur de la série »…). */
  title?: string;
  /** Valeur initiale du sélecteur complet. */
  base?: string;
}

let openPop: { el: HTMLElement; close: () => void } | null = null;

function swatchBtn(c: string, name: string, cur: string | null | undefined, pick: (c: string) => void, cls = "selp-sw"): HTMLButtonElement {
  const on = !!cur && norm(cur) === norm(c);
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return h("button", { type: "button", class: `${cls}${on ? " on" : ""}`, style: `--sw:${c}`, title: label, "aria-label": label, "aria-pressed": on ? "true" : "false", "data-color": c, onclick: () => pick(c) });
}

/** Ferme le nuancier ouvert (s'il y en a un). */
export function closeNuancier(): void {
  openPop?.close();
}

/** Ouvre la fenêtre « Nuancier » près de `anchor`. */
export function openNuancier(anchor: HTMLElement, o: ColorPickerOpts): HTMLElement {
  closeNuancier();
  const charter = o.charter ?? CHARTE;
  const pick = (c: string) => {
    rememberColor(c);
    close();
    o.onPick(c);
  };
  const recent = loadRecent();
  const row = (label: string, testid: string, kids: Node[]) =>
    h("div", { class: "nz-row", "data-testid": testid }, h("span", { class: "nz-row-label" }, label), h("div", { class: "nz-row-sws" }, ...kids));
  const grid = h(
    "div",
    { class: "nz-grid", role: "group", "aria-label": "Nuancier par teinte, du clair au foncé", "data-testid": "nuancier-grid" },
    ...NUANCIER.map((col) => h("div", { class: "nz-col", role: "group", "aria-label": col.hue, title: col.hue }, ...col.swatches.map(([c, n]) => swatchBtn(c, n, o.value, pick, "selp-sw nz-sw"))))
  );
  const more = h("input", { type: "color", class: "selp-sw-custom", "aria-label": "Plus de couleurs", value: o.value && /^#[0-9a-f]{6}$/i.test(o.value) ? o.value : o.base ?? "#3FA7C4", "data-testid": "nuancier-more-input" });
  more.addEventListener("change", () => pick(more.value));
  const el = h(
    "div",
    { class: "nz-pop", role: "dialog", "aria-modal": "false", "aria-label": o.title ? `Nuancier — ${o.title}` : "Nuancier", "data-testid": "nuancier" },
    h("div", { class: "nz-head" }, h("b", null, o.title ?? "Nuancier"), h("button", { type: "button", class: "nz-close", "aria-label": "Fermer le nuancier", title: "Fermer", "data-testid": "nuancier-close", onclick: () => close() }, "×")),
    row("Couleurs de base", "nuancier-base", BASE.map(([c, n]) => swatchBtn(c, n, o.value, pick))),
    row("Charte", "nuancier-charte", charter.map(([c, n]) => swatchBtn(c, n, o.value, pick))),
    row(
      "Récentes",
      "nuancier-recentes",
      recent.length ? recent.map((c) => swatchBtn(c, colorName(c, charter), o.value, pick)) : [h("small", { class: "nz-empty" }, "Les 8 dernières couleurs choisies apparaîtront ici.")]
    ),
    grid,
    h("label", { class: "nz-more", "data-testid": "nuancier-more" }, "Plus de couleurs…", more),
    h("small", { class: "nz-hint" }, "Mode norme : le rouge et le vert restent réservés aux écarts.")
  );
  document.body.append(el);
  // position : sous le bouton, dans l'écran
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + hh > innerHeight - 8) top = Math.max(8, r.top - hh - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || anchor.contains(t))) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
    anchor.focus?.();
  };
  function close() {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    anchor.setAttribute("aria-expanded", "false");
    if (openPop?.el === el) openPop = null;
  }
  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  anchor.setAttribute("aria-expanded", "true");
  openPop = { el, close };
  (el.querySelector(".selp-sw.on") as HTMLElement | null ?? el.querySelector(".nz-close") as HTMLElement | null)?.focus({ preventScroll: true });
  return el;
}

/** Choix de couleur en ligne : couleurs de la charte + bouton « Nuancier ».
 * La rangée reflète toujours la couleur courante : pastille de la charte marquée active, sinon pastille
 * « couleur perso » en tête (couleur prise au nuancier, aux récentes ou au sélecteur complet). Un choix met la rangée
 * à jour tout de suite (sans attendre la reconstruction du panneau) ; `setValue` la resynchronise de l'extérieur.
 */
export function colorPicker(o: ColorPickerOpts): HTMLElement & { setValue(v: string | null): void } {
  const charter = o.charter ?? CHARTE;
  let value = o.value ?? null;
  const root = h("div", { class: "selp-sws", "data-testid": o.testid }) as unknown as HTMLElement & { setValue(v: string | null): void };
  const pick = (c: string) => {
    rememberColor(c);
    paint(c);
    o.onPick(c);
  };
  const btn: HTMLButtonElement = h(
    "button",
    { type: "button", class: "selp-sw selp-sw-more nz-open", title: "Nuancier : toutes les couleurs", "aria-label": "Nuancier : toutes les couleurs", "aria-haspopup": "dialog", "aria-expanded": "false", "data-testid": `${o.testid}-nuancier`, onclick: () => (openPop && btn.getAttribute("aria-expanded") === "true" ? closeNuancier() : openNuancier(btn, { ...o, value, onPick: pick })) },
    h("span", { class: "nz-open-ic", "aria-hidden": "true" })
  );
  function paint(v: string | null) {
    value = v;
    root.dataset.value = v ?? "";
    const known = !v || charter.some(([c]) => norm(c) === norm(v));
    // couleur hors de la rangée : pastille « couleur perso » en tête, active
    let perso: HTMLButtonElement | null = null;
    if (!known && v) {
      perso = swatchBtn(v, colorName(v), v, pick, "selp-sw selp-sw-perso");
      const label = `Couleur perso : ${colorName(v)}`;
      perso.title = label;
      perso.setAttribute("aria-label", label);
      perso.setAttribute("data-testid", `${o.testid}-perso`);
    }
    root.replaceChildren(...(perso ? [perso] : []), ...charter.map(([c, n]) => swatchBtn(c, n, v, pick)), btn);
  }
  root.setValue = (v) => {
    if (norm(v ?? "") !== norm(value ?? "")) paint(v);
  };
  paint(value);
  return root;
}
