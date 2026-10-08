/**
 * Mode lecture : liens profonds `#/lire/<histoire>/<snapshot>` et histoires de démonstration autonomes.
 *
 * Les histoires et revues sont stockées sur l'appareil (localStorage) : leurs liens ne s'ouvrent que sur
 * l'appareil qui les a créées. Exception : les scénarios intégrés (« Directeur commercial » sur
 * « Démo : pipeline commercial », « Directeur financier » sur « Démo : réel vs budget ») sont recalculés
 * à l'ouverture depuis les données de démonstration embarquées (les mêmes lignes que les CSV publiés) :
 * mêmes identifiants de snapshots, lien valable sur n'importe quel appareil (QR des diapositives PowerPoint).
 */
import { SCENARIO_DAF, SCENARIO_DIRCOM, type Scenario } from "./scenarios";
import type { Snapshot } from "./snapshots";

/** Adresse publique du Studio (QR des diapositives : ouvrable depuis un téléphone). */
export const READING_PUBLIC_BASE = "https://alteridea-dashboard.web.app/reporting/";

/** Histoire « courante » du Studio (même appareil). */
export const LOCAL_STORY_ID = "histoire";

export interface DemoStoryDef {
  id: string;
  scenario: Scenario;
  sampleId: string;
  /** Date de génération figée : mêmes cartouches sur tous les appareils. */
  generatedAt: string;
}

export const DEMO_STORIES: DemoStoryDef[] = [
  { id: "demo-dircom", scenario: SCENARIO_DIRCOM, sampleId: "demo-pipeline", generatedAt: "2026-10-08T06:30:00+02:00" },
  { id: "demo-daf", scenario: SCENARIO_DAF, sampleId: "demo-finance", generatedAt: "2026-10-08T11:30:00+02:00" },
];

export function demoStoryDef(id: string): DemoStoryDef | undefined {
  return DEMO_STORIES.find((d) => d.id === id);
}

export interface ReadRoute {
  storyId: string;
  snapId: string | null;
}

/** `#/lire/<histoire>[/<snapshot>]` ; null pour toute autre route. */
export function parseReadRoute(hash: string): ReadRoute | null {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "lire" || !parts[1]) return null;
  try {
    return { storyId: decodeURIComponent(parts[1]), snapId: parts[2] ? decodeURIComponent(parts[2]) : null };
  } catch {
    return null;
  }
}

export function readHash(storyId: string, snapId?: string | null): string {
  const e = encodeURIComponent;
  return `#/lire/${e(storyId)}${snapId ? `/${e(snapId)}` : ""}`;
}

export function readUrl(base: string, storyId: string, snapId?: string | null): string {
  return `${base}${readHash(storyId, snapId)}`;
}

/**
 * Histoire de lecture d'un snapshot : la démo intégrée correspondante quand le snapshot vient d'un scénario
 * intégré sur son exemple (lien valable partout), sinon l'histoire fournie (revue, histoire courante).
 */
export function readingStoryIdFor(s: Pick<Snapshot, "scenario" | "sampleId">, fallback: string = LOCAL_STORY_ID): string {
  const d = DEMO_STORIES.find((x) => x.scenario.id === s.scenario && x.sampleId === s.sampleId);
  return d ? d.id : fallback;
}

/** Une histoire est « démo autonome » quand tous ses snapshots appartiennent à la même démo intégrée. */
export function demoStoryOf(snaps: Pick<Snapshot, "scenario" | "sampleId">[]): string | null {
  if (!snaps.length) return null;
  const ids = new Set(snaps.map((s) => readingStoryIdFor(s, "")));
  const [only] = [...ids];
  return ids.size === 1 && only ? only : null;
}

/** Lien de lecture d'un snapshot (démo intégrée : lien universel ; sinon lien de l'histoire locale / de la revue). */
export function snapshotReadUrl(base: string, s: Pick<Snapshot, "id" | "scenario" | "sampleId">, fallbackStory: string = LOCAL_STORY_ID): string {
  return readUrl(base, readingStoryIdFor(s, fallbackStory), s.id);
}
