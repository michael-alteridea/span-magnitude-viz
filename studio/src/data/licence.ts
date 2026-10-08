/** Mention de licence dans une ligne de source du cartouche (données publiques). */
/** Source sans sa mention de licence (« Source : Eurostat (…) · Licence : CC BY 4.0 » → « Source : Eurostat (…) »). */
export function stripLicence(source: string): string {
  return source.replace(/\s*·\s*Licence\s*:?\s*[^·]*?(?=\s*·|$)/giu, "").trim();
}

/** Licence d'une ligne de source (« … · Licence : CC BY 4.0 » → « CC BY 4.0 »), sinon chaîne vide. */
export function licenceFromSource(source: string): string {
  return /·\s*Licence\s*:?\s*([^·]+)/iu.exec(source)?.[1]?.trim() ?? "";
}
