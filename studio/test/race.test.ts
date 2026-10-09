import { describe, expect, it } from "vitest";
import { chartSpecSchema } from "../src/spec";
import { buildDataset } from "../src/data/table";
import { allRows, buildModel, buildTimeModel, type CatModel } from "../src/data/model";
import { buildRace, raceFlatSpec, raceStateAt } from "../src/charts/race";
import { autoEncode, timeColumn } from "../src/data/suggest";
import { fourDActive, prepareCache, prepareFrame } from "../src/charts/render";

// Données fictives (Norvia) : trois villes, trois années
const ds = buildDataset("norvia", [
  { Année: "2021", Ville: "Port-Aurel", Visiteurs: "100" },
  { Année: "2021", Ville: "Valdrin", Visiteurs: "60" },
  { Année: "2021", Ville: "Hessel", Visiteurs: "30" },
  { Année: "2022", Ville: "Port-Aurel", Visiteurs: "110" },
  { Année: "2022", Ville: "Valdrin", Visiteurs: "140" },
  { Année: "2022", Ville: "Hessel", Visiteurs: "35" },
  { Année: "2023", Ville: "Port-Aurel", Visiteurs: "120" },
  { Année: "2023", Ville: "Hessel", Visiteurs: "200" },
]);
const spec = (patch: Record<string, unknown>) => chartSpecSchema.parse({ type: "race", encoding: { x: "Ville", y: ["Visiteurs"], time: "Année" }, mode: { kind: "dynamic", fourD: { enabled: true, mode: "snapshot" } }, ...patch });

function race(s = spec({})) {
  const tm = buildTimeModel(s, ds)!;
  const full = buildModel(raceFlatSpec(s), ds, allRows(ds)) as CatModel;
  return { tm, rd: buildRace(s, ds, tm, full) };
}

describe("course de barres", () => {
  it("valeurs par période, report de la dernière valeur connue", () => {
    const { tm, rd } = race();
    expect(tm.steps).toHaveLength(3);
    const k = (n: string) => rd.keys.indexOf(n);
    expect(rd.values[0]![k("Valdrin")]).toBe(60);
    expect(rd.values[2]![k("Valdrin")]).toBe(140); // absente en 2023 : 2022 reportée
    expect(rd.values[2]![k("Hessel")]).toBe(200);
  });
  it("rangs par période et reclassement interpolé", () => {
    const { rd } = race();
    const k = (n: string) => rd.keys.indexOf(n);
    expect(rd.ranks[0]![k("Port-Aurel")]).toBe(0);
    expect(rd.ranks[1]![k("Valdrin")]).toBe(0);
    const mid = raceStateAt(rd, 0.5);
    expect(mid.rank[k("Valdrin")]).toBeCloseTo(0.5, 5);
    expect(mid.value[k("Valdrin")]).toBeCloseTo(100, 5);
    expect(raceStateAt(rd, 0.4).step).toBe(0);
    expect(raceStateAt(rd, 0.6).step).toBe(1);
    expect(raceStateAt(rd, 99).step).toBe(2);
    expect(mid.max).toBeCloseTo(120, 5);
  });
  it("cumul depuis la première période", () => {
    const { rd } = race(spec({ mode: { kind: "dynamic", fourD: { enabled: true, mode: "cumulative" } } }));
    expect(rd.values[2]![rd.keys.indexOf("Port-Aurel")]).toBe(330);
  });
  it("préparation : figé = dernière période, dynamique = position demandée", () => {
    const s = spec({});
    const cache = prepareCache(s, ds, null, 1);
    expect(cache.error).toBeNull();
    expect(fourDActive(s, ds)).toBe(true);
    expect(prepareFrame(s, ds, cache, { build: 1, timePos: 1 }).race?.pos).toBe(1);
    const st = spec({ mode: { kind: "static" } });
    const c2 = prepareCache(st, ds, null, 1);
    expect(prepareFrame(st, ds, c2, { build: 1, timePos: null }).race?.pos).toBe(2);
    expect(prepareFrame(st, ds, c2, { build: 1, timePos: null }).stamp).toBe("2023");
  });
  it("erreur claire sans colonne de temps", () => {
    const s = spec({ encoding: { x: "Ville", y: ["Visiteurs"], time: null } });
    expect(prepareCache(s, ds, null, 1).error).toMatch(/colonne de temps/);
  });
  it("encodage automatique : catégories en X, année en temps, une mesure", () => {
    const line = chartSpecSchema.parse({ type: "line", encoding: { x: "Année", y: ["Visiteurs"], series: "Ville" } });
    const enc = autoEncode(line, ds, "race", false);
    expect(enc.time).toBe("Année");
    expect(enc.x).toBe("Ville");
    expect(enc.series).toBeNull();
    expect(enc.y).toEqual(["Visiteurs"]);
    expect(timeColumn(ds)?.name).toBe("Année");
  });
});
