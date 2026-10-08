import { describe, expect, it } from "vitest";
import { SAMPLES, sampleById } from "../src/data/samples";
import { buildDataset, type Dataset } from "../src/data/table";
import { explore, detectCandidates, type Insight, type InsightKind } from "../src/story/insights";

const TODAY = Date.UTC(2026, 9, 8);
const sc = (ds: Dataset) => ({ today: TODAY, entity: ds.name });
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const sample = (id: string) => {
  const s = sampleById(id)!;
  return buildDataset(s.name, s.rows());
};
const byKind = (ins: Insight[], k: InsightKind) => ins.filter((i) => i.kind === k);
const iso = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;

/** Série mensuelle synthétique (2 ans) : croissance + pic de décembre, 4 régions inégales. */
function monthly(opts: { growth?: number; decPeak?: number; shares?: number[]; outlier?: boolean } = {}): Dataset {
  const rows: Record<string, unknown>[] = [];
  const regions = ["Nord", "Sud", "Est", "Ouest"];
  const shares = opts.shares ?? [0.25, 0.25, 0.25, 0.25];
  for (let y = 2024; y <= 2026; y++)
    for (let m = 0; m < 12; m++) {
      if (y === 2026 && m > 8) continue;
      const t = (y - 2024) * 12 + m;
      const base = 100_000 * Math.pow(1 + (opts.growth ?? 0), t / 12) * (m === 11 ? 1 + (opts.decPeak ?? 0) : 1);
      regions.forEach((r, i) => rows.push({ Mois: iso(y, m), Région: r, "Ventes (€)": Math.round(base * shares[i]! * (1 + ((t * 7 + i * 3) % 5) / 100)) }));
    }
  return buildDataset("Test mensuel", rows);
}

describe("détecteurs (déterministes)", () => {
  it("tendance : hausse détectée et chiffrée", () => {
    const ins = explore(monthly({ growth: 0.2 }), sc(monthly()));
    const t = byKind(ins, "trend")[0];
    expect(t, "insight tendance").toBeTruthy();
    expect(norm(t!.analysis.title)).toMatch(/hausse de (1[5-9]|2[0-5]) %/);
    expect(t!.analysis.role).toBe("context");
  });
  it("tendance : baisse", () => {
    const ds = monthly({ growth: -0.25 });
    const t = byKind(explore(ds, sc(ds)), "trend")[0];
    expect(norm(t!.analysis.title)).toMatch(/baisse/);
  });
  it("concentration / Pareto : part des premiers", () => {
    const ds = monthly({ shares: [0.62, 0.2, 0.1, 0.08] });
    const c = byKind(detectCandidatesAndExplore(ds), "concentration")[0];
    expect(c).toBeTruthy();
    expect(norm(c!.analysis.title)).toMatch(/Nord|régions? concentrent|62 %/);
  });
  it("classement / dispersion : leader et écart à la moyenne", () => {
    const ds = monthly({ shares: [0.55, 0.2, 0.15, 0.1] });
    const r = byKind(detectCandidatesAndExplore(ds), "ranking")[0];
    expect(r).toBeTruthy();
    expect(norm(r!.analysis.title)).toMatch(/Nord en tête : 2,2× la moyenne des régions/);
  });
  it("saisonnalité : mois de pic", () => {
    const ds = monthly({ decPeak: 0.6 });
    const s = byKind(explore(ds, sc(ds)), "seasonality")[0];
    expect(s).toBeTruthy();
    expect(norm(s!.analysis.title)).toMatch(/^Décembre, mois le plus fort : \+\d+ %/);
  });
  it("valeurs atypiques : IQR / z-score", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ Affaire: `A${i}`, Segment: ["PME", "ETI", "GE"][i % 3], "Montant (€)": 10_000 + ((i * 37) % 11) * 900 }));
    rows.push({ Affaire: "Méga", Segment: "GE", "Montant (€)": 420_000 }, { Affaire: "Giga", Segment: "GE", "Montant (€)": 510_000 });
    const ds = buildDataset("Affaires", rows);
    const o = byKind(detectCandidatesAndExplore(ds), "outlier")[0];
    expect(o).toBeTruthy();
    expect(norm(o!.analysis.title)).toMatch(/2 affaires? hors norme/);
  });
  it("corrélation entre deux mesures", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ Canal: `C${i}`, Leads: 100 + i * 40, "Clients signés": 10 + i * 4 + (i % 3) }));
    const ds = buildDataset("Canaux", rows);
    const c = byKind(detectCandidatesAndExplore(ds), "correlation")[0];
    expect(c).toBeTruthy();
    expect(norm(c!.analysis.title)).toMatch(/Lien fort entre leads et clients signés \(r = (0,9\d|1)\)/);
  });
  it("écarts de scénarios (business review) : budget, N-1, atterrissage", () => {
    const ds = sample("business-review");
    const v = byKind(explore(ds, sc(ds)), "variance").map((i) => norm(i.analysis.title));
    expect(v.some((t) => /sous le budget de 2,5 % \(−233 k€\) : Nouvelle-Aquitaine décroche \(−18 %\)/.test(t))).toBe(true);
    expect(v.some((t) => /sur N-1/.test(t))).toBe(true);
    expect(v.some((t) => /^Atterrissage 2026 à 98 % du budget/.test(t))).toBe(true);
    const under = explore(ds, sc(ds)).find((i) => /budget de 2,5/.test(norm(i.analysis.title)))!;
    expect(under.spec.type).toBe("variance");
    expect(under.analysis.role).toBe("tension");
  });
  it("pipeline : concentration T4, retards, transformation, ancienneté, pondéré, clôtures", () => {
    const ds = sample("pipeline");
    const ins = explore(ds, sc(ds));
    const titles = ins.map((i) => norm(i.analysis.title));
    expect(titles).toContain("Le pipeline T4 repose à 53 % sur 2 comptes");
    expect(titles.some((t) => /^22 affaires en retard : \d+ k€/.test(t))).toBe(true);
    const kinds = new Set(ins.map((i) => i.kind));
    expect(kinds.has("pipelineConversion")).toBe(true);
    // Tous les détecteurs pipeline produisent un candidat valide (même s'ils ne sont pas retenus dans le top 8)
    const all = detectCandidates(ds, sc(ds)).map((i) => i.kind);
    for (const k of ["pipelineWeighted", "pipelineSlipping", "pipelineAging", "pipelineConversion", "pipelineCloseMonth", "geo"] as InsightKind[]) expect(all, k).toContain(k);
    const slip = ins.find((i) => i.kind === "pipelineSlipping")!;
    expect(slip.analysis.role).toBe("recommendation");
    expect(slip.spec.transform.filters.some((f) => f.op === "lt")).toBe(true);
  });
  it("géographie : carte FR/BE proposée quand il y a des codes postaux ou des régions", () => {
    for (const id of ["pipeline", "business-review", "ventes"]) {
      const ds = sample(id);
      const g = byKind(explore(ds, sc(ds)), "geo")[0];
      expect(g, id).toBeTruthy();
      expect(g!.spec.type).toBe("map");
      expect(g!.spec.encoding.postal).toBeTruthy();
    }
  });
});

function detectCandidatesAndExplore(ds: Dataset): Insight[] {
  // explore() garde le meilleur par groupe ; detectCandidates() expose tous les candidats valides
  return [...explore(ds, sc(ds), { max: 8 }), ...detectCandidates(ds, sc(ds))];
}

const SMALL = new Set(["postes", "dossiers", "objectifs", "renouvelables"]);

describe("Explorer : classement et dédoublonnage", () => {
  for (const s of SAMPLES) {
    it(`« ${s.name} » : 5 à 8 pistes, titres uniques, scores décroissants à type égal`, () => {
      const ds = buildDataset(s.name, s.rows());
      const ins = explore(ds, sc(ds));
      // échantillons « barres racontées » (étape I) et données publiques Eurostat (3 colonnes) : peu de colonnes → moins de pistes
      expect(ins.length).toBeGreaterThanOrEqual(SMALL.has(s.id) ? 2 : 5);
      expect(ins.length).toBeLessThanOrEqual(8);
      expect(new Set(ins.map((i) => i.analysis.title)).size).toBe(ins.length);
      expect(new Set(ins.map((i) => i.id)).size).toBe(ins.length);
      for (const i of ins) {
        expect(i.analysis.why.length).toBeGreaterThan(10);
        expect(i.analysis.comments.length).toBeGreaterThanOrEqual(1);
        expect(i.analysis.comments.length).toBeLessThanOrEqual(3);
        expect(i.spec.story.kind).toBe(i.kind);
        expect(i.spec.story.basis).toBeTruthy();
      }
    });
  }
  it("déterministe : deux appels donnent le même résultat", () => {
    const ds = sample("pipeline");
    expect(explore(ds, sc(ds)).map((i) => i.id)).toEqual(explore(ds, sc(ds)).map((i) => i.id));
  });
  it("les couleurs rouge / vert ne servent qu'aux écarts", () => {
    for (const s of SAMPLES) {
      const ds = buildDataset(s.name, s.rows());
      for (const i of explore(ds, sc(ds))) expect(JSON.stringify(i.spec.style.paletteCustom)).not.toMatch(/d62839|2e9e4f/i);
    }
  });
});
