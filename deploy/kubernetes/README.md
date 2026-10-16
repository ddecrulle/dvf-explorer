# Nationwide sync on Kubernetes

These manifests are templates, **not deployed infrastructure**. Replace `DOCKERHUB_NAMESPACE/dvf-explorer:VERSION` in both manifests with the same immutable image version. Configure an `imagePullSecret` in both pods if the image is private.

Choose the kubectl context and namespace, then create the `dvf-admin` Secret with a random `token` through your secret manager. Do not commit the value. The API and CronJob use the same secret. Enter it in the UI's **Administration token** field to start manual imports remotely.

```sh
kubectl apply -f deploy/kubernetes/app.yaml
kubectl apply -f deploy/kubernetes/sync-cronjob.yaml
# Start the first sync immediately:
kubectl create job --from=cronjob/dvf-national-sync dvf-initial-sync
# Local access until an HTTPS Ingress is configured:
kubectl port-forward service/dvf-explorer 8000:8000
```

The CronJob checks the publication daily at 03:00 Europe/Paris. Unchanged publications do not create duplicate sales. Failures appear as failed Kubernetes Jobs; no external alerts are configured. Initial ingestion can take hours. The client waits up to 48 hours; stopping it does not cancel the API's background import. Restarting sync reuses completed imports and parcel matching.

Only **one API process** opens DuckDB, using a `Recreate` rollout strategy. The CronJob calls `/api/sync` and polls `/api/status`. It does not mount the data volume or run an independent database writer. Do not run CLI imports against the same database while the API is running.

The 100 GiB PVC is an initial budget, not a measured final requirement. Monitor disk use and enable expansion according to your StorageClass. Temporary cadastral downloads are removed after matching; archived DVF files are retained. Validate CPU and memory requests on your cluster.

## Retention and recovery

The volume contains the DuckDB database, immutable ZIP objects, resource descriptors and publication snapshots. `DVF_ARCHIVE_DIR` can point to another mounted filesystem; it does not accept an S3 URL.

A persistent volume is not an independent backup. Configure consistent volume snapshots and an off-cluster archive copy, such as an S3 bucket with appropriate versioning and retention. The application currently has no automatic S3 integration. Do not delete the PVC during redeployment. Ask the cluster administrator for a `Retain` volume policy if accidental PVC deletion must be recoverable.

Restore a consistent database snapshot or rebuild from restored archives as described in [the ingestion guide](../../docs/ingestion.md). Removal of a year from data.gouv does not remove its locally archived files or sales.

For a future remote Parquet deployment, see [the proposed architecture](../../docs/s3-parquet.md). Separate ingestion from read-only API replicas before scaling the API.

References: [Kubernetes CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/), [DGFiP publication](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres).
