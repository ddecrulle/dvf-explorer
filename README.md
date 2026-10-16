# DVF Explorer

Explore French property sales using official DGFiP DVF files, with a React + TypeScript frontend, MapLibre maps, a FastAPI API and DuckDB storage. The map starts around Angoulême with an adjustable 3 km radius. All archived years are selected by default.

![DVF Explorer interface](preview.png)

## Quick start

```sh
git clone https://github.com/ddecrulle/dvf-explorer.git
cd dvf-explorer
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
cd frontend
npm ci
npm run build
cd ..
.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. On macOS, `Launch.command` also installs missing dependencies, builds a missing frontend and starts the server. Keep its terminal open; press Ctrl+C to stop. After changing frontend sources, run `npm run build` again.

Use Python 3.13 or newer and Node 22.12+ (or a supported newer Node release). The Docker image uses Python 3.13 and Node 22 for the frontend build.

A fresh clone contains **no data**. Open **Official data → Sync all of France** to archive all published years, import nationwide sales and match cadastral parcels. Sales appear on the map progressively. An interrupted sync can be restarted; completed stages are reused. The browser may be closed while the server continues running.

## Source code

The repository contains readable sources, not the production bundle. Vite generates `frontend/dist/` during the build; Git ignores this directory, `node_modules/`, `.venv/` and all local data.

```text
frontend/src/
  main.tsx                  Application entry point
  App.tsx                   Search, filters and page composition
  types.ts                  API and domain types
  api.ts                    HTTP client and error handling
  format.ts                 Display formatting and CSV export
  mapData.ts                GeoJSON generation and default location
  components/
    SaleCard.tsx            Sale list item
    SaleDetails.tsx         Selected sale details
    DataPanel.tsx           Archive coverage and import controls
  hooks/useSalesMap.ts       Map lifecycle and source updates
  style.css                 Formatted application styles
backend/
  main.py                   API routes, authentication and background jobs
  archive.py                Immutable ZIP archives and publication snapshots
  national.py               Streaming imports and period replacement
  ingest.py                 Raw DVF normalization and targeted imports
  geocode.py                Department-level parcel matching
  sync.py                   Nationwide orchestration and writer lock
  store.py                  DuckDB connection and schema
  rebuild.py                Offline reconstruction from archives
  sync_remote.py            Kubernetes HTTP sync client
```

TypeScript uses strict checking. UI text, documentation, comments and application messages are in English. Official French source columns, category values, municipality names and addresses retain their original meaning; property categories are translated for display only.

## Using the explorer

- Search for an address or municipality and select an IGN suggestion.
- Choose all years or one year, then filter by radius, property type, price and dates.
- Select a sale in the list or map to view its source, parcels and details.
- Move the map and select **Search this area** to update the search centre.
- Export the displayed selection as CSV, up to 3,000 rows.
- Use **Official data** for nationwide sync or a targeted department import.
- On small screens, use the bottom button to switch between map and list.

The previous-year comparison uses the same radius, price and type filters but the **entire previous year**, ignoring date filters. It is not a comparison of equal-length periods. Near a department boundary, import neighbouring departments too if using targeted imports.

## Ingestion and permanent history

See [the ingestion guide](docs/ingestion.md) for the full pipeline, correction rules, resume behaviour and reconstruction steps.

All official ZIPs are archived before the query database changes. New publications replace only their declared coverage period in DuckDB. Older years remain available after the publisher removes them. Raw archives preserve all source rows; the explorer exposes positive-price sales only.

The downloaded October 2026 publication covers the second half of 2021, full years 2022–2025 and the first half of 2026. Earlier retired years cannot be recovered from this publication alone; they need another verifiable archive. Late registrations can be absent even within published periods.

## Interpretation and limitations

The raw files do not provide a unique public transaction identifier. Adjacent rows with matching department, document/reference, date, nature, amount, municipality and disposition are grouped. Distinct sales can be ambiguous; multi-municipality or multi-disposition transactions can be split. Counts represent inferred positive-price `Vente` disposition groups, not a certified number of deeds.

Prices are counted once per group, never summed across repeated rows. A map point is inside one matched parcel. A multi-parcel sale may extend beyond the search radius. Missing or renumbered parcels can leave sales unlocated: those sales remain in import counts but are absent from the map.

For complex groups with multiple parcels or building signatures, floor area, rooms and price/m² are not consolidated. Even simple groups can hide identical but distinct buildings. Land area is deduplicated by parcel and land-use attributes and remains declarative. A house price may include outbuildings. Medians are not property valuations.

DVF does not cover Alsace, Moselle or Mayotte. Respect the source terms, including restrictions on re-identification. The UI requests `noindex`; this is not an access-control mechanism. Data are distributed under the Open Licence 2.0.

Sources: [DGFiP DVF](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres), [Etalab cadastre](https://cadastre.data.gouv.fr/datasets/cadastre-etalab), [IGN address search](https://data.geopf.fr/geocodage/search).

## Development and checks

Run the API as above, then start Vite in a second terminal:

```sh
cd frontend
npm ci
npm run dev
npm run typecheck
npm run format:check
npm run build
```

Vite proxies `/api` to port 8000. Production builds are served by FastAPI. Backend checks, from the repository root:

```sh
.venv/bin/python -m pytest backend/tests -q
```

Format frontend changes with `npm run format` from `frontend/`. Python sources follow Ruff's formatter; install the pinned development tools in `backend/requirements-dev.txt` and run `.venv/bin/ruff format backend`.

Only one process may write the DuckDB file. Do not run CLI imports while the API is using the same database. Read endpoints are unauthenticated. Imports and sync require `DVF_ADMIN_TOKEN` when configured; without it, writes are restricted to loopback clients and local origins.

Internet access is required for basemaps, address search and source downloads. Already imported sales do not depend on the source publication remaining online. DuckDB defaults to a 2 GB memory budget and two threads, configurable through `DVF_MEMORY_LIMIT` and `DVF_THREADS`.

## Docker and Kubernetes

Copy `.env.example` to `.env`, set a random `DVF_ADMIN_TOKEN`, then run `docker compose up --build`. Enter the same token in **Official data** for imports. Never commit `.env`. Compose persists data in `data/` and binds the app to localhost.

See [the Kubernetes guide](deploy/kubernetes/README.md). The manifests include one API instance and an HTTP-driven sync CronJob scheduled at 09:00 and 16:00 Europe/Paris on weekdays during April 1–14 and October 1–14. They still require an image name, cluster configuration and deployment. No Docker Hub image has been published by these manifests.

## S3 and Parquet

The current application queries a local DuckDB database. Raw ZIP archives have been copied to the supplied S3 bucket as a separate backup; **remote Parquet queries are not yet implemented**.

See [the proposed S3/Parquet design](docs/s3-parquet.md) for direct reads, immutable publication snapshots and the credentials needed to use a private MinIO bucket. `DVF_ARCHIVE_DIR` currently accepts a filesystem path, not an S3 URL.
