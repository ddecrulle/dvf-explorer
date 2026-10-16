import json
import sys
from datetime import datetime
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import campaign
import store


def instant(value):
    return datetime.fromisoformat(value + "+02:00")


def resource(version="old", modified="2026-03-01T09:00:00Z"):
    return {
        "id": version,
        "title": "Valeurs foncières 2026",
        "url": f"https://example.test/{version}.zip",
        "last_modified": modified,
    }


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.delenv("DVF_ARCHIVE_DIR", raising=False)
    calls = []
    catalog = {"resources": [resource()]}

    def get(*args, **kwargs):
        calls.append("catalog")
        return httpx.Response(
            200,
            json=catalog,
            request=httpx.Request("GET", "https://example.test/catalog"),
        )

    monkeypatch.setattr(campaign.httpx, "get", get)
    monkeypatch.setattr(
        campaign, "sync_all", lambda *args, **kwargs: calls.append("sync")
    )
    return catalog, calls


def test_unchanged_keeps_checking_past_fourteenth(setup):
    catalog, calls = setup
    campaign.check_campaign(now=instant("2026-04-01T09:00:00"))
    campaign.check_campaign(now=instant("2026-05-18T16:00:00"))
    assert calls == ["catalog", "catalog"]
    state = json.loads((campaign.root() / "campaigns/2026-04-01.json").read_text())
    assert not state["pending"] and "completed_at" not in state


def test_new_release_stops_checks_and_next_campaign_resumes(setup):
    catalog, calls = setup
    campaign.check_campaign(now=instant("2026-04-01T09:00:00"))
    catalog["resources"] = [resource("new", "2026-04-20T10:00:00Z")]
    campaign.check_campaign(now=instant("2026-04-20T16:00:00"))
    campaign.check_campaign(now=instant("2026-05-01T09:00:00"))
    assert calls == ["catalog", "catalog", "sync"]
    campaign.check_campaign(now=instant("2026-10-01T09:00:00"))
    assert calls == ["catalog", "catalog", "sync", "catalog"]


def test_failed_ingestion_retries_even_after_latest_advances(setup, monkeypatch):
    catalog, calls = setup
    catalog["resources"] = [resource("new", "2026-04-02T10:00:00Z")]

    def fail(*args, **kwargs):
        campaign.atomic_json(
            campaign.root() / "latest.json",
            {"resources": [{"resource": catalog["resources"][0]}]},
        )
        raise RuntimeError("Parcel service unavailable")

    monkeypatch.setattr(campaign, "sync_all", fail)
    with pytest.raises(RuntimeError):
        campaign.check_campaign(now=instant("2026-04-03T09:00:00"))
    state = json.loads((campaign.root() / "campaigns/2026-04-01.json").read_text())
    assert state["pending"] and "completed_at" not in state
    monkeypatch.setattr(
        campaign, "sync_all", lambda *args, **kwargs: calls.append("retry")
    )
    campaign.check_campaign(now=instant("2026-04-03T16:00:00"))
    assert calls == ["catalog", "catalog", "retry"]


def test_initial_deployment_after_publication_imports_current_release(setup):
    catalog, calls = setup
    catalog["resources"] = [resource("new", "2026-10-12T09:00:00Z")]
    campaign.check_campaign(now=instant("2026-10-16T16:00:00"))
    assert calls == ["catalog", "sync"]


def test_usage_changes_and_removals_do_not_finish_campaign(setup):
    catalog, calls = setup
    catalog["resources"].append(resource("second"))
    campaign.check_campaign(now=instant("2026-04-01T09:00:00"))
    catalog["resources"] = [dict(resource(), downloads=999)]
    campaign.check_campaign(now=instant("2026-04-02T09:00:00"))
    assert calls == ["catalog", "catalog"]


@pytest.mark.parametrize(
    "date, expected",
    [
        ("2027-01-05T09:00:00+01:00", "2026-10-01"),
        ("2026-03-31T22:30:00+00:00", "2026-04-01"),
        ("2026-09-30T22:30:00+00:00", "2026-10-01"),
    ],
)
def test_campaign_boundaries(date, expected):
    assert (
        campaign.campaign_start(datetime.fromisoformat(date)).date().isoformat()
        == expected
    )
