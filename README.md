## Cornell Trading Competition Platform

Monorepo scaffolding for a mock trading platform with a FastAPI backend and Next.js frontend.

### Quick start (local, without Docker)

Backend:
1. cd backend
2. Ensure Python 3.12+ is installed
3. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
4. uv sync
5. uv run uvicorn src.app.main:app --reload

Frontend:
1. cd frontend
2. Install pnpm (if needed): corepack enable && corepack prepare pnpm@latest --activate
3. pnpm install
4. pnpm dev

### With Docker
1. export DB_PASSWORD=devpassword
2. docker compose up --build

See `docker-compose.yml` and `nginx.conf` for details.
