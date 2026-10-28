# Pin both Python stages to the same tested 3.15.1 release. Refresh their digests
# together when applying runtime updates (the public tags are moving aliases).
ARG PYTHON_BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:d0c4d53aa4ef455b60a9918fd680bf80b82151e2e56c524d8931ffb8115865bd
ARG PYTHON_RUNTIME_IMAGE=cgr.dev/chainguard/python:latest@sha256:1fa5b8de4d71f79354c71b5f8fd3cb591f51e41dc9e9d620eda2526d1e57a221

FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM node:24-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Extract only the native dependency so unrelated Python updates can reuse its
# compiled layer. The main lock remains the single source of package versions.
FROM ${PYTHON_BUILD_IMAGE} AS native-spec
USER 0
WORKDIR /spec
COPY uv.lock uv.lock
RUN python -c "import tomllib; from pathlib import Path; packages=[p for p in tomllib.loads(Path('uv.lock').read_text())['package'] if p['name']=='duckdb']; assert len(packages)==1; p=packages[0]; Path('native.txt').write_text('duckdb=='+p['version']+' --hash='+p['sdist']['hash']+'\n')"

FROM ${PYTHON_BUILD_IMAGE} AS python-build
ARG TARGETARCH
USER 0
COPY --from=uv /uv /usr/local/bin/uv
ENV HOME=/tmp/build-home
ENV UV_PYTHON_DOWNLOADS=never
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV UV_LINK_MODE=copy
ENV UV_CACHE_DIR=/tmp/build-home/.cache/uv
# DuckDB 1.5.6 has no cp315 wheels yet; native build tools stay in this stage.
RUN apk add --no-cache build-base cmake ninja && mkdir -p /app/data
ENV CMAKE_BUILD_PARALLEL_LEVEL=2
WORKDIR /app
COPY --from=native-spec /spec/native.txt /spec/native.txt
RUN --mount=type=cache,id=uv-${TARGETARCH},target=/tmp/build-home/.cache/uv uv venv /opt/venv && uv pip install --python /opt/venv/bin/python --no-deps --no-binary duckdb --require-hashes -r /spec/native.txt
COPY pyproject.toml uv.lock ./
# Inexact sync retains the separately verified native DuckDB install.
# The venv starts empty; all other packages are synced from locked wheels.
# Keep the test group for the existing minimal-image CI checks.
RUN --mount=type=cache,id=uv-${TARGETARCH},target=/tmp/build-home/.cache/uv uv sync --locked --inexact --no-dev --group test --no-build --no-install-package duckdb
RUN /opt/venv/bin/python -c "import duckdb, tomllib; from pathlib import Path; p=next(p for p in tomllib.loads(Path('uv.lock').read_text())['package'] if p['name']=='duckdb'); assert duckdb.__version__==p['version']"
# The minimal runtime omits the IANA database required by zoneinfo.
RUN apk add --no-cache tzdata
# Install while networking is available; replicas need no extension download.
RUN mkdir -p /tmp/build-home && /opt/venv/bin/python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL httpfs')" && chmod -R a+rX /tmp/build-home/.duckdb

FROM ${PYTHON_RUNTIME_IMAGE}
WORKDIR /app
COPY --from=python-build /opt/venv /opt/venv
COPY --from=python-build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=python-build /tmp/build-home/.duckdb /opt/duckdb-extensions
COPY --from=python-build --chown=10001:10001 /app/data /app/data
COPY backend/ backend/
COPY --from=ui /app/frontend/dist frontend/dist
ENV PATH="/opt/venv/bin:${PATH}"
ENV HOME=/tmp
ENV DVF_DATA_DIR=/app/data
ENV DVF_EXTENSION_DIR=/opt/duckdb-extensions/extensions
USER 10001:10001
EXPOSE 8000
# Clear Chainguard's Python entrypoint so docker/Helm command overrides work.
ENTRYPOINT []
CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
