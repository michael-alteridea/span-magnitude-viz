/** Camembert, donut (centre évidé) et arcs radiaux — SVG pur via d3.arc / d3.pie. */
import { arc as d3arc, pie as d3pie, type PieArcDatum } from "d3";
import type { CatModel } from "../data/model";
import { valueFormatter, formatPercent } from "../format";
import { easeOut, stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure } from "./text";
import { rows as tipRows, shareRow, tip } from "./tip";
import { drawCallout, easeInOut, focusGrey, focusProgress, makeCallout, mixHex, overlap, placeCallout, resolveFocus, type Rect } from "./focus";
import { focusTexts } from "./barDeco";

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
  const R0 = Math.max(20, Math.min(rect.w / 2 - labelRoom, rect.h / 2 - (outsideLabels ? 18 * s : 4 * s)));
  // ---- mise en avant (étape L) : la part se détache, les autres passent en gris, bulle reliée sur le côté
  const fk = resolveFocus(spec.style.focus.key, slices.map((d) => d.label), slices.map((d) => d.value));
  const ft = fk != null ? easeInOut(focusProgress(frame)) : 0;
  const grey = focusGrey(theme);
  let R = R0;
  let cx = rect.x + rect.w / 2;
  let cy = rect.y + rect.h / 2;
  // zone verticale des étiquettes (réduite quand la bulle passe sous / au-dessus du graphique)
  let areaTop = rect.y;
  let areaH = rect.h;
  // format portrait (Reel 9:16, téléphone) : bulle pleine largeur sous ou au-dessus du graphique
  let stack = false;
  let stackBelow = true;
  let call: ReturnType<typeof makeCallout> | null = null;
  let side = 1;
  let callX = 0;
  let midA = 0;
  if (fk != null) {
    const sl = slices[fk]!;
    const tx = focusTexts(sl.label, sl.value, slices.map((d) => d.value), fk, fmt, spec.style.focus, true);
    // côté de la part (angle médian, sens horaire depuis midi)
    let acc = 0;
    for (let k = 0; k < fk; k++) acc += slices[k]!.value;
    midA = ((acc + sl.value / 2) / (total || 1)) * Math.PI * 2;
    side = Math.sin(midA) >= 0 ? 1 : -1;
    // bulle à côté (paysage) ou dessous / dessus (portrait, textes agrandis du Reel) : la disposition qui garde le plus grand rayon
    const beside = makeCallout(tx, s, font, Math.min(rect.w * 0.3, 300 * s));
    const below = makeCallout(tx, s, font, Math.min(rect.w * 0.9, 460 * s));
    const vPad = outsideLabels ? 18 * s : 4 * s;
    const rBeside = Math.min(R0, (rect.w - 2 * labelRoom - beside.w - 24 * s) / 2);
    const rBelow = Math.min(R0, (rect.h - below.h - 20 * s) / 2 - vPad);
    stack = rect.h > rect.w * 1.15 || rBelow > rBeside * 1.2;
    call = stack ? below : beside;
  }
  if (fk != null && call && stack) {
    stackBelow = Math.cos(midA) <= 0;
    const gap = 20 * s;
    const avail = rect.h - call.h - gap;
    const R1 = Math.max(20, Math.min(R0, avail / 2 - (outsideLabels ? 18 * s : 4 * s)));
    const top1 = stackBelow ? rect.y : rect.y + call.h + gap;
    R = R0 + (R1 - R0) * ft;
    cy = cy + (top1 + avail / 2 - cy) * ft;
    areaTop = rect.y + (top1 - rect.y) * ft;
    areaH = rect.h + (avail - rect.h) * ft;
  } else if (fk != null && call) {
    const gap = 24 * s;
    const R1 = Math.max(20, Math.min(R0, (rect.w - 2 * labelRoom - call.w - gap) / 2));
    const groupW = 2 * R1 + 2 * labelRoom + call.w + gap;
    const x0 = rect.x + Math.max(0, (rect.w - groupW) / 2);
    const cx1 = side > 0 ? x0 + labelRoom + R1 : x0 + call.w + gap + labelRoom + R1;
    callX = side > 0 ? x0 + groupW - call.w : x0;
    R = R0 + (R1 - R0) * ft;
    cx = cx + (cx1 - cx) * ft;
  }
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
  const pull = (a: PieArcDatum<Slice>) => {
    if (fk == null || a.data.index !== slices[fk]!.index) return { x: 0, y: 0 };
    const m = (a.startAngle + a.endAngle) / 2;
    const d = Math.min(R * 0.08, 16 * s) * ft;
    return { x: Math.sin(m) * d, y: -Math.cos(m) * d };
  };
  const isF = (a: PieArcDatum<Slice>) => fk != null && a.data.index === slices[fk]!.index;
  const gm = g.append("g").attr("class", "r4d-marks");
  for (const a of arcs) {
    const off = pull(a);
    const path = gm
      .append("path")
      .attr("d", arc(a))
      .attr("fill", fk == null || isF(a) ? a.data.color : mixHex(a.data.color, grey, ft))
      .attr("stroke", theme.bg)
      .attr("stroke-width", (donut ? 1.5 : 1.5) * s)
      .attr("data-focus-key", a.data.label)
      .attr("data-slice", `${(a.startAngle * 180) / Math.PI} ${(a.endAngle * 180) / Math.PI} ${inner} ${R}`)
      .call((c) => tip(c, { t: a.data.label, v: fmt(a.data.value), rows: tipRows(shareRow(a.data.value, total)) }));
    if (off.x || off.y) path.attr("transform", `translate(${off.x.toFixed(2)},${off.y.toFixed(2)})`);
    if (isF(a)) path.attr("class", "r4d-focus-slice");
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
    const off = pull(a);
    const dim = fk != null && !isF(a) && ft > 0.5;
    g.append("text").attr("x", x + off.x).attr("y", y + off.y).attr("dy", "0.35em").attr("text-anchor", "middle").attr("font-size", 13 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", dim ? (theme.dark ? "#e4e4e7" : "#3f3f46") : "#ffffff").text(txt);
  }

  // Étiquettes extérieures avec traits de rappel, relâchées verticalement
  let focusLabelEnd: { x: number; y: number } | null = null;
  const labelBoxes: Rect[] = [];
  if (outsideLabels) {
    const lab = arcs.map((a) => {
      const ang = (a.startAngle + a.endAngle) / 2;
      const side = Math.sin(ang) >= 0 ? 1 : -1;
      return { a, ang, side, y: -Math.cos(ang) * (R + 16 * s), x0: Math.sin(ang) * R, y0: -Math.cos(ang) * R };
    });
    const gap = 30 * s;
    const top = areaTop - cy + 14 * s;
    const bottom = areaTop + areaH - cy - 18 * s;
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
    // mise en avant : la bulle occupe l'espace au-delà de la colonne d'étiquettes
    const maxW = Math.max(40 * s, fk == null || stack ? rect.w / 2 - R - 30 * s : Math.min(labelRoom - 30 * s, rect.w / 2 - R - 30 * s));
    for (const l of lab) {
      const f = isF(l.a);
      const off = pull(l.a);
      const xe = l.side * (R + 18 * s);
      const xt = l.side * (R + 26 * s);
      gl.append("polyline")
        .attr("points", `${l.x0 * 1.02 + off.x},${l.y0 * 1.02 + off.y} ${xe},${l.y} ${xt - l.side * 3 * s},${l.y}`)
        .attr("fill", "none")
        .attr("stroke", theme.faint)
        .attr("stroke-width", 1 * s);
      const anchor = l.side > 0 ? "start" : "end";
      const name = ellipsize(l.a.data.label, maxW, 13 * s, font, 700);
      const sub = `${fmt(l.a.data.value)} · ${formatPercent(l.a.data.value / total, 0)}`;
      gl.append("text").attr("x", xt).attr("y", l.y - 2 * s).attr("text-anchor", anchor).attr("font-size", 13 * s).attr("font-weight", 700).attr("font-family", font).attr("fill", fk != null && !f && ft > 0.5 ? theme.muted : theme.text).text(name);
      gl.append("text").attr("x", xt).attr("y", l.y + 13 * s).attr("text-anchor", anchor).attr("font-size", 12 * s).attr("font-family", font).attr("fill", theme.muted).text(sub);
      const lw = Math.max(measure(name, 13 * s, font, 700), measure(sub, 12 * s, font));
      labelBoxes.push({ x: cx + (l.side > 0 ? xt : xt - lw), y: cy + l.y - 16 * s, w: lw, h: 34 * s });
      if (f) focusLabelEnd = { x: cx + xt + l.side * (lw + 8 * s), y: cy + l.y + 4 * s };
    }
  }
  finishCenter();

  // ---- bulle de la part mise en avant
  if (fk != null && call && ft > 0) {
    const a = arcs.find((x) => isF(x));
    if (a) {
      const m = (a.startAngle + a.endAngle) / 2;
      const off = pull(a);
      const edge = { x: cx + Math.sin(m) * R + off.x, y: cy - Math.cos(m) * R + off.y };
      const to = stack ? edge : (focusLabelEnd ?? edge);
      const fits = side > 0 ? callX + call.w <= rect.x + rect.w + 1 : callX >= rect.x - 1;
      let box: Rect;
      if (stack) box = { x: rect.x + (rect.w - call.w) / 2, y: stackBelow ? rect.y + rect.h - call.h : rect.y, w: call.w, h: call.h };
      else if (fits && 2 * R >= R0) box = { x: callX, y: Math.max(rect.y, Math.min(rect.y + rect.h - call.h, to.y - call.h / 2)), w: call.w, h: call.h };
      else box = placeCallout(call, { x: edge.x - 4 * s, y: edge.y - 4 * s, w: 8 * s, h: 8 * s }, rect, [{ x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, ...labelBoxes], 24 * s);
      drawCallout(root, call, box, to, { theme, s, font }, ft);
    }
  }

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
  const R0 = Math.max(30, Math.min(rect.w / 2, rect.h / 2) - 6 * s);
  const cy = rect.y + rect.h / 2;
  const n = slices.length;
  if (!n) return;
  // mise en avant : l'arc choisi reste en couleur ; le disque se décale pour laisser la place à la bulle
  const fk = resolveFocus(spec.style.focus.key, slices.map((d) => d.label), slices.map((d) => d.value));
  const ft = fk != null ? easeInOut(focusProgress(frame)) : 0;
  const grey = focusGrey(theme);
  const call = fk != null ? makeCallout(focusTexts(slices[fk]!.label, slices[fk]!.value, slices.map((d) => d.value), fk, fmt, spec.style.focus, true), s, font, Math.min(rect.w * 0.34, 280 * s)) : null;
  let R = R0;
  let cx = rect.x + rect.w / 2;
  if (call) {
    const need = 2 * R0 + call.w + 30 * s;
    const R1 = need > rect.w ? Math.max(30, (rect.w - call.w - 30 * s) / 2) : R0;
    const cx1 = need > rect.w ? rect.x + R1 + 4 * s : rect.x + (rect.w - (2 * R1 + call.w + 30 * s)) / 2 + R1;
    R = R0 + (R1 - R0) * ft;
    cx = cx + (cx1 - cx) * ft;
  }
  const g = root.append("g").attr("class", "r4d-marks r4d-radial").attr("transform", `translate(${cx},${cy})`);
  const r0 = R * 0.24;
  const ring = (R - r0) / n;
  const thick = ring * 0.72;
  const domMax = spec.axes.y.max ?? prep.domains.y?.[1] ?? Math.max(...slices.map((d) => d.value));
  const maxAngle = (Math.PI * 3) / 2;
  const arc = d3arc().cornerRadius(thick / 2);
  const track = d3arc();
  const tipPts: { k: number; x: number; y: number; r: number; a: number }[] = [];
  const labelObs: Rect[] = [];
  slices.forEach((d, i) => {
    const outer = R - i * ring;
    const innerR = outer - thick;
    g.append("path")
      .attr("d", track({ innerRadius: innerR, outerRadius: outer, startAngle: 0, endAngle: maxAngle }) ?? "")
      .attr("fill", theme.track);
    const f = stagger(frame.build, i, n, 0.5);
    const ang = Math.max(0.0001, Math.min(1, d.value / (domMax || 1)) * maxAngle * f);
    const color = fk == null || i === fk ? d.color : mixHex(d.color, grey, ft);
    const path = g
      .append("path")
      .attr("class", i === fk ? "r4d-mark r4d-focus-arc" : "r4d-mark")
      .attr("d", arc({ innerRadius: innerR, outerRadius: outer, startAngle: 0, endAngle: ang }) ?? "")
      .attr("fill", color)
      .attr("data-focus-key", d.label)
      .attr("data-slice", `0 ${((ang * 180) / Math.PI).toFixed(3)} ${innerR} ${outer}`)
      .call((c) => tip(c, { t: d.label, v: fmt(d.value), rows: tipRows(shareRow(d.value, slices.reduce((a, b) => a + Math.max(0, b.value), 0)), Number.isFinite(domMax) && domMax > 0 ? { k: "Part du maximum de l'échelle", v: formatPercent(d.value / domMax, 0) } : null) }));
    const tipA = ang;
    tipPts.push({ k: i, x: Math.sin(tipA) * ((innerR + outer) / 2), y: -Math.cos(tipA) * ((innerR + outer) / 2), r: (outer - innerR) / 2, a: tipA });
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
      .attr("fill", fk != null && i !== fk && ft > 0.5 ? theme.muted : theme.text);
    const ltxt = ellipsize(d.label, Math.max(50 * s, R * 0.95 - vw - 12 * s), fsz, font) + "  ";
    const lw = measure(ltxt, fsz, font) + vw;
    labelObs.push({ x: cx - 10 * s - lw, y: cy + ly - fsz * 0.7, w: lw, h: fsz * 1.4 });
    t.append("tspan").text(ltxt);
    t.append("tspan").attr("font-weight", 700).attr("fill", fk != null && i !== fk && ft > 0.5 ? theme.muted : theme.text).text(vtxt);
  });
  if (fk == null || !call || ft <= 0) return;
  const tp = tipPts.find((p) => p.k === fk)!;
  const tipAbs = { x: cx + tp.x, y: cy + tp.y };
  // bulle hors du disque et des libellés ; si l'extrémité de l'arc est trop à l'étroit, la bulle vise l'arc à 3 h
  const obs: Rect[] = [{ x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }, ...labelObs];
  const tryAt = (pt: { x: number; y: number }) => {
    const b = placeCallout(call, { x: pt.x - tp.r, y: pt.y - tp.r, w: 2 * tp.r, h: 2 * tp.r }, rect, obs, 20 * s);
    return { b, pt, pen: obs.reduce((a, o) => a + overlap(b, o), 0) };
  };
  let best = tryAt(tipAbs);
  if (best.pen > 0 && tp.a > Math.PI / 2) {
    const alt = tryAt({ x: cx + Math.hypot(tp.x, tp.y), y: cy });
    if (alt.pen < best.pen) best = alt;
  }
  drawCallout(root, call, best.b, best.pt, { theme, s, font }, ft);
}
