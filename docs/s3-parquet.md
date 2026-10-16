# Proposed S3 / Parquet serving architecture

Status: **design only**. The current API still queries local DuckDB tables. The one-off S3 upload contains raw ZIPs and manifests, not a deployed Parquet query layer.

## Direct reads

DuckDB's `httpfs` extension can query Parquet in S3-compatible storage, including MinIO. It can use HTTP range reads, column selection, Parquet statistics and Hive partition pruning to avoid downloading every complete file. The API would execute these queries and return JSON to the existing frontend; S3 credentials would remain on the server.

Suggested bucket layout:

```text
DVF_Explorer/
  raw/objects/<sha256>.zip
  raw/snapshots/<publication>.json
  curated/releases/<release-id>/year=2026/department=16/part-000.parquet
  curated/releases/<release-id>/manifest.json
  curated/current.json
```

Keep raw archives permanently for provenance and replay. Curated Parquet contains normalized, deduplicated disposition groups with parcel coordinates and source provenance. Retain unlocated sales as well as located sales so import coverage remains auditable.

## Publication consistency

The ingestion worker still needs a writable working database and staging space to apply coverage corrections and match parcels. Export a consistent committed view to a new immutable release prefix. Validate row counts, schema, coverage and checksums before publishing its manifest and replacing `current.json` as the final step. Failed exports must never advance the pointer.

Each manifest must describe the complete logical dataset, including retained retired years. It can reference unchanged partition files from previous immutable releases. Rebuild affected year/department partitions using the merged retained data, including any preserved first semester. Do not simply append each new official file: this would duplicate corrected transactions.

The API should resolve one manifest per request and use its exact file list, preventing mixed versions during deployment. Keep old manifests and referenced files for rollback. Coordinate a single publisher or use a conditional pointer update so concurrent publishers cannot silently overwrite each other.

## Query performance

Start with year/department partitions and geographically ordered row groups. Department partitions help only when the query can safely select relevant departments. A radius crossing a boundary must include every intersecting department; selecting only the address's department would miss sales. Without a reliable boundary lookup, use all departments and let coordinate statistics prune row groups.

Use explicit year predicates when a year is selected, then coordinate bounds before the exact radius test. Avoid large numbers of tiny files. Measure cold and warm latency for all-years map searches and median calculations before replacing the current local store. A small local cache or materialized hot-area table remains an option if remote request latency dominates.

This architecture can support multiple read-only API replicas, while one ingestion worker publishes immutable releases. It is a deployment change: the current single-writer Kubernetes manifests cannot simply be scaled before separating the writer from readers.

## Access required

The supplied presigned POST is temporary upload authorization only. It provides neither object reads nor a durable identity for scheduled work. Configure platform-managed credentials or renewable workload credentials in Kubernetes Secrets/workload identity:

- Endpoint: `https://minio.lab.sspcloud.fr`.
- Bucket: `ddecrulle`; application prefix: `DVF_Explorer/`.
- API: read access to curated manifests and referenced objects; listing only if discovery uses it.
- Ingestion worker: write access to raw and curated application prefixes, plus reads needed for resume and validation.
- MinIO endpoint style, region and TLS settings matching the deployment.

Do not commit access keys or put them in the frontend. Runtime secrets must be renewable if the platform issues expiring credentials. Validate the real bucket connection and a representative remote query before switching production reads.

References: [DuckDB S3 support](https://duckdb.org/docs/current/core_extensions/httpfs/s3api), [Parquet imports from S3](https://duckdb.org/docs/current/guides/network_cloud_storage/s3_import), [partial HTTP reads](https://duckdb.org/docs/current/core_extensions/httpfs/https).
