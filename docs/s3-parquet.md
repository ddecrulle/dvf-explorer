# Published DVF+ sales on S3

The web application reads prepared DVF+ sales directly from Parquet. Opening a
new installation does not trigger a nationwide import or cadastral matching.

## Readers and storage

By default, readers use the public SSPCloud dataset at
`https://minio.lab.sspcloud.fr/ddecrulle/DVF_Explorer/curated/current.json`.
`DVF_DATASET_URL` overrides this with another HTTP(S) URL, S3 URI or absolute
filesystem path. With no override, an existing `data/published/current.json`
is used first, allowing offline consultation of prepared sales. Basemaps and
address search still require internet access. `.env` is loaded by the API.

```text
s3://ddecrulle/DVF_Explorer/
  raw/dvfplus/<sha256>.zip
  curated/releases/<unique-release>/year=2026/department=16/sales_0.parquet
  curated/releases/<unique-release>/manifest.json
  curated/current.json
```

The manifest lists the complete logical dataset: files, checksums, row counts,
year/department coverage, geographic bounds, source URLs, raw archive hashes,
coordinate systems and replacement periods. Coordinates are sorted within each
partition for Parquet row-group pruning. Unlocated sales are retained.
Geographic pruning considers every intersecting partition, including neighbouring
departments. DuckDB computes counts/medians over all matching sales before
returning at most 3,000 rows.

The browser reads `/api/status` once on opening, then pins that immutable release
for the entire visit. Panning and zooming send the visible extent after a 250 ms
pause; they never check for new publications. Reopening/reloading starts a new
visit. The server caches the discovery pointer for 60 seconds for new visitors.

Geographically selected Parquet partitions are verified against their SHA-256
and cached in `data/cache/parquet/`, with a default 512 MB LRU budget configurable
through `DVF_CACHE_MB`. Active queries protect their files from eviction. A local
prepared copy of the exact release is reused when available. This avoids repeated
S3 requests while moving around the same area. The browser also keeps 12 recent
filtered map responses and retains points while loading a different view.

The map starts with France and displays official data.gouv.fr administrative
and cadastral vector tiles. Click a department, then a municipality and directly a parcel. Hovering highlights the geographic area; a breadcrumb
allows returning to any selected level. Free zoom and address search remain
available. It contains no individual sale markers or cluster bubbles. Below
zoom 13, the browser hides sales and does not request viewport sales or BAN
addresses. Zooming in loads the visible sales and highlights matching parcels.
Clicking any current parcel opens its full mutation history, including an
explicit empty state when no sale is known. Historical references absent from the
current cadastre remain accessible from the results list. Very wide extents also
ask the visitor to zoom in. API spatial groups and radius parameters remain
available for backward-compatible consumers; the web interface uses bounds.

Failed reads return HTTP 503 instead of a misleading zero count. In-flight and
pinned visits keep reading their original files when a new release is activated.
Do not delete files referenced by retained manifests or active visits.

Public HTTP access needs no AWS identity. For private S3, configure:

```sh
DVF_DATASET_URL=s3://ddecrulle/DVF_Explorer/curated/current.json
DVF_S3_ENDPOINT=https://minio.lab.sspcloud.fr
DVF_S3_ANONYMOUS=false
```

Inject renewable `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and, when required,
`AWS_SESSION_TOKEN`, or configure an AWS profile. Credentials stay on the server.
For public objects queried using an `s3://` URI, set `DVF_S3_ANONYMOUS=true`.
An Onyxia anonymous folder link is not proof of object access: verify an actual
object GET. A presigned POST authorizes uploads only, and expires.

## Separate preparation worker

The worker discovers a named release in the official Cerema Box catalog,
downloads regional mutation CSV ZIPs, validates them and archives their hashes.
It handles departmental CSVs and a single regional CSV. It uses `idopendata`,
retains positive-price `Vente` mutations, converts coordinates to WGS84 and
supplements municipality codes with official municipality names. CSVs do not
contain street addresses or exact room counts; these are left unavailable.
Multiple-premise/parcel transactions are excluded from price/m² statistics.

Use explicit authoritative coverage bounds: source rows outside them abort the
run. Each department replaces only that period in an isolated worker database.
Older periods remain. Completed conversions are reused based on archive checksum,
coverage, coordinate system and normalization version. Invalid source data or a
failed department never activates an incomplete publication.

For the October 2026 release:

```sh
.venv/bin/python -u backend/update_dataset.py \
  --publication octobre_2026 \
  --coverage-start 2014-01-01 --coverage-end 2026-06-30 \
  --overseas-crs docs/dvfplus-crs.json
```

This prepares all published regions in `data/dvfplus/worker.duckdb`, then exports
and activates a local snapshot in `data/published/`. Use `--regions R75` for a
regional run; the manifest states the resulting coverage. Existing prepared
departments are retained. Do not mistake a regional initial run for national
coverage. Source ZIPs remain in `data/dvfplus/raw/`.

Metropolitan CSV coordinates use EPSG:2154. The October 2026 overseas mappings
in `docs/dvfplus-crs.json` were checked against the corresponding official
GeoParquet `geo` metadata: R01/R02 EPSG:32620, R03 EPSG:2972, R04 EPSG:2975.
Verify metadata again if a future release changes its projection. Alsace,
Moselle and Mayotte are absent from DVF coverage.

## S3 publication and activation

With signed S3 write credentials, append:

```sh
  --destination s3://ddecrulle/DVF_Explorer/curated --activate
```

The worker archives raw ZIPs remotely, exports a consistent committed view,
validates Parquet counts/checksums, uploads immutable files and the manifest,
then verifies remote reads before advancing `current.json`. Signed activation
uses an ETag conditional write to reject a concurrent pointer change.

For a temporary Onyxia upload link, save the full URL in a private file outside
Git, then add `--post-file /absolute/path/to/upload-link.txt` and set the required
read access mode in the environment. Do not put the signed URL in command-line
arguments, source code, documentation or a Kubernetes manifest. The link must
authorize the `DVF_Explorer/` prefix in the `ddecrulle` bucket. Run only one POST
publisher: temporary POST authorization does not support conditional pointer
replacement. Without `--activate`, uploads do not change the shared current
release. An upload failure or failed read validation leaves it unchanged.

To export an existing prepared database separately:

```sh
.venv/bin/python backend/publish.py \
  --database data/dvfplus/worker.duckdb --output data/published
```

To roll back, restore a retained `current.json` pointer referencing a validated
immutable manifest. Keep all referenced files. To reconstruct, restore the raw
ZIPs and replay their declared coverage periods chronologically. Raw archives
are independent of query snapshots and must not be removed during cleanup.

## Deployment

`Launch.command`, a normal API launch and Compose can consult the public dataset
immediately. DuckDB `httpfs` is installed into the Docker image at build time and
is readable by non-root pods. `/api/ready` checks manifest availability;
`/api/health` remains independent of external storage for liveness.

Helm's `values-sspcloud.yaml` selects the published S3 dataset, one read-only API
replica, Recreate updates and a persistent cache volume. Private credentials can be
injected through `extraEnvFrom` using a managed Secret. The web deployment omits
legacy HTTP sync jobs. Run `update_dataset.py` in a separate job with writable
worker storage and publication credentials; it can run while readers serve the
previous release. No cluster deployment or new recurring job is created by a
local preparation run.

## Search geometry

Search selection fetches geometry on demand through `/api/search/geometry`.
Municipalities use the official API Découpage administratif contour. Streets
use IGN BD TOPO road segments matched to the exact BAN street identifier and
commune side, with a spatial WFS filter covering that commune. The map fits the
returned geometry and highlights it in orange. These lookups do not modify S3;
server results are cached for 24 hours with at most 512 entries. Missing geometry
or an unavailable upstream service leaves the labeled search point visible.

Sources: [commune contours](https://geo.api.gouv.fr/decoupage-administratif/communes),
[IGN WFS](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wfs/).

## Legacy raw-DVF mode

Set `DVF_DATASET_URL=local` to use the original local DuckDB importer and cadastral
matching. It still requires one API writer and a persistent database. Its archive
and seasonal update mechanisms are documented in [ingestion.md](ingestion.md).
It is never run automatically by a published-data reader.

Sources: [Cerema DVF+](https://www.data.gouv.fr/datasets/dvf-open-data),
[official downloads](https://cerema.app.box.com/v/dvfplus-opendata),
[DuckDB S3](https://duckdb.org/docs/stable/core_extensions/httpfs/s3api),
[official geographic API](https://geo.api.gouv.fr/decoupage-administratif/communes).
