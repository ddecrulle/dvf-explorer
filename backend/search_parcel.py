"""Exact cadastral references in the shared address search."""

import math
import re

from parcels import PARCEL_PATTERN
from shapely.geometry import shape
from shapely.ops import unary_union

CADASTRE = "https://apicarto.ign.fr/api/cadastre/parcelle"


def reference(query):
    identifier = re.sub(r"[\s-]+", "", query).upper()
    return identifier if re.fullmatch(PARCEL_PATTERN, identifier) else None


async def lookup(identifier, client):
    response = await client.get(
        CADASTRE,
        params={
            "code_insee": identifier[:5],
            "prefixe": identifier[5:8],
            "section": identifier[8:10],
            "numero": identifier[10:],
        },
    )
    response.raise_for_status()
    features = response.json()["features"]
    if not isinstance(features, list):
        raise TypeError("Invalid cadastre response")
    matching = [f for f in features if f.get("properties", {}).get("idu") == identifier]
    if not matching:
        return {"type": "FeatureCollection", "features": []}
    geometries = [shape(f["geometry"]) for f in matching]
    if any(
        g.is_empty or not g.is_valid or g.geom_type not in ("Polygon", "MultiPolygon")
        for g in geometries
    ):
        raise ValueError("Invalid cadastral geometry")
    geometry = unary_union(geometries)
    point = geometry.representative_point()
    if (
        not math.isfinite(point.x)
        or not math.isfinite(point.y)
        or not -180 <= point.x <= 180
        or not -90 <= point.y <= 90
    ):
        raise ValueError("Invalid cadastral coordinates")
    props = matching[0]["properties"]
    city = props.get("nom_com") or identifier[:5]
    department = (
        identifier[:3] if identifier.startswith(("97", "98")) else identifier[:2]
    )
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [point.x, point.y]},
                "properties": {
                    "id": identifier,
                    "label": f"{identifier} · {city}",
                    "type": "parcel",
                    "city": city,
                    "citycode": identifier[:5],
                    "depcode": department,
                },
            }
        ],
    }
