"""Small object I/O layer. Credentials stay in the server's AWS provider chain."""

import json
import os
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import httpx


def endpoint():
    return os.environ.get("DVF_S3_ENDPOINT", "https://minio.lab.sspcloud.fr")


def anonymous():
    return os.environ.get("DVF_S3_ANONYMOUS", "false").lower() == "true"


def s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint(),
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
        config=Config(
            signature_version=UNSIGNED if anonymous() else "s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def child(root, path):
    """Only allow relative object keys within the configured dataset prefix."""
    if (
        not isinstance(path, str)
        or not path
        or path.startswith("/")
        or any(p in ("", ".", "..") for p in path.split("/"))
        or any(c in path for c in (":", "\\", "?", "#", "*", "[", "]", "%"))
    ):
        raise ValueError("Invalid dataset object path")
    return root.rstrip("/") + "/" + str(PurePosixPath(path))


def read_json(url):
    parsed = urlparse(url)
    if parsed.scheme == "s3":
        response = s3_client().get_object(
            Bucket=parsed.netloc, Key=parsed.path.lstrip("/")
        )
        with response["Body"] as body:
            return json.load(body)
    if parsed.scheme in ("https", "http"):
        response = httpx.get(url, timeout=30, follow_redirects=True)
        response.raise_for_status()
        return response.json()
    if parsed.scheme:
        raise ValueError("Use a filesystem path, HTTPS URL or S3 URI")
    return json.loads(Path(url).read_text())


def load_httpfs(con):
    import duckdb

    if os.environ.get("DVF_EXTENSION_DIR"):
        con.execute("SET extension_directory = ?", [os.environ["DVF_EXTENSION_DIR"]])
    try:
        con.execute("LOAD httpfs")
    except duckdb.IOException as exc:
        if "not found" not in str(exc).lower():
            raise
        con.execute("INSTALL httpfs FROM core")
        con.execute("LOAD httpfs")


def configure_duckdb(con):
    """Load httpfs and share the same renewable credential chain as boto3."""
    import boto3

    load_httpfs(con)
    parsed = urlparse(endpoint())
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise ValueError("DVF_S3_ENDPOINT must be an HTTP(S) endpoint")
    settings = {
        "REGION": os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
        "ENDPOINT": parsed.netloc,
        "URL_STYLE": "path",
    }
    if not anonymous():
        credentials = boto3.Session().get_credentials()
        if credentials is None:
            raise ValueError("S3 read credentials are missing")
        frozen = credentials.get_frozen_credentials()
        settings.update(KEY_ID=frozen.access_key, SECRET=frozen.secret_key)
        if frozen.token:
            settings["SESSION_TOKEN"] = frozen.token
    else:
        settings.update(KEY_ID="", SECRET="")
    # Secret DDL does not accept bind parameters; escape every literal.
    clauses = [
        f"{k} '{str(v).replace(chr(39), chr(39) * 2)}'" for k, v in settings.items()
    ]
    clauses.append("USE_SSL " + ("true" if parsed.scheme == "https" else "false"))
    con.execute("CREATE SECRET dataset_s3 (TYPE S3, " + ", ".join(clauses) + ")")
