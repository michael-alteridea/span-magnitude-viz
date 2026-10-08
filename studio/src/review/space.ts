/**
 * Espace « Revues » du Studio Datanime : recouvre le Studio (routes par fragment #/revues…, #/r/…).
 * Liste et détail, fenêtre « Partager », page participant, mode réunion, compte rendu.
 */
import { h } from "../ui/dom";
import type { Ctx, ReviewDeps } from "./ctx";
import { demoReviews } from "./demo";
import { listPage, setBrandMarkup, shareDialog } from "./list";
import { meetingPage } from "./meeting";
import { laggards, newId, parseRoute, routeHash, startMeeting, type Review, type ReviewRoute } from "./model";
import { participantPage, sizeClass } from "./participant";
import { reportPage } from "./report";
import "./review.css";
import { snapshotIndexOf } from "../story/scenarios";

export class ReviewSpace {
  readonly root: HTMLElement;
  private route: ReviewRoute | null = null;
  private cleanup: (() => void) | null = null;
  private ctx: Ctx;
  private seeding: Promise<void> | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private size = "";
  private onResize = () => {
    if (this.route?.page === "participant" && sizeClass() !== this.size) this.render();
  };

  constructor(private deps: ReviewDeps, brandIcon: string) {
    setBrandMarkup(brandIcon);
    this.root = h("div", { class: "rv-space", hidden: true, "data-testid": "reviews" });
    this.ctx = {
      deps,
      get: (id) => deps.storage.get(id),
      save: (r) => deps.storage.save(r),
      go: (rt) => this.go(rt),
      now: () => (deps.now ? deps.now() : new Date()).toISOString(),
      me: (r) => {
        const m = deps.storage.me(r.id);
        if (m && (m === r.presenter || r.participants.includes(m))) return m;
        return laggards(r)[0] ?? r.recipient;
      },
      setMe: (r, pid) => (deps.storage.setMe(r.id, pid), this.render()),
    };
    deps.storage.subscribe(() => {
      if (this.isOpen) this.renderSoft();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Installe la démo Norvia au premier passage sur cet appareil. */
  ensureDemo(): Promise<void> {
    if (this.deps.storage.seeded()) return Promise.resolve();
    if (!this.seeding)
      this.seeding = demoReviews()
        .then((list) => {
          if (!this.deps.storage.seeded()) this.deps.storage.replaceAll(list);
        })
        .catch((e) => this.deps.toast(`Démo indisponible : ${String(e)}`, "error"));
    return this.seeding;
  }

  async resetDemo(): Promise<void> {
    const mine = this.deps.storage.list().filter((r) => !r.demo);
    const demo = await demoReviews();
    this.deps.storage.replaceAll([...demo, ...mine]);
    this.deps.toast("Démo réinitialisée : revues Norvia rechargées", "ok");
    this.go({ page: "list", id: demo[0]!.id });
  }

  /** Fragment courant → page (null : fermer). */
  async handleHash(hash: string): Promise<void> {
    const rt = parseRoute(hash);
    if (!rt) return this.hide();
    await this.ensureDemo();
    this.show(rt);
  }

  /** Revue affichée (liens de lecture du PowerPoint). */
  currentId(): string | null {
    return this.route && !this.root.hidden ? this.route.id : null;
  }

  go(rt: ReviewRoute | null): void {
    if (!rt) {
      history.pushState(null, "", location.pathname + location.search);
      this.hide();
      return;
    }
    const hash = routeHash(rt);
    if (location.hash !== hash) history.pushState(null, "", hash);
    this.show(rt);
  }

  private show(rt: ReviewRoute): void {
    // entrer en réunion démarre (ou reprend) la séance
    if (rt.page === "meeting") {
      const r = this.deps.storage.get(rt.id);
      if (r && r.status !== "en-reunion") this.deps.storage.save(startMeeting(r, this.ctx.now()));
    }
    this.route = rt;
    if (this.root.hidden) {
      this.root.hidden = false;
      document.body.classList.add("rv-open");
      document.addEventListener("keydown", this.onKey);
      window.addEventListener("resize", this.onResize);
    }
    this.render();
  }

  private hide(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.route = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    document.body.classList.remove("rv-open");
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onResize);
    // le Studio était masqué : laisser l'aperçu se recaler
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  close(): void {
    this.go(null);
  }

  /** Nouvelle revue à partir de l'histoire courante du Studio. */
  create(): void {
    const story = this.deps.currentStory();
    if (!story.snapshots.length) {
      this.deps.toast("Ajoutez d'abord des snapshots à l'histoire (bouton Snapshot ou Scénarios), puis créez la revue.", "info", 5000);
      return;
    }
    const now = this.ctx.now();
    const meeting = new Date(Date.parse(now) + 2 * 864e5);
    meeting.setHours(10, 0, 0, 0);
    const r: Review = {
      v: 1,
      id: newId("revue"),
      title: story.title,
      org: "Mon équipe",
      persona: { scenario: story.snapshots[0]?.scenario ?? null, label: "", audience: "Comité" },
      presenter: "moi",
      recipient: "moi",
      meetingAt: meeting.toISOString(),
      meetingLabel: "Réunion",
      status: "brouillon",
      createdAt: now,
      updatedAt: now,
      demo: false,
      snapshots: story.snapshots.map((s) => structuredClone(s)),
      notes: {},
      people: [{ id: "moi", name: "Vous", role: "Animation", email: "—", color: "#0E6E8C" }],
      participants: [],
      seen: {},
      reactions: [],
      comments: [],
      items: [],
      meeting: { startedAt: null, endedAt: null, current: 0, present: [], seenBefore: {} },
      share: { access: "invites", comments: true, showSeen: true, hideAmounts: false, expires: null },
    };
    this.deps.storage.save(r);
    this.deps.toast(`Revue « ${r.title} » créée (${r.snapshots.length} snapshots) — invitez les participants dans « Partager »`, "ok", 5000);
    this.go({ page: "share", id: r.id, snapId: null });
  }

  /** Mise à jour sans perdre une saisie en cours (changement venu d'un autre onglet). */
  private renderSoft(): void {
    const a = document.activeElement as HTMLInputElement | null;
    if (a && this.root.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox")) && a.value) return;
    this.render();
  }

  private render(): void {
    const rt = this.route;
    if (!rt) return;
    const scroll = this.root.querySelector(".rv-scroll-keep")?.scrollTop ?? 0;
    this.cleanup?.();
    this.cleanup = null;
    this.size = sizeClass();
    const r = rt.page === "list" ? null : this.deps.storage.get(rt.id);
    if (rt.page !== "list" && !r) {
      this.root.replaceChildren(
        h("div", { class: "rv-missing" }, h("h2", null, "Revue introuvable sur cet appareil"), h("p", null, "Le partage est local pour l'instant : ce lien s'ouvre dans le navigateur où la revue a été créée. Partage en ligne bientôt."), h("a", { class: "btn btn-accent", href: "#/revues" }, "Voir les revues"))
      );
      return;
    }
    const actions = { create: () => this.create(), resetDemo: () => void this.resetDemo(), close: () => this.close() };
    let el: HTMLElement;
    switch (rt.page) {
      case "list":
        el = listPage(this.ctx, rt.id, actions);
        break;
      case "share":
        el = h("div", { class: "rv-stack" }, listPage(this.ctx, r!.id, actions), shareDialog(this.ctx, r!, rt.snapId));
        break;
      case "participant": {
        const p = participantPage(this.ctx, r!, rt.snapId, { onNav: (k) => this.go({ page: "participant", id: r!.id, snapId: r!.snapshots[k]!.id }) });
        el = p.el;
        this.cleanup = p.cleanup;
        break;
      }
      case "meeting": {
        const m = meetingPage(this.ctx, r!);
        el = m.el;
        this.cleanup = m.cleanup;
        break;
      }
      case "report":
        el = reportPage(this.ctx, r!);
        break;
    }
    el.classList.add("rv-scroll-keep");
    this.root.replaceChildren(el);
    if (scroll && el.scrollHeight > scroll) el.scrollTop = scroll;
  }

  private key(e: KeyboardEvent): void {
    const rt = this.route;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === "Escape" && rt?.page === "share") return this.go({ page: "list", id: rt.id });
    if (!rt || (rt.page !== "participant" && rt.page !== "meeting")) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const r = this.deps.storage.get(rt.id);
    if (!r) return;
    const d = e.key === "ArrowRight" ? 1 : -1;
    if (rt.page === "meeting") {
      this.ctx.save({ ...r, meeting: { ...r.meeting, current: Math.max(0, Math.min(r.snapshots.length - 1, r.meeting.current + d)) } });
    } else {
      const cur = rt.snapId ? snapshotIndexOf(r.snapshots, rt.snapId) : 0;
      const k = Math.max(0, Math.min(r.snapshots.length - 1, Math.max(0, cur) + d));
      this.go({ page: "participant", id: r.id, snapId: r.snapshots[k]!.id });
    }
    e.preventDefault();
  }
}
