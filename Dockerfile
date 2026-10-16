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
COPY backend/ backend/
COPY --from=ui /app/frontend/dist frontend/dist
ENV DVF_DATA_DIR=/app/data
EXPOSE 8000
CMD ["uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
