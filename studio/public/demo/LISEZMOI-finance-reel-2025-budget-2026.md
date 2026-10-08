# Démo : réel 2025 vs budget 2026 — dictionnaire des données

**Données entièrement fictives** (entités, lignes métier, comptes et montants inventés), générées de façon
déterministe par `studio/scripts/make-demo-finance.ts` (graine 20261009) à partir de `studio/src/data/demoFinance.ts`.
Budget 2026 arrêté au **8 octobre 2026** par le contrôle de gestion de démonstration.

- Fichier : `finance-reel-2025-budget-2026.csv` — UTF-8, séparateur `;`, décimales à la virgule, 2 520 lignes.
- Une ligne = un montant mensuel pour une version, un compte, une entité et une région.
- Deux versions : « Réel 2025 » (janvier à décembre 2025) et « Budget 2026 » (janvier à décembre 2026).

| Colonne | Type | Description |
| --- | --- | --- |
| `version` | catégorie | Réel 2025, Budget 2026 |
| `mois` | aaaa-mm | Mois comptable |
| `ligne_metier` | catégorie | Plateforme, Équipements, Services, Licences, Formation |
| `nature` | catégorie | Revenus, Coûts |
| `compte` | catégorie | 21 comptes (Abonnements annuels, Contrats distributeurs, Coûts d'infrastructure…) |
| `entite` | catégorie | Norvia Belgique SA, Norvia France SAS |
| `region` | catégorie | Bruxelles, Flandre, Wallonie, Hauts-de-France, Île-de-France |
| `montant_eur` | nombre | Montant en euros, toujours positif ; la colonne `nature` indique s'il s'agit d'un revenu ou d'un coût |

Mesure de la démo : **marge contributive** = revenus − coûts.

## Histoire contenue dans les données

1. La marge contributive passe de **18,1 M€** (Réel 2025) à **17,7 M€** (Budget 2026), soit **−0,4 M€**.
2. **Plateforme : +2,1 M€** (4,8 → 6,9 M€, +44 %), dont +2,6 M€ de revenus et +0,5 M€ de coûts (infrastructure surtout).
   Les Abonnements annuels portent +2,0 M€, dont 75 % au second semestre (contrats attendus à partir de juillet).
3. **Équipements : −3,0 M€**, dont −3,6 M€ de revenus et −0,6 M€ de coûts (sous-traitance).
   La Contrats distributeurs perd 360 k€ par mois **à partir de mars 2026** (contrat d'Île-de-France non renouvelé fin février).
4. Par région, **l'Île-de-France** est la seule en recul (−2,1 M€, −28 %) ; les 4 autres progressent de +1,7 M€ au total.
5. Les autres lignes bougent peu : Services +0,4 M€, Licences +0,3 M€, Formation −0,2 M€.

Utilisation : exemple intégré « Démo : réel vs budget » du Studio, puis **Scénarios → Scénario Directeur financier**
(automatique ou pas à pas). Le CSV peut aussi être importé tel quel : l'exploration devine la version, la nature et les niveaux.

Mode lecture (sur n'importe quel appareil : l'histoire est recalculée à partir de ces mêmes données) :
https://alteridea-dashboard.web.app/reporting/#/lire/demo-daf/daf-05-baisse-mois
