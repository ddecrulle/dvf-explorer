"""Read one immutable Parquet release per request, without importing a database."""

import os
import re
import threading
import time
from contextlib import contextmanager

import duckdb

from object_store import child, read_json
from parquet_cache import partitions

_cache = {}
_lock = threading.Lock()
DEFAULT_URL = (
    "https://minio.lab.sspcloud.fr/ddecrulle/DVF_Explorer/curated/current.json"
)


def location():
    from store import DATA

    local = DATA / "published" / "current.json"
    configured = os.environ.get("DVF_DATASET_URL", "").strip()
    if configured == "local":
        return ""
    return configured or (str(local) if local.exists() else DEFAULT_URL)


def snapshot(release=None):
    url = location()
    if not url:
        return None
    if release is not None and not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", release
    ):
        raise ValueError("Invalid dataset release")
    key = (url, release)
    with _lock:
        cached = _cache.get(key)
        if cached and (release or time.monotonic() - cached[0] < 60):
            return cached[1]
        root = url.rsplit("/", 1)[0]
        pointer = (
            {"release": release, "manifest": f"releases/{release}/manifest.json"}
            if release
            else read_json(url)
        )
        manifest = read_json(child(root, pointer["manifest"]))
        if manifest.get("schema_version") != 1 or manifest.get(
            "release"
        ) != pointer.get("release"):
            raise ValueError("Unsupported or inconsistent dataset manifest")
        files = manifest.get("files", [])
        if not files or sum(f["rows"] for f in files) != manifest.get("rows"):
            raise ValueError("Empty or inconsistent dataset manifest")
        for f in files:
            child(root, f["path"])
            if not f["path"].endswith(".parquet"):
                raise ValueError("Expected a Parquet partition")
        result = dict(manifest, root=root)
        if len(_cache) >= 32:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic(), result)
        return result


@contextmanager
def query_connection(year=0, bounds=None, release=None, department=None):
    current = snapshot(release)
    if current is None:
        from store import LOCK, connect

        with LOCK:
            con = connect()
            try:
                yield con
            finally:
                con.close()
        return
    con = duckdb.connect(
        config={
            "memory_limit": os.environ.get("DVF_MEMORY_LIMIT", "2GB"),
            "threads": int(os.environ.get("DVF_THREADS", "2")),
        }
    )
    try:

        def intersects(file):
            if bounds is None or "bounds" not in file:
                return True
            box = file["bounds"]
            if any(v is None for v in box):
                return False
            return (
                box[0] <= bounds[2]
                and box[2] >= bounds[0]
                and box[1] <= bounds[3]
                and box[3] >= bounds[1]
            )

        files = [
            f
            for f in current["files"]
            if (not year or f["year"] == year)
            and (department is None or f["department"] == department)
            and intersects(f)
        ]
        # Keep all intersecting departments: coordinate statistics prune row groups.
        if not files:
            from store import create_schema

            create_schema(con)
            yield con
        else:
            with partitions(current, files) as paths:
                con.read_parquet(paths, hive_partitioning=False).create_view("sales")
                yield con
    finally:
        con.close()
