/**
 * Boîte de confirmation du Studio (remplace window.confirm : lisible sur iPad, au thème, testable).
 * Résout `true` si l'action est confirmée, `false` sinon (Annuler, Échap, clic hors de la boîte).
 */
import { h, ICONS } from "./dom";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirm: string;
  cancel?: string;
  /** Action destructive : bouton rouge. */
  danger?: boolean;
  testid?: string;
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const done = (v: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      }
    };
    const ok = h("button", { class: `btn ${o.danger ? "btn-danger" : "btn-primary"}`, "data-testid": "confirm-ok", onclick: () => done(true) }, o.confirm);
    const root = h(
      "div",
      { class: "cf-overlay", "data-testid": o.testid ?? "confirm", role: "presentation", onclick: (e: Event) => e.target === root && done(false) },
      h(
        "div",
        { class: "cf-box", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "cf-title" },
        h("div", { class: `cf-ic${o.danger ? " danger" : ""}`, html: o.danger ? ICONS.trash : ICONS.refresh }),
        h("div", { class: "cf-txt" }, h("h3", { id: "cf-title" }, o.title), h("p", null, o.message)),
        h("div", { class: "cf-actions" }, h("button", { class: "btn", "data-testid": "confirm-cancel", onclick: () => done(false) }, o.cancel ?? "Annuler"), ok)
      )
    );
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    ok.focus();
  });
}

/** Saisie d'un nom (renommer un projet). Résout le texte, ou null si annulé. */
export function promptDialog(o: { title: string; label: string; value: string; confirm: string; testid?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    };
    const input = h("input", { type: "text", value: o.value, maxlength: "120", "data-testid": "prompt-input", "aria-label": o.label }) as HTMLInputElement;
    const submit = () => {
      const v = input.value.trim();
      if (v) done(v);
      else input.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const root = h(
      "div",
      { class: "cf-overlay", "data-testid": o.testid ?? "prompt", onclick: (e: Event) => e.target === root && done(null) },
      h(
        "div",
        { class: "cf-box", role: "dialog", "aria-modal": "true", "aria-label": o.title },
        h("div", { class: "cf-ic", html: ICONS.edit }),
        h("div", { class: "cf-txt" }, h("h3", null, o.title), h("label", { class: "cf-label" }, o.label, input)),
        h("div", { class: "cf-actions" }, h("button", { class: "btn", "data-testid": "prompt-cancel", onclick: () => done(null) }, "Annuler"), h("button", { class: "btn btn-primary", "data-testid": "prompt-ok", onclick: submit }, o.confirm))
      )
    );
    document.body.appendChild(root);
    document.addEventListener("keydown", onKey, true);
    input.focus();
    input.select();
  });
}
