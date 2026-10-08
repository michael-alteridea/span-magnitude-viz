# Backlog Datanime

> Mis à jour le 9 octobre 2026. Ce fichier regroupe en un seul endroit les idées, promesses et suites dispersées dans le dépôt et à côté.

**Règles de travail**

- **Rythme** : environ **un jour par semaine** sur Datanime tant que **Cadencer reste la priorité**.
- **Feu vert** : rien de nouveau ne démarre sans l'accord explicite de Michaël. Ce backlog sert de liste, pas de planning engagé.
- **Pas de chiffres réels** : aucun chiffre d'affaires ni montant réel ici. Les prix étudiés restent dans `datanime-landing/PRICING-OPTIONS.md`, qui est un document de travail.
- **À ne pas casser** : les empreintes des snapshots lues par Cadencer (`snapshotFingerprint`) et les liens profonds existants (voir `mockups/dataset-flow/NOTES.md`, « Risques », l. 79-92).

**Priorités**

- **P1** : en cours, ou nécessaire au pont avec Cadencer.
- **P2** : prochaine vague, une fois les déploiements en cours terminés.
- **P3** : plus tard, après les pilotes ou après un accord à obtenir.
- **P2/P3** : la priorité reste à trancher. Ces lignes sont rangées dans la table P2.

**Statuts** : en cours · prévu · promis (annoncé dans un échange) · à faire · bloqué · à trancher.

**Sources**

- Source principale : l'audit `/workspace/alteridea-gtm/audit-idees/datanime.md`, n° 63-92 (l. 100-129).
- Les numéros de ligne de `studio/README.md` sont ceux du commit `cc53b7f`. Le fichier est en cours de modification : la section « Extensions prévues » descend vers la l. 721.

---

## P1 : en cours et pont Cadencer

| Idée | Priorité | Statut | Source | Note |
|---|---|---|---|---|
| **Séquence enregistrable** (déploiement 1) : la séquence (ex-« Histoire ») s'enregistre, avec « Réinitialiser ▾ » et « Mes projets » | P1 | en cours | `studio/README.md` § « Projets (modèle « dataset d'abord », déploiement 1) » (copie de travail, non commitée) ; `mockups/dataset-flow/NOTES.md` l. 94-98 ; audit n° 63 | Code non commité : `studio/src/project/`, `ui/projectsDialog.ts`, `ui/confirm.ts`, `test/project.test.ts`. Empreintes et liens profonds inchangés |
| **Datasets dérivés + panneau unique « Datasets »** (déploiement 2) : vues filtrées et nommées d'une source ; fusion des menus Données | P1 | prévu (après le déploiement 1) | `NOTES.md` l. 19-38 (modèle), l. 96 et 99 ; audit n° 63 | Ordre : 1 modèle/stockage → 2 Datasets → 3 Séquence → 4 Mes projets. La Séquence passe d'abord |
| **Pont Cadencer, côté Cadencer** : relecture, fusion et staging de la PR n° 5 « Revue Datanime : un point par snapshot » | P1 | bloqué (staging) | `michael-alteridea/cadencer` PR #5 ; audit n° 73 | PR ouverte, non fusionnée. Staging en attente de l'accès gcloud de Michaël. Ajouter `datanime.io` à `DATANIME_HOSTS` (une ligne) quand le domaine existera |

## P2 : prochaine vague

| Idée | Priorité | Statut | Source | Note |
|---|---|---|---|---|
| **Sélection par touchers successifs** : chaque toucher ajoute un élément mis en avant, sur 3-4 images | P2 | prévu | `NOTES.md` l. 59-71 et l. 100 (phase 6) ; maquettes `mockups/dataset-flow/` (série A) ; audit n° 64 | Après les déploiements 1 et 2 |
| **« Forme des points » du nuage** : ronds / une icône / une icône par groupe | P2 | promis (9/10) | audit n° 88 (promesse du 09/10, 00:07) | Après la Séquence |
| **Versions d'un dataset** : remplacer les données d'un dataset utilisé par N scènes | P2 | prévu | `NOTES.md` l. 99 (phase 5) | Suit les Datasets dérivés |
| **Export GIF** | P2 | à faire | `studio/README.md` l. 50 et l. 689 (`exportGif()`, même boucle d'images que le WebM) ; audit n° 66 | Entrée de menu grisée « Prévu en V2 » |
| **Course de barres** à côté du GIF | P2/P3 | à trancher | audit n° 85 | Idée oubliée depuis le 08/10, retrouvée par l'audit |
| **Fonds de carte Monde** issus de la R&D (Natural Earth, 236 pays, projection Equal Earth) | P2/P3 | à trancher | `/workspace/datanime-maps/world-countries-*` (110m, 50m, `.csv`, `demo-world.html`) ; audit n° 89 | Aujourd'hui `src/geo` ne contient que `europe` et `frBe` |
| **Acheter `datanime.io`** puis basculer `PLATFORM_URL` / `VERIFY_BASE` | P2 | à faire (décision Michaël) | `datanime-landing/README.md` l. 3 et l. 95-99 ; `studio/docs/contrat-cadencer.md` l. 24 ; audit n° 76 | Un changement d'une ligne côté Studio. Côté Cadencer, `DATANIME_HOSTS` |
| **Marque, accord écrit de l'employeur, mentions légales** | P2 | à faire | `datanime-landing/README.md` l. 4-5, l. 55, l. 95-99 ; audit n° 77 | La landing reste en `noindex` et ne se déploie pas avant cet accord |

## P3 : plus tard

| Idée | Priorité | Statut | Source | Note |
|---|---|---|---|---|
| **Page multi-graphiques** (1+2, 2×2, grand + côté), cartouche commun, une page = une scène | P3 | prévu | `NOTES.md` l. 73-77 et l. 101 (phase 7) ; maquettes série B ; `/workspace/valueroom/STUDIO-PLAN.md` l. 13 et l. 83 ; audit n° 65 | S'aligner sur la grille `vr-layout/1` de ValueRoom et sur le moteur AlterideaCharts |
| **Scénario « Directeur général »** | P3 | à faire | audit n° 83 (08/10, 14:58) | Idée oubliée, retrouvée par l'audit |
| **Connecteur base de données / CRM / Google Sheets** | P3 | à faire | audit n° 84 | Après les pilotes |
| **Barres avant/après dans le Studio** | P3 | à faire | `moteur/README.md` l. 64 (`beforeAfter`, moteur AlterideaCharts 0.1.0, commit `cc53b7f`) ; audit n° 86 | Réutiliser le moteur plutôt que réécrire |
| **Pictogrammes qui s'étirent** | P3 | promis (8/10) | audit n° 87 (promesse du 08/10, 20:26) | |
| **Modèles de Reel** : impôts en Belgique (Statbel), pandémie, électricité en Belgique | P3 | à faire | audit n° 90 ; `/workspace/datanime-reels/datasets.md` | Vérifier d'abord la licence commerciale de chaque jeu. Après l'accord OBS |
| **Mettre Node à jour** dans le workflow de déploiement d'alteridea-dashboard | P3 | à faire | `dash/.github/workflows/publier-mur.yml` l. 14 (`node-version: 20`) ; audit n° 92 | |
| **Film Datanime de 15 s pour le lancement de chausoeur.com** | P3 | à faire | `/workspace/alteridea-gtm/audit-idees/chausoeur.md` n° 12 (l. 30) et l. 62 ; proposé par le bot Chausœur le 08/10 | Après le travail Cadencer. Sert aussi de démonstration croisée Alteridea |
| **Chartes graphiques** (palette, police, fond, logo) | P3 | à faire | `studio/README.md` l. 686 (`style.charterId` réservé dans `spec.ts`) ; audit n° 67 | |
| **Superposer deux fichiers** (jointure par clé) | P3 | à faire | `studio/README.md` l. 687 ; audit n° 68 | Le modèle Source → Datasets le prépare |
| **Bibliothèque de 100 à 200 pictogrammes** | P3 | à faire (partiel) | `studio/README.md` l. 688 ; audit n° 69 | 77 icônes Phosphor existent déjà |
| **Sauvegarde en ligne (Firestore) et partage** des histoires | P3 | à faire | `studio/README.md` l. 271, 283, 338, 690 ; `studio/docs/contrat-cadencer.md` l. 230 ; audit n° 70 | Même interface que le stockage local actuel |
| **Version IA des titres** | P3 | à faire | `studio/README.md` l. 67 (`NarrativeRewriter`, non branchée) ; audit n° 71 | |
| **Registre en ligne des empreintes** | P3 | à faire | `studio/README.md` l. 147 ; audit n° 72 | Renforce la vérification de provenance |
| **Retour de Cadencer vers Datanime** : taux de lecture, décisions, webhook signé à la clôture, CSP en cas d'iframe | P3 | à faire | PR #5, « Limites et suites » ; `studio/docs/contrat-cadencer.md` l. 235 ; audit n° 74 | Après la fusion de la PR n° 5 |
| **« Film des actions » dans Cadencer** | P3 | à faire | `/workspace/alteridea-gtm/RECO-CADENCER-REPORTING4D.md` (option post-S1) ; audit n° 75 | Ne bloque pas S1 |
| **Notion de « décision » dans Cadencer** | P3 | à trancher | audit n° 91 | L'audit la juge incertaine |
| **Formulaire de la landing → Odoo** via le hub | P3 | à faire | `datanime-landing/README.md` l. 60 et l. 73-80 ; audit n° 78 | |
| **Landing en anglais** | P3 | à faire | `datanime-landing/README.md` l. 8 ; audit n° 79 | |
| **Créateur de Reel gratuit et open source**, à terme | P3 | à trancher | `datanime-landing/PRICING-OPTIONS.md` l. 10-11 ; audit n° 80 | |
| **Choisir la grille de prix** et répondre aux questions ouvertes | P3 | à trancher | `datanime-landing/PRICING-OPTIONS.md` l. 86-100 (questions l. 93-100) ; audit n° 81 | Après 3 à 5 pilotes. Aucun montant ici |
| **Domaine `reporting.alteridea.com`** | P3 | à trancher | `studio/README.md` l. 5 et l. 138 ; audit n° 82 | Sans doute remplacé par `datanime.io` |

---

## Récapitulatif

| Priorité | Lignes |
|---|---|
| P1 | 3 |
| P2 (dont 2 en P2/P3) | 8 |
| P3 | 22 |
| **Total** | **33** |
