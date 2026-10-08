/** Mise en avant active : le titre calculé parle de l'élément mis en avant ; sans mise en avant, titre générique. */
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { narrate, applyNarrative } from "../src/story/narrate";
import { extractKeyNumber } from "../src/reel/plan";

const sc = { today: new Date("2026-10-08T12:00:00").getTime(), entity: "" };

function setup(sampleId: string, over: Record<string, unknown> = {}, key: string | null = null) {
  const s = sampleById(sampleId)!;
  const base = (s.spec ?? {}) as Record<string, unknown>;
  const style = { ...((base.style as object) ?? {}), ...((over.style as object) ?? {}), focus: { key, title: "", note: "", average: true } };
  const r = parseSpec({ ...base, ...over, style });
  if (!r.ok) throw new Error(r.issues.join("; "));
  return { spec: r.spec, ds: buildDataset(s.name, s.rows()) };
}

describe("titre calculé et mise en avant", () => {
  it("barres (somme) : « Île-de-France : 7,6 M€, 35 % du total », sous-titre inchangé (contexte)", () => {
    const plain = setup("ventes");
    const g = narrate(plain.spec, plain.ds, sc)!;
    const f = setup("ventes", {}, "Île-de-France");
    const n = narrate(f.spec, f.ds, sc)!;
    expect(n.title).toMatch(/^Île-de-France\u00a0: [\d,]+\u00a0M€, \d+\u00a0% du total$/);
    expect(n.subtitle).toBe(g.subtitle);
    expect(n.comments[0]).toMatch(/^Rang : 1er sur \d+/);
    expect(g.title).not.toMatch(/^Île-de-France\u00a0:/);
    // chiffre clé du Reel = valeur de l'élément mis en avant
    expect(extractKeyNumber(n.title)).toMatch(/^[\d,]+\u00a0M€$/);
  });
  it("« @max » vise le plus grand élément ; un autre élément change le titre", () => {
    const a = setup("ventes", {}, "@max");
    expect(narrate(a.spec, a.ds, sc)!.title).toMatch(/^Île-de-France\u00a0:/);
    const b = setup("ventes", {}, "Occitanie");
    const n = narrate(b.spec, b.ds, sc)!;
    expect(n.title).toMatch(/^Occitanie\u00a0: /);
    expect(n.comments[0]).toMatch(/^Rang : \d+e sur \d+/);
  });
  it("taux (%) : « Belgique : 14,9 %, −11 pts vs la moyenne » (écart en points, pas de part du total)", () => {
    const f = setup("dette-publique-ue", { type: "bar", encoding: { x: "Pays", y: ["Dette publique (% du PIB)"], aggregate: "mean" }, axes: { y: { unit: "pct" } }, transform: { filters: [{ field: "Pays", op: "in", values: ["Belgique", "France", "Allemagne", "Bulgarie", "Luxembourg"], value: null, label: "5 pays" }] } }, "Bulgarie");
    const n = narrate(f.spec, f.ds, sc)!;
    expect(n.title).toMatch(/^Bulgarie\u00a0: [\d,]+\u00a0%, −[\d,]+\u00a0pts? vs la moyenne$/);
    expect(n.title).not.toMatch(/du total/);
    expect(extractKeyNumber(n.title)).toMatch(/\u00a0%$/);
  });
  it("courbes multi-séries : la série mise en avant (dernière valeur)", () => {
    const f = setup("ventes", { type: "line", encoding: { x: "Mois", y: ["Chiffre d'affaires (€)"], series: "Région", aggregate: "sum" } }, "Occitanie");
    const n = narrate(f.spec, f.ds, sc)!;
    expect(n.title).toMatch(/^Occitanie\u00a0: .+ \(.+\)/);
  });
  it("le titre saisi par l'utilisateur l'emporte ; sans mise en avant, le titre générique revient", () => {
    const f = setup("ventes", {}, "Île-de-France");
    const typed = { ...f.spec, style: { ...f.spec.style, title: "Mon titre" }, story: { ...f.spec.story, auto: true, edited: { ...f.spec.story.edited, title: true } } };
    const out = applyNarrative(typed, narrate(typed, f.ds, sc));
    expect((out ?? typed).style.title).toBe("Mon titre");
    const off = setup("ventes", {}, null);
    expect(narrate(off.spec, off.ds, sc)!.title).toBe(narrate(setup("ventes").spec, off.ds, sc)!.title);
  });
});

describe("titre calculé et classement « Les plus petits »", () => {
  it("top N inversé : le titre parle du dernier affiché, jamais d'un élément masqué", () => {
    const top = setup("ventes", { encoding: { ...(sampleById("ventes")!.spec as { encoding: object }).encoding, topN: 2, topOrder: "top", others: false } });
    const bot = setup("ventes", { encoding: { ...(sampleById("ventes")!.spec as { encoding: object }).encoding, topN: 2, topOrder: "bottom", others: false } });
    const nt = narrate(top.spec, top.ds, sc)!;
    const nb = narrate(bot.spec, bot.ds, sc)!;
    expect(nt.title).not.toMatch(/en dernier/);
    expect(nb.title).toMatch(/ en dernier\u00a0?\s?: /);
    expect(nb.title).not.toMatch(/^Île-de-France/);
    expect(nb.title).not.toMatch(/concentrent|concentre/);
  });
});
