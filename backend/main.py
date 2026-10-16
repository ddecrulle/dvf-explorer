import json
import math
import os
import secrets
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import date
from urllib.parse import urlparse

import httpx
import store
from archive import atomic_json
from archive import root as archive_root
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from ingest import import_data
from national import initialise
from pydantic import BaseModel, Field
from store import LOCK, ROOT, connect, records
from sync import sync_all


@asynccontextmanager
async def lifespan(app):
    with LOCK:
        con = connect()
        initialise(con)
        con.close()
    saved = store.DATA / "job.json"
    if saved.exists():
        previous = json.loads(saved.read_text())
        if previous.get("state") == "running":
            previous.update(
                state="interrupted",
                message="Sync interrupted. Start it again to resume.",
            )
        job.update(previous)
    yield


app = FastAPI(title="DVF Explorer", lifespan=lifespan)
job = {"state": "idle", "message": ""}
job_lock = threading.Lock()


@app.get("/api/status")
def status():
    with LOCK:
        con = connect()
        try:
            imports = records(
                con, "SELECT * FROM imports ORDER BY year DESC, department"
            )
        finally:
            con.close()
    with job_lock:
        task = dict(job)
    latest = archive_root() / "latest.json"
    snapshot = json.loads(latest.read_text()) if latest.exists() else {}
    archived = snapshot.get("resources", [])
    return {
        "imports": imports,
        "job": task,
        "years": sorted({i["year"] for i in imports}, reverse=True),
        "archive": {
            "captured_at": snapshot.get("captured_at"),
            "files": len(archived),
            "bytes": sum(r["bytes"] for r in archived),
            "years": sorted({r["resource"]["year"] for r in archived}, reverse=True),
        },
        "admin_token_required": bool(os.environ.get("DVF_ADMIN_TOKEN")),
    }


@app.get("/api/search")
async def search(q: str = Query(min_length=3, max_length=200)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://data.geopf.fr/geocodage/search", params={"q": q, "limit": 6}
            )
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "The IGN search service is temporarily unavailable.")


@app.get("/api/sales")
def sales(
    lon: float = Query(default=0.148008, ge=-180, le=180),
    lat: float = Query(default=45.644105, ge=-85, le=85),
    radius: float = Query(default=3, ge=0.2, le=30),
    year: int = Query(default=0, ge=0, le=2100),
    kind: str = "",
    price_min: float = Query(default=0, ge=0),
    price_max: float = Query(default=100000000, ge=0),
    start: date | None = None,
    end: date | None = None,
):
    if price_max < price_min or (start and end and start > end):
        raise HTTPException(422, "Invalid filter bounds.")
    where = "price BETWEEN ? AND ? AND longitude IS NOT NULL"
    params = [price_min, price_max]
    if year:
        where += " AND year=?"
        params.append(year)
    if kind:
        where += " AND kind=?"
        params.append(kind)
    if start:
        where += " AND date>=?"
        params.append(start)
    if end:
        where += " AND date<=?"
        params.append(end)
    # Apply a bounding box first, then great-circle distance for the exact radius.
    where += " AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?"
    delta = radius / 110
    dx = delta / max(0.01, math.cos(math.radians(lat)))
    params.extend([lat - delta, lat + delta, lon - dx, lon + dx])
    # Compute statistics in DuckDB without loading all matching sales into Python.
    cte = (
        """WITH candidates AS (SELECT * FROM sales WHERE """
        + where
        + """), measured AS (
        SELECT *,6371*2*asin(sqrt(least(1.0,
        pow(sin(radians(latitude-?)/2),2)+cos(radians(?))*cos(radians(latitude))*
        pow(sin(radians(longitude-?)/2),2)))) AS distance FROM candidates),
        nearby AS (SELECT * FROM measured WHERE distance<=?) """
    )
    params.extend([lat, lat, lon, radius])
    simple = "NOT multi AND surface>0 AND kind IN ('Maison','Appartement')"
    with LOCK:
        con = connect()
        try:
            stats = records(
                con,
                cte
                + "SELECT count(*) AS total,median(price) AS median_price,"
                + "median(price/surface) FILTER (WHERE "
                + simple
                + ") AS median_sqm,"
                + "count(*) FILTER (WHERE "
                + simple
                + ") AS sqm_count FROM nearby",
                params,
            )[0]
            rows = records(
                con,
                cte + "SELECT * FROM nearby ORDER BY date DESC,id DESC LIMIT 3000",
                params,
            )
        finally:
            con.close()
    rows = [
        dict(r, distance=round(r["distance"], 3), parcels=json.loads(r["parcels"]))
        for r in rows
    ]
    return dict(stats, sales=rows, truncated=stats["total"] > 3000)


class ImportRequest(BaseModel):
    department: str = Field(pattern=r"^(\d{2}|2[AB]|97\d)$")
    year: int = Field(ge=2014, le=2100)


def require_admin(request: Request):
    token = os.environ.get("DVF_ADMIN_TOKEN")
    if token:
        if not secrets.compare_digest(request.headers.get("X-Admin-Token", ""), token):
            raise HTTPException(401, "Administration token required.")
    else:
        if request.client.host not in ("127.0.0.1", "::1", "testclient"):
            raise HTTPException(403, "Configure DVF_ADMIN_TOKEN for remote operations.")
        origin = request.headers.get("origin")
        if origin and urlparse(origin).hostname not in (
            "127.0.0.1",
            "localhost",
            "::1",
        ):
            raise HTTPException(403, "Origin not allowed.")


def launch(operation):
    with job_lock:
        if job["state"] == "running":
            raise HTTPException(409, "An import is already running.")
        job.update(state="running", message="Preparing…", id=uuid.uuid4().hex)
        atomic_json(store.DATA / "job.json", job)
        task_id = job["id"]

    def update(**values):
        with job_lock:
            job.update(values)
            atomic_json(store.DATA / "job.json", job)

    def run():
        try:
            operation(lambda message: update(message=message))
            update(state="done")
        except Exception as exc:
            update(state="error", message=f"Import interrupted: {exc}")

    threading.Thread(target=run, daemon=True).start()
    return {"id": task_id, "message": "Import started"}


@app.post("/api/import", status_code=202, dependencies=[Depends(require_admin)])
def start_import(request: ImportRequest):
    return launch(
        lambda progress: import_data(request.department, request.year, progress)
    )


@app.post("/api/sync", status_code=202, dependencies=[Depends(require_admin)])
def start_sync():
    return launch(lambda progress: sync_all(progress))


@app.get("/api/health")
def health():
    return {"status": "ok"}


DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(
            DIST / "index.html", headers={"X-Robots-Tag": "noindex, nofollow"}
        )
