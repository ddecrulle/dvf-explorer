"""Resolve the declared address of an exact single-parcel sale to a BAN ID.

This is address evidence only, not a cadastral parcel membership assertion.
"""

import re
import unicodedata

import dataset

GEOCODER = "https://data.geopf.fr/geocodage/search"
BAN_ID = re.compile(r"[0-9AB]{5}_[A-Za-z0-9]+_[0-9]+(?:_[A-Za-z0-9]+)?")
ABBREVIATIONS = {
    "IMP": "IMPASSE",
    "RTE": "ROUTE",
    "AV": "AVENUE",
    "BD": "BOULEVARD",
    "CHE": "CHEMIN",
    "CH": "CHEMIN",
    "ALL": "ALLEE",
    "PL": "PLACE",
    "MTE": "MONTEE",
    "R": "RUE",
}


def address_key(value):
    text = "".join(
        c
        for c in unicodedata.normalize("NFKD", value.upper())
        if not unicodedata.combining(c)
    )
    return " ".join(
        ABBREVIATIONS.get(word, word) for word in re.findall(r"[A-Z0-9]+", text)
    )


def sale_address(parcel, at, release=None):
    dep = parcel[:3] if parcel.startswith(("97", "98")) else parcel[:2]
    with dataset.query_connection(year=at.year, department=dep, release=release) as con:
        rows = con.execute(
            """SELECT DISTINCT trim(address) FROM sales
            WHERE date=? AND citycode=? AND json_array_length(parcels)=1
                AND json_contains(parcels, to_json(CAST(? AS VARCHAR)))
                AND trim(coalesce(address,''))<>''
                AND lower(trim(address)) NOT IN ('address not provided', 'adresse non renseignée')
            ORDER BY 1 LIMIT 2""",
            [at, parcel[:5], parcel],
        ).fetchall()
    # Conflicting declared addresses must not select one arbitrarily.
    if len(rows) != 1:
        return None
    return rows[0][0]


def lookup(parcel, at, client, release=None):
    address = sale_address(parcel, at, release)
    if not address or len(address) > 200:
        return []
    response = client.get(
        GEOCODER, params={"q": address, "citycode": parcel[:5], "limit": 5}
    )
    response.raise_for_status()
    features = response.json()["features"]
    matches = set()
    for feature in features:
        props = feature.get("properties", {})
        identifier = props.get("id", "")
        name = props.get("name", "")
        if (
            props.get("type") == "housenumber"
            and props.get("citycode") == parcel[:5]
            and isinstance(identifier, str)
            and BAN_ID.fullmatch(identifier)
            and identifier.startswith(parcel[:5] + "_")
            and isinstance(name, str)
            and address_key(name) == address_key(address)
        ):
            matches.add(identifier)
    return sorted(matches) if len(matches) == 1 else []
