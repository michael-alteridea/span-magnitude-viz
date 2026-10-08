# Démo : pipeline commercial 2026 — dictionnaire des données

**Données entièrement fictives** de la société de démonstration **Norvia** (clients, commerciaux et montants inventés), générées de façon
déterministe par `studio/scripts/make-demo-pipeline.ts` (graine 20261008) à partir de `studio/src/data/demoPipeline.ts`.
Extrait du CRM (fictif) de Norvia au **8 octobre 2026**.

- Fichier : `pipeline-commercial-2026.csv` — UTF-8, séparateur `;`, décimales à la virgule, 1 975 lignes.
- Une ligne = une opportunité créée entre le 2 janvier 2025 et le 30 septembre 2026 (jours ouvrés).
- Clôtures prévues jusqu'au 31 décembre 2026.

| Colonne | Type | Description |
| --- | --- | --- |
| `id_opportunite` | texte | Identifiant (`OPP-25-00001`…) |
| `date_creation` | date (aaaa-mm-jj) | Date de création de l'opportunité |
| `mois` | aaaa-mm | Mois de création |
| `trimestre` | texte | Trimestre de création (`T2 2026`) |
| `region` | catégorie | Bruxelles, Flandre, Wallonie, Hauts-de-France, Île-de-France |
| `pays` | catégorie | Belgique, France |
| `commercial` | catégorie | Commercial responsable (3 à 5 par région, 18 au total) |
| `client` | texte | Client (nom fictif) |
| `secteur` | catégorie | Secteur d'activité du client |
| `etape` | catégorie | Prospection, Qualification, Proposition, Négociation, Gagné, Perdu |
| `montant_eur` | nombre | Montant de l'opportunité, en euros (5 000 à 150 000) |
| `probabilite_pct` | nombre | Probabilité de l'étape, en % (10, 25, 50, 75, 100, 0) |
| `montant_pondere_eur` | nombre | Montant × probabilité, en euros |
| `date_cloture_prevue` | date (aaaa-mm-jj) | Clôture prévue (ou effective pour Gagné / Perdu) |

## Histoire contenue dans les données

1. Le pipeline créé croît trimestre après trimestre (≈ 4,0 M€ au T1 2025 → 5,2 M€ au T3 2026), sauf au **T2 2026** (−3,8 % vs T1 2026).
2. Le recul tient à **juin 2026** : 1,3 M€ créés, −22 % vs la moyenne mars–mai 2026.
3. La baisse est concentrée en **Wallonie** (215 k€ en juin contre 595 k€ en moyenne, −64 %) ; les 4 autres régions sont stables.
4. En Wallonie, **Julie M.** ne crée aucune opportunité en juin (13 en moyenne sur mars–mai, 63 % du pipeline wallon), ses collègues sont stables ; elle reprend en juillet.
5. **Août** est bas dans toutes les régions (saisonnalité), ce n'est pas le sujet.

Utilisation : exemple intégré « Démo : pipeline commercial » du Studio, puis **Scénarios → Scénario Directeur commercial**
(automatique ou pas à pas). Le CSV peut aussi être importé tel quel : l'exploration guidée devine les rôles des colonnes.

Revue partagée : dans le Studio, bouton **Revues** → « Revue pipeline — octobre 2026 » (Norvia, Direction commerciale),
construite à partir des 7 snapshots du scénario, avec participants, lectures, questions, décisions et actions fictifs.
