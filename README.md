## Cornell Trading Competition Platform

A professional trading platform with real-time market data, team-based trading, and comprehensive order management. Built with FastAPI backend and Next.js frontend.

## Features

- 🏪 **Real-time Trading** - Live order book, market data, and trade execution
- 👥 **Team-based Trading** - Multi-user teams with shared orders and positions
- 🔐 **Authentication** - Secure user registration and login system
- 📊 **Professional UI** - Dark theme with advanced trading interface
- 🔌 **WebSocket Integration** - Real-time market data updates
- 🐳 **Production Ready** - Docker-based deployment with CI/CD

## Production Deployment

For production deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

**Quick Deploy:**
```bash
cp env.prod.example .env.prod
# Edit .env.prod with your settings
./deploy.sh
```

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

**Quick Setup:**
1. Run the setup script: `./setup-env.sh`
2. Start all services: `docker-compose up --build`

**Manual Setup:**
1. Create a `.env` file with required environment variables (see `.env.example`)
2. Run: `docker-compose up --build`

**Environment Variables:**
- `DB_PASSWORD`: PostgreSQL password (defaults to `devpassword`)
- `ALLOW_ANY_API_KEY`: Allow any API key for development (defaults to `true`)
- `NEXT_PUBLIC_API_URL`: Frontend API URL (defaults to `http://localhost/api/v1`)
- `NEXT_PUBLIC_WS_URL`: WebSocket URL (defaults to `ws://localhost/ws/v1/market-data`)

The application will be available at:
- Frontend: http://localhost:3000
- API: https://localhost/api/v1 (via nginx, with TLS)
- WebSocket: wss://localhost/ws/v1/market-data (via nginx)

See `docker-compose.yml` and `nginx.conf` for details. To run locally with HTTPS, place a certificate and key at `./certs/server.crt` and `./certs/server.key` (self-signed is fine for dev). The reverse proxy will redirect HTTP to HTTPS and terminate TLS with secure defaults and HSTS.
