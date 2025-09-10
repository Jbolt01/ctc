# Cornell Trading Competition - Production Deployment Guide

This guide covers how to deploy the Cornell Trading Competition platform to production using Docker images built and published via GitHub Actions.

## Overview

The CI/CD pipeline automatically:
1. Runs tests and linting on pull requests
2. Builds and pushes Docker images to GitHub Container Registry on main branch pushes
3. Provides production-ready images for deployment

## Prerequisites

1. **Docker and Docker Compose** installed on your production server
2. **GitHub Container Registry access** to pull images
3. **Domain name** (optional, but recommended for production)
4. **SSL certificates** (for HTTPS support)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/ctc.git
cd ctc
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp env.prod.example .env.prod

# Edit the production environment variables
nano .env.prod
```

**Required Configuration:**
- `GITHUB_REPOSITORY`: Your GitHub repository (e.g., `your-username/ctc`)
- `POSTGRES_PASSWORD`: Strong password for PostgreSQL
- `NEXT_PUBLIC_API_URL`: Your production API URL
- Update domain references in nginx.conf

### 3. Deploy

```bash
# Make deployment script executable (if not already)
chmod +x deploy.sh

# Deploy to production
./deploy.sh
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_REPOSITORY` | Your GitHub repo for pulling images | `your-username/ctc` |
| `POSTGRES_PASSWORD` | PostgreSQL database password | `your-secure-password` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_DB` | Database name | `trading_competition` |
| `POSTGRES_USER` | Database user | `trading_user` |
| `ALLOW_ANY_API_KEY` | Allow dev API keys (set to false in prod) | `false` |
| `NEXT_PUBLIC_API_URL` | Frontend API URL | `https://your-domain.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL | `/ws/v1/market-data` |
| `HTTP_PORT` | HTTP port | `80` |
| `HTTPS_PORT` | HTTPS port | `443` |

## Manual Deployment Steps

If you prefer manual deployment over using the script:

### 1. Pull Latest Images

```bash
# Set your repository
export GITHUB_REPOSITORY=your-username/ctc

# Pull images
docker pull ghcr.io/${GITHUB_REPOSITORY}/backend:latest
docker pull ghcr.io/${GITHUB_REPOSITORY}/frontend:latest
```

### 2. Start Services

```bash
# Start with production compose file
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 3. Verify Deployment

```bash
# Check service status
docker-compose -f docker-compose.prod.yml --env-file .env.prod ps

# View logs
docker-compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

## SSL/HTTPS Setup

### 1. Automatic Certificates via GitHub Actions (Recommended)

The deploy job can automatically provision TLS certificates on your remote server:

- Provide these repository secrets:
  - `DEPLOY_DOMAIN` (e.g., `your-domain.com`)
  - `LETSENCRYPT_EMAIL` (email for Let’s Encrypt)

On deploy, the workflow will:

- Stop the stack (if running) to free ports 80/443
- Run dockerized Certbot in standalone mode to obtain a certificate for `DEPLOY_DOMAIN`
- Copy the issued `fullchain.pem` and `privkey.pem` into `./certs/server.crt` and `./certs/server.key`
- If issuance fails or secrets are not provided, it falls back to generating a self‑signed certificate
- On subsequent deploys, it attempts renewal and recopies the latest certs

No extra manual steps are required once the secrets are set and DNS points to your server.

### 2. HTTPS in nginx.conf

This repo includes an `nginx.conf` that terminates TLS on port 443 with secure defaults (TLS 1.2/1.3, modern ciphers, HSTS) and redirects port 80 → 443 while still serving ACME HTTP‑01 challenges. It expects certs at:

- `/etc/nginx/certs/server.crt`
- `/etc/nginx/certs/server.key`

The production compose file mounts `./certs` into that path. Ensure you place your certificate and key on the server:

```bash
scp -r certs $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_APP_DIR/
```

If you use Let’s Encrypt, the deploy workflow will copy the `fullchain` and `privkey` into `certs/server.crt` and `certs/server.key` respectively. If managing certs manually, copy them into those filenames, or adjust the Nginx paths accordingly.

## Monitoring and Maintenance

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml --env-file .env.prod logs -f

# Specific service
docker-compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
```

### Update Application

```bash
# Pull latest images and restart
./deploy.sh
```

### Backup Database

```bash
# Create backup
docker-compose -f docker-compose.prod.yml --env-file .env.prod exec postgres \
  pg_dump -U trading_user trading_competition > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Scale Services

```bash
# Scale backend (if needed)
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d --scale backend=2
```

## Troubleshooting

### Common Issues

1. **Images not found**: Ensure `GITHUB_REPOSITORY` is correct and images exist
2. **Database connection errors**: Check `POSTGRES_PASSWORD` and database health
3. **Permission issues**: Ensure proper file permissions and Docker access
4. **Port conflicts**: Check if ports 80/443 are already in use

### Debugging Commands

```bash
# Check container status
docker ps

# Inspect specific container
docker inspect ctc_old-backend-1

# Access container shell
docker-compose -f docker-compose.prod.yml --env-file .env.prod exec backend sh

# Check database connection
docker-compose -f docker-compose.prod.yml --env-file .env.prod exec postgres \
  psql -U trading_user -d trading_competition -c "SELECT version();"
```

## Security Considerations

1. **Use strong passwords** for database and any authentication
2. **Keep images updated** by regularly deploying latest versions
3. **Use HTTPS** in production with valid SSL certificates
4. **Firewall configuration** to limit access to necessary ports only
5. **Regular backups** of database and configuration
6. **Monitor logs** for suspicious activity

## CI/CD Pipeline

The GitHub Actions workflow automatically:

- **On Pull Requests**: Runs tests and linting
- **On Main Branch Push**: 
  - Runs full test suite
  - Builds Docker images
  - Pushes to GitHub Container Registry
  - Tags with branch name, SHA, and 'latest'

Images are available at:
- `ghcr.io/your-username/ctc/backend:latest`
- `ghcr.io/your-username/ctc/frontend:latest`
