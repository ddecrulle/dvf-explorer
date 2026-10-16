# Nationwide sync on Kubernetes

Prefer the [Helm chart](../../charts/dvf-explorer/README.md) for new deployments. These raw manifests remain a reference; do not deploy both against the same DuckDB volume.

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

Publication campaigns start on **April 1 and October 1**. The CronJob contacts the API at **09:00 and 16:00 Europe/Paris, Monday–Friday**. The API checks the source catalog until it detects and successfully integrates a new publication. Checks continue beyond the 14th and beyond the publication month if necessary. Public holidays are included.

After a successful release import and parcel matching, the API persists campaign completion in `archives/campaigns/YYYY-MM-01.json`. Later scheduled calls return without contacting data.gouv or downloading data until the next campaign. Kubernetes still creates small HTTP client jobs; it is the source polling and ingestion that stop. The state survives pod restarts on the persistent data volume. If a release never arrives, the next campaign starts a fresh baseline.

A changed resource fingerprint (ID, URL, modification date, checksum, title or size) triggers ingestion; usage counters and removed resources alone do not. On initial deployment, a resource modification date within the active campaign also triggers import, so a release already available at deployment is not missed. Without a usable publication date or historical baseline, the first observation establishes the baseline and subsequent resource changes trigger work. Silent upstream content changes without metadata changes remain undetectable.

Pending work is persisted before ingestion. Download, import or parcel-matching failures leave the campaign open for the next run. Completion is recorded only after the full sync succeeds. Once a campaign closes, later corrections require a manual sync or the next campaign.

Manual UI imports and CLI runs without `--scheduled` remain available year-round. `concurrencyPolicy: Forbid` prevents overlapping scheduled runs; a later run may be skipped if a long sync is still active. The API retains its single-writer lock. A fresh deployment before April uses the previous October campaign.

Unchanged publications do not create duplicate sales. Failures appear as failed Kubernetes Jobs; no external alerts are configured. Initial ingestion can take hours. The client waits up to 48 hours; stopping it does not cancel the API's background import. Restarting sync reuses completed imports and parcel matching.

Only **one API process** opens DuckDB, using a `Recreate` rollout strategy. The CronJob calls `/api/sync` and polls `/api/status`. It does not mount the data volume or run an independent database writer. Do not run CLI imports against the same database while the API is running.

The 100 GiB PVC is an initial budget, not a measured final requirement. Monitor disk use and enable expansion according to your StorageClass. Temporary cadastral downloads are removed after matching; archived DVF files are retained. Validate CPU and memory requests on your cluster.

## Retention and recovery

The volume contains the DuckDB database, immutable ZIP objects, resource descriptors and publication snapshots. `DVF_ARCHIVE_DIR` can point to another mounted filesystem; it does not accept an S3 URL.

A persistent volume is not an independent backup. Configure consistent volume snapshots and an off-cluster archive copy, such as an S3 bucket with appropriate versioning and retention. The application currently has no automatic S3 integration. Do not delete the PVC during redeployment. Ask the cluster administrator for a `Retain` volume policy if accidental PVC deletion must be recoverable.

Restore a consistent database snapshot or rebuild from restored archives as described in [the ingestion guide](../../docs/ingestion.md). Removal of a year from data.gouv does not remove its locally archived files or sales.

For a future remote Parquet deployment, see [the proposed architecture](../../docs/s3-parquet.md). Separate ingestion from read-only API replicas before scaling the API.

References: [Kubernetes CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/), [DGFiP publication](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres).
