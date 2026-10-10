/**
 * Fenêtre « Créer un Reel » : mini-film pour les réseaux sociaux à partir des snapshots d'une histoire ou d'une revue.
 * Choix des snapshots (5 au plus), du format (9:16, 1:1, 16:9), titres / chiffres clés / durées éditables,
 * source et licence des données (obligatoires : elles figurent dans le cartouche), aperçu en lecture,
 * export MP4 (H.264, WebCodecs) ou repli WebM, barre de progression et annulation. Tout se passe dans le navigateur.
 */
import { elementNotes } from "../story/elementNotes";
import { h, svgIcon, ICONS } from "./dom";
import { download, slug } from "../export";
import { displayFontCss, embeddedFontCss, ensureDisplayFont, ensureFont } from "../theme";
import { parseSpec, type FontKey } from "../spec";
import { clip, generatedOn } from "../story/fr";
import { ReelCharts, drillLinks, type ReelItem } from "../reel/charts";
import { ReelComposer } from "../reel/compose";
import { encodeReel, reelCapabilities, type EncodeResult } from "../reel/encode";
import { autoSceneDuration, DEFAULT_RHYTHM, fitDurations, fmtS, frameCount, REEL_FORMATS, sceneStarts, REEL_MAX_S, REEL_MAX_SCENES, REEL_MIN_S, REEL_RHYTHMS, reelProblems, SCENE_MAX_S, SCENE_MIN_S, timingsFor, totalDuration, type ReelFormatKey, type ReelLinks, type ReelPlan, type ReelRhythm, type ReelScene } from "../reel/plan";
import { defaultPlan } from "../reel/scenes";

export interface ReelSource {
  title: string;
  items: ReelItem[];
  /** Licence connue des données (exemple public, données fictives), sinon « ». */
  licence: string;
  /** Date de génération affichée (défaut : aujourd'hui). */
  now?: Date;
  /**
   * « Modifier le graphique » d'une scène : la fenêtre est mise de côté (état conservé), l'éditeur ouvre le snapshot ;
   * l'appelant revient ensuite par `resume()` (Valider : snapshot mis à jour, même id ; Annuler : sans changement).
   */
  editChart?: (item: ReelItem, sceneNo: number) => void;
  /** QR et liens de la carte de fin (film du projet d'exemple, présentation) ; défaut : page du Studio. */
  links?: ReelLinks;
}

export const LICENCE_CHIPS = ["CC BY 4.0", "Licence Ouverte 2.0", "Données internes", "Données fictives (démonstration)"];

type Edit = Partial<Pick<ReelScene, "title" | "number" | "caption" | "duration">>;

export class ReelDialog {
  readonly root: HTMLElement;
  private src: ReelSource | null = null;
  private selected: boolean[] = [];
  private format: ReelFormatKey = "9x16";
  private rhythm: ReelRhythm = DEFAULT_RHYTHM;
  private downOnBackdrop = false;
  /** Ordre de lecture des snapshots (indices dans `src.items`) ; réordonnable par glisser-déposer. */
  private order: number[] = [];
  private edits = new Map<string, Edit>();
  private source = "";
  private licence = "";
  private plan: ReelPlan | null = null;
  private charts: ReelCharts | null = null;
  private composer: ReelComposer | null = null;
  private stage!: HTMLElement;
  private scrub!: HTMLInputElement;
  private timeLbl!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private sceneList!: HTMLElement;
  private totalLbl!: HTMLElement;
  private problemsEl!: HTMLElement;
  private progress!: HTMLElement;
  private bar!: HTMLElement;
  private progLbl!: HTMLElement;
  private exportBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private resultEl!: HTMLElement;
  private capsEl!: HTMLElement;
  private t = 0;
  private playing = false;
  private raf = 0;
  private last = 0;
  private abort: AbortController | null = null;
  /** Dernier export (tests, téléchargement à nouveau). */
  lastResult: (EncodeResult & { filename: string }) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !this.abort) this.close();
  };

  constructor() {
    // fermeture par clic sur le fond : seulement si le geste a commencé sur le fond (pas en fin de glisser-déposer)
    this.root = h("div", { class: "rv-overlay cad-overlay reel-overlay", hidden: true, "data-testid": "reel-dialog", onclick: (e: Event) => e.target === this.root && this.downOnBackdrop && !this.abort && this.close() });
    this.root.addEventListener("pointerdown", (e) => (this.downOnBackdrop = e.target === this.root));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Fenêtre mise de côté pendant la modification du graphique d'une scène (état conservé). */
  get isSuspended(): boolean {
    return this.suspended;
  }
  private suspended = false;

  /** Met la fenêtre de côté sans rien perdre (sélection, ordre, rythme, format, textes et durées retouchés). */
  suspend(): void {
    if (!this.src || this.abort) return;
    this.setPlaying(false);
    this.root.hidden = true;
    this.suspended = true;
    document.removeEventListener("keydown", this.onKey);
  }

  /**
   * Retour après « Modifier le graphique » : `update` remplace le snapshot de même id (même place) ;
   * les retouches de la scène (titre, chiffre, légende, durée), le rythme et l'ordre sont conservés.
   */
  async resume(update?: ReelItem | null): Promise<void> {
    if (!this.src || !this.suspended) return;
    let id: string | null = null;
    if (update) {
      const i = this.src.items.findIndex((it) => it.snap.id === update.snap.id);
      if (i >= 0) {
        this.src.items[i] = update;
        id = update.snap.id;
      }
      await Promise.all(this.fontsUsed().map((f) => ensureFont(f).catch(() => undefined)));
    }
    this.suspended = false;
    this.root.hidden = false;
    document.addEventListener("keydown", this.onKey);
    this.rebuild();
    const k = id ? this.plan!.scenes.findIndex((sc) => sc.id === id) : -1;
    this.seek(k >= 0 ? sceneStarts(this.plan!)[k]! : 0);
    if (k >= 0) this.sceneList.querySelector<HTMLElement>(`[data-scene-id="${CSS.escape(id!)}"]`)?.scrollIntoView({ block: "nearest" });
    this.setPlaying(true);
  }

  /** Snapshots des scènes retenues, dans l'ordre de lecture (tests, contrôles). */
  get sceneItems(): ReelItem[] {
    return this.chosen();
  }

  get currentPlan(): ReelPlan | null {
    return this.plan;
  }

  get time(): number {
    return this.t;
  }

  async open(src: ReelSource): Promise<void> {
    this.close();
    this.src = src;
    this.selected = src.items.map((_, i) => i < REEL_MAX_SCENES);
    this.order = src.items.map((_, i) => i);
    this.rhythm = DEFAULT_RHYTHM;
    this.edits.clear();
    this.licence = src.licence;
    this.source = "";
    this.lastResult = null;
    await Promise.all([ensureDisplayFont().catch(() => undefined), ensureFont("inter").catch(() => undefined), ...this.fontsUsed().map((f) => ensureFont(f).catch(() => undefined))]);
    this.renderShell();
    this.root.hidden = false;
    document.addEventListener("keydown", this.onKey);
    this.rebuild(true);
    this.seek(0);
    this.setPlaying(true);
    void reelCapabilities(REEL_FORMATS[this.format].w, REEL_FORMATS[this.format].h, 30).then((c) => {
      this.capsEl.textContent = c.mp4
        ? "Ce navigateur encode en MP4 (H.264, WebCodecs) : plus rapide que le temps réel."
        : c.fallback
          ? `H.264 indisponible ici : export ${c.fallback === "mp4" ? "MP4" : "WebM"} en temps réel (MediaRecorder).`
          : "Ce navigateur ne sait pas encoder de vidéo : essayez Chrome, Edge ou Safari 16.4 et plus.";
      this.capsEl.dataset.mp4 = c.mp4 ? "1" : "0";
    });
  }

  close(): void {
    this.suspended = false;
    this.abort?.abort();
    this.setPlaying(false);
    this.charts?.dispose();
    this.charts = null;
    this.composer = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    document.removeEventListener("keydown", this.onKey);
  }

  private fontsUsed(): FontKey[] {
    const set = new Set<FontKey>();
    for (const it of this.src?.items ?? []) {
      const f = (it.snap.spec as { style?: { font?: FontKey } } | null)?.style?.font;
      if (f && f !== "inter") set.add(f);
    }
    return [...set];
  }

  private chosen(): ReelItem[] {
    const items = this.src?.items ?? [];
    return this.order.filter((i) => this.selected[i]).map((i) => items[i]!);
  }

  /** Déplace un snapshot dans l'ordre de lecture (indices dans `src.items`). */
  private moveOrder(fromItem: number, toItem: number): void {
    const a = this.order.indexOf(fromItem);
    const b = this.order.indexOf(toItem);
    if (a < 0 || b < 0 || a === b) return;
    const next = [...this.order];
    next.splice(a, 1);
    next.splice(b, 0, fromItem);
    this.order = next;
    this.rebuild();
    this.seek(0);
  }

  private shiftSelected(item: number, dir: -1 | 1): void {
    const sel = this.order.filter((i) => this.selected[i]);
    const k = sel.indexOf(item);
    if (k < 0) return;
    const j = k + dir;
    if (j < 0 || j >= sel.length) return;
    this.moveOrder(item, sel[j]!);
  }

  /** Recalcule le plan (sélection, format, retouches) ; `resetDur` : durées automatiques. */
  private rebuild(resetDur = false): void {
    const src = this.src!;
    const items = this.chosen().slice(0, REEL_MAX_SCENES + 5);
    const snaps = items.map((i) => i.snap);
    const now = src.now ?? new Date();
    const base = defaultPlan(snaps, { format: this.format, links: drillLinks(snaps), licence: this.licence, generatedAt: generatedOn(now), storyTitle: src.title, rhythm: this.rhythm });
    // commentaire d'élément (puce colorée d'une couleur propre, ou commentaire saisi) : légende de la scène ;
    // la mise en avant seule garde la légende habituelle (son titre parle déjà de l'élément)
    base.scenes.forEach((sc, k) => {
      const it = items[k];
      const r = it ? parseSpec(it.snap.spec) : null;
      const note = r?.ok && r.spec.story.showComments ? elementNotes(r.spec, it!.ds).find((n) => !n.focus || n.edited) : undefined;
      if (note) sc.caption = clip(note.text.replace(/\s+/g, " ").trim(), 110);
    });
    if (src.links) base.links = src.links;
    if (!this.source) this.source = base.source;
    base.source = this.source;
    base.licence = this.licence;
    if (resetDur) for (const e of this.edits.values()) delete e.duration;
    for (const sc of base.scenes) {
      const e = this.edits.get(sc.id);
      if (!e) continue;
      if (e.title !== undefined) sc.title = e.title;
      if (e.number !== undefined) sc.number = e.number;
      if (e.caption !== undefined) sc.caption = e.caption;
    }
    // durées : automatiques (contenu), sauf saisie explicite
    for (const sc of base.scenes) sc.duration = this.edits.get(sc.id)?.duration ?? sc.duration;
    this.plan = base;
    this.charts?.dispose();
    this.charts = new ReelCharts(items, () => this.plan?.scenes ?? [], () => timingsFor(this.plan?.rhythm));
    this.composer = new ReelComposer(base, { fontCss: "", chart: (i, t, d, box) => this.charts!.frame(i, t, d, box) });
    this.renderScenes();
    this.refreshMeta();
    this.layoutStage();
    this.paint();
  }

  /** Retouche de texte : nouveau compositeur (lignes recalculées) sans réinitialiser la lecture. */
  private retext(): void {
    if (!this.plan) return;
    this.composer = new ReelComposer(this.plan, { fontCss: "", chart: (i, t, d, box) => this.charts!.frame(i, t, d, box) });
    this.refreshMeta();
    this.paint();
  }

  private renderShell(): void {
    const src = this.src!;
    this.stage = h("div", { class: "reel-stage", "data-testid": "reel-stage", "aria-label": "Aperçu du Reel" });
    this.scrub = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0", class: "reel-scrub", "aria-label": "Position dans le Reel", "data-testid": "reel-scrub" }) as HTMLInputElement;
    this.scrub.addEventListener("input", () => {
      this.setPlaying(false);
      this.seek(+this.scrub.value);
    });
    this.timeLbl = h("span", { class: "reel-time", "data-testid": "reel-time" });
    this.playBtn = h("button", { class: "btn btn-small reel-play", type: "button", "data-testid": "reel-play", "aria-label": "Lecture / pause", onclick: () => this.setPlaying(!this.playing) }) as HTMLButtonElement;
    const replay = h("button", { class: "btn btn-small", type: "button", "data-testid": "reel-replay", title: "Rejouer depuis le début", "aria-label": "Rejouer depuis le début", html: svgIcon(ICONS.restart, 15), onclick: () => (this.seek(0), this.setPlaying(true)) });
    const fmtBtns = (Object.keys(REEL_FORMATS) as ReelFormatKey[]).map((k) =>
      h(
        "button",
        { type: "button", class: `reel-fmt${k === this.format ? " on" : ""}`, "data-format": k, "data-testid": `reel-format-${k}`, "aria-pressed": k === this.format ? "true" : "false", title: REEL_FORMATS[k].hint, onclick: () => this.setFormat(k) },
        h("span", { class: `reel-fmt-ic f-${k}`, "aria-hidden": "true" }),
        h("span", { class: "reel-fmt-l" }, REEL_FORMATS[k].label)
      )
    );
    this.sceneList = h("div", { class: "reel-scenes", "data-testid": "reel-scenes" });
    this.totalLbl = h("span", { class: "reel-total", "data-testid": "reel-total" });
    const srcInp = h("input", { type: "text", class: "reel-input", value: this.source, maxlength: "160", placeholder: "Source : organisme, jeu de données, date", "data-testid": "reel-source", "aria-label": "Source des données" }) as HTMLInputElement;
    srcInp.addEventListener("input", () => {
      this.source = srcInp.value;
      if (this.plan) this.plan.source = srcInp.value;
      this.retext();
    });
    const licInp = h("input", { type: "text", class: "reel-input", value: this.licence, maxlength: "80", placeholder: "Licence : CC BY 4.0, données internes…", "data-testid": "reel-licence", "aria-label": "Licence des données" }) as HTMLInputElement;
    const setLic = (v: string) => {
      this.licence = v;
      licInp.value = v;
      if (this.plan) this.plan.licence = v;
      this.retext();
    };
    licInp.addEventListener("input", () => setLic(licInp.value));
    const chips = h("div", { class: "reel-chips" }, ...LICENCE_CHIPS.map((c) => h("button", { type: "button", class: "reel-chip", "data-testid": "reel-licence-chip", onclick: () => setLic(c) }, c)));
    this.problemsEl = h("ul", { class: "reel-problems", "data-testid": "reel-problems" });
    this.bar = h("span", { class: "reel-bar" });
    this.progLbl = h("span", { class: "reel-prog-l", "data-testid": "reel-progress-label" });
    this.progress = h("div", { class: "reel-progress", hidden: true, "data-testid": "reel-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, h("span", { class: "reel-track" }, this.bar), this.progLbl);
    this.exportBtn = h("button", { class: "btn btn-accent", type: "button", "data-testid": "reel-export", onclick: () => void this.export() }) as HTMLButtonElement;
    this.exportBtn.innerHTML = `${svgIcon(ICONS.download, 15)}<span>Exporter la vidéo</span>`;
    this.cancelBtn = h("button", { class: "btn", type: "button", hidden: true, "data-testid": "reel-cancel", onclick: () => this.abort?.abort() }, "Annuler l'export") as HTMLButtonElement;
    this.resultEl = h("div", { class: "reel-result", hidden: true, "data-testid": "reel-result" });
    this.capsEl = h("p", { class: "rv-hint reel-caps", "data-testid": "reel-caps" }, "Vérification de l'encodeur vidéo…");
    const n = src.items.length;
    const warn =
      n > REEL_MAX_SCENES
        ? h("p", { class: "rv-hint reel-warn", "data-testid": "reel-warn-count" }, `Cette séquence compte ${n} scènes : un Reel en raconte ${REEL_MAX_SCENES} au plus (15 à 30 s). Cochez ceux à garder.`)
        : n < 3
          ? h("p", { class: "rv-hint", "data-testid": "reel-warn-few" }, "3 à 5 scènes conviennent le mieux à un Reel ; ajoutez-en à la séquence si besoin.")
          : null;
    this.root.replaceChildren(
      h(
        "div",
        { class: "rv-dialog reel-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Créer un Reel" },
        h(
          "header",
          { class: "rv-dialog-head" },
          h("span", { class: "rv-ic", html: svgIcon(ICONS.reel, 20) }),
          h("div", null, h("h2", null, "Créer un Reel"), h("small", null, `Mini-film de « ${src.title} » pour Instagram, TikTok ou LinkedIn : ${REEL_MIN_S} à ${REEL_MAX_S} s, une scène par plan de la séquence, carte de fin avec lien et QR.`)),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Fermer", "data-testid": "reel-close", onclick: () => !this.abort && this.close() }, "×")
        ),
        h(
          "div",
          { class: "reel-body" },
          h("div", { class: "reel-left" }, this.stage, h("div", { class: "reel-controls" }, this.playBtn, replay, this.scrub, this.timeLbl)),
          h(
            "div",
            { class: "reel-right" },
            h("h4", null, "FORMAT"),
            h("div", { class: "reel-fmts", role: "group", "aria-label": "Format" }, ...fmtBtns),
            h("h4", null, "RYTHME"),
            h(
              "div",
              { class: "reel-rhythms", role: "group", "aria-label": "Rythme" },
              ...(["nerveux", "normal", "calme"] as ReelRhythm[]).map((k) =>
                h(
                  "button",
                  {
                    type: "button",
                    class: `reel-rhythm${k === this.rhythm ? " on" : ""}`,
                    "data-rhythm": k,
                    "data-testid": `reel-rhythm-${k}`,
                    "aria-pressed": k === this.rhythm ? "true" : "false",
                    title: REEL_RHYTHMS[k].hint,
                    onclick: () => this.setRhythm(k),
                  },
                  REEL_RHYTHMS[k].label
                )
              )
            ),
            h("div", { class: "reel-h" }, h("h4", null, "SCÈNES"), this.totalLbl, h("button", { type: "button", class: "btn btn-small btn-ghost", "data-testid": "reel-auto", title: "Durées calculées d'après le contenu", onclick: () => this.autoDurations() }, "Durées auto")),
            warn,
            this.sceneList,
            h("h4", null, "SOURCE ET LICENCE DES DONNÉES"),
            h("p", { class: "rv-hint" }, "Elles figurent dans le cartouche de chaque scène (avec le logo, la date de génération et un QR)."),
            srcInp,
            licInp,
            chips,
            h("p", { class: "rv-hint reel-end-note", html: `${svgIcon(ICONS.check, 13)} Carte de fin Datanime (mot-symbole, « Vos données. Racontées. », lien et QR) : incluse, obligatoire avec l'offre gratuite.` }),
            this.capsEl
          )
        ),
        h("footer", { class: "rv-dialog-foot reel-foot" }, this.problemsEl, this.progress, this.resultEl, h("span", { class: "rv-spacer" }), this.cancelBtn, this.exportBtn)
      )
    );
    srcInp.value = this.source;
  }

  private renderScenes(): void {
    const src = this.src!;
    const plan = this.plan!;
    const byId = new Map(plan.scenes.map((s, k) => [s.id, { s, k }]));
    const selOrder = this.order.filter((i) => this.selected[i]);
    const rows = this.order.map((i) => {
      const it = src.items[i]!;
      const on = this.selected[i]!;
      const sc = byId.get(it.snap.id)?.s;
      const box = h("input", { type: "checkbox", "data-testid": "reel-pick", "aria-label": `Inclure « ${it.snap.title || it.snap.name} »` }) as HTMLInputElement;
      box.checked = on;
      box.addEventListener("change", () => {
        this.selected[i] = box.checked;
        this.rebuild();
        this.seek(0);
      });
      const sk = selOrder.indexOf(i);
      const up = h("button", { type: "button", class: "icon-btn reel-move", "data-testid": "reel-move-up", title: "Monter la scène", "aria-label": "Monter la scène", disabled: !on || sk <= 0, html: svgIcon(ICONS.up, 14), onclick: () => this.shiftSelected(i, -1) });
      const down = h("button", { type: "button", class: "icon-btn reel-move", "data-testid": "reel-move-down", title: "Descendre la scène", "aria-label": "Descendre la scène", disabled: !on || sk < 0 || sk >= selOrder.length - 1, html: svgIcon(ICONS.down, 14), onclick: () => this.shiftSelected(i, 1) });
      const grip = h("span", { class: "reel-grip", "aria-hidden": "true", title: "Glisser pour réordonner", html: svgIcon(ICONS.grip, 14) });
      const head = h("div", { class: "reel-scene-head" }, on ? grip : h("span", { class: "reel-grip-spacer" }), h("label", { class: "reel-scene-check" }, box, h("span", { class: "reel-num" }, sc ? String((byId.get(it.snap.id)?.k ?? 0) + 1) : "–"), h("span", { class: "reel-scene-name", title: it.snap.title || it.snap.name }, it.snap.title || it.snap.name)), h("span", { class: "reel-moves" }, up, down));
      if (!sc) return h("div", { class: "reel-scene off", "data-scene-id": it.snap.id, "data-item": String(i) }, head);
      const edit = (key: "title" | "number" | "caption", inp: HTMLInputElement) =>
        inp.addEventListener("input", () => {
          const e = this.edits.get(sc.id) ?? {};
          const v = key === "number" ? inp.value.trim() || null : inp.value;
          (e as Record<string, unknown>)[key] = v;
          this.edits.set(sc.id, e);
          (sc as unknown as Record<string, unknown>)[key] = v;
          this.retext();
        });
      const title = h("input", { type: "text", class: "reel-input", value: sc.title, maxlength: "80", "data-testid": "reel-title", "aria-label": "Titre court" }) as HTMLInputElement;
      const num = h("input", { type: "text", class: "reel-input reel-input-num", value: sc.number ?? "", maxlength: "24", placeholder: "aucun", "data-testid": "reel-number", "aria-label": "Chiffre clé" }) as HTMLInputElement;
      const cap = h("input", { type: "text", class: "reel-input", value: sc.caption, maxlength: "140", placeholder: "Légende (facultative)", "data-testid": "reel-caption", "aria-label": "Légende du chiffre" }) as HTMLInputElement;
      const dur = h("input", { type: "number", class: "reel-input reel-input-dur", value: String(sc.duration), min: String(SCENE_MIN_S), max: String(SCENE_MAX_S), step: "0.5", "data-testid": "reel-duration", "aria-label": "Durée de la scène (s)" }) as HTMLInputElement;
      for (const inp of [title, num, cap]) inp.value = inp === title ? sc.title : inp === num ? sc.number ?? "" : sc.caption;
      edit("title", title);
      edit("number", num);
      edit("caption", cap);
      dur.addEventListener("change", () => {
        const v = Math.max(SCENE_MIN_S, Math.min(SCENE_MAX_S, Number(dur.value.replace(",", ".")) || sc.duration));
        dur.value = String(v);
        const e = this.edits.get(sc.id) ?? {};
        e.duration = v;
        this.edits.set(sc.id, e);
        sc.duration = v;
        this.retext();
      });
      const sceneNo = (byId.get(it.snap.id)?.k ?? 0) + 1;
      const editBtn = h(
        "button",
        {
          type: "button",
          class: "btn btn-mini reel-edit-chart",
          "data-testid": "reel-edit-chart",
          disabled: !src.editChart || !it.ds,
          title: it.ds ? "Ouvrir ce graphique dans l'éditeur (type, couleurs, mise en avant, réglages), puis revenir au Reel" : "Données de cette scène non chargées : rechargez-les pour modifier le graphique",
          "aria-label": `Modifier le graphique de la scène ${sceneNo}`,
          onclick: () => src.editChart?.(it, sceneNo),
        },
        h("span", { html: svgIcon(ICONS.edit, 13) }),
        "Modifier le graphique"
      );
      const link = sc.linkIn === "in" ? "zoom dans la marque depuis la scène précédente" : sc.linkIn === "out" ? "remontée depuis la scène précédente" : sc.linkIn === "focus" ? "mise en avant animée depuis la scène précédente" : "";
      const card = h(
        "div",
        { class: "reel-scene", "data-scene-id": it.snap.id, "data-item": String(i), "data-testid": "reel-scene" },
        head,
        h("div", { class: "reel-fields" }, h("label", { class: "reel-f wide" }, h("span", null, "Titre"), title), h("label", { class: "reel-f" }, h("span", null, "Chiffre clé"), num), h("label", { class: "reel-f" }, h("span", null, "Durée (s)"), dur), h("label", { class: "reel-f wide" }, h("span", null, "Légende"), cap)),
        h("div", { class: "reel-scene-actions" }, editBtn),
        link ? h("p", { class: "rv-hint reel-link-note" }, `Transition : ${link}.`) : null
      );
      // glisser-déposer depuis la poignée (Pointer Events : souris, doigt sur iPad, stylet)
      let dragPtr: { id: number; x: number; y: number; timer: number } | null = null;
      const scroller = (): HTMLElement | null => {
        for (let el: HTMLElement | null = this.sceneList; el && el !== this.root; el = el.parentElement) {
          const oy = getComputedStyle(el).overflowY;
          if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
        }
        return null;
      };
      const markTarget = () => {
        if (!dragPtr) return;
        let under = document.elementFromPoint(dragPtr.x, dragPtr.y)?.closest<HTMLElement>(".reel-scene") ?? null;
        if (!under) {
          // hors des cartes (au-dessus ou au-dessous de la liste) : carte la plus proche verticalement
          const lr = this.sceneList.getBoundingClientRect();
          if (dragPtr.x >= lr.left && dragPtr.x <= lr.right) {
            let best = Infinity;
            for (const el of this.sceneList.querySelectorAll<HTMLElement>(".reel-scene")) {
              const r = el.getBoundingClientRect();
              const d = dragPtr.y < r.top ? r.top - dragPtr.y : dragPtr.y > r.bottom ? dragPtr.y - r.bottom : 0;
              if (d < best) {
                best = d;
                under = el;
              }
            }
          }
        }
        for (const el of this.sceneList.querySelectorAll(".drop-target")) el.classList.remove("drop-target");
        if (under && under !== card) under.classList.add("drop-target");
      };
      grip.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        card.classList.add("dragging");
        e.preventDefault();
        // défilement automatique de la liste quand le doigt approche d'un bord
        const timer = window.setInterval(() => {
          const sc = scroller();
          if (!dragPtr || !sc) return;
          const r = sc.getBoundingClientRect();
          const edge = 56;
          const dy = dragPtr.y > r.bottom - edge ? Math.min(18, dragPtr.y - (r.bottom - edge)) : dragPtr.y < r.top + edge ? -Math.min(18, r.top + edge - dragPtr.y) : 0;
          if (dy) {
            sc.scrollTop += dy;
            markTarget();
          }
        }, 30);
        dragPtr = { id: e.pointerId, x: e.clientX, y: e.clientY, timer };
      });
      grip.addEventListener("pointermove", (e) => {
        if (!dragPtr || dragPtr.id !== e.pointerId) return;
        dragPtr.x = e.clientX;
        dragPtr.y = e.clientY;
        markTarget();
      });
      const endPtr = (e: PointerEvent) => {
        if (!dragPtr || dragPtr.id !== e.pointerId) return;
        window.clearInterval(dragPtr.timer);
        const target = this.sceneList.querySelector<HTMLElement>(".drop-target") ?? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".reel-scene");
        const to = target ? Number(target.dataset.item) : NaN;
        for (const el of this.sceneList.querySelectorAll(".drop-target, .dragging")) el.classList.remove("drop-target", "dragging");
        dragPtr = null;
        if (e.type === "pointerup" && Number.isFinite(to) && to !== i) this.moveOrder(i, to);
      };
      grip.addEventListener("pointerup", endPtr);
      grip.addEventListener("pointercancel", endPtr);
      return card;
    });
    this.sceneList.replaceChildren(...rows);
  }

  private autoDurations(): void {
    for (const e of this.edits.values()) delete e.duration;
    const plan = this.plan!;
    const auto = fitDurations(plan.scenes.map((sc) => autoSceneDuration({ title: sc.title, number: sc.number, caption: sc.caption }, this.rhythm)));
    plan.scenes.forEach((sc, k) => (sc.duration = auto[k]!));
    this.renderScenes();
    this.retext();
  }

  private refreshMeta(): void {
    const plan = this.plan;
    if (!plan) return;
    const tot = totalDuration(plan);
    this.totalLbl.textContent = `${plan.scenes.length} scène${plan.scenes.length > 1 ? "s" : ""} + fin · ${fmtS(tot)}`;
    this.totalLbl.classList.toggle("bad", tot < REEL_MIN_S - 0.05 || tot > REEL_MAX_S + 0.05);
    this.scrub.max = String(tot);
    const probs = reelProblems(plan);
    this.problemsEl.replaceChildren(...probs.map((p) => h("li", null, p)));
    this.problemsEl.hidden = !probs.length;
    this.exportBtn.disabled = !!this.abort;
    for (const inp of this.root.querySelectorAll<HTMLInputElement>("[data-testid=reel-source], [data-testid=reel-licence]")) {
      const empty = !inp.value.trim();
      inp.classList.toggle("need", empty);
    }
    this.updateTime();
  }

  private setFormat(k: ReelFormatKey): void {
    if (this.abort) return;
    this.format = k;
    for (const b of this.root.querySelectorAll<HTMLElement>(".reel-fmt")) {
      b.classList.toggle("on", b.dataset.format === k);
      b.setAttribute("aria-pressed", b.dataset.format === k ? "true" : "false");
    }
    const t = this.t;
    this.rebuild();
    this.seek(Math.min(t, totalDuration(this.plan!)));
  }

  private setRhythm(k: ReelRhythm): void {
    if (this.abort || this.rhythm === k) return;
    this.rhythm = k;
    for (const b of this.root.querySelectorAll<HTMLElement>(".reel-rhythm")) {
      b.classList.toggle("on", b.dataset.rhythm === k);
      b.setAttribute("aria-pressed", b.dataset.rhythm === k ? "true" : "false");
    }
    // les durées non saisies à la main suivent le nouveau rythme
    this.rebuild(true);
    this.seek(0);
  }

  private layoutStage(): void {
    const f = REEL_FORMATS[this.format];
    this.stage.style.aspectRatio = `${f.w} / ${f.h}`;
    this.stage.dataset.format = this.format;
  }

  private paint(): void {
    if (!this.composer) return;
    this.stage.innerHTML = this.composer.frameSvg(this.t);
    const svg = this.stage.firstElementChild as SVGSVGElement | null;
    svg?.removeAttribute("width");
    svg?.removeAttribute("height");
    svg?.setAttribute("data-testid", "reel-frame");
  }

  private updateTime(): void {
    if (!this.plan) return;
    const tot = totalDuration(this.plan);
    this.timeLbl.textContent = `${fmtS(this.t)} / ${fmtS(tot)}`;
    if (document.activeElement !== this.scrub) this.scrub.value = String(this.t);
  }

  seek(t: number): void {
    if (!this.plan) return;
    this.t = Math.max(0, Math.min(totalDuration(this.plan), t));
    this.paint();
    this.updateTime();
  }

  setPlaying(on: boolean): void {
    this.playing = on;
    cancelAnimationFrame(this.raf);
    if (this.playBtn) this.playBtn.innerHTML = svgIcon(on ? ICONS.pause : ICONS.play, 15);
    this.playBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    if (!on) return;
    if (this.plan && this.t >= totalDuration(this.plan) - 0.01) this.t = 0;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing || !this.plan) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const tot = totalDuration(this.plan);
      this.t = this.t + dt;
      if (this.t >= tot) {
        this.t = tot;
        this.paint();
        this.updateTime();
        this.setPlaying(false);
        return;
      }
      this.paint();
      this.updateTime();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Export vidéo (MP4 H.264, sinon repli) ; `opts.forceFallback` pour les tests. */
  async export(opts: { forceFallback?: boolean; download?: boolean } = {}): Promise<EncodeResult | null> {
    const plan = this.plan;
    if (!plan || this.abort) return null;
    const probs = reelProblems(plan);
    if (probs.length) {
      this.refreshMeta();
      const need = this.root.querySelector<HTMLInputElement>("input.need");
      need?.focus();
      this.problemsEl.classList.add("flash");
      setTimeout(() => this.problemsEl.classList.remove("flash"), 900);
      return null;
    }
    this.setPlaying(false);
    const f = REEL_FORMATS[plan.format];
    const ac = new AbortController();
    this.abort = ac;
    this.exportBtn.disabled = true;
    this.cancelBtn.hidden = false;
    this.resultEl.hidden = true;
    this.progress.hidden = false;
    this.root.classList.add("exporting");
    const setProg = (p: number, label: string) => {
      this.bar.style.width = `${Math.round(p * 100)}%`;
      this.progress.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      this.progLbl.textContent = label;
    };
    setProg(0, "Préparation des polices…");
    try {
      const fonts = await Promise.all([embeddedFontCss("inter"), displayFontCss(), ...this.fontsUsed().map((k) => embeddedFontCss(k))]);
      const comp = new ReelComposer(plan, { fontCss: fonts.join("\n"), chart: (i, t, d, box) => this.charts!.frame(i, t, d, box) });
      const frames = frameCount(plan);
      const t0 = performance.now();
      const res = await encodeReel({
        width: f.w,
        height: f.h,
        fps: plan.fps,
        frames,
        frameAt: (i) => comp.frameSvg(i / plan.fps),
        signal: ac.signal,
        forceFallback: opts.forceFallback,
        onProgress: (d, n) => {
          const el = (performance.now() - t0) / 1000;
          const left = d > 5 ? Math.max(0, (el / d) * (n - d)) : null;
          setProg(d / n, `Image ${d} / ${n}${left !== null ? ` · encore ~${Math.ceil(left)} s` : ""}`);
        },
      });
      const filename = `datanime-reel-${slug(this.src!.title)}-${plan.format}.${res.ext}`;
      this.lastResult = { ...res, filename };
      setProg(1, "Terminé");
      const mb = (res.blob.size / 1e6).toFixed(1).replace(".", ",");
      const again = h("button", { class: "btn btn-small", type: "button", "data-testid": "reel-download", onclick: () => download(res.blob, filename) }, "Télécharger à nouveau");
      this.resultEl.replaceChildren(
        h("span", { html: svgIcon(ICONS.check, 15) }),
        h("span", { "data-testid": "reel-result-text" }, `${filename} · ${mb} Mo · ${fmtS(res.durationS)} · ${f.w} × ${f.h} · ${res.ext === "mp4" && res.method === "webcodecs" ? "H.264" : res.ext.toUpperCase()}`),
        again
      );
      this.resultEl.hidden = false;
      if (opts.download !== false) download(res.blob, filename);
      return res;
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      this.resultEl.replaceChildren(h("span", { class: aborted ? "" : "reel-err" }, aborted ? "Export annulé." : `Export impossible : ${(e as Error)?.message ?? e}`));
      this.resultEl.hidden = false;
      this.resultEl.dataset.state = aborted ? "aborted" : "error";
      return null;
    } finally {
      this.abort = null;
      this.cancelBtn.hidden = true;
      this.exportBtn.disabled = false;
      this.progress.hidden = true;
      this.root.classList.remove("exporting");
      // le rendu hors champ a servi à l'export : l'aperçu reprend son image
      this.paint();
    }
  }
}
