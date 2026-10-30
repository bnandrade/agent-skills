# Secrets & Security

Production security hardening: secret management, SSL/TLS, firewalls, SSH, headers, CORS, rate limiting, and container security.

---

## Table of Contents

1. [Secret Management Hierarchy](#1-secret-management-hierarchy)
2. [.env File Management](#2-env-file-management)
3. [Secret Managers](#3-secret-managers)
4. [Docker Secrets](#4-docker-secrets)
5. [GitHub Actions Secrets](#5-github-actions-secrets)
6. [SSL/TLS with Let's Encrypt](#6-ssltls-with-lets-encrypt)
7. [Firewall Configuration](#7-firewall-configuration)
8. [SSH Hardening](#8-ssh-hardening)
9. [Security Headers](#9-security-headers)
10. [CORS Configuration](#10-cors-configuration)
11. [Rate Limiting](#11-rate-limiting)
12. [Container Security](#12-container-security)
13. [Secrets Rotation Strategy](#13-secrets-rotation-strategy)
14. [Audit Logging](#14-audit-logging)

---

## 1. Secret Management Hierarchy

From worst to best — each level is a meaningful upgrade:

| Level | Method | Risk | Use When |
|---|---|---|---|
| 0 | Hardcoded in source | Critical — secrets in git history forever | **Never** |
| 1 | `.env` file (gitignored) | High — on disk, easy to leak | Local dev only |
| 2 | Encrypted `.env` (sops, age) | Medium — encrypted at rest, key mgmt needed | Small teams, staging |
| 3 | CI/CD platform secrets | Low — injected at build/deploy time | Build pipelines |
| 4 | Secret manager (Doppler, Vault, AWS SM) | Lowest — centralized, audited, rotatable | Production always |

```bash
# WRONG: hardcoded in source (level 0) — this is in git history FOREVER
DATABASE_URL="postgresql://admin:SuperSecret123@db.prod.example.com:5432/app"
API_KEY="sk-live-abc123def456"

# WRONG: .env committed to git
git add .env  # NO. Even if you remove it later, it's in history.

# CORRECT: .env.example committed, .env gitignored
echo ".env" >> .gitignore
cp .env.example .env  # developer fills in real values locally
```

### Emergency: Secret Leaked to Git

```bash
# If a secret was EVER committed, it's compromised. Rotate immediately.
# Removing from history is secondary — rotate the secret FIRST.

# 1. Rotate the secret immediately
# 2. Then clean history if needed (prevents future discovery)
git filter-repo --invert-paths --path .env
# Or use BFG Repo-Cleaner:
bfg --delete-files .env
git push --force-with-lease --all
```

---

## 2. .env File Management

### 2.1 Project Structure

```
project/
├── .env.example          # Committed — documents ALL required vars with placeholder values
├── .env                  # Gitignored — local dev values
├── .env.test             # Gitignored — test suite values (can commit if no real secrets)
├── .gitignore            # Must include .env*  (except .env.example)
└── docker-compose.yml    # References .env automatically
```

### 2.2 .env.example (Always Commit This)

```bash
# .env.example — copy to .env and fill in real values
# App
APP_NAME=myapp
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:8080
APP_KEY=base64:GENERATE_WITH_artisan_key_generate

# Database
DB_CONNECTION=pgsql
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=myapp
DB_USERNAME=myapp
DB_PASSWORD=secret

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=null

# Mail (use Mailpit locally)
MAIL_MAILER=smtp
MAIL_HOST=localhost
MAIL_PORT=1025

# External Services (get keys from team vault)
STRIPE_KEY=pk_test_...
STRIPE_SECRET=sk_test_...
SENTRY_DSN=https://example@sentry.io/123
```

### 2.3 .gitignore Rules

```gitignore
# WRONG: only ignoring .env
.env

# CORRECT: ignore all .env variants except the example
.env*
!.env.example
```

### 2.4 Docker Compose .env Integration

```yaml
# docker-compose.yml — reads .env automatically from same directory
services:
  app:
    image: myapp:latest
    environment:
      # Explicit mapping (preferred — documents what the container needs)
      - APP_ENV=${APP_ENV:-production}
      - DB_HOST=${DB_HOST}
      - DB_PASSWORD=${DB_PASSWORD}
    # OR load entire file (less explicit, but convenient for dev)
    env_file:
      - .env
```

### 2.5 Per-Environment .env with Encryption (sops + age)

```bash
# Install age (modern encryption, simpler than GPG)
# Generate a key pair
age-keygen -o keys.txt
# Public key: age1abc123...

# Encrypt .env for production
sops --encrypt --age age1abc123... .env.production > .env.production.enc

# Decrypt at deploy time
export SOPS_AGE_KEY_FILE=./keys.txt
sops --decrypt .env.production.enc > .env.production

# Store age private key in CI/CD secrets — NOT in the repo
```

---

## 3. Secret Managers

### 3.1 Doppler (Recommended for Small-Medium Teams)

Best developer experience, generous free tier, easy CI/CD integration.

```bash
# Install and authenticate
brew install dopplerhq/cli/doppler  # or curl -Ls https://cli.doppler.com/install.sh | sh
doppler login

# Setup project
doppler setup  # interactive — picks project + environment

# Run app with injected secrets (replaces .env entirely)
doppler run -- node server.js
doppler run -- php artisan serve
doppler run -- go run ./cmd/server

# Access individual secrets
doppler secrets get DATABASE_URL --plain

# In Docker Compose
services:
  app:
    image: myapp:latest
    # Option A: Doppler injects env vars via service token
    environment:
      - DOPPLER_TOKEN=${DOPPLER_TOKEN}
    entrypoint: ["doppler", "run", "--"]
    command: ["node", "server.js"]
```

```yaml
# GitHub Actions with Doppler
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dopplerhq/cli-action@v3
        with:
          version: latest
      - run: doppler run -- make deploy
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
```

### 3.2 1Password CLI (op)

Good when team already uses 1Password for password management.

```bash
# Install and sign in
op signin

# Reference secrets in .env using 1Password references
# .env.template (committed)
DATABASE_URL="op://Infrastructure/Database/connection-string"
API_KEY="op://Infrastructure/Stripe/secret-key"

# Inject at runtime
op run --env-file=.env.template -- node server.js

# In CI/CD — use 1Password service account
# Set OP_SERVICE_ACCOUNT_TOKEN in GitHub Actions secrets
```

### 3.3 HashiCorp Vault

Enterprise-grade. Use when you need fine-grained access policies, dynamic secrets, or PKI.

```bash
# Write a secret
vault kv put secret/myapp/production \
  db_password="SuperSecret123" \
  api_key="sk-live-abc123"

# Read in application (via HTTP API)
curl -s \
  -H "X-Vault-Token: ${VAULT_TOKEN}" \
  ${VAULT_ADDR}/v1/secret/data/myapp/production | jq '.data.data'

# Dynamic database credentials (Vault generates short-lived credentials)
vault read database/creds/myapp-role
# Returns: username=v-myapp-abc123, password=xyz789, ttl=1h
```

### 3.4 AWS Secrets Manager

Use when already on AWS. Integrates with ECS, Lambda, RDS natively.

```bash
# Create secret
aws secretsmanager create-secret \
  --name myapp/production/database \
  --secret-string '{"username":"admin","password":"SuperSecret123"}'

# Retrieve in application
aws secretsmanager get-secret-value \
  --secret-id myapp/production/database \
  --query SecretString --output text
```

```yaml
# ECS task definition — injects secret as env var (no code changes needed)
containerDefinitions:
  - name: app
    secrets:
      - name: DB_PASSWORD
        valueFrom: "arn:aws:secretsmanager:us-east-1:123456:secret:myapp/production/database:password::"
```

### 3.5 Comparison

| Feature | Doppler | 1Password CLI | Vault | AWS SM |
|---|---|---|---|---|
| Free tier | 5 users | Requires 1P sub | OSS (self-host) | $0.40/secret/month |
| Setup time | 5 minutes | 10 minutes | Hours | 15 minutes |
| Dynamic secrets | No | No | Yes | Rotation only |
| Best for | Startups, small teams | Teams on 1Password | Enterprise, PKI | AWS-native apps |
| CI/CD integration | Excellent | Good | Good | AWS-native |

---

## 4. Docker Secrets

### 4.1 Compose Secrets (Docker Compose)

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    secrets:
      - db_password
      - api_key
    environment:
      # App reads from file: /run/secrets/db_password
      - DB_PASSWORD_FILE=/run/secrets/db_password

  db:
    image: postgres:17-alpine
    secrets:
      - db_password
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt    # local development
  api_key:
    file: ./secrets/api_key.txt
```

```bash
# Application code must read from file path
# WRONG: expecting env var directly
DB_PASSWORD = os.environ['DB_PASSWORD']

# CORRECT: read from secret file, fall back to env var
def get_secret(name):
    file_path = os.environ.get(f'{name}_FILE')
    if file_path and os.path.exists(file_path):
        return open(file_path).read().strip()
    return os.environ.get(name)
```

### 4.2 Build Secrets (--mount=type=secret)

For secrets needed at build time (private registry tokens, SSH keys for private repos):

```dockerfile
# WRONG: secret baked into image layer (visible with docker history)
ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
RUN npm ci
RUN rm .npmrc  # Too late — it's in a previous layer

# CORRECT: build secret mounted only during RUN, never in image
# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) \
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc && \
    npm ci && \
    rm .npmrc
COPY . .
RUN npm run build
```

```bash
# Build with secret passed at build time
docker build --secret id=npm_token,src=$HOME/.npmrc -t myapp .

# Multiple secrets
docker build \
  --secret id=npm_token,src=./secrets/npm_token \
  --secret id=ssh_key,src=$HOME/.ssh/id_ed25519 \
  -t myapp .
```

### 4.3 SSH Keys for Private Git Repos in Build

```dockerfile
# CORRECT: SSH agent forwarding (secret never touches image)
FROM golang:1.26-alpine AS builder
RUN apk add --no-cache git openssh-client
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN --mount=type=ssh git clone git@github.com:private/repo.git
```

```bash
docker build --ssh default -t myapp .
```

---

## 5. GitHub Actions Secrets

### 5.1 Secret Scopes

| Scope | Set At | Available To | Use For |
|---|---|---|---|
| Repository | Repo settings | All workflows in repo | Repo-specific keys |
| Environment | Environment settings | Workflows targeting that env | Per-env secrets (staging vs prod) |
| Organization | Org settings | Selected repos | Shared keys (Docker Hub, Sentry DSN) |

### 5.2 Using Secrets in Workflows

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging  # uses staging secrets
    steps:
      - uses: actions/checkout@v4

      # Secrets as environment variables
      - name: Deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
        run: |
          echo "Deploying to staging..."
          # secrets are masked in logs automatically

      # WRONG: echoing secrets (GitHub masks known values, but don't rely on it)
      - run: echo ${{ secrets.API_KEY }}  # NEVER DO THIS

      # WRONG: using secrets in URLs (may leak in logs/error messages)
      - run: curl "https://api.example.com?key=${{ secrets.API_KEY }}"

      # CORRECT: pass via header or env
      - run: |
          curl -H "Authorization: Bearer ${API_KEY}" https://api.example.com
        env:
          API_KEY: ${{ secrets.API_KEY }}
```

### 5.3 Environment Protection Rules

```yaml
# Use environments for deploy gates
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://myapp.com
    # GitHub enforces: required reviewers, wait timer, branch restrictions
    steps:
      - run: make deploy
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

### 5.4 Docker Registry Authentication

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write  # needed for GHCR
    steps:
      - uses: actions/checkout@v4

      # GitHub Container Registry (free for public repos)
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}  # automatic, no setup needed

      # Or Docker Hub
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

---

## 6. SSL/TLS with Let's Encrypt

### 6.1 Caddy (Simplest — Auto-HTTPS by Default)

Caddy obtains and renews Let's Encrypt certificates automatically. Zero config needed.

```
# Caddyfile — this is ALL you need for production HTTPS
myapp.com {
    reverse_proxy app:8080
}

# Multiple domains
myapp.com {
    reverse_proxy app:8080
}

api.myapp.com {
    reverse_proxy api:3000
}

# With wildcard certificate (requires DNS challenge)
*.myapp.com {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }

    @api host api.myapp.com
    handle @api {
        reverse_proxy api:3000
    }

    handle {
        reverse_proxy app:8080
    }
}
```

```yaml
# docker-compose.yml with Caddy
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"  # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data      # certificates stored here
      - caddy_config:/config
    restart: unless-stopped

  app:
    image: myapp:latest
    expose:
      - "8080"  # internal only — Caddy handles external traffic

volumes:
  caddy_data:
  caddy_config:
```

### 6.2 Certbot with Nginx

For teams already on Nginx:

```bash
# Install Certbot
apt install certbot python3-certbot-nginx

# Obtain certificate (auto-configures Nginx)
certbot --nginx -d myapp.com -d www.myapp.com

# Auto-renewal (certbot installs a systemd timer by default)
certbot renew --dry-run  # test renewal

# Manual cron if needed
echo "0 0 1 * * certbot renew --post-hook 'systemctl reload nginx'" | crontab -
```

```nginx
# /etc/nginx/sites-available/myapp.conf (after certbot)
server {
    listen 443 ssl http2;
    server_name myapp.com;

    ssl_certificate /etc/letsencrypt/live/myapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myapp.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name myapp.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 7. Firewall Configuration

### 7.1 UFW (Uncomplicated Firewall — Ubuntu/Debian)

```bash
# Initial setup — ALWAYS do this on a new VPS
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (do this BEFORE enabling, or you lock yourself out)
ufw allow 22/tcp     # or custom SSH port
# Or limit SSH (rate-limited: max 6 connections per 30 seconds)
ufw limit 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable

# Check status
ufw status verbose

# Allow specific IP (for admin panels, monitoring)
ufw allow from 203.0.113.50 to any port 3000

# WRONG: allowing database ports from anywhere
ufw allow 5432/tcp   # PostgreSQL exposed to internet!

# CORRECT: database only from app server IP or localhost
ufw allow from 10.0.0.5 to any port 5432
# Or don't expose it at all — use Docker network instead
```

### 7.2 iptables (When You Need More Control)

```bash
# Basic web server rules
iptables -A INPUT -i lo -j ACCEPT                          # loopback
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT  # existing connections
iptables -A INPUT -p tcp --dport 22 -j ACCEPT               # SSH
iptables -A INPUT -p tcp --dport 80 -j ACCEPT               # HTTP
iptables -A INPUT -p tcp --dport 443 -j ACCEPT              # HTTPS
iptables -A INPUT -j DROP                                    # drop everything else

# Rate limit SSH
iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW \
  -m recent --set --name SSH
iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW \
  -m recent --update --seconds 60 --hitcount 4 --name SSH -j DROP

# Save rules (persist across reboot)
iptables-save > /etc/iptables/rules.v4
```

### 7.3 Docker and Firewall Interaction

**Docker manipulates iptables directly, bypassing UFW.** This is a common gotcha.

```bash
# WRONG: thinking UFW protects Docker-published ports
# Docker adds its own iptables rules that bypass UFW entirely
# This means "ufw deny 5432" does NOT block docker -p 5432:5432

# CORRECT: don't publish ports you don't need
# Instead of:
docker run -p 5432:5432 postgres  # accessible from internet!

# Do:
docker run postgres  # only accessible within Docker network
# Or bind to localhost only:
docker run -p 127.0.0.1:5432:5432 postgres

# Fix Docker + UFW: /etc/docker/daemon.json
{
  "iptables": false
}
# WARNING: this breaks Docker networking. Better approach:
# Just don't publish internal ports. Use Docker networks.
```

---

## 8. SSH Hardening

### 8.1 Key-Only Authentication

```bash
# On your LOCAL machine: generate an Ed25519 key
ssh-keygen -t ed25519 -C "deploy@myapp.com"

# Copy public key to server
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server

# On the SERVER: disable password auth
# /etc/ssh/sshd_config
```

```
# /etc/ssh/sshd_config — hardened settings
Port 2222                          # change from default 22
PermitRootLogin no                 # never allow root SSH
PasswordAuthentication no          # key-only
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
MaxAuthTries 3
LoginGraceTime 20
AllowUsers deploy                  # only specific users
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
```

```bash
# Restart SSH (test FIRST by opening a second terminal — don't lock yourself out)
systemctl restart sshd

# Test in ANOTHER terminal before closing current session
ssh -p 2222 deploy@server
```

### 8.2 Fail2ban

```bash
# Install
apt install fail2ban

# Create local config (don't edit jail.conf directly)
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600        # 1 hour ban
findtime = 600        # within 10 minutes
maxretry = 3          # 3 failed attempts
banaction = ufw       # use UFW for banning

[sshd]
enabled = true
port = 2222           # match your SSH port
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400       # 24 hour ban for SSH

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Check status
fail2ban-client status sshd
```

### 8.3 SSH Config for Easy Access

```
# ~/.ssh/config (local machine)
Host myapp-prod
    HostName 203.0.113.50
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host myapp-staging
    HostName 203.0.113.51
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

# Usage: ssh myapp-prod
```

---

## 9. Security Headers

### 9.1 Caddy Security Headers

```
# Caddyfile
myapp.com {
    header {
        # HSTS — tell browsers to always use HTTPS
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"

        # Prevent clickjacking
        X-Frame-Options "DENY"

        # Prevent MIME type sniffing
        X-Content-Type-Options "nosniff"

        # Referrer policy — don't leak full URL to other sites
        Referrer-Policy "strict-origin-when-cross-origin"

        # Permissions policy — disable unnecessary browser features
        Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"

        # Content Security Policy
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"

        # Remove server identification
        -Server
    }

    reverse_proxy app:8080
}
```

### 9.2 Nginx Security Headers

```nginx
# /etc/nginx/snippets/security-headers.conf
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'" always;

# Hide Nginx version
server_tokens off;

# Include in server block:
# include /etc/nginx/snippets/security-headers.conf;
```

### 9.3 CSP Strategy

```
# Start permissive, tighten over time:

# Phase 1: Report-only (monitor without breaking)
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report

# Phase 2: Enforce with necessary exceptions
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com; frame-ancestors 'none'

# Phase 3: Strict with nonces (best security, more work)
Content-Security-Policy: default-src 'self'; script-src 'nonce-{random}'; style-src 'nonce-{random}'
```

---

## 10. CORS Configuration

### 10.1 Caddy CORS

```
# Caddyfile
api.myapp.com {
    @cors_preflight method OPTIONS

    handle @cors_preflight {
        header Access-Control-Allow-Origin "https://myapp.com"
        header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        header Access-Control-Allow-Headers "Authorization, Content-Type"
        header Access-Control-Max-Age "86400"
        respond "" 204
    }

    header Access-Control-Allow-Origin "https://myapp.com"
    header Access-Control-Allow-Credentials "true"

    reverse_proxy api:3000
}
```

### 10.2 Nginx CORS

```nginx
# WRONG: allow everything (defeats the purpose of CORS)
add_header Access-Control-Allow-Origin "*" always;

# CORRECT: specific origin, with credentials support
map $http_origin $cors_origin {
    default "";
    "https://myapp.com" "https://myapp.com";
    "https://staging.myapp.com" "https://staging.myapp.com";
}

server {
    location /api/ {
        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin $cors_origin;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
            add_header Access-Control-Allow-Headers "Authorization, Content-Type";
            add_header Access-Control-Max-Age 86400;
            add_header Content-Length 0;
            return 204;
        }

        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Credentials "true" always;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

### 10.3 Application-Level CORS (Preferred)

Better to handle CORS in the application (more control, easier testing):

```php
// Laravel — config/cors.php
return [
    'paths' => ['api/*'],
    'allowed_origins' => [env('FRONTEND_URL', 'https://myapp.com')],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE'],
    'allowed_headers' => ['Authorization', 'Content-Type'],
    'supports_credentials' => true,
    'max_age' => 86400,
];
```

```go
// Go — middleware
func corsMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
            w.Header().Set("Access-Control-Allow-Credentials", "true")
            if r.Method == "OPTIONS" {
                w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE")
                w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
                w.Header().Set("Access-Control-Max-Age", "86400")
                w.WriteHeader(http.StatusNoContent)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

---

## 11. Rate Limiting

### 11.1 Caddy Rate Limiting

```
# Caddyfile — requires caddy-ratelimit module
{
    order rate_limit before reverse_proxy
}

api.myapp.com {
    # Global rate limit: 100 requests per minute per IP
    rate_limit {remote.ip} 100r/m

    # Stricter for auth endpoints
    handle /api/auth/* {
        rate_limit {remote.ip} 10r/m
    }

    reverse_proxy api:3000
}
```

### 11.2 Nginx Rate Limiting

```nginx
# Define rate limiting zones
limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=1r/s;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

server {
    # General pages
    location / {
        limit_req zone=general burst=20 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    # Auth endpoints — strict limiting
    location /api/auth/ {
        limit_req zone=auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    # API endpoints
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    # Custom error page for rate limit
    error_page 429 /429.html;
}
```

### 11.3 Traefik Rate Limiting

```yaml
# docker-compose.yml labels
services:
  app:
    labels:
      - "traefik.http.middlewares.ratelimit.ratelimit.average=100"
      - "traefik.http.middlewares.ratelimit.ratelimit.burst=50"
      - "traefik.http.middlewares.ratelimit.ratelimit.period=1m"
      - "traefik.http.routers.app.middlewares=ratelimit"
```

---

## 12. Container Security

### 12.1 Non-Root User

```dockerfile
# WRONG: running as root (default)
FROM node:22-alpine
WORKDIR /app
COPY . .
CMD ["node", "server.js"]

# CORRECT: dedicated non-root user
FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --chown=app:app . .
USER app
CMD ["node", "server.js"]
```

### 12.2 Read-Only Filesystem

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
    volumes:
      - app-data:/app/data  # only writable mount
```

### 12.3 Drop All Capabilities

```yaml
# docker-compose.yml
services:
  app:
    image: myapp:latest
    cap_drop:
      - ALL
    # Only add back what you actually need
    # cap_add:
    #   - NET_BIND_SERVICE  # only if binding to port < 1024
    security_opt:
      - no-new-privileges:true
```

### 12.4 Complete Hardened Service

```yaml
services:
  app:
    image: myapp:latest
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=64M
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### 12.5 Image Scanning

```yaml
# GitHub Actions — scan image for vulnerabilities
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: myapp:${{ github.sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'

- name: Upload Trivy scan results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

---

## 13. Secrets Rotation Strategy

### 13.1 Rotation Plan

| Secret Type | Rotation Frequency | Method |
|---|---|---|
| Database passwords | 90 days | Secret manager + app restart |
| API keys | 90 days | Generate new, deploy, revoke old |
| JWT signing keys | 180 days | Dual-key: sign with new, verify both |
| SSL certificates | Auto (Let's Encrypt) | Caddy/Certbot handles this |
| SSH keys | Annually | Generate new, distribute, remove old |
| Service tokens | 90 days | CI/CD variable update |

### 13.2 Zero-Downtime Key Rotation

```bash
# Pattern: overlap period where both old and new keys work

# 1. Generate new key
NEW_KEY=$(openssl rand -base64 32)

# 2. Update secret manager with BOTH keys
doppler secrets set JWT_SIGNING_KEY="$NEW_KEY"
doppler secrets set JWT_SIGNING_KEY_PREVIOUS="$OLD_KEY"

# 3. Deploy app that signs with new key, verifies with both
# 4. Wait for all old tokens to expire (based on your TTL)
# 5. Remove the old key
doppler secrets delete JWT_SIGNING_KEY_PREVIOUS
```

```go
// Application: verify with multiple keys during rotation
func verifyToken(tokenStr string) (*Claims, error) {
    keys := []string{
        os.Getenv("JWT_SIGNING_KEY"),          // current
        os.Getenv("JWT_SIGNING_KEY_PREVIOUS"), // previous (may be empty)
    }
    for _, key := range keys {
        if key == "" {
            continue
        }
        claims, err := jwt.Verify(tokenStr, key)
        if err == nil {
            return claims, nil
        }
    }
    return nil, fmt.Errorf("invalid token")
}
```

---

## 14. Audit Logging

### 14.1 What to Log

```
# ALWAYS log:
- Authentication events (login, logout, failed login, password change)
- Authorization failures (403s, permission denied)
- Secret access (who accessed what secret, when)
- Admin actions (user management, config changes)
- Data exports and bulk operations
- API key creation and revocation

# NEVER log:
- Passwords (even hashed)
- Full credit card numbers
- Session tokens or API keys
- PII beyond what's needed (full SSN, health data)
```

### 14.2 Structured Audit Log Format

```json
{
  "timestamp": "2026-04-11T10:30:00Z",
  "event": "auth.login.success",
  "actor": {
    "id": "user_123",
    "email": "user@example.com",
    "ip": "203.0.113.50"
  },
  "resource": {
    "type": "session",
    "id": "sess_abc123"
  },
  "metadata": {
    "user_agent": "Mozilla/5.0...",
    "method": "password",
    "mfa_used": true
  }
}
```

### 14.3 Fail2ban + Audit Integration

```bash
# Custom fail2ban filter for application auth failures
# /etc/fail2ban/filter.d/myapp-auth.conf
[Definition]
failregex = ^.*"event":"auth\.login\.failed".*"ip":"<HOST>".*$
ignoreregex =

# /etc/fail2ban/jail.local
[myapp-auth]
enabled = true
filter = myapp-auth
logpath = /var/log/myapp/audit.log
maxretry = 5
bantime = 3600
findtime = 300
```

### 14.4 Audit Log Retention

```bash
# logrotate config for audit logs — keep longer than regular logs
# /etc/logrotate.d/myapp-audit
/var/log/myapp/audit.log {
    daily
    rotate 365        # keep 1 year (compliance requirement)
    compress
    delaycompress
    missingok
    notifempty
    create 0640 app app
    postrotate
        # ship to cold storage before rotation
        aws s3 cp /var/log/myapp/audit.log.1 \
          s3://myapp-audit-logs/$(date +%Y/%m)/audit-$(date +%Y%m%d).log
    endscript
}
```
