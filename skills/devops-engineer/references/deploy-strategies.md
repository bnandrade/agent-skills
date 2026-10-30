# Deploy Strategies

Deployment approaches from PaaS to VPS, zero-downtime patterns, database migrations during deploy, rollback strategies, and practical decision framework for choosing the right strategy at each stage.

---

## Table of Contents

1. [Decision Framework](#1-decision-framework)
2. [PaaS Deploy](#2-paas-deploy)
3. [VPS Deploy from Scratch](#3-vps-deploy-from-scratch)
4. [Docker-Based Deploy to VPS](#4-docker-based-deploy-to-vps)
5. [Laravel-Specific Deploy](#5-laravel-specific-deploy)
6. [Blue-Green Deployment](#6-blue-green-deployment)
7. [Rolling Deployment](#7-rolling-deployment)
8. [Canary Deployment](#8-canary-deployment)
9. [Zero-Downtime Deploy](#9-zero-downtime-deploy)
10. [Database Migration Strategies](#10-database-migration-strategies)
11. [Rollback Strategies](#11-rollback-strategies)
12. [Deploy Hooks & Health Checks](#12-deploy-hooks--health-checks)
13. [Asset Deployment](#13-asset-deployment)
14. [Strategy Comparison](#14-strategy-comparison)

---

## 1. Decision Framework

### Which Strategy for Which Stage

| Stage | Team Size | Traffic | Recommended | Cost/mo |
|---|---|---|---|---|
| **MVP / Prototype** | 1-2 devs | <1k users | PaaS (Railway, Render, Fly.io) | $5-20 |
| **Validated product** | 2-5 devs | 1k-50k users | VPS + Docker Compose | $20-100 |
| **Growing** | 5-15 devs | 50k-500k users | VPS + Docker + blue-green | $100-500 |
| **Scale** | 15+ devs | 500k+ users | Kubernetes / managed cloud | $500+ |

### Decision Checklist

```
Do you need to ship in hours, not days?
  → PaaS (Railway, Render, Vercel)

Do you need full control and cost efficiency?
  → VPS (Hetzner, DigitalOcean) + Docker Compose

Is your app Laravel specifically?
  → Laravel Forge (VPS) or Laravel Vapor (serverless)

Do you need zero-downtime deploys?
  → Blue-green or rolling deployment

Do you have multiple services with independent release cycles?
  → Canary + feature flags

Are you spending >$500/mo on PaaS?
  → Migrate to VPS (same app on Hetzner costs 1/5th)
```

---

## 2. PaaS Deploy

### 2.1 Railway

Best for: Node.js, Go, Python, Laravel. Auto-detects framework, provisions databases.

```bash
# Install CLI
npm install -g @railway/cli

# Login and init
railway login
railway init

# Deploy
railway up

# Set environment variables
railway variables set DATABASE_URL="postgres://..."
railway variables set APP_KEY="base64:..."
```

Railway auto-deploys from GitHub on push. For manual control:

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: railwayapp/cli-action@v1
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
      - run: railway up --service myapp --detach
```

### 2.2 Render

Best for: static sites, web services, background workers, cron jobs.

```yaml
# render.yaml — Infrastructure as Code
services:
  - type: web
    name: myapp
    runtime: docker
    repo: https://github.com/user/myapp
    plan: starter
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: mydb
          property: connectionString
      - key: REDIS_URL
        fromService:
          name: myredis
          type: redis
          property: connectionString
    healthCheckPath: /health
    autoDeploy: true

databases:
  - name: mydb
    plan: starter
    databaseName: myapp
```

### 2.3 Fly.io

Best for: globally distributed apps, edge computing, Docker-first workflows.

```toml
# fly.toml
app = "myapp"
primary_region = "gru"  # Sao Paulo

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"
    timeout = "5s"

[env]
  APP_ENV = "production"
  LOG_LEVEL = "info"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
  count = 2
```

```bash
fly launch                    # first deploy
fly deploy                    # subsequent deploys
fly secrets set APP_KEY=...   # set secrets
fly scale count 3             # scale to 3 instances
fly ssh console               # SSH into running instance
```

### 2.4 Vercel

Best for: Next.js, static sites, serverless functions. Not for long-running processes.

```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "nextjs",
  "regions": ["gru1"],
  "env": {
    "DATABASE_URL": "@database-url"
  }
}
```

### 2.5 WRONG/CORRECT: PaaS Usage

```
# WRONG: using Vercel for a Laravel app with queues and cron
→ Vercel is serverless — no persistent processes, no queue workers

# CORRECT: use Railway or Fly.io for Laravel (supports workers + cron)

# WRONG: staying on PaaS when monthly bill exceeds $300 for a simple app
→ Same app on Hetzner VPS costs $10-20/mo

# CORRECT: migrate to VPS + Docker Compose when PaaS costs don't justify convenience
```

---

## 3. VPS Deploy from Scratch

### 3.1 Initial Server Setup (Ubuntu 24.04)

```bash
#!/bin/bash
# setup-server.sh — run as root on fresh VPS

set -euo pipefail

# --- System Updates ---
apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban unattended-upgrades

# --- Create deploy user ---
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/deploy

# --- SSH hardening ---
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Disable root login and password auth
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# --- Firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw --force enable

# --- Install Docker ---
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# --- Enable automatic security updates ---
dpkg-reconfigure -plow unattended-upgrades

echo "Server setup complete. Login as: ssh deploy@$(curl -s ifconfig.me)"
```

### 3.2 App Directory Structure on VPS

```
/opt/myapp/
├── compose.yml           # Docker Compose config
├── .env                  # Environment variables (chmod 600)
├── docker/
│   └── nginx/
│       └── default.conf  # Nginx config
├── backups/              # Database backups
└── deploy.sh             # Deploy script
```

### 3.3 Deploy Script

```bash
#!/bin/bash
# /opt/myapp/deploy.sh
set -euo pipefail

APP_DIR="/opt/myapp"
cd "$APP_DIR"

echo "==> Pulling latest images..."
docker compose pull

echo "==> Running migrations..."
docker compose run --rm app php artisan migrate --force

echo "==> Starting new containers..."
docker compose up -d --remove-orphans

echo "==> Waiting for health check..."
sleep 5

if curl -sf http://localhost:8080/health > /dev/null; then
    echo "==> Deploy successful!"
else
    echo "==> Health check failed! Rolling back..."
    docker compose rollback 2>/dev/null || docker compose down
    exit 1
fi

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done!"
```

---

## 4. Docker-Based Deploy to VPS

### 4.1 Basic Pattern: Pull & Restart

The simplest Docker deploy — build in CI, push to registry, pull on server:

```yaml
# CI builds and pushes image
# Then triggers deploy via SSH

# .github/workflows/deploy.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: deploy
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/myapp

            # Login to registry
            echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin

            # Update image tag in .env
            sed -i 's|IMAGE_TAG=.*|IMAGE_TAG=${{ github.sha }}|' .env

            # Pull and restart
            docker compose pull
            docker compose up -d --remove-orphans

            # Verify
            sleep 5
            curl -sf http://localhost:8080/health || exit 1

            docker image prune -f
```

```yaml
# compose.yml on the VPS
services:
  app:
    image: ghcr.io/myorg/myapp:${IMAGE_TAG:-latest}
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      app:
        condition: service_healthy
    restart: unless-stopped

volumes:
  caddy-data:
```

### 4.2 WRONG/CORRECT: Docker Deploy

```bash
# WRONG: building on the VPS (slow, uses server resources)
ssh deploy@server "cd /opt/myapp && git pull && docker compose build && docker compose up -d"

# CORRECT: build in CI, push to registry, pull on VPS
# CI: docker build + docker push
# VPS: docker compose pull + docker compose up -d
```

```bash
# WRONG: using :latest tag — can't tell what's running or roll back
docker compose pull   # pulls :latest — which version is this?

# CORRECT: use commit SHA or semantic version as tag
IMAGE_TAG=abc123f docker compose pull
# You know exactly what's deployed and can roll back to previous SHA
```

---

## 5. Laravel-Specific Deploy

### 5.1 Laravel Forge

Forge manages the entire VPS for Laravel. Provisions Nginx, PHP, MySQL, Redis, SSL.

```bash
# Forge deploy script (configured in Forge dashboard)
cd /home/forge/myapp.com

git pull origin main

composer install --no-dev --optimize-autoloader

npm ci && npm run build

php artisan migrate --force
php artisan optimize
php artisan queue:restart

# If using Octane:
php artisan octane:reload
```

### 5.2 Laravel Vapor (Serverless)

Best for: auto-scaling Laravel apps. Runs on AWS Lambda + API Gateway.

```yaml
# vapor.yml
id: 12345
name: myapp
environments:
  production:
    memory: 1024
    cli-memory: 512
    runtime: 'php-8.4:al2'
    build:
      - 'COMPOSER_MIRROR_PATH_REPOS=1 composer install --no-dev'
      - 'npm ci && npm run build && rm -rf node_modules'
    queues: true
    database: myapp-db
    cache: myapp-cache
  staging:
    memory: 512
    runtime: 'php-8.4:al2'
    build:
      - 'composer install'
    database: myapp-staging-db
```

```bash
vapor deploy production
vapor deploy staging
vapor rollback production   # instant rollback to previous deployment
```

### 5.3 Envoyer (Zero-Downtime)

Envoyer uses atomic symlink-based deploys:

```
/home/forge/myapp.com/
├── current -> releases/20260411120000   # symlink to active release
├── releases/
│   ├── 20260411120000/                  # latest release
│   ├── 20260410150000/                  # previous release
│   └── 20260409090000/                  # older release
├── storage/                             # shared storage (persistent)
│   ├── app/
│   ├── framework/
│   └── logs/
└── .env                                 # shared env (persistent)
```

The Nginx root points to `/home/forge/myapp.com/current/public`. The symlink switch is atomic.

---

## 6. Blue-Green Deployment

Two identical environments (blue/green). One serves traffic, the other is updated and tested before switching.

### 6.1 Docker Compose Blue-Green

```yaml
# compose.blue.yml
services:
  app-blue:
    image: ghcr.io/myorg/myapp:${BLUE_TAG}
    container_name: app-blue
    expose:
      - "8080"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

# compose.green.yml
services:
  app-green:
    image: ghcr.io/myorg/myapp:${GREEN_TAG}
    container_name: app-green
    expose:
      - "8080"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

### 6.2 Blue-Green Deploy Script

```bash
#!/bin/bash
# blue-green-deploy.sh
set -euo pipefail

NEW_TAG="$1"
ACTIVE_FILE="/opt/myapp/active-slot"
ACTIVE=$(cat "$ACTIVE_FILE" 2>/dev/null || echo "blue")

if [ "$ACTIVE" == "blue" ]; then
    DEPLOY_SLOT="green"
    DEPLOY_PORT="8081"
else
    DEPLOY_SLOT="blue"
    DEPLOY_PORT="8080"
fi

echo "==> Active: $ACTIVE | Deploying to: $DEPLOY_SLOT"

# Start the new version
export "${DEPLOY_SLOT^^}_TAG=$NEW_TAG"
docker compose -f "compose.${DEPLOY_SLOT}.yml" pull
docker compose -f "compose.${DEPLOY_SLOT}.yml" up -d

# Wait for health check
echo "==> Waiting for $DEPLOY_SLOT to be healthy..."
for i in $(seq 1 30); do
    if docker inspect --format='{{.State.Health.Status}}' "app-${DEPLOY_SLOT}" 2>/dev/null | grep -q "healthy"; then
        echo "==> $DEPLOY_SLOT is healthy!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "==> Health check failed! Aborting."
        docker compose -f "compose.${DEPLOY_SLOT}.yml" down
        exit 1
    fi
    sleep 2
done

# Switch traffic (update Caddy/Nginx upstream)
echo "==> Switching traffic to $DEPLOY_SLOT..."
sed -i "s/app-${ACTIVE}/app-${DEPLOY_SLOT}/" /opt/myapp/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# Update active slot record
echo "$DEPLOY_SLOT" > "$ACTIVE_FILE"

# Keep old version running for quick rollback (stop after 10 min)
echo "==> Old version ($ACTIVE) still running. Stop manually or wait."

echo "==> Deploy complete! Active: $DEPLOY_SLOT ($NEW_TAG)"
```

### 6.3 Rollback (Instant)

```bash
#!/bin/bash
# rollback.sh — switch back to previous slot
ACTIVE=$(cat /opt/myapp/active-slot)
PREVIOUS=$( [ "$ACTIVE" == "blue" ] && echo "green" || echo "blue" )

# Verify previous slot is still running
if ! docker inspect "app-${PREVIOUS}" &>/dev/null; then
    echo "Error: previous slot ($PREVIOUS) is not running!"
    exit 1
fi

# Switch traffic back
sed -i "s/app-${ACTIVE}/app-${PREVIOUS}/" /opt/myapp/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
echo "$PREVIOUS" > /opt/myapp/active-slot

echo "==> Rolled back to $PREVIOUS"
```

---

## 7. Rolling Deployment

Update instances one at a time. Some instances serve old version while others are updated. Requires multiple replicas.

### 7.1 Docker Compose Rolling Update

```bash
#!/bin/bash
# rolling-deploy.sh
set -euo pipefail

NEW_TAG="$1"
REPLICAS=3

cd /opt/myapp

# Pull new image
export IMAGE_TAG="$NEW_TAG"
docker compose pull

# Update one container at a time
for i in $(seq 1 $REPLICAS); do
    echo "==> Updating replica $i of $REPLICAS..."

    # Scale down one, scale up with new image
    docker compose up -d --no-deps --scale app=$REPLICAS app

    # Wait for the new container to be healthy
    sleep 10

    HEALTHY=$(docker compose ps app --format json | jq -r 'select(.Health == "healthy")' | wc -l)
    if [ "$HEALTHY" -lt "$i" ]; then
        echo "==> Replica $i unhealthy! Stopping rolling update."
        exit 1
    fi

    echo "==> Replica $i updated and healthy."
done

echo "==> Rolling update complete!"
```

### 7.2 When to Use Rolling

| Use Rolling | Don't Use Rolling |
|---|---|
| Stateless services | Database schema changes |
| API servers behind load balancer | When old + new can't coexist |
| Multiple replicas already running | Single instance apps |
| Minor version updates | Major breaking changes |

---

## 8. Canary Deployment

Route a small percentage of traffic to the new version. Monitor for errors before rolling out fully.

### 8.1 Caddy-Based Canary

```
# Caddyfile with weighted upstream
myapp.com {
    reverse_proxy {
        to app-stable:8080 app-stable:8080 app-stable:8080 app-stable:8080 app-canary:8080
        # 4:1 ratio = 80% stable, 20% canary

        health_uri /health
        health_interval 10s

        lb_policy round_robin
    }
}
```

### 8.2 Canary Deploy Script

```bash
#!/bin/bash
# canary-deploy.sh
set -euo pipefail

NEW_TAG="$1"
CANARY_WEIGHT="${2:-20}"   # default 20% canary traffic

cd /opt/myapp

echo "==> Deploying canary ($CANARY_WEIGHT% traffic) with tag: $NEW_TAG"

# Start canary
CANARY_TAG="$NEW_TAG" docker compose -f compose.canary.yml up -d

# Wait for health
sleep 10
if ! curl -sf http://localhost:8081/health; then
    echo "==> Canary health check failed! Removing canary."
    docker compose -f compose.canary.yml down
    exit 1
fi

echo "==> Canary is healthy. Monitoring for 5 minutes..."
echo "==> Run: ./promote-canary.sh to promote to 100%"
echo "==> Run: ./rollback-canary.sh to remove canary"
```

### 8.3 Promote or Rollback

```bash
# promote-canary.sh — canary becomes the new stable
#!/bin/bash
set -euo pipefail

CANARY_TAG=$(docker inspect app-canary --format '{{.Config.Image}}' | cut -d: -f2)

cd /opt/myapp
export IMAGE_TAG="$CANARY_TAG"

# Update stable to canary version
docker compose pull
docker compose up -d --remove-orphans

# Remove canary
docker compose -f compose.canary.yml down

echo "==> Canary promoted. All traffic on $CANARY_TAG"
```

```bash
# rollback-canary.sh — remove canary, keep stable
#!/bin/bash
cd /opt/myapp
docker compose -f compose.canary.yml down
echo "==> Canary removed. All traffic on stable."
```

---

## 9. Zero-Downtime Deploy

### 9.1 Symlink-Based (Envoyer Style)

The most reliable zero-downtime pattern for PHP/Laravel. Works without Docker.

```bash
#!/bin/bash
# zero-downtime-deploy.sh
set -euo pipefail

APP_DIR="/home/deploy/myapp"
RELEASES_DIR="$APP_DIR/releases"
SHARED_DIR="$APP_DIR/shared"
RELEASE="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$RELEASE"
KEEP_RELEASES=5

echo "==> Creating release: $RELEASE"

# Clone/checkout to new release directory
git clone --depth 1 git@github.com:org/myapp.git "$RELEASE_DIR"
cd "$RELEASE_DIR"

# Link shared resources
ln -nfs "$SHARED_DIR/storage" "$RELEASE_DIR/storage"
ln -nfs "$SHARED_DIR/.env" "$RELEASE_DIR/.env"

# Install dependencies
composer install --no-dev --optimize-autoloader
npm ci && npm run build

# Run migrations
php artisan migrate --force

# Cache everything
php artisan optimize

# Atomic symlink switch (this is the actual deploy — instant, no downtime)
ln -nfs "$RELEASE_DIR" "$APP_DIR/current"

# Reload PHP-FPM to pick up new code
sudo systemctl reload php8.4-fpm

# Restart queue workers
php artisan queue:restart

# Cleanup old releases
cd "$RELEASES_DIR"
ls -dt */ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

echo "==> Deploy complete: $RELEASE"
```

### 9.2 Docker Zero-Downtime with Health Checks

Docker Compose restarts containers one at a time when health checks are defined:

```yaml
services:
  app:
    image: ghcr.io/myorg/myapp:${IMAGE_TAG}
    deploy:
      replicas: 2
      update_config:
        parallelism: 1        # update one at a time
        delay: 10s             # wait between updates
        order: start-first     # start new before stopping old
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped
```

### 9.3 WRONG/CORRECT: Zero-Downtime

```bash
# WRONG: stop, then start — causes downtime
docker compose down
docker compose pull
docker compose up -d

# CORRECT: pull first, then recreate (Docker handles the switch)
docker compose pull
docker compose up -d --remove-orphans
# Docker stops old container only after new one passes health check (with start-first order)
```

```bash
# WRONG: running migrations that lock tables during deploy
php artisan migrate --force   # ALTER TABLE locks the table for seconds/minutes

# CORRECT: use expand-and-contract pattern (see Database Migration Strategies)
```

---

## 10. Database Migration Strategies

### 10.1 The Expand-and-Contract Pattern

Safe migrations happen in two deploys:

**Deploy 1 (Expand):** Add new columns/tables, keep old ones working.
**Deploy 2 (Contract):** Remove old columns/tables after all code uses new ones.

```php
// WRONG: rename column in a single deploy — breaks running instances
Schema::table('users', function (Blueprint $table) {
    $table->renameColumn('name', 'full_name');  // old code still references 'name'
});

// CORRECT: expand-and-contract across two deploys

// Deploy 1 — add new column, copy data, code reads both
Schema::table('users', function (Blueprint $table) {
    $table->string('full_name')->nullable()->after('name');
});
DB::statement('UPDATE users SET full_name = name WHERE full_name IS NULL');
// App code: reads full_name, falls back to name

// Deploy 2 (days/weeks later, after all code uses full_name)
Schema::table('users', function (Blueprint $table) {
    $table->dropColumn('name');
});
```

### 10.2 Run Migrations Before or After Deploy?

| Scenario | When to Migrate | Why |
|---|---|---|
| Adding columns/tables | **Before** deploy | New code needs them |
| Removing columns | **After** deploy | Old code still uses them during rollout |
| Changing column type | **Expand first**, then contract | Both old and new code must work |
| Adding index | **Before** deploy (async for large tables) | New code benefits from index |

### 10.3 Safe Migration Checklist

```
[ ] New columns are nullable or have defaults
[ ] No column renames in a single deploy
[ ] No column drops while old code might reference them
[ ] Large table migrations run in background (not blocking deploy)
[ ] Migrations are tested on production-size data in staging
[ ] Rollback migration exists and is tested
```

### 10.4 Large Table Migrations

```php
// WRONG: adding index on 10M row table — blocks deploys for minutes
Schema::table('orders', function (Blueprint $table) {
    $table->index('status');  // locks table on some databases
});

// CORRECT: create index concurrently (PostgreSQL)
DB::statement('CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status)');

// CORRECT: for MySQL, use ALTER TABLE with ALGORITHM=INPLACE
DB::statement('ALTER TABLE orders ADD INDEX idx_status (status), ALGORITHM=INPLACE, LOCK=NONE');
```

---

## 11. Rollback Strategies

### 11.1 Docker Image Rollback

```bash
#!/bin/bash
# rollback.sh — redeploy previous image
set -euo pipefail

cd /opt/myapp

# Option 1: roll back to specific tag
PREVIOUS_TAG="$1"
export IMAGE_TAG="$PREVIOUS_TAG"
docker compose up -d

# Option 2: roll back to previous image (Docker keeps it locally)
# Check what was running before
docker compose logs --tail=1 app | head -1   # see timestamp
docker image ls ghcr.io/myorg/myapp          # see available tags
```

### 11.2 Git-Based Rollback

```bash
#!/bin/bash
# For non-Docker deploys (symlink-based)

APP_DIR="/home/deploy/myapp"
RELEASES_DIR="$APP_DIR/releases"

# List available releases
echo "Available releases:"
ls -la "$RELEASES_DIR"

# Roll back to previous release
PREVIOUS=$(ls -dt "$RELEASES_DIR"/*/ | sed -n '2p')
if [ -z "$PREVIOUS" ]; then
    echo "No previous release to roll back to!"
    exit 1
fi

echo "Rolling back to: $PREVIOUS"
ln -nfs "$PREVIOUS" "$APP_DIR/current"
sudo systemctl reload php8.4-fpm

echo "Rollback complete."
```

### 11.3 Database Rollback

```bash
# WRONG: rolling back code without considering database changes
./rollback.sh v1.2.0   # code rolls back but DB has v1.3.0 migrations

# CORRECT: check if migrations are backward-compatible first
php artisan migrate:status   # see which migrations ran

# If migration is safe to reverse:
php artisan migrate:rollback --step=1

# If migration added a column (backward-compatible), leave the DB alone
# The old code simply ignores the extra column
```

### 11.4 Rollback Decision Tree

```
Is the new deploy broken?
  ├── Yes: Is the database schema changed?
  │   ├── No → Roll back code immediately (docker/symlink switch)
  │   └── Yes: Are the DB changes backward-compatible?
  │       ├── Yes → Roll back code, leave DB as-is
  │       └── No → Roll back DB migration first, then roll back code
  └── No: Is performance degraded?
      ├── Yes → Investigate with monitoring. Roll back if >5min without fix
      └── No → Monitor closely, no rollback needed
```

---

## 12. Deploy Hooks & Health Checks

### 12.1 Health Check Endpoint

```php
// Laravel — routes/web.php
Route::get('/health', function () {
    try {
        DB::connection()->getPdo();       // check DB
        Cache::store('redis')->get('_');  // check Redis
        return response()->json([
            'status' => 'healthy',
            'timestamp' => now()->toIso8601String(),
        ]);
    } catch (\Throwable $e) {
        return response()->json([
            'status' => 'unhealthy',
            'error' => $e->getMessage(),
        ], 503);
    }
});
```

```go
// Go
mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
    if err := db.PingContext(r.Context()); err != nil {
        http.Error(w, "unhealthy: "+err.Error(), http.StatusServiceUnavailable)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{
        "status": "healthy",
    })
})
```

```javascript
// Node.js / Express
app.get('/health', async (req, res) => {
    try {
        await db.raw('SELECT 1');
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err.message });
    }
});
```

### 12.2 Deploy Hooks

```bash
#!/bin/bash
# deploy-hooks.sh — called during deploy

# Pre-deploy hooks
pre_deploy() {
    echo "==> Running pre-deploy hooks..."

    # Enable maintenance mode
    docker compose exec -T app php artisan down --retry=60

    # Backup database before migration
    docker compose exec -T db pg_dump -U app mydb | gzip > "/opt/backups/pre-deploy-$(date +%Y%m%d%H%M%S).sql.gz"
}

# Post-deploy hooks
post_deploy() {
    echo "==> Running post-deploy hooks..."

    # Run migrations
    docker compose exec -T app php artisan migrate --force

    # Clear caches and optimize
    docker compose exec -T app php artisan optimize

    # Restart queue workers
    docker compose exec -T app php artisan queue:restart

    # Disable maintenance mode
    docker compose exec -T app php artisan up

    # Warm up caches
    curl -sf http://localhost:8080/ > /dev/null

    # Notify team
    curl -X POST "$SLACK_WEBHOOK" \
        -H 'Content-Type: application/json' \
        -d "{\"text\": \"Deployed $(git log -1 --format='%h %s') to production\"}"
}
```

### 12.3 Readiness vs Liveness Checks

```yaml
# Docker Compose health check covers liveness
# For readiness (before receiving traffic), use start_period
services:
  app:
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s   # don't check health during startup (warming caches, etc.)
```

---

## 13. Asset Deployment

### 13.1 Versioned Assets with CDN

```bash
# Build assets with content hash in filename (Vite default)
npm run build
# Output: dist/assets/app-BxK4f2.js, dist/assets/style-3jF8a1.css

# Upload to S3/CDN
aws s3 sync dist/assets/ s3://my-cdn-bucket/assets/ \
    --cache-control "public, max-age=31536000, immutable" \
    --delete
```

```php
// Laravel — config/app.php
'asset_url' => env('ASSET_URL', ''),

// .env
ASSET_URL=https://cdn.myapp.com

// Blade: automatically uses ASSET_URL
<script src="{{ Vite::asset('resources/js/app.js') }}"></script>
// Output: <script src="https://cdn.myapp.com/build/assets/app-BxK4f2.js"></script>
```

### 13.2 Asset Deploy in CI

```yaml
# Deploy assets to S3 before deploying app
jobs:
  deploy-assets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci && npm run build

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - run: |
          aws s3 sync public/build/ s3://${{ secrets.CDN_BUCKET }}/build/ \
              --cache-control "public, max-age=31536000, immutable"

  deploy-app:
    needs: deploy-assets
    # ... deploy the application code
```

### 13.3 WRONG/CORRECT: Asset Deploy

```bash
# WRONG: serving assets from app server
# All asset requests hit your app server — slow, wastes resources

# CORRECT: serve from CDN or Nginx static files
# CDN: assets on S3 + CloudFront/Cloudflare
# Or Nginx: serve static files directly, proxy only PHP/dynamic to app
```

```nginx
# Nginx: serve static assets directly, don't hit PHP for them
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}

location / {
    try_files $uri $uri/ /index.php?$query_string;
}
```

---

## 14. Strategy Comparison

### Quick Reference Table

| Strategy | Downtime | Rollback Speed | Complexity | Best For |
|---|---|---|---|---|
| **PaaS auto-deploy** | ~30s | Minutes (redeploy) | Lowest | MVPs, prototypes |
| **Docker pull + restart** | 5-30s | Minutes (re-pull) | Low | Solo/small teams |
| **Symlink swap** | 0 | Seconds (re-link) | Medium | PHP/Laravel without Docker |
| **Blue-green** | 0 | Seconds (switch slot) | Medium | Critical apps, any stack |
| **Rolling** | 0 | Minutes (roll forward) | Medium-High | Multiple replicas |
| **Canary** | 0 | Seconds (remove canary) | High | High-traffic, risk-averse |

### When to Graduate

```
Starting out → PaaS (ship fast, worry about infra later)
    ↓ Monthly bill > $100, or need more control
VPS + Docker pull/restart (simple, cost-effective)
    ↓ Need zero downtime
VPS + Blue-green or symlink swap
    ↓ Multiple services, complex releases
Rolling deployment
    ↓ High-traffic, need to test in production safely
Canary deployment
    ↓ Multi-region, team > 20, SLA requirements
Kubernetes (finally justified)
```

### Cost Comparison (Same Laravel App)

| Platform | Spec | Monthly Cost | Deploy Method |
|---|---|---|---|
| Railway | 512MB, shared CPU | $10-20 | `railway up` |
| Render | 512MB, shared CPU | $7-15 | Git push |
| Fly.io | 256MB x2 instances | $5-15 | `fly deploy` |
| Hetzner VPS (CX22) | 4GB RAM, 2 vCPU | $4.50 | Docker Compose |
| DigitalOcean Droplet | 2GB RAM, 1 vCPU | $12 | Docker Compose |
| Laravel Forge + Hetzner | 4GB RAM, 2 vCPU | $4.50 + $12 (Forge) | Forge dashboard |
| Laravel Vapor (AWS) | Serverless | $30-100+ | `vapor deploy` |
| AWS ECS Fargate | 0.5 vCPU, 1GB | $30-50 | CI/CD pipeline |
