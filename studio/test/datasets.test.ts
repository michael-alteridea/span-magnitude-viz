/** Datasets dérivés (déploiement 2 du modèle « dataset d'abord ») : recettes, pastilles, versions, migration, empreintes. */
import { describe, expect, it } from "vitest";
import { buildDataset } from "../src/data/table";
import { applyRecipe, datasetBase, effectiveDataset } from "../src/data/transform";
import {
  adoptRef,
  chipGroups,
  countRows,
  createDataset,
  describeRecipe,
  isFrozenRef,
  nextDatasetId,
  parseDatasets,
  proposeName,
  rangeChipText,
  refFits,
  sameRecipe,
  scenesUsing,
  stackedCounts,
  toRef,
  uniqueDatasetName,
  updateDataset,
  valuesChipText,
} from "../src/data/datasets";
import { defaultSpec, parseSpec, type FilterSpec } from "../src/spec";
import { fingerprintSpec, snapshotFingerprint } from "../src/publish/manifest";
import { parseProjectFile, projectSig, toProjectFile, type Project } from "../src/project/project";

// Source fictive Norvia : 5 pays × 3 années × 2 secteurs (30 lignes)
const PAYS = ["Allemagne", "Belgique", "France", "Luxembourg", "Pays-Bas"];
const rows: Record<string, unknown>[] = [];
for (const p of PAYS) for (const a of [2024, 2025, 2026]) for (const s of ["Industrie", "Santé"]) rows.push({ Pays: p, Année: a, Secteur: s, "CA (€)": 1000 + a - 2000 + p.length * 10, Commandes: 3 });
const SRC = buildDataset("Norvia — ventes export", rows);

const inF = (field: string, values: string[], all: string[]): FilterSpec => ({ field, op: "in", values, value: null, label: `${field} : ${valuesChipText(values, all)}` });
const sansAllemagne = inF("Pays", PAYS.slice(1), PAYS);
// « Année » est détectée comme une date (années) : période = [1er janv. 2025 ; 1er janv. 2027[ (comme l'étape Filtrer)
const yearIsDate = SRC.columns.find((c) => c.name === "Année")!.type === "date";
const depuis2025: FilterSpec[] = [
  { field: "Année", op: "gte", values: [], value: yearIsDate ? Date.UTC(2025, 0, 1) : 2025, label: `Année : ${rangeChipText(2025, 2026)}` },
  yearIsDate ? { field: "Année", op: "lt", values: [], value: Date.UTC(2027, 0, 1), label: `Année : ${rangeChipText(2025, 2026)}` } : { field: "Année", op: "lte", values: [], value: 2026, label: `Année : ${rangeChipText(2025, 2026)}` },
];
const industrie = inF("Secteur", ["Industrie"], ["Industrie", "Santé"]);

describe("recette d'un dataset (la source n'est jamais modifiée)", () => {
  it("filtres permanents puis colonnes gardées ; le nom devient celui du dataset", () => {
    const d = applyRecipe(SRC, { name: "Benelux + France", filters: [sansAllemagne, ...depuis2025], columns: ["Pays", "Année", "CA (€)"] });
    expect(d.rows.length).toBe(4 * 2 * 2);
    expect(d.columns.map((c) => c.name)).toEqual(["Pays", "Année", "CA (€)"]);
    expect(Object.keys(d.raw[0]!)).toEqual(["Pays", "Année", "CA (€)"]);
    expect(d.name).toBe("Benelux + France");
    expect(SRC.rows.length).toBe(30);
    expect(d.columns.find((c) => c.name === "Pays")!.cardinality).toBe(4);
  });

  it("un filtre sur une colonne absente est ignoré (source remplacée)", () => {
    expect(applyRecipe(SRC, { filters: [inF("Région", ["Nord"], ["Nord"])], columns: [] }).rows.length).toBe(30);
  });

  it("dataset du graphique puis filtre de vue (deux niveaux), mémorisés", () => {
    const spec = parseSpec({ ...defaultSpec(), dataset: { id: "D1", version: 1, name: "Sans Allemagne", filters: [sansAllemagne], columns: [] }, transform: { filters: [industrie] } });
    if (!spec.ok) throw new Error(spec.issues.join());
    const base = datasetBase(spec.spec, SRC)!;
    expect(base.rows.length).toBe(24);
    const eff = effectiveDataset(spec.spec, SRC)!;
    expect(eff.rows.length).toBe(12);
    expect(effectiveDataset(spec.spec, SRC)).toBe(eff);
    expect(datasetBase({ dataset: null }, SRC)).toBe(SRC);
  });
});

describe("pastilles empilées et nom proposé", () => {
  it("chaque pastille montre les lignes restantes ; une période = une pastille", () => {
    const f = [sansAllemagne, ...depuis2025, industrie];
    expect(chipGroups(f).map((g) => g.field)).toEqual(["Pays", "Année", "Secteur"]);
    expect(stackedCounts(SRC, f)).toEqual([24, 16, 8]);
    expect(countRows(SRC, f)).toBe(8);
  });

  it("textes des pastilles : valeurs, « 4 sur 5 (sans …) », période", () => {
    expect(valuesChipText(["Industrie", "Santé"], ["Industrie", "Santé", "Services"])).toBe("Industrie, Santé");
    expect(valuesChipText(PAYS.slice(1), PAYS)).toBe("4 sur 5 (sans Allemagne)");
    expect(rangeChipText(2024, 2026)).toBe("2024 → 2026");
    expect(rangeChipText(2025, 2025)).toBe("2025");
    expect(rangeChipText(2024, null)).toBe("depuis 2024");
  });

  it("nom proposé d'après les filtres ; nom libre ; résumé de la recette", () => {
    const two = inF("Secteur", ["Industrie", "Santé"], ["Industrie", "Santé", "Services"]);
    expect(proposeName([sansAllemagne, ...depuis2025, two])).toBe("Pays 4 sur 5 (sans Allemagne) · 2025 → 2026 · Industrie & Santé");
    expect(proposeName([])).toBe("Toutes les lignes");
    const d1 = createDataset([], SRC.name, { name: "Industrie", filters: [industrie], columns: [] });
    expect(uniqueDatasetName([d1], SRC.name, "Industrie")).toBe("Industrie 2");
    expect(uniqueDatasetName([d1], SRC.name, "Industrie", "D1")).toBe("Industrie");
    expect(describeRecipe({ filters: [sansAllemagne, ...depuis2025], columns: ["Pays"] }, 5)).toBe("Pays : 4 sur 5 (sans Allemagne) · Année : 2025 → 2026 · 1 colonnes sur 5");
  });
});

describe("catalogue : identifiants, versions, scènes figées", () => {
  it("D1, D2… par source ; une modification de recette incrémente la version (le nom seul, non)", () => {
    const d1 = createDataset([], SRC.name, { name: "Sans Allemagne", filters: [sansAllemagne], columns: [] });
    const d2 = createDataset([d1], SRC.name, { name: "Industrie", filters: [industrie], columns: [] });
    expect([d1.id, d2.id]).toEqual(["D1", "D2"]);
    expect(nextDatasetId([d1, d2], "Autre source")).toBe("D1");
    expect(d1.color).not.toBe(d2.color);
    const renamed = updateDataset(d1, { name: "Benelux + France", filters: [sansAllemagne], columns: [] });
    expect(renamed.version).toBe(1);
    const v2 = updateDataset(d1, { name: d1.name, filters: [sansAllemagne, industrie], columns: [] });
    expect(v2.version).toBe(2);
    expect(sameRecipe(d1, v2)).toBe(false);
    // une scène gardée sur v1 est « figée »
    expect(isFrozenRef(toRef(d1), v2)).toBe(true);
    expect(isFrozenRef(toRef(v2), v2)).toBe(false);
  });

  it("scènes qui utilisent un dataset ; recette adoptée (projets et scènes plus anciens) ; colonnes présentes", () => {
    const d1 = createDataset([], SRC.name, { name: "Sans Allemagne", filters: [sansAllemagne], columns: [] });
    const scenes = [{ id: "a", spec: { dataset: toRef(d1) } }, { id: "b", spec: { dataset: null } }, { id: "c", spec: {} }];
    expect(scenesUsing(scenes, "D1").map((s) => s.id)).toEqual(["a"]);
    const adopted = adoptRef([], toRef(d1), SRC.name)!;
    expect(adopted.map((d) => d.id)).toEqual(["D1"]);
    expect(adoptRef(adopted, toRef(d1), SRC.name)).toBeNull();
    expect(refFits(toRef(d1), SRC)).toBe(true);
    expect(refFits({ ...toRef(d1), columns: ["Inconnue"] }, SRC)).toBe(false);
  });
});

describe("empreintes Cadencer et projets", () => {
  it("dataset absent (null) : hors empreinte — les empreintes publiées ne changent pas", async () => {
    const base = defaultSpec();
    const { dataset: _d, ...without } = base as unknown as Record<string, unknown>;
    expect(JSON.stringify(fingerprintSpec(base))).toBe(JSON.stringify(fingerprintSpec(without)));
    const snap = { id: "s1", title: "T", subtitle: "", comments: [], role: "context", path: [], spec: base } as never;
    const snap2 = { id: "s1", title: "T", subtitle: "", comments: [], role: "context", path: [], spec: without } as never;
    expect(await snapshotFingerprint(snap)).toBe(await snapshotFingerprint(snap2));
  });

  it("un dataset présent entre dans l'empreinte (mise à jour = nouvelle empreinte, scène figée = identique)", async () => {
    const d1 = createDataset([], SRC.name, { name: "Sans Allemagne", filters: [sansAllemagne], columns: [] });
    const v2 = updateDataset(d1, { name: d1.name, filters: [sansAllemagne, industrie], columns: [] });
    const mk = (ref: unknown) => ({ id: "s1", title: "T", subtitle: "", comments: [], role: "context", path: [], spec: { ...defaultSpec(), dataset: ref } }) as never;
    const fp = (ref: unknown) => snapshotFingerprint(mk(ref));
    expect(await fp(toRef(d1))).not.toBe(await fp(null));
    expect(await fp(toRef(d1))).toBe(await fp(structuredClone(toRef(d1))));
    expect(await fp(toRef(v2))).not.toBe(await fp(toRef(d1)));
  });

  it("projet : datasets enregistrés et relus ; projet du déploiement 1 = aucun dataset, pas « modifié »", () => {
    const d1 = createDataset([], SRC.name, { name: "Sans Allemagne", filters: [sansAllemagne], columns: [] });
    const p: Project = { id: "prj-1", name: "Revue", createdAt: "2026-10-08T20:00:00.000Z", updatedAt: "2026-10-08T20:00:00.000Z", source: null, spec: { ...defaultSpec(), dataset: toRef(d1) }, sequence: { title: "S", snapshots: [], sameScale: false, film: { morph: false } }, datasets: [d1], thumb: null };
    const back = parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(p))));
    if ("legacy" in back) throw new Error("legacy");
    expect(back.project.datasets).toEqual([d1]);
    const old = JSON.parse(JSON.stringify(toProjectFile(p)));
    delete old.project.datasets;
    const o = parseProjectFile(old);
    if ("legacy" in o) throw new Error("legacy");
    expect(o.project.datasets).toEqual([]);
    expect(parseDatasets([{ id: "D3", source: "x", filters: [{ field: "Pays", values: ["France"] }] }])[0]!.filters[0]!.op).toBe("in");
    // spec enregistré avant les champs récents (dataset, forme des points) = même signature que le spec relu
    const { dataset: _d, ...older } = defaultSpec() as unknown as Record<string, unknown>;
    const st = { ...(older.style as Record<string, unknown>) };
    delete st.pointShape;
    delete st.pointIcon;
    delete st.pointIcons;
    const seq = { title: "S", snapshots: [], sameScale: false, film: { morph: false } };
    expect(projectSig({ source: null, spec: { ...older, style: st }, sequence: seq })).toBe(projectSig({ source: null, spec: defaultSpec(), sequence: seq, datasets: [] }));
  });
});
