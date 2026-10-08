/**
 * Récit de l'exploration guidée : titre affirmatif, 1 à 3 commentaires chiffrés et piste suivante, calculés
 * à partir du modèle de la vue (data/drill.ts). Module pur. Les textes n'emploient que des faits mesurés ;
 * les hypothèses sont présentées comme des pistes à vérifier.
 */
import type { ChartSpec, DrillSpec, NarrativeRole } from "../spec";
import type { Dataset } from "../data/table";
import { columnOf } from "../data/table";
import {
  addGrain,
  buildDrillModel,
  drillPathLabels,
  grainLabel,
  guessPersonField,
  guessRegionField,
  isCostLabel,
  levelsOf,
  type BreakdownModel,
  type BridgeItem,
  type BridgeModel,
  type CompareModel,
  type PivotModel,
  type PivotSeries,
  type DrillCtx,
  type DrillModel,
  type DrillTarget,
  type HistoryModel,
  type MonthModel,
  type PeriodsModel,
} from "../data/drill";
import { capitalize, formatAmount, formatInt, formatNumber, formatPct, formatSignedAmount, formatSignedPct, joinList, measureLabel, MINUS, NBSP, nounOf } from "./fr";

export interface DrillSuggestion {
  label: string;
  /** Réglages du tableau croisé (vue « pivot »). */
  pivot?: Partial<DrillSpec["pivot"]>;
  /** Étape à ajouter (zoom / focus) ou vue à ouvrir. */
  target?: DrillTarget;
  view?: DrillSpec["view"];
  by?: string | null;
}

export interface DrillStory {
  title: string;
  comments: string[];
  role: NarrativeRole;
  /** Périmètre lisible (sous-titre) : « Pipeline créé en € · T2 2026 par mois ». */
  scope: string;
  /** Vue lisible (« par trimestre », « carte par région »…). */
  viewLabel: string;
  path: string[];
  suggestion: DrillSuggestion | null;
  facts: Record<string, string | number>;
}

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Unité des montants : monétaire si la colonne le dit. */
export function isMoney(ctx: DrillCtx): boolean {
  return !!ctx.measure && /montant|amount|€|eur|chiffre|\bca\b|revenu|pipeline|vente|budget|co[uû]t|marge/i.test(ctx.measure.name + " " + ctx.spec.label);
}

export interface Fmt {
  v: (x: number) => string;
  sv: (x: number) => string;
  n: (x: number) => string;
  item: { sg: string; pl: string; f: boolean };
  measure: string;
  Measure: string;
  verb: string;
}

export function fmtOf(ctx: DrillCtx): Fmt {
  const money = isMoney(ctx);
  const cols = ctx.eff.columns.map((c) => c.name).join(" ");
  const item = /opportunit/i.test(cols) ? { sg: "opportunité", pl: "opportunités", f: true } : /affaire|deal/i.test(cols) ? { sg: "affaire", pl: "affaires", f: true } : /commande|order/i.test(cols) ? { sg: "commande", pl: "commandes", f: true } : { sg: "ligne", pl: "lignes", f: true };
  const measure = ctx.spec.label.trim() || (ctx.measure ? measureLabel(ctx.measure.name).replace(/_/g, " ").replace(/\beur\b/i, "").trim() : `nombre ${item.pl.startsWith("o") || item.pl.startsWith("a") ? "d'" : "de "}${item.pl}`);
  const created = /cr[ée]a|creat/i.test(ctx.date.name);
  // Comparaison de versions : montants en M€ à une décimale (18,1 M€ → 17,7 M€)
  const m1 = (a: number) => {
    const t = formatNumber(Math.round(a * 10) / 10, 1);
    return /,/.test(t) ? t : `${t},0`;
  };
  // ≥ 1 M€, ou dixième de M€ « rond » (0,5 M€) : en M€ ; sinon en k€ (450 k€)
  const inM = (a: number) => a >= 0.95e6 || (a >= 1e5 && Math.abs(a / 1e5 - Math.round(a / 1e5)) < 0.005);
  const amt = (x: number) => (ctx.ver && inM(Math.abs(x)) ? `${x < 0 ? MINUS : ""}${m1(Math.abs(x) / 1e6)}${NBSP}M€` : formatAmount(x));
  return {
    v: (x) => (ctx.measure ? (money ? amt(x) : formatNumber(x, Math.abs(x) >= 100 ? 0 : 1)) : formatInt(x)),
    sv: (x) => (ctx.measure ? (money ? (x > 0 ? "+" : "") + amt(x) : (x > 0 ? "+" : x < 0 ? MINUS : "") + formatNumber(Math.abs(x), 1)) : (x > 0 ? "+" : x < 0 ? MINUS : "") + formatInt(Math.abs(x))),
    n: (x) => formatInt(x),
    item,
    measure: measure.charAt(0).toLocaleLowerCase("fr-FR") + measure.slice(1),
    Measure: capitalize(measure),
    verb: created ? (item.f ? "créées" : "créés") : "",
  };
}

const cnt = (f: Fmt, n: number) => `${formatInt(n)}${NBSP}${Math.abs(n) < 2 ? f.item.sg : f.item.pl}`;
const pct = (r: number) => formatSignedPct(r, Math.abs(r) < 0.1 ? 1 : 0);

/** « en juin 2026 » / « au T2 2026 » / « en 2026 ». */
function inPeriod(label: string): string {
  return /^T\d/.test(label) ? `au ${label}` : /^sem\./.test(label) ? `la ${label}` : `en ${label}`;
}

const VIEW_LABEL = (d: DrillSpec, m: DrillModel, byNoun: string): string => {
  switch (m.view) {
    case "periods":
      return m.focusKind === "focus" ? `par ${grainNoun(m.grain)}` : m.zoomLabel ? `par ${grainNoun(m.grain)}` : `par ${grainNoun(m.grain)}`;
    case "month":
      return "jour par jour";
    case "map":
      return `carte par ${byNoun}`;
    case "history":
      return `historique par ${byNoun}`;
    case "breakdown":
      return `par ${byNoun}`;
    case "bridge":
      return `cascade par ${nounOf(m.field).sg}`;
    case "compare":
      return "par mois";
    case "pivot":
      return `tableau croisé par ${m.xIsTime ? m.xLabel : nounOf(m.x).sg}${m.seriesField && m.seriesField !== "@version" ? ` et ${nounOf(m.seriesField).sg}` : ""}`;
  }
  void d;
  return "";
};

function grainNoun(g: string): string {
  return g === "quarter" ? "trimestre" : g === "month" ? "mois" : g === "year" ? "année" : "semaine";
}

function periodsStory(m: PeriodsModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const bars = m.bars;
  const complete = bars.filter((b) => !b.partial);
  const facts: Record<string, string | number> = {};
  const comments: string[] = [];
  const catLabel = ctx.cats.map((c) => c.value).join(" · ");
  const who = catLabel ? `${catLabel} : ` : "";
  if (m.focus == null) {
    const a = complete[0];
    const b = complete[complete.length - 1];
    if (a && b && a !== b && a.value > 0) {
      const r = b.value / a.value - 1;
      return {
        title: `${who}${f.Measure} : ${pct(r)} entre ${a.label} et ${b.label}`,
        comments: [`${capitalize(a.label)} : ${f.v(a.value)} ; ${b.label} : ${f.v(b.value)}.`, `${cnt(f, complete.reduce((s, x) => s + x.count, 0))} sur la période.`],
        role: "context",
        facts: { from: a.value, to: b.value },
      };
    }
    return { title: `${who}${f.Measure} par ${grainNoun(m.grain)}`, comments: [], role: "context", facts };
  }
  const fb = bars[m.focus]!;
  facts.focus = fb.label;
  facts.value = fb.value;
  if (m.focusKind === "standout" && !m.zoomLabel) {
    // Vue de départ : le trimestre qui recule
    const prev = bars[m.focus - 1]!;
    const ch = fb.value / prev.value - 1;
    const negatives = complete.filter((b, i) => {
      const j = bars.indexOf(b);
      return j > 0 && !bars[j - 1]!.partial && b.value < bars[j - 1]!.value && i >= 0;
    }).length;
    let streak = 0;
    for (let j = m.focus - 1; j > 0 && bars[j]!.value > bars[j - 1]!.value; j--) streak++;
    const unique = negatives === 1;
    const after = m.focus + 1 < bars.length && !bars[m.focus + 1]!.partial ? bars[m.focus + 1]! : null;
    const title = unique
      ? `${who}${fb.label} : seul ${grainNoun(m.grain)} en recul (${pct(ch)})${streak >= 2 ? ` après ${streak} ${grainNoun(m.grain)}s de hausse` : ""}`
      : `${who}${fb.label} : plus fort recul (${pct(ch)} vs ${prev.label})`;
    comments.push(`${f.Measure} : ${f.v(fb.value)} ${inPeriod(fb.label)} contre ${f.v(prev.value)} ${inPeriod(prev.label)} (${f.sv(fb.value - prev.value)}).`);
    const first = complete[0]!;
    const last = complete[complete.length - 1]!;
    if (first !== last && first.value > 0) comments.push(`Sur la période : de ${f.v(first.value)} (${first.label}) à ${f.v(last.value)} (${last.label}), ${pct(last.value / first.value - 1)}.`);
    if (after) comments.push(after.value > fb.value ? `${capitalize(after.label)} repart (${pct(after.value / fb.value - 1)}) : à quel mois tient le recul ?` : `${capitalize(after.label)} ne repart pas (${pct(after.value / fb.value - 1)}).`);
    facts.change = ch;
    return { title, comments, role: "context", facts };
  }
  const ref = fb.ref ?? 0;
  const r = ref > 0 ? fb.value / ref - 1 : 0;
  const refTxt = m.refLabel.replace(/^moy\. /, "");
  facts.ref = ref;
  facts.ratio = r;
  if (m.focusKind === "standout") {
    // Zoom : le mois qui décroche dans le trimestre
    const title = `${who}${capitalize(fb.label)} décroche : ${f.v(fb.value)}, ${pct(r)} vs la moyenne ${refTxt}`;
    comments.push(`${capitalize(fb.label)} : ${f.v(fb.value)} contre ${f.v(ref)} en moyenne sur ${refTxt} (${f.sv(fb.value - ref)}).`);
    const others = bars.filter((b, i) => b.highlight && i !== m.focus && b.ref && b.ref > 0 && !b.partial);
    if (others.length) {
      const parts = others.map((b) => `${b.label.split(" ")[0]} ${pct(b.value / b.ref! - 1)}`);
      comments.push(`Les autres mois ${m.zoomLabel ? `du ${m.zoomLabel} ` : ""}restent proches de leur moyenne des 3 mois précédents (${parts.join(", ")}).`);
    }
    if (fb.refCount != null) comments.push(`${capitalize(f.item.pl)} : ${formatInt(fb.count)} ${inPeriod(fb.label)} contre ${formatInt(Math.round(fb.refCount))} en moyenne.`);
    return { title, comments, role: "tension", facts };
  }
  // Focus d'une catégorie (région, commercial…) : la période dans son historique
  const lower = bars.filter((b) => !b.partial && b.value < fb.value);
  const firstK = bars.findIndex((b) => !b.partial);
  const span = bars.length - firstK;
  let title: string;
  if (!lower.length) title = `${who}${fb.label} au plus bas sur ${span} ${grainNoun(m.grain)} (${f.v(fb.value)}, ${pct(r)})`;
  else if (r < -0.1) title = `${who}${fb.label} : ${f.v(fb.value)}, ${pct(r)} vs la moyenne ${refTxt}`;
  else title = `${who}${fb.label} dans la norme : ${f.v(fb.value)} (${pct(r)} vs ${refTxt})`;
  comments.push(`${f.v(fb.value)} ${inPeriod(fb.label)} contre ${f.v(ref)} en moyenne sur ${refTxt} (${f.sv(fb.value - ref)}).`);
  const next = m.focus + 1 < bars.length && !bars[m.focus + 1]!.partial ? bars[m.focus + 1]! : null;
  if (next && ref > 0) comments.push(next.value >= ref * 0.9 ? `Rebond dès ${next.label} : ${f.v(next.value)} (${pct(next.value / ref - 1)} vs ${refTxt}).` : `Pas de rebond ${inPeriod(next.label)} : ${f.v(next.value)} (${pct(next.value / ref - 1)} vs ${refTxt}).`);
  if (fb.refCount != null) comments.push(`${capitalize(f.item.pl)} : ${formatInt(fb.count)} ${inPeriod(fb.label)} contre ${formatInt(Math.round(fb.refCount))} en moyenne.`);
  return { title, comments, role: "revelation", facts };
}

function monthStory(m: MonthModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const label = grainLabel(m.start, m.grain);
  const L = capitalize(label);
  const refTxt = m.refLabel.replace(/^moy\. /, "");
  const gap = m.curTotal - m.refTotal;
  const r = m.refTotal > 0 ? gap / m.refTotal : 0;
  const mid = Math.min(14, m.days - 1);
  const gapMid = (m.cur[mid] ?? 0) - m.ref[mid]!;
  const below = m.weeks.filter((w) => w.cur < w.ref * 0.95).length;
  const comments: string[] = [];
  let title: string;
  const growing = gap < 0 && Math.abs(gap) > Math.abs(gapMid) * 1.5;
  if (gap < 0 && below >= m.weeks.length - 1) title = `${L} : l'écart se creuse tout au long du ${grainNoun(m.grain)} (${f.sv(gap)} à la fin)`;
  else if (gap < 0) title = `${L} : ${f.sv(gap)} vs le rythme habituel, concentré sur ${below} semaine${below > 1 ? "s" : ""}`;
  else title = `${L} : au-dessus du rythme habituel (${f.sv(gap)})`;
  if (m.grain === "month") comments.push(`Au 15 ${MONTHS_LONG[new Date(m.start).getUTCMonth()]} : ${f.sv(gapMid)} vs le rythme moyen de ${refTxt}${m.ref[mid] ? ` (${pct(gapMid / m.ref[mid]!)})` : ""}.`);
  comments.push(`Fin ${grainNoun(m.grain) === "mois" ? MONTHS_LONG[new Date(m.start).getUTCMonth()] : label} : ${f.v(m.curTotal)} contre ${f.v(m.refTotal)} en moyenne (${pct(r)}).`);
  if (gap < 0) comments.push(below === m.weeks.length ? `Les ${m.weeks.length} semaines sont sous le rythme habituel : ce n'est pas un incident ponctuel.` : `${below} semaine${below > 1 ? "s" : ""} sur ${m.weeks.length} sous le rythme habituel.`);
  void growing;
  void ctx;
  return { title, comments, role: "tension", facts: { total: m.curTotal, ref: m.refTotal, gap } };
}

function breakdownStory(m: BreakdownModel, ctx: DrillCtx, f: Fmt, ds: Dataset): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const noun = nounOf(m.field);
  const P = m.periodLabel;
  const refTxt = m.refLabel.replace(/^moy\. /, "");
  const comments: string[] = [];
  const catLabel = ctx.cats.map((c) => c.value).join(" · ");
  if (m.standout == null || m.delta == null || m.refTotal == null) {
    const top = m.standout != null ? m.stats[m.standout]! : null;
    const title = top ? `${top.key} en tête : ${f.v(top.value)} (${formatPct(top.value / (m.total || 1))})` : `${f.Measure} par ${noun.sg}`;
    return { title, comments: [`${f.Measure} : ${f.v(m.total)}${P ? ` ${inPeriod(P)}` : ""}.`], role: "revelation", facts: {} };
  }
  const s = m.stats[m.standout]!;
  const share = m.share ?? 0;
  const ref = s.ref ?? 0;
  const r = ref > 0 ? s.value / ref - 1 : 0;
  const isPerson = ctx.eff.columns.some((c) => c.name === m.field) && m.field === (guessPersonField(ds) ?? "");
  const facts: Record<string, string | number> = { standout: s.key, share, delta: m.delta };
  let title: string;
  let role: NarrativeRole = "revelation";
  if (m.view === "breakdown" && isPerson && s.count === 0 && (s.refCount ?? 0) >= 1) {
    title = `${s.key} : 0 ${f.item.sg} ${f.verb ? (f.item.f ? "créée" : "créé") + " " : ""}${inPeriod(P!)} contre ${formatInt(Math.round(s.refCount!))} en moyenne`;
    role = "recommendation";
  } else if (m.delta < 0 && share >= 0.95) title = `${P ? `${capitalize(P)} : ` : ""}${le2(s.key)} concentre toute la baisse (${f.sv(s.delta ?? 0)} sur ${f.sv(m.delta)})`;
  else if (m.delta < 0 && share >= 0.5) title = `${P ? `${capitalize(P)} : ` : ""}${le2(s.key)} explique ${formatPct(share)} de la baisse`;
  else if (m.delta < 0) title = `${P ? `${capitalize(P)} : ` : ""}baisse répartie, ${s.key} en tête (${f.sv(s.delta ?? 0)})`;
  else title = `${P ? `${capitalize(P)} : ` : ""}${s.key} porte la hausse (${f.sv(s.delta ?? 0)})`;
  title = title.replace(/^(.)/, (c) => c.toLocaleUpperCase("fr-FR"));
  const shareOfRef = isPerson && m.view === "breakdown" && m.refTotal > 0 ? ` (${formatPct(ref / m.refTotal)} ${catLabel ? `du ${f.measure} de ${le2(catLabel)}` : `du ${f.measure}`})` : "";
  comments.push(shareOfRef ? `${s.key} : ${f.v(s.value)} ${inPeriod(P!)} contre ${f.v(ref)} en moyenne sur ${refTxt}${shareOfRef}.` : `${s.key} : ${f.v(s.value)} ${inPeriod(P!)} contre ${f.v(ref)} en moyenne sur ${refTxt} (${pct(r)}${s.refCount != null ? `, ${formatInt(s.count)} ${s.count < 2 ? f.item.sg : f.item.pl} contre ${formatInt(Math.round(s.refCount))}` : ""}).`);
  const others = m.stats.filter((_, i) => i !== m.standout);
  const oVal = others.reduce((a, x) => a + x.value, 0);
  const oRef = others.reduce((a, x) => a + (x.ref ?? 0), 0);
  if (isPerson && m.view === "breakdown") {
    if (others.length && oRef > 0) comments.push(`${others.length === 1 ? "L'autre" : `Les ${others.length} autres`} ${others.length === 1 ? noun.sg : noun.pl} ${Math.abs(oVal / oRef - 1) < 0.1 ? (others.length === 1 ? "est stable" : "sont stables") : others.length === 1 ? "évolue" : "évoluent"} : ${pct(oVal / oRef - 1)} au total (${joinList(others.slice(0, 4).map((o) => o.key))}).`);
    if (s.count === 0 && m.nextLabel && s.next) comments.push(s.next.count > 0 ? `Piste : absence sans relais ? ${s.key} reprend ${inPeriod(m.nextLabel)} (${cnt(f, s.next.count)}).` : `Piste : départ ou portefeuille non réaffecté ? Toujours 0 ${f.item.sg} ${inPeriod(m.nextLabel)}.`);
  } else {
    if (others.length && oRef > 0) comments.push(`${others.length === 1 ? `L'autre ${noun.sg}` : `Les ${others.length} autres ${noun.pl}`} : ${pct(oVal / oRef - 1)} au total, ${Math.abs(oVal / oRef - 1) < 0.1 ? "dans leur rythme habituel" : "en dehors de leur rythme habituel"}.`);
    comments.push(`Total ${inPeriod(P!)} : ${f.v(m.total)} contre ${f.v(m.refTotal)} en moyenne (${f.sv(m.delta)}, ${pct(m.delta / (m.refTotal || 1))}).`);
  }
  return { title, comments: comments.slice(0, 3), role, facts };
}

function historyStory(m: HistoryModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const noun = nounOf(m.field);
  const comments: string[] = [];
  const s = m.standout != null ? m.series[m.standout]! : null;
  const fl = m.focus != null ? grainLabel(m.keys[m.focus]!, m.grain) : null;
  const refTxt = m.refLabel.replace(/^moy\. /, "");
  let title: string;
  if (s && fl && s.focusRatio != null) {
    const others = m.series.filter((x) => x !== s && x.focusRatio != null);
    const othersOk = others.every((x) => x.focusRatio! > -0.15);
    title = othersOk ? `Seul${noun.f ? "e" : ""} ${le2(s.key)} décroche ${inPeriod(fl)}${m.seasonal ? ` ; ${MONTHS_LONG[m.seasonal.month]} est bas partout` : ""}` : `${capitalize(fl)} : ${s.key} recule le plus (${pct(s.focusRatio)})`;
    const minIdx = s.values.reduce((bi, v, i) => (!m.partial[i] && v < s.values[bi]! ? i : bi), m.partial.findIndex((p) => !p));
    comments.push(`${s.key}, ${fl} : ${pct(s.focusRatio)} vs ${refTxt}${minIdx === m.focus ? ", plus bas niveau de l'historique" : ""}.`);
    if (others.length) comments.push(`${others.length === 1 ? `L'autre ${noun.sg}` : `Les ${others.length} autres ${noun.pl}`} ${inPeriod(fl)} : ${others.map((o) => `${o.key} ${pct(o.focusRatio!)}`).join(", ")}.`);
  } else title = `Historique par ${noun.sg}`;
  if (m.seasonal) comments.push(`${capitalize(MONTHS_LONG[m.seasonal.month]!)} est bas ${m.series.length === 2 ? "dans les 2" : `dans les ${m.series.length}`} ${noun.pl} (${pct(m.seasonal.ratio)} en moyenne vs les 3 mois précédents) : c'est la saisonnalité, pas le sujet.`);
  void ctx;
  void f;
  return { title, comments: comments.slice(0, 3), role: "revelation", facts: { standout: s?.key ?? "" } };
}

/** « la Wallonie » / « l'Île-de-France » / « Bruxelles » (noms de lieux) ; nom propre sinon. */
function le2(name: string): string {
  if (/^(Bruxelles|Paris|Lille)$/.test(name)) return name;
  if (/^[AEÉIOUÎ]/.test(name)) return `l'${name}`;
  if (/^(Wallonie|Flandre|Normandie|Bretagne|Occitanie|Corse)/.test(name)) return `la ${name}`;
  if (/^Hauts-de-France$/.test(name)) return "les Hauts-de-France";
  return name;
}

/** Étendue des données (« janv. 2025 – sept. 2026 »). */
function spanLabel(ctx: DrillCtx): string {
  const a = grainLabel(ctx.minT, "month");
  const b = grainLabel(ctx.maxT, "month");
  return a === b ? a : `${a} – ${b}`;
}

/** Récit de la vue courante ; null sans modèle exploitable. */
export function drillStory(spec: Pick<ChartSpec, "drill" | "transform">, ds: Dataset | null): DrillStory | null {
  const { model, ctx } = buildDrillModel(spec, ds);
  if (!model || !ctx || !ds) return null;
  const f = fmtOf(ctx);
  const d = spec.drill;
  const byNoun = d.by ? nounOf(d.by).sg : "catégorie";
  let core: Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion">;
  switch (model.view) {
    case "periods":
      core = periodsStory(model, ctx, f);
      break;
    case "month":
      core = monthStory(model, ctx, f);
      break;
    case "history":
      core = historyStory(model, ctx, f);
      break;
    case "bridge":
      core = bridgeStory(model, ctx, f);
      break;
    case "compare":
      core = compareStory(model, ctx, f);
      break;
    case "pivot":
      core = pivotStory(model, ctx, f);
      break;
    default:
      core = ctx.ver ? versionBreakdownStory(model, ctx, f) : breakdownStory(model, ctx, f, ctx.eff);
  }
  const viewLabel = VIEW_LABEL(d, model, byNoun);
  const path = drillPathLabels(d);
  const unit = isMoney(ctx) ? " en €" : "";
  const where = path.length > 1 ? path.slice(1).join(" › ") : ctx.ver ? "" : spanLabel(ctx);
  const scope = ctx.ver ? [`${f.Measure}${unit}`, `${ctx.fromLabel} → ${ctx.toLabel}`, where, viewLabel].filter(Boolean).join(" · ") : `${f.Measure}${unit} · ${where} · ${viewLabel}`;
  return { ...core, title: core.title.replace(/[ \t\r\n]+/g, " ").trim(), scope, viewLabel, path, suggestion: suggest(model, ctx, d, ds) };
}

/** Piste suivante (bouton « Suggestion » de la barre d'exploration et scénario démo). */
function suggest(m: DrillModel, ctx: DrillCtx, d: DrillSpec, ds: Dataset): DrillSuggestion | null {
  const region = guessRegionField(ctx.eff);
  const person = guessPersonField(ctx.eff);
  const usedCats = new Set(ctx.cats.map((c) => c.field));
  if (ctx.ver) {
    if (m.view === "bridge") {
      const pick = [m.topNeg, m.topPos].filter((i): i is number => i != null).sort((a, b) => Math.abs(m.items[b]!.value) - Math.abs(m.items[a]!.value))[0];
      if (pick == null) return null;
      const it = m.items[pick]!;
      return { label: `Détailler ${it.key}`, target: { kind: "cat", field: m.field, value: it.key } };
    }
    if (m.view === "compare") {
      if (region && !usedCats.has(region)) return { label: "Répartir dans l'espace", view: "map", by: region };
      return { label: "Tableau croisé", view: "pivot", pivot: { x: "@quarter", series: levelsOf(d, ctx.eff)[0] ?? null, agg: "delta", chart: "bar" } };
    }
    if (m.view === "map" || m.view === "breakdown") return { label: "Tableau croisé par trimestre", view: "pivot", pivot: { x: "@quarter", series: levelsOf(d, ctx.eff).find((x) => !usedCats.has(x)) ?? null, agg: "delta", chart: "bar" } };
    return null;
  }
  if (m.view === "periods") {
    if (m.focus != null && m.focusKind === "standout") {
      const b = m.bars[m.focus]!;
      return { label: `Zoomer sur ${b.label}`, target: { kind: "period", start: b.key, grain: m.grain } };
    }
    if (m.focusKind === "focus" && person && !usedCats.has(person)) return { label: `Détailler par ${nounOf(person).sg}`, view: "breakdown", by: person };
    return null;
  }
  if (m.view === "month") {
    if (region && !usedCats.has(region)) return { label: "Répartir dans l'espace", view: "map", by: region };
    if (person && !usedCats.has(person)) return { label: `Détailler par ${nounOf(person).sg}`, view: "breakdown", by: person };
    return null;
  }
  if (m.view === "map") return { label: `Historique par ${nounOf(m.field).sg}`, view: "history", by: m.field };
  if (m.view === "history" && m.standout != null) return { label: `Zoomer sur ${m.series[m.standout]!.key}`, target: { kind: "cat", field: m.field, value: m.series[m.standout]!.key } };
  if (m.view === "breakdown" && m.standout != null && m.field !== person && person && !usedCats.has(person)) return { label: `Zoomer sur ${m.stats[m.standout]!.key}`, target: { kind: "cat", field: m.field, value: m.stats[m.standout]!.key } };
  void d;
  void ds;
  void addGrain;
  void columnOf;
  return null;
}

/* ------------------------------------------------------------------ versions (réel → budget) */

/** « 2025 » pour « Réel 2025 » (sinon le libellé complet). */
function yearOf(label: string): string {
  return label.match(/(19|20)\d{2}/)?.[0] ?? label;
}

/** « de coûts d'hébergement » (compte dominant nommé « Coûts … ») ou « de coûts ». */
function costPhrase(items: BridgeItem[], costDelta: number): string {
  const costs = items.filter((it) => it.kind === "delta" && Math.abs(it.cost) > 0);
  const top = costs.sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost))[0];
  if (top && Math.abs(costDelta) > 0 && top.cost / costDelta >= 0.8 && /^co[uû]ts?\s/i.test(top.key)) return `de ${top.key.charAt(0).toLocaleLowerCase("fr-FR")}${top.key.slice(1)}`;
  return "de coûts";
}

function bridgeStory(m: BridgeModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const scope = ctx.cats.map((c) => c.value).join(" · ");
  const vs = yearOf(m.fromLabel);
  const pos = m.topPos != null ? m.items[m.topPos]! : null;
  const neg = m.topNeg != null ? m.items[m.topNeg]! : null;
  const deltas = m.items.filter((it) => it.kind === "delta");
  const facts: Record<string, string | number> = { delta: m.delta, start: m.start, end: m.end, top_pos: pos?.key ?? "", top_neg: neg?.key ?? "" };
  const comments: string[] = [];
  const split = (it: BridgeItem) => (ctx.cost ? `, dont ${f.sv(it.rev)} de revenus et ${f.sv(it.cost)} de coûts` : "");
  if (m.groupField && m.revDelta != null && m.costDelta != null) {
    // Un facteur (ligne métier) détaillé par compte : revenus puis coûts
    const who = scope || f.Measure;
    const title = `${who} : ${f.sv(m.delta)} vs ${vs}, dont ${f.sv(m.revDelta)} de revenus et ${f.sv(m.costDelta)} ${costPhrase(deltas, m.costDelta)}`;
    const revs = deltas.filter((it) => !isCostLabel(it.group)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const costs = deltas.filter((it) => isCostLabel(it.group)).sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
    const r0 = revs[0];
    if (r0 && Math.abs(r0.value) > 0) comments.push(`${r0.key} : ${f.sv(r0.value)}${m.revDelta && Math.sign(m.revDelta) === Math.sign(r0.value) && Math.abs(r0.value) <= Math.abs(m.revDelta) * 1.001 ? `, ${formatPct(r0.value / m.revDelta)} de ${m.revDelta > 0 ? "la hausse" : "la baisse"} des revenus` : ""}.`);
    const c0 = costs[0];
    if (c0 && Math.abs(c0.cost) > 0) comments.push(`${c0.key} : ${f.sv(c0.cost)} de coûts${m.costDelta && Math.sign(m.costDelta) === Math.sign(c0.cost) && Math.abs(c0.cost) <= Math.abs(m.costDelta) * 1.001 ? ` (${formatPct(c0.cost / m.costDelta)} de ${m.costDelta > 0 ? "la hausse" : "la baisse"} des coûts)` : ""}.`);
    comments.push(`${capitalize(f.measure)} ${scope ? `${scope} ` : ""}: ${f.v(m.start)} (${m.fromLabel}) → ${f.v(m.end)} (${m.toLabel}), ${pct(m.delta / (Math.abs(m.start) || 1))}.`);
    Object.assign(facts, { rev: m.revDelta, cost: m.costDelta });
    return { title, comments: comments.slice(0, 3), role: m.delta >= 0 ? "revelation" : "tension", facts };
  }
  const who = scope ? `${scope} · ` : "";
  let title: string;
  if (pos && neg && m.delta < 0 && Math.abs(neg.value) > pos.value) title = `${who}${m.toLabel} : ${f.sv(m.delta)} vs ${m.fromLabel} — ${neg.key} (${f.sv(neg.value)}) efface la hausse de ${pos.key} (${f.sv(pos.value)})`;
  else if (pos && m.delta >= 0) title = `${who}${m.toLabel} : ${f.sv(m.delta)} vs ${m.fromLabel}, porté par ${pos.key} (${f.sv(pos.value)})${neg ? ` malgré ${neg.key} (${f.sv(neg.value)})` : ""}`;
  else if (neg) title = `${who}${m.toLabel} : ${f.sv(m.delta)} vs ${m.fromLabel}, ${neg.key} pèse le plus (${f.sv(neg.value)})`;
  else title = `${who}${m.toLabel} : ${f.sv(m.delta)} vs ${m.fromLabel}`;
  if (pos) comments.push(`${pos.key} : ${f.sv(pos.value)} vs ${vs}${split(pos)}.`);
  if (neg) comments.push(`${neg.key} : ${f.sv(neg.value)} vs ${vs}${split(neg)}.`);
  const rest = deltas.filter((it) => it !== pos && it !== neg);
  if (rest.length) comments.push(`${rest.length === 1 ? "Autre facteur" : "Autres facteurs"} : ${rest.slice(0, 4).map((it) => `${it.key} ${f.sv(it.value)}`).join(", ")}.`);
  return { title, comments: comments.slice(0, 3), role: m.delta < 0 ? "context" : "context", facts };
}

const MONTHS_CAP = MONTHS_LONG.map((x) => capitalize(x));

function compareStory(m: CompareModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const name = ctx.cats.length ? ctx.cats[ctx.cats.length - 1]!.value! : f.Measure;
  const comments: string[] = [];
  const r = m.fromTotal ? m.delta / Math.abs(m.fromTotal) : 0;
  const dl = m.months.map((x) => x.delta ?? 0);
  const facts: Record<string, string | number> = { delta: m.delta, h1: m.h1, h2: m.h2, break: m.breakAt != null ? MONTHS_LONG[m.breakAt]! : "" };
  let title: string;
  let role: NarrativeRole = "revelation";
  const kind = m.costOnly ? " de coûts" : "";
  if (m.breakAt != null && m.delta < 0 !== m.costOnly) {
    const after = dl.slice(m.breakAt);
    const avg = after.reduce((a, b) => a + b, 0) / after.length;
    title = `${name} : ${f.sv(m.delta)}${kind} au ${m.toLabel}, rupture à partir de ${MONTHS_LONG[m.breakAt]} (${f.sv(avg)} par mois)`;
    role = "tension";
  } else if (m.delta !== 0 && Math.abs(m.h2) / (Math.abs(m.h1) + Math.abs(m.h2) || 1) >= 0.6 && Math.sign(m.h2) === Math.sign(m.delta)) {
    title = `${name} : ${f.sv(m.delta)}${kind} au ${m.toLabel}, dont ${formatPct(m.h2 / m.delta)} au second semestre`;
  } else title = `${name} : ${f.sv(m.delta)}${kind} au ${m.toLabel} vs ${m.fromLabel} (${pct(r)})`;
  comments.push(`${m.fromLabel} : ${f.v(m.fromTotal)} ; ${m.toLabel} : ${f.v(m.toTotal)} (${pct(r)}).`);
  if (m.breakAt != null) {
    const before = dl.slice(0, m.breakAt);
    const after = dl.slice(m.breakAt);
    const avgB = before.reduce((a, b) => a + b, 0) / before.length;
    const avgA = after.reduce((a, b) => a + b, 0) / after.length;
    const span = m.breakAt === 1 ? MONTHS_CAP[0] : `${MONTHS_CAP[0]}–${MONTHS_LONG[m.breakAt - 1]}`;
    comments.push(Math.abs(avgB) < Math.abs(avgA) * 0.1 ? `${span} au niveau de ${yearOf(m.fromLabel)}, puis ${f.sv(avgA)} par mois de ${MONTHS_LONG[m.breakAt]} à décembre.` : `${span} : ${f.sv(avgB)} par mois vs ${yearOf(m.fromLabel)}, puis ${f.sv(avgA)} par mois de ${MONTHS_LONG[m.breakAt]} à décembre.`);
    if (m.delta < 0 && !m.costOnly) comments.push(`Piste : contrat perdu ou non renouvelé fin ${MONTHS_LONG[m.breakAt - 1]} ? À confirmer avec le contrôle de gestion.`);
    else if (m.delta > 0 && !m.costOnly) comments.push(`Piste : la hausse repose sur des contrats attendus à partir de ${MONTHS_LONG[m.breakAt]} : à sécuriser.`);
  } else {
    comments.push(`1er semestre : ${f.sv(m.h1)} ; 2nd semestre : ${f.sv(m.h2)}.`);
  }
  return { title, comments: comments.slice(0, 3), role, facts };
}

function pivotStory(m: PivotModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const comments: string[] = [];
  const facts: Record<string, string | number> = {};
  const xs = m.xIsTime ? m.xLabel : nounOf(m.x).sg;
  if (m.isDelta && m.series.length > 1) {
    const sorted = [...m.series].sort((a, b) => b.total - a.total);
    const pos = sorted[0]!.total > 0 ? sorted[0]! : null;
    const neg = sorted[sorted.length - 1]!.total < 0 ? sorted[sorted.length - 1]! : null;
    const half = Math.floor(m.keys.length / 2);
    const late = (se: PivotSeries) => se.values.slice(half).reduce<number>((a, v) => a + (v ?? 0), 0);
    const parts: string[] = [];
    if (pos) {
      const share = pos.total ? late(pos) / pos.total : 0;
      parts.push(share >= 0.6 && m.xIsTime ? `${pos.key} ${f.sv(pos.total)} (${formatPct(share)} sur ${m.keys[half]}–${m.keys[m.keys.length - 1]})` : `${pos.key} ${f.sv(pos.total)}`);
    }
    if (neg) {
      const k = neg.values.findIndex((v) => (v ?? 0) < 0 && Math.abs(v ?? 0) >= Math.abs(neg.total) * 0.05);
      parts.push(m.xIsTime && k >= 0 ? `${neg.key} ${f.sv(neg.total)} dès ${m.keys[k]}` : `${neg.key} ${f.sv(neg.total)}`);
    }
    const title = parts.length ? `Écart par ${xs} : ${parts.join(", ")}` : `Écart ${ctx.toLabel} vs ${ctx.fromLabel} par ${xs}`;
    for (const se of [pos, neg].filter(Boolean) as PivotSeries[]) comments.push(`${se.key} : ${m.keys.map((k, i) => `${k} ${f.sv(se.values[i] ?? 0)}`).join(", ")}.`);
    const others = m.series.filter((se) => se !== pos && se !== neg);
    if (others.length) comments.push(`${others.length === 1 ? "Autre" : "Autres"} : ${others.slice(0, 4).map((se) => `${se.key} ${f.sv(se.total)}`).join(", ")}.`);
    return { title, comments: comments.slice(0, 3), role: "revelation", facts };
  }
  const tot = m.series.map((se) => se.total);
  const keyTot = m.keys.map((_, i) => m.series.reduce((a, se) => a + (se.values[i] ?? 0), 0));
  let bi = 0;
  keyTot.forEach((v, i) => Math.abs(v) > Math.abs(keyTot[bi]!) && (bi = i));
  if (m.seriesField === "@version" && m.series.length === 2) {
    const [a, b] = m.series;
    const diffs = m.keys.map((k, i) => ({ k, v: (b!.values[i] ?? 0) - (a!.values[i] ?? 0) })).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const title = `${b!.key} vs ${a!.key} par ${xs} : ${diffs.slice(0, 2).map((x) => `${x.k} ${f.sv(x.v)}`).join(", ")}`;
    comments.push(`${a!.key} : ${f.v(a!.total)} ; ${b!.key} : ${f.v(b!.total)} (${f.sv(b!.total - a!.total)}).`);
    return { title, comments, role: "revelation", facts };
  }
  const label = m.isDelta ? `Écart ${ctx.toLabel} vs ${ctx.fromLabel}` : f.Measure;
  const title = m.isDelta ? `${label} par ${xs} : ${m.keys[bi]} pèse le plus (${f.sv(keyTot[bi]!)})` : m.xIsTime ? `${label} par ${xs}` : `${m.keys[bi]} en tête : ${f.v(keyTot[bi]!)}`;
  if (m.seriesField === "@version" && m.series.length === 2) {
    const [a, b] = m.series;
    comments.push(`${a!.key} : ${f.v(a!.total)} ; ${b!.key} : ${f.v(b!.total)} (${f.sv(b!.total - a!.total)}).`);
  } else comments.push(`Total : ${f.v(tot.reduce((x, y) => x + y, 0))}${m.versionNote ? ` (${m.versionNote})` : ""}.`);
  return { title, comments, role: "revelation", facts };
}

function versionBreakdownStory(m: BreakdownModel, ctx: DrillCtx, f: Fmt): Omit<DrillStory, "scope" | "viewLabel" | "path" | "suggestion"> {
  const noun = nounOf(m.field);
  const comments: string[] = [];
  const s = m.standout != null ? m.stats[m.standout]! : null;
  if (!s || m.refTotal == null || m.delta == null) return { title: `${f.Measure} par ${noun.sg}`, comments: [], role: "revelation", facts: {} };
  const d = s.delta ?? 0;
  const r = s.ref ? d / Math.abs(s.ref) : 0;
  const others = m.stats.filter((x) => x !== s);
  const othersUp = others.every((x) => (x.delta ?? 0) >= 0);
  const othersDown = others.every((x) => (x.delta ?? 0) <= 0);
  const name = capitalize(le2(s.key));
  let title: string;
  if (d < 0 && othersUp && others.length) title = `${name} : ${f.sv(d)} (${pct(r)}), seul${noun.f ? "e" : ""} ${noun.sg} en recul au ${m.periodLabel}`;
  else if (d > 0 && othersDown && others.length) title = `${name} : ${f.sv(d)} (${pct(r)}), seul${noun.f ? "e" : ""} ${noun.sg} en hausse au ${m.periodLabel}`;
  else title = `${name} pèse le plus dans l'écart : ${f.sv(d)} (${pct(r)})`;
  comments.push(`${s.key} : ${f.v(s.ref ?? 0)} (${m.refLabel}) → ${f.v(s.value)} (${m.periodLabel}).`);
  // Ce qui explique l'écart de la catégorie : premier niveau de la cascade
  const lvl = levelsOf(ctx.spec, ctx.eff).find((x) => x !== m.field && !ctx.cats.some((c) => c.field === x));
  if (lvl && ctx.ver) {
    const by = new Map<string, number>();
    ctx.rows.forEach((row, i) => {
      if (String(row[m.field] ?? "") !== s.key) return;
      const k = String(row[lvl] ?? "");
      by.set(k, (by.get(k) ?? 0) + (ctx.ver![i] === 1 ? ctx.vs[i]! : -ctx.vs[i]!));
    });
    const top = [...by].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
    if (top.length) comments.push(`${s.key}, par ${nounOf(lvl).sg} : ${top.map(([k, v]) => `${k} ${f.sv(v)}`).join(", ")}.`);
  }
  if (others.length) comments.push(`${others.length === 1 ? `L'autre ${noun.sg}` : `Les ${others.length} autres ${noun.pl}`} : ${f.sv(others.reduce((a, x) => a + (x.delta ?? 0), 0))} au total (${others.slice(0, 4).map((x) => `${x.key} ${f.sv(x.delta ?? 0)}`).join(", ")}).`);
  return { title, comments: comments.slice(0, 3), role: "revelation", facts: { standout: s.key, delta: d } };
}
