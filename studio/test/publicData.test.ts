/**
 * Section « Données publiques » : exemples ouverts groupés par thème, licence compatible avec un usage commercial,
 * source + licence dans le cartouche, histoire suggérée de 3 à 5 snapshots pour « Créer un Reel ».
 */
import { describe, expect, it } from "vitest";
import { PUBLIC_THEMES, RENOUVELABLES_SOURCE, SAMPLES, publicSourceLine, sampleById } from "../src/data/samples";
import { licenceFromSource, stripLicence } from "../src/data/licence";
import { buildDataset } from "../src/data/table";
import { parseSpec } from "../src/spec";

/** Licences acceptées : réutilisation commerciale permise (mention de la source). */
const COMMERCIAL_OK = /^(CC BY 4\.0|CC0 1\.0|CC BY 3\.0 IGO|Licence Ouverte 2\.0|Licence ouverte \/ Open Licence 2\.0|Etalab 2\.0|Domaine public)/i;
const FORBIDDEN = /certifi|conforme|authenticit|preuve/i;
const pub = SAMPLES.filter((s) => s.publicData);

describe("Données publiques", () => {
  it("thèmes affichés dans l'ordre, l'exemple Eurostat (renouvelables) y est rangé", () => {
    expect([...PUBLIC_THEMES]).toEqual(["Dette publique", "CO₂ & climat", "Démographie", "Nature"]);
    expect(sampleById("renouvelables")?.publicData?.theme).toBe("CO₂ & climat");
    expect(pub.length).toBeGreaterThanOrEqual(8);
    for (const s of pub) expect(PUBLIC_THEMES).toContain(s.publicData!.theme);
    for (const t of PUBLIC_THEMES) expect(pub.some((s) => s.publicData!.theme === t), t).toBe(true);
    expect(sampleById("population-mondiale")?.licence).toMatch(/CC BY 3\.0 IGO/);
    expect(sampleById("co2-mauna-loa")?.licence).toMatch(/Domaine public/i);
  });

  it("licence commerciale, source + licence pré-remplies dans le cartouche, vocabulaire sobre", () => {
    for (const s of pub) {
      const src = String(s.spec.style?.source ?? "");
      expect(src, s.id).toMatch(/^Source : /);
      const lic = licenceFromSource(src);
      expect(lic, s.id).toMatch(COMMERCIAL_OK);
      expect(s.licence ?? "", s.id).toMatch(COMMERCIAL_OK);
      expect(`${s.name} ${s.description} ${src}`).not.toMatch(FORBIDDEN);
    }
  });

  it("histoire suggérée : 3 à 5 snapshots valides sur les colonnes de l'exemple, identifiants stables", async () => {
    for (const s of pub) {
      if (!s.publicData!.reel) continue;
      const a = await s.publicData!.reel();
      const b = await s.publicData!.reel();
      expect(a.snapshots.length, s.id).toBeGreaterThanOrEqual(3);
      expect(a.snapshots.length, s.id).toBeLessThanOrEqual(5);
      expect(a.snapshots.map((x) => x.id)).toEqual(b.snapshots.map((x) => x.id));
      expect(a.title.length).toBeGreaterThan(3);
      const ds = buildDataset(s.name, s.rows());
      const cols = new Set(ds.columns.map((c) => c.name));
      for (const snap of a.snapshots) {
        expect(parseSpec(snap.spec).ok, snap.id).toBe(true);
        expect(snap.sampleId, snap.id).toBe(s.id);
        const enc = (snap.spec as { encoding: { x: string | null; y: string[] } }).encoding;
        if (enc.x) expect(cols.has(enc.x), `${snap.id} : ${enc.x}`).toBe(true);
        for (const y of enc.y) expect(cols.has(y), `${snap.id} : ${y}`).toBe(true);
        expect(snap.id, snap.id).toMatch(/^[a-z0-9]+-[0-9]{2}-[a-z0-9-]+$/);
        expect(licenceFromSource(snap.source), snap.id).toMatch(COMMERCIAL_OK);
        expect(`${snap.title} ${snap.subtitle} ${snap.comments.join(" ")}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("ligne de source : licence lisible et retirée du Reel (ligne de licence à part)", () => {
    expect(RENOUVELABLES_SOURCE).toBe("Source : Eurostat (nrg_ind_ren) · 2025 provisoire · données adaptées · Licence : CC BY 4.0");
    for (const smp of SAMPLES.filter((x) => x.publicData && /Eurostat/.test((x.spec.style as { source?: string } | undefined)?.source ?? ""))) {
      expect((smp.spec.style as { source?: string }).source).toMatch(/Source : Eurostat \([a-z0-9_, ]+\)/);
      expect((smp.spec.style as { source?: string }).source).toMatch(/données adaptées/);
    }
    const line = publicSourceLine("Source : Eurostat (nrg_ind_ren) · 2025 provisoire", "CC BY 4.0");
    expect(line).toBe("Source : Eurostat (nrg_ind_ren) · 2025 provisoire · Licence : CC BY 4.0");
    expect(licenceFromSource(line)).toBe("CC BY 4.0");
    expect(stripLicence(line)).toBe("Source : Eurostat (nrg_ind_ren) · 2025 provisoire");
    expect(licenceFromSource(`${line} · données modifiées`)).toBe("CC BY 4.0");
    expect(stripLicence(`${line} · données modifiées`)).toBe("Source : Eurostat (nrg_ind_ren) · 2025 provisoire · données modifiées");
    expect(licenceFromSource("Source : CRM Norvia (données fictives)")).toBe("");
  });
});

describe("carte d'un taux (%) : niveaux comparés, jamais additionnés", () => {
  it("zones protégées 2023, fond Europe : « X en tête, Y en dernier », moyenne simple", async () => {
    const { narrate } = await import("../src/story/narrate");
    const s = sampleById("zones-protegees-ue")!;
    const ds = buildDataset(s.name, s.rows());
    const r = parseSpec({
      ...s.spec,
      type: "map",
      encoding: { x: "Année", y: ["Surface protégée (%)"], lat: "Latitude", lon: "Longitude", label: "Pays" },
      special: { mapRegion: "europe" },
      mode: { kind: "static" },
      axes: { y: { unit: "pct" } },
      transform: { filters: [{ field: "Année", op: "gte", value: Date.UTC(2023, 0, 1) }, { field: "Année", op: "lt", value: Date.UTC(2024, 0, 1) }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = narrate(r.spec, ds, { today: new Date("2026-10-08"), entity: ds.name } as never)!;
    expect(n.title).toMatch(/^Bulgarie en tête \(44.%\), .+ en dernier \(\d+.%\)$/u);
    expect(n.comments.join(" ")).toMatch(/moyenne simple/);
    expect(`${n.title} ${n.comments.join(" ")}`).not.toMatch(/\d{3,}.%|pèsent/u);
  });
});
