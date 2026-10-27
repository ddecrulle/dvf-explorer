import csv
import io
import json
import zipfile
import sys
from pathlib import Path
from datetime import date

import duckdb
import pytest
from fastapi.testclient import TestClient
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dataset
import dvfplus
import main
import publish
import store
from object_store import child


def source_row(**updates):
    return (
        dict(
            idopendata="public-id",
            datemut="2026-01-05",
            coddep="16",
            libnatmut="Vente",
            valeurfonc="200000",
            l_codinsee="16015",
            l_idpar="16015000AB0001",
            nbpar="1",
            nblocmai="1",
            nblocapt="0",
            nblocact="0",
            nblocmut="1",
            sbati="100",
            sterr="300",
            geompar_x="475944.1766302994",
            geompar_y="6509828.29887978",
        )
        | updates
    )


def archive(path, rows):
    data = io.StringIO()
    w = csv.DictWriter(data, fieldnames=list(rows[0]), delimiter="|")
    w.writeheader()
    w.writerows(rows)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("1_DONNEES_LIVRAISON/dvf_plus_d16.csv", data.getvalue())
    return path


def prepared(tmp_path, rows=None):
    raw = archive(tmp_path / "source.zip", rows or [source_row()])
    db = tmp_path / "worker.duckdb"
    dvfplus.prepare(
        raw,
        db,
        date(2025, 1, 1),
        date(2026, 6, 30),
        "EPSG:2154",
        {"16015": "Angoulême"},
    )
    return db


def test_dvfplus_mapping_uses_transaction_identifier_and_projected_coordinates():
    transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    row = dvfplus.normalise(source_row(), transformer, {"16015": "Angoulême"})
    assert row[0] == "dvfplus:public-id"
    assert row[4] == "Angoulême" and row[7] == "Maison"
    assert row[8] == 100 and row[17] is False
    assert -1 < row[11] < 1 and 45 < row[12] < 47
    complex_row = dvfplus.normalise(source_row(nblocmai="2", nblocmut="2"), transformer)
    assert complex_row[8] is None and complex_row[17] is True
    assert dvfplus.normalise(source_row(valeurfonc="0"), transformer) is None
    assert dvfplus.normalise(source_row(libnatmut="Echange"), transformer) is None


def test_house_with_dependencies_keeps_built_surface():
    transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    # Actual source values for parcel 16358000AZ0386, sold on 2022-11-10.
    source = source_row(
        l_idpar="16358000AZ0386",
        l_codinsee="16358",
        nblocmut="4",
        nblocdep="3",
        sbati="137",
        sterr="941",
    )
    row = dvfplus.normalise(source, transformer)
    assert row[8] == 137
    assert row[18] == 3
    assert row[17] is False
    for changes in [
        {"nblocmai": "2", "nblocmut": "5"},
        {"nblocapt": "1"},
        {"nbpar": "2", "l_idpar": "16358000AZ0386,16358000AZ0387"},
        {"l_idpar": "16358000AZ0386,16358000AZ0387"},
        {"sbati": ""},
    ]:
        result = dvfplus.normalise(source | changes, transformer)
        assert result[8] is None


def test_normalization_upgrade_reprocesses_unchanged_archive(tmp_path):
    db = prepared(tmp_path, [source_row(nblocmut="4", sbati="137")])
    con = duckdb.connect(str(db))
    con.execute("UPDATE sales SET surface=NULL, multi=true")
    con.execute("UPDATE dvfplus_sources SET normalization='v1:old'")
    con.close()
    dvfplus.prepare(
        tmp_path / "source.zip",
        db,
        date(2025, 1, 1),
        date(2026, 6, 30),
        "EPSG:2154",
        {"16015": "Angoulême"},
    )
    con = duckdb.connect(str(db), read_only=True)
    assert con.execute("SELECT surface,multi FROM sales").fetchone() == (137, False)
    con.close()


@pytest.mark.parametrize(
    "count, expected", [("3", 3), ("0", 0), ("", None), (None, None)]
)
def test_dependency_count_survives_publication_and_parcel_history(
    tmp_path, monkeypatch, count, expected
):
    db = prepared(tmp_path, [source_row(nblocdep=count)])
    root = tmp_path / "published"
    publish.export(db, root)
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    dataset._cache.clear()
    with TestClient(main.app) as client:
        response = client.get("/api/parcels/16015000AB0001/mutations")
        assert response.status_code == 200
        assert response.json()["mutations"][0]["dependency_count"] == expected


def test_older_published_release_without_dependency_count_remains_readable(
    tmp_path, monkeypatch
):
    db = prepared(tmp_path)
    con = duckdb.connect(str(db))
    con.execute("ALTER TABLE sales DROP COLUMN dependency_count")
    con.close()
    root = tmp_path / "published"
    publish.export(db, root)
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    dataset._cache.clear()
    with TestClient(main.app) as client:
        response = client.get("/api/parcels/16015000AB0001/mutations")
        assert response.status_code == 200
        assert "dependency_count" not in response.json()["mutations"][0]
    con = duckdb.connect(str(db))
    store.create_schema(con)
    assert con.execute("SELECT dependency_count FROM sales").fetchone() == (None,)
    con.close()


def test_resumable_replacement_preserves_retired_years_and_unlocated_sales(tmp_path):
    db = prepared(
        tmp_path, [source_row(idopendata="old", datemut="2025-02-01"), source_row()]
    )
    raw = archive(
        tmp_path / "correction.zip",
        [source_row(valeurfonc="300000", geompar_x="", geompar_y="")],
    )
    for _ in range(2):
        dvfplus.prepare(raw, db, date(2026, 1, 1), date(2026, 6, 30), "EPSG:2154")
    con = duckdb.connect(str(db))
    assert con.execute(
        "SELECT year,price,longitude FROM sales ORDER BY year"
    ).fetchall() == [(2025, 200000, pytest.approx(0.07, abs=0.2)), (2026, 300000, None)]
    assert con.execute("SELECT count(*) FROM dvfplus_sources").fetchone()[0] == 1
    con.close()
    broken = archive(tmp_path / "bad.zip", [source_row(datemut="2024-01-01")])
    with pytest.raises(ValueError, match="outside"):
        dvfplus.prepare(broken, db, date(2026, 1, 1), date(2026, 6, 30), "EPSG:2154")
    con = duckdb.connect(str(db))
    assert con.execute("SELECT count(*) FROM sales").fetchone()[0] == 2
    con.close()


def test_published_api_without_local_database_and_filters(tmp_path, monkeypatch):
    db = prepared(
        tmp_path,
        [
            source_row(),
            source_row(idopendata="older", datemut="2025-01-01", valeurfonc="100000"),
            source_row(idopendata="unlocated", geompar_x="", geompar_y=""),
        ],
    )
    root = tmp_path / "published"
    pointer = publish.export(db, root)
    monkeypatch.setattr(store, "DATA", tmp_path / "empty-web-server")
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    monkeypatch.setattr(
        store,
        "connect",
        lambda: pytest.fail("Published API must not open local DuckDB"),
    )
    dataset._cache.clear()
    with TestClient(main.app) as client:
        s = client.get("/api/status").json()
        assert s["dataset"]["release"] == pointer["release"]
        assert s["years"] == [2026, 2025]
        assert sum(i["count"] for i in s["imports"]) == 3
        assert sum(i["located"] for i in s["imports"]) == 2
        with dataset.query_connection() as con:
            lon, lat = con.execute(
                "SELECT longitude,latitude FROM sales WHERE longitude IS NOT NULL LIMIT 1"
            ).fetchone()
        response = client.get(
            "/api/sales", params=dict(lon=lon, lat=lat, year=2026)
        ).json()
        assert response["total"] == 1 and response["median_sqm"] == 2000
        assert response["sales"][0]["id"] == "dvfplus:public-id"
        assert (
            client.get("/api/sales", params=dict(lon=lon, lat=lat, year=2024)).json()[
                "total"
            ]
            == 0
        )
        assert (
            client.get(
                "/api/sales", params=dict(lon=lon, lat=lat, price_max=150000)
            ).json()["total"]
            == 1
        )
        assert client.post("/api/sync").status_code == 409
        assert (
            client.post(
                "/api/import", json=dict(department="16", year=2026)
            ).status_code
            == 409
        )
    assert not (store.DATA / "dvf.duckdb").exists()


def test_snapshot_refresh_and_inflight_release_are_consistent(tmp_path, monkeypatch):
    db = prepared(tmp_path)
    root = tmp_path / "published"
    first = publish.export(db, root)
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    dataset._cache.clear()
    with dataset.query_connection() as previous:
        con = duckdb.connect(str(db))
        con.execute("UPDATE sales SET price=300000")
        con.close()
        second = publish.export(db, root)
        dataset._cache.clear()
        with dataset.query_connection() as current:
            assert current.execute("SELECT price FROM sales").fetchone()[0] == 300000
        assert previous.execute("SELECT price FROM sales").fetchone()[0] == 200000
    assert first != second
    dataset._cache.clear()
    with dataset.query_connection(release=first["release"]) as pinned:
        assert pinned.execute("SELECT price FROM sales").fetchone()[0] == 200000


def test_failed_export_and_upload_do_not_advance_shared_pointer(tmp_path):
    db = prepared(tmp_path)
    root = tmp_path / "published"
    first = publish.export(db, root)
    con = duckdb.connect(str(db))
    con.execute("DELETE FROM sales")
    con.close()
    with pytest.raises(ValueError, match="empty"):
        publish.export(db, root)
    assert json.loads((root / "current.json").read_text()) == first

    class BrokenPost:
        def __init__(self):
            self.keys = []

        def put(self, key, path):
            self.keys.append(key)
            raise RuntimeError("upload failed")

    post = BrokenPost()
    with pytest.raises(RuntimeError, match="upload failed"):
        publish.upload(
            root, first, "s3://ddecrulle/DVF_Explorer/curated", post, activate=True
        )
    assert "current.json" not in post.keys


@pytest.mark.parametrize(
    "path",
    [
        "../secret",
        "/root/file",
        "https://example.test/file",
        "a//b",
        "a/%2e%2e/b",
        "a/*.parquet",
    ],
)
def test_manifest_paths_stay_within_dataset_prefix(path):
    with pytest.raises(ValueError):
        child("s3://bucket/prefix", path)


def test_missing_published_data_reports_unavailability_not_empty_sales(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("DVF_DATASET_URL", str(tmp_path / "missing.json"))
    dataset._cache.clear()
    with TestClient(main.app) as client:
        assert client.get("/api/status").status_code == 503
        assert client.get("/api/sales").status_code == 503
        assert client.get("/api/ready").status_code == 503
        assert client.get("/api/health").status_code == 200


def test_geographic_pruning_keeps_neighbouring_departments(tmp_path, monkeypatch):
    db = prepared(tmp_path)
    con = duckdb.connect(str(db))
    con.execute(
        "INSERT INTO sales SELECT 'neighbour',date,price,address,city,'17',citycode,kind,surface,land,rooms,longitude+0.001,latitude,parcels,row_count,year,source,multi,dependency_count FROM sales"
    )
    lon, lat = con.execute("SELECT longitude,latitude FROM sales LIMIT 1").fetchone()
    con.close()
    root = tmp_path / "published"
    publish.export(db, root)
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    dataset._cache.clear()
    with TestClient(main.app) as client:
        body = client.get("/api/sales", params=dict(lon=lon, lat=lat)).json()
        assert body["total"] == 2
        assert {r["department"] for r in body["sales"]} == {"16", "17"}
        assert (
            client.get("/api/sales", params=dict(lon=30, lat=20)).json()["total"] == 0
        )


def test_regional_csv_supports_multiple_departments(tmp_path):
    data = io.StringIO()
    rows = [source_row(), source_row(idopendata="second", coddep="17")]
    writer = csv.DictWriter(data, fieldnames=list(rows[0]), delimiter="|")
    writer.writeheader()
    writer.writerows(rows)
    raw = tmp_path / "regional.zip"
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr("1_DONNEES_LIVRAISON/dvf_plus.csv", data.getvalue())
    db = tmp_path / "worker.duckdb"
    dvfplus.prepare(raw, db, date(2026, 1, 1), date(2026, 6, 30), "EPSG:2154")
    con = duckdb.connect(str(db))
    assert con.execute(
        "SELECT department FROM sales ORDER BY department"
    ).fetchall() == [("16",), ("17",)]
    con.close()
