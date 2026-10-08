# Contrat Datanime → Cadencer : « manifeste de revue » (V1)

*Version 1 — 8 octobre 2026. Côté Datanime : `studio/src/publish/manifest.ts` (schéma Zod, adresses, construction),
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
| Image PNG d'un snapshot | `GET <PLATFORM_URL>publie/<reviewId>/<snapshotId>.png` |
| Image SVG d'un snapshot (facultative) | `GET <PLATFORM_URL>publie/<reviewId>/<snapshotId>.svg` |
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
  "lien_lecture": "<PLATFORM_URL>#/lire/<reviewId>",
  "snapshots": [ {
    "id": "<snapshotId>",                // stable d'une publication à l'autre
    "position": 1,                       // 1, 2, 3… dans l'ordre du récit
    "titre": "…",                        // titre d'action
    "commentaire_genere": "…",           // commentaires calculés en un paragraphe
    "commentaire_animateur": "…" | null, // note de l'animateur·rice
    "a_retenir": ["…"],                  // les mêmes commentaires, en puces (0 à 10)
    "chemin": "Pipeline créé › T2 2026 › Juin 2026",
    "image_png": "<PLATFORM_URL>publie/<reviewId>/<snapshotId>.png",
    "image_svg": "<PLATFORM_URL>publie/<reviewId>/<snapshotId>.svg",   // facultatif (champ absent)
    "lien_lecture": "<PLATFORM_URL>#/lire/<reviewId>/<snapshotId>",
    "empreinte": "<64 hex>"
  } ]
}
```

### Règles

- **Images.** `image_png` : 1600 × 900 px, image complète (titre d'action, sous-titre, graphique, « À retenir »,
  cartouche Datanime avec date de génération, source, empreinte et QR vers `lien_lecture` du snapshot).
  `image_svg` : même rendu en vectoriel, polices intégrées ; facultatif.
- **Liens de lecture.** S'ouvrent sur tout appareil (téléphone compris) pour les revues publiées : le Studio
  recalcule ces histoires depuis les données de démonstration embarquées.
- **Empreintes** (SHA-256, 64 caractères hexadécimaux minuscules) :
  - revue : empreinte des données affichée dans le cartouche (8 premiers caractères, ex. `d923·bd5f`) quand tous
    les snapshots viennent du même jeu de données ; sinon SHA-256 des empreintes de données triées, jointes par « , » ;
  - snapshot : SHA-256 du JSON canonique (clés triées) de son contenu (identifiant, titres, commentaires, chemin,
    spécification du graphique, données) — **change dès que le snapshot change** : Cadencer peut détecter une
    mise à jour et rafraîchir le point d'ordre du jour.
- **Ordre.** `position` vaut 1, 2, 3… sans trou ; identifiants de snapshots uniques ; 1 à 24 snapshots.
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
      "id": "dircom-01-trimestres-88z5ap",
      "position": 1,
      "titre": "T2 2026 : seul trimestre en recul (−3,8 %) après 4 trimestres de hausse",
      "commentaire_genere": "Pipeline créé : 4,6 M€ au T2 2026 contre 4,8 M€ au T1 2026 (−180 k€). Sur la période : de 4 M€ (T1 2025) à 5,2 M€ (T3 2026), +31 %. T3 2026 repart (+13 %) : à quel mois tient le recul ?",
      "commentaire_animateur": "Premier trimestre en recul depuis début 2025 : on cherche d'où vient l'écart avant de parler du T4.",
      "a_retenir": [
        "Pipeline créé : 4,6 M€ au T2 2026 contre 4,8 M€ au T1 2026 (−180 k€).",
        "Sur la période : de 4 M€ (T1 2025) à 5,2 M€ (T3 2026), +31 %.",
        "T3 2026 repart (+13 %) : à quel mois tient le recul ?"
      ],
      "chemin": "Pipeline créé",
      "image_png": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/dircom-01-trimestres-88z5ap.png",
      "image_svg": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/dircom-01-trimestres-88z5ap.svg",
      "lien_lecture": "https://alteridea-dashboard.web.app/reporting/#/lire/norvia-pipeline-oct-2026/dircom-01-trimestres-88z5ap",
      "empreinte": "3e82fc50fa44e17e93562b501a1438ccb039f3ee6f04bc9c0d613e3c1ca4bf4f"
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
      "manifeste": "https://alteridea-dashboard.web.app/reporting/publie/norvia-pipeline-oct-2026/manifeste.json"
    }
  ]
}
```

(extrait : une revue sur 4 ; `revues` liste toutes les revues publiées, `genere_le` = date la plus récente des manifestes.)

## Côté Cadencer (import, rappel)

1. Ordre du jour › Ajouter › **Revue Datanime** › coller l'URL du manifeste (ou choisir dans `index.json`).
2. Serveur : `GET` de l'URL ; refuser si `content-type` ≠ `application/json`, `format` ≠ `datanime-revue` ou
   `version` ≠ 1 ; limiter la taille (un manifeste publié pèse ~10 Ko ; un manifeste téléchargé, images intégrées, quelques Mo).
3. Créer un point d'ordre du jour par snapshot (source `datanime`) : `titre`, `image_png`, `commentaire_genere`
   (ou `a_retenir`), `commentaire_animateur`, `lien_lecture` ; mémoriser `id` + `empreinte` pour les mises à jour.
4. Ré-import de la même URL : mettre à jour les points dont l'`empreinte` a changé, ajouter / retirer les autres.

## Histoires locales (pas encore publiées)

Dans le Studio, « Envoyer vers Cadencer » propose, pour une histoire ou une revue créée sur l'appareil,
**« Télécharger le manifeste »** : même format, `image_png` en `data:image/png;base64,…` (pas d'`image_svg`),
`lien_lecture` vers ce même appareil. La publication en ligne des histoires personnelles arrive avec
l'enregistrement en ligne.

## Limites V1

- Revues publiées : uniquement les 4 histoires autonomes de démonstration (données fictives Norvia).
- Pas d'écriture retour (accusés de lecture, questions, décisions restent dans Cadencer) ; pas de webhook.
- Mise en cache Firebase par défaut (jusqu'à 1 h) : un manifeste mis à jour peut mettre jusqu'à une heure à être vu.
