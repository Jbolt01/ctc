#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Checking backend..."
cd backend

echo "📦 Installing backend deps..."
uv sync --frozen

echo "🔍 Ruff lint..."
uv run ruff check . --output-format=github

echo "🔎 Mypy typecheck..."
uv run python -m mypy src

echo "🧪 Backend tests..."
uv run pytest --maxfail=1 --cov=src --cov-report=term-missing --ignore=tests/performance

cd ..

echo "🔧 Checking frontend..."
cd frontend

echo "📦 Installing frontend deps..."
pnpm install --frozen-lockfile

echo "🔍 ESLint..."
pnpm lint

echo "🧪 Frontend tests..."
pnpm test -- --ci

cd ..

echo "✅ All checks passed locally!"
