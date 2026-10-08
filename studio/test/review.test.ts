/**
 * Revues partagées : revues de démonstration Norvia (vrais snapshots des scénarios, ids stables),
 * lectures, réactions, questions, décisions / actions, réunion, compte rendu, routes, stockage local,
 * seuil de matérialité des étiquettes d'écart mensuel (étape 5 de la démo finance).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { sampleById } from "../src/data/samples";
import { buildDataset } from "../src/data/table";
import { buildDrillModel } from "../src/data/drill";
import { hashRows } from "../src/provenance";
import { SCENARIO_DAF, SCENARIO_DIRCOM, guessBinding, runScenario, scenarioSnapshotId } from "../src/story/scenarios";
import { parseSpec, type ChartSpec } from "../src/spec";
import { DEMO_FINANCE_ID, DEMO_PIPELINE_ID, demoFinanceReview, demoPipelineReview, demoReviews } from "../src/review/demo";
import {
  addComment,
  addItem,
  allSeenCount,
  buildReport,
  endMeeting,
  laggards,
  markSeen,
  parseRoute,
  questionQueue,
  reactionCount,
  removeItem,
  reportSlideComments,
  routeHash,
  seenCount,
  setCurrent,
  setQuestionStatus,
  shareUrl,
  startMeeting,
  toggleReaction,
  toggleSupport,
  type Review,
  type ReviewRoute,
} from "../src/review/model";
import { LocalReviewStorage, REVIEWS_KEY, memoryKv } from "../src/review/storage";

let P: Review;
let F: Review;
const NOW = "2026-10-08T15:00:00.000Z";

beforeAll(async () => {
  P = await demoPipelineReview();
  F = await demoFinanceReview();
});

async function scenarioIds(sampleId: string, sc: typeof SCENARIO_DIRCOM) {
  const s = sampleById(sampleId)!;
  const rows = s.rows();
  const ds = buildDataset(s.name, rows);
  const hash = await hashRows(rows);
  const run = runScenario(sc, ds, guessBinding(sc, ds));
  return { ids: run.frames.map((f) => scenarioSnapshotId(sc, f.step, hash)), titles: run.frames.map((f) => f.story?.title ?? "") };
}

describe("revues de démonstration Norvia", () => {
  it("revue pipeline : les 7 snapshots du Scénario Directeur commercial, ids stables identiques au Studio", async () => {
    expect(P.snapshots[0]!.sampleId).toBe("demo-pipeline");
    const exp = await scenarioIds("demo-pipeline", SCENARIO_DIRCOM);
    expect(P.id).toBe(DEMO_PIPELINE_ID);
    expect(P.title).toBe("Revue pipeline — octobre 2026");
    expect(P.snapshots).toHaveLength(7);
    expect(P.snapshots.map((s) => s.id)).toEqual(exp.ids);
    expect(P.snapshots.map((s) => s.title)).toEqual(exp.titles);
    for (const s of P.snapshots) {
      expect(s.id).toMatch(/^dircom-0\d-/);
      expect(s.scenario).toBe("dircom");
      expect(s.comments.length).toBeGreaterThanOrEqual(2);
      expect(parseSpec(s.spec).ok).toBe(true);
    }
  });

  it("revue DAF : les 7 snapshots du Scénario Directeur financier", async () => {
    const exp = await scenarioIds(F.snapshots[0]!.sampleId!, SCENARIO_DAF);
    expect(F.id).toBe(DEMO_FINANCE_ID);
    expect(F.snapshots.map((s) => s.id)).toEqual(exp.ids);
    expect(F.snapshots.every((s) => /^daf-0\d-/.test(s.id))).toBe(true);
    expect(F.status).toBe("partagee");
  });

  it("une seule société fictive, Norvia, partout (revues, sources des exemples)", async () => {
    for (const r of [P, F]) {
      expect(r.org).toMatch(/^Norvia · /);
      expect(r.demo).toBe(true);
      const txt = JSON.stringify(r);
      expect(txt).not.toMatch(/Tell4D|Alteridea SA|Acme/);
      expect(txt).not.toMatch(/certifi|conforme|authenticit|preuve/i);
    }
    expect(P.snapshots[0]!.source).toMatch(/Norvia/);
    expect(F.snapshots[0]!.source).toMatch(/Norvia/);
    expect((await demoReviews()).map((r) => r.id)).toEqual([DEMO_PIPELINE_ID, DEMO_FINANCE_ID]);
  });

  it("lecture : 8/9 ont tout vu (7 avant la réunion), compte rendu 2 décisions et 3 actions", () => {
    expect(allSeenCount(P)).toBe(8);
    expect(P.participants).toHaveLength(9);
    expect(laggards(P)).toHaveLength(1);
    const rep = buildReport(P);
    expect(rep.kpis).toMatchObject({ snapshots: 7, decisions: 2, actions: 3, seenBefore: 7, seenAfter: 8, total: 9 });
    expect(rep.sections).toHaveLength(7);
    expect(rep.readers).toHaveLength(9);
    expect(rep.present.length + rep.absent.length).toBe(9);
    expect(allSeenCount(F)).toBe(4);
    expect(buildReport(F).kpis).toMatchObject({ decisions: 0, actions: 0, total: 6 });
  });
});

describe("interactions (copies, sans effet de bord)", () => {
  it("« J'ai vu » idempotent, réactions bascule", () => {
    const s = F.snapshots[0]!.id;
    const pid = laggards(F)[0]!;
    const before = seenCount(F, pid);
    const r1 = markSeen(F, pid, s, NOW);
    expect(seenCount(r1, pid)).toBe(before + (F.seen[pid]?.[s] ? 0 : 1));
    expect(markSeen(r1, pid, s, NOW)).toBe(r1);
    expect(seenCount(F, pid)).toBe(before);
    const n = reactionCount(F, s, "utile");
    const r2 = toggleReaction(F, pid, s, "utile", NOW);
    expect(reactionCount(r2, s, "utile")).toBe(n + (F.reactions.some((x) => x.author === pid && x.snapId === s && x.kind === "utile") ? -1 : 1));
    expect(reactionCount(toggleReaction(r2, pid, s, "utile", NOW), s, "utile")).toBe(n);
  });

  it("questions : file triée par soutiens, « Moi aussi », statut répondue / en action", () => {
    const s = F.snapshots[1]!.id;
    let r = addComment(F, { id: "q-test", snapId: s, author: "kh", text: "  Question test ?  ", at: NOW, parentId: null, question: true }, NOW);
    expect(r.comments.find((c) => c.id === "q-test")?.text).toBe("Question test ?");
    expect(addComment(F, { snapId: s, author: "kh", text: "   ", at: NOW, parentId: null, question: false }, NOW)).toBe(F);
    const q = questionQueue(r);
    for (let i = 1; i < q.length; i++) expect(q[i - 1]!.supports.length).toBeGreaterThanOrEqual(q[i]!.supports.length);
    for (const p of ["cv", "md", "pr", "im", "es"]) r = toggleSupport(r, "q-test", p, NOW);
    expect(questionQueue(r)[0]!.id).toBe("q-test");
    r = toggleSupport(r, "q-test", "cv", NOW);
    expect(r.comments.find((c) => c.id === "q-test")!.supports).toHaveLength(4);
    r = setQuestionStatus(r, "q-test", "en-action", NOW);
    expect(questionQueue(r).some((c) => c.id === "q-test")).toBe(false);
  });

  it("réunion : démarrage (lecture avant figée), snapshot courant, décision / action, fin", () => {
    let r = startMeeting(F, NOW);
    expect(r.status).toBe("en-reunion");
    expect(r.meeting.startedAt).toBe(NOW);
    expect(Object.values(r.meeting.seenBefore).filter((v) => v === 7)).toHaveLength(4);
    expect(startMeeting(r, "2026-10-08T16:00:00Z")).toBe(r);
    r = setCurrent(r, 99, NOW);
    expect(r.meeting.current).toBe(6);
    r = addItem(r, { id: "d1", snapId: r.snapshots[0]!.id, kind: "decision", text: "Budget validé", owner: "cv", due: null, by: "sl", at: NOW }, NOW);
    r = addItem(r, { id: "a1", snapId: r.snapshots[2]!.id, kind: "action", text: "Chiffrer le risque abonnements", owner: "pr", due: "2026-10-23", by: "sl", at: NOW }, NOW);
    expect(addItem(r, { snapId: "x", kind: "action", text: " ", owner: null, due: null, by: "sl", at: NOW }, NOW)).toBe(r);
    r = endMeeting(r, "2026-10-09T14:52:00Z");
    expect(r.status).toBe("terminee");
    const rep = buildReport(r);
    expect(rep.kpis.decisions).toBe(1);
    expect(rep.kpis.actions).toBe(1);
    expect(rep.sections[2]!.actions.map((a) => a.id)).toEqual(["a1"]);
    const slide = reportSlideComments(r, r.snapshots[2]!);
    expect(slide.some((c) => /Action : Chiffrer le risque abonnements/.test(c))).toBe(true);
    expect(removeItem(r, "a1", NOW).items.map((x) => x.id)).toEqual(["d1"]);
    // reprise d'une réunion terminée : on garde le début et la lecture d'avant
    const again = startMeeting(r, "2026-10-10T09:00:00Z");
    expect(again.meeting.startedAt).toBe(NOW);
  });
});

describe("liens de partage (routes par fragment)", () => {
  it("lien participant : revue entière ou snapshot", () => {
    const base = "https://alteridea-dashboard.web.app/reporting/";
    expect(shareUrl(base, P)).toBe(`${base}#/r/${DEMO_PIPELINE_ID}`);
    const s = P.snapshots[2]!.id;
    expect(shareUrl(base, P, s)).toBe(`${base}#/r/${DEMO_PIPELINE_ID}/${s}`);
    expect(parseRoute(shareUrl(base, P, s).slice(base.length))).toEqual({ page: "participant", id: DEMO_PIPELINE_ID, snapId: s });
  });
  it("aller-retour route ↔ fragment", () => {
    const routes: ReviewRoute[] = [
      { page: "list", id: null },
      { page: "list", id: "x" },
      { page: "share", id: "x", snapId: null },
      { page: "share", id: "x", snapId: "daf-01-a" },
      { page: "meeting", id: "x" },
      { page: "report", id: "x" },
      { page: "participant", id: "x", snapId: null },
      { page: "participant", id: "x", snapId: "dircom-03-b" },
    ];
    for (const rt of routes) expect(parseRoute(routeHash(rt))).toEqual(rt);
    expect(parseRoute("")).toBeNull();
    expect(parseRoute("#")).toBeNull();
    expect(parseRoute("#/autre")).toBeNull();
    expect(routeHash({ page: "meeting", id: "x" })).toBe("#/revues/x/reunion");
    expect(routeHash({ page: "report", id: "x" })).toBe("#/revues/x/compte-rendu");
  });
});

describe("stockage local (interface ReviewStorage)", () => {
  it("enregistrer, relire, remplacer, supprimer, participant de cet appareil", () => {
    const kv = memoryKv();
    const st = new LocalReviewStorage(kv, false);
    expect(st.seeded()).toBe(false);
    let calls = 0;
    st.subscribe(() => calls++);
    st.replaceAll([P, F]);
    expect(st.seeded()).toBe(true);
    expect(st.list().map((r) => r.id)).toEqual([DEMO_FINANCE_ID, DEMO_PIPELINE_ID]); // réunion la plus proche d'abord (date décroissante)
    const pid = laggards(F)[0]!;
    const unseen = F.snapshots.find((s) => !F.seen[pid]?.[s.id])!.id;
    st.save(markSeen(F, pid, unseen, NOW));
    const fresh = new LocalReviewStorage(kv, false);
    expect(fresh.get(DEMO_FINANCE_ID)?.seen[pid]?.[unseen]).toBe(NOW);
    st.setMe(DEMO_FINANCE_ID, "kh");
    expect(fresh.me(DEMO_FINANCE_ID)).toBe("kh");
    st.remove(DEMO_PIPELINE_ID);
    expect(new LocalReviewStorage(kv, false).list().map((r) => r.id)).toEqual([DEMO_FINANCE_ID]);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(kv.getItem(REVIEWS_KEY)!).reviews).toHaveLength(1);
  });
  it("données illisibles : liste vide, pas d'exception", () => {
    const kv = memoryKv();
    kv.setItem(REVIEWS_KEY, "{pas du json");
    expect(new LocalReviewStorage(kv, false).list()).toEqual([]);
  });
});

describe("étape 5 de la démo finance : pas d'étiquette d'écart sous le seuil de matérialité", () => {
  it("les écarts mensuels < 0,5 % du plus grand écart n'ont pas d'étiquette", async () => {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { document, window });
    const render = await import("../src/charts/render");
    const snap = F.snapshots[4]!;
    expect(snap.id).toMatch(/^daf-05-/);
    const spec = parseSpec(snap.spec);
    if (!spec.ok) throw new Error("spec");
    const sm = sampleById(snap.sampleId!)!;
    const ds = buildDataset(sm.name, sm.rows());
    const model = buildDrillModel({ drill: spec.spec.drill, transform: spec.spec.transform }, ds).model;
    if (model?.view !== "compare") throw new Error(String(model?.view));
    const deltas = model.months.map((m) => m.delta).filter((d): d is number => d != null);
    const max = Math.max(...deltas.map(Math.abs));
    const tinyN = deltas.filter((d) => Math.abs(d) < max * 0.005).length;
    expect(tinyN).toBeGreaterThan(0);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const sp: ChartSpec = spec.spec;
    render.renderChart(svg, sp, ds, render.prepareCache(sp, ds, null, -1), { build: 1, timePos: null }, { now: new Date(2026, 9, 8) });
    const bars = [...svg.querySelectorAll("rect.r4d-drill-var")];
    expect(bars).toHaveLength(deltas.length);
    const labelled = bars.filter((b) => b.nextElementSibling?.tagName.toLowerCase() === "text").length;
    expect(labelled).toBe(deltas.length - tinyN);
  });
});
