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
        assert request.url.path.endswith("/batiment_groupe_dpe_representatif_logement")
        assert BUILDING in request.url.params["batiment_groupe_id"]
        return httpx.Response(200, json=[REP] if reps is None else reps)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return bdnb._fetch(PARCEL, client)


def test_reference_parcel_exact_chain():
    calls = []
    result = fetch(calls=calls)
    assert result["scope"] == "current_building_representative"
    assert len(calls) == 3
    assert calls[-1].url.params["qs"] == 'numero_dpe:"2416E2621326Z"'
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
    assert len(calls) == 2


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
