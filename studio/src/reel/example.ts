/**
 * Exemple de Reel en 1 clic, sur données publiques réutilisables commercialement : part des énergies renouvelables
 * (Eurostat nrg_ind_ren, CC BY 4.0). Quatre snapshots construits à partir de l'exemple « renouvelables » ;
 * tous les chiffres des titres sont calculés depuis les données (aucune saisie à la main).
 */
import { parseSpec, type ChartSpecInput } from "../spec";
import type { Snapshot } from "../story/snapshots";
import { EUROSTAT_REN } from "../data/eurostatRenouvelables";
import { RENOUVELABLES_SOURCE } from "../data/samples";

export const REEL_EXAMPLE_ID = "renouvelables";
export const REEL_EXAMPLE_TITLE = "Énergies renouvelables dans l'UE";

const fr1 = (v: number) => v.toFixed(1).replace(".", ",");
const NB = "\u00a0";

function val(name: string, year: number): number {
  const i = EUROSTAT_REN.names.indexOf(name as never);
  const k = EUROSTAT_REN.years.indexOf(year as never);
  const v = i >= 0 && k >= 0 ? EUROSTAT_REN.values[i]![k] : null;
  if (v === null || v === undefined) throw new Error(`Valeur Eurostat absente : ${name} ${year}`);
  return v;
}

/** Pays (hors UE-27) classés par part 2025. */
function ranked2025(): { name: string; v: number }[] {
  const last = EUROSTAT_REN.years[EUROSTAT_REN.years.length - 1]!;
  return EUROSTAT_REN.names
    .map((name) => ({ name, v: name === "UE-27" ? null : val(name, last) }))
    .filter((x): x is { name: (typeof EUROSTAT_REN.names)[number]; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v);
}

const Y2025 = { field: "Année", op: "gte" as const, value: Date.UTC(2025, 0, 1), label: "2025" };

/** Les quatre snapshots de l'exemple (identifiants stables). */
export function reelExampleSnapshots(now = new Date()): Snapshot[] {
  const eu04 = val("UE-27", 2004);
  const eu25 = val("UE-27", 2025);
  const rk = ranked2025();
  const top = rk[0]!;
  const bottom = rk.slice(-5).reverse();
  const last = bottom[0]!;
  const be04 = val("Belgique", 2004);
  const be25 = val("Belgique", 2025);
  const ratio = be25 / be04;
  const src = RENOUVELABLES_SOURCE;
  const base = (over: Partial<ChartSpecInput> & { style: NonNullable<ChartSpecInput["style"]> }): ChartSpecInput => ({
    ...over,
    axes: { y: { unit: "pct", decimals: 1, title: "" }, x: { grid: false }, ...(over.axes ?? {}) },
    style: { source: src, valueLabels: true, ...over.style },
  });
  const defs: { id: string; role: Snapshot["role"]; spec: ChartSpecInput; comments: string[] }[] = [
    {
      id: "eurostat-01-ue",
      role: "context",
      comments: [`${fr1(eu04)}${NB}% en 2004, ${fr1(eu25)}${NB}% en 2025 (provisoire).`],
      spec: base({
        type: "bar",
        encoding: { x: "Année", y: ["Part des renouvelables (%)"], series: null, aggregate: "sum", xGrain: "year" },
        transform: { filters: [{ field: "Pays", op: "in", values: ["UE-27"], label: "UE-27" }] },
        style: { title: `L'UE à ${fr1(eu25)}${NB}% d'énergie renouvelable`, subtitle: "Part dans la consommation finale brute d'énergie, UE-27, 2004 → 2025", valueLabels: false },
      }),
    },
    {
      id: "eurostat-02-top10",
      role: "revelation",
      comments: [],
      spec: base({
        type: "barH",
        encoding: { x: "Pays", y: ["Part des renouvelables (%)"], series: null, aggregate: "sum", topN: 10, others: false },
        transform: { filters: [Y2025, { field: "Pays", op: "notIn", values: ["UE-27"], label: "pays" }] },
        style: { title: `${top.name === "Suède" ? "La Suède" : top.name} en tête avec ${fr1(top.v)}${NB}%`, subtitle: "10 premiers pays de l'UE en 2025 (provisoire)", sort: "desc", focus: { key: top.name, title: "", note: "", average: true } },
      }),
    },
    {
      id: "eurostat-03-derniers",
      role: "tension",
      comments: [],
      spec: base({
        type: "barH",
        encoding: { x: "Pays", y: ["Part des renouvelables (%)"], series: null, aggregate: "sum" },
        transform: { filters: [Y2025, { field: "Pays", op: "in", values: bottom.map((b) => b.name), label: "5 derniers" }] },
        style: { title: `${last.name === "Belgique" ? "La Belgique" : last.name} ferme la marche : ${fr1(last.v)}${NB}%`, subtitle: "Les 5 pays les moins avancés de l'UE en 2025 (provisoire)", sort: "asc", focus: { key: last.name, title: "", note: "", average: false } },
      }),
    },
    {
      id: "eurostat-04-belgique",
      role: "recommendation",
      comments: [],
      spec: base({
        type: "bar",
        encoding: { x: "Année", y: ["Part des renouvelables (%)"], series: null, aggregate: "sum", xGrain: "year" },
        transform: { filters: [{ field: "Pays", op: "in", values: ["Belgique"], label: "Belgique" }] },
        style: { title: `Belgique : ×${fr1(ratio)} depuis 2004`, subtitle: `De ${fr1(be04)}${NB}% en 2004 à ${fr1(be25)}${NB}% en 2025 (provisoire)`, valueLabels: false },
      }),
    },
  ];
  const at = now.toISOString();
  return defs.map((d) => {
    const parsed = parseSpec(d.spec);
    if (!parsed.ok) throw new Error(`Exemple Reel : spec invalide (${d.id})`);
    const spec = parsed.spec;
    return {
      id: d.id,
      name: spec.style.title,
      createdAt: at,
      spec,
      svg: null,
      thumb: null,
      width: 1200,
      height: 675,
      title: spec.style.title,
      subtitle: spec.style.subtitle,
      comments: d.comments,
      source: src,
      kind: null,
      role: d.role,
      sampleId: REEL_EXAMPLE_ID,
      dataName: "Énergies renouvelables dans l'UE (Eurostat)",
      generatedAt: at,
      path: [],
      scenario: null,
      step: null,
    } satisfies Snapshot;
  });
}
