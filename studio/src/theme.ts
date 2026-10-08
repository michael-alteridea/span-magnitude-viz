/**
 * Thème visuel des graphiques : fonds, couleurs de texte / grille, palettes, polices.
 */
import {
  BRAND as BRAND_ALTERIDEA,
  BRAND_PETROLE,
  COLD_HOT,
  OBSERVABLE10,
  PETROLE,
  PETROLE_DARK,
  PETROLE_LIGHT,
  PETROLE_MAIN,
  WARM_PALETTE,
} from "span-magnitude-viz/colors";
import type { ChartSpec, FontKey, PaletteKey } from "./spec";
import inter400 from "./fonts/inter-400.woff2?url";
import inter700 from "./fonts/inter-700.woff2?url";
import plex400 from "./fonts/plex-400.woff2?url";
import plex700 from "./fonts/plex-700.woff2?url";
import grotesk400 from "./fonts/grotesk-400.woff2?url";
import grotesk700 from "./fonts/grotesk-700.woff2?url";
import barlow400 from "./fonts/barlow-400.woff2?url";
import barlow700 from "./fonts/barlow-700.woff2?url";
import playfair400 from "./fonts/playfair-400.woff2?url";
import playfair700 from "./fonts/playfair-700.woff2?url";

/**
 * Identité Reporting 4D : bleu pétrole (choisi le 08/10/2026).
 * - MAIN : ton principal (graphiques sur fond clair, aplats) ;
 * - LIGHT : accents, boutons et mises en avant sur fond SOMBRE (le ton principal y paraît terne) ;
 * - DARK : ombres, dégradés, texte d'accent sur fond clair.
 */
export const PETROLE_COLORS = {
  main: PETROLE_MAIN,
  light: PETROLE_LIGHT,
  dark: PETROLE_DARK,
  /** Teintes / nuances dérivées pour dégradés et palettes. */
  pale: "#8ECFE2",
  ice: "#C3E4EE",
  mid: "#1B8BA8",
  deep: "#052F3D",
} as const;

/** Jetons d'accent de l'interface (bleu pétrole). */
export const BRAND = BRAND_PETROLE;

/**
 * Couleurs sémantiques réservées aux écarts (futurs graphiques normés IBCS / ISO 24896) :
 * rouge = écart défavorable, vert = écart favorable. Ne pas les utiliser comme couleurs d'accent.
 */
export const VARIANCE_NEG = "#d62839";
export const VARIANCE_POS = "#2e9e4f";

/** Palettes « rouges » (préréglages Alteridea) : l'accent du graphique reste alors rouge. */
const RED_PALETTES: ReadonlySet<PaletteKey> = new Set(["alteridea", "alterideaMono", "rougeGris"]);

/** Couleur d'accent du graphique (filet, « 4D » de la signature, barre de progression). */
function chartAccent(palette: PaletteKey, dark: boolean): string {
  if (RED_PALETTES.has(palette)) return BRAND_ALTERIDEA.accent;
  return dark ? PETROLE_LIGHT : PETROLE_MAIN;
}

export interface Theme {
  dark: boolean;
  bg: string;
  text: string;
  muted: string;
  faint: string;
  grid: string;
  axis: string;
  /** Contour léger (séparation de parts / segments). */
  separator: string;
  track: string;
  accent: string;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function themeFor(spec: ChartSpec): Theme {
  const bgMode = spec.style.background;
  const bg = bgMode === "dark" ? "#0b0b0c" : bgMode === "light" ? "#fafaf9" : spec.style.backgroundCustom;
  const dark = bgMode === "dark" || (bgMode === "custom" && luminance(bg) < 0.22);
  return dark
    ? {
        dark,
        bg,
        text: "#f4f4f5",
        muted: "#a1a1aa",
        faint: "#71717a",
        grid: "rgba(255,255,255,0.08)",
        axis: "#52525b",
        separator: bg,
        track: "rgba(255,255,255,0.06)",
        accent: chartAccent(spec.style.palette, true),
      }
    : {
        dark,
        bg,
        text: "#18181b",
        muted: "#52525b",
        faint: "#a1a1aa",
        grid: "rgba(0,0,0,0.08)",
        axis: "#a1a1aa",
        separator: bg,
        track: "rgba(0,0,0,0.06)",
        accent: chartAccent(spec.style.palette, false),
      };
}

export const PALETTE_LABELS: Record<PaletteKey, string> = {
  petrole: "Bleu pétrole (défaut)",
  petroleMono: "Bleu pétrole dégradé",
  petroleGris: "Pétrole & gris (mise en avant)",
  alteridea: "Alteridea (rouge)",
  alterideaMono: "Alteridea dégradé",
  rougeGris: "Rouge & gris (mise en avant)",
  vives: "Vives (10 teintes)",
  froidChaud: "Froid → chaud",
  or: "Or chaud",
  custom: "Personnalisée",
};

/**
 * Bleu pétrole : 1re couleur = LIGHT sur fond sombre, MAIN sur fond clair (série unique),
 * puis rampe pétrole / bleu / gris pour les séries multiples.
 */
const PETROLE_ON_DARK = ["#3FA7C4", "#9FB3BD", "#0E6E8C", "#8ECFE2", "#4F7CAC", "#6B7F89", "#C3E4EE", "#2F5D8A", "#D4D4D8", "#1B8BA8"];
const PETROLE_ON_LIGHT = ["#0E6E8C", "#8A9BA3", "#08465A", "#3FA7C4", "#2F5D8A", "#5E6E76", "#8ECFE2", "#052F3D", "#4F7CAC", "#B9C7CE"];

const ALTERIDEA_DARK = ["#d62839", "#f4a0a8", "#9a1c28", "#ed5564", "#d4d4d8", "#7a1520", "#f0707c", "#71717a", "#b82232", "#fbd5d9"];
const ALTERIDEA_LIGHT = ["#d62839", "#9a1c28", "#f0707c", "#3a0a10", "#71717a", "#e9374a", "#5c1018", "#a1a1aa", "#b82232", "#f4a0a8"];

/** Couleurs de la palette, adaptées au fond (sombre / clair). */
export function paletteColors(spec: ChartSpec, theme: Theme): string[] {
  switch (spec.style.palette) {
    case "petrole":
      return theme.dark ? PETROLE_ON_DARK : PETROLE_ON_LIGHT;
    case "petroleMono":
      return theme.dark
        ? ["#3FA7C4", "#8ECFE2", "#0E6E8C", "#C3E4EE", "#1B8BA8", "#5FB8D1", "#08465A", "#E1F2F7"]
        : ["#0E6E8C", "#08465A", "#3FA7C4", "#052F3D", "#1B8BA8", "#8ECFE2", "#0B5A73", "#C3E4EE"];
    case "petroleGris":
      return theme.dark
        ? ["#3FA7C4", "#a1a1aa", "#71717a", "#d4d4d8", "#52525b", "#e4e4e7"]
        : ["#0E6E8C", "#71717a", "#a1a1aa", "#3f3f46", "#d4d4d8", "#52525b"];
    case "alteridea":
      return theme.dark ? ALTERIDEA_DARK : ALTERIDEA_LIGHT;
    case "alterideaMono":
      return theme.dark
        ? ["#d62839", "#e9374a", "#f0707c", "#f4a0a8", "#b82232", "#9a1c28", "#7a1520", "#fbd5d9"]
        : ["#d62839", "#9a1c28", "#e9374a", "#7a1520", "#f0707c", "#5c1018", "#b82232", "#3a0a10"];
    case "rougeGris":
      return theme.dark
        ? ["#d62839", "#a1a1aa", "#71717a", "#d4d4d8", "#52525b", "#e4e4e7"]
        : ["#d62839", "#71717a", "#a1a1aa", "#3f3f46", "#d4d4d8", "#52525b"];
    case "vives":
      return [...OBSERVABLE10];
    case "froidChaud":
      return [...COLD_HOT].reverse();
    case "or":
      return [...WARM_PALETTE];
    case "custom":
      return spec.style.paletteCustom.length ? spec.style.paletteCustom : [...PETROLE];
  }
}

/** Correspondance palette Studio → colorScheme de la bibliothèque span-magnitude. */
export function libColorScheme(p: PaletteKey): string {
  if (p === "vives") return "observable10";
  if (p === "froidChaud") return "coldhot";
  if (p === "or") return "warm";
  if (RED_PALETTES.has(p)) return "altairady";
  return "petrole";
}

export interface FontDef {
  label: string;
  family: string;
  fallback: string;
  files: { 400: string; 700: string };
}

export const FONTS: Record<FontKey, FontDef> = {
  inter: { label: "Inter (défaut)", family: "R4D Inter", fallback: "system-ui, sans-serif", files: { 400: inter400, 700: inter700 } },
  plex: { label: "IBM Plex Sans", family: "R4D Plex", fallback: "system-ui, sans-serif", files: { 400: plex400, 700: plex700 } },
  grotesk: { label: "Space Grotesk", family: "R4D Grotesk", fallback: "system-ui, sans-serif", files: { 400: grotesk400, 700: grotesk700 } },
  barlow: { label: "Barlow Condensed", family: "R4D Barlow", fallback: "'Arial Narrow', sans-serif", files: { 400: barlow400, 700: barlow700 } },
  playfair: { label: "Playfair Display (serif)", family: "R4D Playfair", fallback: "Georgia, serif", files: { 400: playfair400, 700: playfair700 } },
};

export function fontStack(key: FontKey): string {
  const f = FONTS[key];
  return `'${f.family}', ${f.fallback}`;
}

const loaded = new Map<FontKey, Promise<void>>();

/** Charge une police dans le document (FontFace API). */
export function ensureFont(key: FontKey): Promise<void> {
  let p = loaded.get(key);
  if (!p) {
    const f = FONTS[key];
    p = Promise.all(
      ([400, 700] as const).map(async (w) => {
        const face = new FontFace(f.family, `url(${f.files[w]})`, { weight: String(w), style: "normal" });
        await face.load();
        document.fonts.add(face);
      })
    ).then(() => undefined);
    loaded.set(key, p);
  }
  return p;
}

const dataUriCache = new Map<string, Promise<string>>();

async function toDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  let p = dataUriCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Police introuvable (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:font/woff2;base64,${btoa(bin)}`;
      });
    dataUriCache.set(url, p);
  }
  return p;
}

/** CSS @font-face autonome (polices en base64) pour l'export SVG / PNG. */
export async function embeddedFontCss(key: FontKey): Promise<string> {
  const f = FONTS[key];
  const parts = await Promise.all(
    ([400, 700] as const).map(async (w) => {
      const uri = await toDataUri(f.files[w]);
      return `@font-face{font-family:'${f.family}';font-weight:${w};font-style:normal;src:url(${uri}) format('woff2');}`;
    })
  );
  return parts.join("\n");
}
