import { describe, expect, it } from "vitest";
import { canReopen, loadRecents, pushRecent, recentDate, recentId, removeRecent, rowsToTsv, saveRecents, RECENTS_KEY, RECENTS_MAX, type KV, type RecentEntry } from "../src/data/recents";

const mem = (quota = Infinity): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > quota) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
  };
};
const entry = (i: number, tsv?: string): RecentEntry => ({ id: recentId("file", `f${i}`), kind: "file", name: `f${i}`, at: "2026-10-08T21:30:00.000Z", rows: 3, cols: 2, tsv });

describe("Données récentes (localStorage, rien n'est envoyé)", () => {
  it("TSV : en-tête + lignes, tabulations et retours neutralisés, dates ISO", () => {
    expect(rowsToTsv(["Pays", "Valeur"], [{ Pays: "Bel\tgique", Valeur: 1.5 }, { Pays: "France", Valeur: null }])).toBe("Pays\tValeur\nBel gique\t1.5\nFrance\t");
    expect(rowsToTsv(["d"], [{ d: new Date(Date.UTC(2024, 0, 1)) }])).toBe("d\n2024-01-01");
  });
  it("trop volumineux → pas de tableau gardé (« réimportez le fichier »)", () => {
    const raw = Array.from({ length: 1000 }, (_, i) => ({ a: "x".repeat(50), b: i }));
    expect(rowsToTsv(["a", "b"], raw, 10_000)).toBeNull();
    expect(canReopen(entry(1))).toBe(false);
    expect(canReopen(entry(1, "a\n1"))).toBe(true);
    expect(canReopen({ ...entry(2), kind: "sample", sampleId: "ventes" })).toBe(true);
  });
  it("au plus 10 entrées, un même jeu remonte en tête sans doublon", () => {
    let l: RecentEntry[] = [];
    for (let i = 0; i < 14; i++) l = pushRecent(l, entry(i));
    expect(l).toHaveLength(RECENTS_MAX);
    expect(l[0]!.name).toBe("f13");
    l = pushRecent(l, entry(8));
    expect(l[0]!.name).toBe("f8");
    expect(l.filter((e) => e.name === "f8")).toHaveLength(1);
    expect(removeRecent(l, l[0]!.id).some((e) => e.name === "f8")).toBe(false);
  });
  it("enregistrement et relecture ; quota dépassé → tableaux des plus anciennes retirés d'abord", () => {
    const l = [entry(1, "a\n" + "1".repeat(150)), entry(2, "b\n" + "2".repeat(150)), entry(3, "c\n" + "3".repeat(150))];
    const kv = mem(JSON.stringify([l[0], l[1], { ...l[2], tsv: undefined }]).length + 5);
    const saved = saveRecents(kv, l);
    expect(saved[0]!.tsv).toBeTruthy();
    expect(saved[2]!.tsv).toBeUndefined();
    expect(loadRecents(kv).map((e) => e.name)).toEqual(["f1", "f2", "f3"]);
    kv.data.set(RECENTS_KEY, "{oups");
    expect(loadRecents(kv)).toEqual([]);
    expect(loadRecents(null)).toEqual([]);
  });
  it("date lisible à la française", () => {
    expect(recentDate("2026-10-08T21:30:00")).toBe("8 oct. 2026, 21:30");
  });
});
