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
  type BreakdownModel,
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
  return !!ctx.measure && /montant|amount|€|eur|chiffre|\bca\b|revenu|pipeline|vente|budget|co[uû]t/i.test(ctx.measure.name + " " + ctx.spec.label);
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
  return {
    v: (x) => (ctx.measure ? (money ? formatAmount(x) : formatNumber(x, Math.abs(x) >= 100 ? 0 : 1)) : formatInt(x)),
    sv: (x) => (ctx.measure ? (money ? formatSignedAmount(x) : (x > 0 ? "+" : x < 0 ? MINUS : "") + formatNumber(Math.abs(x), 1)) : (x > 0 ? "+" : x < 0 ? MINUS : "") + formatInt(Math.abs(x))),
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
    default:
      core = breakdownStory(model, ctx, f, ctx.eff);
  }
  const viewLabel = VIEW_LABEL(d, model, byNoun);
  const path = drillPathLabels(d);
  const unit = isMoney(ctx) ? " en €" : "";
  const where = path.length > 1 ? path.slice(1).join(" › ") : spanLabel(ctx);
  const scope = `${f.Measure}${unit} · ${where} · ${viewLabel}`;
  return { ...core, title: core.title.replace(/\s+/g, " ").trim(), scope, viewLabel, path, suggestion: suggest(model, ctx, d, ds) };
}

/** Piste suivante (bouton « Suggestion » de la barre d'exploration et scénario démo). */
function suggest(m: DrillModel, ctx: DrillCtx, d: DrillSpec, ds: Dataset): DrillSuggestion | null {
  const region = guessRegionField(ctx.eff);
  const person = guessPersonField(ctx.eff);
  const usedCats = new Set(ctx.cats.map((c) => c.field));
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
