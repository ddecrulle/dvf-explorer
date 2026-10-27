# Parcel DPE lookup

The parcel detail contains an on-demand DPE section for the currently selected mutation date. No diagnostics are requested for the sale list, map movements, clustering or exports. A shared mutation retains the currently open parcel when its date is used for the DPE search. The standalone DPE component also supports a parcel selector and requests only the chosen reference.

## Sources and API

- ADEME: [DPE for existing dwellings since July 2021](https://data.ademe.fr/datasets/dpe03existant), via its public Data Fair `lines` API.
- IGN: [API Carto cadastre](https://apicarto.ign.fr/api/doc/cadastre), for the current parcel polygon.
- App endpoint: `GET /api/parcels/{14-character-id}/dpe?at=YYYY-MM-DD&kind=Maison&surface=100&simple=true&release=<release>`. `at` is the sale date. `release` pins the sales dataset for address evidence. The property parameters are matching hints, not authoritative property identification.

The server validates inputs and obtains the exact parcel ID (including absorbed-commune prefix). It queries up to 500 ADEME records within its bounding box and, separately, up to 500 records at numbered BAN address IDs explicitly linked to the parcel in the local BAN index. The latter query is not bounded by the polygon: address/entrance points can lie outside cadastral boundaries. At most 50 linked IDs are queried; larger sets are explicitly incomplete. Polygon intersection is checked in Python with Shapely. There is no nearest-point or fuzzy street-address fallback. Parcels larger than 0.1 degree in either dimension are declined to bound upstream work. Any truncated query prevents a probable match.

## Conservative attribution

Only diagnostics established from 2021-07-01 through the sale date, with an explicit expiry on or after that date, are considered. Records require a valid certificate number, an A–G energy class and a numbered BAN address identifier. Three evidence routes are distinguished:

- **Polygon:** a finite point inside the parcel and BAN score of at least 0.8.
- **Linked address:** the diagnostic's BAN ID belongs to an address explicitly linked to the parcel in the current BAN index. This can recover lower-score diagnostics or points outside the polygon, but remains an address-level candidate, labelled **linked address · verify**, with `location_method=ban_address` and `match=address`. It never receives a probable match solely from that link.

- **Declared sale address:** when a single-parcel sale has one unique declared address on the selected date, IGN resolves it to one unique numbered BAN ID in the same commune. The full normalized address must match exactly; standard road abbreviations are expanded. Records remain **sale address · verify**, with `location_method=dvf_address` and `match=address`, never probable solely from that address.

An exact ID avoids assigning neighbouring or vaguely similar street addresses. The ADEME geocode itself can still be wrong, the current BAN link may differ from historical geography, and multiple dwellings may share the address. A missing/renumbered parcel is a separate outcome from no matching diagnostic. Earlier diagnostics remain outside this implementation's coverage.

Duplicate certificate numbers are collapsed. An older certificate is suppressed only by a qualifying replacement established on or before the sale. Future replacements cannot suppress historical candidates. Repeated older diagnostics otherwise remain visible; the app does not infer that they concern the same dwelling.

Only a simple, single-parcel house sale with known surface and exactly one compatible house diagnostic supported by the polygon route receives **probable match**. Address-only candidates are included when evaluating ambiguity. Surface tolerance is the larger of 5 m² and 10% of the DVF surface; the underlying area definitions differ. Apartments, complex sales and ambiguous matches never receive an individual-dwelling assignment.

Labels are the values **currently published by ADEME**, even when the diagnostic predates the sale. Neither the data nor this match proves which diagnostic/attestation was attached to the deed or the historical label at the transaction date. Revisions after the sale remain possible. The UI states this alongside the certificate link, dates, area, energy and climate classes. No diagnostic is presented as certified attribution to the sale.

## Cache and operation

Successful evidence responses are cached for 24 hours under `DVF_DATA_DIR/dpe/`, keyed by parcel, sale date, pinned sales release and matching cache version. Version 3 invalidates prior results that did not consult declared sale addresses. If the BAN index or declared-address lookup is temporarily unavailable, remaining evidence is marked incomplete, shown with a retry action, and is not saved to the server cache. Only selected public fields are stored. At most 512 evidence files are retained; raw publications and existing S3 sale releases are not changed. Bounded locks coalesce concurrent requests. ADEME/IGN calls time out after 12 seconds each; preparing a missing BAN index follows the address service's download limits. ADEME/IGN failures are not cached and produce HTTP 502 rather than an empty result. Failed/unwritable caches do not prevent a successful lookup.

React Query caches each parcel/date/matching context for the visit, passes cancellation to fetch, and does not poll or automatically retry these lookups. Manual retry is available. Language switching preserves the query. Older sales, missing references, missing parcels, empty evidence, oversized parcels and service outages have separate translated states.

Run `.venv/bin/python -m pytest backend/tests/test_dpe.py -q` and `npm --prefix frontend test`. Backend fixtures mock official HTTP services and cover geometry, dates, replacement, ambiguity and cache behavior. UI tests cover on-demand requests, reopen caching, parcel switching, cancellation, errors and translations.
