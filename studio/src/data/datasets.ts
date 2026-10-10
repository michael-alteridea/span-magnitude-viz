/**
 * Datasets dérivés (modèle « dataset d'abord », déploiement 2) : catalogue du projet et logique pure.
 *
 * - La **source** (fichier importé, tableau collé, exemple) n'est jamais modifiée.
 * - Un **dataset** est une recette appliquée à la source : filtres permanents et colonnes gardées. On ne stocke
 *   pas de copie des lignes : le dataset se recalcule depuis la source (`applyRecipe`). Chaque modification
 *   incrémente sa version (D1 v1, v2…).
 * - Le graphique (et donc chaque scène) recopie la recette dans `spec.dataset` : une scène « figée » garde sa
 *   version, et le rendu reste identique (même spec, mêmes lignes).
 * Module pur (aucun accès DOM) : testé par vitest.
 */
import type { DatasetRef, FilterSpec } from "../spec";
import type { Dataset } from "./table";
import { applyRecipe, passesFilter } from "./transform";

export interface DatasetRecipe {
  /** « D1 », « D2 »… (unique pour une source). */
  id: string;
  name: string;
  version: number;
  filters: FilterSpec[];
  /** Colonnes gardées ; vide = toutes. */
  columns: string[];
  /** Colonne de regroupement ; vide = pas d'agrégat. */
  groupBy: string;
  /** Indicateurs agrégés (somme ou moyenne). */
  aggs: { field: string; op: "sum" | "mean" }[];
  /** Nom de la source dont il dérive. */
  source: string;
  /** Couleur du repère (point de couleur dans l'arbre et sur les scènes). */
  color: string;
  createdAt: string;
  updatedAt: string;
}

/** Repères de couleur des datasets (pétrole d'abord ; jamais rouge ni vert, réservés aux écarts). */
export const DATASET_COLORS = ["#3FA7C4", "#E3A33B", "#A88BEB", "#D9B48F", "#9FB3BD", "#0E6E8C", "#E39BC0", "#7C8CF0"];

/** Datasets d'une source, dans l'ordre de création. */
export function datasetsOf(list: readonly DatasetRecipe[], source: string | null | undefined): DatasetRecipe[] {
  return source ? list.filter((d) => d.source === source) : [];
}

export function findDataset(list: readonly DatasetRecipe[], source: string | null | undefined, id: string | null | undefined): DatasetRecipe | undefined {
  return id && source ? list.find((d) => d.source === source && d.id === id) : undefined;
}

/** Prochain identifiant libre pour la source (« D1 », « D2 »…). */
export function nextDatasetId(list: readonly DatasetRecipe[], source: string): string {
  const n = datasetsOf(list, source).reduce((m, d) => Math.max(m, Number(/^D(\d+)$/.exec(d.id)?.[1] ?? 0)), 0);
  return `D${n + 1}`;
}

export function datasetColor(id: string): string {
  const n = Number(/^D(\d+)$/.exec(id)?.[1] ?? 1);
  return DATASET_COLORS[(Math.max(1, n) - 1) % DATASET_COLORS.length]!;
}

/** Recette recopiée dans le spec du graphique. */
export function toRef(d: DatasetRecipe): DatasetRef {
  return { id: d.id, version: d.version, name: d.name, filters: structuredClone(d.filters), columns: [...d.columns], groupBy: d.groupBy ?? "", aggs: structuredClone(d.aggs ?? []) };
}

/** Le spec utilise-t-il une version antérieure du dataset (scène figée) ? */
export function isFrozenRef(ref: DatasetRef | null | undefined, d: DatasetRecipe | undefined): boolean {
  return !!ref && !!d && ref.version < d.version;
}

/** Nouveau dataset (version 1). */
export function createDataset(list: readonly DatasetRecipe[], source: string, init: { name: string; filters: FilterSpec[]; columns: string[]; groupBy?: string; aggs?: { field: string; op: "sum" | "mean" }[] }, now = new Date()): DatasetRecipe {
  const id = nextDatasetId(list, source);
  const at = now.toISOString();
  return { id, name: init.name.trim() || id, version: 1, filters: structuredClone(init.filters), columns: [...init.columns], groupBy: init.groupBy ?? "", aggs: structuredClone(init.aggs ?? []), source, color: datasetColor(id), createdAt: at, updatedAt: at };
}

/** Mêmes filtres et mêmes colonnes ? */
export function sameRecipe(a: Pick<DatasetRef, "filters" | "columns"> & { groupBy?: string; aggs?: { field: string; op: string }[] }, b: Pick<DatasetRef, "filters" | "columns"> & { groupBy?: string; aggs?: { field: string; op: string }[] }): boolean {
  const norm = (f: FilterSpec[]) => JSON.stringify(f.map((x) => [x.field, x.op, [...x.values].sort(), x.value]));
  return norm(a.filters) === norm(b.filters) && JSON.stringify([...a.columns].sort()) === JSON.stringify([...b.columns].sort()) && (a.groupBy ?? "") === (b.groupBy ?? "") && JSON.stringify(a.aggs ?? []) === JSON.stringify(b.aggs ?? []);
}

/** Modification d'un dataset : nouvelle version si la recette change (le nom seul ne change pas la version). */
export function updateDataset(d: DatasetRecipe, next: { name: string; filters: FilterSpec[]; columns: string[]; groupBy?: string; aggs?: { field: string; op: "sum" | "mean" }[] }, now = new Date()): DatasetRecipe {
  const changed = !sameRecipe(d, next);
  return { ...d, name: next.name.trim() || d.name, filters: structuredClone(next.filters), columns: [...next.columns], groupBy: next.groupBy ?? d.groupBy ?? "", aggs: structuredClone(next.aggs ?? d.aggs ?? []), version: changed ? d.version + 1 : d.version, updatedAt: now.toISOString() };
}

/** Le catalogue connaît-il la recette d'un spec ? Sinon on l'adopte (projets, fichiers et scènes migrés). */
export function adoptRef(list: readonly DatasetRecipe[], ref: DatasetRef | null | undefined, source: string | null | undefined, now = new Date()): DatasetRecipe[] | null {
  if (!ref || !source || findDataset(list, source, ref.id)) return null;
  const at = now.toISOString();
  return [...list, { id: ref.id, name: ref.name || ref.id, version: ref.version, filters: structuredClone(ref.filters), columns: [...ref.columns], groupBy: ref.groupBy ?? "", aggs: structuredClone(ref.aggs ?? []), source, color: datasetColor(ref.id), createdAt: at, updatedAt: at }];
}

/** Les filtres et colonnes de la recette existent-ils dans ces données ? */
export function refFits(ref: DatasetRef, ds: Dataset): boolean {
  const names = new Set(ds.columns.map((c) => c.name));
  return ref.filters.every((f) => names.has(f.field)) && ref.columns.every((c) => names.has(c));
}

/* ------------------------------------------------------------------ pastilles de filtres */

/** Filtres regroupés par colonne (une période = deux bornes = une pastille), dans l'ordre d'ajout. */
export function chipGroups(filters: readonly FilterSpec[]): { field: string; filters: FilterSpec[] }[] {
  const out: { field: string; filters: FilterSpec[] }[] = [];
  for (const f of filters) {
    const g = out.find((x) => x.field === f.field);
    if (g) g.filters.push(f);
    else out.push({ field: f.field, filters: [f] });
  }
  return out;
}

/** Nombre de lignes restantes après chaque pastille (pastilles empilées : « 320 › 192 › 96 »). */
export function stackedCounts(src: Dataset, filters: readonly FilterSpec[]): number[] {
  const groups = chipGroups(filters);
  const out: number[] = [];
  let rows = src.rows;
  for (const g of groups) {
    rows = rows.filter((r) => g.filters.every((f) => passesFilter(f, r[f.field])));
    out.push(rows.length);
  }
  return out;
}

/** Lignes du dataset (filtres seulement). */
export function countRows(src: Dataset, filters: readonly FilterSpec[]): number {
  return src.rows.filter((r) => filters.every((f) => !src.columns.some((c) => c.name === f.field) || passesFilter(f, r[f.field]))).length;
}

const fmtN = (n: number) => n.toLocaleString("fr-FR");

/** Valeurs distinctes d'une colonne avec leur nombre de lignes (ordre alphabétique français). */
export function valueCounts(rows: readonly Record<string, unknown>[], field: string): { value: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = r[field];
    if (v == null || v === "") continue;
    m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => a.value.localeCompare(b.value, "fr", { numeric: true }));
}

/** Texte de pastille d'une liste de valeurs : « Industrie, Santé », « 4 sur 5 (sans Allemagne) ». */
export function valuesChipText(picked: readonly string[], all: readonly string[]): string {
  const k = picked.length;
  const n = all.length;
  if (k <= 3) return picked.join(", ");
  const without = all.filter((v) => !picked.includes(v));
  return `${k} sur ${n}${without.length && without.length <= 2 ? ` (sans ${without.join(", ")})` : ""}`;
}

/** Texte de pastille d'une période : « 2024 → 2026 », « depuis 2024 », « 2025 ». */
export function rangeChipText(from: number | null, to: number | null): string {
  if (from != null && to != null) return from === to ? String(from) : `${from} → ${to}`;
  if (from != null) return `depuis ${from}`;
  return `jusqu'à ${to}`;
}

/** Libellé lisible d'une pastille (tel qu'enregistré dans le filtre), sans le nom de colonne. */
export function chipText(g: { field: string; filters: FilterSpec[] }): string {
  const lab = g.filters[0]?.label ?? "";
  const pre = `${g.field} : `;
  return lab.startsWith(pre) ? lab.slice(pre.length) : lab || g.filters.map((f) => f.values.join(", ")).join(" · ");
}

/** Résumé de la recette (« Pays : 4 sur 5 · Année : 2024 → 2026 »), pour le cartouche et la vérification. */
export function describeRecipe(ref: Pick<DatasetRef, "filters" | "columns">, totalCols?: number): string {
  const parts = chipGroups(ref.filters).map((g) => `${g.field} : ${chipText(g)}`);
  if (ref.columns.length && totalCols && ref.columns.length < totalCols) parts.push(`${ref.columns.length} colonnes sur ${totalCols}`);
  if ("groupBy" in ref && ref.groupBy) parts.push(`regroupé par ${ref.groupBy}`);
  return parts.join(" · ");
}

/** Nom proposé d'après les filtres (« Industrie & Santé · 2024 → 2026 »). */
export function proposeName(filters: readonly FilterSpec[], fallback = "Toutes les lignes"): string {
  const parts = chipGroups(filters).map((g) => {
    const t = chipText(g);
    const f = g.filters[0]!;
    if (f.op === "in" && f.values.length === 2) return f.values.join(" & ");
    if (f.op === "in" && f.values.length > 3) return `${g.field} ${t}`;
    return t;
  });
  return (parts.join(" · ") || fallback).slice(0, 80);
}

/** Nom libre parmi les datasets de la source (« Industrie & Santé 2 »). */
export function uniqueDatasetName(list: readonly DatasetRecipe[], source: string, base: string, exceptId?: string): string {
  const taken = new Set(datasetsOf(list, source).filter((d) => d.id !== exceptId).map((d) => d.name.trim().toLowerCase()));
  const b = base.trim() || "Dataset";
  if (!taken.has(b.toLowerCase())) return b;
  for (let i = 2; i < 500; i++) if (!taken.has(`${b} ${i}`.toLowerCase())) return `${b} ${i}`;
  return b;
}

/** Lignes du dataset (raccourci de test et d'aperçu). */
export function datasetRows(src: Dataset, d: Pick<DatasetRef, "filters" | "columns">): number {
  return applyRecipe(src, d).rows.length;
}

/* ------------------------------------------------------------------ scènes */

interface SceneLike {
  id: string;
  spec?: unknown;
}

/** Recette d'une scène (spec.dataset), si elle en a une. */
export function sceneRef(s: SceneLike): DatasetRef | null {
  const d = (s.spec as { dataset?: DatasetRef | null } | null)?.dataset;
  return d && typeof d === "object" && typeof d.id === "string" ? d : null;
}

/** Scènes qui utilisent un dataset (toutes versions). */
export function scenesUsing<T extends SceneLike>(scenes: readonly T[], id: string): T[] {
  return scenes.filter((s) => sceneRef(s)?.id === id);
}

/** Libellé de compte « 1 scène », « 3 scènes ». */
export const scenesLabel = (n: number): string => `${n} scène${n > 1 ? "s" : ""}`;
export const rowsLabel = (n: number): string => `${fmtN(n)} ligne${n > 1 ? "s" : ""}`;

/* ------------------------------------------------------------------ lecture tolérante (projets, sessions) */

export function parseDatasets(input: unknown): DatasetRecipe[] {
  if (!Array.isArray(input)) return [];
  const out: DatasetRecipe[] = [];
  const now = new Date().toISOString();
  for (const x of input) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.source !== "string") continue;
    const filters = Array.isArray(o.filters)
      ? (o.filters.filter((f) => f && typeof f === "object" && typeof (f as FilterSpec).field === "string") as FilterSpec[]).map((f) => ({ field: f.field, op: f.op ?? "in", values: Array.isArray(f.values) ? f.values.map(String) : [], value: typeof f.value === "number" ? f.value : null, label: typeof f.label === "string" ? f.label : "" }))
      : [];
    out.push({
      id: o.id.slice(0, 12),
      name: typeof o.name === "string" ? o.name.slice(0, 120) : o.id,
      version: typeof o.version === "number" && o.version >= 1 ? Math.floor(o.version) : 1,
      filters,
      columns: Array.isArray(o.columns) ? o.columns.filter((c): c is string => typeof c === "string") : [],
      groupBy: typeof o.groupBy === "string" ? o.groupBy : "",
      aggs: Array.isArray(o.aggs) ? o.aggs.filter((a) => a && typeof a === "object" && typeof (a as { field?: unknown }).field === "string").map((a) => ({ field: String((a as { field: string }).field), op: (a as { op?: string }).op === "mean" ? "mean" as const : "sum" as const })) : [],
      source: o.source,
      color: typeof o.color === "string" && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : datasetColor(o.id),
      createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
    });
  }
  return out;
}
