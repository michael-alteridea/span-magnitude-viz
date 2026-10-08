/**
 * Extrait un jeu choisi d'icônes Phosphor (MIT, https://phosphoricons.com) en chemins SVG
 * → studio/src/charts/icons/phosphor.ts (aucune police, aucune dépendance à l'exécution).
 *   node studio/scripts/gen-phosphor.mjs [dossier @phosphor-icons/core]
 * Licence : studio/src/charts/icons/LICENSE-phosphor.txt (copiée aussi dans public/licences/).
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const core = process.argv[2] ?? "/workspace/mockups/panneau-icones/vendor/node_modules/@phosphor-icons/core";
if (!existsSync(join(core, "assets/regular"))) throw new Error(`@phosphor-icons/core introuvable : ${core}`);

/** Nom Phosphor → libellé français (sélecteur du panneau). */
export const ICONS = {
  cloud: "Nuage", "hard-drives": "Serveurs", database: "Base de données", cpu: "Processeur", "desktop-tower": "Ordinateur",
  "wifi-high": "Réseau", code: "Code", printer: "Imprimante", users: "Équipe", "users-three": "Groupe", user: "Personne",
  "user-minus": "Absence (personne)", handshake: "Partenariat", briefcase: "Mallette", key: "Licence / clé", truck: "Camion",
  package: "Colis / produit", factory: "Usine", wrench: "Clé à molette", gear: "Engrenage", headset: "Support",
  buildings: "Bureaux", house: "Maison", storefront: "Magasin", "shopping-cart": "Panier", "map-pin": "Lieu", globe: "Monde",
  phone: "Téléphone", "envelope-simple": "E-mail", "chat-circle-dots": "Messagerie", megaphone: "Mégaphone",
  "currency-eur": "Euro", coins: "Pièces", "piggy-bank": "Tirelire", "credit-card": "Carte bancaire", bank: "Banque",
  receipt: "Facture", tag: "Étiquette", percent: "Pourcentage", "chart-line-up": "Croissance", target: "Cible",
  trophy: "Trophée", star: "Étoile", "flag-checkered": "Drapeau d'arrivée", check: "Coche", warning: "Alerte", x: "Croix",
  minus: "Aucune (trait)", clock: "Horloge", hourglass: "Sablier", "calendar-x": "Absence (calendrier)", "file-text": "Document",
  "book-open": "Livre", "graduation-cap": "Formation", "video-camera": "Vidéo", gift: "Cadeau", rocket: "Fusée",
  lightning: "Énergie", "shield-check": "Sécurité", car: "Voiture", airplane: "Avion", train: "Train", bicycle: "Vélo",
  coffee: "Café", "fork-knife": "Restauration", bed: "Hébergement (lit)", "t-shirt": "Textile", drop: "Eau", fire: "Feu",
  sun: "Soleil", leaf: "Feuille", tree: "Arbre", recycle: "Recyclage", "first-aid": "Santé", pill: "Médicament",
  stethoscope: "Médecin", smiley: "Satisfaction",
};

function pathOf(file, name) {
  const s = readFileSync(file, "utf8");
  const inner = s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\sfill="[^"]*"/g, "").trim();
  const ds = [...inner.matchAll(/<path d="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  if (!ds.length || inner.replace(/<path d="[^"]+"\s*\/>/g, "").trim()) throw new Error(`forme inattendue : ${name}`);
  return ds.join(" ");
}
const out = {};
const fill = {};
for (const name of Object.keys(ICONS)) {
  out[name] = pathOf(join(core, "assets/regular", `${name}.svg`), name);
  // graisse « fill » : pictogrammes (isotype), plus lisibles en petit
  fill[name] = pathOf(join(core, "assets/fill", `${name}-fill.svg`), `${name}-fill`);
}
const ts = `/* Fichier généré par studio/scripts/gen-phosphor.mjs — ne pas modifier à la main.
 * Icônes Phosphor (graisses « regular » et « fill », grille 256) — https://phosphoricons.com
 * Copyright (c) 2023 Phosphor Icons — licence MIT (voir LICENSE-phosphor.txt dans ce dossier). */

/** Nom Phosphor → chemin SVG (attribut d, grille 256 × 256). */
export const PHOSPHOR: Record<string, string> = ${JSON.stringify(out, null, 2)};

/** Même jeu en graisse « fill » (pictogrammes pleins). */
export const PHOSPHOR_FILL: Record<string, string> = ${JSON.stringify(fill, null, 2)};

/** Nom Phosphor → libellé français. */
export const ICON_LABELS: Record<string, string> = ${JSON.stringify(ICONS, null, 2)};
`;
const dst = join(here, "../src/charts/icons");
writeFileSync(join(dst, "phosphor.ts"), ts);
copyFileSync(join(core, "LICENSE"), join(dst, "LICENSE-phosphor.txt"));
copyFileSync(join(core, "LICENSE"), join(here, "../public/licences/phosphor-icons-MIT.txt"));
console.log(`${Object.keys(out).length} icônes → src/charts/icons/phosphor.ts (${Math.round(ts.length / 1024)} Ko)`);
