/**
 * Compte rendu automatique : décisions, actions, accusés de lecture (qui a lu quoi), une section par snapshot.
 * Exportable en PowerPoint (exporteur du Studio) et imprimable (PDF via l'impression du navigateur).
 */
import { h } from "../ui/dom";
import type { Ctx } from "./ctx";
import { buildReport, frDate, frDateTime, frTime, person, reportSlideComments, type Review } from "./model";
import { avatar, chartBox, dots, download, ic, ring } from "./view";
import { brandIcon } from "./list";
import { wordmarkMarkup } from "../brand";
import { snapshotIndexOf } from "../story/scenarios";

export function reportPage(ctx: Ctx, r: Review): HTMLElement {
  const rep = buildReport(r);
  const pres = person(r, r.presenter);
  const rec = person(r, r.recipient);
  const n = r.snapshots.length;
  const start = r.meeting.startedAt;
  const end = r.meeting.endedAt;
  const when = start ? `${frDateTime(start, true)}${end ? `–${frTime(end)}` : " (en cours)"}` : `${frDateTime(r.meetingAt, true)} (réunion non tenue)`;
  const pptx = async (btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      const snaps = r.snapshots.map((s) => ({ ...s, comments: reportSlideComments(r, s) }));
      const blob = await ctx.deps.pptx(`${r.title} — compte rendu`, snaps);
      download(blob, `compte-rendu-${r.id}.pptx`);
      ctx.deps.toast("Compte rendu exporté en PowerPoint", "ok");
    } catch (e) {
      ctx.deps.toast(`Export impossible : ${String(e)}`, "error");
    } finally {
      btn.disabled = false;
    }
  };
  const print = () => {
    document.body.classList.add("rv-printing");
    const off = () => (document.body.classList.remove("rv-printing"), window.removeEventListener("afterprint", off));
    window.addEventListener("afterprint", off);
    window.print();
    setTimeout(off, 1500);
  };
  const kpi = (v: string, label: string, testid: string) => h("div", { class: "rv-kpi", "data-testid": testid }, h("b", null, v), h("small", null, label));
  const who = (pid: string | null) => person(r, pid)?.name ?? "—";
  const snapNo = (id: string | null) => {
    const j = id ? snapshotIndexOf(r.snapshots, id) : -1;
    return j >= 0 ? `S${j + 1}` : "—";
  };
  const pptxBtn = h("button", { class: "btn", type: "button", "data-testid": "rv-report-pptx" }, ic("screen", 15), "PowerPoint") as HTMLButtonElement;
  pptxBtn.addEventListener("click", () => void pptx(pptxBtn));

  const doc = h(
    "article",
    { class: "rv-doc", "data-testid": "rv-report-doc" },
    h("header", { class: "rv-doc-head" }, h("span", { class: "rv-doc-brand", html: brandIcon() }), h("div", null, h("b", { html: `${wordmarkMarkup("light", 13)} · compte rendu de revue` }), h("small", null, `${r.org} · diffusion restreinte aux participants`)), h("small", { class: "rv-doc-date" }, `Généré le ${frDate(end ?? ctx.now())}`)),
    h("h1", null, r.title),
    h(
      "dl",
      { class: "rv-doc-meta" },
      h("dt", null, "Réunion"), h("dd", null, `${when} · ${r.meetingLabel}`),
      h("dt", null, "Animation"), h("dd", null, pres ? `${pres.name}, ${pres.role}` : "—"),
      h("dt", null, "Destinataire"), h("dd", null, rec ? `${rec.name}, ${rec.role}` : "—"),
      h("dt", null, `Présents · ${rep.present.length}`), h("dd", null, rep.present.map((p) => p.name).join(", ") || "—"),
      h("dt", null, `Absents · ${rep.absent.length}`), h("dd", null, rep.absent.map((p) => `${p.name}${rep.readers.find((x) => x.person.id === p.id)?.after === n ? " (avait tout lu)" : ""}`).join(", ") || "—")
    ),
    h(
      "div",
      { class: "rv-kpis" },
      kpi(String(rep.kpis.snapshots), "snapshots présentés", "rv-kpi-snapshots"),
      kpi(String(rep.kpis.decisions), rep.kpis.decisions > 1 ? "décisions" : "décision", "rv-kpi-decisions"),
      kpi(String(rep.kpis.actions), rep.kpis.actions > 1 ? "actions" : "action", "rv-kpi-actions"),
      kpi(String(rep.kpis.exchanges), "commentaires et questions", "rv-kpi-exchanges"),
      kpi(`${rep.kpis.seenBefore}/${rep.kpis.total} → ${rep.kpis.seenAfter}/${rep.kpis.total}`, "ont tout lu (avant → après)", "rv-kpi-reading")
    ),
    h("h2", { id: "rv-sec-decisions" }, "Décisions"),
    rep.decisions.length
      ? h("ol", { class: "rv-doc-list" }, ...rep.decisions.map((d) => h("li", { "data-testid": "rv-report-decision" }, h("b", null, d.text), h("small", null, ` — ${who(d.owner)} · ${snapNo(d.snapId)}`))))
      : h("p", { class: "muted" }, "Aucune décision enregistrée."),
    h("h2", { id: "rv-sec-actions" }, "Actions"),
    rep.actions.length
      ? h(
          "table",
          { class: "rv-doc-table" },
          h("thead", null, h("tr", null, h("th", null, "Action"), h("th", null, "Responsable"), h("th", null, "Échéance"), h("th", null, "Snapshot"), h("th", null, "Statut"))),
          h("tbody", null, ...rep.actions.map((a) => h("tr", { "data-testid": "rv-report-action" }, h("td", null, a.text), h("td", null, who(a.owner)), h("td", null, a.due ? frDate(a.due) : "—"), h("td", null, snapNo(a.snapId)), h("td", null, h("span", { class: "rv-todo" }, "À faire")))))
        )
      : h("p", { class: "muted" }, "Aucune action enregistrée."),
    h("h2", { id: "rv-sec-lecture" }, "Qui a lu quoi"),
    h(
      "table",
      { class: "rv-doc-table rv-reading-table", "data-testid": "rv-report-reading" },
      h("thead", null, h("tr", null, h("th", null, "Participant"), ...r.snapshots.map((_, j) => h("th", { class: "c" }, `S${j + 1}`)), h("th", { class: "c" }, "Avant"), h("th", { class: "c" }, "Après"), h("th", null, "Réunion"))),
      h(
        "tbody",
        null,
        ...rep.readers.map((x) =>
          h(
            "tr",
            null,
            h("td", null, x.person.name, h("small", null, ` · ${x.person.role}`)),
            ...x.seen.map((v) => h("td", { class: `c ${v ? "yes" : "no"}` }, v ? "●" : "○")),
            h("td", { class: "c" }, `${x.before}/${n}`),
            h("td", { class: "c" }, `${x.after}/${n}`),
            h("td", null, x.present ? "présent·e" : "absent·e")
          )
        )
      )
    ),
    ...rep.sections.map((sec) =>
      h(
        "section",
        { class: "rv-doc-snap", id: `rv-sec-s${sec.index + 1}`, "data-testid": "rv-report-section" },
        h("h2", null, h("span", { class: "rv-num" }, String(sec.index + 1)), sec.snap.title),
        h("p", { class: "rv-sub" }, sec.snap.subtitle),
        h(
          "div",
          { class: "rv-doc-snap-body" },
          chartBox(sec.snap, ctx.deps.datasetFor(sec.snap), {}).el,
          h(
            "div",
            null,
            h("h4", null, "Commentaire généré"),
            h("ul", null, ...sec.snap.comments.map((c) => h("li", null, c))),
            sec.note ? h("div", null, h("h4", null, "Animation"), h("p", null, sec.note)) : null,
            sec.decisions.length || sec.actions.length ? h("h4", null, "Décisions et actions") : null,
            ...sec.decisions.map((d) => h("p", { class: "rv-doc-item" }, h("b", null, "Décision : "), d.text)),
            ...sec.actions.map((a) => h("p", { class: "rv-doc-item" }, h("b", null, "Action : "), `${a.text} — ${who(a.owner)}${a.due ? `, échéance ${frDate(a.due)}` : ""}`)),
            sec.questions.length ? h("h4", null, "Questions") : null,
            ...sec.questions.map((q) => h("p", { class: "rv-doc-item" }, `${who(q.author)} : ${q.text} `, h("small", null, q.status === "repondue" ? "(répondue)" : q.status === "en-action" ? "(passée en action)" : "(ouverte)"))),
            h("small", { class: "muted" }, `Lu par ${sec.seen}/${rep.kpis.total} · ${sec.comments} échange${sec.comments > 1 ? "s" : ""}`)
          )
        )
      )
    ),
    h("footer", { class: "rv-doc-foot" }, `Compte rendu généré par Datanime à partir de la revue, des échanges et de la réunion · données fictives Norvia · ${frDate(ctx.now())}`)
  );

  return h(
    "div",
    { class: "rv-report", "data-testid": "rv-report-page" },
    h(
      "header",
      { class: "rv-meet-top" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => ctx.go({ page: "list", id: r.id }) }, "‹ Revue"),
      h("div", { class: "rv-meet-title" }, h("strong", null, `Compte rendu · ${r.title}`), h("small", null, "Généré automatiquement à partir de la revue, des échanges et de la réunion")),
      h("span", { class: "rv-spacer" }),
      pptxBtn,
      h("button", { class: "btn", type: "button", "data-testid": "rv-report-print", onclick: print }, ic("print", 15), "Imprimer / PDF"),
      h("button", { class: "btn btn-accent", type: "button", onclick: () => ctx.deps.toast("Diffusion aux participants : arrive avec le partage en ligne. En attendant : PowerPoint ou PDF.", "info", 5000) }, ic("mail", 15), "Diffuser aux participants")
    ),
    h(
      "div",
      { class: "rv-report-body" },
      doc,
      h(
        "aside",
        { class: "rv-report-side" },
        h("h4", null, "SOMMAIRE"),
        h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), document.getElementById("rv-sec-decisions")?.scrollIntoView({ behavior: "smooth" })) }, `Décisions · ${rep.kpis.decisions}`),
        h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), document.getElementById("rv-sec-actions")?.scrollIntoView({ behavior: "smooth" })) }, `Actions · ${rep.kpis.actions}`),
        h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), document.getElementById("rv-sec-lecture")?.scrollIntoView({ behavior: "smooth" })) }, "Qui a lu quoi"),
        ...rep.sections.map((sec) => h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), document.getElementById(`rv-sec-s${sec.index + 1}`)?.scrollIntoView({ behavior: "smooth" })) }, `${sec.index + 1}. ${sec.snap.title}`)),
        h("h4", null, "LECTURE"),
        h("div", { class: "rv-ring-row" }, ring(rep.kpis.seenAfter, rep.kpis.total, 64), h("div", null, h("b", null, `${rep.kpis.seenAfter}/${rep.kpis.total}`), h("small", null, ` ont tout lu (${rep.kpis.seenBefore} avant la réunion)`))),
        ...rep.readers.slice(0, 12).map((x) => h("div", { class: "rv-mini-reader" }, avatar(x.person, 20), h("small", null, x.person.name), dots(x.seen)))
      )
    )
  );
}
