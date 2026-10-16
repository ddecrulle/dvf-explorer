"""CronJob client: trigger the single API writer and wait for its result."""

import argparse
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx


def in_publication_window(now: datetime) -> bool:
    """Weekdays, April/October 1–14, evaluated in the scheduler's timezone."""
    local = now.astimezone(ZoneInfo("Europe/Paris"))
    return local.month in (4, 10) and local.day <= 14 and local.weekday() < 5


def main(scheduled=False):
    if scheduled and not in_publication_window(datetime.now(ZoneInfo("Europe/Paris"))):
        print("Outside the publication window; no sync requested.", flush=True)
        return
    base = os.environ["DVF_API_URL"].rstrip("/")
    token = os.environ["DVF_ADMIN_TOKEN"]
    with httpx.Client(timeout=180, headers={"X-Admin-Token": token}) as client:
        response = client.post(base + "/api/sync")
        response.raise_for_status()
        task_id = response.json()["id"]
        deadline = time.monotonic() + 48 * 3600
        while time.monotonic() < deadline:
            status = client.get(base + "/api/status")
            status.raise_for_status()
            job = status.json()["job"]
            if job.get("id") != task_id:
                raise RuntimeError("The job was replaced; check the sync log.")
            print(job["message"], flush=True)
            if job["state"] == "done":
                return
            if job["state"] != "running":
                raise RuntimeError(job["message"])
            time.sleep(30)
        raise TimeoutError("Sync still running after 48 hours; check the server.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--scheduled",
        action="store_true",
        help="Only sync on weekdays during April/October 1–14. Omit for manual runs.",
    )
    main(scheduled=parser.parse_args().scheduled)
