/**
 * Rendu du « mode norme » (notation inspirée d'IBCS® / de la notation ISO 24896) :
 *  - motif hachuré SVG (prévision) ;
 *  - colonnes / barres de scénarios superposées : N-1 gris derrière (décalé), budget en contour (décalé),
 *    réel plein devant — la prévision hachurée prend la place du réel quand il n'y en a pas ;
 *  - bandeau d'écarts : barres ΔPL / ΔPY absolues ou épingles relatives (aiguille + point), rouge / vert
 *    réservés aux écarts (groupe `.r4d-variance`).
 * Temps → colonnes (écarts au-dessus), structure → barres horizontales (écarts à droite).
 */
import { scaleBand, scaleLinear, type Selection } from "d3";
import { VARIANCE_POS } from "../theme";
import type { CatModel } from "../data/model";
import { deltaLabel, normeInk, normeDeltaFormatter, normeFormatter, scenarioOf, scenarioStyle, SCENARIO_NAMES, varianceColor, varianceOf, type ScenarioCode } from "../norme";
import { formatSignedPct } from "../story/fr";
import { stagger, type DrawCtx, type G, type PlotRect } from "./context";
import { ellipsize, measure } from "./text";

let hatchSeq = 0;

/** Motif hachuré (diagonales à 45°) ; renvoie `url(#id)`. */
export function hatchPattern(parent: G, color: string, s: number, cls = "r4d-hatch"): string {
  const id = `r4d-hatch-${++hatchSeq}-${Math.random().toString(36).slice(2, 6)}`;
  const p = parent
    .append("defs")
    .append("pattern")
    .attr("id", id)
    .attr("class", cls)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6 * s)
    .attr("height", 6 * s)
    .attr("patternTransform", "rotate(45)");
  p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6 * s).attr("stroke", color).attr("stroke-width", 2.1 * s);
  return `url(#${id})`;
}

export function normeActive(ctx: Pick<DrawCtx, "spec">): boolean {
  return !!ctx.spec.norme?.enabled;
}

/** Codes de scénario des séries d'un modèle (null = pas un scénario). */
export function seriesScenarios(ctx: Pick<DrawCtx, "spec">, model: Pick<CatModel, "series">): (ScenarioCode | null)[] {
  return model.series.map((n) => scenarioOf(n, ctx.spec.encoding.scenarios));
}

/** Les séries forment-elles un jeu de scénarios superposables (réel ou prévision + au moins une autre) ? */
export function canOverlapScenarios(codes: (ScenarioCode | null)[]): boolean {
  if (codes.length < 2 || codes.some((c) => !c)) return false;
  if (new Set(codes).size !== codes.length) return false;
  return codes.includes("AC") || codes.includes("FC");
}

interface Row {
  label: string;
  main: number;
  mainCode: ScenarioCode | null;
  py: number;
  pl: number;
  ref: number;
}

export function drawScenarioBars(root: G, rect: PlotRect, ctx: DrawCtx, model: CatModel, codes: (ScenarioCode | null)[]): void {
  const { spec, theme, s, font, frame } = ctx;
  const horizontal = spec.type === "barH" || (spec.style.horizontal && spec.type !== "bar");
  const at = (c: ScenarioCode) => codes.indexOf(c);
  const iAC = at("AC");
  const iFC = at("FC");
  const iPL = at("PL");
  const iPY = at("PY");
  const val = (si: number, k: number) => (si >= 0 ? model.values[si]![k]! : NaN);
  const refCode: ScenarioCode | null = iPL >= 0 ? "PL" : iPY >= 0 ? "PY" : null;
  const rows: Row[] = model.keys.map((_, k) => {
    const a = val(iAC, k);
    const f = val(iFC, k);
    const main = Number.isFinite(a) ? a : f;
    const mainCode: ScenarioCode | null = Number.isFinite(a) ? "AC" : Number.isFinite(f) ? "FC" : null;
    const pl = val(iPL, k);
    const py = val(iPY, k);
    return { label: model.labels[k]!, main, mainCode, pl, py, ref: refCode === "PL" ? pl : refCode === "PY" ? py : NaN };
  });
  // Même année partout (« janv. 2026 » … « déc. 2026 ») : l'année est dans le sous-titre, libellés courts
  const years = new Set(rows.map((r) => /\s(\d{4})$/.exec(r.label)?.[1] ?? "?"));
  if (rows.length > 1 && years.size === 1 && !years.has("?")) for (const r of rows) r.label = r.label.replace(/\s\d{4}$/, "");
  const n = rows.length;
  const fmt = normeFormatter(spec.axes.y);
  const fmtD = normeDeltaFormatter(spec.axes.y);
  const rel = spec.variance.show === "rel";
  const pol = spec.variance.polarity;
  const fs = 12.5 * s;
  const ink = normeInk(theme).ac;
  const g = root.append("g").attr("class", "r4d-norme r4d-marks");
  const hatchUrl = iFC >= 0 ? hatchPattern(g, ink, s) : "";
  const styleOf = (c: ScenarioCode) => scenarioStyle(c, theme, hatchUrl);
  const all = rows.flatMap((r) => [r.main, r.pl, r.py]).filter(Number.isFinite);
  const vmax = Math.max(1e-9, ...all, ctx.sharedMax ?? 0);
  const vmin = Math.min(0, ...all);
  const dv = rows.map((r) => (Number.isFinite(r.main) && Number.isFinite(r.ref) ? varianceOf(r.main, r.ref) : null));
  const hasVar = !!refCode && dv.some((d) => d && Number.isFinite(rel ? d.rel : d.delta));
  const dvals = dv.map((d) => (d ? (rel ? d.rel * 100 : d.delta) : NaN));
  const dmax = Math.max(1e-9, ...dvals.filter(Number.isFinite).map(Math.abs));
  const dlo = dvals.some((v) => v < 0) ? -dmax : 0;
  const dhi = dvals.some((v) => v > 0) ? dmax : 0;
  const gv = root.append("g").attr("class", "r4d-variance r4d-marks");
  const varHatch = (col: string) => hatchPattern(gv, col, s, "r4d-hatch r4d-hatch-var");
  const varHatchUrl = new Map<string, string>();
  const varFill = (col: string, fc: boolean) => {
    if (!fc) return col;
    if (!varHatchUrl.has(col)) varHatchUrl.set(col, varHatch(col));
    return varHatchUrl.get(col)!;
  };
  const showLabels = n <= 16;
  const dHead = rel ? `${deltaLabel(refCode)} %` : deltaLabel(refCode);
  const head = (x: number, y: number, t: string, anchor = "start") =>
    g.append("text").attr("class", "r4d-variance-head").attr("x", x).attr("y", y).attr("text-anchor", anchor).attr("font-size", 12 * s).attr("font-weight", 700).attr("fill", theme.muted).attr("letter-spacing", 0.4 * s).text(t);

  const mark = (sel: Selection<SVGRectElement, unknown, null, undefined>, code: ScenarioCode, label: string, v: number) => {
    const st = styleOf(code);
    sel
      .attr("class", `r4d-scn r4d-scn-${code}`)
      .attr("data-scenario", code)
      .attr("fill", st.fill)
      .attr("stroke", st.stroke)
      .attr("stroke-width", st.stroke === "none" ? 0 : 1.5 * s)
      .append("title")
      .text(`${label} · ${SCENARIO_NAMES[code]} (${code}) : ${fmt(v)}`);
  };

  if (!horizontal) {
    /* ---------------- colonnes (temps) : écarts au-dessus, valeurs dessous */
    const leftW = 70 * s;
    const x = scaleBand<number>().domain(rows.map((_, i) => i)).range([rect.x + leftW, rect.x + rect.w]).paddingInner(0.26).paddingOuter(0.08);
    const labH = fs + 16 * s;
    const topH = hasVar ? (rect.h - labH) * 0.32 : 0;
    const gapH = hasVar ? 18 * s : 0;
    const botY = rect.y + topH + gapH;
    const botH = rect.h - topH - gapH - labH;
    const yV = scaleLinear().domain([vmin, vmax]).range([botY + botH, botY + 20 * s]);
    const z0 = yV(0);
    g.append("line").attr("x1", rect.x + leftW).attr("x2", rect.x + rect.w).attr("y1", z0).attr("y2", z0).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
    const bw = x.bandwidth();
    const w = bw * 0.62;
    const off = bw * 0.19;
    let yD: ((v: number) => number) | null = null;
    if (hasVar) {
      head(rect.x, rect.y + 14 * s, dHead);
      g.append("text").attr("x", rect.x).attr("y", rect.y + 30 * s).attr("font-size", 11.5 * s).attr("fill", theme.faint).text(`vs ${SCENARIO_NAMES[refCode!]}`);
      const pad = 16 * s;
      const sc = scaleLinear().domain([dlo, dhi === dlo ? dlo + 1 : dhi]).range([rect.y + topH - (dlo < 0 ? pad : 0), rect.y + 20 * s + (dhi > 0 ? pad : 0)]);
      yD = (v: number) => sc(v);
      gv.append("line").attr("class", "r4d-variance-axis").attr("x1", rect.x + leftW).attr("x2", rect.x + rect.w).attr("y1", sc(0)).attr("y2", sc(0)).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
    }
    rows.forEach((r, i) => {
      const f = stagger(frame.build, i, n);
      const cx = x(i)! + bw / 2;
      const bar = (v: number, xx: number, code: ScenarioCode) => {
        if (!Number.isFinite(v)) return;
        const y1 = yV(v * f);
        mark(g.append("rect").attr("x", xx).attr("y", Math.min(y1, z0)).attr("width", w).attr("height", Math.abs(z0 - y1)), code, r.label, v);
      };
      bar(r.py, cx - w / 2 - off, "PY");
      bar(r.pl, cx - w / 2 + off, "PL");
      if (r.mainCode) bar(r.main, cx - w / 2, r.mainCode);
      const top = Math.max(...[r.main, r.pl, r.py].filter(Number.isFinite));
      if (showLabels && f >= 1 && Number.isFinite(r.main) && bw > 26 * s) g.append("text").attr("class", "r4d-value").attr("x", cx).attr("y", yV(top) - 6 * s).attr("text-anchor", "middle").attr("font-size", 11 * s).attr("font-weight", 700).attr("fill", theme.text).text(fmt(r.main));
      // écart
      const d = dv[i];
      if (yD && d) {
        const v = rel ? d.rel * 100 : d.delta;
        if (Number.isFinite(v)) {
          const col = varianceColor(d.delta, pol);
          const z = yD(0);
          const yv = yD(v * f);
          const fc = r.mainCode === "FC";
          if (rel) {
            gv.append("line").attr("class", "r4d-variance-needle").attr("x1", cx).attr("x2", cx).attr("y1", z).attr("y2", yv).attr("stroke", col).attr("stroke-width", 2.2 * s);
            gv.append("circle").attr("class", "r4d-variance-bar r4d-variance-pin").attr("cx", cx).attr("cy", yv).attr("r", 4.6 * s).attr("fill", varFill(col, fc)).attr("stroke", col).attr("stroke-width", fc ? 1.2 * s : 0).attr("data-favourable", col === VARIANCE_POS ? "1" : "0");
          } else {
            gv.append("rect").attr("class", "r4d-variance-bar").attr("x", cx - w / 2).attr("y", Math.min(z, yv)).attr("width", w).attr("height", Math.abs(yv - z)).attr("fill", varFill(col, fc)).attr("stroke", fc ? col : "none").attr("stroke-width", fc ? 1.2 * s : 0).attr("data-favourable", col === VARIANCE_POS ? "1" : "0")
              .append("title").text(`${r.label} : ${fmtD(d.delta)} (${formatSignedPct(d.rel)}) vs ${SCENARIO_NAMES[refCode!]}`);
          }
          if (showLabels && f >= 1 && bw > 24 * s) gv.append("text").attr("class", "r4d-variance-value").attr("x", cx).attr("y", v >= 0 ? yv - 6 * s : yv + 14 * s).attr("text-anchor", "middle").attr("font-size", 10.5 * s).attr("font-weight", 700).attr("fill", col).text(rel ? formatSignedPct(d.rel) : fmtD(d.delta));
        }
      }
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((rect.w - leftW) / (58 * s)))));
      if (i % every === 0) g.append("text").attr("class", "r4d-cat").attr("x", cx).attr("y", rect.y + rect.h - 6 * s).attr("text-anchor", "middle").attr("font-size", fs).attr("fill", theme.muted).text(ellipsize(r.label, Math.max(40 * s, x.step() * every), fs, font));
    });
    return;
  }

  /* ---------------- barres horizontales (structure) : valeurs à gauche, écarts à droite */
  const headH = 26 * s;
  const labW = Math.min(rect.w * 0.26, Math.max(...rows.map((r) => measure(r.label, fs, font))) + 14 * s);
  const avail = rect.w - labW;
  const p1w = hasVar ? avail * 0.5 : avail;
  const gap = hasVar ? 28 * s : 0;
  const p2x = rect.x + labW + p1w + gap;
  const p2w = avail - p1w - gap;
  const bandH = Math.min((rect.h - headH) / n, 46 * s);
  const band = scaleBand<number>().domain(rows.map((_, i) => i)).range([rect.y + headH, rect.y + headH + bandH * n]).paddingInner(0.24).paddingOuter(0.08);
  const xs = scaleLinear().domain([vmin, vmax]).range([rect.x + labW, rect.x + labW + p1w - 64 * s]);
  const z0 = xs(0);
  head(rect.x + labW, rect.y + 14 * s, codes.filter((c): c is ScenarioCode => !!c).map((c) => c).join(" · "));
  if (hasVar) head(p2x, rect.y + 14 * s, `${dHead} (vs ${SCENARIO_NAMES[refCode!]})`);
  const labelRoom = 92 * s;
  const hasNeg = dvals.some((v) => v < 0);
  const hasPos = dvals.some((v) => v > 0);
  const ds = scaleLinear().domain([dlo, dhi === dlo ? dlo + 1 : dhi]).range([p2x + (hasNeg ? labelRoom : 0), p2x + p2w - (hasPos ? labelRoom : 0)]);
  if (hasVar) gv.append("line").attr("class", "r4d-variance-axis").attr("x1", ds(0)).attr("x2", ds(0)).attr("y1", rect.y + headH - 4 * s).attr("y2", band(n - 1)! + band.bandwidth() + 4 * s).attr("stroke", theme.axis).attr("stroke-width", 1.2 * s);
  g.append("line").attr("x1", z0).attr("x2", z0).attr("y1", rect.y + headH - 4 * s).attr("y2", band(n - 1)! + band.bandwidth() + 4 * s).attr("stroke", theme.axis).attr("stroke-width", 1 * s);
  rows.forEach((r, i) => {
    const f = stagger(frame.build, i, n);
    const y = band(i)!;
    const h = band.bandwidth();
    const t = h * 0.62;
    const off = h * 0.19;
    const cy = y + h / 2;
    g.append("text").attr("class", "r4d-cat").attr("x", rect.x + labW - 12 * s).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", fs).attr("fill", theme.text).text(ellipsize(r.label, labW - 14 * s, fs, font));
    const bar = (v: number, yy: number, code: ScenarioCode) => {
      if (!Number.isFinite(v)) return;
      const x1 = xs(v * f);
      mark(g.append("rect").attr("x", Math.min(x1, z0)).attr("y", yy).attr("width", Math.abs(x1 - z0)).attr("height", t), code, r.label, v);
    };
    bar(r.py, cy - t / 2 - off, "PY");
    bar(r.pl, cy - t / 2 + off, "PL");
    if (r.mainCode) bar(r.main, cy - t / 2, r.mainCode);
    const right = Math.max(...[r.main, r.pl, r.py].filter(Number.isFinite));
    if (f >= 1 && Number.isFinite(r.main)) g.append("text").attr("class", "r4d-value").attr("x", xs(right) + 6 * s).attr("y", cy).attr("dy", "0.35em").attr("font-size", 11.5 * s).attr("font-weight", 700).attr("fill", theme.text).text(fmt(r.main));
    const d = dv[i];
    if (!hasVar || !d) return;
    const v = rel ? d.rel * 100 : d.delta;
    if (!Number.isFinite(v)) return;
    const col = varianceColor(d.delta, pol);
    const fc = r.mainCode === "FC";
    const zero = ds(0);
    const xv = ds(v * f);
    if (rel) {
      gv.append("line").attr("class", "r4d-variance-needle").attr("x1", zero).attr("x2", xv).attr("y1", cy).attr("y2", cy).attr("stroke", col).attr("stroke-width", 2.2 * s);
      gv.append("circle").attr("class", "r4d-variance-bar r4d-variance-pin").attr("cx", xv).attr("cy", cy).attr("r", 4.6 * s).attr("fill", varFill(col, fc)).attr("stroke", col).attr("stroke-width", fc ? 1.2 * s : 0);
    } else {
      gv.append("rect").attr("class", "r4d-variance-bar").attr("x", Math.min(zero, xv)).attr("y", cy - t / 2).attr("width", Math.abs(xv - zero)).attr("height", t).attr("fill", varFill(col, fc)).attr("stroke", fc ? col : "none").attr("stroke-width", fc ? 1.2 * s : 0)
        .append("title").text(`${r.label} : ${fmtD(d.delta)} (${formatSignedPct(d.rel)})`);
    }
    if (f >= 1) {
      const txt = rel ? formatSignedPct(d.rel) : `${fmtD(d.delta)}  ${Number.isFinite(d.rel) ? formatSignedPct(d.rel) : ""}`;
      gv.append("text").attr("class", "r4d-variance-value").attr("x", xv + (v >= 0 ? 7 : -7) * s).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", v >= 0 ? "start" : "end").attr("font-size", 11.5 * s).attr("font-weight", 700).attr("fill", col).text(txt.trim());
    }
  });
}
