/**
 * Projets d'exemple intégrés : fichiers `.datanime` livrés avec le Studio (dossier `exemples/` du site),
 * ouverts sans import par le lien direct `?projet=<id>` ou depuis « Ouvrir des données » › Exemples.
 * Module pur (aucun accès DOM ni stockage) : testé par vitest.
 */
import { parseProjectFile, type Project } from "./project";

export interface ExampleProject {
  id: string;
  name: string;
  description: string;
  /** Fichier sous `exemples/` (chemin relatif au Studio). */
  file: string;
}

export const EXAMPLE_PROJECTS: readonly ExampleProject[] = [
  {
    id: "navigation-dimensions",
    name: "Navigation par dimension",
    description: "Province, secteur, année, type : un clic change l'axe et montre ce que chaque dimension fait",
    file: "exemples/navigation-dimensions.datanime",
  },
  {
    id: "petrole-mazout",
    name: "Pétrole et mazout, en euros",
    description: "Brent (€/baril) et mazout belge (€/litre), 2019-2026 : deux axes, une scène prête",
    file: "exemples/petrole-mazout.datanime",
  },
  {
    id: "mazout-decroche",
    name: "Le mazout décroche du pétrole",
    description: "Mazout belge et Brent en euros, annuel 2019-2025 et mensuel nov. 2025 - août 2026 : 7 scènes, rapport mazout / brut",
    file: "exemples/mazout-decroche.datanime",
  },
  {
    id: "jeunes-belgique",
    name: "Un peu plus de jeunes, beaucoup plus d'étudiants",
    description: "Belgique 1995-2024 : 0-14 ans, 15-24 ans (course année par année) et étudiants du supérieur, 7 scènes",
    file: "exemples/jeunes-belgique.datanime",
  },
  {
    id: "louvain-hainaut",
    name: "HE Louvain en Hainaut : le V et le rebond",
    description: "Étudiants finançables pondérés (domaine 19, 10 HE, RP2020-RP2026) et dossiers acceptés Charleroi / Mons : course 4D, 7 scènes",
    file: "exemples/louvain-hainaut.datanime",
  },
  {
    id: "spans-exemple",
    name: "Six chantiers, en spans",
    description: "Exemple inventé : six chantiers, chaque barre du début à la fin, épaisseur = coût (millions €), révélés dans le temps (film 4D)",
    file: "exemples/spans-exemple.datanime",
  },
];

/** Projet d'exemple désigné par la valeur de `?projet=` (insensible à la casse et aux espaces), sinon null. */
export function exampleProjectById(id: string | null | undefined): ExampleProject | null {
  if (!id) return null;
  const k = id.trim().toLowerCase();
  return EXAMPLE_PROJECTS.find((e) => e.id === k) ?? null;
}

/** Adresse du fichier d'un exemple, relative à la page du Studio (fonctionne sous n'importe quel sous-chemin). */
export function exampleProjectUrl(e: ExampleProject, base: string): string {
  return new URL(e.file, base).href;
}

/** Charge et lit un projet d'exemple (même lecture qu'un fichier `.datanime` importé). */
export async function loadExampleProject(e: ExampleProject, base: string, fetcher: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): Promise<Project> {
  const res = await fetcher(exampleProjectUrl(e, base));
  if (!res.ok) throw new Error(`Exemple « ${e.name} » introuvable (HTTP ${res.status})`);
  const parsed = parseProjectFile(await res.json());
  if ("legacy" in parsed) throw new Error(`Exemple « ${e.name} » : fichier de projet attendu`);
  return parsed.project;
}

/** Adresse de la page sans le paramètre `projet` (les autres paramètres et le fragment sont gardés). */
export function withoutProjectParam(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("projet");
  return u.pathname + u.search + u.hash;
}
