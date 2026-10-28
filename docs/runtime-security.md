# Python runtime and vulnerability checks

The runtime uses **Python 3.15.1**, the patch release supplied by the pinned Chainguard images. Both Python build and runtime images use the public Chainguard Python images, pinned to the tested multi-platform manifest digests in `Dockerfile`. These digests currently contain Python 3.15.1. Moving `latest` aliases are not used without a digest. Sources: [Python release](https://www.python.org/downloads/release/python-3151/) and [Chainguard Python images](https://edu.chainguard.dev/chainguard/containers/getting-started/languages-and-runtimes/python/).

The final image contains the application, its virtual environment, the compiled React files, the preinstalled DuckDB httpfs extension and the IANA timezone database needed for `Europe/Paris`. Compilers, the Node toolchain and the development image remain in build stages. The runtime has no shell, pip or OS package manager and runs as UID/GID 10001. Docker/Helm command overrides still work through the Python executable on PATH.

DuckDB 2.0 is installed from its published ABI-stable wheels, including CPython 3.15 on Linux AMD64 and ARM64. `uv sync --locked --no-build` enforces precompiled packages for every dependency and fails if a compatible wheel is missing. No C++ compiler, CMake, Ninja or native-build cache layer is needed. Package versions and artifact hashes come from `uv.lock`. Parquet cache reads still revalidate the content checksum.

Persistent legacy and preparation-worker connections set `storage_compatibility_version=v1.5.6`, so new database files remain readable by the previous DuckDB runtime. Existing files are not converted to the DuckDB 2 format. Read-only publication and Parquet queries are checked against existing releases. See [the DuckDB migration guide](https://duckdb.org/docs/2.0/operations_manual/migration).

## Checks before publication

CI runs on native AMD64 and ARM64 runners. Each architecture validates/builds the frontend and Helm chart, builds the runtime image, smoke-tests it as UID 10001, executes the backend tests inside that image under Python 3.15 and scans it using pinned Trivy tooling and its current vulnerability database.

The image scan covers OS and Python packages. It fails on **every reported vulnerability severity**, including unknown severity and vulnerabilities without an available fix. There is no ignore list and no `ignore-unfixed` bypass. A JSON scan report is attached to the workflow for each architecture, including failed scans. Docker publication and GitHub release creation depend on both checks succeeding.

A clean scan means no vulnerabilities reported by that scanner/database at that time. It cannot prove the absence of undiscovered vulnerabilities or cover every bundled native library. This is a security gate for known findings, not a permanent CVE-free guarantee.

## Updating

Refresh the build and runtime image digests together, verify that both provide the intended Python version, and update the CI Python version and this document. Rebuild both architectures, run the tests and repeat the full-image scan. Increase `VERSION` to publish a new application release. Do not move an existing version tag.

The base images are pinned for reproducibility, so rebuilding alone does not update their OS packages or Python patch version. Dependency fixes also require updating `pyproject.toml` and `uv.lock` and retesting. No background update schedule is installed.

The 27 October 2026 refresh replaces both base digests to include the corrected certificate bundle and Brotli packages identified by the publication scan (CVE-2026-111943 and CVE-2026-111497). The locked Python certificate bundle is now `certifi==2026.10.23`. See [Chainguard certificate remediation](https://support.chainguard.dev/hc/en-us/articles/57499369353755-ACTION-REQUIRED-Update-all-Chainguard-Images-to-remove-eMudhra-Intermediate-CA-Data). The full scan remains mandatory on both architectures.

Pinned uv 0.13.6 is used only in the build stage. The final environment is synchronized exactly from the lockfile and has no pip, uv or OS package manager. The `test` group remains installed for the existing image-level CI checks.
