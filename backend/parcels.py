"""Parcel-centric exploration; a mutation amount is never allocated per parcel."""

import json
import re

import dataset
from store import records

PARCEL_PATTERN = r"[0-9AB]{5}[0-9]{3}[A-Z0-9]{2}[0-9]{4}"


def _expanded(where):
    # Distinct parcel IDs within each mutation prevent malformed repeated IDs
    # from inflating the counts. Mutation prices are measured before expansion.
    return (
        "WITH matched AS (SELECT * FROM sales WHERE " + where + "), "
        "expanded AS (SELECT s.*, p.parcel FROM matched s, "
        "UNNEST(list_distinct(from_json(s.parcels, '[\"VARCHAR\"]'))) p(parcel) "
        f"WHERE regexp_full_match(p.parcel, '{PARCEL_PATTERN}')), "
        "ranked AS (SELECT *, count(*) OVER (PARTITION BY parcel) AS matching_mutations, "
        "row_number() OVER (PARTITION BY parcel ORDER BY date DESC, id DESC) AS position "
        "FROM expanded), latest AS (SELECT * FROM ranked WHERE position=1) "
    )


def explore(
    west,
    south,
    east,
    north,
    zoom,
    year,
    kind,
    price_min,
    price_max,
    start,
    end,
    release,
):
    where = "longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ? AND price BETWEEN ? AND ?"
    params = [west, east, south, north, price_min, price_max]
    for expression, value in [
        ("year=?", year),
        ("kind=?", kind),
        ("date>=?", start),
        ("date<=?", end),
    ]:
        if value:
            where += " AND " + expression
            params.append(value)
    cte = _expanded(where)
    with dataset.query_connection(year, (west, south, east, north), release) as con:
        stats = records(
            con,
            cte
            + "SELECT count(*) AS mutations, median(price) AS median_price FROM matched",
            params,
        )[0]
        total = records(con, cte + "SELECT count(*) AS total FROM latest", params)[0][
            "total"
        ]
        lon, lat = (west + east) / 2, (south + north) / 2
        rows = records(
            con,
            cte + "SELECT parcel AS id, city, kind, longitude, latitude, "
            "date AS latest_date, price AS latest_price, id AS latest_mutation_id, surface, "
            "address AS latest_address, "
            "json_array_length(parcels) AS latest_mutation_parcels, matching_mutations, "
            "6371*2*asin(sqrt(least(1.0,pow(sin(radians(latitude-?)/2),2)+"
            "cos(radians(?))*cos(radians(latitude))*pow(sin(radians(longitude-?)/2),2)))) AS distance "
            "FROM latest ORDER BY date DESC, parcel LIMIT 3000",
            params + [lat, lat, lon],
        )
        clusters = []
        if total > 3000:
            grid = (2**zoom) * 512 / 48
            clusters = records(
                con,
                cte
                + "SELECT avg(longitude) AS longitude, avg(latitude) AS latitude, count(*) AS count "
                "FROM latest GROUP BY floor((longitude+180)/360*?), "
                "floor((1-ln(tan(pi()/4+radians(latitude)/2))/pi())/2*?)",
                params + [grid, grid],
            )
    return dict(
        stats, total=total, parcels=rows, clusters=clusters, truncated=total > 3000
    )


def history(parcel, release, offset=0, limit=50):
    if not re.fullmatch(PARCEL_PATTERN, parcel):
        raise ValueError("Invalid cadastral identifier")
    # Do not prune by year or by a mutation point: a multi-parcel mutation can
    # have its representative point far from this particular parcel.
    department = parcel[:3] if parcel.startswith(("97", "98")) else parcel[:2]
    with dataset.query_connection(release=release, department=department) as con:
        where = "json_contains(parcels, to_json(CAST(? AS VARCHAR)))"
        stats = records(
            con,
            "SELECT count(*) AS total, min(date) AS first_date, max(date) AS last_date FROM sales WHERE "
            + where,
            [parcel],
        )[0]
        rows = records(
            con,
            "SELECT * FROM sales WHERE "
            + where
            + " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
            [parcel, limit, offset],
        )
    for row in rows:
        row["parcels"] = json.loads(row["parcels"])
    return dict(
        stats,
        parcel=parcel,
        mutations=rows,
        offset=offset,
        next_offset=offset + len(rows) if offset + len(rows) < stats["total"] else None,
        release=release,
    )
