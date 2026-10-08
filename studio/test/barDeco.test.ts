import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { allRows, buildCatModel } from "../src/data/model";
import { parseSpec, type ChartSpec } from "../src/spec";
import { barDeco, focusTexts, pictoUnit } from "../src/charts/barDeco";
import { categoryIcon, iconChoices, iconFor, iconSvg, normIconText } from "../src/charts/icons";
import { PHOSPHOR, PHOSPHOR_FILL, ICON_LABELS } from "../src/charts/icons/phosphor";
import { narrate } from "../src/story/narrate";
import { chartTarget, sectionSummaries } from "../src/ui/panelMap";

const TODAY = Date.UTC(2026, 9, 8);
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const sample = (id: string) => {
  const s = sampleById(id)!;
  const r = parseSpec(s.spec);
  if (!r.ok) throw new Error(r.issues.join("; "));
  return { ds: buildDataset(s.name, s.rows()), spec: r.spec };
};
const model = (spec: ChartSpec, ds: ReturnType<typeof buildDataset>) => buildCatModel(spec, ds, allRows(ds));

describe("icônes Phosphor (étape I)", () => {
  it("jeu d'icônes complet : chemin regular et fill, libellé français pour chacune", () => {
    const names = Object.keys(ICON_LABELS);
    expect(names.length).toBeGreaterThan(60);
    for (const n of names) {
      expect(PHOSPHOR[n], n).toMatch(/^M/);
      expect(PHOSPHOR_FILL[n], n).toMatch(/^M/);
    }
    expect(iconChoices().some(([n]) => n === "minus")).toBe(false);
    expect(iconSvg("cloud", 16)).toContain('viewBox="0 0 256 256"');
    expect(iconSvg("inconnue")).toBe("");
  });

  it("choix automatique d'après le nom (français et anglais, accents, pluriels)", () => {
    expect(normIconText("Hébergement")).toBe("hebergement");
    expect(iconFor("Hébergement")).toBe("cloud");
    expect(iconFor("Équipe")).toBe("users");
    expect(iconFor("Licences")).toBe("key");
    expect(iconFor("Serveurs")).toBe("hard-drives");
    expect(iconFor("Logistique")).toBe("truck");
    expect(iconFor("Agences")).toBe("buildings");
    expect(iconFor("Hosting")).toBe("cloud");
    expect(iconFor("Julie M.")).toBeNull();
    expect(iconFor("")).toBeNull();
  });

  it("choix par catégorie : forcé, aucune (« »), sinon automatique", () => {
    expect(categoryIcon("Équipe", { Équipe: "headset" })).toBe("headset");
    expect(categoryIcon("Équipe", { Équipe: "" })).toBeNull();
    expect(categoryIcon("Équipe", {})).toBe("users");
  });
});

describe("barres racontées : barDeco, pictogrammes, annotation", () => {
  it("icône au bout de chaque barre (échantillon « postes »)", () => {
    const { ds, spec } = sample("postes");
    const d = barDeco(spec, model(spec, ds), true);
    expect(d.cap).toBe("icon");
    expect(d.icons.filter(Boolean).length).toBe(6);
    expect(d.focusK).toBeNull();
  });

  it("icône et pictogrammes : une seule série ; hors barres simples ou non éligible → rien", () => {
    const { ds, spec } = sample("postes");
    const two = { ...spec, encoding: { ...spec.encoding, series: "Poste" } };
    expect(barDeco(two, model(two, ds), true).cap).toBe("none");
    expect(barDeco({ ...spec, type: "line" }, model(spec, ds), true).cap).toBe("none");
    expect(barDeco(spec, model(spec, ds), false).cap).toBe("none");
    const picto = { ...spec, style: { ...spec.style, barCap: "picto" as const } };
    expect(barDeco(picto, model(picto, ds), true).cap).toBe("picto");
  });

  it("objectif : deux mesures (réalisé, objectif), pas de série", () => {
    const { ds, spec } = sample("objectifs");
    expect(barDeco(spec, model(spec, ds), true).cap).toBe("goal");
    const one = { ...spec, encoding: { ...spec.encoding, y: ["Réalisé (€)"] } };
    expect(barDeco(one, model(one, ds), true).cap).toBe("none");
  });

  it("mise en avant : catégorie nommée ou « @max » (la plus grande)", () => {
    const { ds, spec } = sample("dossiers");
    const m = model(spec, ds);
    expect(m.labels[barDeco(spec, m, true).focusK!]).toBe("Julie M.");
    const mx = { ...spec, style: { ...spec.style, focus: { ...spec.style.focus, key: "@max" } } };
    expect(barDeco(mx, m, true).focusK).toBe(m.values[0]!.indexOf(Math.max(...m.values[0]!)));
    const absent = { ...spec, style: { ...spec.style, focus: { ...spec.style.focus, key: "Personne" } } };
    expect(barDeco(absent, m, true).focusK).toBeNull();
  });

  it("unité des pictogrammes : 1, 2 ou 5 × 10ⁿ, au plus ~target icônes", () => {
    expect(pictoUnit(412_000, 8)).toBe(100_000);
    expect(pictoUnit(412_000, 9)).toBe(50_000);
    expect(pictoUnit(47, 10)).toBe(5);
    expect(pictoUnit(23, 12)).toBe(2);
    expect(pictoUnit(0, 10)).toBe(1);
    for (const [mx, t] of [[987, 7], [3.6, 8], [125_000, 20]] as const) {
      const u = pictoUnit(mx, t);
      expect(mx / u).toBeLessThanOrEqual(t + 1e-9);
      expect(String(u / 10 ** Math.floor(Math.log10(u)))).toMatch(/^(1|2|5)$/);
    }
  });

  it("annotation calculée : valeur, part du total, comparaison à la moyenne des autres ; saisie prioritaire", () => {
    const vals = [47, 14, 12, 9, 8, 6];
    const t = focusTexts("Julie M.", 47, vals, 0, (v) => String(Math.round(v)), { title: "", note: "" });
    expect(t.avg).toBeCloseTo(9.8, 5);
    expect(t.title).toBe("Julie M. : 47 (49 % du total)");
    expect(t.note).toBe("4,8 fois la moyenne des autres (10)");
    const u = focusTexts("Julie M.", 47, vals, 0, String, { title: "Absente", note: "Pas de relais" });
    expect([u.title, u.note]).toEqual(["Absente", "Pas de relais"]);
    const low = focusTexts("Lucas P.", 6, vals, 5, String, { title: "", note: "" });
    expect(low.note).toMatch(/en retrait$/);
  });
});

describe("récit et panneau des barres racontées", () => {
  const sc = { today: TODAY, entity: null };

  it("objectif : titre « N commerciaux sur K ont atteint leur objectif », manques et taux global", () => {
    const { ds, spec } = sample("objectifs");
    const n = narrate(spec, ds, sc as never)!;
    expect(norm(n.title)).toMatch(/^\d commerciaux sur 6 ont atteint leur objectif$/);
    expect(n.comments).toHaveLength(3);
    expect(norm(n.comments[1]!)).toMatch(/^Sous l'objectif : .+ \(manque .+\)\.$/);
    expect(norm(n.comments[2]!)).toMatch(/^Ensemble : \d+ % de l'objectif/);
  });

  it("accords : « gestionnaires », « des dossiers », pas de double point", () => {
    const { ds, spec } = sample("dossiers");
    const n = narrate(spec, ds, sc as never)!;
    expect(norm(n.title)).toContain("des dossiers en retard");
    expect(n.comments.join(" ")).toContain("Les 2 premiers gestionnaires");
    expect(n.comments.join(" ")).not.toMatch(/\.\./);
  });

  it("résumés de section et toucher l'annotation / l'icône → bon réglage", () => {
    const { spec } = sample("objectifs");
    expect(sectionSummaries(spec, true).graphique).toContain("objectif");
    const d = sample("dossiers").spec;
    expect(sectionSummaries(d, true).recit).toContain("mise en avant : Julie M.");
    const { document } = parseHTML(`<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><g class="r4d-marks"><g class="r4d-bar-deco"><g class="r4d-cap"><circle id="cap"/></g></g></g><g class="r4d-callout"><text id="co">x</text></g><g class="r4d-avg"><text id="avg">m</text></g></svg></body></html>`);
    const el = (id: string) => document.getElementById(id) as unknown as Element;
    expect(chartTarget(el("cap"), "bar", false)).toMatchObject({ section: "graphique", paths: ["style.barCap"] });
    expect(chartTarget(el("co"), "bar", false)).toMatchObject({ section: "recit", group: "focus" });
    expect(chartTarget(el("avg"), "bar", false)?.paths[0]).toBe("style.focus.average");
  });
});
