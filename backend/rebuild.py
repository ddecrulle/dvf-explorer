"""Offline rebuild from snapshots; requires an empty database and a stopped server."""

import json

import store
from archive import root
from national import import_snapshot
from sync import writer_lock


def rebuild(progress=print):
    with writer_lock():
        with store.LOCK:
            con = store.connect()
            count = con.execute("SELECT count(*) FROM sales").fetchone()[0]
            con.close()
        if count:
            raise RuntimeError(
                "Rebuild requires an empty database. Use a new DVF_DATA_DIR."
            )
        snapshots = sorted((root() / "snapshots").glob("*.json"))
        if not snapshots:
            raise RuntimeError("No archived snapshots found.")
        for path in snapshots:
            snapshot = json.loads(path.read_text())
            for record in snapshot["resources"]:
                import_snapshot(record, progress)
        progress("Database rebuilt from archives. Run parcel matching separately.")


if __name__ == "__main__":
    rebuild()
