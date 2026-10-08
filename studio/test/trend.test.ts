import { describe, expect, it } from "vitest";
import { SAMPLES, sampleById } from "../src/data/samples";
import { buildDataset, type Dataset } from "../src/data/table";
import { allInsights, compareWindows, explore, type Insight } from "../src/story/insights";
import { formatGrowth, formatTimes } from "../src/story/fr";

const TODAY = Date.UTC(2026, 9, 8);
const sc = (ds: Dataset) => ({ today: TODAY, entity: ds.name });
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const day = (y: number, m: number, d = 5) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const trendOf = (ds: Dataset): Insight | undefined => allInsights(ds, sc(ds)).find((i) => i.kind === "trend");

/**
 * Affaires créées chaque mois (janv. 2025 → 8 oct. 2026) : 6 affaires de ~20 k€ par mois,
 * croissance `growth` par an, et des « méga-affaires » ponctuelles (pics de création).
 */
function created(opts: { growth?: number; spikes?: [number, number, number][]; octSpike?: number } = {}): Dataset {
  const rows: Record<string, unknown>[] = [];
  for (let t = 0; t < 21; t++) {
    const y = 2025 + Math.floor(t / 12);
    const m = t % 12;
    for (let i = 0; i < 6; i++) rows.push({ Affaire: `A${t}-${i}`, "Date de création": day(y, m, 3 + i * 4), "Montant (€)": Math.round(20_000 * Math.pow(1 + (opts.growth ?? 0), t / 12) * (1 + ((t * 7 + i * 3) % 5) / 50)) });
  }
  for (const [y, m, v] of opts.spikes ?? []) rows.push({ Affaire: `Méga ${y}-${m}`, "Date de création": day(y, m, 15), "Montant (€)": v });
  // Mois en cours (incomplet) : quelques affaires, éventuellement un pic
  rows.push({ Affaire: "Oct", "Date de création": day(2026, 9, 2), "Montant (€)": opts.octSpike ?? 15_000 });
  return buildDataset("Créations", rows);
}

describe("tendance robuste (pics, mois incomplet, pourcentages extrêmes)", () => {
  it("pics de création : pas de « +152 % », constat qualifié et rang abaissé", () => {
    const spiky = created({ spikes: [[2026, 1, 900_000], [2026, 4, 1_200_000], [2026, 7, 1_600_000]] });
    const t = trendOf(spiky)!;
    expect(t).toBeTruthy();
    const title = norm(t.analysis.title);
    expect(title).not.toMatch(/\d{3,} %/);
    expect(title).not.toMatch(/hausse de \d+ %/);
    expect(title).not.toMatch(/×/);
    expect(t.analysis.facts.confidence).toBe("faible");
    expect(t.analysis.facts.growth as number).toBeGreaterThan(1); // la somme brute a bien plus que doublé…
    expect(title).toMatch(/un an plus tôt|irrégul/); // …mais le titre le dit en valeurs absolues / avec réserve
    expect(norm(t.analysis.comments.join(" "))).toMatch(/Pic isolé|médiane/);
    expect(t.analysis.why).toMatch(/fragile/);
    // Même série sans pics : constat net, mieux classé que la version à pics
    const smooth = trendOf(created({ growth: 0.25 }))!;
    expect(smooth.analysis.facts.confidence).toBe("élevée");
    expect(t.score).toBeLessThan(smooth.score);
    expect(t.effect).toBeLessThan(0.5);
  });
  it("un seul mois exceptionnel ne suffit pas à affirmer une hausse", () => {
    const t = trendOf(created({ spikes: [[2026, 7, 400_000]] }))!;
    const title = norm(t.analysis.title);
    expect(t.analysis.facts.confidence).toBe("faible");
    expect(title).not.toMatch(/en hausse de \d+ %/);
  });
  it("mois en cours exclu : un pic au 2 octobre ne change rien", () => {
    const a = trendOf(created({ growth: 0.2 }))!;
    const b = trendOf(created({ growth: 0.2, octSpike: 5_000_000 }))!;
    expect(norm(b.analysis.title)).toBe(norm(a.analysis.title));
    expect(b.analysis.facts.growth).toBeCloseTo(a.analysis.facts.growth as number, 6);
  });
  it("cumul depuis janvier vs même période N-1 (plutôt que des fenêtres courtes)", () => {
    const t = trendOf(created({ growth: 0.2 }))!;
    expect(norm(t.analysis.title)).toMatch(/^Montant en hausse de (1[7-9]|2[0-3]) % sur un an \(janv\.–sept\. 2026 vs 2025\)$/);
    expect(norm(t.analysis.comments[0]!)).toMatch(/^Janv\.–sept\. 2026 : .* contre .* un an plus tôt/);
    expect(norm(t.analysis.comments[1]!)).toMatch(/^9 mois sur 9 au-dessus de l'an dernier/);
  });
  it("au-delà de +100 %, et seulement si le constat est net : « ×2,5 »", () => {
    const t = trendOf(created({ growth: 2.2 }))!;
    expect(t.analysis.facts.confidence).toBe("élevée");
    expect(norm(t.analysis.title)).toMatch(/^Montant : ×\d,\d sur un an/);
    expect(norm(t.analysis.title)).not.toMatch(/%/);
  });
  it("compareWindows : médianes, constance et sensibilité à un mois", () => {
    const flat = [10, 10, 10, 10, 10, 10];
    const spike = compareWindows([10, 10, 60, 10, 10, 10], flat)!;
    expect(spike.growth).toBeCloseTo(50 / 60, 5);
    expect(spike.medianGrowth).toBe(0);
    expect(spike.confident).toBe(false);
    expect(spike.headline).toBe(0);
    const steady = compareWindows([12, 12, 13, 12, 12, 13], flat)!;
    expect(steady.confident).toBe(true);
    expect(steady.consistency).toBe(1);
    expect(steady.headline).toBeCloseTo(steady.growth, 10);
    expect(compareWindows([1, 2], [0, 0])).toBeNull();
  });
  it("formats : multiplicateur au-delà de +100 %", () => {
    expect(formatTimes(2.5)).toBe("×2,5");
    expect(norm(formatGrowth(1.52))).toBe("×2,5");
    expect(norm(formatGrowth(0.12))).toBe("+12 %");
    expect(norm(formatGrowth(-0.4))).toBe("−40 %");
  });
});

describe("exemples : récit sans emballement", () => {
  it("pipeline : tendance des créations réaliste (janv.–sept. 2026 vs 2025)", () => {
    const s = sampleById("pipeline")!;
    const ds = buildDataset(s.name, s.rows());
    const t = trendOf(ds)!;
    expect(norm(t.analysis.title)).toMatch(/^Montant des opportunités créées en hausse de \d{1,2} % sur un an \(janv\.–sept\. 2026 vs 2025\)$/);
    expect(t.analysis.facts.confidence).toBe("élevée");
  });
  it("pipeline : création régulière, sans mois à plus de 2× la médiane", () => {
    const rows = sampleById("pipeline")!.rows();
    const by = new Map<string, number>();
    for (const r of rows) {
      const k = String(r["Date de création"]).slice(0, 7);
      if (k === "2026-10") continue;
      by.set(k, (by.get(k) ?? 0) + (r["Montant (€)"] as number));
    }
    const v = [...by.values()].sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)]!;
    expect(by.size).toBe(21);
    expect(Math.max(...v)).toBeLessThan(2 * med);
    expect(rows.length).toBe(300);
    expect(rows.every((r) => String(r["Date de clôture"]) <= "2026-12-31" && String(r["Date de création"]) <= "2026-10-08")).toBe(true);
  });
  it("aucun titre ni « pourquoi » à plus de 100 % (multiplicateur ou valeurs absolues à la place)", () => {
    for (const s of SAMPLES) {
      const ds = buildDataset(s.name, s.rows());
      for (const i of allInsights(ds, sc(ds))) {
        expect(norm(i.analysis.title), s.id).not.toMatch(/[+−]?\d{3,} %/);
        expect(norm(i.analysis.why), s.id).not.toMatch(/[+−]\d{3,} %/);
      }
    }
  });
  it("saisonnalité observée sur une seule année : titre qualifié et rang abaissé", () => {
    const s = sampleById("business-review")!;
    const ds = buildDataset(s.name, s.rows());
    const se = explore(ds, sc(ds)).find((i) => i.kind === "seasonality")!;
    expect(norm(se.analysis.title)).toMatch(/^Décembre, mois le plus fort en 2025 : /);
    expect(se.analysis.why).toMatch(/à confirmer/);
    const pipe = buildDataset("p", sampleById("pipeline")!.rows());
    const ps = allInsights(pipe, sc(pipe)).find((i) => i.kind === "seasonality");
    if (ps) expect(norm(ps.analysis.title)).not.toMatch(/\d{3,} %/);
  });
  it("écarts : « explique l'essentiel » réservé aux écarts totaux défavorables", () => {
    const s = sampleById("business-review")!;
    const ds = buildDataset(s.name, s.rows());
    const py = explore(ds, sc(ds)).find((i) => /sur N-1/.test(i.analysis.title))!;
    expect(py.analysis.why).not.toMatch(/explique l'essentiel/);
    expect(py.analysis.why).toMatch(/Malgré un écart favorable/);
  });
});
