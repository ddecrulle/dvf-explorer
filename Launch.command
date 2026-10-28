#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v uv >/dev/null 2>&1; then
  printf 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/\n' >&2
  exit 1
fi
uv sync --locked
if [[ ! -f frontend/dist/index.html ]]; then
  (cd frontend && npm ci && npm run build)
fi
printf '\nDVF Explorer : http://127.0.0.1:8000\nKeep this window open. Press Ctrl+C to stop.\n\n'
if [[ -f .env ]]; then
  exec uv run --locked --no-sync python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --env-file .env
fi
exec uv run --locked --no-sync python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
