# DVF Explorer

Application locale React + MapLibre + FastAPI + DuckDB. Les ventes proviennent des fichiers bruts officiels DGFiP, sans attendre leur intégration dans une API tierce. La carte démarre autour d’Angoulême, avec un rayon de 3 km modifiable.

![Aperçu de DVF Explorer](apercu.png)

## Installation depuis GitHub

```sh
git clone https://github.com/ddecrulle/dvf-explorer.git
cd dvf-explorer
```

Les données et dépendances ne sont pas versionnées. Après le premier lancement, ouvrir **Données officielles** et importer le département **16**, année **2026**, puis **2025** pour la comparaison. Les imports restent stockés localement dans `data/`.

## Ouvrir l’application

Sur macOS, double-cliquer sur **Lancer.command**, puis ouvrir http://127.0.0.1:8000. Garder la fenêtre du terminal ouverte. Arrêter avec Ctrl+C.

Python 3.14 et Node 22.12+ sont recommandés pour une installation neuve (versions utilisées pour les vérifications locales : Python 3.14 et Node 26). Le script installe les dépendances manquantes. Si le port est occupé, arrêter l’ancienne instance avant de relancer.

Autre possibilité : `docker compose up --build`, puis la même adresse locale. La configuration Docker est fournie mais n’a pas été exécutée lors de la livraison. Elle conserve les données dans `data/` et n’expose le service que sur la machine locale.

## Utilisation

- Chercher une adresse ou une commune et sélectionner une suggestion IGN.
- Choisir l’année des ventes, le rayon, le type, le prix ou les dates.
- Cliquer une vente dans la liste ou un point sur la carte pour voir son détail.
- Déplacer la carte puis cliquer « Rechercher dans cette zone » pour recentrer le rayon.
- Exporter les résultats affichés en CSV (maximum 3 000 lignes).
- Ouvrir « Données officielles » pour importer un département ou une autre année. Un seul import peut fonctionner à la fois. Le navigateur peut rester ouvert pendant l’import.
- Sur téléphone, basculer entre carte et liste avec le bouton inférieur.

La livraison locale initiale contient le département 16 pour 2026 et 2025. Un clone GitHub démarre sans données : chaque territoire nécessite un import. Une recherche d’adresse fonctionne partout où le service IGN répond. Une recherche proche d’une frontière départementale nécessite d’importer aussi les départements voisins.

## Provenance et interprétation

Source : [DGFiP, Demandes de valeurs foncières](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres), publication du 12 octobre 2026 ; [cadastre Etalab](https://cadastre.data.gouv.fr/datasets/cadastre-etalab) ; recherche [Géoplateforme IGN](https://data.geopf.fr/geocodage/search).

2026 couvre le premier semestre, 2025 l’année entière. La comparaison affichée entre années reprend le même rayon, les mêmes bornes de prix et le même type, mais **pas les filtres de dates** : ce n’est pas une comparaison de volumes à périodes équivalentes. Les enregistrements tardifs peuvent manquer, même sur un semestre publié.

Le fichier brut ne contient pas d’identifiant public unique de mutation. L’import regroupe les lignes contiguës ayant document/référence, date, nature, montant, commune et numéro de disposition identiques. Cette méthode est une approximation : deux ventes distinctes présentant les mêmes caractéristiques peuvent être confondues ; une mutation multi-communes ou multi-dispositions peut être séparée. Le compteur correspond à des groupes de dispositions de nature « Vente », de montant strictement positif. Les autres natures de mutation sont exclues. Ne pas interpréter le compteur comme un nombre certifié d’actes notariés.

Le montant est pris une fois par groupe, jamais additionné par ligne. Le point est un point intérieur d’une des parcelles retrouvées ; une vente multi-parcelles peut dépasser le rayon même si sa parcelle représentative y figure. Les parcelles disparues ou renumérotées peuvent rester sans coordonnées et sont alors absentes de la carte. Leur nombre reste visible par différence entre ventes importées et localisées.

Pour les groupes complexes (plusieurs parcelles ou plusieurs signatures de local), surface bâtie, pièces et prix au m² ne sont pas consolidés. Même un groupe simple peut masquer des locaux distincts de caractéristiques identiques. Les surfaces terrain sont dédupliquées par parcelle et culture ; elles restent déclaratives. Une dépendance peut être associée au montant d’une maison : le prix/m² n’est donc pas un prix hors dépendances. Les médianes ne constituent pas une estimation immobilière.

Le rapprochement cadastral utilise le millésime `latest` au premier téléchargement, conservé en cache. Pour actualiser les parcelles, arrêter le serveur, supprimer le fichier `data/cadastre-DEPARTEMENT.json.gz`, relancer et réimporter. Le fichier DVF est identifié en cache par ressource et date de publication. L’import vérifie que les dates du département correspondent bien à l’année demandée et remplace les données de cette année/département dans une transaction atomique.

Licence Ouverte 2.0 pour les données. Pas de recherche de personnes ni d’indexation externe ; les métadonnées de l’interface demandent `noindex`. DVF ne couvre pas l’Alsace, la Moselle et Mayotte.

## Développement

```sh
# Depuis le dossier de l’application
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
# Dans un second terminal
cd frontend
npm ci
npm run dev
```

Vite redirige `/api` vers le port 8000. Pour la version compilée : `cd frontend && npm run build`, puis redémarrer FastAPI. Lancer les tests depuis le dossier principal avec `.venv/bin/python -m pytest backend/tests -q`.

Import en ligne de commande, serveur arrêté :

```sh
.venv/bin/python backend/ingest.py --department 16 --year 2026
```

Ne pas lancer plusieurs processus d’écriture sur le même fichier DuckDB : un serveur unique est prévu. L’API est destinée à un usage local, sans authentification. Les imports téléchargent un fichier national et un cadastre départemental ; prévoir de l’espace et de la mémoire pour les départements volumineux. La carte, le géocodage et les imports nécessitent Internet. Les ventes importées restent consultables en liste hors connexion.
