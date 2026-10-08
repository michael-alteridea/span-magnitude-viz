/** Jetons de thème : variables CSS --ac-* sur le conteneur (ou options.theme), pétrole par défaut. */
import { color as d3color, interpolateRgb } from "d3";

export interface Theme {
  primary: string;
  positive: string;
  negative: string;
  grey: string;
  text: string;
  bg: string;
  font: string;
  /** Teinte claire de la couleur principale (dérivée si absente). */
  primarySoft: string;
  /** Teinte foncée de la couleur principale (dérivée si absente). */
  primaryDeep: string;
}

export type ThemeInput = Partial<Theme>;

export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  primary: "#0E6E8C",
  positive: "#1E8E5A",
  negative: "#C8423B",
  grey: "#8C989F",
  text: "#14262E",
  bg: "#FFFFFF",
  font: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  primarySoft: "#3FA7C4",
  primaryDeep: "#08465A",
});

/** Variables CSS lues sur le conteneur (nom du jeton → propriété). */
export const CSS_VARS: Record<keyof Theme, string> = {
  primary: "--ac-primary",
  positive: "--ac-positive",
  negative: "--ac-negative",
  grey: "--ac-grey",
  text: "--ac-text",
  bg: "--ac-bg",
  font: "--ac-font",
  primarySoft: "--ac-primary-soft",
  primaryDeep: "--ac-primary-deep",
};

const safeColor = (v: string | undefined, fallback: string): string => {
  if (!v) return fallback;
  const c = d3color(v.trim());
  return c ? c.formatHex() : fallback;
};

/** Thème complet à partir de jetons partiels : couleurs validées, teintes claire et foncée dérivées de primary. */
export function resolveTheme(input: ThemeInput = {}): Theme {
  const primary = safeColor(input.primary, DEFAULT_THEME.primary);
  const custom = primary.toLowerCase() !== DEFAULT_THEME.primary.toLowerCase();
  const font = (input.font ?? "").trim() || DEFAULT_THEME.font;
  return {
    primary,
    positive: safeColor(input.positive, DEFAULT_THEME.positive),
    negative: safeColor(input.negative, DEFAULT_THEME.negative),
    grey: safeColor(input.grey, DEFAULT_THEME.grey),
    text: safeColor(input.text, DEFAULT_THEME.text),
    bg: input.bg?.trim() === "transparent" ? "transparent" : safeColor(input.bg, DEFAULT_THEME.bg),
    font: font.replace(/[<>"]/g, ""),
    primarySoft: safeColor(input.primarySoft, custom ? (d3color(interpolateRgb(primary, "#ffffff")(0.38))?.formatHex() ?? primary) : DEFAULT_THEME.primarySoft),
    primaryDeep: safeColor(input.primaryDeep, custom ? (d3color(interpolateRgb(primary, "#000000")(0.35))?.formatHex() ?? primary) : DEFAULT_THEME.primaryDeep),
  };
}

/** Lit les variables --ac-* calculées sur un élément, puis applique les surcharges explicites. */
export function readTheme(el?: Element | null, overrides: ThemeInput = {}): Theme {
  const fromCss: ThemeInput = {};
  if (el && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(el);
    for (const [k, v] of Object.entries(CSS_VARS) as [keyof Theme, string][]) {
      const val = cs.getPropertyValue(v).trim();
      if (val) fromCss[k] = val;
    }
  }
  return resolveTheme({ ...fromCss, ...overrides });
}
