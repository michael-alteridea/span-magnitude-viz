import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

/** Repère de scène : bandeau et cadre selon l'état (exploration, scène de la Séquence, scène du Reel). */
describe("bandeau « scène en modification / exploration libre »", () => {
  let SceneBanner: typeof import("../src/ui/sceneBanner").SceneBanner;
  beforeAll(async () => {
    const { document, window, Node, HTMLElement } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window, Node, HTMLElement });
    SceneBanner = (await import("../src/ui/sceneBanner")).SceneBanner;
  });
  const make = () => {
    const calls: string[] = [];
    const wrap = document.createElement("div");
    const b = new SceneBanner(wrap, { add: () => calls.push("add"), validate: () => calls.push("ok"), cancel: () => calls.push("cancel"), reelValidate: () => calls.push("reel-ok"), reelCancel: () => calls.push("reel-cancel") });
    const vis = (t: string) => !(b.root.querySelector(`[data-testid=${t}]`) as HTMLElement).hidden;
    const click = (t: string) => (b.root.querySelector(`[data-testid=${t}]`) as HTMLElement).click();
    return { b, wrap, calls, vis, click };
  };

  it("exploration libre par défaut : texte, « Ajouter la scène », cadre neutre", () => {
    const { b, wrap, vis, click, calls } = make();
    expect(b.root.dataset.mode).toBe("explore");
    expect(vis("scene-banner-explore")).toBe(true);
    expect(vis("scene-banner-edit")).toBe(false);
    expect(vis("reel-edit-bar")).toBe(false);
    expect(b.root.textContent).toContain("Exploration libre");
    expect(b.root.textContent).toContain("rien n'est enregistré");
    expect(wrap.classList.contains("scene-explore")).toBe(true);
    expect(wrap.classList.contains("scene-edit")).toBe(false);
    click("scene-banner-add");
    expect(calls).toEqual(["add"]);
  });

  it("scène de la Séquence : « Scène N de la Séquence · en modification », Annuler / Valider, cadre orange", () => {
    const { b, wrap, vis, click, calls } = make();
    b.set({ kind: "scene", n: 3, name: "Contexte" });
    expect(vis("scene-banner-edit")).toBe(true);
    expect(vis("scene-banner-explore")).toBe(false);
    expect(b.root.querySelector("[data-testid=scene-banner-label]")!.textContent).toBe("Scène 3 de la Séquence · en modification");
    expect(wrap.classList.contains("scene-edit")).toBe(true);
    click("scene-banner-cancel");
    click("scene-banner-validate");
    expect(calls).toEqual(["cancel", "ok"]);
  });

  it("scène du Reel : « Scène N du Reel · en modification », retour à l'exploration", () => {
    const { b, wrap, vis, click, calls } = make();
    b.set({ kind: "reel", n: 2 });
    expect(vis("reel-edit-bar")).toBe(true);
    expect(b.reelLabel.textContent).toBe("Scène 2 du Reel · en modification");
    expect(wrap.classList.contains("scene-edit")).toBe(true);
    click("reel-edit-validate");
    expect(calls).toEqual(["reel-ok"]);
    b.set({ kind: "explore" });
    expect(wrap.classList.contains("scene-edit")).toBe(false);
    expect(vis("reel-edit-bar")).toBe(false);
  });
});
