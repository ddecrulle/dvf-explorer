import json
import math
import re
import os
import secrets
import threading
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import store
import dataset
import parcels
import dpe
import bdnb
import addresses
import search_geometry
from archive import atomic_json
from archive import root as archive_root
from campaign import check_campaign
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
    if not dataset.location():
        with LOCK:
            con = connect()
            initialise(con)
            con.close()
    saved = store.DATA / "job.json"
    if saved.exists() and not dataset.location():
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


def published_snapshot():
    try:
        return dataset.snapshot()
    except Exception:
        raise HTTPException(
            503, "Published sales are unavailable. Check dataset access on the server."
        )


@app.get("/api/status")
def status():
    current = published_snapshot()
    if current:
        imports = current["imports"]
        return {
            "imports": imports,
            "years": sorted({i["year"] for i in imports}, reverse=True),
            "job": {
                "state": "idle",
                "message": "Published sales are ready to explore.",
            },
            "dataset": {
                "mode": "published",
                "release": current["release"],
                "source": current["source"],
                "created_at": current["created_at"],
                "rows": current["rows"],
            },
            "admin_token_required": False,
        }
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
        "dataset": {"mode": "local", "source": "DGFiP DVF"},
    }


class AddressLookup(BaseModel):
    parcels: list[str] = Field(min_length=1, max_length=3001)


@app.post("/api/parcel-addresses")
def parcel_addresses(body: AddressLookup):
    if any(not re.fullmatch(parcels.PARCEL_PATTERN, p) for p in body.parcels):
        raise HTTPException(422, "Invalid cadastral parcel reference.")
    if len({addresses.department(p) for p in body.parcels}) > 6:
        raise HTTPException(422, "Too many departments in one address lookup.")
    return addresses.lookup(body.parcels)


@app.get("/api/search")
async def search(q: str = Query(min_length=3, max_length=200)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://data.geopf.fr/geocodage/search", params={"q": q, "limit": 6}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError, ValueError:
        raise HTTPException(502, "The IGN search service is temporarily unavailable.")


@app.get("/api/search/geometry")
async def search_outline(
    kind: str = Query(pattern="^(municipality|street)$"),
    citycode: str = Query(pattern="^[0-9A-Z]{5}$"),
    street_id: str = Query(default="", max_length=80, pattern="^[a-zA-Z0-9_]*$"),
):
    if kind == "street" and not street_id.startswith(citycode + "_"):
        raise HTTPException(
            422, "A BAN street identifier in the selected commune is required."
        )
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            return await search_geometry.lookup(kind, citycode, street_id, client)
    except httpx.HTTPError, ValueError, KeyError, TypeError:
        raise HTTPException(502, "The geographic outline is temporarily unavailable.")


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
    west: float | None = Query(default=None, ge=-180, le=180),
    south: float | None = Query(default=None, ge=-85, le=85),
    east: float | None = Query(default=None, ge=-180, le=180),
    north: float | None = Query(default=None, ge=-85, le=85),
    release: str | None = Query(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$"
    ),
    zoom: int = Query(default=13, ge=0, le=22),
):
    if price_max < price_min or (start and end and start > end):
        raise HTTPException(422, "Invalid filter bounds.")
    viewport = any(v is not None for v in (west, south, east, north))
    if viewport:
        if (
            any(v is None for v in (west, south, east, north))
            or west >= east
            or south >= north
        ):
            raise HTTPException(422, "Provide a valid complete map extent.")
        if east - west > 1.5 or north - south > 1:
            raise HTTPException(422, "Zoom in to explore individual sales.")
        lon, lat = (west + east) / 2, (south + north) / 2
    else:
        delta = radius / 110
        dx = delta / max(0.01, math.cos(math.radians(lat)))
        west, south, east, north = lon - dx, lat - delta, lon + dx, lat + delta
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
    params.extend([south, north, west, east])
    # Compute statistics in DuckDB without loading all matching sales into Python.
    cte = (
        """WITH candidates AS (SELECT * FROM sales WHERE """
        + where
        + """), measured AS (
        SELECT *,6371*2*asin(sqrt(least(1.0,
        pow(sin(radians(latitude-?)/2),2)+cos(radians(?))*cos(radians(latitude))*
        pow(sin(radians(longitude-?)/2),2)))) AS distance FROM candidates),
        nearby AS (SELECT * FROM measured """
        + ("" if viewport else "WHERE distance<=?")
        + ") "
    )
    params.extend([lat, lat, lon])
    if not viewport:
        params.append(radius)
    simple = "NOT multi AND surface>0 AND kind IN ('Maison','Appartement')"
    try:
        with dataset.query_connection(year, (west, south, east, north), release) as con:
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
            clusters = []
            if viewport and stats["total"] > 3000:
                # Fixed Web Mercator cells keep dense views complete without
                # transferring every transaction. Groups represent all matches.
                grid = (2**zoom) * 512 / 48
                clusters = records(
                    con,
                    cte + "SELECT avg(longitude) AS longitude,"
                    "avg(latitude) AS latitude,count(*) AS count FROM nearby "
                    "GROUP BY floor((longitude+180)/360*?),"
                    "floor((1-ln(tan(pi()/4+radians(latitude)/2))/pi())/2*?)",
                    params + [grid, grid],
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            503, "Sales could not be loaded. Check dataset access on the server."
        )
    rows = [
        dict(r, distance=round(r["distance"], 3), parcels=json.loads(r["parcels"]))
        for r in rows
    ]
    return dict(stats, sales=rows, clusters=clusters, truncated=stats["total"] > 3000)


@app.get("/api/parcels")
def explore_parcels(
    west: float = Query(ge=-180, le=180),
    south: float = Query(ge=-85, le=85),
    east: float = Query(ge=-180, le=180),
    north: float = Query(ge=-85, le=85),
    zoom: int = Query(default=13, ge=0, le=22),
    year: int = Query(default=0, ge=0, le=2100),
    kind: str = "",
    price_min: float = Query(default=0, ge=0),
    price_max: float = Query(default=100000000, ge=0),
    start: date | None = None,
    end: date | None = None,
    release: str | None = Query(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$"
    ),
):
    if (
        west >= east
        or south >= north
        or price_min > price_max
        or (start and end and start > end)
    ):
        raise HTTPException(422, "Invalid filter bounds.")
    if east - west > 1.5 or north - south > 1:
        raise HTTPException(422, "Zoom in to explore individual sales.")
    try:
        return parcels.explore(
            west,
            south,
            east,
            north,
            zoom,
            year,
            kind,
            price_min,
            price_max,
            start,
            end,
            release,
        )
    except Exception:
        raise HTTPException(
            503, "Sales could not be loaded. Check dataset access on the server."
        )


@app.get("/api/parcels/{parcel}/mutations")
def parcel_mutations(
    parcel: str,
    offset: int = Query(default=0, ge=0, le=1000000),
    release: str | None = Query(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$"
    ),
):
    if not re.fullmatch(parcels.PARCEL_PATTERN, parcel):
        raise HTTPException(422, "Invalid cadastral identifier.")
    try:
        return parcels.history(parcel, release, offset)
    except Exception:
        raise HTTPException(
            503, "Sales could not be loaded. Check dataset access on the server."
        )


@app.get("/api/parcels/{parcel}/bdnb")
def parcel_bdnb(parcel: str):
    if not re.fullmatch(dpe.PARCEL_PATTERN, parcel):
        raise HTTPException(422, "Invalid cadastral identifier.")
    try:
        return bdnb.lookup(parcel)
    except bdnb.UpstreamError:
        raise HTTPException(502, "BDNB is temporarily unavailable.")


@app.get("/api/parcels/{parcel}/dpe")
def parcel_dpe(
    parcel: str,
    at: date,
    kind: str = Query(default="", max_length=80),
    surface: float | None = Query(default=None, gt=0, le=1000000, allow_inf_nan=False),
    simple: bool = False,
    release: str | None = Query(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$"
    ),
):
    if not re.fullmatch(dpe.PARCEL_PATTERN, parcel):
        raise HTTPException(422, "Invalid cadastral identifier.")
    if at > date.today():
        raise HTTPException(422, "The sale date must not be in the future.")
    try:
        evidence = (
            dpe.parcel_diagnostics(parcel, at, release)
            if release
            else dpe.parcel_diagnostics(parcel, at)
        )
        return dpe.match_sale(evidence, kind, surface, simple)
    except dpe.UpstreamError:
        raise HTTPException(502, "DPE services are temporarily unavailable.")


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
    if dataset.location():
        raise HTTPException(
            409,
            "This application reads published sales. Run the separate publication worker to update them.",
        )
    return launch(
        lambda progress: import_data(request.department, request.year, progress)
    )


@app.post("/api/sync", status_code=202, dependencies=[Depends(require_admin)])
def start_sync(scheduled: bool = False):
    if dataset.location():
        raise HTTPException(
            409,
            "This application reads published sales. Run the separate publication worker to update them.",
        )
    operation = check_campaign if scheduled else sync_all
    return launch(lambda progress: operation(progress))


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/ready")
def ready():
    published_snapshot()
    return {"status": "ok"}


DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(
            DIST / "index.html", headers={"X-Robots-Tag": "noindex, nofollow"}
        )
