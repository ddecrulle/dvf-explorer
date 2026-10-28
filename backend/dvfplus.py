"""Prepare official DVF+ mutation CSVs in an isolated, resumable worker database."""

import argparse
import csv
import io
import json
import math
import re
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import duckdb
import httpx
from pyproj import Transformer

from publish import digest
from store import STORAGE_COMPATIBILITY, create_schema

SOURCE = "https://www.data.gouv.fr/datasets/dvf-open-data"
BOX = "https://cerema.app.box.com/v/dvfplus-opendata"
REQUIRED = {
    "idopendata",
    "datemut",
    "coddep",
    "libnatmut",
    "valeurfonc",
    "l_codinsee",
    "l_idpar",
    "nbpar",
    "nblocmai",
    "nblocapt",
    "nblocact",
    "nblocmut",
    "sbati",
    "sterr",
    "geompar_x",
    "geompar_y",
}
csv.field_size_limit(16 * 1024 * 1024)


def number(value):
    if value in (None, "", "NULL", "None"):
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Non-finite DVF+ number")
    return result


def normalise(row, transformer, cities=None, source=SOURCE):
    amount = number(row["valeurfonc"])
    if row["libnatmut"] != "Vente" or amount is None or amount <= 0:
        return None
    identifier = row["idopendata"].strip()
    if not identifier:
        raise ValueError("Missing public DVF+ transaction identifier")
    day = date.fromisoformat(row["datemut"])
    department = row["coddep"].zfill(2)
    codes = sorted(set(filter(None, row["l_codinsee"].split(","))))
    parcels = sorted(set(filter(None, row["l_idpar"].split(","))))
    houses, flats, business = (
        int(number(row[k]) or 0) for k in ("nblocmai", "nblocapt", "nblocact")
    )
    if houses and not flats and not business:
        kind = "Maison"
    elif flats and not houses and not business:
        kind = "Appartement"
    elif business and not houses and not flats:
        kind = "Local industriel. commercial ou assimilé"
    elif houses or flats or business:
        kind = "Mixte"
    else:
        kind = "Terrain / dépendance"
    # Dependencies are counted in nblocmut but have no living floor area.
    # A single main premise plus dependencies still has a usable built surface.
    # Multiple main premises or parcels do not have a single-building price/m².
    simple = (
        houses + flats + business == 1
        and int(number(row["nblocmut"]) or 0) >= 1
        and int(number(row["nbpar"]) or 0) == 1
        and len(parcels) == 1
        and len(codes) == 1
    )
    surface = number(row["sbati"]) if simple else None
    surface = surface if surface and surface > 0 else None
    rooms = None  # CSV room buckets include 5+ rooms, not exact room counts.
    lon = lat = None
    x, y = number(row["geompar_x"]), number(row["geompar_y"])
    if x is not None and y is not None:
        lon, lat = transformer.transform(x, y, errcheck=True)
        if not (
            math.isfinite(lon)
            and math.isfinite(lat)
            and -180 <= lon <= 180
            and -85 <= lat <= 85
        ):
            raise ValueError(
                "Invalid transformed DVF+ coordinates; verify the source CRS"
            )
    names = [(cities or {}).get(code, code) for code in codes]
    return (
        "dvfplus:" + identifier,
        day.isoformat(),
        amount,
        "",
        ", ".join(names),
        department,
        codes[0] if codes else "",
        kind,
        surface,
        number(row["sterr"]),
        rooms,
        lon,
        lat,
        json.dumps(parcels),
        1,
        day.year,
        source,
        not simple,
        int(number(row["nblocdep"]))
        if number(row.get("nblocdep")) is not None
        else None,
    )


def prepare(
    archive, database, start, end, crs, cities=None, source=SOURCE, progress=print
):
    if start > end:
        raise ValueError("Invalid coverage bounds")
    archive, database = Path(archive), Path(database)
    database.parent.mkdir(parents=True, exist_ok=True)
    checksum = digest(archive)
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    con = duckdb.connect(
        str(database),
        config={
            "memory_limit": "2GB",
            "threads": 2,
            "storage_compatibility_version": STORAGE_COMPATIBILITY,
        },
    )
    try:
        create_schema(con)
        con.execute(
            "CREATE TABLE IF NOT EXISTS dvfplus_sources (department VARCHAR PRIMARY KEY, sha256 VARCHAR, coverage_start DATE, coverage_end DATE, crs VARCHAR, source VARCHAR)"
        )
        con.execute(
            "ALTER TABLE dvfplus_sources ADD COLUMN IF NOT EXISTS normalization VARCHAR DEFAULT ''"
        )
        import hashlib

        normalization = (
            "v3:dependency-count:"
            + hashlib.sha256(
                json.dumps(cities or {}, sort_keys=True).encode()
            ).hexdigest()
        )
        schema = {r[0]: r[1] for r in con.execute("DESCRIBE sales").fetchall()}
        from contextlib import ExitStack

        with (
            zipfile.ZipFile(archive) as z,
            tempfile.TemporaryDirectory(dir=database.parent) as tmp,
            ExitStack() as opened,
        ):
            members = [
                n
                for n in z.namelist()
                if re.search(r"dvf_plus(?:_d(?:\d{2,3}|2[AB]))?\.csv$", n, re.I)
            ]
            if not members:
                raise ValueError("No official DVF+ mutation CSV found")
            writers, seen, skipped = {}, {}, set()
            for name in members:
                with z.open(name) as f:
                    rows = csv.DictReader(
                        io.TextIOWrapper(f, encoding="utf-8-sig"), delimiter="|"
                    )
                    if not REQUIRED.issubset(rows.fieldnames or []):
                        raise ValueError("DVF+ CSV schema is missing required columns")
                    named_dep = re.search(r"_d([^/]+)\.csv$", name, re.I)
                    for row in rows:
                        dep = row["coddep"].zfill(2)
                        if not re.fullmatch(r"(?:\d{2}|2[AB]|97\d)", dep):
                            raise ValueError("Invalid source department")
                        if named_dep and named_dep[1].upper() != dep:
                            raise ValueError(
                                "DVF+ department differs from the source filename"
                            )
                        if len(dep) == 3 and crs == "EPSG:2154":
                            raise ValueError(
                                "Overseas CSVs require their documented local CRS; Lambert-93 is metropolitan only"
                            )
                        day = date.fromisoformat(row["datemut"])
                        if not start <= day <= end:
                            raise ValueError(
                                "Source date is outside the declared replacement period"
                            )
                        if dep not in seen:
                            seen[dep] = 0
                            # DuckDB 2 requires this lookup to be fully consumed
                            # before the relational CSV work below.
                            markers = con.execute(
                                "SELECT sha256,coverage_start,coverage_end,crs,source,normalization FROM dvfplus_sources WHERE department=?",
                                [dep],
                            ).fetchall()
                            marker = markers[0] if markers else None
                            if marker == (
                                checksum,
                                start,
                                end,
                                crs,
                                source,
                                normalization,
                            ):
                                skipped.add(dep)
                            else:
                                progress(f"DVF+ {dep}: preparing geolocated mutations")
                                out = opened.enter_context(
                                    (Path(tmp) / f"{dep}.csv").open("w", newline="")
                                )
                                writers[dep] = csv.writer(out)
                                writers[dep].writerow(schema)
                        seen[dep] += 1
                        if dep not in skipped:
                            value = normalise(row, transformer, cities, source)
                            if value:
                                writers[dep].writerow(value)
            opened.close()
            if not seen:
                raise ValueError("Empty source; refusing replacement")
            for dep in sorted(seen):
                if dep in skipped:
                    progress(f"DVF+ {dep}: already prepared")
                    continue
                stage = Path(tmp) / f"{dep}.csv"
                con.read_csv(str(stage), header=True, columns=schema).create_view(
                    "incoming"
                )
                con.execute("BEGIN TRANSACTION")
                try:
                    con.execute(
                        "DELETE FROM sales WHERE department=? AND date BETWEEN ? AND ?",
                        [dep, start, end],
                    )
                    con.execute("INSERT INTO sales SELECT * FROM incoming")
                    con.execute(
                        "INSERT OR REPLACE INTO dvfplus_sources VALUES (?,?,?,?,?,?,?)",
                        [dep, checksum, start, end, crs, source, normalization],
                    )
                    con.execute("COMMIT")
                except Exception:
                    con.execute("ROLLBACK")
                    raise
                finally:
                    con.execute("DROP VIEW incoming")
                progress(f"DVF+ {dep}: {seen[dep]:,} source mutations processed")

    finally:
        con.close()


def box_folder(folder=None):
    url = BOX + ("/folder/" + str(folder) if folder else "")
    response = httpx.get(url, follow_redirects=True, timeout=60)
    response.raise_for_status()
    try:
        data = json.JSONDecoder().raw_decode(
            response.text.split("Box.postStreamData = ", 1)[1]
        )[0]
        result = data["/app-api/enduserapp/shared-folder"]
        if result["pageCount"] != 1:
            raise ValueError("Paginated Cerema catalog requires a discovery update")
        return result["items"]
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise ValueError(
            "Cerema download catalog changed; no publication was modified"
        ) from exc


def discover(publication):
    """Resolve a named official release. Never silently pick a different edition."""
    release = next(i for i in box_folder() if i["name"] == publication)
    csv_folder = next(i for i in box_folder(release["id"]) if i["name"] == "csv")
    result = []
    for region in box_folder(csv_folder["id"]):
        if not region["name"].startswith("R"):
            continue  # National multipart archives duplicate regional coverage.
        for f in box_folder(region["id"]):
            if f["name"].endswith(".zip"):
                result.append(
                    dict(
                        region=region["name"],
                        id=f["id"],
                        name=f["name"],
                        bytes=f["itemSize"],
                    )
                )
    return result


def download(record, directory):
    target = Path(directory) / record["name"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if (
        target.exists()
        and target.stat().st_size == record["bytes"]
        and zipfile.is_zipfile(target)
    ):
        return target
    url = "https://cerema.app.box.com/index.php"
    params = dict(
        rm="box_download_shared_file",
        shared_name="pgoyov5dddimtnk5j6akbfl79mr4jrep",
        file_id="f_" + str(record["id"]),
    )
    temporary = target.with_suffix(".part")
    try:
        with httpx.stream(
            "GET", url, params=params, follow_redirects=True, timeout=180
        ) as response:
            response.raise_for_status()
            with temporary.open("wb") as f:
                for block in response.iter_bytes(1024 * 1024):
                    f.write(block)
        if temporary.stat().st_size != record["bytes"] or not zipfile.is_zipfile(
            temporary
        ):
            raise ValueError("DVF+ download size or ZIP validation failed")
        temporary.replace(target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--input", type=Path, required=True, help="Official regional CSV ZIP"
    )
    p.add_argument("--database", type=Path, default=Path("data/dvfplus/worker.duckdb"))
    p.add_argument("--coverage-start", type=date.fromisoformat, required=True)
    p.add_argument("--coverage-end", type=date.fromisoformat, required=True)
    p.add_argument(
        "--crs",
        required=True,
        help="Documented CSV CRS; EPSG:2154 for metropolitan France",
    )
    p.add_argument(
        "--cities", type=Path, help="Optional JSON code-to-municipality-name dictionary"
    )
    args = p.parse_args()
    prepare(
        args.input,
        args.database,
        args.coverage_start,
        args.coverage_end,
        args.crs,
        json.loads(args.cities.read_text()) if args.cities else None,
    )
