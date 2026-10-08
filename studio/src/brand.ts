/**
 * Signature « label qualité » : nom du produit, lien vers la plateforme, date de génération et source.
 * Le nom n'étant pas définitif, il n'existe qu'ici.
 */
export const PRODUCT_LABEL = "Reporting 4D";
export const PLATFORM_URL = "https://alteridea-dashboard.web.app/reporting/";
/** Libellé court du lien affiché dans les exports (PowerPoint…). */
export const PLATFORM_HOST = PLATFORM_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
/** Couleur du logo (carré pétrole provisoire). */
export const LOGO_COLOR = "#0E6E8C";

/** La signature ne peut être masquée qu'en offre « pro » (aucune option d'interface pour l'instant). */
export function showSignature(spec: { branding?: "free" | "pro"; style: { brandMark: boolean } }): boolean {
  return spec.branding !== "pro" || spec.style.brandMark;
}
