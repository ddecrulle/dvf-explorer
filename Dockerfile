# Pin both Python stages to the same tested 3.15.1 release. Refresh their digests
# together when applying runtime updates (the public tags are moving aliases).
ARG PYTHON_BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:157a562dbc225a2a9039dbd8249cbf704202260ba27bf525f24e47a3a685050f
ARG PYTHON_RUNTIME_IMAGE=cgr.dev/chainguard/python:latest@sha256:1fa5b8de4d71f79354c71b5f8fd3cb591f51e41dc9e9d620eda2526d1e57a221

FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM node:26-slim@sha256:94816674c62774da0d099a947bf4613b9e1972a2733abd0d0cd80e795f8411d0 AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_BUILD_IMAGE} AS python-build
ARG TARGETARCH
USER 0
COPY --from=uv /uv /usr/local/bin/uv
ENV HOME=/tmp/build-home
ENV UV_PYTHON_DOWNLOADS=never
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV UV_LINK_MODE=copy
ENV UV_CACHE_DIR=/tmp/build-home/.cache/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
# Refuse source builds: DuckDB 2 provides ABI-stable Python 3.15 wheels.
# Keep the test group for the existing image-level CI checks.
RUN --mount=type=cache,id=uv-${TARGETARCH},target=/tmp/build-home/.cache/uv uv sync --locked --no-dev --group test --no-build
RUN apk add --no-cache tzdata && mkdir -p /app/data
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
