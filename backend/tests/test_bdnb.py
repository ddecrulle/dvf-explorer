"""Exact cadastral joins; a representative never becomes sale evidence."""

import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bdnb
import main
import store

PARCEL = "16358000AY0151"
BUILDING = "bdnb-bg-WX3S-753T-TSTR"
# Selected fields from official BDNB/ADEME responses, checked 2026-10-28.
RELATION = {
    "parcelle_id": PARCEL,
    "batiment_groupe_id": BUILDING,
    "parcelle_principale": True,
}
REP = {
    "batiment_groupe_id": BUILDING,
    "identifiant_dpe": "2416E2621326Z",
    "classe_bilan_dpe": "D",
    "classe_emission_ges": "B",
    "date_etablissement_dpe": "2024-07-18T22:00:00",
    "type_batiment_dpe": "maison",
    "surface_habitable_logement": 97,
}
CERT = {
    "numero_dpe": "2416E2621326Z",
    "etiquette_dpe": "D",
    "etiquette_ges": "B",
    "date_etablissement_dpe": "2024-07-19",
    "date_fin_validite_dpe": "2034-07-18",
    "type_batiment": "maison",
    "surface_habitable_logement": 97,
    "adresse_ban": "15 Allee Edith Piaf 16710 Saint-Yrieix-sur-Charente",
}


def fetch(relations=None, reps=None, certificates=None, status=200, calls=None):
    def handler(request):
        if calls is not None:
            calls.append(request)
        if request.url.host == "data.ademe.fr":
            rows = [CERT] if certificates is None else certificates
            return httpx.Response(status, json={"results": rows, "total": len(rows)})
        if request.url.path.endswith("/rel_batiment_groupe_parcelle"):
            assert request.url.params["parcelle_id"] == "eq." + PARCEL
            return httpx.Response(
                200, json=[RELATION] if relations is None else relations
            )
        if request.url.path.endswith("/rel_batiment_groupe_adresse"):
            return httpx.Response(200, json=[])
        assert request.url.path.endswith("/batiment_groupe_dpe_representatif_logement")
        assert BUILDING in request.url.params["batiment_groupe_id"]
        return httpx.Response(200, json=[REP] if reps is None else reps)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return bdnb._fetch(PARCEL, client)


def test_reference_parcel_exact_chain():
    calls = []
    result = fetch(calls=calls)
    assert result["scope"] == "current_building_representative"
    assert len(calls) == 4
    assert calls[-2].url.params["qs"] == 'numero_dpe:"2416E2621326Z"'
    building = result["buildings"][0]
    assert building["id"] == BUILDING
    rep = building["representative"]
    assert rep["energy_class"] == "D"
    assert rep["surface"] == 97
    assert rep["issued_at_bdnb"] == "2024-07-18T22:00:00"
    assert rep["ademe"]["established_at"] == "2024-07-19"
    assert rep["ademe"]["expires_at"] == "2034-07-18"
    assert "match" not in rep


def test_multiple_buildings_and_missing_representative():
    result = fetch(relations=[RELATION, dict(RELATION, batiment_groupe_id="other")])
    assert len(result["buildings"]) == 2
    assert result["buildings"][1]["representative"] is None


def test_empty_does_not_search_nearest_address():
    calls = []
    assert fetch(relations=[], calls=calls)["buildings"] == []
    assert len(calls) == 1


def test_bounded_results():
    relations = [RELATION] + [
        dict(RELATION, batiment_groupe_id=f"other-{i}") for i in range(20)
    ]
    result = fetch(relations=relations)
    assert result["truncated"]
    assert len(result["buildings"]) == 20


@pytest.mark.parametrize(
    "relations,reps",
    [
        ([dict(RELATION, parcelle_id="16358000AY0152")], None),
        ([dict(RELATION, batiment_groupe_id="bad,)")], None),
        (None, [dict(REP, batiment_groupe_id="unrelated")]),
        (None, [REP, REP]),
    ],
)
def test_rejects_wrong_or_ambiguous_links(relations, reps):
    with pytest.raises(bdnb.UpstreamError):
        fetch(relations=relations, reps=reps)


def test_ademe_failure_keeps_bdnb():
    result = fetch(status=503)
    assert result["ademe_unavailable"]
    assert result["buildings"][0]["representative"]["energy_class"] == "D"
    assert result["buildings"][0]["representative"]["ademe_state"] == "unavailable"


def test_missing_ademe_and_changed_label_are_explicit():
    assert (
        fetch(certificates=[])["buildings"][0]["representative"]["ademe_state"]
        == "not_found"
    )
    rep = fetch(certificates=[dict(CERT, etiquette_dpe="C")])["buildings"][0][
        "representative"
    ]
    assert rep["energy_class"] == "D"
    assert rep["ademe"]["energy_class"] == "C"


def test_wrong_ademe_identifier_not_accepted():
    result = fetch(certificates=[dict(CERT, numero_dpe="other")])
    assert result["ademe_unavailable"]
    assert result["buildings"][0]["representative"]["ademe"] is None


def test_invalid_identifier_and_grades_are_not_interpolated():
    calls = []
    rep = fetch(
        reps=[dict(REP, identifiant_dpe='bad" OR *', classe_bilan_dpe="Z")], calls=calls
    )["buildings"][0]["representative"]
    assert rep["id"] is None
    assert rep["energy_class"] is None
    assert len(calls) == 3


def test_cache_and_partial_failure_not_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    calls = []
    result = fetch()
    monkeypatch.setattr(bdnb, "_fetch", lambda *args: calls.append(1) or result)
    assert bdnb.lookup(PARCEL) == bdnb.lookup(PARCEL)
    assert calls == [1]
    for path in (tmp_path / "bdnb").glob("*.json"):
        path.unlink()
    result["ademe_unavailable"] = True
    bdnb.lookup(PARCEL)
    bdnb.lookup(PARCEL)
    assert calls == [1, 1, 1]
    assert not list((tmp_path / "bdnb").glob("*.json"))


def test_route_validation_and_upstream_error(monkeypatch):
    client = TestClient(main.app)
    assert client.get("/api/parcels/bad/bdnb").status_code == 422
    monkeypatch.setattr(bdnb, "lookup", lambda parcel: fetch())
    response = client.get(f"/api/parcels/{PARCEL}/bdnb")
    assert response.status_code == 200
    assert response.json()["buildings"][0]["representative"]["id"] == CERT["numero_dpe"]

    def fail(parcel):
        raise bdnb.UpstreamError()

    monkeypatch.setattr(bdnb, "lookup", fail)
    assert client.get(f"/api/parcels/{PARCEL}/bdnb").status_code == 502


def test_all_diagnostics_for_multi_dwelling_parcel():
    group = "bdnb-bg-1U1H-5FP9-KYYA"
    address = "16015_1985_00011"
    dates = ["2026-01-23", "2025-10-29", "2023-05-17", "2023-05-09", "2023-04-07"]
    ids = [
        "2616E0204739K",
        "2516E3415738I",
        "2316E1640043H",
        "2316E1530300K",
        "2316E1167400S",
    ]
    rows = [
        dict(
            CERT,
            numero_dpe=i,
            identifiant_ban=address,
            date_etablissement_dpe=d,
            etiquette_dpe="C",
            type_batiment="appartement",
            surface_habitable_logement=surface,
        )
        for i, d, surface in zip(ids, dates, [65, 70.9, 76, 67, 105])
    ]

    def respond(request):
        if request.url.host == "data.ademe.fr":
            assert 'identifiant_ban:"16015_1985_00011"' in request.url.params["qs"]
            return httpx.Response(200, json={"total": 5, "results": rows[::-1]})
        assert request.url.params["batiment_groupe_id"] == f"in.({group})"
        return httpx.Response(
            200, json=[{"batiment_groupe_id": group, "cle_interop_adr": address}]
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result, truncated = bdnb._address_diagnostics(client, [{"id": group}])
    assert [d["id"] for d in result] == ids
    assert [d["surface"] for d in result] == [65, 70.9, 76, 67, 105]
    assert {d["match"] for d in result} == {"address"}
    assert not truncated


@pytest.mark.parametrize("bad_relation,bad_address", [(True, False), (False, True)])
def test_address_lookup_rejects_foreign_buildings_and_addresses(
    bad_relation, bad_address
):
    def respond(request):
        if request.url.host == "data.ademe.fr":
            return httpx.Response(
                200,
                json={
                    "total": 1,
                    "results": [
                        dict(
                            CERT,
                            identifiant_ban="16015_9999_00001"
                            if bad_address
                            else "16015_1985_00011",
                        )
                    ],
                },
            )
        return httpx.Response(
            200,
            json=[
                {
                    "batiment_groupe_id": "other" if bad_relation else BUILDING,
                    "cle_interop_adr": "16015_1985_00011",
                }
            ],
        )

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as client,
        pytest.raises(bdnb.UpstreamError),
    ):
        bdnb._address_diagnostics(client, [{"id": BUILDING}])


def test_all_diagnostics_keep_expired_and_replaced_records_and_flag_limits():
    old = dict(
        CERT, identifiant_ban="16015_1985_00011", date_fin_validite_dpe="2024-08-01"
    )
    new = dict(
        old,
        numero_dpe="2516E3415738I",
        numero_dpe_remplace=CERT["numero_dpe"],
        date_etablissement_dpe="2025-10-29",
    )

    def respond(request):
        if request.url.host == "data.ademe.fr":
            return httpx.Response(200, json={"total": 3, "results": [old, new]})
        return httpx.Response(
            200,
            json=[
                {"batiment_groupe_id": BUILDING, "cle_interop_adr": "16015_1985_00011"}
            ],
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result, truncated = bdnb._address_diagnostics(client, [{"id": BUILDING}])
    assert len(result) == 2
    assert truncated
    assert result[0]["replaces"] == CERT["numero_dpe"]


def test_address_failure_keeps_representative_without_caching(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)

    def fail(*args):
        raise bdnb.UpstreamError()

    monkeypatch.setattr(bdnb, "_address_diagnostics", fail)
    result = fetch()
    assert result["address_diagnostics_unavailable"]
    assert result["buildings"][0]["representative"]["ademe"]["energy_class"] == "D"
    monkeypatch.setattr(bdnb, "_fetch", lambda *args: result)
    bdnb.lookup(PARCEL)
    assert not list((tmp_path / "bdnb").glob("*.json"))
