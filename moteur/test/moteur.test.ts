/** Moteur AlterideaCharts : formats, thème, calculs (retour, cascade, écarts), SVG autonome, cartouche neutre. */
import { describe, expect, it } from "vitest";
import * as AC from "../src/index";
import { compact, euro, number, percent, duration, date } from "../src/format";
import { resolveTheme } from "../src/theme";
import { niceDomain, ticks } from "../src/frame";

const NN = "\u202f";
const flux = [-95000, -42000, -18000, 4000, 9000, 14000, 17000, 19000, 21000, 22000, 23000, 24000, 24500, 25000, 25000, 25500, 26000, 26000, 26500, 27000, 27000, 27500, 28000, 28000];
const gain = { points: flux.map((v, i) => ({ label: `M${i + 1}`, value: v })) };
const cascade = {
  items: [
    { label: "Licences", value: -120000 },
    { label: "Intégration", value: -65000 },
    { label: "Gain de productivité", value: 210000 },
    { label: "Ventes en plus", value: 72000 },
  ],
  total: "Gain net 3 ans",
};
const avap = {
  better: "lower" as const,
  items: [
    { label: "Clôture mensuelle", before: 38, after: 16 },
    { label: "Notes de frais", before: 9, after: 10 },
  ],
};

describe("nombres à la française", () => {
  it("espace fine insécable, virgule, signe moins typographique", () => {
    expect(number(1234567.8)).toBe(`1${NN}234${NN}568`);
    expect(number(-3.25, 2)).toBe("\u22123,25");
    expect(number(0.5, { decimals: 1, signed: true })).toBe("+0,5");
    expect(euro(12500)).toBe(`12${NN}500${NN}€`);
    expect(euro(12500, { compact: true })).toBe(`12,5${NN}k€`);
    expect(compact(1_200_000, { unit: "€" })).toBe(`1,2${NN}M€`);
    expect(compact(-185000, { unit: "€", signed: true })).toBe(`\u2212185${NN}k€`);
    expect(percent(0.324)).toBe(`32${NN}%`);
    expect(percent(-0.578, { signed: true })).toBe(`\u221258${NN}%`);
    expect(duration(13.6)).toBe(`13,6${NN}mois`);
    expect(duration(1, "ans")).toBe(`1${NN}an`);
    expect(date("2026-10-01")).toBe("1er octobre 2026");
    expect(date("2026-10-08")).toBe("8 octobre 2026");
  });
});

describe("thème", () => {
  it("pétrole par défaut, jetons validés, teintes dérivées d'une couleur perso", () => {
    const d = resolveTheme();
    expect(d.primary).toBe("#0E6E8C");
    expect(d.primarySoft).toBe("#3FA7C4");
    expect(d.primaryDeep).toBe("#08465A");
    const c = resolveTheme({ primary: "#5B2A86", positive: "not-a-color", font: "Georgia<script>" });
    expect(c.primary).toBe("#5b2a86");
    expect(c.positive).toBe(d.positive);
    expect(c.primarySoft).not.toBe(d.primarySoft);
    expect(c.font).not.toMatch(/[<>]/);
    expect(AC.theme.CSS_VARS.primary).toBe("--ac-primary");
  });
  it("graduations rondes, zéro inclus", () => {
    expect(ticks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    const [lo, hi] = niceDomain([-155000, 412000]);
    expect(lo).toBeLessThanOrEqual(-155000);
    expect(hi).toBeGreaterThanOrEqual(412000);
  });
});

describe("gain cumulé et retour sur investissement", () => {
  it("cumul, creux et délai interpolé", () => {
    const pb = AC.cumulativeGain.computePayback(flux);
    expect(pb.cum[2]).toBe(-155000);
    expect(pb.trough).toEqual({ value: -155000, index: 2 });
    // M3 −155 000 ; M12 −2 000 ; le cumul repasse à zéro au début de M13 (12 + 2 000 / 24 500)
    expect(pb.cum[11]).toBe(-2000);
    expect(pb.index).toBe(12);
    expect(pb.periods!).toBeCloseTo(12 + 2000 / 24500, 6);
    expect(AC.cumulativeGain.computePayback([10, 20]).periods).toBeNull();
    expect(AC.cumulativeGain.computePayback([-10, -5, 30], false).periods).toBeCloseTo(2 + 15 / 30, 6);
    expect(AC.cumulativeGain.computePayback([-10, -15, 15], true).periods).toBeCloseTo(2 + 0.5, 6);
  });
  it("SVG autonome : titre, rouge sous zéro, vert après, libellé du retour, valeur finale", () => {
    const svg = AC.cumulativeGain.toSVG(gain, { title: "Retour sur investissement", width: 800 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
    expect(svg).toContain(`Rentabilisé en 12${NN}mois`);
    expect(svg).toContain('stroke="#C8423B"');
    expect(svg).toContain('stroke="#1E8E5A"');
    expect(svg).toMatch(/Creux : \u2212155\u202fk€/);
    expect(svg).toContain(`+314${NN}k€`);
    expect(svg).toContain('data-ac-a="wipe"');
    // déterministe
    expect(AC.cumulativeGain.toSVG(gain, { title: "Retour sur investissement", width: 800 })).toBe(svg);
  });
});

describe("cascade d'investissement", () => {
  it("niveaux de départ / arrivée et barre de total", () => {
    const b = AC.waterfall.bars(cascade);
    expect(b.map((x) => [x.from, x.to])).toEqual([[0, -120000], [-120000, -185000], [-185000, 25000], [25000, 97000], [0, 97000]]);
    expect(b[4]!.kind).toBe("total");
    expect(b[4]!.label).toBe("Gain net 3 ans");
    expect(AC.waterfall.bars({ ...cascade, total: false })).toHaveLength(4);
    const sub = AC.waterfall.bars({ items: [{ label: "A", value: -5 }, { label: "Sous-total", value: 0, kind: "subtotal" }, { label: "B", value: 8 }] });
    expect(sub[1]).toMatchObject({ kind: "subtotal", from: 0, to: -5 });
    expect(sub[3]).toMatchObject({ kind: "total", to: 3 });
  });
  it("SVG : coûts en rouge, gains en vert, total en couleur principale, montants signés", () => {
    const svg = AC.waterfall.toSVG(cascade, { title: "Cascade" });
    expect((svg.match(/class="ac-bar ac-delta"[^>]*fill="#C8423B"/g) ?? []).length).toBe(2);
    expect((svg.match(/class="ac-bar ac-delta"[^>]*fill="#1E8E5A"/g) ?? []).length).toBe(2);
    expect(svg).toMatch(/class="ac-bar ac-total"[^>]*fill="#0E6E8C"/);
    expect(svg).toContain(`\u2212120${NN}k€`);
    expect(svg).toContain(`+210${NN}k€`);
    expect(svg).toContain(`97${NN}k€`);
  });
});

describe("avant / après", () => {
  it("écart dans le bon sens en vert, sinon rouge (better = lower)", () => {
    expect(AC.beforeAfter.delta({ label: "x", before: 38, after: 16 }, "lower").improved).toBe(true);
    expect(AC.beforeAfter.delta({ label: "x", before: 9, after: 10 }, "lower").improved).toBe(false);
    expect(AC.beforeAfter.delta({ label: "x", before: 9, after: 10 }).improved).toBe(true);
    const svg = AC.beforeAfter.toSVG(avap, { format: "number", unit: "h" });
    expect(svg).toMatch(/class="ac-delta ac-up"[^>]*fill="#1E8E5A"[^>]*>\u221258\u202f%/);
    expect(svg).toMatch(/class="ac-delta ac-down"[^>]*fill="#C8423B"[^>]*>\+11\u202f%/);
    expect(svg).toContain(`16${NN}h`);
  });
});

describe("cartouche neutre et thème perso", () => {
  it("aucune marque par défaut ; QR, dates et source si fournis ; thème appliqué", () => {
    const all = [AC.cumulativeGain.toSVG(gain), AC.waterfall.toSVG(cascade), AC.beforeAfter.toSVG(avap)].join("");
    expect(all).not.toMatch(/Datanime|Alteridea|ValueRoom/i);
    expect(all).not.toContain("ac-cartouche");
    const c = { name: "Norvia (exemple fictif)", link: "https://valueroom.io/", qr: true, dates: "Données au 8 octobre 2026", source: "Démo fictive" };
    const svg = AC.waterfall.toSVG(cascade, { cartouche: c, theme: { primary: "#5B2A86", positive: "#2E7D32", negative: "#B71C1C" } });
    expect(svg).toContain("ac-cartouche");
    expect(svg).toContain("ac-qr");
    expect(svg).toContain("Norvia (exemple fictif)");
    expect(svg).toContain("Source : Démo fictive");
    expect(svg).toMatch(/class="ac-bar ac-total"[^>]*fill="#5b2a86"/);
    const solo = AC.cartouche.toSVG(c, { width: 600 });
    expect(solo).toMatch(/^<svg[^>]+viewBox="0 0 600 /);
    expect(solo).not.toMatch(/Datanime/);
  });
  it("texte échappé (pas d'injection) et largeur minimale", () => {
    const svg = AC.waterfall.toSVG({ items: [{ label: "<b>x</b> & y", value: 5 }] }, { title: 'A "B" <C>', width: 100 });
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).toMatch(/viewBox="0 0 280 /);
  });
  it("API publique figée 0.1.0", () => {
    expect(AC.version).toBe("0.1.0");
    for (const k of ["cumulativeGain", "waterfall", "beforeAfter"] as const) {
      expect(typeof AC[k].animate).toBe("function");
      expect(typeof AC[k].toSVG).toBe("function");
      expect(typeof AC[k].toPNG).toBe("function");
    }
  });
});

describe("petits écrans", () => {
  it("cascade : mots trop longs coupés avec un trait d'union, jamais de « … » dans les libellés", async () => {
    const { hyphenate } = await import("../src/charts/waterfall");
    expect(hyphenate("Gain de productivité", 9, 34)).toMatch(/produc?-? ?/);
    expect(hyphenate("Gain de productivité", 9, 34).replace(/- /g, "")).toBe("Gain de productivité");
    // la cascade de la démo (7 barres) sur téléphone
    const long = { items: [{ label: "Licences", value: -120 }, { label: "Intégration", value: -65 }, { label: "Formation", value: -18 }, { label: "Gain de productivité", value: 210 }, { label: "Moins d'erreurs", value: 48 }, { label: "Ventes en plus", value: 72 }], total: "Gain net 3 ans" };
    for (const width of [300, 320, 340, 390]) {
      const svg = AC.waterfall.toSVG(long, { width });
      const labels = [...svg.matchAll(/class="ac-label"[^>]*>([^<]*)</g)].map((m) => m[1]);
      expect(labels.filter((l) => l!.includes("…")), `largeur ${width}`).toEqual([]);
    }
  });
  it("cartouche : une seule colonne sous 520 px (rien de tronqué)", () => {
    const c = { name: "Norvia (exemple fictif)", link: "https://valueroom.io/", qr: true, dates: ["Données au 8 octobre 2026"], source: "Données fictives" };
    const svg = AC.cartouche.toSVG(c, { width: 340 });
    expect(svg).toContain("Données au 8 octobre 2026<");
    expect(svg).toContain("Norvia (exemple fictif)<");
    expect(svg).not.toContain("…");
  });
});
