#!/usr/bin/env sh
set -eu

# Wait for source to be mounted (when using bind mounts in dev)
i=0
while [ ! -d /app/src ] && [ $i -lt 30 ]; do
  echo "Waiting for /app/src to be available..."
  i=$((i+1))
  sleep 1
done

# Run migrations with a few retries (handles initial DB readiness and env warmup)
echo "Running database migrations..."
attempt=0
until [ $attempt -ge 5 ]; do
  if uv run alembic upgrade head; then
    break
  fi
  attempt=$((attempt+1))
  echo "Migration attempt $attempt failed; retrying in 2s..."
  sleep 2
done

echo "Starting application..."
exec uv run uvicorn src.app.main:app --host 0.0.0.0 --port 8000

