import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import archive
import national
import store
from ingest import city_code


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.delenv("DVF_ARCHIVE_DIR", raising=False)
    return tmp_path


def raw_row(date="05/01/2026", price="200000,00", dep="16"):
    row = dict.fromkeys(
        [
            "Identifiant de document",
            "Reference document",
            "Code departement",
            "Code commune",
            "Date mutation",
            "Nature mutation",
            "Valeur fonciere",
            "No disposition",
            "Prefixe de section",
            "Section",
            "No plan",
            "Type local",
            "Surface reelle bati",
            "Nombre pieces principales",
            "Nature culture",
            "Nature culture speciale",
            "Surface terrain",
            "No voie",
            "B/T/Q",
            "Type de voie",
            "Voie",
            "Commune",
        ],
        "",
    )
    row.update(
        {
            "Code departement": dep,
            "Code commune": "015",
            "Date mutation": date,
            "Nature mutation": "Vente",
            "Valeur fonciere": price,
            "No disposition": "1",
            "Section": "AB",
            "No plan": "1",
            "Type local": "Maison",
            "Surface reelle bati": "100",
            "Commune": "ANGOULEME",
        }
    )
    return row


def zipped(rows):
    text = io.StringIO()
    writer = csv.DictWriter(text, fieldnames=rows[0].keys(), delimiter="|")
    writer.writeheader()
    writer.writerows(rows)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("dvf.txt", text.getvalue())
    return out.getvalue()


def record(rows, year=2026, title=None):
    folder = archive.root() / "objects"
    folder.mkdir(exist_ok=True)
    content = zipped(rows)
    import hashlib

    sha = hashlib.sha256(content).hexdigest()
    (folder / f"{sha}.zip").write_bytes(content)
    resource = {
        "year": year,
        "title": title or f"Valeurs foncières {year}",
        "url": "https://example.test/dvf.zip",
    }
    return {
        "sha256": sha,
        "path": f"objects/{sha}.zip",
        "resource": resource,
        "coverage": archive.coverage(resource),
    }


def sales():
    con = store.connect()
    rows = con.execute("SELECT year,price FROM sales ORDER BY date").fetchall()
    con.close()
    return rows


def test_revisions_are_idempotent_and_retired_years_survive(isolated):
    old = record([raw_row("03/01/2020")], 2020)
    national.import_snapshot(old)
    current = record([raw_row()])
    national.import_snapshot(current)
    assert national.import_snapshot(current) == 0
    revised = record([raw_row(price="210000,00")])
    national.import_snapshot(revised)
    assert sales() == [(2020, 200000), (2026, 210000)]
    national.import_snapshot(
        current
    )  # A -> B -> A must restore A, not skip historical hash.
    assert sales() == [(2020, 200000), (2026, 200000)]


def test_half_year_keeps_first_semester(isolated):
    national.import_snapshot(record([raw_row(), raw_row("01/08/2026", price="300000")]))
    national.import_snapshot(
        record(
            [raw_row("01/08/2026", price="310000")],
            title="Valeurs foncières 2026 - Second semestre",
        )
    )
    assert sales() == [(2026, 200000), (2026, 310000)]


def test_bad_year_never_replaces_existing(isolated):
    national.import_snapshot(record([raw_row()]))
    with pytest.raises(ValueError):
        national.import_snapshot(record([raw_row("01/01/2025")]))
    assert sales() == [(2026, 200000)]


def test_missing_archive_is_not_silently_accepted(isolated):
    r = record([raw_row()])
    (archive.root() / r["path"]).write_bytes(b"corrupt")
    with pytest.raises(ValueError):
        national.import_snapshot(r)
    assert sales() == []


def test_archive_preserves_both_versions(isolated, monkeypatch):
    content = [zipped([raw_row()])]
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=content[0])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(archive.httpx, "stream", client.stream)
    r = {
        "id": "file",
        "year": 2026,
        "title": "Valeurs foncières 2026",
        "url": "https://example.test/dvf.zip",
        "last_modified": "2026-04-01",
    }
    first = archive.archive_resource(r)
    archive.archive_resource(
        dict(r, downloads=999)
    )  # Usage counters are not publication revisions.
    assert len(calls) == 1
    content[0] = zipped([raw_row(price="210000")])
    r["last_modified"] = "2026-10-01"
    second = archive.archive_resource(r)
    assert first["sha256"] != second["sha256"]
    assert (archive.root() / first["path"]).exists() and (
        archive.root() / second["path"]
    ).exists()


def test_parcel_points_join(isolated):
    national.import_snapshot(record([raw_row()]))
    con = store.connect()
    national.initialise(con)
    con.execute("INSERT INTO parcel_points VALUES ('16015000AB0001',.148,45.644)")
    national.apply_points(con, "16")
    assert con.execute("SELECT longitude FROM sales").fetchone()[0] == 0.148
    con.close()


def test_dom_commune_code():
    assert city_code({"Code departement": "971", "Code commune": "101"}) == "97101"


def test_geocoding_resume_and_counts(isolated):
    import gzip

    from geocode import geocode_department

    national.import_snapshot(record([raw_row()]))
    features = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "16015000AB0001"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[0.14, 45.64], [0.15, 45.64], [0.15, 45.65], [0.14, 45.64]]
                    ],
                },
            }
        ],
    }
    with gzip.open(isolated / "cadastre-16.json.gz", "wt") as f:
        json.dump(features, f)
    geocode_department("16")
    # A price correction does not force another cadastral download.
    national.import_snapshot(record([raw_row(price="250000")]))
    geocode_department("16")
    con = store.connect()
    assert con.execute("SELECT count,located FROM imports").fetchone() == (1, 1)
    assert con.execute("SELECT count(*) FROM geocoding").fetchone()[0] == 1
    con.close()


def test_offline_rebuild_preserves_retired_and_revisions(isolated):
    from rebuild import rebuild

    first = record([raw_row("01/01/2020")], 2020)
    second = record([raw_row()])
    corrected = record([raw_row(price="220000")])
    folder = archive.root() / "snapshots"
    folder.mkdir()
    (folder / "20260401.json").write_text(json.dumps({"resources": [first, second]}))
    (folder / "20261001.json").write_text(json.dumps({"resources": [corrected]}))
    rebuild()
    assert sales() == [(2020, 200000), (2026, 220000)]
    with pytest.raises(RuntimeError):
        rebuild()
