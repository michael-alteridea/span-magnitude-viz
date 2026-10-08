import { describe, expect, it } from "vitest";
import {
  agree,
  count,
  dayMonthYear,
  de,
  formatAmount,
  formatInt,
  formatPct,
  formatPoints,
  formatRatio,
  formatSignedAmount,
  formatSignedPct,
  generatedOn,
  joinList,
  le,
  measureLabel,
  monthYear,
  nounOf,
  partitive,
  periodLabel,
  plural,
  pluralize,
  quarterOf,
} from "../src/story/fr";

const NB = "\u00a0";
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("textes français : nombres", () => {
  it("entiers avec espace insécable des milliers", () => {
    expect(formatInt(1234567)).toBe(`1${NB}234${NB}567`);
    expect(norm(formatInt(-8450))).toBe("\u22128 450");
  });
  it("montants compacts : €, k€, M€", () => {
    expect(norm(formatAmount(8450))).toBe("8 450 €");
    expect(norm(formatAmount(84_300))).toBe("84 k€");
    expect(norm(formatAmount(1_420_000))).toBe("1,4 M€");
    expect(norm(formatAmount(-233_000))).toBe("\u2212233 k€");
    expect(norm(formatSignedAmount(12_000))).toBe("+12 k€");
  });
  it("pourcentages : virgule décimale, sans zéro inutile, signe moins typographique", () => {
    expect(norm(formatPct(0.6))).toBe("60 %");
    expect(norm(formatPct(0.072))).toBe("7,2 %");
    expect(norm(formatPct(0.07))).toBe("7 %");
    expect(norm(formatSignedPct(-0.025))).toBe("\u22122,5 %");
    expect(norm(formatSignedPct(0.11))).toBe("+11 %");
  });
  it("points et ratios", () => {
    expect(norm(formatPoints(11))).toBe("+11 pts");
    expect(norm(formatPoints(1))).toBe("+1 pt");
    expect(formatRatio(1.94)).toBe("1,9×");
  });
});

describe("textes français : accords et pluriels", () => {
  it("pluriel : |n| < 2 au singulier", () => {
    expect(plural(1, "compte")).toBe("compte");
    expect(plural(1.5, "compte")).toBe("compte");
    expect(plural(0, "affaire")).toBe("affaire");
    expect(plural(2, "affaire")).toBe("affaires");
    expect(norm(count(3, "compte"))).toBe("3 comptes");
    expect(norm(count(1, "région"))).toBe("1 région");
  });
  it("pluriels irréguliers (-al → -aux, -eau → -eaux)", () => {
    expect(pluralize("canal")).toBe("canaux");
    expect(pluralize("commercial")).toBe("commerciaux");
    expect(pluralize("tableau")).toBe("tableaux");
    expect(pluralize("pays")).toBe("pays");
    expect(pluralize("ligne de produit")).toBe("lignes de produit");
  });
  it("noms de colonnes → nom, genre", () => {
    expect(nounOf("Région")).toMatchObject({ sg: "région", pl: "régions", f: true });
    expect(nounOf("Compte")).toMatchObject({ sg: "compte", pl: "comptes", f: false });
    expect(nounOf("Propriétaire").pl).toMatch(/commerciaux|propriétaires/);
    expect(agree(nounOf("Région"), "premiers", "premières")).toBe("premières");
  });
  it("listes, élisions, partitif", () => {
    expect(joinList(["A"])).toBe("A");
    expect(joinList(["A", "B"])).toBe("A et B");
    expect(joinList(["A", "B", "C"])).toBe("A, B et C");
    expect(de("Île-de-France")).toBe("d'Île-de-France");
    expect(de("Lyon")).toBe("de Lyon");
    expect(le("objectif")).toBe("l'objectif");
    expect(partitive("chiffre d'affaires")).toBe("du chiffre d'affaires");
    expect(partitive("marge")).toBe("de la marge");
    expect(partitive("montant")).toBe("du montant");
  });
  it("libellé de mesure sans unité", () => {
    expect(measureLabel("Montant (€)")).toBe("montant");
    expect(measureLabel("CA (€)")).toBe("CA");
  });
});

describe("textes français : dates", () => {
  const oct8 = Date.UTC(2026, 9, 8);
  it("jour, mois, trimestre, période", () => {
    expect(norm(dayMonthYear(oct8))).toBe("8 oct. 2026");
    expect(norm(dayMonthYear(Date.UTC(2026, 0, 1)))).toBe("1er janv. 2026");
    expect(monthYear(oct8)).toBe("oct. 2026");
    expect(quarterOf(oct8)).toBe("T4 2026");
    expect(norm(periodLabel(Date.UTC(2025, 0, 1), Date.UTC(2026, 8, 1)))).toBe("janv. 2025 – sept. 2026");
  });
  it("date de génération du label qualité", () => {
    expect(norm(generatedOn(new Date(2026, 9, 8, 15, 30)))).toBe("Généré le 8 oct. 2026");
  });
});
