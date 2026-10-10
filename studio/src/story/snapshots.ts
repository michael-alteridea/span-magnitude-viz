/**
 * Modèle « Histoire » : suite ordonnée de snapshots (spec + rendu + textes) destinée au récit
 * et à l'export PowerPoint. Module pur (aucun accès DOM) sauf `saveStory` / `loadStory` (localStorage).
 */
import { z } from "zod";
import { NARRATIVE_ROLES, type ChartSpec, type NarrativeRole } from "../spec";

export const STORY_KEY = "reporting-4d-studio:story:v1";
export const MAX_SNAPSHOTS = 24;

export const ROLE_LABELS: Record<NarrativeRole, string> = {
  context: "Contexte",
  tension: "Tension",
  revelation: "Révélation",
  recommendation: "Recommandation",
};

export const snapshotSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  createdAt: z.string(),
  spec: z.unknown(),
  /** SVG « nu » du graphique (sans titre ni commentaires, polices non embarquées) ; vidé si le stockage sature. */
  svg: z.string().nullable().default(null),
  /** Vignette JPEG (data URL) du rendu complet. */
  thumb: z.string().nullable().default(null),
  width: z.number().default(1200),
  height: z.number().default(675),
  title: z.string().default(""),
  subtitle: z.string().default(""),
  comments: z.array(z.string()).default([]),
  source: z.string().default(""),
  kind: z.string().nullable().default(null),
  role: z.enum(NARRATIVE_ROLES).default("context"),
  sampleId: z.string().nullable().default(null),
  dataName: z.string().default(""),
  generatedAt: z.string().default(""),
  /** Chemin d'exploration (« Tout › T2 2026 › Juin 2026 ») : fil d'Ariane du film et de la diapositive. */
  path: z.array(z.string()).optional(),
  /** Scénario et étape d'origine (identifiant stable : futur partage par QR). */
  scenario: z.string().nullable().optional(),
  step: z.string().nullable().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const storyStateSchema = z.object({
  title: z.string().max(200).default("Notre histoire en données"),
  snapshots: z.array(snapshotSchema).max(MAX_SNAPSHOTS).default([]),
  /** Même échelle pour les graphiques de même mesure (diapositives). */
  sameScale: z.boolean().default(false),
});
/** « Accès au film » des liens de lecture et QR : « libre » = entrée libre ; « mail » (défaut) = lien magique demandé. */
export const FILM_ACCESS = ["mail", "libre"] as const;
export type FilmAccess = (typeof FILM_ACCESS)[number];
export const FILM_ACCESS_LABELS: Record<FilmAccess, string> = { mail: "Mail demandé", libre: "Entrée libre" };
export function parseFilmAccess(v: unknown): FilmAccess | undefined {
  return v === "libre" || v === "mail" ? v : undefined;
}
export type StoryState = Omit<z.infer<typeof storyStateSchema>, "sameScale"> & { sameScale?: boolean; access?: FilmAccess };

export function emptyStory(): StoryState {
  return { title: "Notre histoire en données", snapshots: [], sameScale: false };
}

/** Lecture tolérante (fichier JSON, localStorage) : ignore les snapshots invalides. */
export function parseStory(input: unknown): StoryState {
  const base = emptyStory();
  if (!input || typeof input !== "object") return base;
  const o = input as { title?: unknown; snapshots?: unknown; sameScale?: unknown; access?: unknown };
  if (typeof o.title === "string" && o.title.trim()) base.title = o.title.slice(0, 200);
  if (typeof o.sameScale === "boolean") base.sameScale = o.sameScale;
  const access = parseFilmAccess(o.access);
  if (access) base.access = access;
  if (Array.isArray(o.snapshots))
    for (const s of o.snapshots.slice(0, MAX_SNAPSHOTS)) {
      const r = snapshotSchema.safeParse(s);
      if (r.success) base.snapshots.push(r.data);
    }
  return base;
}

/** Rôle narratif d'un type d'insight (variance : tension si défavorable, révélation sinon). */
export function roleForKind(kind: string | null, opts: { unfavourable?: boolean } = {}): NarrativeRole {
  switch (kind) {
    case "variance":
      return opts.unfavourable === false ? "revelation" : "tension";
    case "outlier":
    case "pipelineAging":
      return "tension";
    case "concentration":
    case "ranking":
    case "pipelineConversion":
    case "correlation":
      return "revelation";
    case "pipelineSlipping":
      return "recommendation";
    default:
      return "context";
  }
}

export function moveSnapshot<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it!);
  return out;
}

const ROLE_ORDER: Record<NarrativeRole, number> = { context: 0, tension: 1, revelation: 2, recommendation: 3 };

/**
 * « Ordonner en récit » : contexte → tension → révélation → recommandation (tri stable).
 * Le rôle est conservé s'il a été attribué ; à défaut il est déduit du type d'insight.
 */
export function assignNarrativeOrder(list: readonly Snapshot[]): Snapshot[] {
  return list
    .map((s, i) => ({ s: { ...s, role: s.role ?? roleForKind(s.kind) }, i }))
    .sort((a, b) => ROLE_ORDER[a.s.role] - ROLE_ORDER[b.s.role] || a.i - b.i)
    .map((x) => x.s);
}

export function newSnapshotId(): string {
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function snapshotSpec(s: Snapshot): ChartSpec {
  return s.spec as ChartSpec;
}

/** Persistance : en cas de quota dépassé, retire d'abord les SVG des plus anciens, puis les vignettes. */
export function saveStory(story: StoryState, storage: Pick<Storage, "setItem"> = localStorage): { ok: boolean; trimmed: number } {
  let st = structuredClone(story);
  let trimmed = 0;
  for (let attempt = 0; attempt < st.snapshots.length * 2 + 1; attempt++) {
    try {
      storage.setItem(STORY_KEY, JSON.stringify(st));
      return { ok: true, trimmed };
    } catch {
      const bySvg = st.snapshots.findIndex((s) => s.svg);
      if (bySvg >= 0) st.snapshots[bySvg]!.svg = null;
      else {
        const byThumb = st.snapshots.findIndex((s) => s.thumb);
        if (byThumb < 0) return { ok: false, trimmed };
        st.snapshots[byThumb]!.thumb = null;
      }
      trimmed++;
      st = { ...st };
    }
  }
  return { ok: false, trimmed };
}

export function loadStory(storage: Pick<Storage, "getItem"> = localStorage): StoryState {
  try {
    const raw = storage.getItem(STORY_KEY);
    return raw ? parseStory(JSON.parse(raw)) : emptyStory();
  } catch {
    return emptyStory();
  }
}
