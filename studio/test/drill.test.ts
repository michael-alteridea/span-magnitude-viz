import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoPipelineCsv, demoPipelineRows, DEMO_REGIONS, DEMO_REPS } from "../src/data/demoPipeline";
import { buildDataset } from "../src/data/table";
import { parseText } from "../src/data/files";
import { buildDrillModel, drillInto, drillPathLabels, drillTo, drillView, initDrill, rootGrain } from "../src/data/drill";
import { regionNuts } from "../src/data/regions";
import { sampleById } from "../src/data/samples";
import { parseSpec } from "../src/spec";
import { narrate } from "../src/story/narrate";
import { drillStory } from "../src/story/drillStory";
import { SCENARIO_DIRCOM, guessBinding, missingRoles, runScenario, scenarioSnapshotId } from "../src/story/scenarios";

const TODAY = Date.UTC(2026, 9, 8);
const rows = demoPipelineRows();
const ds = buildDataset("Démo : pipeline commercial", rows as unknown as Record<string, unknown>[]);
const NT = { calculate: [], filters: [] };

describe("démo pipeline (données fictives)", () => {
  it("le CSV commité est exactement la sortie du générateur (graine fixe)", () => {
    const csv = readFileSync(join(__dirname, "../public/demo/pipeline-commercial-2026.csv"), "utf8");
    expect(csv).toBe(demoPipelineCsv(rows));
    expect(demoPipelineCsv(demoPipelineRows())).toBe(csv);
  });

  it("volume, bornes de dates, montants, régions et commerciaux", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1500);
    expect(rows.length).toBeLessThanOrEqual(3000);
    for (const r of rows) {
      expect(r.date_creation >= "2025-01-01" && r.date_creation <= "2026-10-08").toBe(true);
      expect(r.date_cloture_prevue <= "2026-12-31").toBe(true);
      expect(r.montant_eur).toBeGreaterThanOrEqual(5000);
      expect(r.montant_eur).toBeLessThanOrEqual(150000);
    }
    const regions = new Set(rows.map((r) => r.region));
    expect([...regions].sort()).toEqual(["Bruxelles", "Flandre", "Hauts-de-France", "Wallonie", "Île-de-France"]);
    for (const reg of DEMO_REGIONS) {
      const reps = new Set(rows.filter((r) => r.region === reg.name).map((r) => r.commercial));
      expect(reps.size).toBeGreaterThanOrEqual(3);
      expect(reps.size).toBeLessThanOrEqual(5);
    }
    expect(DEMO_REPS.length).toBe(18);
    for (const reg of regions) expect(regionNuts(reg)).not.toBeNull();
  });

  it("CSV : séparateur « ; », décimales françaises, aucune fourchette dans une cellule ; réimport identique", () => {
    const csv = demoPipelineCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]!.split(";").length).toBe(14);
    expect(lines.some((l) => /\d,\d/.test(l))).toBe(true);
    expect(lines.some((l) => /\d\s*[–-]\s*\d/.test(l.replace(/\d{4}-\d{2}(-\d{2})?/g, "D").replace(/OPP-\d{2}-\d+/g, "ID")))).toBe(false);
    const res = parseText(csv, "pipeline-commercial-2026");
    const back = buildDataset(res.name, res.rows);
    expect(back.rows.length).toBe(rows.length);
    expect(back.columns.find((c) => c.name === "montant_eur")?.type).toBe("number");
    expect(back.columns.find((c) => c.name === "date_creation")?.type).toBe("date");
    const total = (d: typeof ds) => d.rows.reduce((a, r) => a + (r.montant_pondere_eur as number), 0);
    expect(total(back)).toBeCloseTo(total(ds), 2);
  });
});

describe("exploration guidée : modèle et navigation", () => {
  const d0 = initDrill(ds, { label: "Pipeline créé" });

  it("rôles devinés et grain de départ trimestriel", () => {
    expect(d0.date).toBe("date_creation");
    expect(d0.measure).toBe("montant_eur");
    expect(d0.by).toBe("region");
    expect(rootGrain(ds, "date_creation")).toBe("quarter");
  });

  it("trimestres : T2 2026 seul en recul", () => {
    const { model } = buildDrillModel({ drill: d0, transform: NT }, ds);
    expect(model?.view).toBe("periods");
    if (model?.view !== "periods") return;
    expect(model.bars.map((b) => b.label)).toEqual(["T1 2025", "T2 2025", "T3 2025", "T4 2025", "T1 2026", "T2 2026", "T3 2026"]);
    expect(model.bars[model.focus!]!.label).toBe("T2 2026");
    const ch = model.bars.slice(1).map((b, i) => b.value / model.bars[i]!.value - 1);
    expect(ch.filter((x) => x < 0)).toHaveLength(1);
  });

  it("zoom, fil d'Ariane et retour", () => {
    const root = rootGrain(ds, "date_creation");
    const t2 = drillInto(d0, { kind: "period", start: Date.UTC(2026, 3, 1), grain: "quarter" }, root);
    expect(drillPathLabels(t2)).toEqual(["Tout", "T2 2026"]);
    expect(t2.view).toBe("periods");
    expect(t2.grain).toBe("month");
    const juin = drillInto(t2, { kind: "period", start: Date.UTC(2026, 5, 1), grain: "month" }, root);
    expect(drillPathLabels(juin)).toEqual(["Tout", "T2 2026", "Juin 2026"]);
    expect(juin.view).toBe("month");
    const wal = drillInto(drillView(juin, "map", "region"), { kind: "cat", field: "region", value: "Wallonie" }, root);
    expect(drillPathLabels(wal)).toEqual(["Tout", "T2 2026", "Juin 2026", "Wallonie"]);
    expect(wal.view).toBe("periods");
    // un autre mois dans la vue focalisée : le chemin est reconstruit (T2 2026 › Mai 2026 › Wallonie)
    const mai = drillInto(wal, { kind: "period", start: Date.UTC(2026, 4, 1), grain: "month" }, root);
    expect(drillPathLabels(mai)).toEqual(["Tout", "T2 2026", "Mai 2026", "Wallonie"]);
    expect(drillPathLabels(drillTo(wal, 1, root))).toEqual(["Tout", "T2 2026"]);
    expect(drillPathLabels(drillTo(wal, 0, root))).toEqual(["Tout"]);
  });

  it("carte : 5 régions reconnues (NUTS 1), Wallonie explique la baisse", () => {
    const root = rootGrain(ds, "date_creation");
    const juin = drillInto(drillInto(d0, { kind: "period", start: Date.UTC(2026, 3, 1), grain: "quarter" }, root), { kind: "period", start: Date.UTC(2026, 5, 1), grain: "month" }, root);
    const { model } = buildDrillModel({ drill: drillView(juin, "map", "region"), transform: NT }, ds);
    expect(model?.view).toBe("map");
    if (model?.view !== "map") return;
    expect(model.stats.map((s) => s.nuts).sort()).toEqual(["BE1", "BE2", "BE3", "FR1", "FRE"]);
    expect(model.unmatched).toEqual([]);
    expect(model.stats[model.standout!]!.key).toBe("Wallonie");
    expect(model.share!).toBeGreaterThan(0.9);
  });
});

describe("Scénario Directeur commercial", () => {
  const b = guessBinding(SCENARIO_DIRCOM, ds);
  const run = runScenario(SCENARIO_DIRCOM, ds, b);

  it("7 étapes, titres affirmatifs et commentaires chiffrés", () => {
    expect(missingRoles(SCENARIO_DIRCOM, ds, b)).toEqual([]);
    expect(run.stoppedAt).toBeNull();
    const titles = run.frames.map((f) => f.story!.title.replace(/[\u00a0\u202f]/g, " "));
    expect(titles[0]).toBe("T2 2026 : seul trimestre en recul (−3,8 %) après 4 trimestres de hausse");
    expect(titles[1]).toMatch(/^Juin 2026 décroche : 1,3 M€, −22 % vs la moyenne mars–mai 2026$/);
    expect(titles[2]).toMatch(/^Juin 2026 : l'écart se creuse tout au long du mois/);
    expect(titles[3]).toMatch(/^Juin 2026 : la Wallonie concentre toute la baisse/);
    expect(titles[4]).toBe("Seule la Wallonie décroche en juin 2026 ; août est bas partout");
    expect(titles[5]).toMatch(/^Wallonie : juin 2026 au plus bas sur 21 mois \(215 k€, −64 %\)$/);
    expect(titles[6]).toBe("Julie M. : 0 opportunité créée en juin 2026 contre 13 en moyenne");
    expect(run.frames.map((f) => f.story!.role)).toEqual(["context", "tension", "tension", "revelation", "revelation", "revelation", "recommendation"]);
    for (const f of run.frames) {
      expect(f.comments.length).toBeGreaterThanOrEqual(2);
      for (const c of [f.story!.title, ...f.comments]) {
        expect(c).toMatch(/\d/);
        expect(c).not.toMatch(/certifi|conforme|authenticit|preuve/i);
      }
    }
    expect(run.frames[6]!.comments.join(" ")).toMatch(/stables/);
    expect(run.frames[6]!.comments.join(" ")).toMatch(/Piste : absence sans relais \? Julie M\. reprend en juillet 2026/);
  });

  it("rejouable sur un autre fichier après association des colonnes aux rôles", () => {
    const renamed = rows.map((r) => ({ Créée: r.date_creation, Valeur: r.montant_eur, Zone: r.region, Vendeur: r.commercial, Client: r.client }));
    const ds2 = buildDataset("CRM", renamed);
    const b2 = { date: "Créée", mesure: "Valeur", region: "Zone", commercial: "Vendeur" };
    expect(missingRoles(SCENARIO_DIRCOM, ds2, b2)).toEqual([]);
    const run2 = runScenario(SCENARIO_DIRCOM, ds2, b2);
    expect(run2.frames).toHaveLength(7);
    expect(run2.frames[6]!.story!.title).toMatch(/^Julie M\. : 0 /);
    expect(run2.frames[3]!.story!.title).toMatch(/Wallonie/);
  });

  it("rôle obligatoire manquant signalé ; identifiants de snapshot stables", () => {
    expect(missingRoles(SCENARIO_DIRCOM, ds, { ...b, region: null }).map((r) => r.id)).toEqual(["region"]);
    const id = scenarioSnapshotId(SCENARIO_DIRCOM, SCENARIO_DIRCOM.steps[3]!, "abc");
    expect(id).toBe(scenarioSnapshotId(SCENARIO_DIRCOM, SCENARIO_DIRCOM.steps[3]!, "abc"));
    expect(id).toMatch(/^dircom-04-carte-/);
    expect(id).not.toBe(scenarioSnapshotId(SCENARIO_DIRCOM, SCENARIO_DIRCOM.steps[3]!, "abd"));
  });

  it("narration intégrée (kind « drill ») et exemple intégré", () => {
    const sample = sampleById("demo-pipeline")!;
    expect(sample.name).toBe("Démo : pipeline commercial");
    const r = parseSpec(sample.spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = narrate(r.spec, ds, { today: TODAY, entity: ds.name });
    expect(n?.kind).toBe("drill");
    expect(n?.title).toMatch(/^T2 2026 : seul trimestre en recul/);
    expect(n?.subtitle).toBe("Pipeline créé en € · janvier 2025 – septembre 2026 · par trimestre");
    expect(drillStory({ drill: r.spec.drill, transform: NT }, ds)?.suggestion?.label).toBe("Zoomer sur T2 2026");
  });
});
