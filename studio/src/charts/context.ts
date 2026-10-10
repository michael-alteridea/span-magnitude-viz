import type { Selection } from "d3";
import type { ChartSpec } from "../spec";
import type { Dataset } from "../data/table";
import type { Model } from "../data/model";
import type { Theme } from "../theme";
import type { VarianceModel } from "../data/variance";
import type { DrillCtx, DrillModel } from "../data/drill";

export type G = Selection<SVGGElement, unknown, null, undefined>;

export interface Frame {
  /** Progression de l'animation d'entrée (1 = terminé). */
  build: number;
  /** Position 4D en pas (continue), null = pas d'animation temporelle. */
  timePos: number | null;
  /** Mise en avant (étape L) : 0 = graphique simple, 1 = mis en avant (défaut). Animée entre deux snapshots. */
  focus?: number;
  /** Position 4D continue pour le compteur à rouleaux (Reel : données par pas entiers, rouleaux continus) ; absent = timePos. */
  stampPos?: number | null;
}

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Domains {
  y?: [number, number];
  y2?: [number, number];
  x?: [number, number];
  size?: [number, number];
}

export interface Prepared {
  model: Model | null;
  domains: Domains;
  /** Révélation le long de l'axe X (index de clé continu) quand X = champ temporel. */
  reveal: number | null;
  stamp: string | null;
  /** Compteur à rouleaux : libellé du pas courant, du suivant, avancement 0..1 du roulement. */
  stampRoll?: { from: string; to: string; f: number } | null;
  /** Progression 4D 0..1 (barre de film). */
  progress: number | null;
  warnings: string[];
  /** Message bloquant (encodage incomplet…). */
  error: string | null;
  /** Modèle d'écarts (type « variance »). */
  variance?: VarianceModel | null;
  /** Exploration guidée (type « drill »). */
  drill?: { model: DrillModel; ctx: DrillCtx } | null;
}

export interface DrawCtx {
  spec: ChartSpec;
  ds: Dataset;
  theme: Theme;
  colors: string[];
  font: string;
  /** Facteur d'échelle typographique. */
  s: number;
  W: number;
  H: number;
  frame: Frame;
  prep: Prepared;
  /** Échelle commune (histoire / PowerPoint, « même échelle ») : maximum imposé à l'axe des valeurs. */
  sharedMax?: number | null;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/** Progression d'un élément i/n avec décalage (cascade). */
export function stagger(build: number, i: number, n: number, spread = 0.45): number {
  if (build >= 1) return 1;
  const delay = n > 1 ? (i / (n - 1)) * spread : 0;
  return easeOut((build - delay) / (1 - spread));
}
