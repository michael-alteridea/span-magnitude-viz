import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoFinanceCsv, demoFinanceRows, FIN_COLUMNS, FIN_FROM, FIN_TO } from "../src/data/demoFinance";
import { buildDataset } from "../src/data/table";
import { buildDrillModel, drillInto, drillView, initDrill, isCostLabel, isVersionMode, rootGrain, versionPair } from "../src/data/drill";
import { sampleById } from "../src/data/samples";
import { parseSpec } from "../src/spec";
import { narrate } from "../src/story/narrate";
import { SCENARIO_DAF, guessBinding, missingRoles, runScenario, scenarioSnapshotId } from "../src/story/scenarios";

const TODAY = Date.UTC(2026, 9, 8);
const rows = demoFinanceRows();
const ds = buildDataset("Démo : réel vs budget", rows as unknown as Record<string, unknown>[]);
const NT = { calculate: [], filters: [] };
const k = (x: number) => Math.round(x / 1000);
const net = (version: string, pred: (r: (typeof rows)[number]) => boolean = () => true) =>
  rows.filter((r) => r.version === version && pred(r)).reduce((a, r) => a + (r.nature === "Coûts" ? -1 : 1) * Number(r.montant_eur), 0);

describe("démo finance : réel 2025 vs budget 2026 (données fictives)", () => {
  it("le CSV commité est exactement la sortie du générateur (graine fixe)", () => {
    const csv = readFileSync(join(__dirname, "../public/demo/finance-reel-2025-budget-2026.csv"), "utf8");
    expect(csv).toBe(demoFinanceCsv(rows));
    expect(demoFinanceCsv(demoFinanceRows())).toBe(csv);
  });

  it("volume, colonnes, décimales françaises, aucune fourchette dans une cellule", () => {
    expect(rows).toHaveLength(2520);
    const lines = demoFinanceCsv(rows).trim().split("\n");
    expect(lines[0]).toBe(FIN_COLUMNS.join(";"));
    for (const l of lines.slice(1)) {
      const cells = l.split(";");
      expect(cells).toHaveLength(FIN_COLUMNS.length);
      expect(cells[7]).toMatch(/^-?\d+(,\d{1,2})?$/);
      for (const c of [...cells.slice(0, 1), ...cells.slice(2)]) expect(c).not.toMatch(/\d\s*[–-]\s*\d/);
      expect(cells[1]).toMatch(/^202[56]-\d\d$/);
    }
    expect(new Set(rows.map((r) => r.version))).toEqual(new Set([FIN_FROM, FIN_TO]));
    expect(new Set(rows.map((r) => r.entite)).size).toBe(2);
    expect(new Set(rows.map((r) => r.region)).size).toBe(5);
  });

  it("chiffres de l'histoire : marge 18,1 → 17,7 M€ ; Plateforme +2,1 M€ ; Équipements −3,0 M€", () => {
    expect(k(net(FIN_FROM))).toBe(18100);
    expect(k(net(FIN_TO))).toBe(17700);
    const line = (l: string) => k(net(FIN_TO, (r) => r.ligne_metier === l) - net(FIN_FROM, (r) => r.ligne_metier === l));
    expect(line("Plateforme")).toBe(2100);
    expect(line("Équipements")).toBe(-3000);
    expect(line("Services")).toBe(400);
    expect(line("Licences")).toBe(300);
    expect(line("Formation")).toBe(-200);
    expect(isCostLabel("Coûts")).toBe(true);
    expect(isCostLabel("Revenus")).toBe(false);
  });
});

describe("cascade, mois et tableau croisé", () => {
  const d0 = initDrill(ds, { label: "Marge contributive" });
  const root = rootGrain(ds, "mois");

  it("version, nature et niveaux devinés ; vue de départ en cascade", () => {
    expect(isVersionMode(d0)).toBe(true);
    expect([d0.version, d0.from, d0.to, d0.nature]).toEqual(["version", FIN_FROM, FIN_TO, "nature"]);
    expect(d0.levels).toEqual(["ligne_metier", "compte"]);
    expect(d0.view).toBe("bridge");
    expect(versionPair(ds, "version")).toEqual({ from: FIN_FROM, to: FIN_TO });
  });

  it("cascade : départ + Σ écarts = arrivée", () => {
    const { model } = buildDrillModel({ drill: d0, transform: NT }, ds);
    expect(model?.view).toBe("bridge");
    if (model?.view !== "bridge") return;
    expect(k(model.start)).toBe(18100);
    expect(k(model.end)).toBe(17700);
    const deltas = model.items.filter((i) => i.kind === "delta");
    expect(deltas).toHaveLength(5);
    expect(Math.abs(model.start + deltas.reduce((a, i) => a + i.value, 0) - model.end)).toBeLessThan(0.01);
    expect(model.items[model.topNeg!]!.key).toBe("Équipements");
    expect(model.items[model.topPos!]!.key).toBe("Plateforme");
  });

  it("clic sur Plateforme : comptes groupés revenus puis coûts, avec sous-total", () => {
    const plateforme = drillInto(d0, { kind: "cat", field: "ligne_metier", value: "Plateforme" }, root);
    const { model } = buildDrillModel({ drill: plateforme, transform: NT }, ds);
    expect(model?.view).toBe("bridge");
    if (model?.view !== "bridge") return;
    expect(model.field).toBe("compte");
    expect(model.items.filter((i) => i.kind === "subtotal")).toHaveLength(1);
    expect(k(model.revDelta!)).toBe(2600);
    expect(k(model.costDelta!)).toBe(500);
    const deltas = model.items.filter((i) => i.kind === "delta");
    expect(deltas.map((i) => i.group)).toEqual(["Revenus", "Revenus", "Revenus", "Coûts", "Coûts"]);
    let acc = model.start;
    for (const it of model.items.filter((i) => i.kind === "delta")) acc += it.value;
    expect(Math.abs(acc - model.end)).toBeLessThan(0.01);
  });

  it("mois : abonnements 75 % au second semestre ; contrats distributeurs en rupture à partir de mars", () => {
    const plateforme = drillInto(d0, { kind: "cat", field: "ligne_metier", value: "Plateforme" }, root);
    const abo = drillInto(plateforme, { kind: "cat", field: "compte", value: "Abonnements annuels" }, root);
    const m1 = buildDrillModel({ drill: abo, transform: NT }, ds).model;
    expect(m1?.view).toBe("compare");
    if (m1?.view !== "compare") return;
    expect(m1.months).toHaveLength(12);
    expect(k(m1.delta)).toBe(2000);
    expect(Math.round((m1.h2 / m1.delta) * 100)).toBe(75);
    const sn = drillInto(d0, { kind: "cat", field: "ligne_metier", value: "Équipements" }, root);
    const mgc = drillInto(sn, { kind: "cat", field: "compte", value: "Contrats distributeurs" }, root);
    const m2 = buildDrillModel({ drill: mgc, transform: NT }, ds).model;
    if (m2?.view !== "compare") throw new Error(m2?.view);
    expect(m2.breakAt).toBe(2);
    expect(k(m2.delta)).toBe(-3600);
    for (const m of m2.months.slice(2)) expect(k(m.delta!)).toBeGreaterThanOrEqual(-362);
  });

  it("carte : l'Île-de-France seule région en recul", () => {
    const { model } = buildDrillModel({ drill: drillView(d0, "map", "region"), transform: NT }, ds);
    expect(model?.view).toBe("map");
    if (model?.view !== "map") return;
    const neg = model.stats.filter((s) => (s.delta ?? 0) < 0).map((s) => s.key);
    expect(neg).toEqual(["Île-de-France"]);
  });

  it("tableau croisé : écart par trimestre et ligne métier", () => {
    const d = { ...drillView(d0, "pivot"), pivot: { x: "@quarter", series: "ligne_metier", agg: "delta" as const, chart: "bar" as const } };
    const { model } = buildDrillModel({ drill: d, transform: NT }, ds);
    expect(model?.view).toBe("pivot");
    if (model?.view !== "pivot") return;
    expect(model.keys).toEqual(["T1", "T2", "T3", "T4"]);
    const plateforme = model.series.find((s) => s.key === "Plateforme")!;
    expect(plateforme.values.map((v) => k(v!))).toEqual([193, 333, 745, 829]);
    const sn = model.series.find((s) => s.key === "Équipements")!;
    expect(sn.values.every((v) => v! < 0)).toBe(true);
    expect(k(model.series.reduce((a, s) => a + s.total, 0))).toBe(-400);
  });
});

describe("Scénario Directeur financier", () => {
  const b = guessBinding(SCENARIO_DAF, ds);
  const run = runScenario(SCENARIO_DAF, ds, b);

  it("rôles devinés, 7 étapes et titres chiffrés", () => {
    expect(b).toMatchObject({ date: "mois", mesure: "montant_eur", version: "version", ligne: "ligne_metier", compte: "compte", nature: "nature", region: "region" });
    expect(missingRoles(SCENARIO_DAF, ds, b)).toEqual([]);
    expect(run.stoppedAt).toBeNull();
    const titles = run.frames.map((f) => f.story!.title.replace(/\u00a0|\u202f/g, " "));
    expect(titles).toEqual([
      "Budget 2026 : −0,4 M€ vs Réel 2025 — Équipements (−3,0 M€) efface la hausse de Plateforme (+2,1 M€)",
      "Plateforme : +2,1 M€ vs 2025, dont +2,6 M€ de revenus et +0,5 M€ de coûts d'infrastructure",
      "Abonnements annuels : +2,0 M€ au Budget 2026, dont 75 % au second semestre",
      "Équipements : −3,0 M€ vs 2025, dont −3,6 M€ de revenus et −0,6 M€ de coûts",
      "Contrats distributeurs : −3,6 M€ au Budget 2026, rupture à partir de mars (−360 k€ par mois)",
      "L'Île-de-France : −2,1 M€ (−28 %), seule région en recul au Budget 2026",
      "Écart par trimestre : Plateforme +2,1 M€ (75 % sur T3–T4), Équipements −3,0 M€ dès T1",
    ]);
    for (const f of run.frames) {
      expect(f.comments.length).toBeGreaterThanOrEqual(2);
      expect(f.story!.title).toMatch(/\d/);
      expect(f.comments.filter((c) => /\d/.test(c)).length).toBeGreaterThanOrEqual(1);
      for (const c of [f.story!.title, ...f.comments]) expect(c).not.toMatch(/certifi|conforme|authenticit|preuve/i);
    }
    expect(run.frames[4]!.comments.join(" ")).toMatch(/contrat perdu ou non renouvelé/);
  });

  it("rejouable sur un fichier aux colonnes renommées", () => {
    const renamed = rows.map((r) => ({ Scénario: r.version, Période: r.mois, Activité: r.ligne_metier, Type: r.nature, Poste: r.compte, Zone: r.region, Valeur: r.montant_eur }));
    const ds2 = buildDataset("ERP", renamed as unknown as Record<string, unknown>[]);
    const b2 = { date: "Période", mesure: "Valeur", version: "Scénario", ligne: "Activité", compte: "Poste", nature: "Type", region: "Zone" };
    expect(missingRoles(SCENARIO_DAF, ds2, b2)).toEqual([]);
    const run2 = runScenario(SCENARIO_DAF, ds2, b2);
    expect(run2.stoppedAt).toBeNull();
    expect(run2.frames).toHaveLength(7);
    expect(run2.frames[0]!.story!.title).toMatch(/Équipements/);
    expect(run2.frames[4]!.story!.title).toMatch(/^Contrats distributeurs/);
  });

  it("étape optionnelle (carte) sautée sans région ; identifiants stables", () => {
    const run3 = runScenario(SCENARIO_DAF, ds, { ...b, region: null });
    expect(run3.stoppedAt).toBeNull();
    expect(run3.frames.map((f) => f.step.id)).not.toContain("06-carte");
    expect(missingRoles(SCENARIO_DAF, ds, { ...b, compte: null }).map((r) => r.id)).toEqual(["compte"]);
    const id = scenarioSnapshotId(SCENARIO_DAF, SCENARIO_DAF.steps[0]!);
    expect(id).toBe("daf-01-cascade");
    expect(id).toBe(scenarioSnapshotId(SCENARIO_DAF, SCENARIO_DAF.steps[0]!));
  });

  it("exemple intégré « Démo : réel vs budget »", () => {
    const sample = sampleById("demo-finance")!;
    expect(sample.name).toBe("Démo : réel vs budget");
    const r = parseSpec(sample.spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dss = buildDataset(sample.name, sample.rows());
    const n = narrate(r.spec, dss, { today: TODAY, entity: dss.name });
    expect(n?.kind).toBe("drill");
    expect(n?.title).toMatch(/^Budget 2026 : −0,4/);
  });
});
