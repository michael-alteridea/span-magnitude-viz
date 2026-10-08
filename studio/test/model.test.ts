import { describe, expect, it } from "vitest";
import { chartSpecSchema, parseSpec, defaultSpec, chartSize } from "../src/spec";
import { buildDataset } from "../src/data/table";
import { allRows, buildCatModel, buildTimeModel, weightsAt, buildPointModel } from "../src/data/model";
import { valueFormatter, formatDate, guessUnit } from "../src/format";
import { autoEncode } from "../src/data/suggest";

const ds = buildDataset("t", [
  { Mois: "2026-01-01", Région: "Nord", CA: "100", Marge: "10" },
  { Mois: "2026-01-01", Région: "Sud", CA: "50", Marge: "20" },
  { Mois: "2026-02-01", Région: "Nord", CA: "120", Marge: "30" },
  { Mois: "2026-02-01", Région: "Sud", CA: "80", Marge: "40" },
]);
const spec = (patch: Record<string, unknown>) => chartSpecSchema.parse(patch);

describe("spec (Zod)", () => {
  it("fills defaults from an empty object", () => {
    const s = defaultSpec();
    expect(s.type).toBe("bar");
    expect(s.style.palette).toBe("petrole");
    expect(s.axes.x.grid).toBe(false);
    expect(chartSize(s)).toEqual({ width: 1200, height: 675 });
  });
  it("rejects invalid values with readable paths", () => {
    const r = parseSpec({ type: "camembert3d", style: { backgroundCustom: "red" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join("\n")).toMatch(/type|backgroundCustom/);
  });
  it("round-trips through JSON", () => {
    const s = spec({ type: "donut", encoding: { x: "Région", y: ["CA"] } });
    expect(chartSpecSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe("aggregation", () => {
  it("sums by category with a series field", () => {
    const m = buildCatModel(spec({ type: "groupedBar", encoding: { x: "Mois", y: ["CA"], series: "Région" } }), ds, allRows(ds));
    expect(m.series).toEqual(["Nord", "Sud"]);
    expect(m.values).toEqual([
      [100, 120],
      [50, 80],
    ]);
    expect(m.labels[0]).toBe("janv. 2026");
  });
  it("treats several measures as series and computes the secondary axis", () => {
    const m = buildCatModel(spec({ type: "line", encoding: { x: "Mois", y: ["CA", "Marge"], y2: "Marge", y2Aggregate: "mean" } }), ds, allRows(ds));
    expect(m.series).toEqual(["CA", "Marge"]);
    expect(m.y2).toEqual([15, 35]);
    expect(m.xKind).toBe("time");
  });
  it("sorts categories by total when asked", () => {
    const m = buildCatModel(spec({ type: "bar", encoding: { x: "Région", y: ["CA"] }, style: { sort: "asc" } }), ds, allRows(ds));
    expect(m.keys).toEqual(["Sud", "Nord"]);
  });
  it("builds scatter points", () => {
    const m = buildPointModel(spec({ type: "scatter", encoding: { x: "CA", y: ["Marge"], series: "Région" } }), ds, allRows(ds));
    expect(m.points).toHaveLength(4);
    expect(m.xKind).toBe("linear");
  });
});

describe("4D time steps", () => {
  const s = spec({ type: "bar", encoding: { x: "Région", y: ["CA"], time: "Mois" }, mode: { kind: "dynamic", fourD: { enabled: true } } });
  it("derives ordered steps", () => {
    const tm = buildTimeModel(s, ds)!;
    expect(tm.steps).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)]);
    expect(tm.label(1)).toBe("févr. 2026");
  });
  it("cumulative weights interpolate the next step", () => {
    const tm = buildTimeModel(s, ds)!;
    const m = buildCatModel(s, ds, weightsAt(ds, tm, 0.5, "cumulative"));
    expect(m.values[0]).toEqual([160, 90]); // Nord 100 + 120×0,5 ; Sud 50 + 80×0,5
  });
  it("snapshot weights blend two steps", () => {
    const tm = buildTimeModel(s, ds)!;
    const m = buildCatModel(s, ds, weightsAt(ds, tm, 0.25, "snapshot"));
    expect(m.values[0]![0]).toBeCloseTo(100 * 0.75 + 120 * 0.25);
  });
});

describe("French formats", () => {
  it("formats with units, nbsp thousands and decimal comma", () => {
    expect(valueFormatter({ unit: "eur", unitCustom: "", decimals: 0 })(1234567)).toBe("1\u00a0234\u00a0567\u00a0€");
    expect(valueFormatter({ unit: "meur", unitCustom: "", decimals: 1 })(2_450_000)).toBe("2,5\u00a0M€");
    expect(valueFormatter({ unit: "pct", unitCustom: "", decimals: 1 })(12.34)).toBe("12,3\u00a0%");
    expect(valueFormatter({ unit: "custom", unitCustom: "t CO₂", decimals: 0 })(-12)).toBe("\u221212\u00a0t CO₂");
  });
  it("auto decimals follow the tick step", () => {
    expect(valueFormatter({ unit: "none", unitCustom: "", decimals: null }, 0.05)(0.5)).toBe("0,50");
  });
  it("formats dates in French", () => {
    expect(formatDate(Date.UTC(2026, 9, 8), "day")).toBe("8 oct. 2026");
    expect(formatDate(Date.UTC(2026, 6, 1), "quarter")).toBe("T3 2026");
  });
  it("guesses units from column names", () => {
    expect(guessUnit("Montant (€)")).toBe("eur");
    expect(guessUnit("Taux de conversion (%)")).toBe("pct");
    expect(guessUnit("Leads")).toBe("none");
  });
});

describe("auto encoding", () => {
  it("moves a category to series when switching bars → lines", () => {
    const s = spec({ type: "bar", encoding: { x: "Région", y: ["CA"] } });
    const e = autoEncode(s, ds, "line", false);
    expect(e.x).toBe("Mois");
    expect(e.series).toBe("Région");
  });
});
