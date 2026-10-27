"""Import raw DGFiP files with coordinates from the Etalab cadastre."""

import argparse
import hashlib
import json
from datetime import datetime

import httpx

CATALOG = "https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres/"


def download(url, target):
    if target.exists():
        return
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=180) as response:
            response.raise_for_status()
            with temporary.open("wb") as output:
                for chunk in response.iter_bytes():
                    output.write(chunk)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def number(value):
    return float(value.replace(",", ".")) if value and value.strip() else None


def city_code(row):
    dep = row["Code departement"].zfill(2)
    # Overseas municipality codes already include the third department digit.
    return (
        dep[:2] + row["Code commune"].zfill(3)
        if len(dep) == 3
        else dep + row["Code commune"].zfill(3)
    )


def parcel_id(row):
    dep = row["Code departement"].zfill(2)
    city = city_code(row)
    return (
        city
        + (row["Prefixe de section"] or "0").zfill(3)
        + row["Section"].zfill(2)
        + row["No plan"].zfill(4)
    )


def group_rows(stream, department, year):
    from national import groups

    return [
        group
        for group in groups(stream, year)
        if group[0]["Code departement"].zfill(2) == department
    ]


def import_data(department="16", year=2026, progress=print):
    from archive import capture
    from geocode import geocode_department
    from national import import_snapshot
    from sync import writer_lock

    with writer_lock():
        snapshot = capture(progress)
        matches = [r for r in snapshot["resources"] if r["resource"]["year"] == year]
        if not matches:
            # Keep retired years available; do not delete them.
            raise ValueError(
                f"Year {year} is absent from the current publication. Existing archives are preserved."
            )
        for record in matches:
            import_snapshot(record, progress, department)
        geocode_department(department, progress)


def normalise(group, index, year, source, coords):
    department = group[0]["Code departement"].zfill(2)
    row = group[0]
    if row["Nature mutation"] != "Vente":
        return None
    price = number(row["Valeur fonciere"])
    if price is None or price <= 0:
        return None
    parcels = sorted({parcel_id(r) for r in group})
    points = [coords[p] for p in parcels if p in coords]
    kinds = {
        r["Type local"]
        for r in group
        if r["Type local"] and r["Type local"] != "Dépendance"
    }
    kind = (
        next(iter(kinds))
        if len(kinds) == 1
        else ("Mixte" if kinds else "Terrain / dépendance")
    )
    # Buildings may repeat across land-use or lot rows; do not blindly sum them.
    buildings = {
        (
            parcel_id(r),
            r["Type local"],
            r["Surface reelle bati"],
            r["Nombre pieces principales"],
        )
        for r in group
        if number(r["Surface reelle bati"])
    }
    simple = len(buildings) == 1 and len(parcels) == 1
    surface = number(next(iter(buildings))[2]) if simple else None
    rooms = int(number(next(iter(buildings))[3]) or 0) if simple else None
    lands = {
        (
            parcel_id(r),
            r["Nature culture"],
            r["Nature culture speciale"],
            r["Surface terrain"],
        )
        for r in group
    }
    land = sum(number(t[3]) or 0 for t in lands) or None
    address = (
        " ".join(row[k] for k in ["No voie", "B/T/Q", "Type de voie", "Voie"] if row[k])
        or "Address not provided"
    )
    ident = hashlib.sha256(f"{department}:{year}:{index}:{group}".encode()).hexdigest()[
        :20
    ]
    # Use a point inside the parcel; a centroid can fall outside the property.
    lon, lat = points[0] if points else (None, None)
    return (
        ident,
        datetime.strptime(row["Date mutation"], "%d/%m/%Y").date(),
        price,
        address,
        row["Commune"],
        department,
        city_code(row),
        kind,
        surface,
        land,
        rooms,
        lon,
        lat,
        json.dumps(parcels),
        len(group),
        year,
        source,
        not simple,
        None,  # Raw DVF rows do not uniquely identify individual dependencies.
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--department", default="16")
    parser.add_argument("--year", type=int, default=2026)
    args = parser.parse_args()
    import_data(args.department, args.year)
