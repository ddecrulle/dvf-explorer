"""Run outside the web server: fetch DVF+, prepare sales, then publish a release."""

import argparse
import json
from datetime import date
from pathlib import Path

import httpx

from archive import atomic_json
from dvfplus import BOX, discover, download, prepare
from publish import PostUploader, archive_sources, export, upload


def update(args):
    workspace = args.workspace
    workspace.mkdir(parents=True, exist_ok=True)
    catalog_path = workspace / f"{args.publication}.json"
    # Discovery always checks the named upstream release. Downloaded ZIPs and
    # completed departmental conversions are reused after interruption.
    catalog = discover(args.publication)
    atomic_json(catalog_path, dict(publication=args.publication, files=catalog))
    cities_path = workspace / "communes.json"
    if not cities_path.exists():
        response = httpx.get(
            "https://geo.api.gouv.fr/communes",
            params={"fields": "code,nom", "format": "json"},
            timeout=60,
        )
        response.raise_for_status()
        atomic_json(cities_path, {c["code"]: c["nom"] for c in response.json()})
    cities = json.loads(cities_path.read_text())
    overseas_crs = (
        json.loads(args.overseas_crs.read_text()) if args.overseas_crs else {}
    )
    selected = [
        r
        for r in catalog
        if not args.regions or r["region"].split("_", 1)[0] in args.regions
    ]
    if not selected:
        raise ValueError("No regions selected")
    # Default map area first; a successful complete run publishes once.
    selected.sort(key=lambda r: (not r["region"].startswith("R75_"), r["region"]))
    for item in selected:
        region = item["region"].split("_", 1)[0]
        if region in ("R01", "R02", "R03", "R04") and region not in overseas_crs:
            raise ValueError(
                f"Specify the documented CSV projection for {region} in --overseas-crs JSON"
            )
        print("Downloading " + item["name"], flush=True)
        raw = download(item, workspace / "raw")
        prepare(
            raw,
            workspace / "worker.duckdb",
            args.coverage_start,
            args.coverage_end,
            overseas_crs.get(region, "EPSG:2154"),
            cities,
            BOX + "/file/" + str(item["id"]),
            progress=lambda message: print(message, flush=True),
        )
    if args.address_database:
        from sale_addresses import enrich

        count = enrich(workspace / "worker.duckdb", args.address_database)
        print(
            f"Recovered {count:,} declared DVF addresses by exact transaction matching",
            flush=True,
        )
    post = PostUploader(args.post_file) if args.post_file else None
    if args.destination:
        archive_sources(workspace / "raw", args.destination, post)
    pointer = export(workspace / "worker.duckdb", args.output)
    print("Local release ready: " + pointer["release"], flush=True)
    if args.destination:
        result = upload(
            args.output,
            pointer,
            args.destination,
            post,
            args.activate,
        )
        print(
            f"Uploaded {result['rows']:,} sales; activated={args.activate}", flush=True
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--publication", required=True, help="Official folder name, e.g. octobre_2026"
    )
    p.add_argument("--coverage-start", type=date.fromisoformat, required=True)
    p.add_argument("--coverage-end", type=date.fromisoformat, required=True)
    p.add_argument("--regions", nargs="*", help="Optional region codes, e.g. R75 R11")
    p.add_argument(
        "--overseas-crs",
        type=Path,
        help="JSON region-to-CRS map for overseas regional CSVs",
    )
    p.add_argument("--workspace", type=Path, default=Path("data/dvfplus"))
    p.add_argument("--output", type=Path, default=Path("data/published"))
    p.add_argument(
        "--address-database",
        type=Path,
        help="Optional raw-DVF database for exact transaction address matching before publication",
    )
    p.add_argument("--destination")
    p.add_argument("--post-file", type=Path)
    p.add_argument("--activate", action="store_true")
    update(p.parse_args())
