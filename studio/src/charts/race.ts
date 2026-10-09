/**
 * Course de barres (« bar chart race ») : une barre horizontale par catégorie, classées à chaque période du
 * champ temporel. Entre deux périodes, valeurs et rangs sont interpolés (reclassement fluide) ; le compteur
 * de période s'affiche en grand en bas à droite. Le rendu ne dépend que de la position (en pas) : la même
 * image est produite en aperçu, en vidéo WebM et en GIF.
 */
import { scaleLinear } from "d3";
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import { buildModel, weightsAt, type CatModel, type TimeModel, type WRow } from "../data/model";
import { valueFormatter } from "../format";
import { clamp01, easeOut, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure } from "./text";
import { elemKey, labelLook, markColor, selAttrs } from "./overrides";
import { tip } from "./tip";

export interface RaceData {
  keys: string[];
  /** values[pas][clé] — valeur reportée de la dernière période connue quand une période manque (0 au départ). */
  values: number[][];
  /** ranks[pas][clé] — 0 = premier. */
  ranks: number[][];
  /** Maximum de chaque pas. */
  maxes: number[];
}

export const RACE_DEFAULT_N = 10;
export const RACE_MAX_N = 20;

/** Encodage aplati (une seule mesure, sans série ni top N) utilisé pour calculer les valeurs par période. */
export function raceFlatSpec(spec: ChartSpec): ChartSpec {
  return { ...spec, type: "barH", encoding: { ...spec.encoding, series: null, y: spec.encoding.y.slice(0, 1), y2: null, topN: null }, style: { ...spec.style, sort: "none" } } as ChartSpec;
}

/** Valeurs et rangs de chaque catégorie à chaque période (« instantané » ou « cumulatif » selon `mode.fourD.mode`). */
export function buildRace(spec: ChartSpec, ds: Dataset, tm: TimeModel, full: CatModel): RaceData {
  const flat = raceFlatSpec(spec);
  const keys = full.labels.slice();
  const n = tm.steps.length;
  const values: number[][] = [];
  const last = keys.map(() => 0);
  for (let i = 0; i < n; i++) {
    const rows: WRow[] = spec.mode.fourD.mode === "cumulative" ? weightsAt(ds, tm, i, "cumulative") : ds.rows.flatMap((row, r) => (tm.rowStep[r] === i ? [{ row, w: 1 }] : []));
    const m = buildModel(flat, ds, rows, { fixedKeys: full.keys, fixedSeries: full.series }) as CatModel;
    const v = m.values[0] ?? [];
    const out = keys.map((_, k) => {
      const x = v[k];
      if (x != null && Number.isFinite(x)) last[k] = x;
      return last[k]!;
    });
    values.push(out);
  }
  const ranks = values.map((vals) => {
    const order = vals.map((_, k) => k).sort((a, b) => vals[b]! - vals[a]! || a - b);
    const r = new Array<number>(vals.length);
    order.forEach((k, i) => (r[k] = i));
    return r;
  });
  const maxes = values.map((v) => Math.max(0, ...v));
  return { keys, values, ranks, maxes };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** État interpolé à la position `pos` (en pas, continue). Exporté pour les tests. */
export function raceStateAt(rd: RaceData, pos: number): { value: number[]; rank: number[]; max: number; step: number } {
  const S = rd.values.length;
  const p = Math.max(0, Math.min(S - 1, pos));
  const i0 = Math.floor(p);
  const i1 = Math.min(S - 1, i0 + 1);
  const f = p - i0;
  const e = easeInOut(f);
  const value = rd.keys.map((_, k) => rd.values[i0]![k]! + (rd.values[i1]![k]! - rd.values[i0]![k]!) * f);
  const rank = rd.keys.map((_, k) => rd.ranks[i0]![k]! + (rd.ranks[i1]![k]! - rd.ranks[i0]![k]!) * e);
  const max = rd.maxes[i0]! + (rd.maxes[i1]! - rd.maxes[i0]!) * f;
  return { value, rank, max, step: Math.round(p) };
}

export function drawRace(g: G, plot: PlotRect, ctx: DrawCtx, rd: RaceData, tm: TimeModel, pos: number): void {
  const { spec, theme, colors, font, s, frame } = ctx;
  const S = rd.values.length;
  const st = raceStateAt(rd, pos);
  const N = Math.max(1, Math.min(spec.encoding.topN ?? RACE_DEFAULT_N, RACE_MAX_N, rd.keys.length));
  const build = easeOut(frame.build);
  const fmt = valueFormatter(spec.axes.y);
  const fs = 13 * s;
  const gr = g.append("g").attr("class", "r4d-race");

  // compteur de période (grand, bas droite) + avancement
  const counter = tm.label(st.step);
  const big = Math.min(plot.h * 0.2, 96 * s);
  const cw = measure(counter, big, font, 800);
  const cx = plot.x + plot.w - 6 * s;
  const cy = plot.y + plot.h - 14 * s;
  gr.append("text").attr("class", "r4d-race-period").attr("data-testid", "race-period").attr("x", cx).attr("y", cy).attr("text-anchor", "end").attr("font-size", big).attr("font-weight", 800).attr("letter-spacing", -1.5 * s).attr("fill", theme.text).attr("fill-opacity", 0.22).text(counter);
  const tw = Math.max(cw, 80 * s);
  gr.append("rect").attr("class", "r4d-race-track").attr("x", cx - tw).attr("y", cy + 7 * s).attr("width", tw).attr("height", 3 * s).attr("rx", 1.5 * s).attr("fill", theme.track);
  gr.append("rect").attr("class", "r4d-race-progress").attr("x", cx - tw).attr("y", cy + 7 * s).attr("width", tw * (S > 1 ? Math.max(0, Math.min(1, pos / (S - 1))) : 1)).attr("height", 3 * s).attr("rx", 1.5 * s).attr("fill", theme.accent);

  // axe des valeurs en haut, barres en dessous
  const axisH = 24 * s;
  const top = plot.y + axisH;
  const band = (plot.h - axisH) / N;
  const bh = Math.min(band * 0.76, 46 * s);
  const visible = rd.keys.map((_, k) => k).filter((k) => st.rank[k]! < N + 0.5);
  const nameFs = Math.min(fs, Math.max(9 * s, band * 0.5));
  const nameW = Math.min(plot.w * 0.28, Math.max(40 * s, ...visible.map((k) => measure(rd.keys[k]!, nameFs, font, 600))) + 10 * s);
  const valW = Math.max(...visible.map((k) => measure(fmt(st.value[k]!), nameFs, font, 600)), 30 * s) + 14 * s;
  const x0 = plot.x + nameW;
  const sc = scaleLinear().domain([0, Math.max(st.max, 1e-9)]).range([x0, plot.x + plot.w - valW]);
  const ticks = sc.ticks(Math.max(2, Math.round((plot.w - nameW) / (140 * s))));
  const tf = valueFormatter(spec.axes.y, ticks.length > 1 ? ticks[1]! - ticks[0]! : undefined);
  const ga = gr.append("g").attr("class", "r4d-race-axis");
  for (const t of ticks) {
    const x = sc(t);
    ga.append("line").attr("x1", x).attr("x2", x).attr("y1", top - 4 * s).attr("y2", plot.y + plot.h).attr("stroke", theme.grid).attr("stroke-width", 1 * s);
    ga.append("text").attr("x", x).attr("y", top - 9 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("fill", theme.faint).text(tf(t));
  }

  const gb = gr.append("g").attr("class", "r4d-race-bars");
  // les barres qui montent passent devant
  visible.sort((a, b) => st.rank[b]! - st.rank[a]!);
  for (const k of visible) {
    const name = rd.keys[k]!;
    const r = st.rank[k]!;
    const op = clamp01(N + 0.5 - r);
    if (op <= 0) continue;
    const y = top + r * band + (band - bh) / 2;
    const v = st.value[k]!;
    const ek = elemKey(name);
    const color = markColor(spec, colors[k % colors.length]!, ek, null);
    const w = Math.max(0, (sc(Math.max(0, v)) - x0) * build);
    const row = gb.append("g").attr("class", "r4d-race-row").attr("opacity", op).attr("data-key", name);
    const rect = row.append("rect").attr("class", "r4d-bar r4d-race-bar").attr("x", x0).attr("y", y).attr("width", w).attr("height", bh).attr("rx", Math.min(3 * s, bh / 4)).attr("fill", color);
    selAttrs(rect, "mark", ek, null, name, fmt(v));
    tip(rect, { t: name, sub: tm.label(st.step), v: fmt(v) });
    row.append("text").attr("class", "r4d-race-name").attr("x", x0 - 8 * s).attr("y", y + bh / 2).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", nameFs).attr("font-weight", 600).attr("fill", theme.text).text(ellipsize(name, nameW - 12 * s, nameFs, font, 600));
    const look = labelLook(spec, fmt(v), ek, null);
    if (!look.hidden) {
      const lab = row.append("text").attr("class", "r4d-value-label r4d-race-value").attr("x", x0 + w + 6 * s).attr("y", y + bh / 2).attr("dy", "0.35em").attr("font-size", look.size ? look.size * s : nameFs).attr("font-weight", look.bold === false ? 400 : 600).attr("fill", look.color ?? theme.muted).text(look.text);
      selAttrs(lab, "label", ek, null, name, fmt(v));
    }
  }
}
