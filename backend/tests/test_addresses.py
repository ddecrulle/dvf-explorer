import csv
import gzip
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import addresses
import main
import store
from fastapi.testclient import TestClient


def test_cadastral_formats():
    assert addresses.normalize("1600010000A0465") == "160010000A0465"
    assert addresses.normalize("16015000AN0074") == "16015000AN0074"
    assert addresses.normalize("2A0004000AB0001") == "2A004000AB0001"
    assert addresses.normalize("971001000AB0001") == "97101000AB0001"
    assert addresses.normalize("16015100AN00741") is None
    assert addresses.normalize("garbage") is None


def fixture_index(tmp_path):
    export = tmp_path / "addresses.csv.gz"
    fields = [
        "id",
        "numero",
        "rep",
        "nom_voie",
        "code_postal",
        "nom_commune",
        "cad_parcelles",
        "certification_commune",
    ]
    with gzip.open(export, "wt", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(fields)
        writer.writerow(
            [
                "one",
                "9",
                "bis",
                "Impasse Test",
                "16000",
                "Angoulême",
                "160015000AN0074|16015000AN0075|160015000AN0074",
                "1",
            ]
        )
        writer.writerow(
            ["two", "11", "", "Rue Test", "16000", "Angoulême", "16015000AN0074", "0"]
        )
        writer.writerow(
            ["unlinked", "8", "", "Rue Voisine", "16000", "Angoulême", "", "0"]
        )
    target = tmp_path / "ban-16.sqlite"
    addresses.build_index(export, target, {"url": "https://example.test"})
    return target


def test_many_to_many_exact_lookup(tmp_path, monkeypatch):
    target = fixture_index(tmp_path)
    monkeypatch.setattr(addresses, "ensure_index", lambda dep: target)
    result = addresses.lookup(["16015000AN0074", "16015000AN0075", "16015000AN0076"])
    assert [a["label"] for a in result["addresses"]["16015000AN0074"]] == [
        "9 bis Impasse Test",
        "11 Rue Test",
    ]
    assert len(result["addresses"]["16015000AN0075"]) == 1
    assert "16015000AN0076" not in result["addresses"]
    assert result["sources"]["16"]["url"] == "https://example.test"


def test_cached_index_never_downloaded(tmp_path, monkeypatch):
    root = tmp_path / "addresses"
    root.mkdir()
    fixture_index(root)
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(
        addresses.httpx,
        "stream",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("Unexpected network")),
    )
    assert addresses.lookup(["16015000AN0074"])["addresses"]


def test_source_failure_keeps_parcels_usable(monkeypatch):
    monkeypatch.setattr(
        addresses, "ensure_index", lambda dep: (_ for _ in ()).throw(OSError("offline"))
    )
    client = TestClient(main.app)
    assert client.post(
        "/api/parcel-addresses", json={"parcels": ["16015000AN0074"]}
    ).json() == {"addresses": {}, "sources": {}, "unavailable": ["16"]}
    assert (
        client.post("/api/parcel-addresses", json={"parcels": ["../bad"]}).status_code
        == 422
    )
    assert client.post("/api/parcel-addresses", json={"parcels": []}).status_code == 422


def test_failed_refresh_preserves_existing_index(tmp_path, monkeypatch):
    from contextlib import contextmanager

    import pytest

    root = tmp_path / "addresses"
    root.mkdir()
    target = fixture_index(root)
    before = target.read_bytes()
    monkeypatch.setattr(store, "DATA", tmp_path)

    class Response:
        def __init__(self):
            self.headers = {}

        def raise_for_status(self):
            pass

        def iter_bytes(self):
            yield gzip.compress(b"unexpected;schema\n")

    @contextmanager
    def download(*args, **kwargs):
        yield Response()

    monkeypatch.setattr(addresses.httpx, "stream", download)
    with pytest.raises(ValueError, match="schema"):
        addresses.ensure_index("16", refresh=True)
    assert target.read_bytes() == before
