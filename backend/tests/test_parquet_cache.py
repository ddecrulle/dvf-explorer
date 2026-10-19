import hashlib
import io

import pytest

import parquet_cache
import store


def test_s3_download_accepts_standard_response_stream(tmp_path, monkeypatch):
    class Client:
        def get_object(self, **kwargs):
            assert kwargs == {"Bucket": "bucket", "Key": "part.parquet"}
            return {"Body": io.BytesIO(b"partition bytes")}

    monkeypatch.setattr(parquet_cache, "s3_client", lambda: Client())
    path = tmp_path / "part.parquet"
    parquet_cache.fetch("s3://bucket/part.parquet", path)
    assert path.read_bytes() == b"partition bytes"


def test_partition_download_is_reused_and_corruption_is_repaired(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    data = b"immutable partition"
    item = dict(
        path="releases/test/data.parquet",
        bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    requests = []

    def fetch(url, target):
        requests.append(url)
        target.write_bytes(data)

    monkeypatch.setattr(parquet_cache, "fetch", fetch)
    current = dict(root="https://example.test/curated")
    for _ in range(2):
        with parquet_cache.partitions(current, [item]) as paths:
            from pathlib import Path

            assert Path(paths[0]).read_bytes() == data
    assert len(requests) == 1
    Path(paths[0]).write_bytes(b"corrupted partition")
    with parquet_cache.partitions(current, [item]) as paths:
        assert Path(paths[0]).read_bytes() == data
    assert len(requests) == 2


def test_bad_download_never_enters_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(
        parquet_cache, "fetch", lambda url, path: path.write_bytes(b"bad")
    )
    item = dict(path="data.parquet", bytes=3, sha256="0" * 64)
    with pytest.raises(ValueError, match="checksum"):
        with parquet_cache.partitions(dict(root="https://example.test"), [item]):
            pytest.fail("Invalid partition was exposed")
    assert not list((tmp_path / "cache/parquet").glob("*.parquet"))


def test_eviction_waits_for_active_query(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setenv("DVF_CACHE_MB", "0")
    data = b"partition"
    monkeypatch.setattr(
        parquet_cache, "fetch", lambda url, path: path.write_bytes(data)
    )
    item = dict(
        path="data.parquet", bytes=len(data), sha256=hashlib.sha256(data).hexdigest()
    )
    from pathlib import Path

    with parquet_cache.partitions(dict(root="https://example.test"), [item]) as paths:
        assert Path(paths[0]).exists()
        with parquet_cache.partitions(dict(root="https://example.test"), [item]):
            pass
        assert Path(paths[0]).exists()
    assert not Path(paths[0]).exists()
