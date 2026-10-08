# Contrat Datanime → Cadencer : « manifeste de revue » (V1, révision 1.1)

*Version 1, révision 1.1 — 8 octobre 2026 (ajouts compatibles : `version` reste `1`, voir « Révision 1.1 » en fin de
document). Côté Datanime : `studio/src/publish/manifest.ts` (schéma Zod, adresses, construction),
`studio/scripts/publish-manifests.mjs` (publication à la construction), tests `studio/test/manifest.test.ts`.*

## Répartition des rôles

| | Cadencer | Datanime |
|---|---|---|
| Rôle | anime la réunion : salle en direct, QR `/join/<code>`, accusés de lecture (vu / d'accord / question), tâches, PV | fournit les snapshots : image, titre d'action, commentaires, chemin d'exploration, lien de lecture |
| V1 | importe un manifeste **par URL, côté serveur**, et crée un point d'ordre du jour par snapshot (source `datanime`) | publie un **JSON statique public** par revue et une image par snapshot |

Modèle **en tirage (pull), sans secret partagé** : aucune clé, aucun appel de Datanime vers Cadencer. Le JSON
est public ; ne publier que des données fictives ou partageables (V1 : démonstrations Norvia uniquement).

## Adresses

Toutes les adresses absolues dérivent d'**une seule constante** : `PLATFORM_URL` (`studio/src/brand.ts`),
aujourd'hui `https://alteridea-dashboard.web.app/reporting/` (futur domaine : `datanime.io`, une ligne à changer).

| Ressource | Adresse |
|---|---|
| Index des revues publiées | `GET <PLATFORM_URL>publie/index.json` |
| Manifeste d'une revue | `GET <PLATFORM_URL>publie/<reviewId>/manifeste.json` |
| Image PNG d'un snapshot | `GET <PLATFORM_URL>publie/<reviewId>/<snapshotId>.png?v=<12 hex>` |
| Image SVG d'un snapshot (facultative) | `GET <PLATFORM_URL>publie/<reviewId>/<snapshotId>.svg?v=<12 hex>` |
| Mode lecture (revue / snapshot) | `<PLATFORM_URL>#/lire/<reviewId>` · `<PLATFORM_URL>#/lire/<reviewId>/<snapshotId>` |

Revues publiées (V1) :

- `https://alteridea-dashboard.web.app/reporting/publie/demo-dircom/manifeste.json` — démo « Directeur commercial »
- `https://alteridea-dashboard.web.app/reporting/publie/demo-daf/manifeste.json` — démo « Directeur financier »
- `https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/manifeste.json` — revue pipeline Norvia
- `https://alteridea-dashboard.web.app/reporting/publie/norvia-budget-2026/manifeste.json` — business review budget Norvia

Types de contenu servis par Firebase Hosting : `application/json` (`.json`), `image/png`, `image/svg+xml`.
CORS non nécessaire (import côté serveur).

**Attention :** l'hébergement renvoie la page du Studio (HTTP 200, `text/html`) pour toute adresse inconnue
(application monopage). Une revue absente ne donne donc pas de 404 : **vérifier le `content-type`
(`application/json`) puis `format` / `version`** avant d'importer.

## Manifeste de revue

```
{
  "format": "datanime-revue",            // constant
  "version": 1,                          // entier ; changement incompatible = version 2
  "id": "<reviewId>",                    // [A-Za-z0-9][A-Za-z0-9._-]*, stable
  "titre": "…",
  "persona": "Directeur commercial",     // destinataire type ("" si inconnu)
  "entreprise": "Norvia",                // ("" si inconnue)
  "date_reunion": "2026-10-08T09:00:00+02:00" | null,
  "genere_le": "ISO 8601 avec fuseau",
  "source": "…",                         // sources des données (plusieurs : séparées par « ; »)
  "empreinte": "<64 hex>",               // empreinte des données (voir plus bas)
  "lien_lecture": "<PLATFORM_URL>#/lire/<reviewId>" | null,   // null : manifeste téléchargé (1.1)
  "snapshots": [ {
    "id": "<snapshotId>",                // stable dans une revue (sans empreinte), unique DANS la revue seulement (1.1)
    "position": 1,                       // 1, 2, 3… dans l'ordre du récit
    "titre": "…",                        // titre d'action
    "commentaire_genere": "…",           // synthèse narrative en une phrase (message du snapshot) (1.1)
    "commentaire_animateur": "…" | null, // note de l'animateur·rice
    "a_retenir": ["…"],                  // les puces « À retenir » (0 à 10), jamais identiques à commentaire_genere
    "chemin": "Pipeline créé › T2 2026 › Juin 2026",
    "image_png": "<PLATFORM_URL>publie/<reviewId>/<snapshotId>.png?v=<12 hex>",   // (1.1) ou data:image/png;base64,…
    "image_svg": "<PLATFORM_URL>publie/<reviewId>/<snapshotId>.svg?v=<12 hex>",   // facultatif (champ absent)
    "alt": "…",                          // texte alternatif en français (1.1)
    "lien_lecture": "<PLATFORM_URL>#/lire/<reviewId>/<snapshotId>" | null,      // null : manifeste téléchargé (1.1)
    "empreinte": "<64 hex>"
  } ]
}
```

### Règles

- **Images.** `image_png` : 1600 × 900 px, image complète (titre d'action, sous-titre, graphique, « À retenir »,
  cartouche Datanime avec date de génération, source, empreinte et QR vers `lien_lecture` du snapshot).
  `image_svg` : même rendu en vectoriel, polices intégrées ; facultatif.
- **Adresses d'images versionnées (1.1).** `image_png` et `image_svg` se terminent par `?v=<12 premiers caractères de
  l'empreinte du snapshot>` : une image republiée change d'adresse et ne sort jamais du cache (jusqu'à 1 h) avec
  l'ancien contenu. Le fichier servi garde le même nom (`<snapshotId>.png`) ; le paramètre ne sert qu'à contourner
  les caches. Utiliser l'adresse telle quelle (ne pas retirer `?v=`).
- **Identifiants (1.1).** Un `id` de snapshot n'est unique **qu'au sein d'une revue** : le même snapshot peut
  figurer dans plusieurs revues (ex. `demo-dircom` et `norvia-pipeline-oct-2026` partagent leurs 7 identifiants).
  Côté Cadencer, la clé d'un point d'ordre du jour est **(`reviewId`, `snapshotId`)**, jamais `snapshotId` seul.
- **Id stable dans une revue ; le contenu change → `empreinte` et `?v=` (1.1).** L'`id` d'un snapshot ne contient
  jamais l'empreinte des données : préfixe du scénario + position + intitulé de l'étape (`dircom-03-mois-focus`,
  `daf-01-cascade`). Republier la même revue avec d'autres données garde **exactement les mêmes identifiants** :
  points d'ordre du jour et accusés « J'ai vu » restent attachés. Un changement de contenu se lit uniquement dans
  `empreinte` (snapshot et revue) et dans le paramètre `?v=` des images ; le nom du fichier image (`<snapshotId>.png`),
  le `lien_lecture` et le QR ne changent pas. Compatibilité : les anciens identifiants à suffixe d'empreinte
  (`dircom-03-mois-focus-88z5ap`, `daf-01-cascade-14j5oil`, `daf-05-baisse-mois-1051jsm`…) ouvrent toujours le bon
  snapshot dans `#/lire/…` (suffixe retiré puis rapproché de l'identifiant stable).
- **Commentaires (1.1).** `commentaire_genere` = synthèse narrative **en une phrase** : rôle dans le récit
  (« Pour situer », « Point d'attention », « Ce que montre l'analyse », « À décider »), périmètre (`chemin`) et message
  (titre d'action). `a_retenir` = les puces détaillées. Les deux ne sont jamais identiques (contrôlé par le schéma) :
  afficher `commentaire_genere` en chapeau et `a_retenir` en liste.
- **Texte alternatif (1.1).** `alt` (1 à 1 000 caractères, français) décrit l'image : type de graphique (« Carte des
  régions France · Belgique », « Cascade des écarts »…), périmètre, message et chiffre clé (titre d'action, complété par
  la première puce chiffrée si le titre n'a pas de nombre). À reprendre dans l'attribut `alt` de l'image.
- **Note de l'animateur·rice.** `commentaire_animateur` vaut `null` quand il n'y en a pas (cas de la plupart des
  snapshots). Les deux démonstrations intégrées en renseignent 3 chacune (texte fictif) pour tester l'affichage ;
  `date_reunion` y reste `null`.
- **Liens de lecture.** S'ouvrent sur tout appareil (téléphone compris) pour les revues publiées : le Studio
  recalcule ces histoires depuis les données de démonstration embarquées.
- **Empreintes** (SHA-256, 64 caractères hexadécimaux minuscules) :
  - revue : empreinte des données affichée dans le cartouche (8 premiers caractères, ex. `d923·bd5f`) quand tous
    les snapshots viennent du même jeu de données ; sinon SHA-256 des empreintes de données triées, jointes par « , » ;
  - snapshot : SHA-256 du JSON canonique (clés triées) de son contenu (identifiant, titres, commentaires, chemin,
    spécification du graphique, données) — **change dès que le snapshot change** : Cadencer peut détecter une
    mise à jour et rafraîchir le point d'ordre du jour.
- **Ordre.** `position` vaut 1, 2, 3… sans trou ; identifiants de snapshots uniques dans la revue ; 1 à 24 snapshots.
- **Évolutions.** Champs ajoutés plus tard = compatibles : Cadencer **ignore les champs inconnus**. Changement
  incompatible = `version: 2` (Cadencer refuse une version qu'il ne connaît pas).
- **Déterminisme.** Les manifestes publiés sont reconstruits à chaque `npm run build:studio` avec des dates figées
  (données de démonstration) : octets identiques d'une construction à l'autre tant que le contenu ne change pas.

### Exemple réel (extrait : premier snapshot sur 7)

```json
{
  "format": "datanime-revue",
  "version": 1,
  "id": "norvia-pipeline-oct-2026",
  "titre": "Revue pipeline — octobre 2026",
  "persona": "Directeur commercial",
  "entreprise": "Norvia",
  "date_reunion": "2026-10-08T09:00:00+02:00",
  "genere_le": "2026-10-08T06:30:00+02:00",
  "source": "Source : CRM Norvia (données fictives) · extrait du 8 oct. 2026",
  "empreinte": "d923bd5f307bd229554addaf4c4c2c1ce280921b0786618d11f834e4f8ba1a0a",
  "lien_lecture": "https://alteridea-dashboard.web.app/reporting/#/lire/norvia-pipeline-oct-2026",
  "snapshots": [
    {
      "id": "dircom-01-trimestres",
      "position": 1,
      "titre": "T2 2026 : seul trimestre en recul (−3,8 %) après 4 trimestres de hausse",
      "commentaire_genere": "Pour situer (Pipeline créé) — T2 2026 : seul trimestre en recul (−3,8 %) après 4 trimestres de hausse.",
      "commentaire_animateur": "Premier trimestre en recul depuis début 2025 : on cherche d'où vient l'écart avant de parler du T4.",
      "a_retenir": [
        "Pipeline créé : 4,6 M€ au T2 2026 contre 4,8 M€ au T1 2026 (−180 k€).",
        "Sur la période : de 4 M€ (T1 2025) à 5,2 M€ (T3 2026), +31 %.",
        "T3 2026 repart (+13 %) : à quel mois tient le recul ?"
      ],
      "chemin": "Pipeline créé",
      "image_png": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/dircom-01-trimestres.png?v=9b22a2cc7b9c",
      "image_svg": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/dircom-01-trimestres.svg?v=9b22a2cc7b9c",
      "alt": "Graphique en barres par période : Pipeline créé. T2 2026 : seul trimestre en recul (−3,8 %) après 4 trimestres de hausse.",
      "lien_lecture": "https://alteridea-dashboard.web.app/reporting/#/lire/norvia-pipeline-oct-2026/dircom-01-trimestres",
      "empreinte": "9b22a2cc7b9cb6b2ce6374855f6ec023a6e7c3d1847cc72f6db5a2d45c69e0f9"
    }
  ]
}
```

## Index

```json
{
  "format": "datanime-index",
  "version": 1,
  "genere_le": "2026-10-08T11:30:00+02:00",
  "revues": [
    {
      "id": "norvia-pipeline-oct-2026",
      "titre": "Revue pipeline — octobre 2026",
      "persona": "Directeur commercial",
      "manifeste": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/manifeste.json",
      "empreinte": "d923bd5f307bd229554addaf4c4c2c1ce280921b0786618d11f834e4f8ba1a0a",
      "genere_le": "2026-10-08T06:30:00+02:00",
      "nb_snapshots": 7
    }
  ]
}
```

(extrait : une revue sur 4 ; `revues` liste toutes les revues publiées, `genere_le` = date la plus récente des manifestes.
1.1 : chaque entrée reprend aussi l'`empreinte`, le `genere_le` et le nombre de snapshots (`nb_snapshots`) de son
manifeste : Cadencer peut détecter une revue modifiée sans télécharger le manifeste.)

## Côté Cadencer (import, rappel)

1. Ordre du jour › Ajouter › **Revue Datanime** › coller l'URL du manifeste (ou choisir dans `index.json`).
2. Serveur : `GET` de l'URL ; refuser si `content-type` ≠ `application/json`, `format` ≠ `datanime-revue` ou
   `version` ≠ 1 ; limiter la taille (un manifeste publié pèse ~15 Ko ; un manifeste téléchargé, images intégrées,
   12 Mo au plus, voir « Histoires locales »).
3. Créer un point d'ordre du jour par snapshot (source `datanime`) : `titre`, `image_png` (+ `alt`),
   `commentaire_genere` (chapeau) et `a_retenir` (puces), `commentaire_animateur`, `lien_lecture` ; mémoriser
   (`reviewId`, `id`) + `empreinte` pour les mises à jour.
4. Ré-import de la même URL : mettre à jour les points dont l'`empreinte` a changé, ajouter / retirer les autres.

## Histoires locales (pas encore publiées)

Dans le Studio, « Envoyer vers Cadencer » propose, pour une histoire ou une revue créée sur l'appareil,
**« Télécharger le manifeste »** : même format, `image_png` en `data:image/png;base64,…` (pas d'`image_svg`).

- **Liens (1.1).** `lien_lecture` vaut `null` (revue et snapshots) : les liens de lecture d'une histoire locale ne
  s'ouvrent que sur l'appareil qui l'a créée et ne sont pas partagés. Règle côté Cadencer : ne conserver un
  `lien_lecture` que s'il commence par `https://`.
- **Limites (1.1).** Chaque image intégrée fait **800 000 caractères au plus** (adresse `data:` complète) et le
  fichier **12 Mo au plus** (12 000 000 octets). Le Studio respecte ces limites au téléchargement : budget partagé
  entre les snapshots, image réduite par paliers (1 280, 1 024, 800, 640 px de large) puis, en dernier recours,
  palette réduite ; un message avertit si une limite reste dépassée (retirer des snapshots avant l'envoi). Cadencer
  peut refuser au-delà.

La publication en ligne des histoires personnelles arrive avec l'enregistrement en ligne.

## Limites V1

- Revues publiées : uniquement les 4 histoires autonomes de démonstration (données fictives Norvia).
- Pas d'écriture retour (accusés de lecture, questions, décisions restent dans Cadencer) ; pas de webhook.
- Mise en cache Firebase par défaut (jusqu'à 1 h) : un manifeste mis à jour peut mettre jusqu'à une heure à être vu.

## Révision 1.1 (8 octobre 2026) — ajouts compatibles, `version` reste 1

Suite à la revue du contrat par Cadencer :

1. Adresses d'images versionnées : `image_png` / `image_svg` se terminent par `?v=<12 hex de l'empreinte du snapshot>`.
2. Identifiants de snapshots uniques au sein d'une revue seulement : clé (`reviewId`, `snapshotId`).
3. `commentaire_genere` = synthèse narrative en une phrase, distincte des puces `a_retenir` (contrôlé par le schéma).
4. Démonstrations : `commentaire_animateur` fictif sur 3 snapshots chacune (`date_reunion` reste `null`).
5. Nouveau champ `alt` par snapshot (texte alternatif en français).
6. Index : `empreinte`, `genere_le`, `nb_snapshots` par revue.
7. Manifeste téléchargé : `lien_lecture` = `null` (liens propres à l'appareil, non partagés) ; ne garder que les liens `https://`.
8. Manifeste téléchargé : 800 000 caractères au plus par image intégrée, 12 Mo au plus par fichier.
9. « id stable dans une revue ; le contenu change → empreinte et ?v= » : les identifiants de snapshots ne contiennent
   plus l'empreinte des données (`dircom-01-trimestres` au lieu de `dircom-01-trimestres-88z5ap`) ; les anciens liens
   `#/lire/…` restent valides.

Un consommateur 1.0 reste compatible : il ignore `alt` et les nouveaux champs d'index, et charge les adresses
d'images telles quelles. Changements à prévoir : `lien_lecture` peut être `null` dans un manifeste téléchargé ; au
premier import après le point 9, les points déjà créés avec un ancien identifiant (suffixe d'empreinte) sont à
rapprocher une fois de l'identifiant stable (même règle : retirer le suffixe `-<empreinte>`), ensuite plus jamais.
