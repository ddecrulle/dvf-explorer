"""Recover declared addresses by exact DVF transaction attributes, never by proximity."""

from pathlib import Path

import duckdb

from store import STORAGE_COMPATIBILITY


def enrich(database, address_database, progress=print):
    database, address_database = (
        Path(database).resolve(),
        Path(address_database).resolve(),
    )
    if database == address_database:
        raise ValueError("The address source must be a separate raw-DVF database")
    if not address_database.is_file():
        raise ValueError("Raw-DVF address database does not exist")
    con = duckdb.connect(
        str(database),
        config={
            "memory_limit": "2GB",
            "threads": 2,
            "storage_compatibility_version": STORAGE_COMPATIBILITY,
        },
    )
    try:
        con.execute(
            "ATTACH '"
            + str(address_database).replace("'", "''")
            + "' AS raw_dvf (READ_ONLY)"
        )
        # Work department by department to bound memory on national releases.
        departments = con.execute(
            "SELECT DISTINCT department FROM raw_dvf.sales ORDER BY department"
        ).fetchall()
        recovered = 0
        for (department,) in departments:
            # Mutation IDs differ between raw DVF and DVF+. A parcel alone is
            # insufficient: also require date, amount and commune, with no
            # conflicting declared addresses for that full transaction key.
            con.execute(
                """CREATE OR REPLACE TEMP TABLE declared_addresses AS
                SELECT date, price, citycode,
                    list_sort(list_distinct(from_json(parcels, '["VARCHAR"]'))) AS parcel_ids,
                    min(trim(address)) AS address
                FROM raw_dvf.sales
                WHERE department=? AND NOT starts_with(id, 'dvfplus:')
                    AND trim(coalesce(address,''))<>''
                    AND lower(trim(address)) NOT IN ('address not provided', 'adresse non renseignée')
                    AND json_array_length(parcels)>0
                GROUP BY date,price,citycode,parcel_ids
                HAVING count(DISTINCT upper(trim(address)))=1
            """,
                [department],
            )
            changed = con.execute(
                """UPDATE sales AS s SET address=a.address
                FROM declared_addresses a
                WHERE s.department=? AND starts_with(s.id, 'dvfplus:')
                    AND trim(coalesce(s.address,''))=''
                    AND s.date=a.date AND s.price=a.price AND s.citycode=a.citycode
                    AND list_sort(list_distinct(from_json(s.parcels, '["VARCHAR"]')))=a.parcel_ids
                RETURNING s.id
            """,
                [department],
            ).fetchall()
            recovered += len(changed)
            progress(f"DVF addresses {department}: {len(changed):,} recovered")
        return recovered
    finally:
        con.close()
