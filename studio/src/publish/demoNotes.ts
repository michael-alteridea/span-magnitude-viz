/**
 * Notes d'animateur·rice fictives des deux démonstrations intégrées (« Directeur commercial », « Directeur financier ») :
 * renseignées sur 3 snapshots chacune pour que Cadencer puisse tester l'affichage de `commentaire_animateur`
 * (les autres snapshots restent à null, comme dans une vraie revue). Données de démonstration Norvia uniquement.
 */
export const DEMO_ANIMATOR_NOTES: Record<string, Record<string, string>> = {
  "demo-dircom": {
    "dircom-02-mois": "Juin est le seul mois en retrait : on regarde d'où vient l'écart avant de parler du T3.",
    "dircom-04-carte": "La Wallonie explique à elle seule la baisse : inviter le responsable régional au prochain point.",
    "dircom-07-commerciaux": "Proposition à valider en séance : un relais désigné pour chaque absence de plus de deux semaines.",
  },
  "demo-daf": {
    "daf-01-cascade": "Commencer par SN/Legacy : c'est l'écart qui pèse le plus sur le budget.",
    "daf-03-hausse-mois": "Demander aux ventes la liste des contrats Cloud attendus à partir de juillet.",
    "daf-05-baisse-mois": "Le contrôle de gestion confirme d'ici au prochain comité si le contrat de maintenance est perdu.",
  },
};

/** Clé stable d'un snapshot de démonstration (« dircom-02-mois-88z5ap » → « dircom-02-mois »). */
export const demoNoteKey = (snapId: string): string => snapId.replace(/-[a-z0-9]{5,8}$/, "");

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
