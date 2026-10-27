# Python runtime and vulnerability checks

The runtime uses **Python 3.15.1**, the patch release supplied by the pinned Chainguard images. Both Python build and runtime images use the public Chainguard Python images, pinned to the tested multi-platform manifest digests in `Dockerfile`. These digests currently contain Python 3.15.1. Moving `latest` aliases are not used without a digest. Sources: [Python release](https://www.python.org/downloads/release/python-3151/) and [Chainguard Python images](https://edu.chainguard.dev/chainguard/containers/getting-started/languages-and-runtimes/python/).

The final image contains the application, its virtual environment, the compiled React files, the preinstalled DuckDB httpfs extension and the IANA timezone database needed for `Europe/Paris`. Compilers, the Node toolchain and the development image remain in build stages. The runtime has no shell, pip or OS package manager and runs as UID/GID 10001. Docker/Helm command overrides still work through the Python executable on PATH.

DuckDB 1.5.6 does not yet publish CPython 3.15 wheels. The Python build stage therefore compiles its pinned source package using a C++ toolchain, with two concurrent build tasks to bound memory usage. Other application dependencies must have wheels. This makes the first build slower; a separate native-dependency layer and architecture-specific caches avoid recompiling DuckDB when unrelated requirements change. The native version is extracted from the main lockfile, so it has no second version declaration to maintain. No DuckDB version or stored dataset format is changed. Parquet cache reads revalidate the content checksum instead of trusting file timestamps, which can have coarse resolution inside containers.

## Checks before publication

CI runs on native AMD64 and ARM64 runners. Each architecture validates/builds the frontend and Helm chart, builds the runtime image, smoke-tests it as UID 10001, executes the backend tests inside that image under Python 3.15 and scans it using pinned Trivy tooling and its current vulnerability database.

The image scan covers OS and Python packages. It fails on **every reported vulnerability severity**, including unknown severity and vulnerabilities without an available fix. There is no ignore list and no `ignore-unfixed` bypass. A JSON scan report is attached to the workflow for each architecture, including failed scans. Docker publication and GitHub release creation depend on both checks succeeding.

A clean scan means no vulnerabilities reported by that scanner/database at that time. It cannot prove the absence of undiscovered vulnerabilities or cover every bundled native library. This is a security gate for known findings, not a permanent CVE-free guarantee.

## Updating

Refresh the build and runtime image digests together, verify that both provide the intended Python version, and update the CI Python version and this document. Rebuild both architectures, run the tests and repeat the full-image scan. Increase `VERSION` to publish a new application release. Do not move an existing version tag.

The base images are pinned for reproducibility, so rebuilding alone does not update their OS packages or Python patch version. Dependency fixes also require updating `backend/requirements.lock.txt` and retesting. No background update schedule is installed.

The 27 October 2026 refresh replaces both base digests to include the corrected certificate bundle and Brotli packages identified by the publication scan (CVE-2026-111943 and CVE-2026-111497). The locked Python certificate bundle is already `certifi==2026.10.19`. See [Chainguard certificate remediation](https://support.chainguard.dev/hc/en-us/articles/57499369353755-ACTION-REQUIRED-Update-all-Chainguard-Images-to-remove-eMudhra-Intermediate-CA-Data). The full scan remains mandatory on both architectures.
