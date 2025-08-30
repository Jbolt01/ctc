#!/bin/bash

# Cornell Trading Competition - Production Deployment Script

set -e

echo "🚀 Deploying Cornell Trading Competition to Production"
echo "=================================================="

# Check if .env.prod exists
if [ ! -f .env.prod ]; then
    echo "❌ Error: .env.prod file not found!"
    echo "Please copy env.prod.example to .env.prod and configure your production settings."
    exit 1
fi

# Load environment variables
export $(cat .env.prod | grep -v '^#' | xargs)

# Validate required environment variables
if [ -z "$GITHUB_REPOSITORY" ]; then
    echo "❌ Error: GITHUB_REPOSITORY not set in .env.prod"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ Error: POSTGRES_PASSWORD not set in .env.prod"
    exit 1
fi

echo "📦 Pulling latest Docker images from GitHub Container Registry..."
docker pull ghcr.io/${GITHUB_REPOSITORY}/backend:latest
docker pull ghcr.io/${GITHUB_REPOSITORY}/frontend:latest

echo "🛑 Stopping existing services..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod down

echo "🧹 Cleaning up old images..."
docker image prune -f

echo "🚀 Starting production services..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo "⏳ Waiting for services to be healthy..."
sleep 10

echo "🔍 Checking service status..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod ps

echo "📋 Viewing logs (last 20 lines)..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=20

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your application should be available at:"
echo "   HTTP:  http://localhost:${HTTP_PORT:-80}"
echo "   HTTPS: https://localhost:${HTTPS_PORT:-443}"
echo ""
echo "📊 To view logs:"
echo "   docker-compose -f docker-compose.prod.yml --env-file .env.prod logs -f"
echo ""
echo "🛑 To stop services:"
echo "   docker-compose -f docker-compose.prod.yml --env-file .env.prod down"
