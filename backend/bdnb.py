"""Current BDNB building context, deliberately separate from sale-date DPE evidence."""

import hashlib
import json
import re
import threading
import time
from datetime import UTC, datetime

import httpx
import store
from archive import atomic_json
from dpe import LINES, _day, _number
from dpe import SOURCE as ADEME_SOURCE
from parcels import PARCEL_PATTERN

BASE = "https://api.bdnb.io/v1/bdnb/donnees"
SOURCE = "https://www.bdnb.io/documentation/methode_traitement_dpe/"
MAX_BUILDINGS = 20
CACHE_TTL = 86400
_LOCKS = [threading.Lock() for _ in range(32)]


class UpstreamError(Exception):
    pass


def _rows(client, table, params):
    response = client.get(f"{BASE}/{table}", params=params)
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        raise UpstreamError("Invalid BDNB response")
    return rows


def _grade(value):
    return value if isinstance(value, str) and value in list("ABCDEFG") else None


def _representative(row):
    identifier = row.get("identifiant_dpe")
    identifier = (
        identifier
        if isinstance(identifier, str) and re.fullmatch(r"[A-Za-z0-9]{13}", identifier)
        else None
    )
    return {
        "id": identifier,
        "energy_class": _grade(row.get("classe_bilan_dpe")),
        "climate_class": _grade(row.get("classe_emission_ges")),
        "issued_at_bdnb": row.get("date_etablissement_dpe"),
        "kind": row.get("type_batiment_dpe"),
        "surface": _number(row.get("surface_habitable_logement")),
        "ademe_state": "unavailable" if identifier else "no_identifier",
        "ademe": None,
    }


def _verify(client, buildings):
    representatives = [b["representative"] for b in buildings if b["representative"]]
    ids = sorted({r["id"] for r in representatives if r["id"]})
    if not ids:
        return False
    try:
        response = client.get(
            LINES,
            params={
                "qs": " OR ".join(f'numero_dpe:"{i}"' for i in ids),
                "size": MAX_BUILDINGS + 1,
                "select": "numero_dpe,etiquette_dpe,etiquette_ges,date_etablissement_dpe,date_fin_validite_dpe,type_batiment,surface_habitable_logement,adresse_ban",
            },
        )
        response.raise_for_status()
        payload = response.json()
        rows, total = payload["results"], payload["total"]
        if (
            not isinstance(rows, list)
            or not isinstance(total, int)
            or total != len(rows)
        ):
            raise UpstreamError("Incomplete ADEME response")
        found = {}
        for row in rows:
            identifier = row["numero_dpe"]
            if identifier not in ids or identifier in found:
                raise UpstreamError("Ambiguous ADEME identifier")
            found[identifier] = row
        for rep in representatives:
            if not rep["id"]:
                continue
            row = found.get(rep["id"])
            rep["ademe_state"] = "found" if row else "not_found"
            if row:
                issued = _day(row.get("date_etablissement_dpe"))
                expires = _day(row.get("date_fin_validite_dpe"))
                rep["ademe"] = {
                    "energy_class": _grade(row.get("etiquette_dpe")),
                    "climate_class": _grade(row.get("etiquette_ges")),
                    "established_at": issued.isoformat() if issued else None,
                    "expires_at": expires.isoformat() if expires else None,
                    "address": row.get("adresse_ban") or "",
                    "kind": row.get("type_batiment"),
                    "surface": _number(row.get("surface_habitable_logement")),
                    "url": "https://observatoire-dpe-audit.ademe.fr/afficher-dpe/"
                    + rep["id"],
                }
        return False
    except httpx.HTTPError, ValueError, KeyError, TypeError, UpstreamError:
        return True


def _fetch(parcel, client):
    relations = _rows(
        client,
        "rel_batiment_groupe_parcelle",
        {
            "parcelle_id": "eq." + parcel,
            "select": "parcelle_id,batiment_groupe_id,parcelle_principale",
            "order": "batiment_groupe_id.asc",
            "limit": MAX_BUILDINGS + 1,
        },
    )
    buildings = {}
    for row in relations:
        identifier = row.get("batiment_groupe_id")
        if (
            row.get("parcelle_id") != parcel
            or not isinstance(identifier, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identifier)
        ):
            raise UpstreamError("Invalid parcel-building relation")
        buildings[identifier] = {
            "id": identifier,
            "main_parcel": row.get("parcelle_principale") is True,
            "representative": None,
        }
    truncated = len(relations) > MAX_BUILDINGS
    buildings = dict(list(buildings.items())[:MAX_BUILDINGS])
    if buildings:
        rows = _rows(
            client,
            "batiment_groupe_dpe_representatif_logement",
            {
                "batiment_groupe_id": "in.(" + ",".join(buildings) + ")",
                "select": "batiment_groupe_id,identifiant_dpe,classe_bilan_dpe,classe_emission_ges,date_etablissement_dpe,type_batiment_dpe,surface_habitable_logement",
                "limit": MAX_BUILDINGS + 1,
            },
        )
        for row in rows:
            identifier = row.get("batiment_groupe_id")
            if (
                identifier not in buildings
                or buildings[identifier]["representative"] is not None
            ):
                raise UpstreamError("Ambiguous building representative")
            buildings[identifier]["representative"] = _representative(row)
    buildings = list(buildings.values())
    unavailable = _verify(client, buildings)
    return {
        "parcel": parcel,
        "buildings": buildings,
        "truncated": truncated,
        "ademe_unavailable": unavailable,
        "source": SOURCE,
        "ademe_source": ADEME_SOURCE,
        "scope": "current_building_representative",
        "fetched_at": datetime.now(UTC).isoformat(),
    }


def lookup(parcel):
    if not re.fullmatch(PARCEL_PATTERN, parcel):
        raise ValueError("Invalid cadastral identifier")
    key = hashlib.sha256(f"1:{parcel}".encode()).hexdigest()
    path = store.DATA / "bdnb" / (key + ".json")
    with _LOCKS[int(key[:2], 16) % len(_LOCKS)]:
        try:
            if 0 <= time.time() - path.stat().st_mtime < CACHE_TTL:
                return json.loads(path.read_text())
        except OSError, ValueError:
            pass
        try:
            with httpx.Client(timeout=12, follow_redirects=False) as client:
                result = _fetch(parcel, client)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise UpstreamError("BDNB unavailable") from exc
        try:
            if not result["ademe_unavailable"]:
                atomic_json(path, result)
            files = sorted(path.parent.glob("*.json"), key=lambda p: p.stat().st_mtime)
            for old in files[:-512]:
                old.unlink(missing_ok=True)
        except OSError:
            pass
        return result
