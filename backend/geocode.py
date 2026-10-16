"""Match cadastral parcels by department, streaming the source JSON."""

import csv
import gzip
import hashlib
import tempfile
from pathlib import Path

import ijson
import store
from ingest import download
from national import apply_points, initialise, refresh_imports
from shapely.geometry import shape


def geocode_department(department, progress=print):
    with store.LOCK:
        con = store.connect()
        initialise(con)
        con.execute("ALTER TABLE geocoding ADD COLUMN IF NOT EXISTS signature VARCHAR")
        needed = {
            r[0]
            for r in con.execute(
                "SELECT DISTINCT json_extract_string(j.value,'$') FROM sales s,json_each(s.parcels) j WHERE department=?",
                [department],
            ).fetchall()
        }
        signature = hashlib.sha256("\n".join(sorted(needed)).encode()).hexdigest()
        previous = con.execute(
            "SELECT signature FROM geocoding WHERE department=?", [department]
        ).fetchone()
        con.close()
    if not needed:
        return
    if previous and previous[0] == signature:
        with store.LOCK:
            con = store.connect()
            apply_points(con, department)
            refresh_imports(con, department)
            con.close()
        return
    progress(f"Parcel matching {department} · {len(needed):,} parcels to match")
    stage = store.DATA / "staging"
    stage.mkdir(exist_ok=True)
    cached = store.DATA / f"cadastre-{department}.json.gz"
    temporary = not cached.exists()
    path = stage / f"cadastre-{department}.json.gz" if temporary else cached
    download(
        f"https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/departements/{department}/cadastre-{department}-parcelles.json.gz",
        path,
    )
    target = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", dir=stage, suffix=".csv", newline="", delete=False
        ) as output:
            target = Path(output.name)
            writer = csv.writer(output)
            count = 0
            with gzip.open(path, "rb") as stream:
                for feature in ijson.items(stream, "features.item", use_float=True):
                    ident = feature["properties"]["id"]
                    if ident in needed and feature.get("geometry"):
                        geometry = shape(feature["geometry"])
                        if geometry.is_empty:
                            continue
                        point = geometry.representative_point()
                        writer.writerow((ident, point.x, point.y))
                        count += 1
        with store.LOCK:
            con = store.connect()
            initialise(con)
            try:
                con.execute("BEGIN")
                if count:
                    con.execute(
                        "CREATE TEMP TABLE new_points AS SELECT * FROM parcel_points WHERE false"
                    )
                    con.execute(
                        "COPY new_points FROM '"
                        + str(target).replace("'", "''")
                        + "' (FORMAT CSV,HEADER FALSE)"
                    )
                    con.execute(
                        "INSERT OR REPLACE INTO parcel_points SELECT * FROM new_points"
                    )
                apply_points(con, department)
                refresh_imports(con, department)
                con.execute(
                    "INSERT OR REPLACE INTO geocoding VALUES (?,current_timestamp,?)",
                    [department, signature],
                )
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
            finally:
                con.close()
        progress(f"Parcel matching {department} · {count:,} parcels matched")
    finally:
        if target:
            target.unlink(missing_ok=True)
        if temporary:
            path.unlink(missing_ok=True)
