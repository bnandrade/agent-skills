# Infrastructure

VPS setup, reverse proxies, DNS, databases, Redis, backups, disaster recovery, scaling, and ongoing maintenance.

---

## Table of Contents

1. [VPS Initial Setup](#1-vps-initial-setup)
2. [Reverse Proxy Comparison](#2-reverse-proxy-comparison)
3. [Caddy Configuration](#3-caddy-configuration)
4. [Nginx Configuration](#4-nginx-configuration)
5. [Traefik with Docker](#5-traefik-with-docker)
6. [DNS Configuration](#6-dns-configuration)
7. [Database Hosting](#7-database-hosting)
8. [Redis in Production](#8-redis-in-production)
9. [Backup Strategies](#9-backup-strategies)
10. [Disaster Recovery](#10-disaster-recovery)
11. [Scaling Strategies](#11-scaling-strategies)
12. [Coolify Setup](#12-coolify-setup)
13. [Cost Optimization](#13-cost-optimization)
14. [Maintenance Windows and Update Strategy](#14-maintenance-windows-and-update-strategy)

---

## 1. VPS Initial Setup

Run on a fresh Ubuntu 24.04 / Debian 12 VPS (Hetzner, DigitalOcean, etc.):

### 1.1 Initial Setup Script

```bash
#!/bin/bash
# vps-setup.sh — run as root on a fresh server
set -euo pipefail

# --- Variables (change these) ---
NEW_USER="deploy"
SSH_PORT="2222"
TIMEZONE="UTC"

# --- System updates ---
apt update && apt upgrade -y
apt install -y \
  curl wget git unzip htop ncdu \
  ufw fail2ban \
  ca-certificates gnupg

# --- Timezone ---
timedatectl set-timezone "$TIMEZONE"

# --- Create deploy user ---
adduser --disabled-password --gecos "" "$NEW_USER"
usermod -aG sudo "$NEW_USER"

# Copy SSH keys from root to new user
mkdir -p /home/$NEW_USER/.ssh
cp /root/.ssh/authorized_keys /home/$NEW_USER/.ssh/
chown -R $NEW_USER:$NEW_USER /home/$NEW_USER/.ssh
chmod 700 /home/$NEW_USER/.ssh
chmod 600 /home/$NEW_USER/.ssh/authorized_keys

# Allow passwordless sudo for deploy user
echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$NEW_USER

# --- SSH Hardening ---
cat > /etc/ssh/sshd_config.d/hardened.conf << EOF
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 20
AllowUsers $NEW_USER
X11Forwarding no
EOF
systemctl restart sshd

# --- Firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow $SSH_PORT/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- Fail2ban ---
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = $SSH_PORT
maxretry = 3
bantime = 86400
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# --- Swap (2GB — for servers with limited RAM) ---
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Reduce swappiness (prefer RAM)
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    sysctl -p
fi

# --- Docker ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker "$NEW_USER"

# --- Automatic security updates ---
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

echo "=== Setup complete ==="
echo "SSH: ssh -p $SSH_PORT $NEW_USER@$(curl -s ifconfig.me)"
echo "IMPORTANT: Test SSH in a NEW terminal before closing this session!"
```

### 1.2 Post-Setup Verification

```bash
# From your LOCAL machine — test SSH with new user BEFORE closing root session
ssh -p 2222 deploy@your-server-ip

# On server — verify everything
sudo ufw status
sudo fail2ban-client status sshd
docker run hello-world
free -h    # check swap
df -h      # check disk
```

---

## 2. Reverse Proxy Comparison

| Feature | Caddy | Nginx | Traefik |
|---|---|---|---|
| Auto HTTPS | Built-in (default) | Manual (Certbot) | Built-in (config) |
| Config format | Caddyfile (simple) | nginx.conf (powerful) | YAML/TOML + labels |
| Docker integration | Manual | Manual | Auto-discovery |
| Performance | Excellent | Best (C, event-driven) | Very good |
| Memory usage | ~30 MB | ~5 MB | ~50 MB |
| HTTP/3 | Built-in | Requires build flag | Built-in |
| Best for | Simplicity, auto-HTTPS | High traffic, fine control | Docker-native, microservices |
| Learning curve | Low | Medium | Medium |

```
# Decision guide:
# - Default choice: Caddy (auto-HTTPS, simple, good enough for 99% of projects)
# - High traffic / legacy / fine control: Nginx
# - Docker Swarm / many services / auto-discovery: Traefik
# - Don't use more than one. Pick one and stick with it.
```

---

## 3. Caddy Configuration

### 3.1 Basic Reverse Proxy with Auto-HTTPS

```
# Caddyfile — drop-in production config
myapp.com {
    reverse_proxy app:8080
}
```

That's it. Caddy automatically: obtains Let's Encrypt certificate, serves HTTPS, redirects HTTP to HTTPS, renews certificates, enables HTTP/2 and HTTP/3.

### 3.2 Full Production Caddyfile

```
# Global options
{
    email admin@myapp.com          # Let's Encrypt registration email
    acme_ca https://acme-v02.api.letsencrypt.org/directory
}

# Main application
myapp.com {
    # Security headers
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    # Gzip + Zstd compression
    encode zstd gzip

    # Reverse proxy to app
    reverse_proxy app:8080 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}

        # Health check — remove unhealthy backends
        health_uri /health
        health_interval 30s
        health_timeout 5s

        # Load balancing (multiple backends)
        # lb_policy round_robin
    }

    # Access log
    log {
        output file /var/log/caddy/access.log {
            roll_size 50mb
            roll_keep 5
        }
        format json
    }
}

# API subdomain
api.myapp.com {
    reverse_proxy api:3000

    # Stricter rate limiting for API
    # (requires caddy-ratelimit module)
}

# Static files / CDN origin
static.myapp.com {
    root * /srv/static
    file_server {
        precompressed gzip br
    }

    header {
        Cache-Control "public, max-age=31536000, immutable"
    }
}

# Grafana dashboard (internal)
grafana.myapp.com {
    basicauth {
        admin $2a$14$...  # caddy hash-password
    }
    reverse_proxy grafana:3000
}
```

### 3.3 Caddy in Docker Compose

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"     # HTTP/3 (QUIC)
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data   # certificates
      - caddy_config:/config
      - static_files:/srv/static:ro
    restart: unless-stopped
    networks:
      - web

  app:
    image: myapp:latest
    expose:
      - "8080"             # NOT ports — internal only
    networks:
      - web
      - internal

  db:
    image: postgres:17-alpine
    # NO ports exposed — only accessible from internal network
    networks:
      - internal
    volumes:
      - db_data:/var/lib/postgresql/data

networks:
  web:       # Caddy + app (public-facing)
  internal:  # app + db (private)

volumes:
  caddy_data:
  caddy_config:
  static_files:
  db_data:
```

---

## 4. Nginx Configuration

### 4.1 Virtual Host with Reverse Proxy

```nginx
# /etc/nginx/sites-available/myapp.conf
upstream app_backend {
    server 127.0.0.1:8080;
    # Multiple backends for load balancing:
    # server 127.0.0.1:8081;
    # server 127.0.0.1:8082;
}

server {
    listen 443 ssl http2;
    server_name myapp.com;

    # SSL (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/myapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    include /etc/nginx/snippets/security-headers.conf;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1000;
    gzip_vary on;

    # Proxy to app
    location / {
        proxy_pass http://app_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static files with caching
    location /static/ {
        alias /var/www/myapp/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Health check (no logging)
    location /health {
        proxy_pass http://app_backend;
        access_log off;
    }

    # Block common exploits
    location ~ /\.(env|git|htaccess|htpasswd) {
        deny all;
        return 404;
    }

    # Client body size (file uploads)
    client_max_body_size 50M;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name myapp.com;
    return 301 https://$server_name$request_uri;
}
```

### 4.2 Nginx Caching (Reverse Proxy Cache)

```nginx
# /etc/nginx/nginx.conf — add in http block
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:10m max_size=1g inactive=60m;

# In server block
location /api/ {
    proxy_pass http://app_backend;
    proxy_cache app_cache;
    proxy_cache_valid 200 10m;
    proxy_cache_valid 404 1m;
    proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504;
    proxy_cache_bypass $http_cache_control;
    add_header X-Cache-Status $upstream_cache_status;
}
```

### 4.3 Enable and Test

```bash
# Enable site
ln -s /etc/nginx/sites-available/myapp.conf /etc/nginx/sites-enabled/

# Test configuration BEFORE reloading
nginx -t

# Reload (zero-downtime)
systemctl reload nginx
```

---

## 5. Traefik with Docker

### 5.1 Traefik Docker Compose Setup

Traefik auto-discovers Docker containers via labels — no manual config per service.

```yaml
# docker-compose.yml
services:
  traefik:
    image: traefik:v3.3
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@myapp.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      # HTTP → HTTPS redirect
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/letsencrypt
    labels:
      # Dashboard (optional, protect with auth)
      - "traefik.enable=true"
      - "traefik.http.routers.dashboard.rule=Host(`traefik.myapp.com`)"
      - "traefik.http.routers.dashboard.service=api@internal"
      - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
      - "traefik.http.routers.dashboard.middlewares=auth"
      - "traefik.http.middlewares.auth.basicauth.users=admin:$$2y$$..."
    restart: unless-stopped

  app:
    image: myapp:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`myapp.com`)"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=8080"
      # Security headers middleware
      - "traefik.http.middlewares.security.headers.stsSeconds=63072000"
      - "traefik.http.middlewares.security.headers.stsIncludeSubdomains=true"
      - "traefik.http.middlewares.security.headers.frameDeny=true"
      - "traefik.http.middlewares.security.headers.contentTypeNosniff=true"
      - "traefik.http.routers.app.middlewares=security"
    restart: unless-stopped

  api:
    image: myapi:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.myapp.com`)"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      - "traefik.http.services.api.loadbalancer.server.port=3000"
    restart: unless-stopped

volumes:
  traefik_certs:
```

### 5.2 Adding a New Service (Just Add Labels)

```yaml
# To add a new service, just add labels — Traefik discovers it automatically
  blog:
    image: ghost:5
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.blog.rule=Host(`blog.myapp.com`)"
      - "traefik.http.routers.blog.tls.certresolver=letsencrypt"
      - "traefik.http.services.blog.loadbalancer.server.port=2368"
```

---

## 6. DNS Configuration

### 6.1 Essential Records

```
# A Records — point domain to server IP
myapp.com.           A     203.0.113.50
www.myapp.com.       A     203.0.113.50
api.myapp.com.       A     203.0.113.50

# CNAME — alias to another domain (can't be used on root domain)
www.myapp.com.       CNAME myapp.com.
blog.myapp.com.      CNAME myapp.com.

# MX — email routing
myapp.com.           MX    10 mx1.emailprovider.com.
myapp.com.           MX    20 mx2.emailprovider.com.

# TXT — SPF, DKIM, verification
myapp.com.           TXT   "v=spf1 include:_spf.google.com ~all"
myapp.com.           TXT   "google-site-verification=abc123"
```

### 6.2 TTL Strategy

```
# WRONG: long TTL during migration (can't update quickly)
myapp.com.  86400  A  203.0.113.50    # 24h TTL — stuck for a day if IP changes

# CORRECT: lower TTL before migration, raise after
# Before migration (24h in advance):
myapp.com.  300    A  203.0.113.50    # 5 min TTL
# Migrate:
myapp.com.  300    A  198.51.100.25   # new IP, propagates in ~5 min
# After stable (24h later):
myapp.com.  3600   A  198.51.100.25   # back to 1h TTL

# Recommended defaults:
# Production (stable): 3600 (1 hour)
# Staging: 300 (5 minutes)
# During migrations: 60-300 (1-5 minutes)
```

### 6.3 Cloudflare Setup

```
# Cloudflare provides: CDN, DDoS protection, DNS, WAF

# DNS settings:
# Orange cloud (proxied) — traffic goes through Cloudflare
# Grey cloud (DNS only) — direct to your server

# Recommended:
# myapp.com        → Proxied (orange) — benefits from CDN + protection
# api.myapp.com    → Proxied (orange) — DDoS protection
# mail.myapp.com   → DNS only (grey) — email can't go through proxy
# grafana.myapp.com → DNS only (grey) — internal tools

# SSL/TLS mode:
# WRONG: "Flexible" — Cloudflare to your server is HTTP (insecure!)
# CORRECT: "Full (Strict)" — end-to-end HTTPS with valid cert

# Page Rules / Cache Rules:
# /static/* → Cache Everything, Edge TTL: 1 month
# /api/*    → Bypass Cache
```

---

## 7. Database Hosting

### 7.1 Managed vs Self-Hosted

| Aspect | Managed (Neon, PlanetScale, RDS) | Self-Hosted (Docker) |
|---|---|---|
| Backups | Automatic, point-in-time | You manage |
| High availability | Built-in | You configure |
| Scaling | One click / automatic | Manual |
| Cost | Higher ($15-50+/mo) | VPS cost only |
| Maintenance | Zero | Upgrades, monitoring |
| Best for | Production, teams | Dev, budget projects, single-server |

```
# Decision:
# Budget < $50/mo total → self-hosted on same VPS
# Production app with paying users → managed database
# Need read replicas or auto-scaling → managed (always)
```

### 7.2 PostgreSQL Backup Strategy

```bash
#!/bin/bash
# /usr/local/bin/backup-db.sh
set -euo pipefail

BACKUP_DIR="/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30
S3_BUCKET="s3://myapp-backups/postgres"

mkdir -p "$BACKUP_DIR"

# Dump database
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/db_${TIMESTAMP}.sql.gz"

# Upload to S3
aws s3 cp "$BACKUP_DIR/db_${TIMESTAMP}.sql.gz" "$S3_BUCKET/db_${TIMESTAMP}.sql.gz"

# Delete local backups older than retention period
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Delete S3 backups older than retention period (via lifecycle policy is better)
echo "Backup completed: db_${TIMESTAMP}.sql.gz"
```

```bash
# Cron: daily at 3 AM, plus hourly during business hours
0 3 * * * /usr/local/bin/backup-db.sh >> /var/log/backup.log 2>&1
0 9-18 * * 1-5 /usr/local/bin/backup-db.sh >> /var/log/backup.log 2>&1
```

### 7.3 Docker PostgreSQL with Persistence

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${DB_DATABASE}
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # initial schema
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USERNAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    # WRONG: expose to internet
    # ports:
    #   - "5432:5432"
    # CORRECT: only accessible from Docker network
    expose:
      - "5432"
    deploy:
      resources:
        limits:
          memory: 512M
    restart: unless-stopped

volumes:
  postgres_data:
```

---

## 8. Redis in Production

### 8.1 Redis Configuration

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    command: redis-server /usr/local/etc/redis/redis.conf
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 256M
    restart: unless-stopped

volumes:
  redis_data:
```

```
# redis.conf
# Memory
maxmemory 200mb
maxmemory-policy allkeys-lru    # evict least recently used when full

# Persistence (choose one)
# Option A: RDB snapshots (good for cache, faster restarts)
save 900 1        # save if 1 key changed in 15 min
save 300 10       # save if 10 keys changed in 5 min
save 60 10000     # save if 10000 keys changed in 1 min

# Option B: AOF (good for queues/sessions, less data loss)
appendonly yes
appendfsync everysec

# Security
requirepass ${REDIS_PASSWORD}
# Or bind to localhost / Docker network only
bind 0.0.0.0
protected-mode yes

# Performance
tcp-keepalive 300
timeout 0
```

### 8.2 Redis Security

```bash
# WRONG: Redis exposed to internet without password
docker run -p 6379:6379 redis

# CORRECT: internal network only + password
docker run --network internal redis redis-server --requirepass "$REDIS_PASSWORD"

# WRONG: using Redis default port exposed publicly
# Redis bots scan port 6379 and will compromise unprotected instances within MINUTES

# CORRECT: never expose Redis to internet. Docker network or localhost only.
```

---

## 9. Backup Strategies

### 9.1 Backup Hierarchy

| What | Frequency | Method | Retention |
|---|---|---|---|
| Database | Daily + hourly (business hours) | pg_dump / mysqldump → S3 | 30 days |
| User uploads | Real-time | Sync to S3 / rsync | Indefinite |
| Application config | On change | Git (infra repo) | Git history |
| Full server | Weekly | VPS snapshot | 4 snapshots |
| Secrets | On change | Secret manager history | 90 days |

### 9.2 Full Backup Script

```bash
#!/bin/bash
# /usr/local/bin/full-backup.sh
set -euo pipefail

S3_BUCKET="s3://myapp-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/backup_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting full backup..."

# 1. Database
echo "Backing up database..."
docker compose exec -T db pg_dumpall -U postgres | gzip > "$BACKUP_DIR/database.sql.gz"

# 2. Application data (uploads, storage)
echo "Backing up uploads..."
tar czf "$BACKUP_DIR/uploads.tar.gz" -C /var/www/myapp storage/app/public

# 3. Configuration files
echo "Backing up configs..."
tar czf "$BACKUP_DIR/configs.tar.gz" \
  /opt/myapp/docker-compose.yml \
  /opt/myapp/Caddyfile \
  /opt/myapp/.env.example \
  /etc/fail2ban/jail.local

# 4. Upload to S3
echo "Uploading to S3..."
aws s3 sync "$BACKUP_DIR" "$S3_BUCKET/full/${TIMESTAMP}/"

# 5. Cleanup
rm -rf "$BACKUP_DIR"

# 6. Verify (download and check)
VERIFY_FILE=$(aws s3 ls "$S3_BUCKET/full/${TIMESTAMP}/" | head -1 | awk '{print $4}')
echo "Verifying: $VERIFY_FILE"
aws s3 cp "$S3_BUCKET/full/${TIMESTAMP}/$VERIFY_FILE" /tmp/verify_backup.gz
gunzip -t /tmp/verify_backup.gz && echo "Backup verified OK" || echo "BACKUP VERIFICATION FAILED"
rm -f /tmp/verify_backup.gz

echo "[$(date)] Backup completed: $S3_BUCKET/full/${TIMESTAMP}/"
```

### 9.3 Test Restores (Critical)

```bash
#!/bin/bash
# /usr/local/bin/test-restore.sh — run monthly
# A backup you've never restored is NOT a backup

set -euo pipefail

S3_BUCKET="s3://myapp-backups"
LATEST=$(aws s3 ls "$S3_BUCKET/full/" | sort | tail -1 | awk '{print $2}')

echo "Testing restore of: $LATEST"

# Download latest backup
mkdir -p /tmp/restore_test
aws s3 sync "$S3_BUCKET/full/$LATEST" /tmp/restore_test/

# Test database restore
gunzip -c /tmp/restore_test/database.sql.gz | \
  docker run --rm -i postgres:17-alpine psql -U postgres > /dev/null 2>&1
echo "Database restore: OK"

# Test archive integrity
tar tzf /tmp/restore_test/uploads.tar.gz > /dev/null
echo "Uploads archive: OK"

tar tzf /tmp/restore_test/configs.tar.gz > /dev/null
echo "Configs archive: OK"

# Cleanup
rm -rf /tmp/restore_test
echo "Restore test completed successfully"
```

---

## 10. Disaster Recovery

### 10.1 Key Metrics

| Metric | Definition | Target |
|---|---|---|
| **RTO** (Recovery Time Objective) | Max acceptable downtime | 1 hour |
| **RPO** (Recovery Point Objective) | Max acceptable data loss | 1 hour (hourly backups) |

### 10.2 Disaster Recovery Runbook

```markdown
# Disaster Recovery Runbook — myapp.com

## Scenario: Server is unrecoverable

### Pre-requisites (must be accessible without the server)
- [ ] S3 backup access (AWS credentials in password manager)
- [ ] DNS access (Cloudflare credentials in password manager)
- [ ] Docker images in registry (ghcr.io/myorg/myapp)
- [ ] Secret manager access (Doppler)
- [ ] This runbook (printed or in separate location)

### Steps (target: 1 hour)

1. **Provision new VPS** (10 min)
   - Hetzner: CPX31 (4 vCPU, 8 GB, 160 GB) — same or bigger than current
   - Run vps-setup.sh
   - Note new IP address

2. **Update DNS** (5 min — already lowered TTL)
   - Cloudflare: update A record to new IP
   - TTL: 60 seconds (for fast propagation)

3. **Deploy application** (10 min)
   - git clone infrastructure repo
   - doppler run -- docker compose up -d

4. **Restore database** (15 min)
   - Download latest backup from S3
   - gunzip -c database.sql.gz | docker compose exec -T db psql -U postgres

5. **Restore uploads** (10 min)
   - Download uploads.tar.gz from S3
   - Extract to correct volume

6. **Verify** (10 min)
   - [ ] Homepage loads
   - [ ] Login works
   - [ ] Recent data visible (check against RPO)
   - [ ] Payments processing
   - [ ] Email sending

7. **Post-recovery**
   - [ ] Update monitoring endpoints
   - [ ] Run full test suite against production
   - [ ] Post-mortem within 48 hours
   - [ ] Raise DNS TTL back to 3600
```

---

## 11. Scaling Strategies

### 11.1 Scaling Ladder

```
# Scale in this order — each step handles 10x more load:

Step 0: Single VPS
├── App + DB + Redis on one server
├── Handles: ~100 concurrent users
└── Cost: $5-20/mo

Step 1: Vertical scaling
├── Bigger VPS (more CPU, RAM)
├── Handles: ~500 concurrent users
└── Cost: $20-80/mo

Step 2: Separate database
├── Managed DB (Neon, RDS) + VPS for app
├── Handles: ~2,000 concurrent users
└── Cost: $50-150/mo

Step 3: CDN + caching
├── Cloudflare CDN + Redis caching
├── Handles: ~10,000 concurrent users
└── Cost: $50-200/mo

Step 4: Horizontal scaling
├── Load balancer + multiple app servers
├── Handles: ~50,000 concurrent users
└── Cost: $200-500/mo

Step 5: Read replicas + queue offloading
├── DB read replicas + async job processing
├── Handles: ~200,000+ concurrent users
└── Cost: $500-2,000/mo

# Rule: Don't jump steps. Most apps never need past step 2-3.
```

### 11.2 Horizontal Scaling with Docker

```yaml
# docker-compose.yml — multiple app instances behind Caddy
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    restart: unless-stopped

  app:
    image: myapp:latest
    deploy:
      replicas: 3           # 3 instances
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
    expose:
      - "8080"
    restart: unless-stopped
```

```
# Caddyfile — load balance across replicas
myapp.com {
    reverse_proxy app:8080 {
        lb_policy round_robin
        health_uri /health
        health_interval 10s
    }
}
```

---

## 12. Coolify Setup

Coolify is a self-hosted PaaS (like Heroku but on your own server).

### 12.1 Installation

```bash
# On a fresh VPS (minimum 2 CPU, 4 GB RAM)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Access dashboard at http://your-server-ip:8000
# Follow setup wizard
```

### 12.2 Deploy from GitHub

```
# In Coolify dashboard:
# 1. Connect GitHub account
# 2. Select repository
# 3. Configure:
#    - Build pack: Dockerfile (or Nixpacks for auto-detection)
#    - Port: 8080
#    - Domain: myapp.com (auto-configures SSL)
#    - Environment variables (or connect to Doppler)
# 4. Deploy

# Coolify auto-configures:
# - Traefik reverse proxy
# - Let's Encrypt SSL
# - GitHub webhook for auto-deploy on push
# - Health checks
# - Container management
```

### 12.3 Coolify vs Alternatives

| Feature | Coolify | Laravel Forge | Railway | Dokku |
|---|---|---|---|---|
| Self-hosted | Yes (free) | No ($12/mo) | No (usage-based) | Yes (free) |
| Auto-deploy | Yes | Yes | Yes | Yes |
| Database mgmt | Yes | Yes | Yes | Plugins |
| Team features | Yes | Yes | Yes | No |
| UI dashboard | Yes | Yes | Yes | CLI only |
| Best for | Full control, budget | Laravel teams | Quick prototypes | Heroku-like CLI |

---

## 13. Cost Optimization

### 13.1 VPS Provider Comparison (2026 Prices)

| Provider | 4 vCPU / 8 GB | Bandwidth | Best For |
|---|---|---|---|
| Hetzner | ~$15/mo | 20 TB | Best price/performance (EU/US) |
| DigitalOcean | ~$48/mo | 5 TB | Developer experience, docs |
| AWS EC2 (t3.large) | ~$60/mo | Pay per GB | AWS ecosystem integration |
| Vultr | ~$48/mo | 6 TB | Global locations |

### 13.2 Cost-Saving Tips

```
# 1. Right-size your VPS
# Start small. Monitor actual usage for 2 weeks. Upgrade only if needed.
# Most apps run fine on 2 vCPU / 4 GB ($10-20/mo).

# 2. Use Hetzner for non-latency-critical workloads
# 3-4x cheaper than DigitalOcean/AWS for equivalent specs.

# 3. Managed database only when justified
# Self-hosted PostgreSQL on the same VPS saves $15-50/mo
# Use managed when you need HA, auto-backups, or read replicas.

# 4. Cloudflare for CDN (free tier)
# Caches static assets, reduces bandwidth costs.

# 5. GitHub Container Registry (free for public repos)
# Use GHCR instead of Docker Hub for image hosting.

# 6. Use spot/preemptible instances for CI
# GitHub Actions is free for public repos.
# Self-hosted runners on spot instances for private repos.
```

### 13.3 Monthly Budget Template

```
# Small SaaS — monthly infrastructure cost
VPS (Hetzner CPX21, 3 vCPU, 4 GB)     €8.50
Managed DB (Neon free tier)             €0.00
Domain (annual / 12)                    €1.00
Sentry (free tier)                      €0.00
UptimeRobot (free tier)                 €0.00
Cloudflare (free tier)                  €0.00
Doppler (free tier, 5 users)            €0.00
Email (Resend, 3k/mo free)             €0.00
S3 backups (~5 GB)                      €0.12
---
Total                                  ~€10/mo

# Growing SaaS — monthly infrastructure cost
VPS x2 (Hetzner CPX31, 4 vCPU, 8 GB)  €34.00
Managed DB (Neon launch plan)           €19.00
Domain                                  €1.00
Sentry (team plan)                      €26.00
Better Stack (monitoring + logs)        €24.00
Cloudflare Pro                          €20.00
Doppler (team plan)                     €18.00
Email (Resend, 50k/mo)                 €20.00
S3 backups (~50 GB)                     €1.15
---
Total                                 ~€163/mo
```

---

## 14. Maintenance Windows and Update Strategy

### 14.1 Update Categories

| Category | Frequency | Downtime | Process |
|---|---|---|---|
| Security patches (OS) | Automatic (unattended-upgrades) | None (usually) | Auto |
| Docker image updates | Weekly check | None (rolling) | Manual review |
| Application deploys | As needed | None (blue-green) | CI/CD |
| Database migrations | With deploy | Brief (seconds) | CI/CD |
| Major upgrades (OS, DB) | Quarterly | Planned window | Manual |
| SSL certificate renewal | Auto (Caddy/Certbot) | None | Auto |

### 14.2 Unattended Security Updates

```bash
# Already installed in VPS setup script, but verify:
cat /etc/apt/apt.conf.d/50unattended-upgrades

# Key settings:
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";  # don't auto-reboot
Unattended-Upgrade::Automatic-Reboot-Time "03:00";  # if enabled
```

### 14.3 Docker Image Update Workflow

```bash
#!/bin/bash
# /usr/local/bin/check-image-updates.sh
# Run weekly via cron — alerts if updates available

COMPOSE_FILE="/opt/myapp/docker-compose.yml"
cd /opt/myapp

# Pull latest images and check for changes
UPDATES=$(docker compose pull 2>&1 | grep -c "Downloaded newer image" || true)

if [ "$UPDATES" -gt 0 ]; then
    echo "$UPDATES image(s) have updates available."
    # Notify via Slack
    curl -s -X POST "$SLACK_WEBHOOK" \
        -H 'Content-type: application/json' \
        -d "{\"text\": \"Docker image updates available for myapp ($UPDATES images). Review and deploy.\"}"
else
    echo "All images up to date."
fi
```

### 14.4 Zero-Downtime Deploy Script

```bash
#!/bin/bash
# /usr/local/bin/deploy.sh
set -euo pipefail

APP_DIR="/opt/myapp"
cd "$APP_DIR"

echo "[$(date)] Starting deployment..."

# 1. Pull new images
docker compose pull app

# 2. Run database migrations (if any)
docker compose run --rm app migrate

# 3. Rolling update (one container at a time)
docker compose up -d --no-deps --scale app=2 app
sleep 10  # wait for new container to be healthy

# Health check new container
if ! docker compose exec app wget -q --spider http://localhost:8080/health; then
    echo "DEPLOY FAILED: new container unhealthy. Rolling back."
    docker compose up -d --no-deps app
    exit 1
fi

# 4. Remove old container
docker compose up -d --no-deps --scale app=1 app

# 5. Cleanup
docker image prune -f

echo "[$(date)] Deployment completed successfully."
```

### 14.5 Maintenance Checklist (Monthly)

```bash
#!/bin/bash
# /usr/local/bin/monthly-maintenance.sh
set -euo pipefail

echo "=== Monthly Maintenance: $(date +%Y-%m) ==="

# 1. Disk usage
echo "--- Disk Usage ---"
df -h /
docker system df

# 2. Clean Docker artifacts
echo "--- Docker Cleanup ---"
docker system prune -f --volumes  # remove unused images, networks, volumes
# WARNING: --volumes removes unused named volumes. Remove flag if volumes have data.

# 3. Check for OS updates
echo "--- OS Updates ---"
apt list --upgradable 2>/dev/null

# 4. Check SSL certificate expiry
echo "--- SSL Certificates ---"
echo | openssl s_client -servername myapp.com -connect myapp.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# 5. Check backup integrity
echo "--- Backup Verification ---"
/usr/local/bin/test-restore.sh

# 6. Review logs for anomalies
echo "--- Recent Errors ---"
docker compose logs --since 720h 2>/dev/null | grep -i "error\|panic\|fatal" | tail -20

# 7. Security audit
echo "--- Failed SSH Attempts ---"
journalctl -u sshd --since "30 days ago" | grep "Failed" | wc -l

echo "=== Maintenance complete ==="
```
