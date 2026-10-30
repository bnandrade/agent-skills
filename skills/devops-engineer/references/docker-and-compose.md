# Docker & Compose

Dockerfile best practices, multi-stage builds, stack-specific images, Docker Compose v2 patterns, networking, volumes, and BuildKit features. Targets Docker Engine 29+ and Compose v2.

---

## Table of Contents

1. [Dockerfile Fundamentals](#1-dockerfile-fundamentals)
2. [Multi-Stage Builds](#2-multi-stage-builds)
3. [Dockerfiles by Stack](#3-dockerfiles-by-stack)
4. [Layer Caching & Optimization](#4-layer-caching--optimization)
5. [BuildKit Features](#5-buildkit-features)
6. [.dockerignore](#6-dockerignore)
7. [Docker Compose v2 Patterns](#7-docker-compose-v2-patterns)
8. [Volumes & Storage](#8-volumes--storage)
9. [Networking](#9-networking)
10. [Development vs Production Compose](#10-development-vs-production-compose)
11. [Resource Limits](#11-resource-limits)
12. [Useful Commands Reference](#12-useful-commands-reference)

---

## 1. Dockerfile Fundamentals

### 1.1 Always Pin Image Tags

```dockerfile
# WRONG: unpredictable — different image on every build
FROM node:latest
FROM php:fpm

# CORRECT: pinned major.minor for reproducibility
FROM node:22-alpine
FROM php:8.4-fpm-alpine
```

### 1.2 Non-Root User

Never run production containers as root.

```dockerfile
# WRONG: runs as root (default)
FROM node:22-alpine
WORKDIR /app
COPY . .
CMD ["node", "server.js"]

# CORRECT: create and switch to non-root user
FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --chown=app:app . .
USER app
CMD ["node", "server.js"]
```

### 1.3 HEALTHCHECK

Define health checks directly in the Dockerfile so Docker can monitor container health.

```dockerfile
# For HTTP services
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# For non-HTTP services (check if process is running)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD pg_isready -U postgres || exit 1
```

Prefer `wget` over `curl` in Alpine images — `wget` is included by default, `curl` is not.

### 1.4 Labels and Metadata

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/user/repo"
LABEL org.opencontainers.image.description="My application"
LABEL org.opencontainers.image.version="1.0.0"
```

---

## 2. Multi-Stage Builds

### 2.1 Why Multi-Stage

Single-stage builds include build tools, dev dependencies, and source code in the final image. Multi-stage keeps only what's needed at runtime.

```dockerfile
# WRONG: single-stage — 1.2GB image with gcc, dev headers, source code
FROM node:22
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["node", "dist/server.js"]

# CORRECT: multi-stage — 180MB image with only production artifacts
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### 2.2 Named Stages

Name stages for clarity and selective builds:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM deps AS dev
COPY . .
CMD ["npm", "run", "dev"]

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
CMD ["node", "dist/server.js"]
```

```bash
# Build specific target
docker build --target dev -t myapp:dev .
docker build --target production -t myapp:latest .
```

---

## 3. Dockerfiles by Stack

### 3.1 PHP / Laravel — FPM + Nginx

```dockerfile
# Stage 1: Composer dependencies
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

COPY . .
RUN composer dump-autoload --optimize --no-dev

# Stage 2: Frontend assets
FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json vite.config.js ./
RUN npm ci
COPY resources/ resources/
RUN npm run build

# Stage 3: Production PHP-FPM image
FROM php:8.4-fpm-alpine AS production

# Install extensions
RUN apk add --no-cache \
        libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev \
        icu-dev libzip-dev oniguruma-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql mbstring exif pcntl bcmath gd intl zip opcache

# PHP production config
COPY docker/php/php.ini /usr/local/etc/php/conf.d/99-production.ini
COPY docker/php/fpm-pool.conf /usr/local/etc/php-fpm.d/www.conf

WORKDIR /var/www/html

COPY --from=vendor /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY . .

# Fix permissions
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

USER www-data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD php-fpm-healthcheck || exit 1

EXPOSE 9000
CMD ["php-fpm"]
```

Companion Nginx config:

```nginx
# docker/nginx/default.conf
server {
    listen 80;
    server_name _;
    root /var/www/html/public;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass app:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3.2 PHP / Laravel Octane (FrankenPHP)

```dockerfile
FROM dunglas/frankenphp:latest-php8.4-alpine AS production

RUN install-php-extensions \
    pdo_mysql mbstring exif pcntl bcmath gd intl zip opcache redis

WORKDIR /app

COPY --from=vendor /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY . .

RUN php artisan optimize \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000
CMD ["php", "artisan", "octane:start", "--server=frankenphp", "--host=0.0.0.0", "--port=8000"]
```

### 3.3 Node.js

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER app

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### 3.4 Go — Scratch / Distroless

```dockerfile
FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

# Option A: scratch (smallest possible — ~0 MB overhead)
FROM scratch
COPY --from=builder /app/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 8080
ENTRYPOINT ["/server"]

# Option B: distroless (non-root by default, ~2 MB)
# FROM gcr.io/distroless/static:nonroot
# COPY --from=builder /app/server /server
# EXPOSE 8080
# ENTRYPOINT ["/server"]
```

### 3.5 Python

```dockerfile
FROM python:3.13-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app

COPY --from=builder /app/.venv ./.venv
COPY . .

ENV PATH="/app/.venv/bin:$PATH"
USER app

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 4. Layer Caching & Optimization

### 4.1 Order Matters

Docker caches layers. When a layer changes, all subsequent layers are invalidated. Put things that change less frequently first.

```dockerfile
# WRONG: COPY . . early busts cache for everything after it
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# CORRECT: copy dependency manifest first, install, then copy source
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./          # changes rarely
RUN npm ci                      # cached unless package.json changes
COPY . .                        # source code changes often
RUN npm run build
```

### 4.2 Minimize Layer Count

Combine related RUN commands:

```dockerfile
# WRONG: 4 layers for related operations
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git
RUN rm -rf /var/lib/apt/lists/*

# CORRECT: single layer, clean up in the same layer
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git \
    && rm -rf /var/lib/apt/lists/*
```

### 4.3 Use --no-install-recommends

```dockerfile
# WRONG: installs 200MB of "recommended" packages you don't need
RUN apt-get install -y curl

# CORRECT: only what you asked for
RUN apt-get install -y --no-install-recommends curl
```

### 4.4 Clean Up in the Same Layer

```dockerfile
# WRONG: cleanup in separate layer doesn't reduce image size
RUN apt-get update && apt-get install -y build-essential
RUN rm -rf /var/lib/apt/lists/*   # new layer, but the data is still in the previous layer

# CORRECT: cleanup in the same RUN
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
```

---

## 5. BuildKit Features

Docker Engine 29+ uses BuildKit by default. These features are available out of the box.

### 5.1 Cache Mounts

Persist package manager caches across builds — huge speedup for repeated builds.

```dockerfile
# Composer (PHP)
RUN --mount=type=cache,target=/root/.composer/cache \
    composer install --no-dev --optimize-autoloader

# npm
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Go modules
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# APT
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y curl
```

### 5.2 Secret Mounts

Pass secrets at build time without baking them into layers:

```dockerfile
# WRONG: secret ends up in image layer history
ARG GITHUB_TOKEN
RUN git clone https://${GITHUB_TOKEN}@github.com/org/private-repo.git

# CORRECT: secret is available only during this RUN, not stored in any layer
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) \
    git clone https://${GITHUB_TOKEN}@github.com/org/private-repo.git
```

```bash
# Build with secret
docker build --secret id=github_token,src=./token.txt -t myapp .
```

### 5.3 SSH Forwarding

Access private Git repos during build without copying SSH keys:

```dockerfile
RUN --mount=type=ssh \
    git clone git@github.com:org/private-repo.git
```

```bash
docker build --ssh default -t myapp .
```

### 5.4 Heredocs in Dockerfiles

```dockerfile
# Write multi-line files without escaping
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 80;
    root /var/www/html/public;
    location / {
        try_files \$uri /index.php\$is_args\$args;
    }
}
EOF

# Multi-line RUN
RUN <<EOF
apt-get update
apt-get install -y curl git
rm -rf /var/lib/apt/lists/*
EOF
```

---

## 6. .dockerignore

Always create a `.dockerignore` to reduce build context and prevent leaking secrets.

```
# Version control
.git
.gitignore

# Dependencies (installed inside container)
node_modules
vendor

# Environment files (NEVER include)
.env
.env.*
!.env.example

# IDE and OS files
.vscode
.idea
*.swp
.DS_Store
Thumbs.db

# CI/CD config
.github
.gitlab-ci.yml

# Docker files (don't include Dockerfile in the image)
Dockerfile*
docker-compose*.yml
.dockerignore

# Documentation
*.md
LICENSE

# Testing and dev
tests
coverage
.phpunit.result.cache
.nyc_output

# Build artifacts (rebuilt inside container)
dist
build
public/build
storage/logs/*
storage/framework/cache/*
```

---

## 7. Docker Compose v2 Patterns

### 7.1 Basic Service Definition

```yaml
# compose.yml (preferred name in Compose v2)
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/mydb
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
    restart: unless-stopped

volumes:
  db-data:
  redis-data:
```

### 7.2 depends_on with Health Checks

```yaml
# WRONG: service starts before dependency is actually ready
services:
  app:
    depends_on:
      - db     # only waits for container to start, not for DB to be ready

# CORRECT: wait for healthy state
services:
  app:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrations:
        condition: service_completed_successfully  # wait for one-shot service
```

### 7.3 Profiles

Use profiles to group optional services:

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"

  db:
    image: postgres:17-alpine

  # Only started with: docker compose --profile monitoring up
  grafana:
    image: grafana/grafana:latest
    profiles: ["monitoring"]
    ports:
      - "3000:3000"

  prometheus:
    image: prom/prometheus:latest
    profiles: ["monitoring"]
    ports:
      - "9090:9090"

  # Only started with: docker compose --profile debug up
  mailpit:
    image: axllent/mailpit
    profiles: ["debug"]
    ports:
      - "8025:8025"
      - "1025:1025"
```

```bash
docker compose up                        # app + db only
docker compose --profile monitoring up   # app + db + grafana + prometheus
docker compose --profile debug up        # app + db + mailpit
docker compose --profile monitoring --profile debug up  # everything
```

### 7.4 Environment Variables

```yaml
services:
  app:
    # Method 1: inline (visible in compose file — avoid for secrets)
    environment:
      APP_ENV: production
      LOG_LEVEL: info

    # Method 2: .env file (preferred for secrets)
    env_file:
      - .env

    # Method 3: pass from host (variable must be set on host)
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SECRET_KEY: ${SECRET_KEY:?error: SECRET_KEY is required}  # fail if not set
```

### 7.5 Laravel Full Stack Compose

```yaml
services:
  app:
    build:
      context: .
      target: production
    environment:
      APP_ENV: production
      DB_CONNECTION: pgsql
      DB_HOST: db
      DB_DATABASE: laravel
      DB_USERNAME: laravel
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      CACHE_STORE: redis
      SESSION_DRIVER: redis
      QUEUE_CONNECTION: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    restart: unless-stopped

  queue:
    build:
      context: .
      target: production
    command: php artisan queue:work --queue=high,default,low --tries=3 --timeout=90
    environment:
      APP_ENV: production
      DB_HOST: db
      REDIS_HOST: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  scheduler:
    build:
      context: .
      target: production
    command: php artisan schedule:work
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: laravel
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: laravel
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U laravel"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
    restart: unless-stopped

volumes:
  db-data:
  redis-data:
```

---

## 8. Volumes & Storage

### 8.1 Named Volumes vs Bind Mounts vs tmpfs

| Type | Use Case | Persistence | Performance |
|---|---|---|---|
| Named volume | Database data, persistent app data | Survives container removal | Best (managed by Docker) |
| Bind mount | Source code in dev, config files | Host filesystem | Varies (slower on macOS) |
| tmpfs | Sensitive data, temp files, caches | Lost on container stop | Fastest (RAM) |

```yaml
services:
  app:
    volumes:
      # Named volume — for persistent data
      - app-data:/var/www/html/storage

      # Bind mount — for development (hot reload)
      - ./src:/var/www/html/src

      # tmpfs — for temporary/sensitive data
      - type: tmpfs
        target: /tmp
        tmpfs:
          size: 100000000  # 100MB

  db:
    volumes:
      - db-data:/var/lib/postgresql/data

      # Read-only bind mount for init scripts
      - ./docker/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

volumes:
  app-data:
  db-data:
```

### 8.2 Backup Named Volumes

```bash
# Backup a volume to tar.gz
docker run --rm \
    -v db-data:/data:ro \
    -v $(pwd)/backups:/backup \
    alpine tar czf /backup/db-data-$(date +%Y%m%d).tar.gz -C /data .

# Restore from backup
docker run --rm \
    -v db-data:/data \
    -v $(pwd)/backups:/backup \
    alpine tar xzf /backup/db-data-20260411.tar.gz -C /data
```

### 8.3 Volume Permissions

```dockerfile
# WRONG: volume owned by root, app can't write
FROM node:22-alpine
WORKDIR /app
VOLUME /app/uploads

# CORRECT: create directory with correct ownership before VOLUME
FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /app/uploads && chown app:app /app/uploads
WORKDIR /app
USER app
VOLUME /app/uploads
```

---

## 9. Networking

### 9.1 Service Discovery

In Compose, services discover each other by name (DNS):

```yaml
services:
  app:
    environment:
      # Use service name as hostname
      DATABASE_URL: postgres://user:pass@db:5432/mydb    # "db" resolves to the db container
      REDIS_URL: redis://redis:6379                       # "redis" resolves to redis container
      ELASTICSEARCH_URL: http://elasticsearch:9200

  db:
    image: postgres:17-alpine

  redis:
    image: redis:7-alpine
```

### 9.2 Custom Networks

Isolate groups of services:

```yaml
services:
  app:
    networks:
      - frontend
      - backend

  nginx:
    networks:
      - frontend    # can talk to app, not to db

  db:
    networks:
      - backend     # can talk to app, not to nginx

  redis:
    networks:
      - backend

networks:
  frontend:
  backend:
```

### 9.3 Network Modes

```yaml
services:
  # Default: bridge (isolated, DNS discovery)
  app:
    network_mode: bridge   # default, don't need to specify

  # Host: container shares host network stack (no port mapping needed)
  # Use for: monitoring agents, network tools, max performance
  monitoring-agent:
    network_mode: host

  # None: no networking (for batch jobs, security-sensitive processes)
  batch-processor:
    network_mode: none
```

### 9.4 Expose vs Ports

```yaml
services:
  app:
    # PORTS: maps container port to host — accessible from outside
    ports:
      - "8080:8080"      # host:container
      - "127.0.0.1:9090:9090"  # bind to localhost only (not exposed to network)

    # EXPOSE: documentation only in Compose — other services use the port directly
    expose:
      - "8080"

  db:
    # WRONG: database accessible from host network
    ports:
      - "5432:5432"

    # CORRECT: no ports mapping — only accessible from other services on same network
    expose:
      - "5432"
```

---

## 10. Development vs Production Compose

### 10.1 Override Pattern

Compose v2 automatically loads `compose.yml` + `compose.override.yml`.

```yaml
# compose.yml — base (production-ready)
services:
  app:
    image: ghcr.io/myorg/myapp:latest
    restart: unless-stopped
    environment:
      APP_ENV: production

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

```yaml
# compose.override.yml — development overrides (auto-loaded)
services:
  app:
    build:
      context: .
      target: dev
    image: myapp:dev
    volumes:
      - .:/app                # mount source for hot reload
    ports:
      - "8080:8080"
      - "5173:5173"           # Vite dev server
    environment:
      APP_ENV: local
      APP_DEBUG: "true"

  db:
    ports:
      - "5432:5432"           # expose DB for local tools

  mailpit:
    image: axllent/mailpit
    ports:
      - "8025:8025"
      - "1025:1025"
```

```bash
# Development (loads compose.yml + compose.override.yml automatically)
docker compose up

# Production (explicit — skips override)
docker compose -f compose.yml up -d

# Staging (base + staging overrides)
docker compose -f compose.yml -f compose.staging.yml up -d
```

### 10.2 WRONG/CORRECT: Development Compose

```yaml
# WRONG: using production image in dev (no hot reload, slow rebuild)
services:
  app:
    build:
      context: .
      target: production
    # Source code is baked into image — must rebuild on every change

# CORRECT: dev target with volume mount
services:
  app:
    build:
      context: .
      target: dev
    volumes:
      - .:/app
      - /app/node_modules     # anonymous volume prevents overwriting node_modules from host
    command: npm run dev
```

---

## 11. Resource Limits

### 11.1 Memory and CPU Limits

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"
        reservations:
          memory: 256M
          cpus: "0.25"

  db:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "2.0"

  redis:
    deploy:
      resources:
        limits:
          memory: 256M
```

### 11.2 OOM Prevention

```yaml
# WRONG: no limits — a memory leak takes down the host
services:
  app:
    image: myapp:latest
    # no resource limits

# CORRECT: set limits, let Docker kill the container before it kills the host
services:
  app:
    image: myapp:latest
    deploy:
      resources:
        limits:
          memory: 512M
    # Docker sends SIGKILL at 512M — your app restarts instead of crashing the host
    restart: unless-stopped
```

---

## 12. Useful Commands Reference

### Build Commands

```bash
# Build with no cache
docker build --no-cache -t myapp .

# Build specific target
docker build --target dev -t myapp:dev .

# Build with build args
docker build --build-arg NODE_ENV=production -t myapp .

# Build with secret
docker build --secret id=npm_token,src=.npmrc -t myapp .

# Multi-platform build (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 -t myapp:latest --push .
```

### Compose Commands

```bash
# Start services (detached)
docker compose up -d

# Start with rebuild
docker compose up -d --build

# Stop and remove containers + networks
docker compose down

# Stop and remove containers + networks + volumes (DESTROYS DATA)
docker compose down -v

# View logs (follow)
docker compose logs -f app

# View logs (last 100 lines)
docker compose logs --tail=100 app

# Execute command in running container
docker compose exec app sh
docker compose exec app php artisan migrate

# Run one-off command (creates new container)
docker compose run --rm app npm test

# Scale a service
docker compose up -d --scale worker=3

# Show resource usage
docker compose stats
```

### Debugging Commands

```bash
# List all containers (including stopped)
docker ps -a

# Inspect container details (env vars, mounts, network)
docker inspect <container>

# View container filesystem changes
docker diff <container>

# Copy files to/from container
docker cp <container>:/path/to/file ./local-file
docker cp ./local-file <container>:/path/to/file

# Execute shell in running container
docker exec -it <container> sh

# View image layers and sizes
docker history myapp:latest

# Prune everything (unused images, containers, networks, build cache)
docker system prune -a --volumes

# Check disk usage
docker system df
```

### Image Management

```bash
# Tag image for registry
docker tag myapp:latest ghcr.io/myorg/myapp:v1.2.3
docker tag myapp:latest ghcr.io/myorg/myapp:latest

# Push to registry
docker push ghcr.io/myorg/myapp:v1.2.3
docker push ghcr.io/myorg/myapp:latest

# Save/load images (for offline transfer)
docker save myapp:latest | gzip > myapp.tar.gz
docker load < myapp.tar.gz
```
