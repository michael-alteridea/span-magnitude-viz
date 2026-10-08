/**
 * Import intelligent : moteur de formules (analyse, dépendances, feuilles croisées, fonctions, couverture),
 * recalcul validé contre LibreOffice, détection de structure (en-tête, temps, sections, unités, Ouverture, résumé),
 * large → long, découpage Entité + Indicateur, nombres français, regroupements / agrégats, X ⇄ Y.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import * as formulajs from "@formulajs/formulajs";
import { parseFormula, addrOf, parseAddr } from "../src/data/formula/parser";
import { recalcWorkbook, KEY_COLS, type WorkbookIn, type SheetIn } from "../src/data/formula/engine";
import { XlErr, serialFromYmd } from "../src/data/formula/values";
import { workbookDataFrom, toWorkbookIn, sheetMatrix, guessSheet, type WorkbookData } from "../src/data/workbook";
import { detectStructure, toLongTable, splitLabels, parseFrenchValue, headerTime, F } from "../src/data/structure";
import { type MappingState, defaultMapping, groupSeries, pivot, swapXY, toggleRowSeries, assignField, setFilter, setSeriesAxis, suggestCurve } from "../src/data/mapping";
import { parseDelimitedMatrix } from "span-magnitude-viz/fileImport";

const FX = join(__dirname, "fixtures");
const MONTHLY = "Plan 60m — Exemple";

/** Petit classeur à la main : { feuille: { A1: valeur | "=formule" } }. */
function wbOf(spec: Record<string, Record<string, number | string | boolean | null>>): WorkbookIn {
  const sheets: SheetIn[] = Object.entries(spec).map(([name, cells]) => {
    const map = new Map<number, { v: number | string | boolean | null; f?: string }>();
    let maxR = 0;
    let maxC = 0;
    for (const [a, v] of Object.entries(cells)) {
      const p = parseAddr(a)!;
      maxR = Math.max(maxR, p.r);
      maxC = Math.max(maxC, p.c);
      map.set(p.r * KEY_COLS + p.c, typeof v === "string" && v.startsWith("=") ? { v: null, f: v.slice(1) } : { v });
    }
    return { name, cells: map, maxR, maxC };
  });
  return { sheets };
}
const val = (res: ReturnType<typeof recalcWorkbook>, s: number, a: string) => {
  const p = parseAddr(a)!;
  return res.values[s]!.get(p.r * KEY_COLS + p.c);
};
const close = (a: unknown, b: number, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function loadData(path: string): WorkbookData {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellFormula: true, sheetStubs: true, cellNF: true });
  return workbookDataFrom(XLSX as never, wb);
}

describe("analyseur de formules", () => {
  it("références, feuilles croisées, plages, priorités", () => {
    expect(parseFormula("'Hypothèses'!$D$112")).toEqual({ k: "ref", sheet: "Hypothèses", r: 111, c: 3 });
    expect(parseFormula("Hypothèses!$D$112")).toEqual({ k: "ref", sheet: "Hypothèses", r: 111, c: 3 });
    expect(parseFormula("SUM(D95:O95)")).toMatchObject({ k: "call", name: "SUM", args: [{ k: "range", r1: 94, c1: 3, r2: 94, c2: 14 }] });
    expect(parseFormula("A:A")).toMatchObject({ k: "range", c1: 0, c2: 0, r1: 0 });
    expect(parseFormula('"a""b"')).toEqual({ k: "str", v: 'a"b' });
    expect(parseFormula("_xlfn.IFS(TRUE,1)")).toMatchObject({ k: "call", name: "IFS" });
    expect(() => parseFormula("Table1[Col]")).toThrow();
    expect(addrOf(11, 63)).toBe("BL12");
  });
});

describe("moteur de recalcul", () => {
  const wb = wbOf({
    Hyp: { A1: "taux", B1: 0.2, B2: 8, B3: 3, C1: 10, C2: 20, C3: 30, D1: "x", D2: "y", D3: "z" },
    Plan: {
      A1: "=Hyp!B1*100", // 20
      A2: "='Hyp'!$B$2+A1", // 28
      A3: "=SUM(Hyp!C1:C3)", // 60
      A4: "=IF(A3>50,\"haut\",\"bas\")",
      A5: "=INDEX(Hyp!C1:C3,MATCH(\"y\",Hyp!D1:D3,0))", // 20
      A6: "=SUMPRODUCT(ABS(B6:D6))",
      B6: -1,
      C6: 2,
      D6: "=-3",
      A7: "=IFERROR(1/0,\"div\")",
      A8: "=EOMONTH(DATE(2027,1,15),1)",
      A9: "=COUNTIF(Hyp!C1:C3,\">=20\")",
      A10: "=ROUND(2.675,2)",
      A11: "=-2^2",
      A12: "=MIN(1,MAX(0,A1/100))",
      A13: "=AND(A1>0,OR(A2<0,A3=60))",
      A14: "=INT(7.9)+AVERAGE(Hyp!C1:C3)",
      A15: "=GCD(12,18)", // repli formulajs
      A16: "=FOOBAR(1)", // inconnue
      A17: "=A18+1",
      A18: "=A17+1", // circularité
      A19: "=MATCH(25,Hyp!C1:C3,1)",
      A20: "=VLOOKUP(\"z\",Hyp!D1:D3,1,FALSE)&\"!\"",
    },
  });
  const res = recalcWorkbook(wb, { fallback: formulajs as never });
  it("valeurs", () => {
    expect(val(res, 1, "A1")).toBeCloseTo(20);
    expect(val(res, 1, "A2")).toBeCloseTo(28);
    expect(val(res, 1, "A3")).toBe(60);
    expect(val(res, 1, "A4")).toBe("haut");
    expect(val(res, 1, "A5")).toBe(20);
    expect(val(res, 1, "A6")).toBe(6);
    expect(val(res, 1, "A7")).toBe("div");
    expect(val(res, 1, "A8")).toBe(serialFromYmd(2027, 1, 28));
    expect(val(res, 1, "A9")).toBe(2);
    expect(val(res, 1, "A10")).toBe(2.68);
    expect(val(res, 1, "A11")).toBe(4);
    expect(val(res, 1, "A12")).toBeCloseTo(0.2);
    expect(val(res, 1, "A13")).toBe(true);
    expect(val(res, 1, "A14")).toBe(27);
    expect(val(res, 1, "A15")).toBe(6);
    expect(val(res, 1, "A19")).toBe(2);
    expect(val(res, 1, "A20")).toBe("z!");
  });
  it("couverture : fonction inconnue et circularité signalées avec exemples", () => {
    expect(res.report.unknownFunctions.FOOBAR).toBe(1);
    expect(res.report.fallbackFunctions.GCD).toBe(1);
    expect(res.report.failed).toBe(3);
    expect(res.report.examples.map((e) => e.addr).sort()).toEqual(["A16", "A17", "A18"]);
    expect(val(res, 1, "A16")).toBeInstanceOf(XlErr);
  });
});

describe("recalcul validé contre LibreOffice (classeur fictif, formules sans valeur en cache)", () => {
  const data = loadData(join(FX, "plan-mini.xlsx"));
  const expected = JSON.parse(readFileSync(join(FX, "plan-mini.expected.json"), "utf8")) as Record<string, Record<string, number | string>>;
  it("toutes les formules sont sans valeur en cache", () => {
    expect(data.formulas).toBeGreaterThan(7000);
    expect(data.missingCached).toBe(data.formulas);
  });
  const res = recalcWorkbook(toWorkbookIn(data), { fallback: formulajs as never });
  it("100 % des cellules identiques à LibreOffice (tolérance relative 1e-6)", () => {
    let n = 0;
    let ok = 0;
    const bad: string[] = [];
    data.sheets.forEach((s, i) => {
      for (const [a, e] of Object.entries(expected[s.name] ?? {})) {
        const p = parseAddr(a)!;
        const got = res.values[i]!.get(p.r * KEY_COLS + p.c);
        n++;
        if (typeof e === "number" ? close(got, e) : String(got ?? "") === e) ok++;
        else if (bad.length < 5) bad.push(`${s.name}!${a}: ${String(got)} ≠ ${e}`);
      }
    });
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(7000);
    expect(ok / n).toBe(1);
    expect(res.report.failed).toBe(0);
  });
  it("productivité n°1 (ligne 12) et « dont commerciaux salariés » de la Synthèse", () => {
    const m = data.sheets.findIndex((s) => s.name === MONTHLY);
    const row12 = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"].map((c) => val(res, m, `${c}12`) ?? data.sheets[m]!.model.cells.get(11 * KEY_COLS + 2)?.v);
    expect(row12.map((v) => Math.round(Number(v) * 10000) / 10000)).toEqual([0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1, 1, 1]);
    const syn = data.sheets.findIndex((s) => s.name === "Synthèse");
    expect(["B10", "C10", "D10", "E10", "F10"].map((a) => val(res, syn, a))).toEqual([3, 9, 15, 20, 24]);
  });
});

describe("classeur fictif complet : onglets, résumé, Synthèse à deux variantes", () => {
  it("Synthèse (CA HT, effectifs) conforme à LibreOffice ; onglet conseillé = plan mensuel, Lisez-moi / Sources en dernier", () => {
    const data = loadData(join(FX, "plan-mini.xlsx"));
    const expected = JSON.parse(readFileSync(join(FX, "plan-mini.expected.json"), "utf8")) as Record<string, Record<string, number>>;
    const res = recalcWorkbook(toWorkbookIn(data), { fallback: formulajs as never });
    expect(data.sheets.map((s) => s.name)).toEqual(["Lisez-moi", "Hypothèses", MONTHLY, "Synthèse", "Sources"]);
    const syn = data.sheets.findIndex((s) => s.name === "Synthèse");
    expect(val(res, syn, "B6")).toBeCloseTo(expected["Synthèse"]!.B6!, 6);
    expect(val(res, syn, "G10")).toBe(3); // variante prudente : ROUND(3 × 0,85)
    const guesses = data.sheets.map((s, i) => guessSheet(s.name, sheetMatrix(s, res.values[i]), s.formulas)).sort((a, b) => b.score - a.score);
    expect(guesses[0]!.name).toBe(MONTHLY);
    expect(guesses.slice(-2).map((g) => g.name).sort()).toEqual(["Lisez-moi", "Sources"]);
  });
});

describe("détection de structure", () => {
  const data = loadData(join(FX, "plan-mini.xlsx"));
  const res = recalcWorkbook(toWorkbookIn(data), { fallback: formulajs as never });
  const mi = data.sheets.findIndex((s) => s.name === MONTHLY);
  const matrix = sheetMatrix(data.sheets[mi]!, res.values[mi]);
  const st = detectStructure(matrix, MONTHLY);
  const t = st.tables[st.main]!;
  it("xlsx : en-tête ligne 5, ligne « Mois » datée, 60 mois, unité, Ouverture, sections, Entité + Indicateur", () => {
    expect(t.headerRow).toBe(4);
    expect(t.timeSource).toBe("row");
    expect(t.timeRow).toBe(7);
    expect(t.layout).toBe("wide");
    expect(t.timeCols).toHaveLength(60);
    expect(new Date(t.timeCols[0]!.date!).toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(new Date(t.timeCols[59]!.date!).toISOString().slice(0, 10)).toBe("2031-12-01");
    expect(t.unitCol).toBe(1);
    expect(t.openingCol).toBe(2);
    expect(t.sections[0]).toBe("1. Équipe commerciale");
    expect(t.split).toBe(true);
    const r = t.rows.find((x) => x.label === "Commercial salarié n°3 — productivité (ramp)")!;
    expect([r.entity, r.indicator, r.unit, r.section]).toEqual(["Commercial salarié n°3", "productivité (ramp)", "%", "1. Équipe commerciale"]);
    expect(t.rows.find((x) => x.label === "Commercial salarié n°1 en poste (1/0)")?.indicator).toBe("en poste (1/0)");
    // Totaux annuels (colonnes 2027…2031) : tableau séparé
    const annual = st.tables.find((x) => /totaux annuels/.test(x.title));
    expect(annual?.timeCols.map((c) => new Date(c.date!).getUTCFullYear())).toEqual([2027, 2028, 2029, 2030, 2031]);
  });
  it("collage TSV (pourcentages « 26,7% ») : même structure", () => {
    const text = readFileSync(join(FX, "plan-commercial.tsv"), "utf8");
    const mt = parseDelimitedMatrix(text, "\t");
    const s2 = detectStructure(mt, "Collage");
    const t2 = s2.tables[s2.main]!;
    expect(t2.layout).toBe("wide");
    expect(t2.timeSource).toBe("row");
    expect(t2.openingCol).toBe(2);
    expect(t2.unitCol).toBe(1);
    expect(t2.split).toBe(true);
    const r = t2.rows.find((x) => x.label === "Commercial salarié n°1 — productivité (ramp)")!;
    r.values.slice(3, 7).forEach((v, i) => expect(v).toBeCloseTo([0.25, 0.5, 0.75, 1][i]!, 9));
    expect(new Date(t2.timeCols[0]!.date!).toISOString().slice(0, 7)).toBe("2027-01");
  });
  it("résumé « RÉSUMÉ DU SCÉNARIO » proposé comme tableau séparé (feuille synthétique)", () => {
    const m: (string | number | null)[][] = [
      ["Titre du plan", null, null, null, null],
      [null],
      ["Poste", "Unité", "M1", "M2", "M3"],
      ["Section A", null, null, null, null],
      ["Ventes", "€", "1 200,5", "1 300", "1 400"],
      ["Marge", "%", "26,7%", "30%", "31,5%"],
      [null],
      ["RÉSUMÉ DU SCÉNARIO", null, null, null, null],
      ["Besoin de financement", null, 47329.32, null, null],
      ["Point bas", null, "févr. 2027", null, null],
    ];
    const s3 = detectStructure(m, "Test");
    expect(s3.tables).toHaveLength(2);
    expect(s3.tables[0]!.rows.map((r) => r.values)).toEqual([[1200.5, 1300, 1400], [0.267, 0.3, 0.315]]);
    expect(s3.tables[0]!.timeCols.map((c) => c.label)).toEqual(["M1", "M2", "M3"]);
    expect(s3.tables[1]!.kind).toBe("summary");
    expect(s3.tables[1]!.rows[0]).toMatchObject({ label: "Besoin de financement", values: [47329.32] });
  });
  it("nombres et en-têtes temporels français", () => {
    expect(parseFrenchValue("26,7%")).toBeCloseTo(0.267);
    expect(parseFrenchValue("1 234,5")).toBe(1234.5);
    expect(parseFrenchValue("—")).toBeNull();
    expect(parseFrenchValue("(12)")).toBe(-12);
    expect(parseFrenchValue("12 345 €")).toBe(12345);
    expect(headerTime("M12")).toEqual({ index: 11, date: null });
    expect(headerTime("janv. 2027")?.date).toBe(Date.UTC(2027, 0, 1));
    expect(headerTime("Central — 2028")?.date).toBe(Date.UTC(2028, 0, 1));
    expect(headerTime("Poste")).toBeNull();
  });
  it("découpage Entité + Indicateur seulement si le motif se répète", () => {
    const rows = ["Commercial salarié n°1 en poste (1/0)", "Commercial salarié n°1 — ancienneté", "Commercial salarié n°2 en poste (1/0)", "Commercial salarié n°2 — ancienneté", "MRR total"].map((label) => ({ label, entity: null as string | null, indicator: null as string | null }));
    expect(splitLabels(rows)).toBe(true);
    expect(rows.map((r) => r.indicator)).toEqual(["en poste (1/0)", "ancienneté", "en poste (1/0)", "ancienneté", null]);
    const single = ["CA — total", "Marge brute"].map((label) => ({ label, entity: null as string | null, indicator: null as string | null }));
    expect(splitLabels(single)).toBe(false);
  });

  const lt = toLongTable(t, MONTHLY, { opening: true });
  it("large → long : Section, Poste, Entité, Indicateur, Unité, Date, Période, Valeur", () => {
    expect(lt.fields.map((f) => f.name)).toEqual([F.section, F.poste, F.entity, F.indicator, F.unit, F.date, F.period, F.value]);
    expect(lt.rows).toHaveLength(t.rows.length * 61);
    const r = lt.rows.find((x) => x[F.poste] === "Commercial salarié n°1 — productivité (ramp)" && x[F.period] === "juin 2027")!;
    expect(r[F.value]).toBeCloseTo(0.75);
    expect(lt.rows.find((x) => x[F.period] === "Ouverture")?.[F.date]).toBeNull();
    expect(lt.wide?.cols[0]?.opening).toBe(true);
  });

  it("regrouper les 24 lignes « en poste » (somme) = ligne « Commerciaux salariés en poste »", () => {
    const enPoste = lt.wide!.rows.filter((r) => r.indicator === "en poste (1/0)").map((r) => r.id);
    expect(enPoste).toHaveLength(24);
    const st0: MappingState = { ...defaultMapping(lt), series: [] };
    const st1 = groupSeries(st0, lt, { rowIds: enPoste }, "sum");
    expect(st1.series[0]!.label).toBe("Somme — en poste (1/0)");
    const p = pivot(lt, setFilter(st1, F.period, []));
    const total = lt.wide!.rows.findIndex((r) => r.label === "Commerciaux salariés en poste");
    const ref = lt.wide!.values[total]!.slice(1); // sans Ouverture
    const got = p.rows.map((r) => r["Somme — en poste (1/0)"]);
    expect(p.x).toBe(F.date);
    expect(p.xGrain).toBe("month");
    expect(got).toEqual(ref);
    expect(got.slice(-1)[0]).toBe(24);
    expect(suggestCurve(p)).toBe("step");
    // Capacité équivalent temps plein : somme des productivités
    const prod = lt.wide!.rows.filter((r) => r.indicator === "productivité (ramp)").map((r) => r.id);
    const p2 = pivot(lt, groupSeries(st0, lt, { rowIds: prod }, "sum", "Capacité ETP"));
    expect(p2.rows.slice(-1)[0]!["Capacité ETP"]).toBeCloseTo(prod.reduce((s, id) => s + (lt.wide!.values[lt.wide!.rows.findIndex((r) => r.id === id)]!.slice(-1)[0] ?? 0), 0));
  });
  it("agrégats moyenne / max / dernier, axe secondaire, Couleur, filtres", () => {
    const ids = lt.wide!.rows.filter((r) => r.indicator === "ancienneté").map((r) => r.id).slice(0, 2);
    const base: MappingState = { ...defaultMapping(lt), series: [] };
    const vals = (agg: "mean" | "max" | "last") => pivot(lt, groupSeries(base, lt, { rowIds: ids }, agg, agg)).rows.slice(-1)[0]![agg];
    const last = ids.map((id) => lt.wide!.values[lt.wide!.rows.findIndex((r) => r.id === id)]!.slice(-1)[0]!);
    expect(vals("mean")).toBeCloseTo((last[0]! + last[1]!) / 2);
    expect(vals("max")).toBe(Math.max(...last));
    expect(vals("last")).toBe(last[1]);
    let st = toggleRowSeries(base, lt, ids[0]!);
    st = toggleRowSeries(st, lt, ids[1]!);
    st = setSeriesAxis(st, st.series[1]!.id, 2);
    const p = pivot(lt, st);
    expect(p.y).toHaveLength(1);
    expect(p.y2).toBe(st.series[1]!.label);
    // Couleur = Entité, filtre Indicateur = ancienneté
    let sc = assignField({ ...base, series: [] }, lt, F.value, "y");
    sc = assignField(sc, lt, F.entity, "color");
    sc = setFilter(sc, F.indicator, ["ancienneté"]);
    const pc = pivot(lt, sc);
    expect(pc.series).toBe(F.entity);
    expect(new Set(pc.rows.map((r) => r[F.entity])).size).toBe(24);
  });
  it("X ⇄ Y : séries en catégories, années en séries ; retour à l'identique", () => {
    const annual = st.tables.find((x) => /totaux annuels/.test(x.title))!;
    const la = toLongTable(annual, "annuel");
    const ids = la.wide!.rows.filter((r) => /^Commerciaux salariés en poste$|^Capacité commerciale salariés/.test(r.label)).map((r) => r.id);
    let s: MappingState = { ...defaultMapping(la), series: [] };
    for (const id of ids) s = toggleRowSeries(s, la, id);
    const p = pivot(la, s);
    expect(p.xGrain).toBe("year");
    expect(p.y).toHaveLength(2);
    const sw = swapXY(s);
    const ps = pivot(la, sw);
    expect(ps.x).toBe("Série");
    expect(ps.series).toBe("Année");
    expect(new Set(ps.rows.map((r) => r["Série"])).size).toBe(2);
    expect(ps.rows.filter((r) => r["Année"] === "2031")).toHaveLength(2);
    expect(swapXY(sw).swapped).toBe(false);
    expect(pivot(la, swapXY(sw)).rows).toEqual(p.rows);
  });
});
