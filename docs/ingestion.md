# Ingestion and history retention

This guide describes the legacy raw-DVF pipeline, enabled explicitly with
`DVF_DATASET_URL=local`. The default application reads already published DVF+
sales; see [S3/Parquet serving and its separate worker](s3-parquet.md).

## Pipeline

1. **Discover.** `archive.capture()` reads the official data.gouv catalog and identifies annual or half-year ZIP resources. Coverage dates come from the resource titles.
2. **Archive.** Download each changed resource, validate its ZIP contents and calculate SHA-256. Store it as `archives/objects/<sha256>.zip` with resource metadata. Capture the complete catalog and a dated snapshot. Only update `latest.json` after every resource is archived.
3. **Normalize.** `national.import_snapshot()` streams the pipe-delimited source. Adjacent rows with matching transaction attributes form an inferred disposition group. `ingest.normalise()` retains positive-price sales, builds cadastral identifiers, deduplicates repeated attributes and prepares staging rows.
4. **Replace the published period.** In one DuckDB transaction, load the staging rows, preserve known coordinates, replace only the stated date range and refresh counts. For a targeted import, replacement is also restricted to its department. An error rolls back the transaction.
5. **Locate.** Stream cadastral polygons one department at a time. For matching parcels, store a representative point inside the geometry. Use a deterministic matched parcel to locate each sale. Unmatched sales remain in the database.
6. **Serve.** FastAPI applies price/date/type filters and a geographic bounding box, then a great-circle distance filter. DuckDB calculates counts and medians; the response includes at most 3,000 sales.

The initial run archives all files before importing any year, then imports all years before cadastral matching. Angoulême's department (16) is matched first. Sales are available progressively while the remaining departments are processed.

## Corrections, retired years and idempotence

ZIP objects are immutable. Publication fingerprints include resource ID, URL, modification time, title, declared size and checksum. Usage counters are ignored. Silent upstream changes to content without any metadata change may not be detected. Local archive SHA-256 values are rechecked before reuse and import.

The query database contains the most recently imported version for each covered period, not the sum of historical versions. For example, a new July–December file replaces those months only: an already retained January–June period survives. Removal of a year from data.gouv does not remove its local data or archives.

Successful national imports record SHA-256 and coverage. Overlapping replacements invalidate older active markers, so an A → B → A publication sequence correctly restores A. Raw archives retain non-sale and non-positive-price source rows even though the explorer excludes them.

## Resume and cadastral updates

`data/job.json` records job state. On startup, an unfinished job becomes `interrupted`; run sync again to resume. Completed annual imports are skipped. Departments with the same set of required parcel IDs reuse their completed matching results, including previously unmatched parcels. Price-only corrections do not download the cadastre again.

Cadastre files come from the publisher's `latest` release. Downloaded temporary files are removed after matching; an existing `data/cadastre-DEPARTMENT.json.gz` cache is reused. This is not a versioned cadastral history.

To force fresh matching, stop the server, remove the department's row from the `geocoding` table and remove its cached cadastral file if present. Restart and sync again. Known coordinates remain available. Cadastral failures preserve imported sales and are reported as an incomplete sync.

## Seasonal publication checks

Scheduled requests use `/api/sync?scheduled=true`. The API persists April/October campaign state in `archives/campaigns/`, checks resource metadata twice per weekday and keeps trying until a changed release is fully imported and geolocated. It then stops source polling until the next campaign. A failed sync remains pending even when archival `latest.json` has advanced. Ordinary `/api/sync` requests bypass campaign gating for manual corrections. See the Kubernetes guide for first-deployment and missing-date behaviour.

## Running without the API

Stop the server before opening the same DuckDB database in another process:

```sh
uv run --locked python backend/sync.py
# Archive and import without parcel matching:
uv run --locked python backend/sync.py --no-geocode
# Target a department and year:
uv run --locked python backend/ingest.py --department 16 --year 2026
```

An in-process lock protects API database operations; a filesystem lock prevents simultaneous sync commands. This is a single-writer design, not a distributed writer coordination mechanism.

## Files and recovery

- `data/dvf.duckdb`: query database, import markers and matched parcel points.
- `data/archives/objects/`: immutable ZIP source files.
- `data/archives/resources/`: resource descriptors and source checksums.
- `data/archives/catalogs/`: publication catalog snapshots.
- `data/archives/snapshots/`: complete archived publication manifests.
- `data/archives/latest.json`: most recent complete archival capture.
- `data/archives/sync-result.json`: result of the last sync that reached its final stage.
- `data/staging/`: temporary import and matching files.

With the server stopped, abandoned staging files may be removed. Never remove archives as part of staging cleanup. A persistent disk is not an independent backup; copy archives elsewhere and snapshot the database consistently.

To rebuild without downloading DVF again, restore the full archive directory, point `DVF_ARCHIVE_DIR` to it and select a new empty `DVF_DATA_DIR`:

```sh
DVF_DATA_DIR=/path/to/new-empty-data \
DVF_ARCHIVE_DIR=/path/to/restored/archives \
uv run --locked python backend/rebuild.py
```

Reconstruction replays archived snapshots chronologically and refuses an existing nonempty sales database. Geolocation must be rerun separately unless restoring a consistent full database backup. Archive-only restoration does not require the DGFiP source to remain online.
