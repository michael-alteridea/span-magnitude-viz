/**
 * Icônes des barres (étape I) : dictionnaire automatique français / anglais → icône Phosphor (MIT),
 * tracé SVG en chemins (aucune police : rendu identique en SVG, PNG, vidéo et PowerPoint).
 * Pas de correspondance → pas d'icône (jamais d'icône hasardeuse) ; le choix manuel reste prioritaire.
 */
import type { G } from "../context";
import { ICON_LABELS, PHOSPHOR, PHOSPHOR_FILL } from "./phosphor";

export { ICON_LABELS, PHOSPHOR };

/** Mots-clés (sans accents, minuscules) → icône. Les mots de 5 lettres et plus acceptent un suffixe (pluriels). */
export const ICON_DICT: [string[], string][] = [
  [["cloud", "nuage", "saas", "hebergement", "hosting"], "cloud"],
  [["serveur", "server", "datacenter", "infrastructure", "infra"], "hard-drives"],
  [["base de donnees", "database", "donnees", "data"], "database"],
  [["informatique", "materiel", "hardware", "it"], "cpu"],
  [["poste de travail", "ordinateur", "computer", "pc", "postes"], "desktop-tower"],
  [["reseau", "network", "wifi", "internet", "telecom"], "wifi-high"],
  [["developpement", "dev", "code", "logiciel sur mesure"], "code"],
  [["impression", "imprimante", "printer"], "printer"],
  [["equipe", "team", "salaire", "effectif", "rh", "personnel", "staff", "masse salariale", "ressources humaines"], "users"],
  [["clients", "client", "customers", "customer", "utilisateurs", "users"], "users-three"],
  [["commercial", "commerciaux", "vendeur", "gestionnaire", "conseiller", "agent", "salesperson"], "user"],
  [["partenaire", "partner", "partenariat", "distributeur", "revendeur", "reseller"], "handshake"],
  [["licence", "license", "logiciel", "software", "abonnement", "subscription", "cle"], "key"],
  [["transport", "livraison", "logistique", "logistics", "delivery", "fret", "expedition", "shipping"], "truck"],
  [["produit", "product", "stock", "colis", "inventaire", "equipement", "marchandise"], "package"],
  [["production", "usine", "factory", "fabrication", "manufacturing", "industrie"], "factory"],
  [["maintenance", "reparation", "repair", "piece", "entretien", "sav"], "wrench"],
  [["support", "service client", "helpdesk", "assistance", "hotline", "centre d appel"], "headset"],
  [["agence", "bureau", "office", "locaux", "siege", "immobilier", "loyer", "rent"], "buildings"],
  [["magasin", "boutique", "store", "retail", "point de vente", "commerce"], "storefront"],
  [["achat", "e-commerce", "ecommerce", "commande", "panier", "purchase", "order"], "shopping-cart"],
  [["site", "ville", "city", "implantation"], "map-pin"],
  [["international", "monde", "world", "export", "web", "site web", "website"], "globe"],
  [["telephone", "phone", "appel", "call", "mobile"], "phone"],
  [["email", "e-mail", "mail", "courriel", "newsletter", "emailing"], "envelope-simple"],
  [["chat", "messagerie", "tchat", "messaging"], "chat-circle-dots"],
  [["marketing", "campagne", "campaign", "publicite", "pub", "advertising", "ads", "communication"], "megaphone"],
  [["vente", "ventes", "chiffre d affaires", "ca", "revenu", "revenue", "sales", "recette"], "currency-eur"],
  [["tresorerie", "cash", "liquidite"], "coins"],
  [["epargne", "savings", "economie"], "piggy-bank"],
  [["paiement", "payment", "carte", "card"], "credit-card"],
  [["banque", "bank", "frais bancaire", "financement", "credit", "emprunt"], "bank"],
  [["facture", "invoice", "impot", "taxe", "tax", "comptabilite"], "receipt"],
  [["prix", "price", "tarif", "remise", "promotion"], "tag"],
  [["objectif", "target", "cible", "quota"], "target"],
  [["formation", "training", "ecole", "school", "apprentissage"], "graduation-cap"],
  [["evenement", "event", "salon", "seminaire"], "star"],
  [["video", "tournage", "film"], "video-camera"],
  [["cadeau", "gift", "fidelite"], "gift"],
  [["innovation", "lancement", "launch", "startup", "r&d", "recherche et developpement"], "rocket"],
  [["energie", "electricite", "energy", "electricity"], "lightning"],
  [["securite", "security", "assurance", "insurance"], "shield-check"],
  [["voiture", "vehicule", "car", "flotte", "fleet", "automobile"], "car"],
  [["voyage", "deplacement", "travel", "avion", "aerien", "flight"], "airplane"],
  [["train", "ferroviaire", "rail"], "train"],
  [["velo", "bike", "mobilite douce"], "bicycle"],
  [["restauration", "repas", "cantine", "food", "restaurant", "traiteur"], "fork-knife"],
  [["cafe", "coffee", "boissons"], "coffee"],
  [["hotel", "nuitee", "hebergement hotelier"], "bed"],
  [["textile", "vetement", "habillement", "clothing"], "t-shirt"],
  [["eau", "water"], "drop"],
  [["chauffage", "gaz", "heating"], "fire"],
  [["solaire", "solar"], "sun"],
  [["environnement", "rse", "esg", "durable", "sustainability"], "leaf"],
  [["recyclage", "dechet", "waste", "recycling"], "recycle"],
  [["sante", "health", "mutuelle", "medical"], "first-aid"],
  [["pharmacie", "medicament", "pharma"], "pill"],
  [["absence", "absent", "conge", "leave", "arret"], "calendar-x"],
  [["retard", "delai", "attente", "delay", "backlog"], "hourglass"],
  [["satisfaction", "nps", "avis"], "smiley"],
  [["document", "dossier", "contrat", "contract", "papier"], "file-text"],
];

/** Texte normalisé : minuscules, sans accents, ponctuation → espaces. */
export function normIconText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, " ")
    .replace(/[^a-z0-9&+\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function kwMatch(words: string[], text: string, kw: string): boolean {
  if (kw.includes(" ")) return ` ${text} `.includes(` ${kw} `);
  return words.some((w) => w === kw || (kw.length >= 5 && w.startsWith(kw) && w.length - kw.length <= 2));
}

/** Icône automatique d'après un libellé (catégorie, colonne) ; null sans correspondance sûre. */
export function iconFor(label: string | null | undefined): string | null {
  if (!label) return null;
  const text = normIconText(label);
  if (!text) return null;
  const words = text.split(" ");
  // mots-clés de plusieurs mots d'abord (« service client » avant « client »)
  for (const multi of [true, false])
    for (const [kws, icon] of ICON_DICT) for (const kw of kws) if (kw.includes(" ") === multi && kwMatch(words, text, kw)) return icon;
  return null;
}

/** Icône d'une catégorie : choix manuel (« » = aucune), sinon automatique. */
export function categoryIcon(label: string, overrides: Record<string, string> | undefined): string | null {
  const o = overrides?.[label];
  if (o !== undefined) return o && PHOSPHOR[o] ? o : null;
  return iconFor(label);
}

/** Dessine une icône centrée en (cx, cy), de `size` px, couleur `color`. */
export function drawIcon(g: G, name: string, cx: number, cy: number, size: number, color: string, cls = "r4d-icon", filled = false): G | null {
  const d = (filled ? PHOSPHOR_FILL[name] : undefined) ?? PHOSPHOR[name];
  if (!d) return null;
  const k = size / 256;
  const ig = g.append("g").attr("class", cls).attr("data-icon", name).attr("transform", `translate(${(cx - size / 2).toFixed(2)},${(cy - size / 2).toFixed(2)}) scale(${k.toFixed(5)})`);
  ig.append("path").attr("d", d).attr("fill", color);
  return ig;
}

/** Icône pour le HTML du Studio (tuiles, menus). */
export function iconSvg(name: string, size = 18): string {
  const d = PHOSPHOR[name];
  return d ? `<svg viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>` : "";
}

/** Choix proposés dans le panneau (libellé français trié). */
export function iconChoices(): [string, string][] {
  return Object.entries(ICON_LABELS)
    .filter(([n]) => n !== "minus")
    .sort((a, b) => a[1].localeCompare(b[1], "fr"));
}
