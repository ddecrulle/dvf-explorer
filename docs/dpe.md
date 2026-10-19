# Parcel DPE lookup

The parcel detail contains an on-demand DPE section for the currently selected mutation date. No diagnostics are requested for the sale list, map movements, clustering or exports. A shared mutation retains the currently open parcel when its date is used for the DPE search. The standalone DPE component also supports a parcel selector and requests only the chosen reference.

## Sources and API

- ADEME: [DPE for existing dwellings since July 2021](https://data.ademe.fr/datasets/dpe03existant), via its public Data Fair `lines` API.
- IGN: [API Carto cadastre](https://apicarto.ign.fr/api/doc/cadastre), for the current parcel polygon.
- App endpoint: `GET /api/parcels/{14-character-id}/dpe?at=YYYY-MM-DD&kind=Maison&surface=100&simple=true`. `at` is the sale date. The last three parameters are matching hints, not authoritative property identification.

The server validates inputs, obtains the exact parcel ID (including absorbed-commune prefix), then requests up to 500 ADEME records within its bounding box. Polygon intersection is checked in Python with Shapely. There is no nearest-point fallback. Parcels larger than 0.1 degree in either dimension are declined to bound upstream work. If the bounding box exceeds 500 records, the response is explicitly incomplete and cannot contain a probable match.

## Conservative attribution

Only diagnostics established from 2021-07-01 through the sale date, with an explicit expiry on or after that date, are considered. Records must have a valid certificate number, an A–G energy class, a numbered BAN address identifier, a finite point actually inside the parcel and BAN score of at least 0.8. This intentionally reduces coverage: a reliable diagnostic may be omitted when geocoding is imprecise or its address point lies outside the cadastral polygon. A missing/renumbered parcel is a separate outcome from no matching diagnostic.

Duplicate certificate numbers are collapsed. An older certificate is suppressed only by a qualifying replacement established on or before the sale. Future replacements cannot suppress historical candidates. Repeated older diagnostics otherwise remain visible; the app does not infer that they concern the same dwelling.

Every result is initially **parcel only**. Only a simple, single-parcel house sale with known surface and exactly one compatible house diagnostic receives **probable match**. Surface tolerance is the larger of 5 m² and 10% of the DVF surface; the underlying area definitions differ. Apartments, complex sales and ambiguous matches never receive an individual-dwelling assignment.

Labels are the values **currently published by ADEME**, even when the diagnostic predates the sale. Neither the data nor this match proves which diagnostic/attestation was attached to the deed or the historical label at the transaction date. Revisions after the sale remain possible. The UI states this alongside the certificate link, dates, area, energy and climate classes. No diagnostic is presented as certified attribution to the sale.

## Cache and operation

Successful evidence responses are cached for 24 hours under `DVF_DATA_DIR/dpe/`, keyed by parcel, sale date and matching cache version. Only selected public fields are stored. At most 512 evidence files are retained; raw DWG/CSV publications and existing S3 sale releases are not changed. Bounded locks coalesce concurrent requests. Upstream calls time out after 12 seconds per service, failures are not cached, and unavailable services produce HTTP 502 rather than an empty result. Failed/unwritable caches do not prevent a successful lookup.

React Query caches each parcel/date/matching context for the visit, passes cancellation to fetch, and does not poll or automatically retry these lookups. Manual retry is available. Language switching preserves the query. Older sales, missing references, missing parcels, empty evidence, oversized parcels and service outages have separate translated states.

Run `.venv/bin/python -m pytest backend/tests/test_dpe.py -q` and `npm --prefix frontend test`. Backend fixtures mock official HTTP services and cover geometry, dates, replacement, ambiguity and cache behavior. UI tests cover on-demand requests, reopen caching, parcel switching, cancellation, errors and translations.
