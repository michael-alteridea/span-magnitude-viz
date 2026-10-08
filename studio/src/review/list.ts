/**
 * Revues : liste (présentateur) et détail d'une revue — séquence de snapshots, lecture avant la réunion,
 * participants ; fenêtre « Partager » (lien + QR de la revue et de chaque snapshot, accès, invitations).
 */
import { h } from "../ui/dom";
import type { Ctx } from "./ctx";
import {
  STATUS_LABEL,
  allSeenCount,
  frDate,
  frDateTime,
  hasSeen,
  laggards,
  lastSeenAt,
  newId,
  person,
  seenBySnapshot,
  seenCount,
  shareUrl,
  threadOf,
  type Person,
  type Review,
  type ReviewStatus,
} from "./model";
import { avatar, chartBox, dots, download, ic, qrSvg, ring } from "./view";

type Filter = "toutes" | ReviewStatus;
let filter: Filter = "toutes";
let query = "";

export const LOCAL_NOTE = "Partage local pour l'instant : les liens et QR s'ouvrent dans ce navigateur, sur cet appareil. Partage en ligne bientôt.";

function statusChip(r: Review): HTMLElement {
  return h("span", { class: `rv-status s-${r.status}` }, STATUS_LABEL[r.status]);
}

export function listPage(ctx: Ctx, sel: string | null, actions: { create: () => void; resetDemo: () => void; close: () => void }): HTMLElement {
  const all = ctx.deps.storage.list();
  const shown = all.filter((r) => (filter === "toutes" || r.status === filter) && (!query || r.title.toLocaleLowerCase("fr-FR").includes(query.toLocaleLowerCase("fr-FR"))));
  const cur = (sel && all.find((r) => r.id === sel)) || shown[0] || null;
  const count = (f: Filter) => (f === "toutes" ? all.length : all.filter((r) => r.status === f).length);
  const chips = (["toutes", "partagee", "en-reunion", "brouillon", "terminee"] as Filter[])
    .filter((f) => f === "toutes" || count(f) > 0)
    .map((f) => h("button", { class: `rv-chip${filter === f ? " on" : ""}`, type: "button", "data-testid": `rv-filter-${f}`, onclick: () => ((filter = f), ctx.go({ page: "list", id: cur?.id ?? null })) }, `${f === "toutes" ? "Toutes" : STATUS_LABEL[f as ReviewStatus]} · ${count(f)}`));
  const search = h("input", { class: "rv-search", type: "search", placeholder: "Rechercher une revue…", value: query, "aria-label": "Rechercher une revue", "data-testid": "rv-search" }) as HTMLInputElement;
  search.addEventListener("input", () => {
    query = search.value;
    ctx.go({ page: "list", id: cur?.id ?? null });
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>("[data-testid=rv-search]");
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  });
  const cards = shown.map((r) => {
    const n = r.snapshots.length;
    const first = r.snapshots[0];
    const thumb = first ? chartBox(first, ctx.deps.datasetFor(first), { thumb: true }).el : h("div", { class: "rv-chart thumb empty" });
    const seen = allSeenCount(r);
    return h(
      "button",
      { class: `rv-card${cur?.id === r.id ? " on" : ""}`, type: "button", "data-testid": `rv-card-${r.id}`, onclick: () => ctx.go({ page: "list", id: r.id }) },
      h("div", { class: "rv-card-thumb" }, thumb),
      h(
        "div",
        { class: "rv-card-body" },
        h("strong", null, r.title),
        h("span", { class: "rv-card-meta" }, statusChip(r), h("span", null, r.persona.audience)),
        h("span", { class: "rv-card-meta" }, ic("calendar", 13), frDateTime(r.meetingAt, true)),
        r.status === "brouillon" ? h("span", { class: "rv-card-meta" }, `${n} snapshots · non partagée`) : h("span", { class: "rv-progress" }, h("i", { style: `width:${r.participants.length ? (seen / r.participants.length) * 100 : 0}%` })),
        r.status === "brouillon" ? null : h("span", { class: "rv-card-meta" }, `${seen}/${r.participants.length} ont tout vu · ${n} snapshots`)
      )
    );
  });
  return h(
    "div",
    { class: "rv-app" },
    sidebar(ctx, all.length, actions.close),
    h(
      "div",
      { class: "rv-main" },
      h(
        "header",
        { class: "rv-top" },
        h("h1", null, "Revues"),
        search,
        h("span", { class: "rv-spacer" }),
        h("button", { class: "btn", type: "button", "data-testid": "rv-reset-demo", title: "Recharge les revues de démonstration Norvia (vos propres revues sont conservées)", onclick: actions.resetDemo }, ic("replay", 15), "Réinitialiser la démo"),
        h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-new", title: "Créer une revue à partir des snapshots de l'histoire courante", onclick: actions.create }, ic("plus", 15), "Nouvelle revue")
      ),
      h("p", { class: "rv-local-note", "data-testid": "rv-local-note" }, ic("link", 14), LOCAL_NOTE),
      h(
        "div",
        { class: "rv-split" },
        h("div", { class: "rv-list" }, h("div", { class: "rv-chips" }, ...chips), ...(cards.length ? cards : [h("p", { class: "muted small" }, "Aucune revue. « Nouvelle revue » reprend les snapshots de votre histoire.")])),
        cur ? detail(ctx, cur) : h("div", { class: "rv-detail empty" }, h("p", { class: "muted" }, "Sélectionnez une revue."))
      )
    )
  );
}

export function sidebar(ctx: Ctx, n: number, close: () => void): HTMLElement {
  return h(
    "aside",
    { class: "rv-side" },
    h("div", { class: "rv-brand", html: brandMarkup() }),
    h("button", { class: "rv-nav", type: "button", "data-testid": "rv-back-studio", onclick: close }, ic("screen", 17), "Studio"),
    h("button", { class: "rv-nav on", type: "button", onclick: () => ctx.go({ page: "list", id: null }) }, ic("share", 17), "Revues", h("span", { class: "rv-n" }, String(n))),
    h("span", { class: "rv-spacer" }),
    h("p", { class: "rv-side-note" }, "Données fictives (société Norvia) pour la démonstration.")
  );
}

let brandHtml = "";
export function setBrandMarkup(html: string): void {
  brandHtml = html;
}
/** Icône Datanime propre à l'espace Revues (le Studio est masqué : ses dégradés ne sont plus rendus). */
export function brandIcon(): string {
  return brandHtml;
}
function brandMarkup(): string {
  return `${brandHtml}<div><b>Data<em>nime</em></b><small>Revues partagées</small></div>`;
}

function detail(ctx: Ctx, r: Review): HTMLElement {
  const n = r.snapshots.length;
  const rec = person(r, r.recipient);
  const pres = person(r, r.presenter);
  const seenAll = allSeenCount(r);
  const late = laggards(r);
  const exchanges = r.comments.length;
  const questions = r.comments.filter((c) => c.question).length;
  const seq = r.snapshots.map((s, k) =>
    h(
      "div",
      { class: "rv-seq-card", "data-testid": `rv-seq-${k + 1}` },
      h(
        "button",
        { class: "rv-seq-open", type: "button", title: "Ouvrir la page participant de ce snapshot", onclick: () => ctx.go({ page: "participant", id: r.id, snapId: s.id }) },
        h("span", { class: "rv-num" }, String(k + 1)),
        chartBox(s, ctx.deps.datasetFor(s), { thumb: true }).el,
        h("span", { class: "rv-seq-title" }, s.title)
      ),
      h(
        "div",
        { class: "rv-seq-foot" },
        h("span", { title: "Participants ayant vu ce snapshot" }, ic("eye", 13), `${seenBySnapshot(r, s.id)}/${r.participants.length}`),
        h("span", { title: "Commentaires et questions" }, ic("chat", 13), String(threadOf(r, s.id).length)),
        h("button", { class: "rv-mini", type: "button", title: "Lien et QR de ce snapshot", "aria-label": `QR du snapshot ${k + 1}`, "data-testid": `rv-seq-qr-${k + 1}`, onclick: () => ctx.go({ page: "share", id: r.id, snapId: s.id }) }, ic("qr", 14))
      )
    )
  );
  const bars = r.snapshots.map((s, k) => {
    const x = seenBySnapshot(r, s.id);
    return h("div", { class: "rv-bar" }, h("span", null, `S${k + 1}`), h("span", { class: "rv-progress" }, h("i", { style: `width:${r.participants.length ? (x / r.participants.length) * 100 : 0}%` })), h("span", { class: "num" }, `${x}/${r.participants.length}`));
  });
  const parts = r.participants.map((pid) => {
    const p = person(r, pid)!;
    const k = seenCount(r, pid);
    const last = lastSeenAt(r, pid);
    return h(
      "div",
      { class: "rv-person" },
      avatar(p, 30),
      h("div", { class: "rv-person-id" }, h("strong", null, p.name, pid === r.recipient ? h("span", { class: "rv-tag" }, "destinataire") : null), h("small", null, p.role)),
      dots(r.snapshots.map((s) => hasSeen(r, pid, s.id))),
      h("small", { class: "rv-person-when" }, k === n && n ? "tout vu" : k ? `${k}/${n}` : "pas encore ouvert", last ? ` · ${frDateTime(last)}` : "")
    );
  });
  const csv = () => {
    const head = ["participant", "role", ...r.snapshots.map((_, k) => `S${k + 1}`), "vus"].join(";");
    const lines = r.participants.map((pid) => {
      const p = person(r, pid)!;
      return [p.name, p.role, ...r.snapshots.map((s) => (hasSeen(r, pid, s.id) ? "vu" : "")), String(seenCount(r, pid))].join(";");
    });
    download(new Blob([`\ufeff${[head, ...lines].join("\n")}\n`], { type: "text/csv;charset=utf-8" }), `lecture-${r.id}.csv`);
  };
  return h(
    "section",
    { class: "rv-detail", "data-testid": "rv-detail" },
    h(
      "header",
      { class: "rv-detail-head" },
      h(
        "div",
        null,
        h("p", { class: "rv-eyebrow" }, (() => { const a = r.persona.audience.toLocaleUpperCase("fr-FR"); return `REVUE · POUR ${/^DIRECTRICE/.test(a) ? "LA" : "LE"} ${a}`; })()),
        h("h2", { "data-testid": "rv-title" }, r.title),
        h(
          "div",
          { class: "rv-meta" },
          h("span", { class: "rv-pill" }, statusChip(r), r.status === "brouillon" ? "non partagée" : `${r.org}`),
          rec ? h("span", { class: "rv-pill" }, avatar(rec, 20), `${rec.name} · ${rec.role}`) : null,
          h("span", { class: "rv-pill" }, ic("calendar", 13), `${frDateTime(r.meetingAt, true)} · ${r.meetingLabel}`),
          r.persona.label ? h("span", { class: "rv-pill" }, ic("sparkle", 13), r.persona.label) : null,
          pres ? h("span", { class: "rv-pill" }, "Présentatrice·eur : ", pres.name) : null
        )
      ),
      h(
        "div",
        { class: "rv-actions" },
        h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-share", onclick: () => ctx.go({ page: "share", id: r.id, snapId: null }) }, ic("qr", 15), "Partager"),
        h("button", { class: "btn", type: "button", "data-testid": "rv-meeting", onclick: () => ctx.go({ page: "meeting", id: r.id }) }, ic("screen", 15), r.status === "terminee" ? "Reprendre la réunion" : "Lancer la réunion"),
        h("button", { class: "btn", type: "button", "data-testid": "rv-report", onclick: () => ctx.go({ page: "report", id: r.id }) }, ic("doc", 15), "Compte rendu"),
        h("button", { class: "btn", type: "button", "data-testid": "rv-participant", onclick: () => ctx.go({ page: "participant", id: r.id, snapId: null }) }, ic("eye", 15), "Page participant"),
        r.demo ? null : h("button", { class: "btn btn-ghost", type: "button", "data-testid": "rv-delete", onclick: () => { if (confirm(`Supprimer la revue « ${r.title} » de cet appareil ?`)) { ctx.deps.storage.remove(r.id); ctx.go({ page: "list", id: null }); } } }, "Supprimer")
      )
    ),
    h(
      "div",
      { class: "rv-block" },
      h("h3", null, ic("doc", 15), `Séquence · ${n} snapshots`, h("small", null, "chaque snapshot a son lien et son QR, qui ouvrent directement la bonne page")),
      h("div", { class: "rv-seq" }, ...seq)
    ),
    h(
      "div",
      { class: "rv-cols" },
      h(
        "div",
        { class: "rv-block rv-reading", "data-testid": "rv-reading" },
        h("h3", null, ic("eye", 15), "Lecture avant la réunion"),
        h("div", { class: "rv-ring-row" }, ring(seenAll, r.participants.length, 70), h("div", null, h("b", { class: "rv-big" }, String(seenAll), h("small", null, `/${r.participants.length}`)), h("div", null, "participants ont tout vu"), late.length ? h("small", { class: "muted" }, `${late.length} en retard : ${late.map((p) => `${person(r, p)?.name} (${seenCount(r, p)}/${n})`).join(", ")}`) : h("small", { class: "muted" }, "tout le monde est à jour"))),
        h("div", { class: "rv-bars" }, ...bars),
        h(
          "div",
          { class: "rv-row" },
          late.length ? h("button", { class: "btn", type: "button", "data-testid": "rv-remind", onclick: () => ctx.deps.toast(`Relance préparée pour ${late.length} participant(s) — l'envoi par e-mail arrive avec le partage en ligne.`, "info", 5000) }, ic("bell", 14), `Relancer les ${late.length} retardataire${late.length > 1 ? "s" : ""}`) : null,
          h("button", { class: "btn", type: "button", "data-testid": "rv-reading-csv", onclick: csv }, ic("download", 14), "Export lecture (CSV)")
        ),
        h("small", { class: "muted" }, `${exchanges - questions} commentaire${exchanges - questions > 1 ? "s" : ""} · ${questions} question${questions > 1 ? "s" : ""} · ${r.reactions.length} réactions`)
      ),
      h("div", { class: "rv-block rv-people" }, h("h3", null, ic("users", 15), `Participants · ${r.participants.length}`, h("small", null, "vu / pas encore")), ...parts)
    )
  );
}

/* ------------------------------------------------------------------ fenêtre « Partager » */

export function shareDialog(ctx: Ctx, r: Review, snapId: string | null): HTMLElement {
  const base = ctx.deps.baseUrl();
  const k = snapId ? r.snapshots.findIndex((s) => s.id === snapId) : -1;
  const target = k >= 0 ? r.snapshots[k]! : null;
  const url = shareUrl(base, r, target?.id ?? null);
  const close = () => ctx.go({ page: "list", id: r.id });
  const copy = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u);
      ctx.deps.toast("Lien copié", "ok", 1500);
    } catch {
      ctx.deps.toast(u, "info", 8000);
    }
  };
  const set = (patch: Partial<Review["share"]>) => ctx.save({ ...r, share: { ...r.share, ...patch }, status: r.status === "brouillon" ? "partagee" : r.status });
  const toggle = (label: string, key: "comments" | "showSeen" | "hideAmounts", testid: string) =>
    h("label", { class: "rv-toggle" }, h("input", { type: "checkbox", checked: r.share[key], "data-testid": testid, onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }), h("span", null, label));
  const access = (["invites", "organisation", "lien"] as const).map((a) =>
    h(
      "button",
      { class: `rv-opt${r.share.access === a ? " on" : ""}`, type: "button", onclick: () => set({ access: a }) },
      h("strong", null, a === "invites" ? "Participants invités" : a === "organisation" ? `Organisation (${r.org.split(" · ")[0]})` : "Toute personne avec le lien"),
      h("small", null, a === "invites" ? "Lien personnel par e-mail, sans mot de passe" : a === "organisation" ? "Toute personne connectée de l'organisation" : "Déconseillé pour des données financières")
    )
  );
  const invites = r.participants.map((pid) => {
    const p = person(r, pid)!;
    const c = seenCount(r, pid);
    return h("div", { class: "rv-invite" }, avatar(p, 28), h("div", null, h("strong", null, p.name), h("small", null, `${p.email} · ${p.role}`)), h("small", { class: "muted" }, c === r.snapshots.length ? "Invité·e · tout vu" : c ? `Invité·e · ouvert ${c}/${r.snapshots.length}` : "Invité·e · pas encore ouvert"));
  });
  const nameIn = h("input", { placeholder: "Nom", "aria-label": "Nom", "data-testid": "rv-invite-name" }) as HTMLInputElement;
  const roleIn = h("input", { placeholder: "Fonction", "aria-label": "Fonction" }) as HTMLInputElement;
  const mailIn = h("input", { placeholder: "e-mail", type: "email", "aria-label": "E-mail" }) as HTMLInputElement;
  const addInvite = () => {
    const name = nameIn.value.trim();
    if (!name) return;
    const p: Person = { id: newId("p"), name, role: roleIn.value.trim() || "Participant·e", email: mailIn.value.trim() || "—", color: ["#0E6E8C", "#2F7F79", "#5B5F97", "#8A5A6B", "#3F7D5B"][r.people.length % 5]! };
    ctx.save({ ...r, people: [...r.people, p], participants: [...r.participants, p.id] });
  };
  const perSnap = r.snapshots.map((s, i) => {
    const u = shareUrl(base, r, s.id);
    return h(
      "div",
      { class: `rv-snaplink${s.id === target?.id ? " on" : ""}` },
      h("span", { class: "rv-num" }, String(i + 1)),
      h("button", { class: "rv-snaplink-title", type: "button", title: "Afficher le QR de ce snapshot", onclick: () => ctx.go({ page: "share", id: r.id, snapId: s.id }) }, s.title),
      h("button", { class: "rv-mini", type: "button", title: "Copier le lien", "aria-label": `Copier le lien du snapshot ${i + 1}`, onclick: () => void copy(u) }, ic("copy", 14)),
      h("a", { class: "rv-mini", href: u.slice(u.indexOf("#")), title: "Ouvrir la page participant", "aria-label": `Ouvrir le snapshot ${i + 1}`, "data-testid": `rv-snaplink-${i + 1}` }, ic("eye", 14))
    );
  });
  return h(
    "div",
    { class: "rv-overlay", "data-testid": "rv-share-dialog", onclick: (e: Event) => e.target === e.currentTarget && close() },
    h(
      "div",
      { class: "rv-dialog", role: "dialog", "aria-label": `Partager « ${r.title} »` },
      h(
        "header",
        { class: "rv-dialog-head" },
        ic("share", 20),
        h("div", null, h("h2", null, `Partager « ${r.title} »`), h("small", null, "Un lien pour la revue ; chaque snapshot (page et diapositive PowerPoint) a son propre QR qui ouvre directement la bonne page")),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Fermer", onclick: close }, "×")
      ),
      h(
        "div",
        { class: "rv-dialog-body" },
        h(
          "div",
          { class: "rv-share-left" },
          h("h4", null, target ? `LIEN DU SNAPSHOT ${k + 1}` : "LIEN DE LA REVUE"),
          h("div", { class: "rv-linkbox" }, ic("link", 15), h("code", { "data-testid": "rv-share-url" }, url), h("button", { class: "btn btn-accent", type: "button", "data-testid": "rv-copy", onclick: () => void copy(url) }, ic("copy", 14), "Copier")),
          h("h4", null, "QUI PEUT OUVRIR LA PAGE"),
          h("div", { class: "rv-opts" }, ...access),
          h("div", { class: "rv-toggles" }, toggle("Commentaires et questions", "comments", "rv-opt-comments"), toggle("Afficher « qui a vu » aux participants", "showSeen", "rv-opt-seen"), toggle("Masquer les montants hors réunion", "hideAmounts", "rv-opt-amounts")),
          h("p", { class: "rv-local-note" }, ic("link", 14), LOCAL_NOTE),
          h("h4", null, `SNAPSHOTS · ${r.snapshots.length}`),
          h("div", { class: "rv-snaplinks" }, ...perSnap),
          h("h4", null, `INVITATIONS · ${r.participants.length}`),
          h("div", { class: "rv-invites" }, ...invites),
          h("div", { class: "rv-invite-add" }, nameIn, roleIn, mailIn, h("button", { class: "btn", type: "button", "data-testid": "rv-invite-add", onclick: addInvite }, ic("plus", 14), "Inviter"))
        ),
        h(
          "div",
          { class: "rv-share-right" },
          h("h4", null, target ? `QR DU SNAPSHOT ${k + 1}` : "QR DE LA REVUE"),
          h("div", { class: "rv-qr", "data-testid": "rv-qr", html: qrSvg(url, 236) }),
          h("small", { class: "rv-qr-cap" }, target ? target.title : r.title),
          h("button", { class: "btn", type: "button", "data-testid": "rv-qr-download", onclick: () => download(new Blob([qrSvg(url, 600)], { type: "image/svg+xml" }), `qr-${target ? `snapshot-${k + 1}` : "revue"}-${r.id}.svg`) }, ic("download", 14), "Télécharger le QR (SVG)"),
          target ? h("button", { class: "btn", type: "button", onclick: () => ctx.go({ page: "share", id: r.id, snapId: null }) }, "QR de la revue entière") : null,
          h("p", { class: "rv-hint" }, "Chaque page affiche l'empreinte des données du snapshot : on retrouve exactement la version présentée en réunion.")
        )
      ),
      h(
        "footer",
        { class: "rv-dialog-foot" },
        h("small", { class: "muted" }, ic("users", 13), `${r.participants.filter((p) => seenCount(r, p) > 0).length} participants ont déjà ouvert la page`),
        h("span", { class: "rv-spacer" }),
        h("button", { class: "btn", type: "button", onclick: close }, "Fermer"),
        h("a", { class: "btn btn-accent", href: url.slice(url.indexOf("#")), "data-testid": "rv-open-participant" }, ic("eye", 14), "Ouvrir la page participant")
      )
    )
  );
}

export { frDate };
