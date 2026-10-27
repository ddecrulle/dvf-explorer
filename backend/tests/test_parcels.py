import json
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dataset
import main
import parcels
import publish
import store

P1, P2, P3 = "16015000AB0001", "16015000AB0002", "16015000AB0003"
BOUNDS = {"west": 0.1, "east": 0.2, "south": 45.6, "north": 45.7}


def add(con, identifier, year, amount, ids, **overrides):
    row = dict(
        id=identifier,
        date=date(year, 6, 1),
        price=amount,
        address="",
        city="Angoulême",
        department="16",
        citycode="16015",
        kind="Maison",
        surface=100,
        land=1000,
        rooms=None,
        longitude=0.15,
        latitude=45.65,
        parcels=json.dumps(ids),
        row_count=1,
        year=year,
        source="https://example.test",
        multi=len(ids) > 1,
    )
    row.update(overrides)
    con.execute(
        "INSERT INTO sales ("
        + ",".join(row)
        + ") VALUES ("
        + ",".join("?" for _ in row)
        + ")",
        list(row.values()),
    )


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    con = store.connect()
    add(con, "old", 2016, 100000, [P1])
    add(con, "middle", 2019, 200000, [P1, P1])
    add(con, "shared", 2025, 400000, [P1, P2])
    add(con, "recent", 2026, 100000, [P2])
    add(con, "unlocated", 2024, 90000, [P1], longitude=None, latitude=None)
    add(con, "far-point", 2018, 300000, [P1], longitude=1.5, latitude=46)
    # Exact JSON membership must not match a mere substring of another ID.
    add(con, "other", 2025, 80000, [P3], longitude=2, latitude=47)
    con.close()
    return tmp_path / "dvf.duckdb"


def test_map_groups_parcels_before_limit_and_keeps_mutation_statistics(source):
    client = TestClient(main.app)
    response = client.get("/api/parcels", params=BOUNDS)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 2
    assert data["mutations"] == 4
    assert data["median_price"] == 150000  # shared price counted once, not per parcel
    by_id = {p["id"]: p for p in data["parcels"]}
    assert by_id[P1]["matching_mutations"] == 3  # repeated P1 in one row counted once
    assert by_id[P2]["matching_mutations"] == 2
    assert by_id[P1]["latest_price"] == 400000
    assert by_id[P1]["latest_mutation_parcels"] == 2
    assert by_id[P2]["latest_date"] == "2026-06-01"


def test_latest_declared_address_remains_attached_to_its_sale(source):
    con = store.connect()
    con.execute("UPDATE sales SET address='5 IMP JACQUES BREL' WHERE id='recent'")
    con.close()
    data = TestClient(main.app).get("/api/parcels", params=BOUNDS).json()
    by_id = {p["id"]: p for p in data["parcels"]}
    assert by_id[P2]["latest_address"] == "5 IMP JACQUES BREL"
    assert by_id[P1]["latest_address"] == ""


def test_history_ignores_map_filters_and_includes_unlocated_or_distant_points(source):
    client = TestClient(main.app)
    data = client.get(
        "/api/parcels", params=dict(BOUNDS, year=2025, price_min=350000)
    ).json()
    assert len(data["parcels"]) == 2
    assert data["mutations"] == 1
    history = client.get(f"/api/parcels/{P1}/mutations").json()
    assert history["total"] == 5
    assert [m["id"] for m in history["mutations"]] == [
        "shared",
        "unlocated",
        "middle",
        "far-point",
        "old",
    ]
    assert history["first_date"] == "2016-06-01"
    assert history["mutations"][0]["price"] == 400000
    assert history["mutations"][0]["parcels"] == [P1, P2]
    assert client.get(f"/api/parcels/{P2}/mutations").json()["total"] == 2


def test_history_paginates_deterministically_and_keeps_full_count(source):
    with store.LOCK:
        con = store.connect()
        for n in range(60):
            add(con, f"tie-{n:03}", 2020, 100000 + n, [P3])
        con.close()
    client = TestClient(main.app)
    first = client.get(f"/api/parcels/{P3}/mutations").json()
    second = client.get(f"/api/parcels/{P3}/mutations?offset=50").json()
    assert first["total"] == second["total"] == 61
    assert len(first["mutations"]) == 50 and len(second["mutations"]) == 11
    assert first["next_offset"] == 50 and second["next_offset"] is None
    ids = [m["id"] for m in first["mutations"] + second["mutations"]]
    assert len(set(ids)) == 61


def test_published_history_reads_all_department_years_and_pins_release(
    source, tmp_path, monkeypatch
):
    root = tmp_path / "published"
    first = publish.export(source, root)
    con = store.connect()
    con.execute("UPDATE sales SET price=price+1000")
    con.close()
    second = publish.export(source, root)
    monkeypatch.setenv("DVF_DATASET_URL", str(root / "current.json"))
    dataset._cache.clear()
    client = TestClient(main.app)
    old = client.get(
        f"/api/parcels/{P1}/mutations", params={"release": first["release"]}
    ).json()
    current = client.get(
        f"/api/parcels/{P1}/mutations", params={"release": second["release"]}
    ).json()
    assert old["total"] == current["total"] == 5
    assert old["mutations"][0]["price"] == 400000
    assert current["mutations"][0]["price"] == 401000
    assert old["release"] == first["release"]


def test_dense_map_counts_parcels_instead_of_repeated_sales(source):
    con = store.connect()
    for n in range(3005):
        add(con, f"dense-{n}", 2026, 100000, [f"16015000CD{n:04}"])
    con.close()
    response = TestClient(main.app).get("/api/parcels", params=BOUNDS).json()
    assert response["total"] == 3007
    assert len(response["parcels"]) == 3000
    assert response["truncated"]
    assert sum(c["count"] for c in response["clusters"]) == 3007


def test_invalid_and_absent_parcel_are_distinct(source):
    client = TestClient(main.app)
    assert client.get("/api/parcels/bad/mutations").status_code == 422
    assert client.get("/api/parcels/16015000ZZ9999/mutations").json()["total"] == 0
    assert client.get(f"/api/parcels/{P1}/mutations?offset=-1").status_code == 422
    assert client.get("/api/parcels", params=dict(BOUNDS, west=0.3)).status_code == 422
