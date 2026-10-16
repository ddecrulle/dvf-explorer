"""Resumable nationwide sync. The API is the only database writer in production."""

import argparse
import fcntl
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone

import store
from archive import atomic_json, capture, root
from geocode import geocode_department
from national import import_snapshot


@contextmanager
def writer_lock():
    with (store.DATA / "sync.lock").open("a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("A sync is already running.")
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def sync_all(progress=print, geocode=True, *, catalog=None, lock_held=False):
    with nullcontext() if lock_held else writer_lock():
        snapshot = capture(progress, catalog=catalog)
        # Archive every file before modifying the query database.
        for record in snapshot["resources"]:
            import_snapshot(record, progress)
        errors = []
        if geocode:
            with store.LOCK:
                con = store.connect()
                departments = [
                    r[0]
                    for r in con.execute(
                        "SELECT DISTINCT department FROM sales ORDER BY department"
                    ).fetchall()
                ]
                con.close()
            # Process the default map area first so it becomes usable sooner.
            departments.sort(key=lambda d: (d != "16", d))
            for department in departments:
                try:
                    geocode_department(department, progress)
                except Exception as exc:
                    errors.append(f"{department}: {exc}")
                    progress(f"Incomplete parcel matching · {department}: {exc}")
        result = {
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "snapshot": snapshot["captured_at"],
            "geocoded": geocode,
            "errors": errors,
        }
        atomic_json(root() / "sync-result.json", result)
        if errors:
            raise RuntimeError(
                "Archives and sales imported; resume parcel matching for: "
                + " ; ".join(errors)
            )
        progress("Nationwide sync complete. Previous archives preserved.")
        return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--no-geocode", action="store_true")
    args = p.parse_args()
    sync_all(geocode=not args.no_geocode)
