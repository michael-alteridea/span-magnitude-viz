import { describe, expect, it } from "vitest";
import { parseNumberLoose, parseDateLoose, buildDataset, retype } from "../src/data/table";
import { parseText, parseJsonValue } from "../src/data/files";
import { detectDelimiter } from "span-magnitude-viz/fileImport";
import { SAMPLES } from "../src/data/samples";

describe("parseNumberLoose (formats FR / EN)", () => {
  it.each([
    ["1 234,56", 1234.56],
    ["1\u00a0234,5 €", 1234.5],
    ["1.234,5", 1234.5],
    ["1,234.5", 1234.5],
    ["12,5 %", 12.5],
    ["-3,2", -3.2],
    ["(1 200)", -1200],
    ["\u22125", -5],
    ["42", 42],
    ["1e3", 1000],
  ])("%s → %d", (s, n) => {
    expect(parseNumberLoose(s)).toBeCloseTo(n as number);
  });
  it("rejects text", () => {
    expect(parseNumberLoose("Paris")).toBeNull();
    expect(parseNumberLoose("2026-10-08")).toBeNull();
  });
  it("honours the column decimal convention", () => {
    expect(parseNumberLoose("1,234", ",")).toBeCloseTo(1.234);
    expect(parseNumberLoose("1,234", ".")).toBe(1234);
  });
});

describe("parseDateLoose", () => {
  const d = (y: number, m: number, day = 1) => Date.UTC(y, m - 1, day);
  it.each([
    ["2026-10-08", d(2026, 10, 8)],
    ["08/10/2026", d(2026, 10, 8)],
    ["8.10.2026", d(2026, 10, 8)],
    ["2026-10", d(2026, 10)],
    ["10/2026", d(2026, 10)],
    ["oct. 2026", d(2026, 10)],
    ["8 octobre 2026", d(2026, 10, 8)],
    ["janv. 2026", d(2026, 1)],
    ["T3 2026", d(2026, 7)],
  ])("%s", (s, t) => expect(parseDateLoose(s)).toBe(t));
  it("rejects invalid dates and plain numbers", () => {
    expect(parseDateLoose("31/02/2026")).toBeNull();
    expect(parseDateLoose("1234")).toBeNull();
  });
});

describe("paste / delimiters", () => {
  it("detects tab, semicolon and comma", () => {
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1,5;2;3\n4;5;6")).toBe(";");
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
  });
  it("parses an Excel-like FR paste and detects column types", () => {
    const text = "Mois\tRégion\tVentes\tTaux\n01/01/2026\tNord\t1 234,50\t12,5 %\n01/02/2026\tSud\t2 000,00\t13,0 %\n01/03/2026\tNord\t1 500,25\t11,9 %\n";
    const res = parseText(text);
    expect(res.delimiter).toBe("\t");
    const ds = buildDataset("t", res.rows);
    const types = Object.fromEntries(ds.columns.map((c) => [c.name, c.type]));
    expect(types).toEqual({ Mois: "date", Région: "category", Ventes: "number", Taux: "number" });
    expect(ds.rows[0]!.Ventes).toBeCloseTo(1234.5);
    expect(ds.rows[1]!.Mois).toBe(Date.UTC(2026, 1, 1));
  });
  it("handles ; with decimal comma and quoted cells", () => {
    const ds = buildDataset("t", parseText('Nom;Valeur\n"Dupont; Jean";3,5\nMartin;4,25\n').rows);
    expect(ds.rows[0]!.Nom).toBe("Dupont; Jean");
    expect(ds.rows[1]!.Valeur).toBeCloseTo(4.25);
  });
  it("accepts JSON arrays and span documents", () => {
    expect(parseJsonValue([{ a: 1 }, { a: 2 }]).rows).toHaveLength(2);
    const doc = parseJsonValue({ version: 1, unit: "date", marks: [{ id: "x", span: { start: "2026-01-01", end: "2026-02-01" }, magnitude: 3, meta: { owner: "A" } }] });
    expect(doc.rows[0]).toMatchObject({ id: "x", start: "2026-01-01", magnitude: 3, owner: "A" });
  });
  it("lets the user override a detected type", () => {
    const ds = buildDataset("t", [{ Année: "2024", V: "1" }, { Année: "2025", V: "2" }]);
    expect(ds.columns[0]!.type).toBe("date");
    const ds2 = retype(ds, "Année", "category");
    expect(ds2.columns[0]!.type).toBe("category");
    expect(ds2.rows[0]!.Année).toBe("2024");
  });
});

describe("samples are anchored on 8 Oct 2026", () => {
  it("never go past 31/12/2026 and use real data up to today", () => {
    for (const s of SAMPLES) {
      const ds = buildDataset(s.name, s.rows());
      for (const c of ds.columns.filter((c) => c.type === "date")) {
        const vals = ds.rows.map((r) => r[c.name]).filter((v): v is number => typeof v === "number");
        expect(Math.max(...vals)).toBeLessThanOrEqual(Date.UTC(2026, 11, 31));
        expect(Math.min(...vals)).toBeGreaterThanOrEqual(Date.UTC(2024, 0, 1));
      }
    }
    const pipeline = buildDataset("p", SAMPLES.find((s) => s.id === "pipeline")!.rows());
    const created = pipeline.rows.map((r) => r["Créée le"] as number);
    expect(Math.max(...created)).toBeLessThanOrEqual(Date.UTC(2026, 9, 8));
  });
});
