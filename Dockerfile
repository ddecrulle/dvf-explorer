# Pin both Python stages to the same tested 3.15.0 release. Refresh their digests
# together when applying runtime updates (the public tags are moving aliases).
ARG PYTHON_BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:493521fad3d4633ad34c8662cd01c89bd659618d58fed0de4edaf33b8693daa6
ARG PYTHON_RUNTIME_IMAGE=cgr.dev/chainguard/python:latest@sha256:702c7dffc2f1665e10b2ec88a9955bd21caa9741b7840b6a05a334a62b91be54

FROM node:22-slim AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_BUILD_IMAGE} AS python-build
USER 0
ENV HOME=/tmp/build-home
# DuckDB 1.5.6 has no cp315 wheels yet; native build tools stay in this stage.
RUN apk add --no-cache build-base cmake ninja && mkdir -p /app/data
ENV CMAKE_BUILD_PARALLEL_LEVEL=2
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN python -m venv /opt/venv && /opt/venv/bin/python -m pip install --no-cache-dir --only-binary=:all: --no-binary=duckdb -r backend/requirements.lock.txt
# The minimal runtime omits the IANA database required by zoneinfo.
RUN apk add --no-cache tzdata
# pip is needed only to assemble the venv, not in the shipped runtime.
RUN /opt/venv/bin/python -m pip uninstall -y pip
# Install while networking is available; replicas need no extension download.
RUN /opt/venv/bin/python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL httpfs')" && chmod -R a+rX /tmp/build-home/.duckdb

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
