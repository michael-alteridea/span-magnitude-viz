/**
 * Infobulle interactive des graphiques (prévisualisation du Studio, mode lecture, revues, page participant).
 * Lit l'attribut `data-tip` posé par les graphiques (`charts/tip.ts`).
 * - Souris : suit le curseur, reste dans la fenêtre, sans clignotement (contenu mis à jour seulement au changement de cible).
 * - Toucher (iPad / iPhone) : un toucher affiche l'infobulle ; sur un élément explorable, un second toucher zoome.
 * - Clavier : les marques sont focalisables (tabindex itinérant, flèches pour passer d'une marque à l'autre,
 *   Entrée pour explorer, Échap pour fermer).
 * Jamais présente dans les exports (SVG, PNG, PowerPoint, film) : composeSvg retire les attributs.
 */
import { parseTip, tipText, TIP_A11Y as A11Y, TIP_ATTR, type TipData } from "../charts/tip";

const SEL = `[${TIP_ATTR}]`;
let uid = 0;

export interface TooltipOptions {
  /** Toucher : premier toucher = infobulle, second = clic (exploration). Par défaut : vrai. */
  tapToPreview?: boolean;
  /** Toucher sur une marque : l'évènement ne remonte pas (lecteur : pas de diapositive suivante). */
  swallowTap?: boolean;
  /** Indications d'action (« Cliquer pour zoomer ») : seulement là où le clic explore (Studio). Par défaut : vrai. */
  hints?: boolean;
  /** Éléments dessinés hors Studio (bibliothèque : régions de la carte) : leur <title> natif devient une infobulle. */
  adoptTitles?: string;
  /** Marques qui ont déjà leur propre infobulle (points de la bibliothèque) : pas de double affichage. */
  yieldTo?: string;
}

export class ChartTooltip {
  readonly el: HTMLDivElement;
  private cur: Element | null = null;
  private curRaw = "";
  private hideTimer = 0;
  private lastPointer: string = "mouse";
  private armed = false;
  /** Horodatage du dernier appui (souris / toucher) : le focus qui en découle n'est pas un focus clavier. */
  private downAt = 0;
  private last: { x: number; y: number } | null = null;
  private mo: MutationObserver;
  private destroyed = false;

  constructor(private host: Element, private o: TooltipOptions = {}) {
    this.el = document.createElement("div");
    this.el.className = "r4d-tip";
    this.el.id = `r4d-tip-${++uid}`;
    this.el.setAttribute("role", "tooltip");
    this.el.setAttribute("data-testid", "chart-tip");
    this.el.hidden = true;
    host.addEventListener("pointermove", this.onMove as EventListener);
    host.addEventListener("pointerleave", this.onLeave as EventListener);
    host.addEventListener("pointerdown", this.onDown as EventListener);
    host.addEventListener("click", this.onClick as EventListener, true);
    host.addEventListener("pointerup", this.onUp as EventListener, true);
    host.addEventListener("focusin", this.onFocus as EventListener);
    host.addEventListener("focusout", this.onBlur as EventListener);
    host.addEventListener("keydown", this.onKey as EventListener);
    document.addEventListener("pointerdown", this.onDocDown, true);
    window.addEventListener("scroll", this.onScroll, true);
    // microtâche après chaque rendu (synchrone) : marques prêtes au clavier sans attendre l'image suivante
    this.mo = new MutationObserver(() => this.prepare());
    this.mo.observe(host, { childList: true, subtree: true });
    this.prepare();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mo.disconnect();
    this.host.removeEventListener("pointermove", this.onMove as EventListener);
    this.host.removeEventListener("pointerleave", this.onLeave as EventListener);
    this.host.removeEventListener("pointerdown", this.onDown as EventListener);
    this.host.removeEventListener("click", this.onClick as EventListener, true);
    this.host.removeEventListener("pointerup", this.onUp as EventListener, true);
    this.host.removeEventListener("focusin", this.onFocus as EventListener);
    this.host.removeEventListener("focusout", this.onBlur as EventListener);
    this.host.removeEventListener("keydown", this.onKey as EventListener);
    document.removeEventListener("pointerdown", this.onDocDown, true);
    window.removeEventListener("scroll", this.onScroll, true);
    this.el.remove();
  }

  /** Cible courante (tests). */
  get target(): Element | null {
    return this.cur;
  }

  /* ------------------------------------------------------------ cibles */

  /** Marque sous le point : ancêtre porteur de data-tip, sinon premier élément porteur sous le pointeur (superpositions). */
  private find(t: EventTarget | null, x?: number, y?: number): Element | null {
    if (this.o.yieldTo && t instanceof Element && t.closest(this.o.yieldTo)) return null;
    const el = t instanceof Element ? t.closest(SEL) : null;
    if (el && this.host.contains(el)) return el;
    if (x == null || y == null || !document.elementsFromPoint) return null;
    for (const e of document.elementsFromPoint(x, y)) {
      if (!this.host.contains(e)) continue;
      const c = e.closest(SEL);
      if (c && this.host.contains(c)) return c;
    }
    return null;
  }

  /** Accessibilité : tabindex itinérant (une seule marque dans l'ordre de tabulation), libellé lisible. */
  private prepare(): void {
    if (this.destroyed) return;
    if (this.o.adoptTitles) {
      for (const e of this.host.querySelectorAll(this.o.adoptTitles)) {
        const ti = [...e.children].find((c) => c.tagName.toLowerCase() === "title");
        if (!ti) continue;
        const txt = (ti.textContent ?? "").trim();
        ti.remove();
        const m = /^(.*?)\s*\(([^)]+)\)$/.exec(txt);
        if (txt) e.setAttribute(TIP_ATTR, JSON.stringify(m ? { t: m[1], sub: `Région · ${m[2]}` } : { t: txt }));
      }
    }
    const all = [...this.host.querySelectorAll(SEL)];
    let hasZero = false;
    for (const e of all) {
      if (!e.hasAttribute(A11Y)) {
        const d = parseTip(e.getAttribute(TIP_ATTR));
        if (d) e.setAttribute("aria-label", tipText(d));
        e.setAttribute(A11Y, "1");
        if (!e.getAttribute("role")) e.setAttribute("role", "img");
        e.setAttribute("aria-describedby", this.el.id);
      }
      if (e.getAttribute("tabindex") === "0") {
        if (hasZero) e.setAttribute("tabindex", "-1");
        hasZero = true;
      } else if (!e.hasAttribute("tabindex")) e.setAttribute("tabindex", "-1");
    }
    if (!hasZero && all[0]) all[0].setAttribute("tabindex", "0");
    // rendu remplacé (animation, nouveau rendu) : on retrouve la marque sous le pointeur, sans clignoter
    if (this.cur && !this.cur.isConnected) {
      const again = this.last && this.lastPointer === "mouse" ? this.find(null, this.last.x, this.last.y) : null;
      if (again) this.show(again, this.last);
      else this.hide();
    }
  }

  /* ------------------------------------------------------------ évènements */

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.lastPointer = e.pointerType || "mouse";
    this.last = { x: e.clientX, y: e.clientY };
    const t = this.find(e.target, e.clientX, e.clientY);
    if (t) this.show(t, this.last);
    else this.hideSoon();
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.hideSoon(60);
  };

  private onDown = (e: PointerEvent) => {
    this.lastPointer = e.pointerType || "mouse";
    this.downAt = performance.now();
    if (e.pointerType !== "touch") return;
    const t = this.find(e.target, e.clientX, e.clientY);
    this.armed = !!t && t === this.cur && !this.el.hidden;
    this.last = { x: e.clientX, y: e.clientY };
    if (t) this.show(t, null);
  };

  /** Lecteur : un toucher sur une marque ne passe pas à la diapositive suivante. */
  private onUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !this.o.swallowTap) return;
    // glissement (diapositive suivante / précédente) : on laisse passer ; seul un toucher bref sur une marque est retenu
    const d0 = this.last;
    if (d0 && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 12) {
      this.hide();
      return;
    }
    if (this.find(e.target, e.clientX, e.clientY)) e.stopPropagation();
  };

  /** Toucher sur un élément explorable : premier toucher = infobulle, second = exploration. */
  private onClick = (e: MouseEvent) => {
    if (this.lastPointer !== "touch" || this.o.tapToPreview === false) return;
    const t = this.find(e.target, e.clientX, e.clientY);
    if (!t) return;
    const drill = (e.target as Element | null)?.closest?.("[data-drill-kind]");
    if (!drill) return;
    if (!this.armed) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    this.armed = false;
    this.hide();
  };

  private onDocDown = (e: PointerEvent) => {
    if (!this.host.isConnected) return this.destroy();
    if (this.el.hidden) return;
    const t = e.target as Node | null;
    if (t && this.host.contains(t)) return;
    this.hide();
  };

  private onScroll = () => {
    if (!this.el.hidden && this.lastPointer !== "mouse") this.hide();
  };

  private onFocus = (e: FocusEvent) => {
    const t = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (!t || !this.host.contains(t)) return;
    // focus provoqué par un clic ou un toucher : géré par les évènements de pointeur
    if (performance.now() - this.downAt < 800) return;
    this.lastPointer = "keyboard";
    // tabindex itinérant : la marque focalisée devient le point d'entrée
    for (const x of this.host.querySelectorAll(`${SEL}[tabindex="0"]`)) if (x !== t) x.setAttribute("tabindex", "-1");
    t.setAttribute("tabindex", "0");
    this.show(t, null);
  };

  private onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Element | null;
    if (next && this.host.contains(next) && next.closest(SEL)) return;
    if (this.lastPointer === "keyboard") this.hide();
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (!t || !this.host.contains(t)) return;
    if (e.key === "Escape" && !this.el.hidden) {
      e.stopPropagation();
      this.hide();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const drill = t.closest("[data-drill-kind]");
      if (!drill) return;
      e.preventDefault();
      e.stopPropagation();
      this.lastPointer = "keyboard";
      t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return;
    }
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (!dir) return;
    const all = [...this.host.querySelectorAll<SVGElement | HTMLElement>(SEL)];
    const i = all.indexOf(t as SVGElement);
    const j = dir === -Infinity ? 0 : dir === Infinity ? all.length - 1 : Math.max(0, Math.min(all.length - 1, i + dir));
    e.preventDefault();
    e.stopPropagation();
    all[j]?.focus();
  };

  /* ------------------------------------------------------------ affichage */

  private show(t: Element, at: { x: number; y: number } | null): void {
    clearTimeout(this.hideTimer);
    if (!this.host.isConnected) return this.destroy();
    if (!this.el.isConnected) document.body.appendChild(this.el);
    const raw = t.getAttribute(TIP_ATTR) ?? "";
    if (t !== this.cur || raw !== this.curRaw) {
      const d = parseTip(raw);
      if (!d) return this.hide();
      this.cur?.classList?.remove("r4d-tip-on");
      this.cur = t;
      this.curRaw = raw;
      this.el.replaceChildren(...render(this.o.hints === false ? { ...d, h: undefined } : d));
      t.classList?.add("r4d-tip-on");
    }
    this.el.hidden = false;
    this.place(t, at);
  }

  private place(t: Element, at: { x: number; y: number } | null): void {
    const W = Math.min(window.innerWidth, window.visualViewport?.width ?? Infinity);
    const H = Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const m = 8;
    let x: number;
    let y: number;
    if (at) {
      // suit le curseur, à droite et en dessous ; bascule à gauche / au-dessus près des bords
      x = at.x + 16;
      y = at.y + 18;
      if (x + w > W - m) x = at.x - w - 16;
      if (y + h > H - m) y = at.y - h - 14;
    } else {
      // toucher / clavier : au-dessus de la marque (en dessous s'il n'y a pas la place)
      const r = t.getBoundingClientRect();
      x = r.left + r.width / 2 - w / 2;
      y = r.top - h - 10;
      if (y < m) y = Math.min(H - h - m, r.bottom + 10);
    }
    x = Math.max(m, Math.min(W - w - m, x));
    y = Math.max(m, Math.min(H - h - m, y));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private hideSoon(ms = 90): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.cur?.classList?.remove("r4d-tip-on");
    this.cur = null;
    this.curRaw = "";
    this.armed = false;
    this.el.hidden = true;
    this.el.remove();
  }
}

function render(d: TipData): HTMLElement[] {
  const out: HTMLElement[] = [];
  const div = (cls: string, text: string) => {
    const e = document.createElement("div");
    e.className = cls;
    e.textContent = text;
    return e;
  };
  out.push(div("r4d-tip-t", d.t));
  if (d.sub) out.push(div("r4d-tip-sub", d.sub));
  if (d.v) out.push(div("r4d-tip-v", d.v));
  if (d.rows?.length) {
    const dl = document.createElement("dl");
    dl.className = "r4d-tip-rows";
    for (const r of d.rows) {
      const dt = document.createElement("dt");
      dt.textContent = r.k;
      const dd = document.createElement("dd");
      dd.textContent = r.v;
      if (r.tone) dd.className = `tone-${r.tone}`;
      dl.append(dt, dd);
    }
    out.push(dl);
  }
  if (d.h) out.push(div("r4d-tip-h", d.h));
  return out;
}
