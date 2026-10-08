/**
 * AlterideaCharts 0.1.0 — moteur de graphiques partagé (ValueRoom, Datanime…), tiré de span-magnitude-viz (MIT).
 * SVG + D3, thème par variables CSS --ac-*, nombres à la française, cartouche neutre.
 *
 *   AlterideaCharts.cumulativeGain.animate("#roi", data, { title: "…" })
 *   const svg = AlterideaCharts.waterfall.toSVG(data, { width: 800 })
 */
import * as cartoucheMod from "./cartouche";
import type { CartoucheOptions } from "./cartouche";
import * as beforeAfterMod from "./charts/beforeAfter";
import * as gainMod from "./charts/cumulativeGain";
import * as waterfallMod from "./charts/waterfall";
import { mount, prefersReducedMotion, type ChartController, type ChartModule } from "./animate";
import * as format from "./format";
import type { ChartOptions } from "./frame";
import { svgToPng } from "./png";
import { CSS_VARS, DEFAULT_THEME, readTheme, resolveTheme } from "./theme";

export const version = "0.1.0";

export interface Chart<D> {
  /** Monte et anime le graphique dans un conteneur (élément ou sélecteur). */
  animate(container: Element | string, data: D, options?: ChartOptions): ChartController<D> & { ready: Promise<void> };
  /** SVG autonome (chaîne), sans DOM : pour jsPDF / svg2pdf, e-mail, serveur. */
  toSVG(data: D, options?: ChartOptions): string;
  /** PNG (data URL) — navigateur requis. */
  toPNG(data: D, options?: ChartOptions & { scale?: number }): Promise<string>;
}

function chart<D>(kind: string, mod: ChartModule<D>): Chart<D> {
  return {
    animate: (container, data, options) => mount(kind, mod, container, data, options),
    toSVG: (data, options) => mod.toSVG(data, options),
    toPNG: (data, options = {}) => svgToPng(mod.toSVG(data, options), { scale: options.scale }),
  };
}

export const cumulativeGain: Chart<gainMod.CumulativeGainData> & { computePayback: typeof gainMod.computePayback } = {
  ...chart("gain", gainMod),
  computePayback: gainMod.computePayback,
};
export const waterfall: Chart<waterfallMod.WaterfallData> & { bars: typeof waterfallMod.waterfallBars } = {
  ...chart("cascade", waterfallMod),
  bars: waterfallMod.waterfallBars,
};
export const beforeAfter: Chart<beforeAfterMod.BeforeAfterData> & { delta: typeof beforeAfterMod.delta } = {
  ...chart("avant-apres", beforeAfterMod),
  delta: beforeAfterMod.delta,
};

export const cartouche = {
  toSVG: (o: CartoucheOptions, opts?: cartoucheMod.CartoucheRenderOptions) => cartoucheMod.toSVG(o, opts),
  toPNG: (o: CartoucheOptions, opts?: cartoucheMod.CartoucheRenderOptions & { scale?: number }) => cartoucheMod.toPNG(o, opts),
  text: cartoucheMod.cartoucheText,
};

export const theme = { DEFAULT: DEFAULT_THEME, CSS_VARS, resolve: resolveTheme, read: readTheme };

export { format, prefersReducedMotion };

/** PNG (data URL) d'une chaîne SVG quelconque. */
export function toPNG(svg: string, opts?: { scale?: number; background?: string }): Promise<string> {
  return svgToPng(svg, opts);
}

export type { ChartOptions, CartoucheOptions, ChartController };
export type { CumulativeGainData, GainPoint, Payback } from "./charts/cumulativeGain";
export type { WaterfallData, WaterfallItem, WaterfallBar } from "./charts/waterfall";
export type { BeforeAfterData, BeforeAfterItem } from "./charts/beforeAfter";
export type { Theme, ThemeInput } from "./theme";
