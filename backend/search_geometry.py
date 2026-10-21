"""Exact administrative contours and BAN-linked IGN streets, fetched only on selection."""

import time
from collections import OrderedDict

import httpx
from shapely.geometry import shape
from xml.sax.saxutils import escape

_cache = OrderedDict()
TTL = 24 * 60 * 60


async def lookup(kind: str, citycode: str, street_id: str, client: httpx.AsyncClient):
    key = (kind, citycode, street_id if kind == "street" else "")
    saved = _cache.get(key)
    if saved and time.monotonic() - saved[0] < TTL:
        _cache.move_to_end(key)
        return saved[1]
    if kind == "municipality":
        response = await client.get(
            f"https://geo.api.gouv.fr/communes/{citycode}",
            params={"format": "geojson", "geometry": "contour"},
        )
        response.raise_for_status()
        feature = response.json()
        if feature.get("properties", {}).get("code") != citycode or feature.get(
            "geometry", {}
        ).get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("Invalid commune contour")
        features = [feature]
    else:
        commune = await lookup("municipality", citycode, "", client)
        west, south, east, north = shape(commune["features"][0]["geometry"]).bounds
        # A spatial filter keeps the national WFS lookup fast. Match the exact
        # BAN street identifier, rather than a potentially ambiguous street name.
        literal = escape(street_id)
        equals = "".join(
            f"<fes:PropertyIsEqualTo><fes:ValueReference>identifiant_voie_ban_{side}"
            f"</fes:ValueReference><fes:Literal>{literal}</fes:Literal></fes:PropertyIsEqualTo>"
            for side in ("gauche", "droite")
        )
        spatial_filter = (
            '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" '
            'xmlns:gml="http://www.opengis.net/gml/3.2"><fes:And><fes:BBOX>'
            "<fes:ValueReference>geometrie</fes:ValueReference>"
            '<gml:Envelope srsName="urn:ogc:def:crs:OGC:1.3:CRS84">'
            f"<gml:lowerCorner>{west} {south}</gml:lowerCorner>"
            f"<gml:upperCorner>{east} {north}</gml:upperCorner>"
            "</gml:Envelope></fes:BBOX><fes:Or>"
            + equals
            + "</fes:Or></fes:And></fes:Filter>"
        )
        response = await client.get(
            "https://data.geopf.fr/wfs/ows",
            params={
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": "BDTOPO_V3:troncon_de_route",
                "outputFormat": "application/json",
                "srsName": "EPSG:4326",
                "count": 1000,
                "filter": spatial_filter,
            },
        )
        response.raise_for_status()
        body = response.json()
        if (
            body.get("type") != "FeatureCollection"
            or body.get("numberMatched", 0) > 1000
        ):
            raise ValueError("Incomplete street geometry")
        features = []
        for feature in body.get("features", []):
            properties = feature.get("properties", {})
            if not any(
                properties.get(f"identifiant_voie_ban_{side}") == street_id
                and properties.get(f"insee_commune_{side}") == citycode
                for side in ("gauche", "droite")
            ):
                continue
            if feature.get("geometry", {}).get("type") in (
                "LineString",
                "MultiLineString",
            ):
                features.append(
                    {
                        "type": "Feature",
                        "properties": {},
                        "geometry": feature["geometry"],
                    }
                )
    result = {"type": "FeatureCollection", "features": features}
    _cache[key] = (time.monotonic(), result)
    _cache.move_to_end(key)
    while len(_cache) > 512:
        _cache.popitem(last=False)
    return result
