# Reverse Proxies

Production configurations for Caddy (recommended), Nginx, and Traefik. Covers auto-HTTPS, reverse proxy patterns, WebSocket, load balancing, rate limiting, and complete production examples for Laravel and Go apps.

---

## Table of Contents

1. [Comparison: Caddy vs Nginx vs Traefik](#1-comparison-caddy-vs-nginx-vs-traefik)
2. [Caddy (Recommended)](#2-caddy-recommended)
3. [Caddy Production Examples](#3-caddy-production-examples)
4. [Nginx (When You Need It)](#4-nginx-when-you-need-it)
5. [Nginx Production Examples](#5-nginx-production-examples)
6. [Traefik (Docker-Native)](#6-traefik-docker-native)
7. [Load Balancing](#7-load-balancing)

---

## 1. Comparison: Caddy vs Nginx vs Traefik

| Feature | Caddy | Nginx | Traefik |
|---|---|---|---|
| Auto-HTTPS | Yes (zero config) | No (Certbot/manual) | Yes (with config) |
| Config language | Caddyfile (simple) | nginx.conf (complex) | YAML/TOML/Docker labels |
| HTTP/3 (QUIC) | Yes (default) | Experimental | Yes |
| Performance | Excellent | Excellent (slightly faster raw) | Good |
| Docker integration | Good | Manual | Native (auto-discovery) |
| Memory usage | ~30MB | ~10MB | ~50MB |
| Config reload | `caddy reload` (zero downtime) | `nginx -s reload` | Automatic |
| Plugin ecosystem | Growing | Massive | Good (middleware) |
| WebSocket proxy | Yes (automatic) | Yes (manual config) | Yes |
| Written in | Go | C | Go |
| License | Apache 2.0 | BSD-2 | MIT |

### When to Use What

| Scenario | Choice | Why |
|---|---|---|
| New project, any size | **Caddy** | Auto-HTTPS, simple config, modern defaults |
| Legacy system, existing Nginx | **Nginx** | Migration cost isn't worth it if it works |
| Need specific Nginx module | **Nginx** | GeoIP2, njs, Lua, ModSecurity (WAF) |
| Many Docker services, auto-discovery | **Traefik** | Labels-based routing, no config files per service |
| High-traffic API (100k+ req/s) | **Nginx** | Marginally better raw throughput |
| Homelab / BHEN platform | **Caddy** | Simplest setup, auto-HTTPS with Tailscale |

---

## 2. Caddy (Recommended)

### 2.1 Why Caddy

1. **Auto-HTTPS by default** — obtains and renews Let's Encrypt certs with zero config
2. **Simple config** — a Caddyfile is readable by non-ops people
3. **HTTP/3 enabled by default** — modern protocol, better mobile performance
4. **Automatic HTTP→HTTPS redirect** — no extra config
5. **OCSP stapling** — automatic
6. **Graceful reload** — `caddy reload` with zero downtime
7. **Written in Go** — single binary, easy to deploy, easy to extend

### 2.2 Installation

```bash
# Ubuntu/Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Or download binary
# https://caddyserver.com/download — select plugins and download

# With Cloudflare DNS plugin (for wildcard certs)
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
xcaddy build --with github.com/caddy-dns/cloudflare
sudo mv caddy /usr/bin/caddy
```

### 2.3 Caddyfile Syntax Essentials

```caddyfile
# Global options (optional)
{
    email admin@example.com       # Used for Let's Encrypt registration
    # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory  # Uncomment for testing
}

# Simple site
example.com {
    reverse_proxy localhost:8080
}

# With path matching
example.com {
    handle /api/* {
        reverse_proxy localhost:3000
    }
    handle {
        root * /var/www/frontend
        file_server
    }
}

# Named matchers
example.com {
    @api path /api/*
    @ws path /ws/*

    handle @api {
        reverse_proxy localhost:3000
    }
    handle @ws {
        reverse_proxy localhost:6001
    }
    handle {
        reverse_proxy localhost:8080
    }
}

# Environment variables
example.com {
    reverse_proxy {$BACKEND_HOST}:{$BACKEND_PORT}
}
```

### 2.4 Reverse Proxy to App Containers

```caddyfile
# Basic reverse proxy
example.com {
    reverse_proxy localhost:8080
}

# With health check
example.com {
    reverse_proxy localhost:8080 {
        health_uri /health
        health_interval 30s
        health_timeout 5s
    }
}

# Preserve original host header (important for Laravel)
example.com {
    reverse_proxy localhost:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# To Docker container by service name (if Caddy is in same Docker network)
example.com {
    reverse_proxy app:8080
}
```

### 2.5 Multiple Sites on One Server

```caddyfile
# Each site gets its own cert automatically
example.com {
    reverse_proxy localhost:8080
}

api.example.com {
    reverse_proxy localhost:3000
}

admin.example.com {
    basicauth {
        admin $2a$14$HASHED_PASSWORD_HERE
    }
    reverse_proxy localhost:8081
}

docs.example.com {
    root * /var/www/docs
    file_server
}
```

### 2.6 Wildcard Certificates (DNS Challenge)

```caddyfile
# Requires caddy-dns/cloudflare plugin
*.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }

    @api host api.example.com
    handle @api {
        reverse_proxy localhost:3000
    }

    @admin host admin.example.com
    handle @admin {
        reverse_proxy localhost:8081
    }

    @app host app.example.com
    handle @app {
        reverse_proxy localhost:8080
    }

    # Catch-all
    handle {
        respond "Not found" 404
    }
}
```

**Cloudflare API token for DNS challenge:**

1. Cloudflare dashboard > My Profile > API Tokens > Create Token
2. Use template "Edit zone DNS"
3. Scope to specific zone (your domain)
4. Copy the token

```bash
# Set as environment variable for Caddy
echo "CLOUDFLARE_API_TOKEN=your-token-here" | sudo tee -a /etc/caddy/env
# Reference in Caddyfile with {env.CLOUDFLARE_API_TOKEN}
```

### 2.7 Static File Serving with Compression

```caddyfile
static.example.com {
    root * /var/www/static

    # Enable compression (gzip + zstd)
    encode zstd gzip

    file_server {
        # Enable directory browsing (if wanted)
        # browse
    }

    # Cache static assets
    @static path *.css *.js *.png *.jpg *.jpeg *.gif *.svg *.woff *.woff2 *.ico
    header @static Cache-Control "public, max-age=31536000, immutable"

    # SPA fallback (serve index.html for unknown routes)
    try_files {path} /index.html
}
```

### 2.8 Security Headers in Caddy

```caddyfile
(security_headers) {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
        -X-Powered-By
    }
}

example.com {
    import security_headers
    reverse_proxy localhost:8080
}

api.example.com {
    import security_headers
    reverse_proxy localhost:3000
}
```

### 2.9 Rate Limiting

```caddyfile
# Requires caddy-ratelimit plugin
# xcaddy build --with github.com/mholt/caddy-ratelimit

example.com {
    # Global rate limit: 100 requests per second per IP
    rate_limit {remote.host} 100r/s

    reverse_proxy localhost:8080
}
```

**Without plugin — use Cloudflare rate limiting instead** (recommended when behind Cloudflare).

### 2.10 Basic Auth for Admin Panels

```bash
# Generate hashed password
caddy hash-password
# Enter password when prompted
# Output: $2a$14$...
```

```caddyfile
admin.example.com {
    basicauth {
        admin $2a$14$HASHED_PASSWORD_HERE
    }
    reverse_proxy localhost:8081
}

# Or protect specific paths
example.com {
    basicauth /admin/* {
        admin $2a$14$HASHED_PASSWORD_HERE
    }
    reverse_proxy localhost:8080
}
```

### 2.11 WebSocket Proxying

```caddyfile
# Caddy handles WebSocket automatically — no special config!
# Just reverse_proxy and it works.

example.com {
    # Laravel Reverb (WebSocket server)
    @ws path /app/* /apps/*
    handle @ws {
        reverse_proxy localhost:8080
    }

    # Laravel app
    handle {
        reverse_proxy localhost:8000
    }
}

# Explicit WebSocket config (if you need custom timeouts)
example.com {
    reverse_proxy /ws localhost:6001 {
        # Keep connection alive for WebSocket
        transport http {
            keepalive off
        }
    }
    reverse_proxy localhost:8080
}
```

### 2.12 File Upload Limits

```caddyfile
example.com {
    # Set max request body size (default is no limit in Caddy)
    request_body {
        max_size 100MB
    }

    reverse_proxy localhost:8080
}

# Different limits for different paths
example.com {
    @upload path /upload /api/upload
    handle @upload {
        request_body {
            max_size 500MB
        }
        reverse_proxy localhost:8080
    }

    handle {
        request_body {
            max_size 10MB
        }
        reverse_proxy localhost:8080
    }
}
```

### 2.13 Logging Configuration

```caddyfile
{
    log {
        output file /var/log/caddy/access.log {
            roll_size 100MiB
            roll_keep 10
            roll_keep_for 168h   # 7 days
        }
        format json
        level INFO
    }
}

# Per-site logging
example.com {
    log {
        output file /var/log/caddy/example.com.log {
            roll_size 50MiB
            roll_keep 5
        }
        format json
    }
    reverse_proxy localhost:8080
}
```

### 2.14 Caddy with Docker Compose

```yaml
# docker-compose.yml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"  # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data       # Certs are stored here
      - caddy_config:/config
    networks:
      - web

  app:
    build: .
    restart: unless-stopped
    expose:
      - "8080"    # NOT ports — only expose to Docker network
    networks:
      - web

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - web    # Same network so app can reach it
    # NO ports — not accessible from outside

networks:
  web:

volumes:
  caddy_data:
  caddy_config:
  pgdata:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

```caddyfile
# Caddyfile — reference Docker service names
example.com {
    reverse_proxy app:8080
}
```

```
# WRONG: using localhost in Caddyfile when Caddy is in Docker
reverse_proxy localhost:8080

# CORRECT: use Docker service name
reverse_proxy app:8080
```

### 2.15 Caddy Behind Cloudflare

```caddyfile
# Option 1: Cloudflare Origin Certificate (recommended)
example.com {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem

    # Trust Cloudflare's proxy headers
    # Cloudflare sends real client IP in CF-Connecting-IP
    reverse_proxy localhost:8080 {
        header_up X-Real-IP {header.CF-Connecting-IP}
        header_up X-Forwarded-For {header.CF-Connecting-IP}
    }
}

# Option 2: Let's Encrypt with DNS challenge (works even behind proxy)
example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy localhost:8080
}
```

**Set Cloudflare SSL mode to "Full (Strict)".** Never use "Flexible".

### 2.16 Caddy as API Gateway

```caddyfile
# Route different paths to different backends
api.example.com {
    # Auth service (Go)
    handle /auth/* {
        reverse_proxy auth-service:3001
    }

    # Users service (Go)
    handle /users/* {
        reverse_proxy users-service:3002
    }

    # Notifications service (Laravel)
    handle /notifications/* {
        reverse_proxy notifications-service:8000
    }

    # Default: 404
    handle {
        respond "Not found" 404
    }
}
```

---

## 3. Caddy Production Examples

### 3.1 Laravel App

```caddyfile
{
    email admin@example.com
}

(security_headers) {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
        -X-Powered-By
    }
}

example.com {
    import security_headers

    # Encode responses
    encode zstd gzip

    # File upload limit
    request_body {
        max_size 50MB
    }

    # Laravel Reverb WebSocket
    @reverb path /app/* /apps/*
    handle @reverb {
        reverse_proxy localhost:8080
    }

    # Laravel app via FPM (if using php-fpm directly)
    # root * /var/www/app/public
    # php_fastcgi unix//run/php/php8.4-fpm.sock
    # file_server

    # Laravel app via reverse proxy (if using artisan serve / Octane)
    reverse_proxy localhost:8000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    log {
        output file /var/log/caddy/example.com.log {
            roll_size 50MiB
            roll_keep 5
        }
        format json
    }
}
```

### 3.2 Laravel + React SPA

```caddyfile
{
    email admin@example.com
}

(security_headers) {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
        -X-Powered-By
    }
}

# API backend
api.example.com {
    import security_headers

    encode zstd gzip

    # CORS headers for SPA
    @cors_preflight method OPTIONS
    handle @cors_preflight {
        header Access-Control-Allow-Origin "https://example.com"
        header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With"
        header Access-Control-Max-Age "86400"
        respond 204
    }

    header Access-Control-Allow-Origin "https://example.com"

    reverse_proxy localhost:8000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# React SPA frontend
example.com {
    import security_headers

    encode zstd gzip

    root * /var/www/frontend/dist

    # Cache static assets aggressively
    @immutable path *.js *.css *.woff *.woff2
    header @immutable Cache-Control "public, max-age=31536000, immutable"

    @images path *.png *.jpg *.jpeg *.gif *.svg *.ico *.webp
    header @images Cache-Control "public, max-age=86400"

    # SPA fallback: serve index.html for client-side routes
    try_files {path} /index.html
    file_server
}
```

### 3.3 Multi-Service (API + Web + Admin)

```caddyfile
{
    email admin@example.com
}

(security_headers) {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
        -X-Powered-By
    }
}

# Main web app (Laravel)
example.com {
    import security_headers
    encode zstd gzip

    reverse_proxy localhost:8000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# API (Go service)
api.example.com {
    import security_headers
    encode zstd gzip

    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# Admin panel (protected)
admin.example.com {
    import security_headers

    # IP whitelist (Tailscale network + office)
    @blocked not remote_ip 100.64.0.0/10 203.0.113.50/32
    respond @blocked "Forbidden" 403

    reverse_proxy localhost:8081
}

# WebSocket server (Laravel Reverb)
ws.example.com {
    reverse_proxy localhost:8080
}
```

### 3.4 With Cloudflare Origin Certificate

```caddyfile
{
    email admin@example.com
}

(cloudflare_tls) {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem
}

(security_headers) {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        -Server
        -X-Powered-By
    }
}

(cloudflare_proxy) {
    header_up X-Real-IP {header.CF-Connecting-IP}
    header_up X-Forwarded-For {header.CF-Connecting-IP}
    header_up X-Forwarded-Proto {scheme}
}

example.com {
    import cloudflare_tls
    import security_headers
    encode zstd gzip

    reverse_proxy localhost:8000 {
        import cloudflare_proxy
    }
}

api.example.com {
    import cloudflare_tls
    import security_headers
    encode zstd gzip

    reverse_proxy localhost:3000 {
        import cloudflare_proxy
    }
}
```

---

## 4. Nginx (When You Need It)

### 4.1 When to Use Nginx Over Caddy

- Existing Nginx infrastructure (migration cost too high)
- Need ModSecurity WAF (application-level firewall)
- Need Lua scripting (OpenResty)
- Need GeoIP2 module for geo-blocking
- Team already knows Nginx deeply
- Marginal raw throughput advantage at extreme scale (100k+ req/s)

### 4.2 Server Block Configuration

```nginx
# /etc/nginx/sites-available/example.com
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;
    return 301 https://example.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
    resolver 1.1.1.1 8.8.8.8 valid=300s;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    server_tokens off;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/
sudo nginx -t   # Test config
sudo systemctl reload nginx
```

### 4.3 Reverse Proxy to Upstream

```nginx
# Multiple backends with load balancing
upstream app_servers {
    least_conn;
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
    server 127.0.0.1:8003;
}

server {
    # ... SSL config ...

    location / {
        proxy_pass http://app_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://app_servers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;   # Keep WebSocket alive
    }
}
```

### 4.4 Caching (proxy_cache)

```nginx
# Define cache zone in http block (/etc/nginx/nginx.conf)
http {
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:10m
                     max_size=1g inactive=60m use_temp_path=off;
}

# Use in server block
server {
    # ... SSL config ...

    # Cache static responses from backend
    location /api/public/ {
        proxy_pass http://localhost:8080;
        proxy_cache app_cache;
        proxy_cache_valid 200 10m;
        proxy_cache_valid 404 1m;
        proxy_cache_use_stale error timeout updating;
        proxy_cache_lock on;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # Don't cache authenticated routes
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }
}
```

### 4.5 Compression

```nginx
# /etc/nginx/conf.d/compression.conf
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 4;          # 4 is a good balance (1-9)
gzip_min_length 256;
gzip_types
    text/plain
    text/css
    text/javascript
    application/javascript
    application/json
    application/xml
    image/svg+xml
    font/woff2;

# Brotli (requires ngx_brotli module)
# brotli on;
# brotli_comp_level 4;
# brotli_types text/plain text/css application/javascript application/json image/svg+xml;
```

### 4.6 Rate Limiting

```nginx
# Define rate limit zone in http block
http {
    # 10 requests per second per IP
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # Separate zone for login (stricter)
    limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;
}

server {
    # API: allow burst of 20 requests
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://localhost:8080;
    }

    # Login: strict rate limiting
    location /login {
        limit_req zone=login burst=3 nodelay;
        limit_req_status 429;
        proxy_pass http://localhost:8080;
    }
}
```

```
# WRONG: no burst — every burst of requests gets 503
limit_req zone=api;

# CORRECT: allow burst with nodelay for smooth experience
limit_req zone=api burst=20 nodelay;
```

---

## 5. Nginx Production Examples

### 5.1 Complete Laravel Nginx Config

```nginx
# /etc/nginx/sites-available/laravel.example.com
server {
    listen 80;
    listen [::]:80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com;

    root /var/www/app/public;
    index index.php;

    # SSL
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    server_tokens off;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml image/svg+xml;

    # File upload limit
    client_max_body_size 50M;

    # Static assets
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Laravel
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    # PHP-FPM
    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 60s;
    }

    # Block dotfiles (except .well-known for Let's Encrypt)
    location ~ /\.(?!well-known) {
        deny all;
    }

    # Laravel Reverb WebSocket
    location /app {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    access_log /var/log/nginx/example.com-access.log;
    error_log /var/log/nginx/example.com-error.log;
}
```

### 5.2 Nginx Behind Cloudflare

```nginx
# /etc/nginx/conf.d/cloudflare.conf
# Restore real visitor IP from Cloudflare

set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;

# IPv6
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;

# Update Cloudflare IP ranges periodically:
# https://www.cloudflare.com/ips/
```

---

## 6. Traefik (Docker-Native)

### 6.1 When to Use Traefik

- Running many Docker services that change frequently
- Want auto-discovery (add labels to container, routing just works)
- Kubernetes integration needed
- Prefer infrastructure-as-code via Docker labels

### 6.2 Docker Compose + Traefik Setup

```yaml
# docker-compose.yml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks:
      - web
    labels:
      # Secure the dashboard
      - "traefik.enable=true"
      - "traefik.http.routers.dashboard.rule=Host(`traefik.example.com`)"
      - "traefik.http.routers.dashboard.service=api@internal"
      - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
      - "traefik.http.routers.dashboard.middlewares=auth"
      - "traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$HASHED"

  # Laravel app — routing configured entirely via labels
  app:
    build: .
    restart: unless-stopped
    expose:
      - "8000"
    networks:
      - web
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`example.com`)"
      - "traefik.http.routers.app.tls.certresolver=letsencrypt"
      - "traefik.http.services.app.loadbalancer.server.port=8000"

  # Go API service
  api:
    build: ./api
    restart: unless-stopped
    expose:
      - "3000"
    networks:
      - web
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.example.com`)"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      - "traefik.http.services.api.loadbalancer.server.port=3000"

networks:
  web:

volumes:
  letsencrypt:
```

### 6.3 Traefik Middleware

```yaml
# Rate limiting via labels
labels:
  - "traefik.http.middlewares.ratelimit.ratelimit.average=100"
  - "traefik.http.middlewares.ratelimit.ratelimit.burst=50"
  - "traefik.http.routers.api.middlewares=ratelimit"

# Security headers via labels
labels:
  - "traefik.http.middlewares.security.headers.stsSeconds=63072000"
  - "traefik.http.middlewares.security.headers.stsIncludeSubdomains=true"
  - "traefik.http.middlewares.security.headers.stsPreload=true"
  - "traefik.http.middlewares.security.headers.contentTypeNosniff=true"
  - "traefik.http.middlewares.security.headers.frameDeny=true"
  - "traefik.http.routers.app.middlewares=security"

# IP whitelist for admin
labels:
  - "traefik.http.middlewares.admin-whitelist.ipallowlist.sourcerange=100.64.0.0/10,203.0.113.50/32"
  - "traefik.http.routers.admin.middlewares=admin-whitelist"

# Compress responses
labels:
  - "traefik.http.middlewares.compress.compress=true"
  - "traefik.http.routers.app.middlewares=compress"
```

### 6.4 Traefik Dashboard Security

```
# WRONG: dashboard exposed without auth
--api.insecure=true

# CORRECT: dashboard behind basicauth + HTTPS
labels:
  - "traefik.http.routers.dashboard.middlewares=auth"
  - "traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$xyz..."

# Generate password hash for Traefik:
# htpasswd -nb admin your-password
# Double-escape $ signs in docker-compose: $ → $$
```

---

## 7. Load Balancing

### 7.1 Algorithms

| Algorithm | How | Use When |
|---|---|---|
| Round robin | Rotate through backends equally | Default, stateless apps |
| Least connections | Send to backend with fewest active connections | Varying request durations |
| IP hash | Same client IP always hits same backend | Session affinity without cookies |
| Random | Random backend selection | Simple, works well at scale |

### 7.2 Caddy Load Balancing

```caddyfile
example.com {
    reverse_proxy {
        to localhost:8001 localhost:8002 localhost:8003

        lb_policy least_conn      # or round_robin, random, ip_hash, first
        lb_retries 3

        health_uri /health
        health_interval 10s
        health_timeout 5s

        # Fail tolerance
        fail_duration 30s
        max_fails 3
    }
}
```

### 7.3 Nginx Load Balancing

```nginx
upstream app {
    least_conn;

    server 127.0.0.1:8001 weight=3;   # Gets 3x traffic
    server 127.0.0.1:8002 weight=1;
    server 127.0.0.1:8003 backup;      # Only used when others are down

    # Health check (Nginx Plus only, or use upstream_check_module)
    # check interval=3000 rise=2 fall=3 timeout=2000 type=http;
    # check_http_send "GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n";
    # check_http_expect_alive http_2xx;
}

server {
    location / {
        proxy_pass http://app;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 3;
    }
}
```

### 7.4 Sticky Sessions (When Needed)

Sticky sessions tie a client to a specific backend. **Avoid if possible** — they make scaling harder. Use stateless sessions (JWT, Redis-backed sessions) instead.

```nginx
# Nginx: IP hash (simple sticky)
upstream app {
    ip_hash;
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
}

# Better: cookie-based (Nginx Plus only)
upstream app {
    sticky cookie srv_id expires=1h;
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
}
```

```caddyfile
# Caddy: cookie-based sticky
example.com {
    reverse_proxy localhost:8001 localhost:8002 {
        lb_policy cookie
    }
}
```

```
# WRONG: relying on sticky sessions for user authentication state
# If server 1 dies, all its users lose their sessions

# CORRECT: store sessions in Redis, any backend can serve any user
SESSION_DRIVER=redis
REDIS_HOST=10.0.0.5
```

### 7.5 Health Checks

```caddyfile
# Caddy: active health checks
example.com {
    reverse_proxy localhost:8001 localhost:8002 {
        health_uri /health
        health_interval 10s
        health_timeout 5s
        health_status 200
    }
}
```

**Implement a proper health endpoint in your app:**

```go
// Go health endpoint
func healthHandler(w http.ResponseWriter, r *http.Request) {
    // Check database
    if err := db.Ping(); err != nil {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "db": err.Error()})
        return
    }
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}
```

```php
// Laravel health endpoint (routes/web.php)
Route::get('/health', function () {
    try {
        DB::connection()->getPdo();
        return response()->json(['status' => 'healthy'], 200);
    } catch (\Exception $e) {
        return response()->json(['status' => 'unhealthy', 'db' => $e->getMessage()], 503);
    }
});
```

```
# WRONG: health endpoint that just returns 200 without checking dependencies
Route::get('/health', fn() => 'ok');

# CORRECT: health endpoint that checks database, cache, queue
Route::get('/health', function () {
    $checks = [];
    $healthy = true;

    try { DB::connection()->getPdo(); $checks['db'] = 'ok'; }
    catch (\Exception $e) { $checks['db'] = 'failed'; $healthy = false; }

    try { Cache::store()->get('health-check'); $checks['cache'] = 'ok'; }
    catch (\Exception $e) { $checks['cache'] = 'failed'; $healthy = false; }

    return response()->json($checks, $healthy ? 200 : 503);
});
```
