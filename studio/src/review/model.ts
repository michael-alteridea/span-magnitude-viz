/**
 * Revues partagées (Datanime) : modèle pur (aucun accès DOM ni stockage).
 * Une revue = suite ordonnée de snapshots (les vrais objets `Snapshot`, identifiants stables des scénarios),
 * des participants, les accusés de lecture (« J'ai vu »), réactions, fil de commentaires et questions,
 * décisions et actions captées en réunion, et de quoi produire le compte rendu.
 */
import type { Snapshot } from "../story/snapshots";

export type ReviewStatus = "brouillon" | "partagee" | "en-reunion" | "terminee";
export const STATUS_LABEL: Record<ReviewStatus, string> = { brouillon: "Brouillon", partagee: "Partagée", "en-reunion": "En réunion", terminee: "Terminée" };

export interface Person {
  id: string;
  name: string;
  role: string;
  email: string;
  color: string;
}

export type ReactionKind = "accord" | "utile" | "clarifier" | "attention";
export const REACTIONS: { kind: ReactionKind; label: string }[] = [
  { kind: "accord", label: "D'accord" },
  { kind: "utile", label: "Utile" },
  { kind: "clarifier", label: "À clarifier" },
  { kind: "attention", label: "Point d'attention" },
];

export interface Reaction {
  snapId: string;
  author: string;
  kind: ReactionKind;
}

export type QuestionStatus = "ouverte" | "repondue" | "en-action";

export interface ReviewComment {
  id: string;
  snapId: string;
  author: string;
  text: string;
  at: string;
  parentId: string | null;
  /** Question pour la séance (file de questions du mode réunion). */
  question: boolean;
  /** Soutiens (« moi aussi ») : tri de la file de questions. */
  supports: string[];
  status: QuestionStatus;
}

export interface ReviewItem {
  id: string;
  snapId: string | null;
  kind: "decision" | "action";
  text: string;
  owner: string | null;
  due: string | null;
  by: string;
  at: string;
  /** Question d'origine (bouton « En action » de la file de questions). */
  fromQuestion?: string | null;
}

export interface ReviewShare {
  access: "invites" | "organisation" | "lien";
  comments: boolean;
  showSeen: boolean;
  hideAmounts: boolean;
  expires: string | null;
}

export interface ReviewMeeting {
  startedAt: string | null;
  endedAt: string | null;
  current: number;
  /** Participants présents (connectés) ; les autres invités sont absents. */
  present: string[];
  /** Snapshots vus par participant au début de la réunion (lecture « avant »). */
  seenBefore: Record<string, number>;
}

export interface Review {
  v: 1;
  id: string;
  title: string;
  org: string;
  /** Persona (scénario d'origine) et libellé du destinataire. */
  persona: { scenario: string | null; label: string; audience: string };
  presenter: string;
  recipient: string;
  meetingAt: string;
  meetingLabel: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
  snapshots: Snapshot[];
  /** Commentaire de l'animateur, par snapshot. */
  notes: Record<string, string>;
  people: Person[];
  /** Invités (hors animateur). */
  participants: string[];
  /** Accusés de lecture : personne → snapshot → horodatage. */
  seen: Record<string, Record<string, string>>;
  reactions: Reaction[];
  comments: ReviewComment[];
  items: ReviewItem[];
  meeting: ReviewMeeting;
  share: ReviewShare;
}

/* ------------------------------------------------------------------ lecture */

export function person(r: Review, id: string | null | undefined): Person | null {
  return (id && r.people.find((p) => p.id === id)) || null;
}

export function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("fr-FR"))
    .join("");
}

export function seenCount(r: Review, pid: string): number {
  const s = r.seen[pid] ?? {};
  return r.snapshots.filter((x) => s[x.id]).length;
}

export function hasSeen(r: Review, pid: string, snapId: string): boolean {
  return !!r.seen[pid]?.[snapId];
}

/** Participants ayant tout vu. */
export function allSeenCount(r: Review): number {
  return r.participants.filter((p) => r.snapshots.length > 0 && seenCount(r, p) === r.snapshots.length).length;
}

export function seenBySnapshot(r: Review, snapId: string): number {
  return r.participants.filter((p) => hasSeen(r, p, snapId)).length;
}

export function lastSeenAt(r: Review, pid: string): string | null {
  const v = Object.values(r.seen[pid] ?? {});
  return v.length ? v.sort()[v.length - 1]! : null;
}

/** Retardataires : invités n'ayant pas tout vu. */
export function laggards(r: Review): string[] {
  return r.participants.filter((p) => seenCount(r, p) < r.snapshots.length);
}

export function threadOf(r: Review, snapId: string): ReviewComment[] {
  return r.comments.filter((c) => c.snapId === snapId);
}

export function reactionCount(r: Review, snapId: string, kind: ReactionKind): number {
  return r.reactions.filter((x) => x.snapId === snapId && x.kind === kind).length;
}

/** File de questions de la séance : non répondues, triées par soutiens puis ancienneté. */
export function questionQueue(r: Review): ReviewComment[] {
  return r.comments
    .filter((c) => c.question && c.status === "ouverte")
    .sort((a, b) => b.supports.length - a.supports.length || a.at.localeCompare(b.at));
}

export function snapIndex(r: Review, snapId: string | null): number {
  return snapId ? r.snapshots.findIndex((s) => s.id === snapId) : -1;
}

/* ------------------------------------------------------------------ écriture (copies) */

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function touch(r: Review, now: string): Review {
  return { ...r, updatedAt: now };
}

export function markSeen(r: Review, pid: string, snapId: string, now: string): Review {
  if (hasSeen(r, pid, snapId)) return r;
  return touch({ ...r, seen: { ...r.seen, [pid]: { ...(r.seen[pid] ?? {}), [snapId]: now } } }, now);
}

export function toggleReaction(r: Review, pid: string, snapId: string, kind: ReactionKind, now: string): Review {
  const has = r.reactions.some((x) => x.snapId === snapId && x.author === pid && x.kind === kind);
  const reactions = has ? r.reactions.filter((x) => !(x.snapId === snapId && x.author === pid && x.kind === kind)) : [...r.reactions, { snapId, author: pid, kind }];
  return touch({ ...r, reactions }, now);
}

export function addComment(r: Review, c: Omit<ReviewComment, "id" | "supports" | "status"> & { id?: string }, now: string): Review {
  const text = c.text.trim();
  if (!text) return r;
  const full: ReviewComment = { id: c.id ?? newId("c"), snapId: c.snapId, author: c.author, text: text.slice(0, 1000), at: c.at, parentId: c.parentId, question: c.question, supports: [], status: "ouverte" };
  return touch({ ...r, comments: [...r.comments, full] }, now);
}

export function toggleSupport(r: Review, commentId: string, pid: string, now: string): Review {
  return touch(
    { ...r, comments: r.comments.map((c) => (c.id !== commentId ? c : { ...c, supports: c.supports.includes(pid) ? c.supports.filter((x) => x !== pid) : [...c.supports, pid] })) },
    now
  );
}

export function setQuestionStatus(r: Review, commentId: string, status: QuestionStatus, now: string): Review {
  return touch({ ...r, comments: r.comments.map((c) => (c.id === commentId ? { ...c, status } : c)) }, now);
}

export function addItem(r: Review, it: Omit<ReviewItem, "id"> & { id?: string }, now: string): Review {
  const text = it.text.trim();
  if (!text) return r;
  return touch({ ...r, items: [...r.items, { ...it, id: it.id ?? newId("i"), text: text.slice(0, 500) }] }, now);
}

export function removeItem(r: Review, id: string, now: string): Review {
  return touch({ ...r, items: r.items.filter((x) => x.id !== id) }, now);
}

export function startMeeting(r: Review, now: string): Review {
  if (r.status === "en-reunion" && r.meeting.startedAt) return r;
  const seenBefore = Object.fromEntries(r.participants.map((p) => [p, seenCount(r, p)]));
  const keepStart = r.meeting.startedAt && r.status === "terminee";
  return touch({ ...r, status: "en-reunion", meeting: { ...r.meeting, startedAt: keepStart ? r.meeting.startedAt : now, endedAt: null, seenBefore: keepStart ? r.meeting.seenBefore : seenBefore } }, now);
}

export function endMeeting(r: Review, now: string): Review {
  return touch({ ...r, status: "terminee", meeting: { ...r.meeting, endedAt: now } }, now);
}

export function setCurrent(r: Review, k: number, now: string): Review {
  const current = Math.max(0, Math.min(r.snapshots.length - 1, k));
  return current === r.meeting.current ? r : touch({ ...r, meeting: { ...r.meeting, current } }, now);
}

/* ------------------------------------------------------------------ compte rendu */

export interface ReportReader {
  person: Person;
  seen: boolean[];
  before: number;
  after: number;
  present: boolean;
}

export interface ReportSection {
  index: number;
  snap: Snapshot;
  note: string;
  decisions: ReviewItem[];
  actions: ReviewItem[];
  questions: ReviewComment[];
  comments: number;
  seen: number;
}

export interface Report {
  kpis: { snapshots: number; decisions: number; actions: number; exchanges: number; seenBefore: number; seenAfter: number; total: number };
  decisions: ReviewItem[];
  actions: ReviewItem[];
  readers: ReportReader[];
  present: Person[];
  absent: Person[];
  sections: ReportSection[];
}

export function buildReport(r: Review): Report {
  const n = r.snapshots.length;
  const order = (it: ReviewItem) => (snapIndex(r, it.snapId) + 1 || 999) * 1e13 + Date.parse(it.at || "1970-01-01");
  const decisions = r.items.filter((x) => x.kind === "decision").sort((a, b) => order(a) - order(b));
  const actions = r.items.filter((x) => x.kind === "action").sort((a, b) => order(a) - order(b));
  const before = (p: string) => r.meeting.seenBefore[p] ?? seenCount(r, p);
  const readers = r.participants
    .map((p) => person(r, p))
    .filter((p): p is Person => !!p)
    .map((p) => ({ person: p, seen: r.snapshots.map((s) => hasSeen(r, p.id, s.id)), before: before(p.id), after: seenCount(r, p.id), present: r.meeting.present.includes(p.id) }));
  return {
    kpis: {
      snapshots: n,
      decisions: decisions.length,
      actions: actions.length,
      exchanges: r.comments.length,
      seenBefore: readers.filter((x) => n > 0 && x.before >= n).length,
      seenAfter: readers.filter((x) => n > 0 && x.after >= n).length,
      total: readers.length,
    },
    decisions,
    actions,
    readers,
    present: readers.filter((x) => x.present).map((x) => x.person),
    absent: readers.filter((x) => !x.present).map((x) => x.person),
    sections: r.snapshots.map((snap, index) => ({
      index,
      snap,
      note: r.notes[snap.id] ?? "",
      decisions: decisions.filter((x) => x.snapId === snap.id),
      actions: actions.filter((x) => x.snapId === snap.id),
      questions: r.comments.filter((c) => c.snapId === snap.id && c.question),
      comments: r.comments.filter((c) => c.snapId === snap.id).length,
      seen: seenBySnapshot(r, snap.id),
    })),
  };
}

/** Commentaires d'une diapositive de compte rendu : récit, animateur, décisions et actions (5 au plus). */
export function reportSlideComments(r: Review, snap: Snapshot): string[] {
  const sec = buildReport(r).sections.find((s) => s.snap.id === snap.id);
  const out = [...snap.comments.slice(0, 2)];
  if (sec?.note) out.push(`Animateur : ${sec.note}`);
  for (const d of sec?.decisions ?? []) out.push(`Décision : ${d.text}`);
  for (const a of sec?.actions ?? []) out.push(`Action : ${a.text}${a.owner ? ` — ${person(r, a.owner)?.name ?? ""}` : ""}${a.due ? `, échéance ${frDate(a.due)}` : ""}`);
  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ dates (français) */

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** « 15 oct. 2026 » (date seule aaaa-mm-jj ou ISO). */
export function frDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** « jeu. 8 oct. · 16:00 » (heure locale). */
export function frDateTime(iso: string, withYear = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""} · ${hh}:${mm}`;
}

export function frTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ liens de partage */

/** Lien participant (page dans le Studio, route par fragment) : revue entière ou snapshot. */
export function shareUrl(base: string, r: Review, snapId?: string | null): string {
  return `${base}#/r/${encodeURIComponent(r.id)}${snapId ? `/${encodeURIComponent(snapId)}` : ""}`;
}

export type ReviewRoute =
  | { page: "list"; id: string | null }
  | { page: "share"; id: string; snapId: string | null }
  | { page: "meeting"; id: string }
  | { page: "report"; id: string }
  | { page: "participant"; id: string; snapId: string | null };

/** Routes du fragment : #/revues, #/revues/<id>, #/revues/<id>/partager, …/reunion, …/compte-rendu, #/r/<id>[/<snapshot>]. */
export function parseRoute(hash: string): ReviewRoute | null {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((x) => decodeURIComponent(x));
  if (parts[0] === "r" && parts[1]) return { page: "participant", id: parts[1], snapId: parts[2] ?? null };
  if (parts[0] !== "revues") return null;
  const id = parts[1] ?? null;
  if (!id) return { page: "list", id: null };
  if (parts[2] === "partager") return { page: "share", id, snapId: parts[3] ?? null };
  if (parts[2] === "reunion") return { page: "meeting", id };
  if (parts[2] === "compte-rendu") return { page: "report", id };
  return { page: "list", id };
}

export function routeHash(rt: ReviewRoute): string {
  const e = encodeURIComponent;
  switch (rt.page) {
    case "list":
      return rt.id ? `#/revues/${e(rt.id)}` : "#/revues";
    case "share":
      return `#/revues/${e(rt.id)}/partager${rt.snapId ? `/${e(rt.snapId)}` : ""}`;
    case "meeting":
      return `#/revues/${e(rt.id)}/reunion`;
    case "report":
      return `#/revues/${e(rt.id)}/compte-rendu`;
    case "participant":
      return `#/r/${e(rt.id)}${rt.snapId ? `/${e(rt.snapId)}` : ""}`;
  }
}
