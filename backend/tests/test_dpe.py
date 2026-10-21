"""Diagnostics are parcel evidence, never an automatic deed-level identity."""

import sys
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dpe
import main
import store

PARCEL = "16015000AB0001"
AT = date(2025, 6, 30)
POLYGON = {
    "type": "Polygon",
    "coordinates": [[[0, 45], [1, 45], [1, 46], [0, 46], [0, 45]]],
}
# Small real-world size: targeted lookups reject very broad parcel bounds.
POLYGON["coordinates"] = [
    [[0.1, 45.6], [0.102, 45.6], [0.102, 45.602], [0.1, 45.602], [0.1, 45.6]]
]


def diagnostic(**overrides):
    return {
        "numero_dpe": "2516E0000001A",
        "date_etablissement_dpe": "2025-01-01",
        "date_fin_validite_dpe": "2035-01-01",
        "date_derniere_modification_dpe": "2025-01-01",
        "etiquette_dpe": "D",
        "etiquette_ges": "B",
        "type_batiment": "maison",
        "surface_habitable_logement": 100,
        "adresse_ban": "1 rue Exemple",
        "identifiant_ban": "16015_0010_00001",
        "score_ban": 0.96,
        "_geopoint": "45.601,0.101",
        **overrides,
    }


def transport(rows, calls=None, total=None, features=None):
    def respond(request):
        if calls is not None:
            calls.append(request)
        if request.url.host == "apicarto.ign.fr":
            body = {
                "features": features
                if features is not None
                else [{"properties": {"idu": PARCEL}, "geometry": POLYGON}]
            }
        else:
            body = {"results": rows, "total": len(rows) if total is None else total}
        return httpx.Response(200, json=body)

    return httpx.MockTransport(respond)


@pytest.fixture(autouse=True)
def isolate_ban(monkeypatch):
    monkeypatch.setattr(
        dpe.addresses, "lookup", lambda ids: {"addresses": {}, "unavailable": []}
    )


def evidence(rows, address_ids=(), address_unavailable=False, **kwargs):
    with httpx.Client(transport=transport(rows, **kwargs)) as client:
        return dpe._fetch(PARCEL, AT, client, address_ids, address_unavailable)


def test_explicit_ban_membership_recovers_low_scores_and_points_outside_parcel():
    calls = []
    rows = [
        diagnostic(score_ban=0.65),
        diagnostic(numero_dpe="2516E0000002A", _geopoint="45.603,0.101"),
        diagnostic(
            numero_dpe="2516E0000003A",
            identifiant_ban="16015_0010_00002",
            score_ban=0.6,
        ),
    ]
    raw = evidence(rows, address_ids=["16015_0010_00001"], calls=calls)
    assert {item["id"] for item in raw["diagnostics"]} == {
        "2516E0000001A",
        "2516E0000002A",
    }
    assert {item["location_method"] for item in raw["diagnostics"]} == {"ban_address"}
    assert len(calls) == 3
    assert "bbox" not in calls[2].url.params
    assert 'identifiant_ban:"16015_0010_00001"' in calls[2].url.params["qs"]
    assert "TO 2025-06-30" in calls[2].url.params["qs"]
    assert {
        item["match"]
        for item in dpe.match_sale(raw, "Maison", 100, True)["diagnostics"]
    } == {"address"}


def test_address_candidate_without_coordinates_never_becomes_probable():
    raw = evidence(
        [diagnostic(_geopoint=None, score_ban=None)], address_ids=["16015_0010_00001"]
    )
    matched = dpe.match_sale(raw, "Maison", 100, True)
    assert len(matched["diagnostics"]) == 1
    assert matched["diagnostics"][0]["match"] == "address"


def test_address_matching_still_rejects_future_expired_and_street_only_records():
    ids = ["16015_0010_00001", "16015_0010"]
    assert (
        evidence(
            [
                diagnostic(date_etablissement_dpe="2025-07-01"),
                diagnostic(date_fin_validite_dpe="2025-06-29"),
                diagnostic(identifiant_ban="16015_0010"),
            ],
            address_ids=ids,
        )["diagnostics"]
        == []
    )


def test_partial_ban_lookup_is_visible_and_not_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(
        dpe.addresses, "lookup", lambda ids: {"addresses": {}, "unavailable": ["16"]}
    )
    original = httpx.Client
    monkeypatch.setattr(
        dpe.httpx,
        "Client",
        lambda **kwargs: original(transport=transport([diagnostic()]), **kwargs),
    )
    result = dpe.parcel_diagnostics(PARCEL, AT)
    assert result["address_lookup_unavailable"] and result["truncated"]
    assert not list((tmp_path / "dpe").glob("*.json"))
    assert (
        dpe.match_sale(result, "Maison", 100, True)["diagnostics"][0]["match"]
        == "parcel"
    )


def test_uses_exact_parcel_polygon_and_sale_date_not_nearest_point():
    calls = []
    result = evidence(
        [
            diagnostic(),
            diagnostic(numero_dpe="2516E0000002A", _geopoint="45.603,0.101"),
        ],
        calls=calls,
    )
    assert [d["id"] for d in result["diagnostics"]] == ["2516E0000001A"]
    assert calls[0].url.params["prefixe"] == "000"
    assert calls[1].url.params["bbox"] == "0.1,45.6,0.102,45.602"
    assert "TO 2025-06-30" in calls[1].url.params["qs"]
    assert result["state"] == "ok"


@pytest.mark.parametrize(
    "changes",
    [
        {"date_etablissement_dpe": "2025-07-01"},
        {"date_etablissement_dpe": "2021-06-30"},
        {"date_fin_validite_dpe": "2025-06-29"},
        {"date_fin_validite_dpe": None},
        {"score_ban": 0.48},
        {"identifiant_ban": "16015"},
        {"identifiant_ban": "16015_0010"},
        {"_geopoint": "nan,0.101"},
        {"_geopoint": "bad"},
        {"etiquette_dpe": "unknown"},
    ],
)
def test_rejects_incompatible_dates_and_unreliable_locations(changes):
    assert evidence([diagnostic(**changes)])["diagnostics"] == []


def test_renumbered_parcel_does_not_fall_back_to_neighbour():
    result = evidence(
        [], features=[{"properties": {"idu": "16015000AB0002"}, "geometry": POLYGON}]
    )
    assert result["state"] == "parcel_unavailable"


def test_replacement_is_resolved_as_of_sale_and_duplicates_removed():
    old = diagnostic()
    replacement = diagnostic(
        numero_dpe="2516E0000002A",
        numero_dpe_remplace=old["numero_dpe"],
        date_etablissement_dpe="2025-03-01",
    )
    assert [d["id"] for d in evidence([old, old, replacement])["diagnostics"]] == [
        replacement["numero_dpe"]
    ]
    replacement["date_etablissement_dpe"] = "2025-07-01"
    assert [d["id"] for d in evidence([old, replacement])["diagnostics"]] == [
        old["numero_dpe"]
    ]


def test_only_unique_simple_compatible_house_is_probable():
    raw = evidence([diagnostic()])
    assert (
        dpe.match_sale(raw, "Maison", 103, True)["diagnostics"][0]["match"]
        == "probable"
    )
    for kind, surface, simple in [
        ("Appartement", 100, True),
        ("Maison", 150, True),
        ("Maison", None, True),
        ("Maison", 100, False),
    ]:
        assert (
            dpe.match_sale(raw, kind, surface, simple)["diagnostics"][0]["match"]
            == "parcel"
        )
    assert "match" not in raw["diagnostics"][0]
    raw = evidence([diagnostic(), diagnostic(numero_dpe="2516E0000002A")])
    assert {
        d["match"] for d in dpe.match_sale(raw, "Maison", 100, True)["diagnostics"]
    } == {"parcel"}


def test_truncated_results_never_produce_probable_match():
    raw = evidence([diagnostic()], total=1000)
    assert raw["truncated"]
    assert (
        dpe.match_sale(raw, "Maison", 100, True)["diagnostics"][0]["match"] == "parcel"
    )


def test_current_label_revision_is_exposed_without_claiming_historical_class():
    raw = evidence([diagnostic(date_derniere_modification_dpe="2026-01-01")])
    assert raw["diagnostics"][0]["modified_at"] == "2026-01-01"
    assert "class_at_sale" not in raw["diagnostics"][0]


def test_cache_reused_for_same_parcel_date_and_separated_between_dates(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(store, "DATA", tmp_path)
    calls = []
    mock = transport([diagnostic()], calls=calls)
    original = httpx.Client
    monkeypatch.setattr(
        dpe.httpx, "Client", lambda **kwargs: original(transport=mock, **kwargs)
    )
    first = dpe.parcel_diagnostics(PARCEL, AT)
    assert len(calls) == 2
    assert dpe.parcel_diagnostics(PARCEL, AT) == first
    assert len(calls) == 2
    dpe.parcel_diagnostics(PARCEL, date(2025, 5, 1))
    assert len(calls) == 4


def test_pre2021_sale_never_calls_external_services(monkeypatch):
    monkeypatch.setattr(
        dpe.httpx, "Client", lambda **kwargs: pytest.fail("Unnecessary network call")
    )
    assert (
        dpe.parcel_diagnostics(PARCEL, date(2020, 1, 1))["state"] == "before_coverage"
    )


def test_api_validates_inputs_and_distinguishes_upstream_failure(monkeypatch):
    client = TestClient(main.app)
    for path in [
        "bad/dpe?at=2025-01-01",
        PARCEL + "/dpe?at=2100-01-01",
        PARCEL + "/dpe?at=2025-01-01&surface=nan",
        PARCEL + "/dpe?at=2025-01-01&surface=-1",
    ]:
        assert client.get("/api/parcels/" + path).status_code == 422

    def fail(*args):
        raise dpe.UpstreamError("ADEME unavailable")

    monkeypatch.setattr(dpe, "parcel_diagnostics", fail)
    assert client.get(f"/api/parcels/{PARCEL}/dpe?at=2025-01-01").status_code == 502


def test_api_returns_enrichment_without_mutating_sales_database(monkeypatch):
    raw = evidence([diagnostic()])
    monkeypatch.setattr(dpe, "parcel_diagnostics", lambda *args: raw)
    client = TestClient(main.app)
    response = client.get(
        f"/api/parcels/{PARCEL}/dpe?at=2025-06-30&kind=Maison&surface=100&simple=true"
    )
    assert response.status_code == 200
    assert response.json()["diagnostics"][0]["match"] == "probable"


def test_upstream_error_is_not_cached_as_an_empty_result(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    original = httpx.Client
    calls = []

    def unavailable(request):
        calls.append(request)
        return httpx.Response(503, text="Maintenance")

    monkeypatch.setattr(
        dpe.httpx,
        "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(unavailable), **kwargs),
    )
    for _ in range(2):
        with pytest.raises(dpe.UpstreamError):
            dpe.parcel_diagnostics(PARCEL, AT)
    assert len(calls) == 2
    assert not list((tmp_path / "dpe").glob("*.json"))
