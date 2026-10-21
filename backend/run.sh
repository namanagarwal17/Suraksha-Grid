#!/usr/bin/env bash
# Start the FastAPI dev server
# Usage: cd backend && ./run.sh
set -euo pipefail
if [ ! -f .env ]; then
  echo "No .env found — copy .env.example to .env and fill in your values."
  exit 1
fi
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
