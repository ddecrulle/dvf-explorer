# Synchronisation nationale sur Kubernetes

Ces fichiers sont prêts à adapter, **pas encore déployés**. L'image Docker Hub et le cluster restent à configurer. Remplacer `DOCKERHUB_NAMESPACE/dvf-explorer:VERSION` dans les deux manifestes par la même version immuable de l'image. Si elle est privée, configurer aussi un `imagePullSecret` dans les deux pods.

Créer un namespace, choisir le contexte/namespace kubectl, puis créer le secret `dvf-admin` avec une clé `token` aléatoire via votre gestionnaire de secrets. Ne pas versionner le jeton. Le même secret est utilisé par l'API et le CronJob. Pour une utilisation distante, le champ « Clé d'administration » apparaît dans l'interface et permet les synchronisations manuelles.

```sh
kubectl apply -f deploy/kubernetes/app.yaml
kubectl apply -f deploy/kubernetes/sync-cronjob.yaml
# Première synchronisation immédiatement :
kubectl create job --from=cronjob/dvf-national-sync dvf-initial-sync
# Accès local, tant que l'Ingress HTTPS n'est pas configuré :
kubectl port-forward service/dvf-explorer 8000:8000
```

Le CronJob vérifie la publication chaque jour à 03:00 Europe/Paris. Une publication non modifiée ne crée pas de doublons. Une exécution en échec apparaît comme un Job échoué ; aucune intégration d'alertes externes n'est configurée. La première ingestion peut être longue : le client attend jusqu'à 48 heures. Son arrêt n'annule pas l'import en cours dans l'API. Relancer après un échec reprend les millésimes déjà validés et les départements déjà géolocalisés.

DuckDB est ouvert uniquement par **une instance de l'API**, avec une stratégie de remplacement `Recreate`. Le CronJob appelle `/api/sync` et surveille `/api/status` ; il ne monte pas le volume et ne lance pas d'écrivain indépendant. Ne pas lancer le script CLI de synchronisation contre la même base pendant que le serveur fonctionne.

Le PVC de 100 Gio est un **budget initial à ajuster**, pas une mesure de la volumétrie finale. Surveiller son occupation et autoriser son extension selon la StorageClass. Les fichiers cadastraux téléchargés temporairement sont supprimés après rapprochement ; les fichiers DVF archivés ne le sont jamais. La mémoire demandée/limitée est indicative et doit être validée sur votre cluster.

## Conservation et sauvegarde

Le volume contient `dvf.duckdb` (base consultable), `archives/objects/` (ZIP identifiés par SHA-256), `archives/resources/` (descripteurs), `archives/catalogs/` et `archives/snapshots/` (historique de publication). `DVF_ARCHIVE_DIR` permet de placer les archives sur un autre volume monté ; c'est un chemin de fichiers, pas une URL S3.

Un PVC persistant n'est **pas une sauvegarde hors cluster**. Configurer des snapshots du volume et une copie indépendante des archives (par exemple vers un bucket S3 avec versioning et rétention, via l'outil de sauvegarde de votre plateforme). Aucun bucket ni identifiant S3 n'est configuré par cette application. Ne pas supprimer le PVC lors d'un redéploiement. Choisir une politique `Retain` pour le volume via l'administrateur du cluster si une suppression accidentelle du PVC doit rester récupérable.

Pour restaurer : restaurer `archives/` et la base depuis un snapshot cohérent, ou reconstruire la base à partir des manifestes archivés. La suppression d'un millésime de data.gouv ne supprime ni ses fichiers ni ses ventes locales.

Références : [CronJobs Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/), [publication DGFiP](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres).
