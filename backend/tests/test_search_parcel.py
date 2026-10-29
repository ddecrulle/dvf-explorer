import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
import search_parcel

PARCEL = "16015000AK0292"
FEATURE = {
    "type": "Feature",
    "properties": {"idu": PARCEL, "nom_com": "Angoulême"},
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[0.15, 45.64], [0.16, 45.64], [0.16, 45.65], [0.15, 45.64]]],
    },
}


@pytest.mark.parametrize("q", [PARCEL, "16015 000 ak 0292", "16015-000-AK-0292"])
def test_exact_reference_routes_to_cadastre(q, monkeypatch):
    calls = []
    original = httpx.AsyncClient

    def handler(request):
        calls.append(request)
        assert request.url.host == "apicarto.ign.fr"
        assert dict(request.url.params) == {
            "code_insee": "16015",
            "prefixe": "000",
            "section": "AK",
            "numero": "0292",
        }
        return httpx.Response(200, json={"features": [FEATURE]})

    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    response = TestClient(main.app).get("/api/search", params={"q": q})
    assert response.status_code == 200
    result = response.json()["features"][0]
    assert result["properties"]["id"] == PARCEL
    assert result["properties"]["type"] == "parcel"
    assert result["properties"]["city"] == "Angoulême"
    assert result["properties"]["depcode"] == "16"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "features,status",
    [
        ([], 200),
        ([{**FEATURE, "properties": {"idu": "16015000AK0293"}}], 200),
        (
            [{**FEATURE, "geometry": {"type": "Point", "coordinates": [0.15, 45.64]}}],
            502,
        ),
    ],
)
def test_missing_neighbour_or_invalid_geometry_not_returned(
    features, status, monkeypatch
):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"features": features})
            ),
            **kwargs,
        ),
    )
    response = TestClient(main.app).get("/api/search", params={"q": PARCEL})
    assert response.status_code == status
    if status == 200:
        assert response.json()["features"] == []


def test_addresses_keep_existing_search_and_upstream_errors(monkeypatch):
    original = httpx.AsyncClient
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.host == "apicarto.ign.fr":
            return httpx.Response(503)
        return httpx.Response(200, json={"features": []})

    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    client = TestClient(main.app)
    assert (
        client.get("/api/search", params={"q": "11 place Henri Dunant"}).status_code
        == 200
    )
    assert calls[0].url.host == "data.geopf.fr"
    assert client.get("/api/search", params={"q": PARCEL}).status_code == 502


def test_full_reference_required_and_corsica_prefix_preserved():
    assert search_parcel.reference("AK 292") is None
    assert search_parcel.reference("2b033 123 ab 0007") == "2B033123AB0007"
    assert search_parcel.reference("97101000AB0001") == "97101000AB0001"
