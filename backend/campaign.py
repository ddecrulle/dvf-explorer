"""Persist seasonal checks until a new publication is successfully integrated."""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from archive import CATALOG, atomic_json, resources, root
from sync import sync_all, writer_lock


def campaign_start(now):
    local = now.astimezone(ZoneInfo("Europe/Paris"))
    year = local.year if local.month >= 4 else local.year - 1
    month = 4 if 4 <= local.month < 10 else 10
    return local.replace(
        year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0
    )


def signatures(items):
    # Ignore usage counters, ordering and catalog-only edits.
    keys = ("id", "url", "last_modified", "checksum", "title", "filesize")
    return sorted(
        {
            json.dumps({key: item.get(key) for key in keys}, sort_keys=True)
            for item in items
        }
    )


def published_since(items, start, now):
    for item in items:
        value = item.get("last_modified")
        if not value:
            continue
        try:
            published = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if published.tzinfo is None:
                published = published.replace(tzinfo=ZoneInfo("UTC"))
            if start <= published <= now:
                return True
        except (ValueError, TypeError):
            continue
    return False


def check_campaign(progress=print, now=None):
    now = now or datetime.now(ZoneInfo("Europe/Paris"))
    start = campaign_start(now)
    key = start.date().isoformat()
    # State belongs to the API's persistent volume, not the short-lived CronJob.
    with writer_lock():
        path = root() / "campaigns" / f"{key}.json"
        state = json.loads(path.read_text()) if path.exists() else None
        if state and state.get("completed_at"):
            progress(
                f"Publication campaign {key} already complete; no source check needed."
            )
            return
        catalog = (
            httpx.get(CATALOG, follow_redirects=True, timeout=60)
            .raise_for_status()
            .json()
        )
        items = resources(catalog)
        current = signatures(items)
        if state is None:
            latest = root() / "latest.json"
            archived = json.loads(latest.read_text()) if latest.exists() else {}
            baseline = (
                signatures([r["resource"] for r in archived.get("resources", [])])
                or current
            )
            state = {"campaign": key, "baseline": baseline, "pending": False}
            # A deployment after publication must import that release, not wait
            # for another revision. Missing dates fall back to change detection.
            state["pending"] = published_since(items, start, now)
        state["pending"] = state["pending"] or bool(
            set(current) - set(state["baseline"])
        )
        state["checked_at"] = now.isoformat()
        atomic_json(path, state)
        if not state["pending"]:
            progress(
                f"No new DVF publication for campaign {key}; checks will continue."
            )
            return
        # Persist pending before work so an interruption retries even though
        # capture() has already advanced latest.json.
        sync_all(progress, catalog=catalog, lock_held=True)
        state["completed_at"] = datetime.now(ZoneInfo("Europe/Paris")).isoformat()
        state["published_resources"] = current
        atomic_json(path, state)
        progress(
            f"Publication campaign {key} complete; checks paused until the next campaign."
        )
