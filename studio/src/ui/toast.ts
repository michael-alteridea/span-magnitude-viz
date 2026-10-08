import { h } from "./dom";

let host: HTMLElement | null = null;

export function toast(msg: string, kind: "info" | "ok" | "error" = "info", ms = 3800): void {
  if (!host) {
    host = h("div", { class: "toasts", "aria-live": "polite", "data-testid": "toasts" });
    document.body.appendChild(host);
  }
  const el = h("div", { class: `toast toast-${kind}` }, msg);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 300);
  }, ms);
}
