# Nationwide sync on Kubernetes

These manifests are templates, **not deployed infrastructure**. Replace `DOCKERHUB_NAMESPACE/dvf-explorer:VERSION` in both manifests with the same immutable image version. Configure an `imagePullSecret` in both pods if the image is private.

Choose the kubectl context and namespace, then create the `dvf-admin` Secret with a random `token` through your secret manager. Do not commit the value. The API and CronJob use the same secret. Enter it in the UI's **Administration token** field to start manual imports remotely.

```sh
kubectl apply -f deploy/kubernetes/app.yaml
kubectl apply -f deploy/kubernetes/sync-cronjob.yaml
# Start a manual sync immediately, regardless of the seasonal schedule:
kubectl exec deployment/dvf-explorer -- env DVF_API_URL=http://127.0.0.1:8000 python backend/sync_remote.py
# Local access until an HTTPS Ingress is configured:
kubectl port-forward service/dvf-explorer 8000:8000
```

The CronJob checks the publication at **09:00 and 16:00 Europe/Paris, Monday–Friday, during April 1–14 and October 1–14 inclusive**. Public holidays are not excluded. It creates jobs on those dates, and the `--scheduled` client skips weekends before reading credentials or calling the API. Both the scheduler and the client use Europe/Paris. A separate weekday guard avoids cron's OR behaviour when day-of-month and day-of-week are both restricted.

Manual UI imports and CLI runs without `--scheduled` remain available year-round. Jobs outside the window exit successfully without contacting the API. `concurrencyPolicy: Forbid` prevents overlapping scheduled runs; if a long sync is still active, a later scheduled run can be skipped.

Unchanged publications do not create duplicate sales. Failures appear as failed Kubernetes Jobs; no external alerts are configured. Initial ingestion can take hours. The client waits up to 48 hours; stopping it does not cancel the API's background import. Restarting sync reuses completed imports and parcel matching.

Only **one API process** opens DuckDB, using a `Recreate` rollout strategy. The CronJob calls `/api/sync` and polls `/api/status`. It does not mount the data volume or run an independent database writer. Do not run CLI imports against the same database while the API is running.

The 100 GiB PVC is an initial budget, not a measured final requirement. Monitor disk use and enable expansion according to your StorageClass. Temporary cadastral downloads are removed after matching; archived DVF files are retained. Validate CPU and memory requests on your cluster.

## Retention and recovery

The volume contains the DuckDB database, immutable ZIP objects, resource descriptors and publication snapshots. `DVF_ARCHIVE_DIR` can point to another mounted filesystem; it does not accept an S3 URL.

A persistent volume is not an independent backup. Configure consistent volume snapshots and an off-cluster archive copy, such as an S3 bucket with appropriate versioning and retention. The application currently has no automatic S3 integration. Do not delete the PVC during redeployment. Ask the cluster administrator for a `Retain` volume policy if accidental PVC deletion must be recoverable.

Restore a consistent database snapshot or rebuild from restored archives as described in [the ingestion guide](../../docs/ingestion.md). Removal of a year from data.gouv does not remove its locally archived files or sales.

For a future remote Parquet deployment, see [the proposed architecture](../../docs/s3-parquet.md). Separate ingestion from read-only API replicas before scaling the API.

References: [Kubernetes CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/), [DGFiP publication](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres).
