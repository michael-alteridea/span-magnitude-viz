import { describe, expect, it } from "vitest";
import { countUpText, END_CARD_S, extractKeyNumber, fitDurations, frameCount, locate, parseKeyNumber, REEL_FORMATS, REEL_MAX_S, REEL_MIN_S, reelProblems, sceneLayout, shortTitle, totalDuration, type ReelFormatKey, type ReelPlan } from "../src/reel/plan";
import { balancedWrap, glueUnits, ReelComposer, REEL_TAGLINE } from "../src/reel/compose";
import { defaultPlan, sourceOf } from "../src/reel/scenes";
import { reelExampleSnapshots } from "../src/reel/example";
import { renouvelablesRows, sampleById, sampleLicence } from "../src/data/samples";
import { PLATFORM_HOST, PLATFORM_URL } from "../src/brand";

const NB = "\u00a0";
const inside = (b: { x: number; y: number; w: number; h: number }, s: { x: number; y: number; w: number; h: number }) => b.x >= s.x - 12.5 && b.y >= s.y - 0.5 && b.x + b.w <= s.x + s.w + 12.5 && b.y + b.h <= s.y + s.h + 0.5;

describe("Reel : formats et mise en page", () => {
  it("9:16 1080 × 1920, 1:1 1080 × 1080, 16:9 1920 × 1080 ; zones de sécurité dans le cadre", () => {
    expect([REEL_FORMATS["9x16"].w, REEL_FORMATS["9x16"].h]).toEqual([1080, 1920]);
    expect([REEL_FORMATS["1x1"].w, REEL_FORMATS["1x1"].h]).toEqual([1080, 1080]);
    expect([REEL_FORMATS["16x9"].w, REEL_FORMATS["16x9"].h]).toEqual([1920, 1080]);
    // 9:16 : marges Instagram / TikTok (barre du haut, colonne d'icônes à droite, légende en bas)
    const s = REEL_FORMATS["9x16"].safe;
    expect(s.y).toBeGreaterThanOrEqual(200);
    expect(1080 - (s.x + s.w)).toBeGreaterThanOrEqual(140);
    expect(1920 - (s.y + s.h)).toBeGreaterThanOrEqual(380);
  });

  it.each(["9x16", "1x1", "16x9"] as ReelFormatKey[])("%s : titre, chiffre, légende, graphique et cartouche dans la zone de sécurité, sans chevauchement", (fk) => {
    const f = REEL_FORMATS[fk];
    for (const lines of [1, 2, 3])
      for (const num of [true, false])
        for (const cap of [0, 1, 2]) {
          const l = sceneLayout(fk, Math.min(lines, fk === "1x1" ? 2 : 4), num, cap);
          expect(inside(l.chart, f.safe)).toBe(true);
          expect(inside(l.cartouche, f.safe)).toBe(true);
          expect(l.chart.h).toBeGreaterThan(fk === "1x1" ? 330 : 400);
          expect(l.chart.y + l.chart.h).toBeLessThanOrEqual(l.cartouche.y);
          const textBottom = l.caption ? l.caption.y + (Math.max(1, cap) - 1) * l.caption.fs * l.caption.lh + l.caption.fs * 0.3 : l.number ? l.number.y + l.number.fs * 0.25 : l.title.y + Math.min(lines, l.title.maxLines) * l.title.fs * l.title.lh;
          if (fk !== "16x9") expect(textBottom).toBeLessThanOrEqual(l.chart.y);
          else expect(l.title.x + l.title.w).toBeLessThan(l.chart.x);
          if (l.number) expect(l.number.y - l.number.fs * 0.74).toBeGreaterThanOrEqual(l.title.y + Math.min(lines, l.title.maxLines) * l.title.fs * l.title.lh - 1);
        }
  });
});

describe("Reel : chiffre clé et titres", () => {
  it.each([
    ["2 postes concentrent 59 % des dépenses", `59${NB}%`],
    ["4 commerciaux sur 6 ont atteint leur objectif", `4${NB}sur${NB}6`],
    ["Budget 2026 : −0,4 M€ vs Réel 2025", `−0,4${NB}M€`],
    ["Belgique : ×7,8 depuis 2004", "×7,8"],
    ["Chiffre d'affaires 1 234 k€ au T3 2026", `1${NB}234${NB}k€`],
  ])("« %s » → %s", (t, k) => expect(extractKeyNumber(t)).toBe(k));

  it("ni année seule ni numéro de trimestre ; repli sur les commentaires", () => {
    expect(extractKeyNumber("Ventes du T3 2026 par région")).toBeNull();
    expect(extractKeyNumber("Ventes du T3 2026 par région", "La région Ouest pèse 31 % du total.")).toBe(`31${NB}%`);
  });

  it("compte de 0 à la valeur, format français, décimales et signe d'origine", () => {
    const a = parseKeyNumber(`26,2${NB}%`)!;
    expect(countUpText(a, 0)).toBe(`0,0${NB}%`);
    expect(countUpText(a, 1)).toBe(`26,2${NB}%`);
    const b = parseKeyNumber(`−0,4${NB}M€`)!;
    expect(b.value).toBeCloseTo(-0.4);
    expect(countUpText(b, 0.5)).toMatch(/^−0,[1-4]\u00a0M€$/);
    const c = parseKeyNumber(`+12${NB}340${NB}€`)!;
    expect(c.value).toBe(12340);
    expect(countUpText(c, 0.999)).toMatch(/^\+12\u00a0[0-9]{3}\u00a0€$/);
    expect(countUpText(parseKeyNumber("×7,8")!, 0)).toBe("×0,0");
    expect(parseKeyNumber("aucun")).toBeNull();
  });

  it("titre court : première proposition, sinon coupé sur un mot", () => {
    expect(shortTitle("La Suède en tête avec 65,4 %")).toBe("La Suède en tête avec 65,4 %");
    expect(shortTitle("Le chiffre d'affaires progresse de 12 % : la région Ouest porte la croissance du trimestre")).toBe("Le chiffre d'affaires progresse de 12 %");
    const t = shortTitle("Une phrase vraiment très longue sans aucune ponctuation qui continue encore et encore");
    expect(t.length).toBeLessThanOrEqual(56);
    expect(t.endsWith("…")).toBe(true);
  });

  it("pas de coupure entre un nombre et son unité ; coupure équilibrée", () => {
    expect(glueUnits("Budget 2026 : −0,4 M€ vs Réel 2025")).toBe(`Budget 2026 : −0,4${NB}M€ vs Réel 2025`);
    const l = balancedWrap("La Belgique ferme la marche : 14,9 %", 600, 58, "sans-serif", 800, 3);
    expect(l.length).toBe(2);
    expect(l[1]!.split(" ").length).toBeGreaterThan(1);
  });
});

describe("Reel : durées et chronologie", () => {
  it("total (carte de fin comprise) toujours entre 15 et 30 s", () => {
    for (const durs of [[2, 2, 2], [3.5, 3.5, 3.5], [8, 8, 8, 8, 8], [7, 7, 7, 7, 7], [5, 5, 5, 5]]) {
      const out = fitDurations(durs);
      const tot = out.reduce((a, b) => a + b, 0) + END_CARD_S;
      expect(tot).toBeGreaterThanOrEqual(REEL_MIN_S - 1e-9);
      expect(tot).toBeLessThanOrEqual(REEL_MAX_S + 1e-9);
    }
  });

  it("locate : scènes puis carte de fin ; nombre d'images = durée × 30", () => {
    const p = { scenes: [{ duration: 5 }, { duration: 6 }], endDuration: 3, fps: 30 } as unknown as ReelPlan;
    expect(locate(p, 0)).toMatchObject({ kind: "scene", index: 0, t: 0 });
    expect(locate(p, 5.2)).toMatchObject({ kind: "scene", index: 1 });
    expect(locate(p, 11.5)).toMatchObject({ kind: "end" });
    expect(totalDuration(p)).toBe(14);
    expect(frameCount(p)).toBe(420);
  });
});

describe("Reel : exemple public (Eurostat, CC BY 4.0)", () => {
  it("données : 28 entités × 22 ans, UE-27 2025 = 26,2 %, source et licence réutilisables commercialement", () => {
    const rows = renouvelablesRows();
    expect(rows.length).toBe(28 * 22);
    expect(rows.find((r) => r.Pays === "UE-27" && r["Année"] === "2025")?.["Part des renouvelables (%)"]).toBe(26.2);
    const sm = sampleById("renouvelables")!;
    expect(sm.licence).toMatch(/CC BY 4\.0/);
    expect(sampleLicence("renouvelables")).toMatch(/CC BY 4\.0/);
    expect(sampleLicence("ventes")).toBe("Données fictives (démonstration)");
  });

  it("4 snapshots aux identifiants stables, chiffres calculés depuis les données", () => {
    const snaps = reelExampleSnapshots(new Date("2026-10-08T10:00:00Z"));
    expect(snaps.map((s) => s.id)).toEqual(["eurostat-01-ue", "eurostat-02-top10", "eurostat-03-derniers", "eurostat-04-belgique"]);
    const plan = defaultPlan(snaps, { format: "9x16", links: snaps.map(() => ({ linkIn: null, linkOut: null })), licence: "CC BY 4.0 (Eurostat)", generatedAt: "Généré le 8 oct. 2026" });
    expect(plan.scenes.map((s) => s.number)).toEqual([`26,2${NB}%`, `65,4${NB}%`, `14,9${NB}%`, "×7,8"]);
    expect(plan.scenes[1]!.title).toContain("Suède");
    expect(plan.scenes[2]!.title).toContain("Belgique");
    expect(plan.source).toBe(sourceOf(snaps));
    expect(plan.source).toMatch(/^Source : Eurostat/);
    const tot = totalDuration(plan);
    expect(tot).toBeGreaterThanOrEqual(15);
    expect(tot).toBeLessThanOrEqual(30);
    expect(reelProblems(plan)).toEqual([]);
  });

  it("source ou licence vide, plus de 5 scènes : export bloqué avec un message", () => {
    const snaps = reelExampleSnapshots();
    const plan = defaultPlan(snaps, { format: "1x1", links: snaps.map(() => ({ linkIn: null, linkOut: null })), licence: "", generatedAt: "x" });
    plan.source = "";
    const probs = reelProblems(plan);
    expect(probs.some((p) => /source des données/.test(p))).toBe(true);
    expect(probs.some((p) => /licence des données/.test(p))).toBe(true);
    const many = { ...plan, source: "s", licence: "l", scenes: [...plan.scenes, ...plan.scenes.slice(0, 2)].map((s) => ({ ...s, duration: 4 })) };
    expect(reelProblems(many).some((p) => /5 snapshots au plus/.test(p))).toBe(true);
  });
});

describe("Reel : image composée (SVG autonome, déterministe)", () => {
  const snaps = reelExampleSnapshots(new Date("2026-10-08T10:00:00Z"));
  const plan = defaultPlan(snaps, { format: "9x16", links: snaps.map(() => ({ linkIn: null, linkOut: null })), licence: "CC BY 4.0 (Eurostat)", generatedAt: "Généré le 8 oct. 2026" });
  const comp = new ReelComposer(plan, { fontCss: "/*polices*/", chart: (i, t) => `<svg data-chart="${i}" data-t="${t.toFixed(2)}"/>` });

  it("scène : titre, chiffre qui compte, graphique, cartouche (logo, date, source, licence, QR vers la plateforme)", () => {
    const early = comp.frameSvg(0.3);
    const svg = comp.frameSvg(3);
    expect(svg).toMatch(/^<svg [^>]*width="1080" height="1920"/);
    expect(svg).toContain("/*polices*/");
    expect(svg).toContain('class="reel-title"');
    expect(svg).toContain(`>26,2${NB}%</text>`);
    expect(early).not.toContain(`>26,2${NB}%</text>`);
    expect(svg).toContain('data-chart="0"');
    expect(svg).toContain("Généré le 8 oct. 2026");
    expect(svg).toContain("Source : Eurostat");
    expect(svg).toContain("Licence des données : CC BY 4.0");
    expect(svg).toContain(`data-qr="${PLATFORM_URL}"`);
    expect(comp.frameSvg(3)).toBe(svg);
  });

  it("carte de fin : mot-symbole, accroche « Vos données. Racontées. », lien et QR", () => {
    const end = comp.frameSvg(totalDuration(plan) - 0.1);
    expect(end).toContain('data-end="1"');
    expect(end).toContain("reel-end-wordmark");
    expect(REEL_TAGLINE).toBe("Vos données. Racontées.");
    expect(end).toMatch(/Vos données\.(<\/text>.*?>| )Racontées\./);
    expect(end).toContain(PLATFORM_HOST);
    expect(end).toContain("reel-end-qr");
    expect(end).not.toMatch(/certifi|conforme|authenticit|preuve/i);
  });
});

describe("annotation de barre mise en avant (Reel et Studio)", () => {
  it("taux en % : pas de « part du total » ; montants : part affichée", async () => {
    const { focusTexts } = await import("../src/charts/barDeco");
    const fmt = (v: number) => `${v.toLocaleString("fr-FR")} %`;
    expect(focusTexts("Suède", 65.4, [65.4, 53, 48.2], 0, fmt, { title: "", note: "" }, false).title).toBe(`Suède\u00a0: ${fmt(65.4)}`);
    expect(focusTexts("Équipe", 50, [50, 30, 20], 0, (v) => `${v} k€`, { title: "", note: "" }).title).toBe("Équipe\u00a0: 50 k€ (50\u00a0% du total)");
  });
  it("barres horizontales : l'annotation va à hauteur des barres les plus courtes, au plus près de la mise en avant", async () => {
    const { calloutWindow } = await import("../src/charts/cartesian");
    expect(calloutWindow([65, 53, 48, 46, 44, 42, 38, 36, 28, 27], 0, 4)).toEqual({ start: 6, max: 38 });
    expect(calloutWindow([10, 10, 10, 10], 3, 2).start).toBe(2);
  });
});

describe("WebM (repli MediaRecorder) : durée dans l'en-tête", () => {
  it("ajoute Duration dans Segment › Info (taille de segment inconnue), une seule fois", async () => {
    const { webmWithDuration } = await import("../src/reel/encode");
    const hex = "1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102185380670" + "1ffffffffffffff" + "1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d65" + "1654ae6b";
    const buf = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const fix = webmWithDuration(buf, 24400)!;
    expect(fix).not.toBeNull();
    expect(fix.cut).toBe(buf.length - 4);
    const h = fix.head;
    const info = h.indexOf(0x15);
    expect([...h.subarray(info, info + 5)]).toEqual([0x15, 0x49, 0xa9, 0x66, 0x80 | (25 + 11)]);
    const d = h.length - 11;
    expect([...h.subarray(d, d + 3)]).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(h.buffer, h.byteOffset + d + 3, 8).getFloat64(0)).toBe(24400);
    const again = new Uint8Array([...h, ...buf.subarray(fix.cut)]);
    expect(webmWithDuration(again, 24400)).toBeNull();
  });
});

describe("Reel : rythme Calme / Normal / Nerveux", () => {
  it("le rythme allonge (ou resserre) les durées, le comptage et les transitions ; « Nerveux » par défaut", async () => {
    const { timingsFor, REEL_RHYTHMS, DEFAULT_RHYTHM, autoSceneDuration, T } = await import("../src/reel/plan");
    expect(DEFAULT_RHYTHM).toBe("nerveux");
    expect(Object.values(REEL_RHYTHMS).map((r) => r.label)).toEqual(["Calme", "Normal", "Nerveux"]);
    const n = timingsFor("nerveux");
    const c = timingsFor("calme");
    expect(n.numberTo).toBe(T.numberTo);
    expect(c.numberTo - c.numberFrom).toBeGreaterThan((n.numberTo - n.numberFrom) * 1.3);
    expect(c.fadeOut).toBeGreaterThan(n.fadeOut);
    expect(timingsFor("normal").chartTo).toBeGreaterThan(n.chartTo);
    const sc = { title: "La Suède en tête de l'UE", caption: "Part des renouvelables", number: "65 %", marks: 10 };
    expect(autoSceneDuration(sc, "calme")).toBeGreaterThan(autoSceneDuration(sc, "normal"));
    expect(autoSceneDuration(sc, "normal")).toBeGreaterThan(autoSceneDuration(sc, "nerveux"));
    const snaps = reelExampleSnapshots(new Date("2026-10-08T10:00:00Z"));
    const mk = (rhythm: "calme" | "nerveux") => defaultPlan(snaps, { format: "9x16", links: snaps.map(() => ({ linkIn: null, linkOut: null })), licence: "CC BY 4.0", generatedAt: "x", rhythm });
    const pc = mk("calme");
    const pn = mk("nerveux");
    expect(pc.rhythm).toBe("calme");
    expect(totalDuration(pc)).toBeGreaterThan(totalDuration(pn));
    for (const p of [pc, pn]) expect(totalDuration(p)).toBeGreaterThanOrEqual(REEL_MIN_S), expect(totalDuration(p)).toBeLessThanOrEqual(REEL_MAX_S);
  });
});
