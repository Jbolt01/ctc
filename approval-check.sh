#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Checking backend..."
cd backend

# Activate uv env if needed (assumes uv is installed locally)
echo "📦 Installing backend deps..."
uv sync --frozen

echo "🔍 Ruff lint..."
uv run ruff check .

echo "🧪 Backend tests..."
uv run pytest --maxfail=1 --cov=src --cov-report=term-missing --ignore=tests/performance

cd ..

echo "🔧 Checking frontend..."
cd frontend

echo "📦 Installing frontend deps..."
pnpm install --frozen-lockfile=false

echo "🔍 ESLint..."
pnpm lint

echo "🧪 Frontend tests..."
pnpm test -- --ci

cd ..

echo "✅ All checks passed locally!"
