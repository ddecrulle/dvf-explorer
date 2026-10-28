import os
import threading
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("DVF_DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)
LOCK = threading.RLock()
# Keep newly created worker/legacy databases readable by the previous runtime.
STORAGE_COMPATIBILITY = "v1.5.6"


def connect():
    con = duckdb.connect(
        str(DATA / "dvf.duckdb"),
        config={
            "storage_compatibility_version": STORAGE_COMPATIBILITY,
            "memory_limit": os.environ.get("DVF_MEMORY_LIMIT", "2GB"),
            "threads": int(os.environ.get("DVF_THREADS", "2")),
        },
    )
    create_schema(con)
    return con


def create_schema(con):
    con.execute("""CREATE TABLE IF NOT EXISTS sales (
        id VARCHAR PRIMARY KEY, date DATE, price DOUBLE, address VARCHAR, city VARCHAR,
        department VARCHAR, citycode VARCHAR, kind VARCHAR, surface DOUBLE, land DOUBLE,
        rooms INTEGER, longitude DOUBLE, latitude DOUBLE, parcels VARCHAR, row_count INTEGER,
        year INTEGER, source VARCHAR, multi BOOLEAN)""")
    con.execute("ALTER TABLE sales ADD COLUMN IF NOT EXISTS dependency_count INTEGER")
    con.execute("""CREATE TABLE IF NOT EXISTS imports (department VARCHAR, year INTEGER,
        count INTEGER, located INTEGER, source VARCHAR, imported_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY(department, year))""")


def records(con, sql, params=None):
    result = con.execute(sql, params or [])
    names = [c[0] for c in result.description]
    return [dict(zip(names, row)) for row in result.fetchall()]
