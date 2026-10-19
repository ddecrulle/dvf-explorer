#!/bin/zsh
set -e
cd "${0:A:h}"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r backend/requirements.lock.txt
fi
if [[ ! -f frontend/dist/index.html ]]; then
  (cd frontend && npm ci && npm run build)
fi
printf '\nDVF Explorer : http://127.0.0.1:8000\nKeep this window open. Press Ctrl+C to stop.\n\n'
if [[ -f .env ]]; then
  exec .venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --env-file .env
fi
exec .venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
