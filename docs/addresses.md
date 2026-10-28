# Adresses et parcelles

La BAN fournit une correspondance explicite dans `cad_parcelles`, disponible dans les exports départementaux : https://adresse.data.gouv.fr/outils/telechargements. Cette correspondance est incomplète et une parcelle peut avoir plusieurs adresses. Une absence de lien reste une absence ; aucune adresse voisine n'est substituée.

`POST /api/parcel-addresses` reçoit jusqu'à 3001 références et renvoie les adresses par référence, les métadonnées des sources et les départements indisponibles. La liste et la fiche chargent cet enrichissement séparément des mutations : la carte reste utilisable pendant la préparation d'un index.

Au premier accès à un département, le serveur télécharge son export CSV compressé, normalise les références cadastrales DGFiP de 15 caractères vers le format DVF/IGN de 14 caractères, puis crée un index SQLite dans `data/addresses/ban-<département>.sqlite`. L'index persiste sur le volume de données. Aucun rafraîchissement automatique n'intervient pendant la visite ; les prochaines recherches utilisent l'index existant. Le remplacement est atomique après import complet. En cas d'échec, l'affichage conserve les références des parcelles et leur historique.

Préparation avant ouverture ou actualisation explicite :

```sh
uv run --locked python backend/addresses.py --department 16
uv run --locked python backend/addresses.py --department 16 --refresh
```

Le premier téléchargement d'un département peut prendre plusieurs secondes. La limite est de 128 Mio compressés par export. Les métadonnées conservent l'URL, la date de modification de l'export et la date d'indexation. Les adresses certifiées par la commune sont affichées en premier, puis triées par libellé ; la première adresse affichée ne désigne pas nécessairement un logement ou une mutation spécifique.

Ces adresses sont actuelles. Elles ne prouvent pas l'adresse du bien à la date d'une mutation, ni l'identité du logement concerné par une vente. Les identifiants BAN explicitement reliés à la parcelle servent aussi à rechercher des candidats DPE, signalés comme correspondances à vérifier. Voir [les règles DPE](dpe.md). Les points de la carte restent les positions des mutations DVF+ ; cet enrichissement n'ajoute pas les contours cadastraux.

La fiche utilise une adresse BAN unique, puis, à défaut, l'adresse déclarée d'une vente portant sur une seule parcelle. Plusieurs adresses BAN restent affichées sans en choisir une arbitrairement. Le worker peut enrichir les mutations avec `--address-database data/dvf.duckdb` : date, prix, commune et ensemble complet de parcelles doivent correspondre, avec une seule adresse déclarée distincte.
