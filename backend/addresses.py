"""Persistent, explicit BAN address ↔ parcel index (current addresses, not deed addresses)."""

import argparse
import csv
import gzip
import json
import re
import sqlite3
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path

import httpx
import store
from parcels import PARCEL_PATTERN

SOURCE = "https://adresse.data.gouv.fr/data/ban/adresses/latest/csv/adresses-{}.csv.gz"
BUILD_LOCK = threading.Lock()


def department(parcel):
    return parcel[:3] if parcel.startswith(("97", "98")) else parcel[:2]


def normalize(value):
    value = value.strip().upper()
    # DGFiP's 15-character form pads metropolitan department codes to 3,
    # and overseas commune codes to 3. DVF/IGN use a 5-character INSEE code.
    if len(value) == 15:
        index = 3 if value.startswith(("97", "98")) else 2
        if value[index] != "0":
            return None
        value = value[:index] + value[index + 1 :]
    return value if re.fullmatch(PARCEL_PATTERN, value) else None


def build_index(csv_path, destination, metadata):
    """Build separately; never replace an existing good index on a failed import."""
    con = sqlite3.connect(destination)
    try:
        con.execute(
            "CREATE TABLE addresses (parcel TEXT, id TEXT, label TEXT, postcode TEXT, city TEXT, certified INTEGER, PRIMARY KEY(parcel,id))"
        )
        with gzip.open(csv_path, "rt", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, delimiter=";")
            required = {
                "id",
                "numero",
                "rep",
                "nom_voie",
                "code_postal",
                "nom_commune",
                "cad_parcelles",
            }
            if not required.issubset(reader.fieldnames or []):
                raise ValueError("Unrecognized BAN address schema")
            batch = []
            for row in reader:
                label = " ".join(
                    v for v in (row["numero"], row["rep"], row["nom_voie"]) if v
                ).strip()
                if not row["id"] or not label:
                    continue
                for raw in row["cad_parcelles"].split("|"):
                    parcel = normalize(raw)
                    if parcel:
                        batch.append(
                            (
                                parcel,
                                row["id"],
                                label,
                                row["code_postal"],
                                row["nom_commune"],
                                int(row.get("certification_commune") == "1"),
                            )
                        )
                if len(batch) >= 2000:
                    con.executemany(
                        "INSERT OR REPLACE INTO addresses VALUES (?,?,?,?,?,?)", batch
                    )
                    batch.clear()
            con.executemany(
                "INSERT OR REPLACE INTO addresses VALUES (?,?,?,?,?,?)", batch
            )
        con.execute("CREATE TABLE metadata (value TEXT)")
        con.execute("INSERT INTO metadata VALUES (?)", (json.dumps(metadata),))
        con.commit()
    finally:
        con.close()


def ensure_index(dep, refresh=False):
    if not re.fullmatch(r"(?:[0-9]{2}|2[AB]|97[1-6])", dep):
        raise ValueError("Unsupported department")
    root = store.DATA / "addresses"
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"ban-{dep}.sqlite"
    if target.exists() and not refresh:
        return target
    with BUILD_LOCK:
        if target.exists() and not refresh:
            return target
        with tempfile.TemporaryDirectory(dir=root) as temporary:
            compressed = Path(temporary) / "addresses.csv.gz"
            url = SOURCE.format(dep)
            with httpx.stream(
                "GET", url, timeout=60, follow_redirects=True
            ) as response:
                response.raise_for_status()
                size = 0
                with compressed.open("wb") as output:
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 128 * 1024 * 1024:
                            raise ValueError("BAN export exceeds size limit")
                        output.write(chunk)
                modified = response.headers.get("last-modified")
            index = Path(temporary) / "index.sqlite"
            build_index(
                compressed,
                index,
                {
                    "url": url,
                    "updated_at": modified,
                    "indexed_at": datetime.now(UTC).isoformat(),
                },
            )
            index.replace(target)
    return target


def lookup(ids):
    result, sources, unavailable = {}, {}, []
    for dep in sorted({department(p) for p in ids}):
        try:
            path = ensure_index(dep)
            with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as con:
                sources[dep] = json.loads(
                    con.execute("SELECT value FROM metadata").fetchone()[0]
                )
                subset = sorted({p for p in ids if department(p) == dep})
                for start in range(0, len(subset), 400):
                    chunk = subset[start : start + 400]
                    rows = con.execute(
                        "SELECT parcel,id,label,postcode,city,certified FROM addresses WHERE parcel IN ("
                        + ",".join("?" for _ in chunk)
                        + ") ORDER BY certified DESC,label,id",
                        chunk,
                    )
                    for parcel, identifier, label, postcode, city, certified in rows:
                        result.setdefault(parcel, []).append(
                            {
                                "id": identifier,
                                "label": label,
                                "postcode": postcode,
                                "city": city,
                                "certified": bool(certified),
                            }
                        )
        except httpx.HTTPError, OSError, ValueError, sqlite3.Error, EOFError:
            unavailable.append(dep)
    return {"addresses": result, "sources": sources, "unavailable": unavailable}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--department", required=True)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    print(ensure_index(args.department, args.refresh))
