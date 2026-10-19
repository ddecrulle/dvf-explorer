FROM node:22-slim AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN pip install --no-cache-dir -r backend/requirements.lock.txt
# Install while networking is available; read-only replicas need no extension download.
RUN python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL httpfs')" && chmod -R a+rX /root/.duckdb && cp -r /root/.duckdb /opt/duckdb-extensions
COPY backend/ backend/
COPY --from=ui /app/frontend/dist frontend/dist
ENV DVF_DATA_DIR=/app/data
ENV DVF_EXTENSION_DIR=/opt/duckdb-extensions/extensions
EXPOSE 8000
CMD ["uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
