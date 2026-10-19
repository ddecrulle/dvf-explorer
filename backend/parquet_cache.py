"""Bounded local cache of immutable, checksummed geographic partitions."""

import hashlib
import os
import re
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx

import store
from object_store import child, s3_client

_guard = threading.RLock()
_locks = {}
_active = {}
_verified = {}


def valid(path, item):
    if not path.exists() or path.stat().st_size != item["bytes"]:
        return False
    stamp = (path.stat().st_mtime_ns, item["sha256"])
    with _guard:
        if _verified.get(str(path)) == stamp:
            return True
    with path.open("rb") as f:
        matches = hashlib.file_digest(f, "sha256").hexdigest() == item["sha256"]
    if matches:
        with _guard:
            _verified[str(path)] = stamp
    return matches


def fetch(url, path):
    parsed = urlparse(url)
    if parsed.scheme == "s3":
        response = s3_client().get_object(
            Bucket=parsed.netloc, Key=parsed.path.lstrip("/")
        )
        with response["Body"] as body, path.open("wb") as out:
            while block := body.read(1024 * 1024):
                out.write(block)
    else:
        with httpx.stream("GET", url, timeout=90, follow_redirects=True) as response:
            response.raise_for_status()
            with path.open("wb") as out:
                for block in response.iter_bytes(1024 * 1024):
                    out.write(block)


@contextmanager
def partitions(current, files):
    if not current["root"].startswith(("s3://", "http://", "https://")):
        yield [child(current["root"], f["path"]) for f in files]
        return
    directory = store.DATA / "cache" / "parquet"
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for item in files:
        if not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
            raise ValueError("Invalid Parquet checksum")
        paths.append(directory / (item["sha256"] + ".parquet"))
    with _guard:
        for path in paths:
            _active[path] = _active.get(path, 0) + 1

    def resolve(pair):
        item, path = pair
        # A locally prepared copy of this exact release avoids the first download.
        local = Path(child(str(store.DATA / "published"), item["path"]))
        if valid(local, item):
            return str(local)
        with _guard:
            lock = _locks.setdefault(path, threading.Lock())
        with lock:
            if not valid(path, item):
                with tempfile.NamedTemporaryFile(
                    dir=directory, suffix=".part", delete=False
                ) as f:
                    temporary = Path(f.name)
                try:
                    fetch(child(current["root"], item["path"]), temporary)
                    if not valid(temporary, item):
                        raise ValueError("Downloaded Parquet checksum mismatch")
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
                    with _guard:
                        _verified.pop(str(temporary), None)
            os.utime(path, None)
            with _guard:
                _verified[str(path)] = (path.stat().st_mtime_ns, item["sha256"])
            return str(path)

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            resolved = list(pool.map(resolve, zip(files, paths)))
        yield resolved
    finally:
        with _guard:
            for path in paths:
                _active[path] -= 1
                if not _active[path]:
                    del _active[path]
            budget = int(os.environ.get("DVF_CACHE_MB", "512")) * 1024 * 1024
            cached = sorted(
                directory.glob("*.parquet"), key=lambda p: p.stat().st_mtime_ns
            )
            size = sum(p.stat().st_size for p in cached)
            for path in cached:
                if size <= budget:
                    break
                if path not in _active:
                    size -= path.stat().st_size
                    path.unlink()
                    _verified.pop(str(path), None)
