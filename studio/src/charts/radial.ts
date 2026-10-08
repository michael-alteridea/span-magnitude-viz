/** Camembert, donut (centre évidé) et arcs radiaux — SVG pur via d3.arc / d3.pie. */
import { arc as d3arc, pie as d3pie, type PieArcDatum } from "d3";
import type { CatModel } from "../data/model";
import { valueFormatter, formatPercent } from "../format";
import { easeOut, stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure } from "./text";
import { rows as tipRows, shareRow, tip } from "./tip";

interface Slice {
  label: string;
  value: number;
  color: string;
  index: number;
}

export function slicesOf(model: CatModel, colors: string[]): Slice[] {
  return model.keys
    .map((_, k) => {
      let v = 0;
      for (const row of model.values) if (Number.isFinite(row[k]!)) v += row[k]!;
      return { label: model.labels[k]!, value: v, color: colors[k % colors.length]!, index: k };
    })
    .filter((s) => s.value > 0);
}

export function drawPie(root: G, rect: PlotRect, ctx: DrawCtx, model: CatModel, donut: boolean): void {
  const { theme, s, font, spec, frame } = ctx;
  const slices = slicesOf(model, ctx.colors);
  const total = slices.reduce((a, b) => a + b.value, 0);
  const fmt = valueFormatter(spec.axes.y);
  const outsideLabels = slices.length <= 12;
  const labelRoom = outsideLabels ? Math.min(rect.w * 0.26, 190 * s) : 0;
  const R = Math.max(20, Math.min(rect.w / 2 - labelRoom, rect.h / 2 - (outsideLabels ? 18 * s : 4 * s)));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const g = root.append("g").attr("transform", `translate(${cx},${cy})`);
  const inner = donut ? R * 0.62 : 0;
  const sweep = Math.PI * 2 * easeOut(frame.build);
  const pie = d3pie<Slice>()
    .value((d) => d.value)
    .sort(null)
    .startAngle(0)
    .endAngle(Math.max(0.0001, sweep))
    .padAngle(donut ? 0.012 : 0.004);
  const arcs = pie(slices);
  const arc = d3arc<PieArcDatum<Slice>>().innerRadius(inner).outerRadius(R).cornerRadius(donut ? 3 * s : 0);
  const gm = g.append("g").attr("class", "r4d-marks");
  for (const a of arcs) {
    gm.append("path")
      .attr("d", arc(a))
      .attr("fill", a.data.color)
      .attr("stroke", theme.bg)
      .attr("stroke-width", (donut ? 1.5 : 1.5) * s)
      .call((c) => tip(c, { t: a.data.label, v: fmt(a.data.value), rows: tipRows(shareRow(a.data.value, total)) }));
  }
  if (frame.build < 1) return finishCenter();

  // Pourcentages à l'intérieur des parts assez grandes
  const mid = d3arc<PieArcDatum<Slice>>().innerRadius(donut ? (inner + R) / 2 : R * 0.62).outerRadius(donut ? (inner + R) / 2 : R * 0.62);
  for (const a of arcs) {
    const ang = a.endAngle - a.startAngle;
    const share = a.data.value / total;
    const txt = formatPercent(share, share < 0.1 ? 1 : 0);
    const room = ang * (donut ? (inner + R) / 2 : R * 0.62);
    if (room < measure(txt, 13 * s, font, 700) + 6 * s || (donut && R - inner < 16 * s)) continue;
    const [x, y] = mid.centroid(a);
    g.append("text").attr("x", x).attr("y", y).attr("dy", "0.35em").attr("text-anchor", "middle").attr("font-size", 13 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", "#ffffff").text(txt);
  }

  // Étiquettes extérieures avec traits de rappel, relâchées verticalement
  if (outsideLabels) {
    const lab = arcs.map((a) => {
      const ang = (a.startAngle + a.endAngle) / 2;
      const side = Math.sin(ang) >= 0 ? 1 : -1;
      return { a, ang, side, y: -Math.cos(ang) * (R + 16 * s), x0: Math.sin(ang) * R, y0: -Math.cos(ang) * R };
    });
    const gap = 30 * s;
    const top = -rect.h / 2 + 14 * s;
    const bottom = rect.h / 2 - 18 * s;
    for (const side of [1, -1]) {
      const group = lab.filter((l) => l.side === side).sort((p, q) => p.y - q.y);
      for (const l of group) l.y = Math.max(top, Math.min(bottom, l.y));
      for (let i = 1; i < group.length; i++) if (group[i]!.y - group[i - 1]!.y < gap) group[i]!.y = group[i - 1]!.y + gap;
      const overflow = (group[group.length - 1]?.y ?? 0) - bottom;
      if (overflow > 0) {
        group[group.length - 1]!.y = bottom;
        for (let i = group.length - 2; i >= 0; i--) if (group[i + 1]!.y - group[i]!.y < gap) group[i]!.y = group[i + 1]!.y - gap;
      }
    }
    const gl = g.append("g").attr("class", "r4d-pie-labels");
    const maxW = rect.w / 2 - R - 30 * s;
    for (const l of lab) {
      const xe = l.side * (R + 18 * s);
      const xt = l.side * (R + 26 * s);
      gl.append("polyline")
        .attr("points", `${l.x0 * 1.02},${l.y0 * 1.02} ${xe},${l.y} ${xt - l.side * 3 * s},${l.y}`)
        .attr("fill", "none")
        .attr("stroke", theme.faint)
        .attr("stroke-width", 1 * s);
      const anchor = l.side > 0 ? "start" : "end";
      gl.append("text").attr("x", xt).attr("y", l.y - 2 * s).attr("text-anchor", anchor).attr("font-size", 13 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(ellipsize(l.a.data.label, Math.max(40 * s, maxW), 13 * s, font, 700));
      gl.append("text").attr("x", xt).attr("y", l.y + 13 * s).attr("text-anchor", anchor).attr("font-size", 12 * s).attr("font-family", font).attr("fill", theme.muted).text(`${fmt(l.a.data.value)} · ${formatPercent(l.a.data.value / total, 0)}`);
    }
  }
  finishCenter();

  function finishCenter() {
    if (!donut) return;
    const big = Math.min(inner * 0.42, 44 * s);
    g.append("text").attr("y", -big * 0.1).attr("text-anchor", "middle").attr("font-size", big).attr("font-weight", 700).attr("font-family", font).attr("fill", theme.text).text(fmt(total * easeOut(frame.build)));
    g.append("text").attr("y", big * 0.65).attr("text-anchor", "middle").attr("font-size", Math.max(11 * s, big * 0.32)).attr("font-family", font).attr("fill", theme.muted).text(ellipsize(`Total · ${model.yName}`, inner * 1.6, Math.max(11 * s, big * 0.32), font));
  }
}

/** Arcs radiaux : un anneau concentrique par catégorie, longueur d'arc ∝ valeur (max 270°). */
export function drawRadialBars(root: G, rect: PlotRect, ctx: DrawCtx, model: CatModel): void {
  const { theme, s, font, spec, frame, prep } = ctx;
  const slices = slicesOf(model, ctx.colors).slice(0, 16);
  const fmt = valueFormatter(spec.axes.y);
  const R = Math.max(30, Math.min(rect.w / 2, rect.h / 2) - 6 * s);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const g = root.append("g").attr("class", "r4d-marks r4d-radial").attr("transform", `translate(${cx},${cy})`);
  const n = slices.length;
  if (!n) return;
  const r0 = R * 0.24;
  const ring = (R - r0) / n;
  const thick = ring * 0.72;
  const domMax = spec.axes.y.max ?? prep.domains.y?.[1] ?? Math.max(...slices.map((d) => d.value));
  const maxAngle = (Math.PI * 3) / 2;
  const arc = d3arc().cornerRadius(thick / 2);
  const track = d3arc();
  slices.forEach((d, i) => {
    const outer = R - i * ring;
    const innerR = outer - thick;
    g.append("path")
      .attr("d", track({ innerRadius: innerR, outerRadius: outer, startAngle: 0, endAngle: maxAngle }) ?? "")
      .attr("fill", theme.track);
    const f = stagger(frame.build, i, n, 0.5);
    const ang = Math.max(0.0001, Math.min(1, d.value / (domMax || 1)) * maxAngle * f);
    g.append("path")
      .attr("class", "r4d-mark")
      .attr("d", arc({ innerRadius: innerR, outerRadius: outer, startAngle: 0, endAngle: ang }) ?? "")
      .attr("fill", d.color)
      .call((c) => tip(c, { t: d.label, v: fmt(d.value), rows: tipRows(shareRow(d.value, slices.reduce((a, b) => a + Math.max(0, b.value), 0)), Number.isFinite(domMax) && domMax > 0 ? { k: "Part du maximum de l'échelle", v: formatPercent(d.value / domMax, 0) } : null) }));
    const fsz = Math.min(14 * s, thick * 0.62);
    const ly = -(outer - thick / 2);
    const vtxt = fmt(d.value);
    const vw = measure(vtxt, fsz, font, 700);
    const t = g
      .append("text")
      .attr("x", -10 * s)
      .attr("y", ly)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("font-size", fsz)
      .attr("font-family", font)
      .attr("fill", theme.text);
    t.append("tspan").text(ellipsize(d.label, Math.max(50 * s, R * 0.95 - vw - 12 * s), fsz, font) + "  ");
    t.append("tspan").attr("font-weight", 700).attr("fill", theme.text).text(vtxt);
  });
}
