# Pin both Python stages to the same tested 3.15.1 release. Refresh their digests
# together when applying runtime updates (the public tags are moving aliases).
ARG PYTHON_BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:8da57dd32b02b27107cd4188255a764b99fdef8760c2c89a785a1ad7225a94ac
ARG PYTHON_RUNTIME_IMAGE=cgr.dev/chainguard/python:latest@sha256:8ed5fe9c8de087123ce3affce2ff580b1cae6723283af151d98ff74cae9ebe8b

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS ui
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
COPY backend/requirements.lock.txt requirements.lock.txt
RUN python -c "from pathlib import Path; lines=[s for s in Path('requirements.lock.txt').read_text().splitlines() if s.startswith('duckdb==')]; assert len(lines)==1; Path('native.txt').write_text(lines[0]+'\n')"

FROM ${PYTHON_BUILD_IMAGE} AS python-build
ARG TARGETARCH
USER 0
ENV HOME=/tmp/build-home
# DuckDB 1.5.6 has no cp315 wheels yet; native build tools stay in this stage.
RUN apk add --no-cache build-base cmake ninja && mkdir -p /app/data
ENV CMAKE_BUILD_PARALLEL_LEVEL=2
WORKDIR /app
COPY --from=native-spec /spec/native.txt /spec/native.txt
RUN --mount=type=cache,id=pip-${TARGETARCH},target=/tmp/build-home/.cache/pip python -m venv /opt/venv && /opt/venv/bin/python -m pip install --no-binary=duckdb -r /spec/native.txt
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN --mount=type=cache,id=pip-${TARGETARCH},target=/tmp/build-home/.cache/pip /opt/venv/bin/python -m pip install --only-binary=:all: -r backend/requirements.lock.txt
# The minimal runtime omits the IANA database required by zoneinfo.
RUN apk add --no-cache tzdata
# pip is needed only to assemble the venv, not in the shipped runtime.
RUN /opt/venv/bin/python -m pip uninstall -y pip
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
