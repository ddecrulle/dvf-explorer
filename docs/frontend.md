# Frontend architecture

The explorer is a React + TypeScript single-page application built with Vite. FastAPI serves the production bundle and the existing HTTP API. TanStack Query v5 owns remote state; a second application server or SSR framework would not help the current map-driven page.

## Responsibilities

- `App.tsx` composes the screen and owns UI state: selected sale, filters, map focus, viewport, mobile view and data panel visibility.
- `queries/client.ts` creates one QueryClient per page load. HTTP 4xx errors are not retried; transient failures are retried once. Window focus and network reconnect do not automatically refresh data.
- `queries/dataset.ts` loads metadata once per visit. Published metadata stays fresh for that session, pinning the release. Only a running legacy import polls at 2.5-second intervals. Import mutations refresh metadata; completed imports invalidate cached sales.
- `queries/parcels.ts` debounces viewport/filter changes by 250 ms, validates filters, serializes requests and manages current/previous-year queries. Query keys contain every request parameter, including the release. Responses remain fresh until unused cache entries expire after five minutes. React Query passes AbortSignal to fetch and retains previous points during navigation.
- `components/AddressSearch.tsx` owns address autocomplete, its separate query cache and keyboard navigation. It debounces typing by 300 ms and hides obsolete suggestions immediately.
- `components/MutationFilters.tsx` is a controlled form. `ParcelResults.tsx` displays statistics, coverage, loading/errors and sorted cards. Sorting is local and does not cause network requests.
- `components/ParcelMap.tsx` is loaded separately from the main application bundle. `hooks/useParcelMap.ts` owns MapLibre lifecycle, layers and event handlers. App receives typed viewport/selection events instead of manipulating MapLibre directly. ResizeObserver handles layout changes, including the mobile switch.
- `components/DataPanel.tsx` handles legacy import controls through mutations. Published coverage is read-only. `Modal.tsx` handles focus trapping, Escape and focus restoration.
- `api.ts` preserves server error messages and HTTP status. `types.ts` contains the API contracts; `mapData.ts` converts sales or server aggregates to GeoJSON.

A map move never checks for new publications or starts ingestion. The Python API continues to filter the pinned S3 release, read geographic Parquet partitions, calculate complete statistics and return a bounded list plus map clusters.

## Checks

From `frontend/`, run `npm test`, `npm run typecheck`, `npm run format:check` and `npm run build`. `npm run test:watch` runs Vitest interactively. Tests use Testing Library and a fresh QueryClient per scenario; they cover session pinning, legacy progress, query cancellation, cache reuse, filters, keyboard autocomplete and modal focus. CI runs these alongside the backend and packaging checks.

## Internationalization

`src/i18n.ts` initializes i18next and react-i18next with bundled French and English catalogs in `src/locales/`. French is the default; the header selector saves an explicit choice in `localStorage` under `dvf-explorer.language`. Storage failures do not prevent switching. The document language, page title and description update with the UI.

Use `useTranslation()` in views, including memoized components, so translations and formatting update together. Catalog keys are checked by TypeScript against the English resource. Translate complete messages with named interpolation and plural forms, rather than concatenating translated fragments. `format.ts` formats euros, dates and numbers with `fr-FR` or `en-GB`. Add both catalog entries when extending the UI; tests verify key and placeholder parity.

Translations are presentation state: changing language does not enter query keys, refresh metadata, reset filters or recreate the map. Map navigation uses React labels and cluster numbers update on the existing MapLibre instance. `messages.ts` translates known API and validation messages at display time, including cached errors. Unknown server diagnostics and detailed legacy worker logs retain their source text. The CSV schema, raw DVF property types, cadastral identifiers and query values remain unchanged.

## Parcel diagnostics

`components/ParcelDpe.tsx` and `queries/dpe.ts` load ADEME diagnostics only while a sale detail is mounted. Matching and evidence caching live in `backend/dpe.py`. See [DPE lookup and matching limits](dpe.md).

## Parcel entry point and mutation history

The explorer requests `/api/parcels` instead of listing mutations. `backend/parcels.py` expands the matched mutation parcel arrays and returns one summary per distinct reference. Each summary identifies the latest matching mutation and the number of matching mutations; this is explicitly a selection count, not an all-time count. The 3,000-result limit is applied **after** parcel grouping, and dense map clusters count parcels. Median prices and mutation counts are calculated **before** parcel expansion, so shared transaction amounts are not counted multiple times in the statistics.

`ParcelCard` and the map both open `ParcelDetails`. Its separate `queries/history.ts` query calls `/api/parcels/{id}/mutations` with the visit's pinned release and no map/year/type/price filters. The server reads all available years for the reference's department, including rows with missing or distant mutation points. History has a stable date/ID order, full count and 50-row pagination. Local legacy mode reads the local database. Renamed, divided or merged cadastral references are not automatically linked.

The timeline selects a mutation, whose `MutationDetails` include the original whole-mutation price, property attributes and other involved parcel links. A parcel is not a dwelling: multiple flats on one parcel must not be interpreted as repeat sales of one home. Multi-parcel prices are never split or summed. `ParcelDpe` receives the chosen mutation's date and the currently open parcel, instead of implicitly using the first parcel in a shared transaction.

Map points use the latest **matching mutation's** location, not cadastral polygons. Several parcels from one mutation may share a point; overlapping dot clicks offer a parcel chooser. The interface states this approximation. Parcel CSV exports include reference, matching mutation count, latest matching date, whole-mutation price and number of involved parcels. They must not be summed to value parcels independently.
