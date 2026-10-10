/** Projet d'exemple « Un peu plus de jeunes, beaucoup plus d'étudiants » (?projet=jeunes-belgique) : valeurs exactes, trous laissés vides, 7 scènes, scène 4D. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleProjectById, exampleProjectUrl, loadExampleProject } from "../src/project/examples";
import { applyRecipe } from "../src/data/transform";
import { buildDataset } from "../src/data/table";
import { parseSpec } from "../src/spec";
import { prepareCache, prepareFrame } from "../src/charts/render";

const PUBLIC = resolve(__dirname, "../public");
const fileFetcher = async (url: string) => {
  const path = new URL(url).pathname.replace(/^\/reporting\//, "");
  try {
    const txt = readFileSync(resolve(PUBLIC, path), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt) as unknown };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};
const BASE = "https://alteridea-dashboard.web.app/reporting/?projet=jeunes-belgique";
const Y014 = [1821788, 1814025, 1809227, 1806256, 1804981, 1804863, 1805097, 1803945, 1800052, 1796128, 1795440, 1796839, 1800196, 1808777, 1823706, 1845743, 1874027, 1886147, 1895820, 1905354, 1915854, 1924367, 1930645, 1936500, 1940574, 1938530, 1932898, 1930701, 1919041, 1896918];
const Y1524 = [1291183, 1276373, 1263174, 1252280, 1245872, 1243304, 1244390, 1248249, 1253227, 1258474, 1265332, 1275098, 1286622, 1298758, 1309441, 1320619, 1335207, 1337870, 1334630, 1327348, 1324900, 1319970, 1308714, 1302546, 1305109, 1311385, 1319309, 1329679, 1340671, 1362410];
const ETU: (number | null)[] = [352630, 358214, null, null, 351788, 355748, 359265, 366982, 374532, 386110, 389547, 394427, 393687, 401652, 425219, 445309, 462419, 477712, 488488, 495910, 504745, 508270, 526760, 515530, 519200, 521200, 539800, 549400, 551000, null];

describe("projet d'exemple jeunes-belgique", () => {
  it("listé, adresse du fichier livré sous exemples/", () => {
    const e = exampleProjectById("jeunes-belgique")!;
    expect(e.name).toBe("Un peu plus de jeunes, beaucoup plus d'étudiants");
    expect(exampleProjectById(" Jeunes-Belgique ")?.id).toBe("jeunes-belgique");
    expect(exampleProjectUrl(e, BASE)).toBe("https://alteridea-dashboard.web.app/reporting/exemples/jeunes-belgique.datanime");
  });

  it("valeurs exactes 1995-2024 ; étudiants 1997, 1998 et 2024 vides (aucune interpolation)", async () => {
    const p = await loadExampleProject(exampleProjectById("jeunes-belgique")!, BASE, fileFetcher);
    expect(p.id).toBe("prj-jeunes-belgique");
    expect(p.name).toBe("Un peu plus de jeunes, beaucoup plus d'étudiants");
    const rows = p.source!.rows!;
    const ann = rows.filter((r) => r["Vue"] === "Annuel");
    const race = rows.filter((r) => r["Vue"] === "Course");
    expect(ann.map((r) => r["Année"])).toEqual(Array.from({ length: 30 }, (_, i) => String(1995 + i)));
    expect(ann.map((r) => r["0-14 ans"])).toEqual(Y014);
    expect(ann.map((r) => r["15-24 ans"])).toEqual(Y1524);
    expect(ann.map((r) => r["Étudiants du supérieur"] ?? null)).toEqual(ETU);
    expect(race).toHaveLength(60);
    expect(race.filter((r) => r["Groupe"] === "0-14 ans").map((r) => r["Population"])).toEqual(Y014);
    expect(race.filter((r) => r["Groupe"] === "15-24 ans").map((r) => r["Population"])).toEqual(Y1524);
    expect(JSON.stringify(p)).not.toMatch(/certifi|authenticit|Michaël/i);
  });

  it("7 scènes, textes, scène 2 en 4D (30 pas, valeurs exactes à chaque pas)", async () => {
    const p = await loadExampleProject(exampleProjectById("jeunes-belgique")!, BASE, fileFetcher);
    expect(p.datasets?.map((d) => d.id)).toEqual(["D1", "D2"]);
    const src = buildDataset(p.source!.name, p.source!.rows as never, p.source!.typeOverrides as never);
    expect(applyRecipe(src, p.datasets![0]!).rows).toHaveLength(30);
    expect(applyRecipe(src, p.datasets![1]!).rows).toHaveLength(60);
    const sc = p.sequence.snapshots;
    expect(sc).toHaveLength(7);
    expect(sc[0]!.title).toBe("Un peu plus de jeunes, beaucoup plus d'étudiants");
    expect(sc[0]!.subtitle).toBe("Belgique, 1995-2024");
    expect(sc[2]!.title).toBe("Les 15-24 touchent un creux en 2000 (1,24 million), puis remontent");
    expect(sc[3]!.title).toBe("353 000 en 1995, 551 000 en 2023");
    expect(sc[4]!.comments).toEqual(["Les étudiants montent plus vite que la classe d'âge."]);
    expect(sc[5]!.comments[0]).toBe("Depuis 2019 : les 0-14 baissent, les 15-24 continuent de monter.");
    expect(sc[5]!.comments[1]).toContain("1 940 574 → 1 896 918");
    expect(1940574 - 1896918).toBe(43656); // « environ 44 000 »
    expect(sc[6]!.title).toBe("La classe d'âge se stabilise. Le supérieur, lui, a gagné plus de moitié.");
    expect(sc[6]!.comments).toEqual(["Prochaine étape : moins d'enfants aujourd'hui, moins d'étudiants potentiels dans dix ans."]);
    expect(551000 / 352630).toBeGreaterThan(1.5);
    const parsed = parseSpec(sc[1]!.spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const spec = parsed.spec;
    expect(spec.mode).toMatchObject({ kind: "dynamic", fourD: { enabled: true, mode: "snapshot" } });
    expect(spec.encoding.time).toBe("Année");
    const ds = applyRecipe(src, p.datasets![1]!);
    const cache = prepareCache(spec, ds, null, -1);
    expect(cache.error).toBeNull();
    expect(cache.time!.steps).toHaveLength(30);
    for (const i of [0, 5, 24, 29]) {
      const f = prepareFrame(spec, ds, cache, { build: 1, timePos: i });
      const m = f.model as { values: number[][]; keys: unknown[] };
      expect(f.stamp).toBe(String(1995 + i));
      expect(m.values[0]).toEqual([Y014[i], Y1524[i]]);
    }
    // rendu figé (vignette) : dernier pas, pas la somme des 30 années
    const still = prepareFrame(spec, ds, cache, { build: 1, timePos: null }).model as { values: number[][] };
    expect(still.values[0]).toEqual([Y014[29], Y1524[29]]);
  });
});
