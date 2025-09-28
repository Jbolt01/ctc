## Cornell Trading Competition Platform

A professional trading platform with real-time market data, team-based trading, and comprehensive order management. Built with FastAPI backend and Next.js frontend.

## Features

- 🏪 **Real-time Trading** - Live order book, market data, and trade execution
- 👥 **Team-based Trading** - Multi-user teams with shared orders and positions
- 🔐 **Authentication** - Secure user registration and login system
- 📊 **Professional UI** - Dark theme with advanced trading interface
- 🔌 **WebSocket Integration** - Real-time market data updates
- 🐳 **Production Ready** - Docker-based deployment with CI/CD

## Local Development (with Docker)

These steps spin up Postgres, Redis, Backend (FastAPI), Frontend (Next.js), and nginx (TLS proxy) in one command.

### 1) Prerequisites

- Docker Desktop (or Docker Engine) with Compose V2 (`docker compose version`)
- OpenSSL (for a quick self‑signed cert)

### 2) Generate dev TLS certs for nginx

```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost"
```

nginx enforces HTTPS in this repo (80 → 443). A self‑signed cert is fine for local.

### 3) Optional: dev env overrides

Create a `.env` at the repo root and add any of the following if you want:

```
ADMIN_EMAILS=you@example.com
SEED_ON_STARTUP=true
```

- `ADMIN_EMAILS` lets your dev email be an admin at registration/login.
- `SEED_ON_STARTUP=true` seeds a few symbols (AAPL, GOOGL) at backend startup.

### 4) Start the stack

```bash
docker compose up --build
```

Services come up in this order: Postgres, Redis, Backend (runs Alembic migrations at start), Frontend (Next.js), nginx.

### 5) Open the app

- https://localhost (accept the self‑signed cert)
- Health check: `curl -k https://localhost/health` → `{ "status": "ok" }`

### 6) Get an API key (no Google needed for dev)

Register directly via the API:

```bash
curl -k -X POST https://localhost/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"openid_sub":"devuser1","email":"you@example.com","name":"You"}'
```

Copy the `api_key` from the response. Because `ADMIN_EMAILS` includes your email, you’ll be admin immediately.

Set the session in the browser (DevTools Console):

```js
localStorage.setItem('apiKey', 'PASTE_API_KEY_HERE')
localStorage.setItem('user', JSON.stringify({ id: 'u', email: 'you@example.com', name: 'You', created_at: new Date().toISOString() }))
localStorage.setItem('teams', JSON.stringify([{ id: 't', name: "Your Team", role: 'admin' }]))
```

Now visit:

- Trading terminal: https://localhost/trading/equities
- Team settings: https://localhost/team (shows join code; owners can rotate code)
- Admin console: https://localhost/admin (requires your email in `ADMIN_EMAILS`)

### 7) Common dev actions

- Logs: `docker compose logs -f backend` (or `frontend`, `nginx`)
- Restart backend after code changes: `docker compose restart backend`
- Stop stack: `docker compose down`
- Reset DB/Redis volumes (CAUTION): `docker compose down -v`

### 8) Troubleshooting

- Backend exits on startup → migrations failed (by design). Check `docker compose logs backend` and fix DB/env then retry.
- 401/Invalid API key → re‑register (step 6) and set localStorage.
- Admin 403 → ensure your email is in `ADMIN_EMAILS` and restart backend, then re‑register.
- HTTPS issues → regenerate self‑signed certs in `./certs`.

## Local Development (without Docker) [Note: *Deprecated*, not guaranteed to work]

Backend:
1. `cd backend`
2. Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
3. `uv sync`
4. `uv run uvicorn src.app.main:app --reload`

Frontend:
1. `cd frontend`
2. Install pnpm (if needed): `corepack enable && corepack prepare pnpm@latest --activate`
3. `pnpm install`
4. `pnpm dev`

## Production Deployment

For production deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

**Quick Deploy:**
```bash
cp env.prod.example .env.prod
# Edit .env.prod with your settings
./deploy.sh
```

## Domain Change Process
1. Setup DNS for new domain
2. Update GitHub secrets
   * `DEPLOY_DOMAIN`: new domain (e.g., your-new-domain.com)
   * `DEPLOY_HOST`: server's IP address
   * `NEXT_PUBLIC_API_URL`: https://your-new-domain.com/api
   * `NEXT_PUBLIC_WS_URL`: wss://your-new-domain.com/ws
   * `LETSENCRYPT_EMAIL`: email for SSL certificate notifications
