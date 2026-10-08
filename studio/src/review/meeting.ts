/**
 * Mode réunion (animateur) : snapshot en cours, commentaires, « Vu en direct », file de questions triée
 * par soutiens, capture de décisions et d'actions rattachées au snapshot, frise des snapshots.
 */
import { h } from "../ui/dom";
import type { Ctx } from "./ctx";
import {
  addItem,
  endMeeting,
  frDate,
  hasSeen,
  person,
  questionQueue,
  removeItem,
  seenCount,
  setCurrent,
  setQuestionStatus,
  snapIndex,
  type Review,
} from "./model";
import { avatar, chartBox, ic } from "./view";

let draft: { kind: "decision" | "action"; text: string; owner: string; due: string; fromQuestion: string | null } | null = null;

function chrono(startIso: string | null, nowIso: string): string {
  if (!startIso) return "00:00:00";
  const ms = Date.parse(nowIso) - Date.parse(startIso);
  if (ms < 0 || ms > 12 * 3600e3) return "reprise";
  const t = Math.floor(ms / 1000);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((x) => String(x).padStart(2, "0")).join(":");
}

export function meetingPage(ctx: Ctx, r: Review): { el: HTMLElement; cleanup: () => void } {
  const n = r.snapshots.length;
  const k = Math.min(r.meeting.current, n - 1);
  const s = r.snapshots[k]!;
  const pres = person(r, r.presenter);
  const now = ctx.now();
  const present = r.meeting.present;
  const go = (j: number) => ctx.save(setCurrent(r, j, ctx.now()));
  const chart = chartBox(s, ctx.deps.datasetFor(s), {});
  const clock = h("span", { class: "rv-live-clock", "data-testid": "rv-clock" }, chrono(r.meeting.startedAt, now));
  const timer = window.setInterval(() => (clock.textContent = chrono(r.meeting.startedAt, ctx.now())), 1000);

  // Vu en direct
  const live = r.participants.map((pid) => {
    const p = person(r, pid)!;
    const here = present.includes(pid);
    const all = seenCount(r, pid) === n;
    const before = (r.meeting.seenBefore[pid] ?? 0) >= n;
    const state = here ? (all ? (before ? "Vu avant la réunion" : "Vu en direct") : `Connecté·e · ${seenCount(r, pid)}/${n} vus`) : all ? "Absent·e · avait tout vu" : "Absent·e";
    return h(
      "button",
      { class: `rv-live${here ? "" : " away"}${all ? " ok" : ""}`, type: "button", title: here ? "Marquer absent·e" : "Marquer présent·e", "data-testid": `rv-live-${pid}`, onclick: () => ctx.save({ ...r, meeting: { ...r.meeting, present: here ? present.filter((x) => x !== pid) : [...present, pid] } }) },
      avatar(p, 28),
      h("span", { class: "rv-live-id" }, h("strong", null, p.name), h("small", null, p.role)),
      h("small", { class: "rv-live-state" }, all ? ic("check", 13) : hasSeen(r, pid, s.id) ? ic("eye", 13) : null, state)
    );
  });

  // file de questions
  const queue = questionQueue(r).map((c) => {
    const p = person(r, c.author);
    const j = snapIndex(r, c.snapId);
    return h(
      "div",
      { class: "rv-q", "data-testid": "rv-queue-item" },
      h("div", { class: "rv-q-head" }, h("b", { class: "rv-q-votes", title: "Soutiens" }, ic("arrowUp", 12), String(c.supports.length)), avatar(p, 22), h("strong", null, p?.name ?? "?"), h("small", null, `snapshot ${j + 1}`)),
      h("p", null, c.text),
      h(
        "div",
        { class: "rv-q-acts" },
        h("button", { class: "rv-link", type: "button", onclick: () => go(j) }, "Afficher"),
        h("button", { class: "rv-link", type: "button", "data-testid": "rv-q-answered", onclick: () => ctx.save(setQuestionStatus(r, c.id, "repondue", ctx.now())) }, "Répondue"),
        h("button", { class: "rv-link", type: "button", "data-testid": "rv-q-action", onclick: () => ((draft = { kind: "action", text: c.text.replace(/\s*\?$/, ""), owner: c.author, due: "", fromQuestion: c.id }), j !== k ? go(j) : ctx.save({ ...r })) }, "En action")
      )
    );
  });

  // décision / action
  const d = draft ?? { kind: "decision" as const, text: "", owner: r.recipient, due: "", fromQuestion: null };
  const kindBtn = (kind: "decision" | "action", label: string) => h("button", { class: `rv-chip${d.kind === kind ? " on" : ""}`, type: "button", "data-testid": `rv-kind-${kind}`, onclick: () => ((draft = { ...d, kind, text: textIn.value, owner: ownerIn.value, due: dueIn.value }), ctx.save({ ...r })) }, label);
  const textIn = h("input", { class: "rv-input", value: d.text, placeholder: d.kind === "decision" ? "Décision prise…" : "Action à mener…", "aria-label": "Texte", "data-testid": "rv-item-text" }) as HTMLInputElement;
  const ownerIn = h("select", { class: "rv-input", "aria-label": "Responsable", "data-testid": "rv-item-owner" }, ...[r.presenter, ...r.participants].map((pid) => h("option", { value: pid, selected: pid === d.owner }, person(r, pid)?.name ?? pid))) as HTMLSelectElement;
  const dueIn = h("input", { class: "rv-input", type: "date", value: d.due, "aria-label": "Échéance", "data-testid": "rv-item-due" }) as HTMLInputElement;
  textIn.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") add();
  });
  function add(): void {
    if (!textIn.value.trim()) return textIn.focus();
    let next = addItem(r, { snapId: s.id, kind: d.kind, text: textIn.value, owner: ownerIn.value || null, due: d.kind === "action" ? dueIn.value || null : null, by: r.presenter, at: ctx.now(), fromQuestion: d.fromQuestion }, ctx.now());
    if (d.fromQuestion) next = setQuestionStatus(next, d.fromQuestion, "en-action", ctx.now());
    draft = { kind: d.kind, text: "", owner: r.recipient, due: "", fromQuestion: null };
    ctx.save(next);
  }
  const items = r.items.filter((x) => x.snapId === s.id);
  const itemEl = (x: (typeof items)[number]) =>
    h(
      "div",
      { class: `rv-item k-${x.kind}`, "data-testid": "rv-item" },
      h("span", { class: "rv-item-kind" }, x.kind === "decision" ? "Décision" : "Action"),
      h("span", { class: "rv-item-text" }, x.text),
      h("small", null, [person(r, x.owner)?.name, x.due ? `échéance ${frDate(x.due)}` : null].filter(Boolean).join(" · ")),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Retirer", title: "Retirer", onclick: () => ctx.save(removeItem(r, x.id, ctx.now())) }, "×")
    );

  const strip = r.snapshots.map((x, j) => {
    const dec = r.items.filter((y) => y.snapId === x.id && y.kind === "decision").length;
    const act = r.items.filter((y) => y.snapId === x.id && y.kind === "action").length;
    return h(
      "button",
      { class: `rv-strip-item${j === k ? " cur" : j < k ? " done" : ""}`, type: "button", "data-testid": `rv-strip-${j + 1}`, onclick: () => go(j) },
      chartBox(x, ctx.deps.datasetFor(x), { thumb: true }).el,
      h("span", { class: "rv-strip-title" }, `${j + 1}. ${x.title}`),
      h("small", null, j === k ? "en cours" : j < k ? `présenté · ${dec} déc. · ${act} act.` : dec + act ? `${dec} déc. · ${act} act.` : "à venir")
    );
  });

  const el = h(
    "div",
    { class: "rv-meet", "data-testid": "rv-meeting-page" },
    h(
      "header",
      { class: "rv-meet-top" },
      h("button", { class: "btn btn-ghost", type: "button", title: "Retour à la revue", onclick: () => ctx.go({ page: "list", id: r.id }) }, "‹ Revue"),
      h("div", { class: "rv-meet-title" }, h("strong", null, r.title), h("small", null, `${r.meetingLabel} · animation ${pres?.name ?? ""} · ${r.org}`)),
      h("span", { class: "rv-live-pill" }, h("i", null), "En réunion · ", clock),
      h("span", { class: "rv-pill" }, ic("users", 14), `${present.length}/${r.participants.length} connectés`),
      h("span", { class: "rv-spacer" }),
      h("button", { class: "btn", type: "button", "data-testid": "rv-project", title: "Film plein écran à partir du snapshot en cours", onclick: () => ctx.deps.film(r.snapshots, k) }, ic("screen", 15), "Projeter"),
      h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-end", onclick: () => (ctx.save(endMeeting(r, ctx.now())), ctx.go({ page: "report", id: r.id })) }, ic("doc", 15), "Terminer et générer le compte rendu")
    ),
    h(
      "div",
      { class: "rv-meet-body" },
      h(
        "section",
        { class: "rv-meet-main" },
        h(
          "div",
          { class: "rv-meet-head" },
          h("button", { class: "btn", type: "button", "aria-label": "Snapshot précédent", disabled: k === 0, onclick: () => go(k - 1) }, "‹"),
          h("div", null, h("h2", { "data-testid": "rv-meet-title" }, `${k + 1}. ${s.title}`), h("p", { class: "rv-sub" }, s.subtitle)),
          h("button", { class: "btn", type: "button", "aria-label": "Snapshot suivant", "data-testid": "rv-meet-next", disabled: k === n - 1, onclick: () => go(k + 1) }, "›")
        ),
        chart.el,
        h(
          "div",
          { class: "rv-meet-comments" },
          h("div", { class: "rv-gen" }, h("h4", null, ic("sparkle", 14), "Commentaire généré"), h("ul", null, ...s.comments.map((c) => h("li", null, c)))),
          r.notes[s.id] ? h("div", { class: "rv-gen" }, h("h4", null, ic("pen", 14), "Commentaire de l'animation"), h("p", null, r.notes[s.id])) : null
        ),
        h(
          "div",
          { class: "rv-capture", "data-testid": "rv-capture" },
          h("h4", null, ic("flag", 15), "Décision / action", h("small", null, `rattachée au snapshot ${k + 1}`)),
          h("div", { class: "rv-row" }, kindBtn("decision", "Décision"), kindBtn("action", "Action"), d.fromQuestion ? h("small", { class: "muted" }, "depuis une question de la file") : null),
          h("div", { class: "rv-capture-form" }, textIn, ownerIn, d.kind === "action" ? dueIn : null, h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-item-add", onclick: add }, ic("plus", 14), "Ajouter")),
          ...items.map(itemEl)
        )
      ),
      h(
        "aside",
        { class: "rv-meet-side" },
        h("h4", null, ic("eye", 15), "Vu en direct", h("small", null, "toucher : présent / absent")),
        h("div", { class: "rv-live-list" }, ...live),
        h("h4", null, ic("question", 15), `File de questions · ${queue.length}`, h("small", null, "triée par soutiens")),
        h("div", { class: "rv-queue", "data-testid": "rv-queue" }, ...(queue.length ? queue : [h("p", { class: "muted small" }, "Aucune question en attente.")]))
      )
    ),
    h("footer", { class: "rv-strip" }, ...strip)
  );
  return { el, cleanup: () => (chart.stop(), clearInterval(timer)) };
}

export function resetMeetingDraft(): void {
  draft = null;
}
