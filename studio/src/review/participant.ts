/**
 * Page participant (ouverte par le lien ou le QR d'une revue / d'un snapshot) : graphique animé,
 * commentaire généré + commentaire de l'animateur, « J'ai vu », réactions, fil de commentaires et questions,
 * précédent / suivant (flèches, balayage sur iPad / iPhone), « Revoir l'animation ».
 */
import { h } from "../ui/dom";
import { ROLE_LABELS } from "../story/snapshots";
import type { Ctx } from "./ctx";
import {
  REACTIONS,
  addComment,
  frDate,
  frDateTime,
  hasSeen,
  markSeen,
  person,
  reactionCount,
  seenCount,
  threadOf,
  toggleReaction,
  toggleSupport,
  type Review,
  type ReviewComment,
} from "./model";
import { avatar, chartBox, ic } from "./view";
import { LOCAL_NOTE, brandIcon } from "./list";

let animated = "";
let replyTo: string | null = null;

/** Format de rendu selon la largeur de l'écran (textes lisibles sur téléphone). */
export function participantChartSize(vw: number): { size?: { width: number; height: number }; boost?: number } {
  if (vw < 700) return { size: { width: 620, height: 700 }, boost: 1.55 };
  if (vw < 1000) return { size: { width: 1000, height: 720 }, boost: 1.35 };
  return {};
}

/** Largeur utile de l'écran (sur iPhone, la page du Studio peut élargir la fenêtre de mise en page). */
export function viewportWidth(): number {
  const w = [window.innerWidth, window.visualViewport?.width ?? Infinity, window.screen?.width || Infinity];
  return Math.min(...w);
}

/** Classe de taille (téléphone / tablette / bureau) : re-rendu si elle change (rotation). */
export function sizeClass(vw = viewportWidth()): string {
  return vw < 700 ? "phone" : vw < 1000 ? "tablet" : "desktop";
}

export function participantPage(ctx: Ctx, r: Review, snapId: string | null, opts: { onNav: (k: number) => void }): { el: HTMLElement; cleanup: () => void } {
  const n = r.snapshots.length;
  const me = ctx.me(r);
  const meP = person(r, me);
  let k = snapId ? r.snapshots.findIndex((s) => s.id === snapId) : -1;
  if (k < 0) k = Math.max(0, r.snapshots.findIndex((s) => !hasSeen(r, me, s.id)));
  const s = r.snapshots[k]!;
  const seenHere = hasSeen(r, me, s.id);
  const others = r.participants.filter((p) => p !== me);
  const seers = r.participants.filter((p) => hasSeen(r, p, s.id));
  const notYet = r.participants.filter((p) => !hasSeen(r, p, s.id));
  const pres = person(r, r.presenter);
  const chart = chartBox(s, ctx.deps.datasetFor(s), participantChartSize(viewportWidth()));
  const go = (j: number) => opts.onNav(Math.max(0, Math.min(n - 1, j)));

  // balayage (iPad / iPhone)
  let x0: number | null = null;
  chart.el.addEventListener("touchstart", (e) => (x0 = e.touches[0]?.clientX ?? null), { passive: true });
  chart.el.addEventListener("touchend", (e) => {
    const x1 = e.changedTouches[0]?.clientX;
    if (x0 != null && x1 != null && Math.abs(x1 - x0) > 60) go(k + (x1 < x0 ? 1 : -1));
    x0 = null;
  });

  const steps = h(
    "nav",
    { class: "rv-steps", "aria-label": "Snapshots de la revue" },
    ...r.snapshots.map((x, j) => h("button", { class: `${j === k ? "cur" : ""}${hasSeen(r, me, x.id) ? " seen" : ""}`, type: "button", title: `${j + 1}. ${x.title}`, "aria-label": `Snapshot ${j + 1}`, onclick: () => go(j) }))
  );
  const who = h(
    "select",
    { class: "rv-who", "aria-label": "Vous êtes", "data-testid": "rv-who", onchange: (e: Event) => ctx.setMe(r, (e.target as HTMLSelectElement).value) },
    ...[r.presenter, ...r.participants].map((pid) => h("option", { value: pid, selected: pid === me }, `${person(r, pid)?.name}${pid === r.presenter ? " (animation)" : ""}`))
  );
  const seenBtn = h(
    "button",
    { class: `rv-seen-btn${seenHere ? " done" : ""}`, type: "button", "data-testid": "rv-seen", disabled: seenHere, onclick: () => ctx.save(markSeen(r, me, s.id, ctx.now())) },
    ic(seenHere ? "check" : "eye", 20),
    seenHere ? "Vu" : "J'ai vu"
  );
  const seenLine = r.share.showSeen
    ? h(
        "div",
        { class: "rv-seen-line", "data-testid": "rv-seen-line" },
        h("span", { class: "rv-av-stack" }, ...seers.slice(0, 9).map((p) => avatar(person(r, p), 26))),
        h("small", null, `Vu par ${seers.length}/${r.participants.length}`, notYet.length ? ` · pas encore : ${notYet.map((p) => person(r, p)?.name.split(" ")[0]).join(", ")}` : " · tout le monde")
      )
    : null;
  const reactions = h(
    "div",
    { class: "rv-reacts" },
    ...REACTIONS.map((x) => {
      const mine = r.reactions.some((y) => y.snapId === s.id && y.author === me && y.kind === x.kind);
      return h("button", { class: `rv-react${mine ? " on" : ""}`, type: "button", "aria-pressed": String(mine), "data-testid": `rv-react-${x.kind}`, onclick: () => ctx.save(toggleReaction(r, me, s.id, x.kind, ctx.now())) }, x.label, h("b", null, String(reactionCount(r, s.id, x.kind))));
    })
  );

  const thread = threadOf(r, s.id);
  const roots = thread.filter((c) => !c.parentId);
  const commentEl = (c: ReviewComment, reply = false): HTMLElement => {
    const p = person(r, c.author);
    const replies = thread.filter((x) => x.parentId === c.id);
    const supported = c.supports.includes(me);
    return h(
      "div",
      { class: `rv-comment${reply ? " reply" : ""}${c.question ? " question" : ""}`, "data-testid": "rv-comment" },
      avatar(p, reply ? 24 : 28),
      h(
        "div",
        { class: "rv-comment-body" },
        h("div", { class: "rv-comment-head" }, h("strong", null, p?.name ?? "?"), c.author === r.presenter ? h("span", { class: "rv-tag" }, "animation") : null, h("small", null, frDateTime(c.at))),
        c.question ? h("span", { class: `rv-qtag q-${c.status}` }, ic("question", 12), c.status === "repondue" ? "Question · répondue" : c.status === "en-action" ? "Question · passée en action" : "Question pour la séance") : null,
        h("p", null, c.text),
        reply
          ? null
          : h(
              "div",
              { class: "rv-comment-acts" },
              c.question ? h("button", { class: `rv-link${supported ? " on" : ""}`, type: "button", "data-testid": "rv-support", onclick: () => ctx.save(toggleSupport(r, c.id, me, ctx.now())) }, ic("arrowUp", 12), `Moi aussi · ${c.supports.length}`) : null,
              r.share.comments ? h("button", { class: "rv-link", type: "button", onclick: () => ((replyTo = c.id), opts.onNav(k)) }, "Répondre") : null
            ),
        ...replies.map((x) => commentEl(x, true)),
        replyTo === c.id ? composer(true, c.id) : null
      )
    );
  };
  function composer(reply: boolean, parentId: string | null): HTMLElement {
    const ta = h("textarea", { rows: reply ? 2 : 3, placeholder: reply ? "Votre réponse…" : "Votre question ou votre commentaire…", "aria-label": reply ? "Réponse" : "Question ou commentaire", "data-testid": reply ? "rv-reply-text" : "rv-ask-text" }) as HTMLTextAreaElement;
    const q = h("input", { type: "checkbox", checked: !reply, "data-testid": "rv-ask-question" }) as HTMLInputElement;
    const send = () => {
      if (!ta.value.trim()) return;
      replyTo = null;
      ctx.save(addComment(r, { snapId: s.id, author: me, text: ta.value, at: ctx.now(), parentId, question: !reply && q.checked }, ctx.now()));
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
      e.stopPropagation();
    });
    return h(
      "div",
      { class: "rv-composer" },
      ta,
      h(
        "div",
        { class: "rv-row" },
        reply ? null : h("label", { class: "rv-toggle small" }, q, h("span", null, "Question pour la séance")),
        h("span", { class: "rv-spacer" }),
        reply ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => ((replyTo = null), opts.onNav(k)) }, "Annuler") : null,
        h("button", { class: "btn btn-accent", type: "button", "data-testid": reply ? "rv-reply-send" : "rv-ask-send", onclick: send }, ic(reply ? "chat" : "question", 15), reply ? "Répondre" : "Poser une question")
      )
    );
  }

  const next = r.snapshots[k + 1];
  const meSeen = seenCount(r, me);
  const prov = (s.spec as { provenance?: { hash?: string } } | null)?.provenance?.hash;
  const el = h(
    "div",
    { class: "rv-part", "data-testid": "rv-participant" },
    h(
      "header",
      { class: "rv-part-top" },
      h("a", { class: "rv-part-logo", href: "#/revues", title: "Revues (animation)", html: brandIcon() }),
      h("div", { class: "rv-part-title" }, h("strong", null, r.title), h("small", null, `réunion ${frDateTime(r.meetingAt)} · ${r.org}`)),
      h("label", { class: "rv-part-me" }, h("small", null, "Vous êtes"), who, avatar(meP, 30))
    ),
    steps,
    h(
      "main",
      { class: "rv-part-body" },
      h(
        "section",
        { class: "rv-part-chart" },
        h("p", { class: "rv-eyebrow" }, `SNAPSHOT ${k + 1} / ${n} · ${ROLE_LABELS[s.role].toLocaleUpperCase("fr-FR")}`),
        h("h1", { "data-testid": "rv-part-title" }, s.title),
        h("p", { class: "rv-sub" }, s.subtitle),
        chart.el,
        h(
          "div",
          { class: "rv-row rv-chart-acts" },
          h("button", { class: "btn", type: "button", "data-testid": "rv-replay", onclick: () => chart.play() }, ic("replay", 15), h("span", { class: "rv-l-long" }, "Revoir l'animation"), h("span", { class: "rv-l-short" }, "Revoir")),
          ctx.deps.read ? h("button", { class: "btn", type: "button", "data-testid": "rv-part-read", title: "Lecture plein écran à partir de ce snapshot", onclick: () => ctx.deps.read?.(r.id, s.id) }, ic("book", 15), h("span", { class: "rv-l-long" }, "Mode lecture"), h("span", { class: "rv-l-short" }, "Lecture")) : null,
          h("span", { class: "rv-swipe muted small" }, "‹ glisser ›"),
          h("span", { class: "rv-spacer" }),
          prov ? h("small", { class: "muted" }, `Empreinte des données ${prov.slice(0, 4)}·${prov.slice(4, 8)}`) : null
        )
      ),
      h(
        "section",
        { class: "rv-part-acts" },
        seenBtn,
        seenLine,
        reactions
      ),
      h(
        "section",
        { class: "rv-part-comments" },
        h("div", { class: "rv-gen" }, h("h4", null, ic("sparkle", 14), "Commentaire généré", h("small", null, "par Datanime, à partir des données")), h("ul", null, ...s.comments.map((c) => h("li", null, c)))),
        r.notes[s.id] ? h("div", { class: "rv-note" }, avatar(pres, 30), h("div", null, h("h4", null, `${pres?.name ?? "Animation"} `, h("small", null, "(animation)")), h("p", null, r.notes[s.id]))) : null
      ),
      h(
        "section",
        { class: "rv-part-thread" },
        h("h4", null, ic("chat", 15), `Discussion · ${thread.length}`),
        ...(r.share.comments ? roots.map((c) => commentEl(c)) : [h("p", { class: "muted small" }, "Commentaires désactivés pour cette revue.")]),
        r.share.comments ? composer(false, null) : null
      )
    ),
    h(
      "footer",
      { class: "rv-part-nav" },
      h("button", { class: "btn", type: "button", "data-testid": "rv-prev", disabled: k === 0, onclick: () => go(k - 1) }, "‹ Précédent"),
      h("span", { class: "rv-part-count", "data-testid": "rv-part-count" }, `${k + 1} / ${n} · ${meSeen} vu${meSeen > 1 ? "s" : ""}`),
      next ? h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-next", onclick: () => go(k + 1) }, h("span", { class: "rv-next-label" }, `Suivant : ${next.title}`), h("span", { class: "rv-next-short" }, "Suivant")) : h("a", { class: "btn btn-accent", href: "#/revues", "data-testid": "rv-done" }, "Terminé")
    ),
    h("p", { class: "rv-part-foot" }, ic("eye", 12), `Page privée — visible par les ${others.length + 1} participants invités. Données au ${frDate(s.generatedAt || s.createdAt)}. ${LOCAL_NOTE}`)
  );
  // animation à l'arrivée sur un snapshot (pas à chaque mise à jour du fil)
  const key = `${r.id}/${s.id}`;
  if (animated !== key) {
    animated = key;
    requestAnimationFrame(() => chart.play());
  }
  return { el, cleanup: chart.stop };
}

export function resetParticipantAnimation(): void {
  animated = "";
}
