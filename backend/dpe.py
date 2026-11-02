"""On-demand public ADEME diagnostics on an IGN cadastral parcel.

Polygon matches and explicit BAN address membership provide candidate evidence,
never proof of the dwelling or certificate supplied in a deed. No nearest-point fallback.
"""

import hashlib
import json
import math
import re
import threading
import time
from datetime import date, datetime, timezone

import httpx
from shapely.errors import GEOSException
from shapely.geometry import Point, shape
from shapely.ops import unary_union

import store
import addresses
import dataset
import dpe_addresses
from archive import atomic_json
from parcels import PARCEL_PATTERN

SOURCE = "https://data.ademe.fr/datasets/dpe03existant"
NEW_SOURCE = "https://data.ademe.fr/datasets/g3cgx7jb3cmys5voxz1mrm22"
NEW_LINES = (
    "https://data.ademe.fr/data-fair/api/v1/datasets/g3cgx7jb3cmys5voxz1mrm22/lines"
)
LINES = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines"
DATASETS = (("existing", LINES), ("new", NEW_LINES))
CADASTRE = "https://apicarto.ign.fr/api/cadastre/parcelle"
SINCE = date(2021, 7, 1)
CACHE_TTL = 24 * 3600
CACHE_VERSION = 5
MAX_ROWS = 500
MAX_ADDRESSES = 50
BAN_ID = re.compile(r"[0-9AB]{5}_[A-Za-z0-9]+_[0-9]+(?:_[A-Za-z0-9]+)?")
MAX_CACHE_FILES = 512
# Bounded single-flight locks prevent duplicate upstream requests for a parcel.
_LOCKS = [threading.Lock() for _ in range(32)]
_FIELDS = ",".join(
    [
        "numero_dpe",
        "numero_dpe_remplace",
        "date_etablissement_dpe",
        "date_fin_validite_dpe",
        "date_derniere_modification_dpe",
        "etiquette_dpe",
        "etiquette_ges",
        "type_batiment",
        "surface_habitable_logement",
        "adresse_ban",
        "adresse_brut",
        "nom_rue_ban",
        "identifiant_ban",
        "score_ban",
        "_geopoint",
        "conso_5_usages_par_m2_ep",
        "emission_ges_5_usages_par_m2",
    ]
)


class UpstreamError(Exception):
    pass


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except ValueError, TypeError:
        return None


def _day(value):
    try:
        return date.fromisoformat(value)
    except ValueError, TypeError:
        return None


def address_conflict(row):
    """Reject a definite disagreement between entered and geocoded street names.

    Compare only a numbered first address line; incomplete raw addresses stay
    unclassified. This is not proof that an unflagged address is correct.
    """
    raw = row.get("adresse_brut")
    normalized = row.get("nom_rue_ban") or row.get("adresse_ban")
    if not isinstance(raw, str) or not isinstance(normalized, str):
        return False
    raw = raw.splitlines()[0] if raw.strip() else ""
    raw = dpe_addresses.address_key(raw)
    if not re.match(r"^\d+\s", raw):
        return False

    def street(value):
        words = dpe_addresses.address_key(value).split()
        result = []
        for word in words:
            if len(word) == 5 and word.isdigit():
                break
            if word in ("APPARTEMENT", "APPT", "BATIMENT", "BAT", "ETAGE", "RDC"):
                break
            if word.isdigit() or word in (
                "RUE",
                "AVENUE",
                "BOULEVARD",
                "ROUTE",
                "IMPASSE",
                "CHEMIN",
                "ALLEE",
                "PLACE",
                "DE",
                "DU",
                "DES",
                "LA",
                "LE",
                "LES",
                "BIS",
                "TER",
            ):
                continue
            result.append(word)
        return result

    entered, geocoded = street(raw), street(normalized)
    # Missing road types, abbreviations and additional location text do not
    # create a conflict when either complete street token sequence matches.
    return bool(
        entered
        and geocoded
        and not (
            entered[: len(geocoded)] == geocoded or geocoded[: len(entered)] == entered
        )
    )


def ademe_payloads(client, params):
    """Read both official datasets; keep successful evidence on partial failure."""
    payloads, unavailable = [], []
    for dataset_kind, endpoint in DATASETS:
        try:
            response = client.get(endpoint, params=params)
            response.raise_for_status()
            payload = response.json()
            rows, total = payload["results"], payload["total"]
            if (
                not isinstance(rows, list)
                or not isinstance(total, int)
                or total < len(rows)
                or len(rows) > int(params["size"])
                or any(not isinstance(row, dict) for row in rows)
            ):
                raise ValueError("Invalid ADEME response")
            payloads.append(
                dict(
                    payload,
                    results=[dict(row, dataset_kind=dataset_kind) for row in rows],
                )
            )
        except httpx.HTTPError, ValueError, KeyError, TypeError:
            unavailable.append(dataset_kind)
    return payloads, unavailable


def _fetch(
    parcel,
    at,
    client,
    address_ids=(),
    address_unavailable=False,
    declared_ids=(),
    all_dates=False,
):
    response = client.get(
        CADASTRE,
        params={
            "code_insee": parcel[:5],
            "prefixe": parcel[5:8],
            "section": parcel[8:10],
            "numero": parcel[10:],
        },
    )
    response.raise_for_status()
    features = response.json()["features"]
    # Older/renumbered parcels may be absent from today's cadastre. Do not
    # substitute a neighbouring parcel or ignore the absorbed-commune prefix.
    geometries = [
        shape(feature["geometry"])
        for feature in features
        if feature.get("properties", {}).get("idu") == parcel
    ]
    if not geometries:
        return {"state": "parcel_unavailable", "diagnostics": [], "truncated": False}
    geometry = unary_union(geometries)
    if (
        geometry.is_empty
        or not geometry.is_valid
        or geometry.geom_type not in ("Polygon", "MultiPolygon")
    ):
        raise UpstreamError("Invalid cadastral geometry")
    west, south, east, north = geometry.bounds
    if east - west > 0.1 or north - south > 0.1:
        return {"state": "area_too_large", "diagnostics": [], "truncated": False}
    payloads, unavailable = ademe_payloads(
        client,
        {
            "bbox": f"{west},{south},{east},{north}",
            "size": MAX_ROWS,
            "sort": "-date_etablissement_dpe,numero_dpe",
            "select": _FIELDS,
            "qs": f"date_etablissement_dpe:[{SINCE.isoformat()} TO {at.isoformat()}]",
        },
    )
    identifiers = sorted(
        {i for i in address_ids if isinstance(i, str) and BAN_ID.fullmatch(i)}
    )
    linked_identifiers = set(identifiers)
    declared_identifiers = {
        i for i in declared_ids if isinstance(i, str) and BAN_ID.fullmatch(i)
    }
    identifiers = sorted(linked_identifiers | declared_identifiers)
    truncated = address_unavailable or len(identifiers) > MAX_ADDRESSES
    identifiers = set(identifiers[:MAX_ADDRESSES])
    if identifiers:
        # Explicit BAN parcel membership is independent of the geocoded point:
        # an entrance/address point may lie on the pavement outside the polygon.
        terms = " OR ".join(f'identifiant_ban:"{i}"' for i in sorted(identifiers))
        linked_payloads, linked_unavailable = ademe_payloads(
            client,
            {
                "qs": f"({terms}) AND date_etablissement_dpe:[{SINCE.isoformat()} TO {at.isoformat()}]",
                "size": MAX_ROWS,
                "sort": "-date_etablissement_dpe,numero_dpe",
                "select": _FIELDS,
            },
        )
        payloads.extend(linked_payloads)
        unavailable.extend(linked_unavailable)
    truncated |= bool(unavailable)
    if not payloads:
        raise UpstreamError("Both ADEME datasets unavailable")
    rows = []
    for payload in payloads:
        batch, total = payload["results"], payload["total"]
        if (
            not isinstance(batch, list)
            or not isinstance(total, int)
            or len(batch) > MAX_ROWS
        ):
            raise UpstreamError("Invalid ADEME result")
        truncated |= total > len(batch)
        rows.extend(batch)
    diagnostics = {}
    conflicts = set()
    for row in rows:
        if address_conflict(row):
            conflicts.add(row.get("numero_dpe"))
            continue
        established, expires = (
            _day(row.get("date_etablissement_dpe")),
            _day(row.get("date_fin_validite_dpe")),
        )
        if (
            not established
            or not SINCE <= established <= at
            or (not all_dates and (not expires or at > expires))
        ):
            continue
        identifier = row.get("numero_dpe", "")
        if not isinstance(identifier, str) or not re.fullmatch(
            r"[A-Za-z0-9]{13}", identifier
        ):
            continue
        score = _number(row.get("score_ban"))
        address_id = row.get("identifiant_ban", "")
        if not isinstance(address_id, str) or not BAN_ID.fullmatch(address_id):
            continue
        inside = False
        try:
            lat, lon = map(float, row["_geopoint"].split(","))
            inside = (
                math.isfinite(lat)
                and math.isfinite(lon)
                and geometry.covers(Point(lon, lat))
            )
        except KeyError, ValueError, TypeError, AttributeError:
            pass
        reliable_location = inside and score is not None and score >= 0.8
        # New-building addresses may predate the current BAN (e.g. 16 vs 14).
        # Keep these spatial candidates only with a numbered entered address;
        # they are explicitly uncertain and never promoted to a sale match.
        uncertain_location = (
            inside
            and row.get("dataset_kind") == "new"
            and isinstance(row.get("adresse_brut"), str)
            and bool(re.match(r"^\s*\d+\s+[A-Za-zÀ-ÿ]", row["adresse_brut"]))
            and score is not None
            and score > 0
        )
        if (
            not reliable_location
            and not uncertain_location
            and address_id not in identifiers
        ):
            continue
        energy = row.get("etiquette_dpe")
        if energy not in list("ABCDEFG"):
            continue
        climate = row.get("etiquette_ges")
        if identifier in diagnostics:
            continue
        diagnostics[identifier] = {
            "id": identifier,
            "energy_class": energy,
            "climate_class": climate if climate in list("ABCDEFG") else None,
            "established_at": established.isoformat(),
            "expires_at": expires.isoformat() if expires else None,
            "dataset_kind": row.get("dataset_kind", "existing"),
            "raw_address": row.get("adresse_brut") or "",
            "modified_at": row.get("date_derniere_modification_dpe"),
            "kind": row.get("type_batiment"),
            "surface": _number(row.get("surface_habitable_logement")),
            "address": row.get("adresse_ban") or "",
            "consumption": _number(row.get("conso_5_usages_par_m2_ep")),
            "emissions": _number(row.get("emission_ges_5_usages_par_m2")),
            "replaces": row.get("numero_dpe_remplace"),
            "location_method": "geometry"
            if reliable_location
            else ("ban_address" if address_id in linked_identifiers else "dvf_address")
            if address_id in identifiers
            else "geometry_uncertain",
            "url": "https://observatoire-dpe-audit.ademe.fr/afficher-dpe/" + identifier,
        }
    # A replacement established AFTER the sale cannot suppress an earlier DPE.
    # All records here have already passed the date/validity checks.
    replaced = {d["replaces"] for d in diagnostics.values() if d["replaces"]}
    return {
        "state": "ok",
        "diagnostics": sorted(
            (d for key, d in diagnostics.items() if all_dates or key not in replaced),
            key=lambda d: (d["established_at"], d["id"]),
            reverse=True,
        ),
        "truncated": truncated,
        "address_lookup_unavailable": address_unavailable,
        "datasets_unavailable": sorted(set(unavailable)),
        "address_conflicts": len(conflicts),
    }


def parcel_diagnostics(parcel, at, release=None, all_dates=False):
    """Cache evidence by parcel and sale date, not by client-supplied features."""
    if not re.fullmatch(PARCEL_PATTERN, parcel):
        raise ValueError("Invalid cadastral identifier")
    if at < SINCE and not all_dates:
        return {
            "state": "before_coverage",
            "diagnostics": [],
            "truncated": False,
            "source": SOURCE,
            "parcel": parcel,
            "as_of": at.isoformat(),
            "fetched_at": None,
        }
    # Address evidence must use the same immutable sale publication as the UI.
    try:
        snapshot = dataset.snapshot(release)
    except Exception as exc:
        raise UpstreamError(
            "Sale publication unavailable for DPE address lookup"
        ) from exc
    release = snapshot["release"] if snapshot else None
    key = hashlib.sha256(
        f"{CACHE_VERSION}:{parcel}:{at}:{release or 'local'}:{all_dates}".encode()
    ).hexdigest()
    path = store.DATA / "dpe" / (key + ".json")
    with _LOCKS[int(key[:2], 16) % len(_LOCKS)]:
        try:
            cached = json.loads(path.read_text())
            if 0 <= time.time() - path.stat().st_mtime < CACHE_TTL:
                return cached
        except OSError, ValueError:
            pass
        try:
            lookup = addresses.lookup([parcel])
            address_ids = [a["id"] for a in lookup["addresses"].get(parcel, [])]
            address_unavailable = bool(lookup["unavailable"])
            with httpx.Client(timeout=12, follow_redirects=False) as client:
                declared_unavailable = False
                try:
                    declared_ids = dpe_addresses.lookup(parcel, at, client, release)
                except Exception:
                    # A sale/address lookup failure must not discard spatial DPE results.
                    declared_ids = []
                    declared_unavailable = True
                result = _fetch(
                    parcel,
                    date.today() if all_dates else at,
                    client,
                    address_ids,
                    address_unavailable,
                    declared_ids,
                    all_dates,
                )
                result["declared_address_lookup_unavailable"] = declared_unavailable
                result["truncated"] |= declared_unavailable
        except (httpx.HTTPError, ValueError, KeyError, TypeError, GEOSException) as exc:
            raise UpstreamError("DPE services unavailable") from exc
        result.update(
            source=SOURCE,
            sources=[SOURCE, NEW_SOURCE],
            parcel=parcel,
            as_of=at.isoformat(),
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        try:
            if (
                not result.get("datasets_unavailable")
                and not result.get("address_lookup_unavailable")
                and not result.get("declared_address_lookup_unavailable")
            ):
                atomic_json(path, result)
            files = sorted(path.parent.glob("*.json"), key=lambda f: f.stat().st_mtime)
            for old in files[:-MAX_CACHE_FILES]:
                old.unlink(missing_ok=True)
        except OSError:
            # Read-only/full disks must not turn a successful lookup into failure.
            pass
        return result


def match_sale(evidence, kind="", surface=None, simple=False):
    """Suggest only a single compatible house; apartment diagnostics stay candidates."""
    diagnostics = [
        dict(
            item,
            match="uncertain"
            if item.get("location_method") == "geometry_uncertain"
            else "address"
            if item.get("location_method") in ("ban_address", "dvf_address")
            else "parcel",
        )
        for item in evidence["diagnostics"]
    ]
    compatible = []
    if (
        simple
        and kind == "Maison"
        and surface
        and surface > 0
        and not evidence["truncated"]
    ):
        compatible = [
            d
            for d in diagnostics
            if d["kind"] == "maison"
            and d["surface"]
            and abs(d["surface"] - surface) <= max(5, surface * 0.1)
        ]
    if len(compatible) == 1 and compatible[0]["match"] == "parcel":
        compatible[0]["match"] = "probable"
    return dict(evidence, diagnostics=diagnostics)
