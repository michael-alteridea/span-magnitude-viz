/**
 * Notes d'animateur·rice fictives des deux démonstrations intégrées (« Directeur commercial », « Directeur financier ») :
 * renseignées sur 3 snapshots chacune pour que Cadencer puisse tester l'affichage de `commentaire_animateur`
 * (les autres snapshots restent à null, comme dans une vraie revue). Données de démonstration Norvia uniquement.
 */
import { matchSnapshotId } from "../story/scenarios";

export const DEMO_ANIMATOR_NOTES: Record<string, Record<string, string>> = {
  "demo-dircom": {
    "dircom-02-mois": "Juin est le seul mois en retrait : on regarde d'où vient l'écart avant de parler du T3.",
    "dircom-04-carte": "La Wallonie explique à elle seule la baisse : inviter le responsable régional au prochain point.",
    "dircom-07-commerciaux": "Proposition à valider en séance : un relais désigné pour chaque absence de plus de deux semaines.",
  },
  "demo-daf": {
    "daf-01-cascade": "Commencer par Équipements : c'est l'écart qui pèse le plus sur le budget.",
    "daf-03-hausse-mois": "Demander aux ventes la liste des contrats Plateforme attendus à partir de juillet.",
    "daf-05-baisse-mois": "Le contrôle de gestion confirme d'ici au prochain comité si le contrat distributeur est perdu.",
  },
};

const NOTE_KEYS: Record<string, true> = Object.fromEntries(Object.values(DEMO_ANIMATOR_NOTES).flatMap((t) => Object.keys(t).map((k) => [k, true as const])));

/** Clé d'un snapshot de démonstration : l'identifiant stable (un ancien suffixe d'empreinte est ignoré). */
export const demoNoteKey = (snapId: string): string => matchSnapshotId(Object.keys(NOTE_KEYS), snapId) ?? snapId;

/** Notes d'une démonstration, indexées par identifiant de snapshot. */
export function demoNotesFor(storyId: string, snapIds: string[]): Record<string, string> {
  const table = DEMO_ANIMATOR_NOTES[storyId];
  if (!table) return {};
  const out: Record<string, string> = {};
  for (const id of snapIds) {
    const n = table[demoNoteKey(id)];
    if (n) out[id] = n;
  }
  return out;
}
