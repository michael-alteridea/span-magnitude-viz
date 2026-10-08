import { describe, expect, it } from "vitest";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { applyTransform, effectiveDataset, describeTransform } from "../src/data/transform";
import { buildVarianceModel, isFavourable } from "../src/data/variance";
import { parseSpec, type ChartSpec } from "../src/spec";
import { explore } from "../src/story/insights";
import { applyNarrative, narrate, narrativeKey } from "../src/story/narrate";
import {
  assignNarrativeOrder,
  moveSnapshot,
  parseStory,
  roleForKind,
  saveStory,
  loadStory,
  STORY_KEY,
  type Snapshot,
} from "../src/story/snapshots";

const TODAY = Date.UTC(2026, 9, 8);
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const ds = (id: string) => {
  const s = sampleById(id)!;
  return buildDataset(s.name, s.rows());
};
const spec = (x: unknown) => {
  const r = parseSpec(x);
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.spec;
};

describe("transformations (colonnes calculées + filtres)", () => {
  it("calculs : âge, tranche, mois de l'année, pondéré, filtres", () => {
    const d = ds("pipeline");
    const out = applyTransform(d, {
      calculate: [
        { as: "Pondéré (€)", op: "mul", a: "Montant (€)", b: "Probabilité (%)", scale: 0.01, ref: null, values: [] },
        { as: "Mois", op: "monthOfYear", a: "Date de clôture", b: null, scale: 1, ref: null, values: [] },
      ],
      filters: [{ field: "Étape", op: "notIn", values: ["Fermée gagnée", "Fermée perdue"], value: null, label: "affaires ouvertes" }],
    });
    expect(out.rows.length).toBeLessThan(d.rows.length);
    expect(out.rows.every((r) => !String(r["Étape"]).startsWith("Fermée"))).toBe(true);
    const r0 = out.rows[0]!;
    expect(r0["Pondéré (€)"]).toBeCloseTo((r0["Montant (€)"] as number) * (r0["Probabilité (%)"] as number) * 0.01);
    expect(out.columns.find((c) => c.name === "Pondéré (€)")?.type).toBe("number");
    expect(norm(describeTransform({ calculate: [], filters: [{ field: "Clôture", op: "gte", values: [], value: TODAY, label: "" }] })[0]!)).toBe("Clôture ≥ 8 oct. 2026");
  });
  it("mémoïsation : même spec + même dataset → même objet", () => {
    const d = ds("pipeline");
    const s = spec({ transform: { filters: [{ field: "Pays", op: "in", values: ["Belgique"] }] } });
    expect(effectiveDataset(s, d)).toBe(effectiveDataset(s, d));
    expect(effectiveDataset(spec({}), d)).toBe(d);
  });
});

describe("modèle d'écarts (IBCS)", () => {
  it("sommes appariées réel / budget, écart et favorabilité", () => {
    const d = ds("business-review");
    const s = spec({ type: "variance", encoding: { x: "Région", y: ["Réel (€)", "Budget (€)"] } });
    const vm = buildVarianceModel(s, d)!;
    expect(vm.keys).toContain("Nouvelle-Aquitaine");
    const i = vm.labels.indexOf("Nouvelle-Aquitaine");
    expect(vm.delta[i]).toBeLessThan(0);
    expect(vm.rel[i]).toBeCloseTo(vm.delta[i]! / vm.ref[i]!);
    expect(vm.total.delta).toBeCloseTo(vm.actual.reduce((a, b) => a + b, 0) - vm.ref.reduce((a, b) => a + b, 0));
    expect(isFavourable(-5, "higher")).toBe(false);
    expect(isFavourable(-5, "lower")).toBe(true);
  });
});

describe("récit calculé", () => {
  const d = ds("pipeline");
  const sc = { today: TODAY, entity: d.name };
  const ins = explore(d, sc).find((i) => i.kind === "concentration")!;
  it("titre affirmatif, sous-titre IBCS (entité · mesure · unité · période), 1 à 3 commentaires", () => {
    const n = narrate(ins.spec, d, sc)!;
    expect(norm(n.title)).toBe("Le pipeline T4 repose à 53 % sur 2 comptes");
    expect(norm(n.subtitle)).toMatch(/^Pipeline Salesforce · Montant en (k€|M€) · affaires ouvertes · /);
    expect(n.comments.length).toBeGreaterThanOrEqual(1);
    expect(n.comments.length).toBeLessThanOrEqual(3);
    expect(n.role).toBe("revelation");
  });
  it("les saisies de l'utilisateur ne sont pas écrasées ; Régénérer les rétablit", () => {
    const n = narrate(ins.spec, d, sc)!;
    const edited: ChartSpec = { ...ins.spec, style: { ...ins.spec.style, title: "Mon titre" }, story: { ...ins.spec.story, edited: { title: true, subtitle: false, comments: false } } };
    const applied = applyNarrative(edited, n);
    expect(applied?.style.title ?? edited.style.title).toBe("Mon titre");
    expect((applied ?? edited).style.subtitle).toBe(n.subtitle);
    const regenerated = applyNarrative({ ...edited, story: { ...edited.story, edited: { title: false, subtitle: false, comments: false } } }, n)!;
    expect(regenerated.style.title).toBe(n.title);
    expect(applyNarrative(regenerated, n)).toBeNull();
  });
  it("narration générique quand l'encodage change (empreinte différente)", () => {
    const changed = { ...ins.spec, encoding: { ...ins.spec.encoding, x: "Propriétaire" } };
    const n = narrate(changed, d, sc)!;
    expect(n.title).not.toBe("Le pipeline T4 repose à 53 % sur 2 comptes");
    expect(narrativeKey(changed, 1, sc)).not.toBe(narrativeKey(ins.spec, 1, sc));
  });
});

const snap = (id: string, kind: string | null, role?: Snapshot["role"]): Snapshot => ({
  id,
  name: id,
  createdAt: "2026-10-08T10:00:00Z",
  spec: {},
  svg: "<svg/>".repeat(10),
  thumb: "data:image/jpeg;base64,AAAA",
  width: 1200,
  height: 675,
  title: id,
  subtitle: "",
  comments: [],
  source: "",
  kind,
  role: role ?? roleForKind(kind),
  sampleId: null,
  dataName: "",
  generatedAt: "",
});

describe("histoire (snapshots)", () => {
  it("rôles narratifs par type d'insight", () => {
    expect(roleForKind("trend")).toBe("context");
    expect(roleForKind("variance", { unfavourable: true })).toBe("tension");
    expect(roleForKind("variance", { unfavourable: false })).toBe("revelation");
    expect(roleForKind("concentration")).toBe("revelation");
    expect(roleForKind("pipelineSlipping")).toBe("recommendation");
    expect(roleForKind(null)).toBe("context");
  });
  it("réordonner et « Ordonner en récit » (tri stable)", () => {
    const list = [snap("a", "pipelineSlipping"), snap("b", "concentration"), snap("c", "trend"), snap("d", "outlier"), snap("e", "seasonality")];
    expect(moveSnapshot(list, 0, 2).map((s) => s.id)).toEqual(["b", "c", "a", "d", "e"]);
    expect(assignNarrativeOrder(list).map((s) => s.id)).toEqual(["c", "e", "d", "b", "a"]);
  });
  it("persistance : quota dépassé → les SVG les plus anciens sont retirés d'abord", () => {
    const store = new Map<string, string>();
    const storage = {
      setItem(k: string, v: string) {
        if (v.length > 900) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      getItem: (k: string) => store.get(k) ?? null,
    };
    const st = { title: "Histoire", snapshots: [snap("a", "trend"), snap("b", "trend"), snap("c", "trend")] };
    st.snapshots.forEach((s) => (s.svg = "x".repeat(300)));
    const r = saveStory(st, storage);
    expect(r.ok).toBe(true);
    expect(r.trimmed).toBeGreaterThan(0);
    const back = loadStory(storage);
    expect(back.snapshots.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(back.snapshots[0]!.svg).toBeNull();
    expect(store.has(STORY_KEY)).toBe(true);
  });
  it("lecture tolérante (fichier JSON)", () => {
    const st = parseStory({ title: "T", snapshots: [snap("a", "trend"), { nope: true }] });
    expect(st.title).toBe("T");
    expect(st.snapshots).toHaveLength(1);
  });
});
