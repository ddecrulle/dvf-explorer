"""Immutable archives and publication history, independent of DuckDB."""

import hashlib
import json
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import store

CATALOG = "https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres/"


def root():
    p = Path(os.environ.get("DVF_ARCHIVE_DIR", store.DATA / "archives"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, encoding="utf8"
    ) as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
        temporary = Path(f.name)
    temporary.replace(path)


def resources(catalog):
    result = []
    for r in catalog["resources"]:
        match = re.search(r"\b(20\d{2})\b", r.get("title", ""))
        if (
            match
            and "fonci" in r["title"].lower()
            and r["url"].lower().endswith(".zip")
        ):
            item = dict(r)
            item["year"] = int(match[1])
            result.append(item)
    if not result:
        raise ValueError("No recognised DVF files: stopping without changing data.")
    return sorted(result, key=lambda r: (r["year"], r["title"]), reverse=True)


def coverage(resource):
    year = resource["year"]
    title = resource["title"].lower()
    if "semestre" in title:
        if re.search(r"premier|1er|1ᵉʳ|s1", title):
            return f"{year}-01-01", f"{year}-06-30"
        if re.search(r"second|deuxième|2e|2ème|s2", title):
            return f"{year}-07-01", f"{year}-12-31"
        raise ValueError(f"Unrecognised coverage period: {title}")
    return f"{year}-01-01", f"{year}-12-31"


def archive_resource(resource, progress=print):
    """Content is addressed by SHA-256; previous versions are never overwritten."""
    base = root()
    (base / "objects").mkdir(exist_ok=True)
    (base / "resources").mkdir(exist_ok=True)
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                k: resource.get(k)
                for k in ("id", "url", "last_modified", "checksum", "title", "filesize")
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    manifest = base / "resources" / f"{fingerprint}.json"
    if manifest.exists():
        record = json.loads(manifest.read_text())
        path = base / record["path"]
        if path.exists() and digest(path) == record["sha256"]:
            return record
    progress(f"Archiving nationwide data · {resource['title']}")
    fd, name = tempfile.mkstemp(dir=base, suffix=".part")
    os.close(fd)
    temporary = Path(name)
    try:
        with httpx.stream(
            "GET", resource["url"], follow_redirects=True, timeout=180
        ) as response:
            response.raise_for_status()
            with temporary.open("wb") as output:
                for chunk in response.iter_bytes():
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        with zipfile.ZipFile(temporary) as z:
            if not any(n.lower().endswith(".txt") for n in z.namelist()) or z.testzip():
                raise ValueError("Invalid DVF archive")
        sha = digest(temporary)
        target = base / "objects" / f"{sha}.zip"
        if target.exists() and digest(target) != sha:
            raise ValueError("Existing archive is corrupt; restore a backup.")
        if not target.exists():
            temporary.replace(target)
        record = {
            "sha256": sha,
            "path": str(target.relative_to(base)),
            "bytes": target.stat().st_size,
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "resource": resource,
            "coverage": coverage(resource),
        }
        atomic_json(manifest, record)
        return record
    finally:
        temporary.unlink(missing_ok=True)


def capture(progress=print, catalog=None):
    if catalog is None:
        catalog = (
            httpx.get(CATALOG, follow_redirects=True, timeout=60)
            .raise_for_status()
            .json()
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    atomic_json(root() / "catalogs" / f"{stamp}.json", catalog)
    records = [archive_resource(r, progress) for r in resources(catalog)]
    snapshot = {"captured_at": stamp, "resources": records}
    atomic_json(root() / "snapshots" / f"{stamp}.json", snapshot)
    atomic_json(root() / "latest.json", snapshot)
    return snapshot
