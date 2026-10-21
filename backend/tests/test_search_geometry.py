import asyncio
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import search_geometry


@pytest.fixture(autouse=True)
def reset_cache():
    search_geometry._cache.clear()
    yield
    search_geometry._cache.clear()


CONTOUR = {
    "type": "Feature",
    "properties": {"code": "16015"},
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[0, 45], [1, 45], [1, 46], [0, 45]]],
    },
}


def test_street_uses_spatial_filter_and_exact_ban_on_same_commune_side():
    requests = []
    properties = {
        "identifiant_voie_ban_gauche": "16015_1275",
        "insee_commune_gauche": "16015",
    }
    feature = {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "LineString", "coordinates": [[0.1, 45], [0.2, 45.1]]},
    }

    def handler(request):
        requests.append(request)
        if request.url.host == "geo.api.gouv.fr":
            return httpx.Response(200, json=CONTOUR)
        return httpx.Response(
            200,
            json={
                "type": "FeatureCollection",
                "numberMatched": 3,
                "features": [
                    feature,
                    {
                        **feature,
                        "properties": {
                            **properties,
                            "identifiant_voie_ban_gauche": "16015_other",
                        },
                    },
                    {
                        **feature,
                        "properties": {**properties, "insee_commune_gauche": "16000"},
                    },
                ],
            },
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await search_geometry.lookup(
                "street", "16015", "16015_1275", client
            )
            second = await search_geometry.lookup(
                "street", "16015", "16015_1275", client
            )
            assert first == second
            assert len(first["features"]) == 1
            assert first["features"][0]["geometry"] == feature["geometry"]

    asyncio.run(run())
    assert len(requests) == 2
    query = requests[1].url.params["filter"]
    assert "fes:BBOX" in query and "16015_1275" in query


def test_failed_contour_is_not_cached():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={**CONTOUR, "properties": {"code": "wrong"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for _ in range(2):
                with pytest.raises(ValueError):
                    await search_geometry.lookup("municipality", "16015", "", client)

    asyncio.run(run())
    assert len(calls) == 2


def test_incomplete_street_is_not_cached():
    def handler(request):
        if request.url.host == "geo.api.gouv.fr":
            return httpx.Response(200, json=CONTOUR)
        return httpx.Response(
            200,
            json={"type": "FeatureCollection", "numberMatched": 1001, "features": []},
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ValueError):
                await search_geometry.lookup("street", "16015", "16015_1275", client)

    asyncio.run(run())
    assert ("street", "16015", "16015_1275") not in search_geometry._cache
