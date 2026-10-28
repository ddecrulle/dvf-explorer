# DPE représentatifs BDNB dans DVF Explorer

## Modèle et parcours

Le modèle DVF existant transmet `Sale.parcels` (identifiants cadastraux complets),
`date`, `kind`, `surface` et `multi` à `ParcelDpe`. La recherche historique ADEME
`GET /api/parcels/{parcel}/dpe?at=...` demeure filtrée à la date de vente.

Une consultation indépendante `GET /api/parcels/{parcel}/bdnb` ajoute le contexte
actuel du bâtiment à la fiche transaction et à la fiche parcelle :

1. Filtre exact `rel_batiment_groupe_parcelle.parcelle_id`, préfixe cadastral inclus.
2. Conservation de chaque `batiment_groupe_id` et de `parcelle_principale`.
3. Jointure exacte sur `batiment_groupe_dpe_representatif_logement`.
4. Vérification groupée des `identifiant_dpe` par égalité de numéro dans l’ADEME
   (`numero_dpe` du jeu `dpe03existant`). Aucun rapprochement par proximité.

Les réponses exposent `buildings[].representative`, distinct des `diagnostics`
historiques. Les valeurs BDNB et ADEME demeurent séparées, y compris en cas de
classes divergentes. Aucun badge de rapprochement probable n’est créé par BDNB.
Les dates ADEME permettent seulement de signaler si la période couvre la vente,
pas de prouver le certificat annexé à l’acte. Le contexte BDNB reste consultable
même pour une vente antérieure à juillet 2021 ou une panne de la recherche ADEME
historique.

## Vérification réelle du 28 octobre 2026

Le code `bdnb._fetch`, avec les paramètres de production, a été exécuté contre les
API officielles, sans simulation, pour `16358000AY0151` :

| Champ | Valeur observée |
| --- | --- |
| Groupe BDNB | `bdnb-bg-WX3S-753T-TSTR` |
| Parcelle principale | oui |
| DPE représentatif | `2416E2621326Z` |
| Énergie / GES dans BDNB et ADEME | D / B |
| Type / surface | maison / 97 m² |
| Adresse ADEME | 15 Allee Edith Piaf 16710 Saint-Yrieix-sur-Charente |
| Établissement ADEME | 19 juillet 2024 |
| Fin de validité publiée ADEME | 18 juillet 2034 |
| Horodatage brut BDNB | `2024-07-18T22:00:00` |

L’adresse demandée « 15 rue Édith-Piaf » est donc normalisée « Allée » dans cette
réponse. Le rapprochement utilise la parcelle, puis le bâtiment, puis le numéro
exact du certificat ; il ne dépend pas de cette différence de libellé.
L’écart d’horodatage entre BDNB et ADEME est conservé, sans supposer une correction
de fuseau. Pour la date officielle du certificat, l’interface affiche l’ADEME.
Le résultat ne démontre pas que ce certificat accompagnait une transaction donnée.

## Limites et exploitation

- Le DPE représentatif est une sélection CSTB à l’échelle du groupe de bâtiments.
  Il peut porter sur un appartement, une maison ou un immeuble et ne vaut pas pour
  tous les logements. Plusieurs bâtiments restent affichés séparément.
- Il s’agit de l’état BDNB interrogé aujourd’hui, pas d’une reconstitution à la
  date de vente. Les classes ADEME peuvent aussi être révisées après la vente.
- L’API utilisée ne fournit pas de millésime dans ces réponses : la date de
  consultation est tracée, mais aucun millésime n’est inventé. Les identifiants et
  associations cadastrales peuvent évoluer ; les parcelles anciennes peuvent
  être absentes.
- La vérification ADEME couvre le jeu des logements existants depuis juillet
  2021. Un numéro absent peut notamment relever d’une autre couverture ; il
  n’est ni remplacé par un voisin ni déclaré inexistant.
- Seul le certificat sélectionné comme représentatif est vérifié. Cette fonction
  ne prétend pas énumérer tous les DPE individuels liés à un bâtiment. La table
  `rel_batiment_groupe_dpe_logement` documentée par BDNB répondait 404 sur ce
  point d’entrée lors de l’exploration ; l’intégration ne dépend pas de cette table.
- Maximum 20 groupes affichés ; une 21e relation déclenche un avertissement de
  liste partielle. Les requêtes sont bornées, les identifiants filtrés et les
  réponses inattendues refusées. Une absence de résultats ne signifie jamais
  absence de DPE.
- Cache serveur de 24 heures par parcelle, versionné et limité à 512 fichiers dans
  `data/bdnb`. Les réponses dont la vérification ADEME échoue ne sont pas mises en
  cache serveur. Cache navigateur de 24 heures, avec bouton de nouvel essai lors
  d’une erreur. Les requêtes utilisent un délai HTTP de 12 secondes par opération.
- Aucune nouvelle clé API ni dépendance n’est nécessaire. Les accès sortants à
  `api.bdnb.io` et `data.ademe.fr` doivent être autorisés. Une erreur BDNB renvoie
  502 et conserve les autres données de la fiche ; une erreur de vérification
  ADEME conserve les données BDNB avec un avertissement explicite.

## Validation

Tests backend : cas réel figé, jointures exactes, plusieurs bâtiments, absence de
représentatif, limite de résultats, identifiants étrangers/ambigus, numéro ADEME
absent ou divergent, panne ADEME, cache, paramètres invalides et erreur HTTP.
Tests interface : chargement au clic via `ParcelDpe`, distinction des sources,
vente antérieure au diagnostic, divergences de classe, panne BDNB avec recherche
ADEME toujours visible, nouvel essai indépendant, bâtiments multiples et liste
partielle. Les anciens tests ADEME/parcelles isolent ce composant ; le nouveau test
`bdnb.test.tsx` couvre l’intégration des deux recherches.

Commandes :

```sh
.venv/bin/pytest -q backend/tests
.venv/bin/ruff format --check backend
.venv/bin/ruff check backend/bdnb.py backend/tests/test_bdnb.py
cd frontend
npm run format:check
npm test
npm run build
```

## Sources officielles

- [Jeu BDNB sur data.gouv.fr](https://www.data.gouv.fr/datasets/base-de-donnees-nationale-des-batiments)
- [Méthode CSTB de sélection des DPE représentatifs](https://www.bdnb.io/documentation/methode_traitement_dpe/)
- [Relation cadastrale de la parcelle test](https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_parcelle?parcelle_id=eq.16358000AY0151)
- [DPE représentatif du groupe test](https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_dpe_representatif_logement?batiment_groupe_id=eq.bdnb-bg-WX3S-753T-TSTR)
- [Jeu ADEME des logements existants](https://data.ademe.fr/datasets/dpe03existant)
- [Fiche officielle du certificat](https://observatoire-dpe-audit.ademe.fr/afficher-dpe/2416E2621326Z)
