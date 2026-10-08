/** Mode « Reel » : scènes par défaut d'après les snapshots d'une histoire (module pur). */
import type { Snapshot } from "../story/snapshots";
import { clip } from "../story/fr";
import { autoSceneDuration, END_CARD_S, extractKeyNumber, fitDurations, shortTitle, type DrillLink, type ReelFormatKey, type ReelPlan, type ReelScene } from "./plan";

/** Nombre approximatif de marques d'un snapshot (barres, points) d'après son rendu conservé. */
function marksOf(s: Snapshot): number {
  if (!s.svg) return 6;
  const n = (s.svg.match(/class="r4d-(?:bar|point|drill-mark|slice)\b/g) ?? []).length;
  return n || 6;
}

/** Bandeau au-dessus du titre : nom des données (sans la source), court. */
export function kickerOf(s: Snapshot, storyTitle = ""): string {
  const base = (s.path && s.path.length > 1 ? s.path[s.path.length - 1]! : "") || s.dataName || storyTitle;
  return clip(base.replace(/\s*\([^)]*\)\s*$/, ""), 42);
}

export function sceneFromSnapshot(s: Snapshot, links: { linkIn: DrillLink; linkOut: DrillLink }, storyTitle = ""): ReelScene {
  const title = shortTitle(s.title || s.name);
  const number = extractKeyNumber(s.title, ...s.comments);
  const caption = clip((s.subtitle || "").replace(/\s+/g, " ").trim(), 110);
  const sc: ReelScene = { id: s.id, kicker: kickerOf(s, storyTitle), title, number, caption, duration: 4, linkIn: links.linkIn, linkOut: links.linkOut };
  sc.duration = autoSceneDuration({ title, number, caption, marks: marksOf(s) });
  return sc;
}

/** Source commune des snapshots (cartouche), sans doublon. */
export function sourceOf(snaps: Snapshot[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of snaps) {
    const v = (s.source || (s.spec as { style?: { source?: string } } | null)?.style?.source || "").trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  const txt = out.join(" · ");
  return txt && !/^source/i.test(txt) ? `Source : ${txt}` : txt;
}

/** Plan par défaut : durées automatiques ajustées pour un total de 15 à 30 s. */
export function defaultPlan(
  snaps: Snapshot[],
  o: { format: ReelFormatKey; links: { linkIn: DrillLink; linkOut: DrillLink }[]; licence: string; generatedAt: string; storyTitle?: string; fps?: number }
): ReelPlan {
  const scenes = snaps.map((s, i) => sceneFromSnapshot(s, o.links[i] ?? { linkIn: null, linkOut: null }, o.storyTitle));
  const durs = fitDurations(scenes.map((s) => s.duration));
  scenes.forEach((s, i) => (s.duration = durs[i]!));
  return { format: o.format, fps: o.fps ?? 30, scenes, endDuration: END_CARD_S, source: sourceOf(snaps), licence: o.licence, generatedAt: o.generatedAt };
}
