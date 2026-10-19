"""Export a consistent database snapshot and publish immutable Parquet releases."""

import argparse
import hashlib
import json
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import duckdb
import httpx

from archive import atomic_json
from object_store import child, read_json, s3_client
from store import records


def digest(path):
    with Path(path).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def export(database, output, source="DVF+ Cerema"):
    output = Path(output).resolve()
    release = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + uuid.uuid4().hex[:12]
    )
    prefix = f"releases/{release}"
    destination = output / prefix
    destination.mkdir(parents=True, exist_ok=False)
    con = duckdb.connect(
        str(database), read_only=True, config={"memory_limit": "2GB", "threads": 2}
    )
    try:
        con.execute("BEGIN TRANSACTION")
        total, distinct, invalid = con.execute(
            "SELECT count(*),count(DISTINCT id),count(*) FILTER (WHERE price<=0 OR price IS NULL "
            "OR date IS NULL OR year<>extract(year FROM date) "
            "OR (longitude IS NULL)<>(latitude IS NULL) "
            "OR NOT isfinite(price) OR NOT isfinite(longitude) OR NOT isfinite(latitude) "
            "OR longitude NOT BETWEEN -180 AND 180 OR latitude NOT BETWEEN -85 AND 85) FROM sales"
        ).fetchone()
        if not total or distinct != total or invalid:
            raise ValueError("Cannot publish empty, duplicate or invalid sales")
        imports = records(
            con,
            "SELECT department,year,count(*) AS count,"
            "count(longitude) AS located, min(longitude) AS west,min(latitude) AS south,"
            "max(longitude) AS east,max(latitude) AS north "
            "FROM sales GROUP BY department,year ORDER BY year DESC,department",
        )
        for item in imports:
            dep, year = item["department"], item["year"]
            if not dep or not dep.isalnum() or not 2010 <= year <= 2100:
                raise ValueError("Invalid partition key")
        # One scan and sort for the whole release, rather than rescanning the
        # national table separately for every year/department combination.
        con.sql(
            "SELECT * FROM sales ORDER BY year,department,longitude,latitude,id"
        ).write_parquet(
            str(destination),
            compression="zstd",
            row_group_size=16384,
            partition_by=["year", "department"],
            write_partition_columns=True,
            filename_pattern="sales_{i}",
        )
        files = []
        for item in imports:
            dep, year = item["department"], item["year"]
            partition_rows = 0
            for target in sorted(
                (destination / f"year={year}" / f"department={dep}").glob("*.parquet")
            ):
                actual = con.execute(
                    "SELECT count(*) FROM read_parquet(?)", [str(target)]
                ).fetchone()[0]
                partition_rows += actual
                files.append(
                    dict(
                        path=target.relative_to(output).as_posix(),
                        rows=actual,
                        bytes=target.stat().st_size,
                        sha256=digest(target),
                        year=year,
                        department=dep,
                        bounds=[item[k] for k in ("west", "south", "east", "north")],
                    )
                )
            if partition_rows != item["count"]:
                raise ValueError("Parquet row count mismatch")
        manifest = dict(
            schema_version=1,
            release=release,
            source=source,
            created_at=datetime.now(timezone.utc).isoformat(),
            rows=total,
            imports=[
                {k: i[k] for k in ("department", "year", "count", "located")}
                for i in imports
            ],
            files=files,
        )
        if con.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_name='dvfplus_sources'"
        ).fetchone()[0]:
            manifest["inputs"] = json.loads(
                json.dumps(
                    records(con, "SELECT * FROM dvfplus_sources ORDER BY department"),
                    default=str,
                )
            )
        atomic_json(destination / "manifest.json", manifest)
        pointer = dict(release=release, manifest=f"{prefix}/manifest.json")
        # Local readers also switch only after all files have been validated.
        atomic_json(output / "current.json", pointer)
        return pointer
    finally:
        con.close()


class PostUploader:
    """Consume an Onyxia upload link from a private local file, never from argv."""

    def __init__(self, path):
        text = Path(path).read_text().strip()
        self.post = (
            json.loads(parse_qs(urlparse(text).query)["presignedPost"][0])
            if text.startswith("https://")
            else json.loads(text)
        )
        if (
            self.post["fields"].get("key") != "DVF_Explorer/${filename}"
            or self.post["url"] != "https://minio.lab.sspcloud.fr/ddecrulle"
        ):
            raise ValueError(
                "Upload link must target the authorized DVF_Explorer prefix"
            )

    def put(self, relative, path):
        self.put_key("DVF_Explorer/curated/" + relative, path)

    def put_key(self, key, path):
        child("authorized", key)
        if not key.startswith("DVF_Explorer/"):
            raise ValueError("Object is outside the authorized prefix")
        fields = dict(self.post["fields"])
        fields["key"] = key
        with Path(path).open("rb") as f:
            response = httpx.post(
                self.post["url"],
                data=fields,
                files={"file": (Path(path).name, f, "application/octet-stream")},
                timeout=180,
            )
        if response.status_code not in (200, 201, 204):
            # Do not print a signed request, token or response body.
            raise RuntimeError(f"S3 upload failed (HTTP {response.status_code})")


def upload(output, pointer, destination, post=None, activate=False):
    output = Path(output)
    manifest = read_json(str(output / pointer["manifest"]))
    parsed = urlparse(destination)
    if parsed.scheme != "s3":
        raise ValueError("Publication destination must be an S3 prefix")
    client = None if post else s3_client()
    previous_etag = None
    if activate and client:
        from botocore.exceptions import ClientError

        try:
            previous_etag = client.head_object(
                Bucket=parsed.netloc, Key=child(parsed.path.lstrip("/"), "current.json")
            )["ETag"]
        except ClientError as exc:
            if exc.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
                raise

    def put(relative):
        path = Path(child(str(output), relative))
        if post:
            if destination.rstrip("/") != "s3://ddecrulle/DVF_Explorer/curated":
                raise ValueError(
                    "Upload destination differs from the authorized prefix"
                )
            post.put(relative, path)
        else:
            key = child(parsed.path.lstrip("/"), relative)
            # Single PUT supports conditional publication and server-side checksum validation.
            with path.open("rb") as f:
                client.put_object(Bucket=parsed.netloc, Key=key, Body=f)

    def upload_partition(item):
        if digest(output / item["path"]) != item["sha256"]:
            raise ValueError("Partition checksum mismatch")
        put(item["path"])

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(upload_partition, manifest["files"]))
    put(pointer["manifest"])
    if activate:
        # Upload authorization alone is not proof of read access. Require a full
        # remote read/count before advancing the shared pointer.
        con = duckdb.connect()
        try:
            from object_store import configure_duckdb

            configure_duckdb(con)
            paths = [child(destination, f["path"]) for f in manifest["files"]]
            actual = con.execute(
                "SELECT count(*) FROM read_parquet(?)", [paths]
            ).fetchone()[0]
            remote = read_json(child(destination, pointer["manifest"]))
            if actual != manifest["rows"] or remote != manifest:
                raise ValueError("Remote publication validation failed")
        finally:
            con.close()
        # POST links cannot perform compare-and-swap; use one publisher only.
        if post:
            with tempfile.TemporaryDirectory() as tmp:
                pointer_file = Path(tmp) / "current.json"
                atomic_json(pointer_file, pointer)
                post.put("current.json", pointer_file)
        else:
            condition = (
                {"IfMatch": previous_etag} if previous_etag else {"IfNoneMatch": "*"}
            )
            client.put_object(
                Bucket=parsed.netloc,
                Key=child(parsed.path.lstrip("/"), "current.json"),
                Body=json.dumps(pointer).encode(),
                ContentType="application/json",
                **condition,
            )
    return manifest


def archive_sources(directory, destination, post=None):
    """Keep immutable raw DVF+ ZIPs alongside curated releases for replay."""
    parsed = urlparse(destination)
    if parsed.scheme != "s3" or not parsed.path.rstrip("/").endswith("/curated"):
        raise ValueError("Expected an S3 destination ending in /curated")
    prefix = parsed.path.strip("/").rsplit("/", 1)[0]
    client = None if post else s3_client()
    for path in sorted(Path(directory).glob("*.zip")):
        key = child(prefix, "raw/dvfplus/" + digest(path) + ".zip")
        print("Archiving " + path.name, flush=True)
        if post:
            post.put_key(key, path)
        else:
            client.upload_file(str(path), parsed.netloc, key)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--output", type=Path, default=Path("data/published"))
    p.add_argument("--source", default="DVF+ Cerema")
    p.add_argument(
        "--destination", help="S3 prefix, e.g. s3://ddecrulle/DVF_Explorer/curated"
    )
    p.add_argument(
        "--post-file",
        type=Path,
        help="Private file containing the temporary upload URL or POST JSON",
    )
    p.add_argument(
        "--activate",
        action="store_true",
        help="Verify remote reads before replacing current.json; single publisher only",
    )
    args = p.parse_args()
    pointer = export(args.database, args.output, args.source)
    print("Local release ready:", pointer["release"], flush=True)
    if args.destination:
        result = upload(
            args.output,
            pointer,
            args.destination,
            PostUploader(args.post_file) if args.post_file else None,
            args.activate,
        )
        print(
            f"Uploaded {result['rows']:,} sales. "
            + (
                "Remote release activated."
                if args.activate
                else "Activation pending read validation."
            )
        )
