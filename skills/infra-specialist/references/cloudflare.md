# Cloudflare

Complete Cloudflare configuration guide — DNS, SSL/TLS, WAF, DDoS, caching, Tunnels, Workers, and email routing. Practical configs for production web apps behind Cloudflare.

---

## Table of Contents

1. [Cloudflare Tiers](#1-cloudflare-tiers)
2. [DNS Setup](#2-dns-setup)
3. [SSL/TLS Configuration](#3-ssltls-configuration)
4. [WAF (Web Application Firewall)](#4-waf-web-application-firewall)
5. [DDoS Protection](#5-ddos-protection)
6. [Caching](#6-caching)
7. [Performance Features](#7-performance-features)
8. [Cloudflare Tunnels](#8-cloudflare-tunnels)
9. [Cloudflare Workers](#9-cloudflare-workers)
10. [Email Routing](#10-email-routing)
11. [Common Mistakes and Anti-Patterns](#11-common-mistakes-and-anti-patterns)

---

## 1. Cloudflare Tiers

### 1.1 What You Actually Get Per Tier

| Feature | Free | Pro ($20/mo) | Business ($200/mo) | Enterprise (custom) |
|---|---|---|---|---|
| DNS hosting | Unlimited | Unlimited | Unlimited | Unlimited |
| CDN / Caching | Yes | Yes | Yes | Yes |
| DDoS (L3/L4) | Yes | Yes | Yes | Yes |
| DDoS (L7) | Basic | Better | Advanced | Full + SLA |
| SSL/TLS | Universal (shared) | Dedicated cert | Dedicated + custom | Custom |
| WAF Managed Rules | No | Yes (OWASP + CF) | Yes | Yes |
| WAF Custom Rules | 5 rules | 20 rules | 50 rules | 1000+ |
| Rate Limiting Rules | 1 rule | 10 rules | 25 rules | Unlimited |
| Bot Management | Basic | Better JS challenge | Super Bot Fight Mode | Enterprise Bot Mgmt |
| Image Optimization | No | Polish + Mirage | Polish + Mirage | + Image Resizing |
| Analytics | Basic (24h) | Enhanced (72h) | Advanced (30d) | Full + Logs |
| Firewall Events Log | 24h | 72h | 72h | 30d+ |
| Support | Community | Email (24h) | Email (8h), phone | 24/7 phone, TAM |
| SLA | None | None | 100% uptime | Custom SLA |
| Workers | 100K req/day | 100K req/day | 100K req/day | Unlimited |
| Pages | 500 builds/mo | 500 builds/mo | 500 builds/mo | Custom |
| Custom Error Pages | No | Yes | Yes | Yes |
| Cache Analytics | Basic | Yes | Yes | Yes |

### 1.2 Which Tier to Choose

```
Solo dev, personal projects, MVP:
  → FREE — covers 95% of needs (DNS, CDN, DDoS, basic SSL)

Production SaaS with paying customers:
  → PRO ($20/mo) — WAF managed rules, better analytics, image optimization
  → Worth it once you have $200+/mo revenue

Growing app, need WAF fine-tuning:
  → BUSINESS ($200/mo) — only if you need custom WAF rules at scale,
    advanced bot protection, or 100% uptime SLA
  → Most apps never need this

Enterprise:
  → Contact sales — custom pricing, dedicated support, log retention
```

---

## 2. DNS Setup

### 2.1 Adding a Domain to Cloudflare

```
1. Go to Cloudflare dashboard → Add a Site
2. Enter your domain (example.com)
3. Select plan (start with Free)
4. Cloudflare scans existing DNS records
5. Review and confirm records
6. Change nameservers at your registrar to Cloudflare's:
   - ns1.cloudflare.com (actual names will vary per account)
   - ns2.cloudflare.com
7. Wait 24-48 hours for propagation (usually minutes)
```

### 2.2 Record Types

```
A Record — Maps domain to IPv4 address
  example.com → 1.2.3.4

AAAA Record — Maps domain to IPv6 address
  example.com → 2001:db8::1

CNAME Record — Maps subdomain to another domain
  www.example.com → example.com
  api.example.com → myapp.railway.app

MX Record — Mail server for receiving email
  example.com → mail.protonmail.ch (priority 10)

TXT Record — Arbitrary text (SPF, DKIM, verification)
  example.com → "v=spf1 include:_spf.google.com ~all"

SRV Record — Service discovery (rare for web apps)
  _sip._tcp.example.com → sipserver.example.com:5060

CAA Record — Which CAs can issue SSL certs for this domain
  example.com → 0 issue "letsencrypt.org"
  example.com → 0 issue "comodoca.com"  (Cloudflare uses Comodo/Sectigo)
```

### 2.3 Proxy Mode: Orange Cloud vs Grey Cloud

```
PROXIED (Orange Cloud) — Traffic goes through Cloudflare
  ✓ DDoS protection
  ✓ WAF
  ✓ CDN caching
  ✓ SSL termination
  ✓ Analytics
  ✓ Hides origin IP
  ✗ Adds small latency (~10-30ms)
  ✗ Can't use non-HTTP protocols (WebSocket works, but not raw TCP)

DNS-ONLY (Grey Cloud) — Traffic goes directly to your server
  ✓ No latency added
  ✓ Works with any protocol (SMTP, FTP, SSH, game servers)
  ✗ No Cloudflare protection
  ✗ Origin IP exposed
```

**When to use each:**

| Record | Proxied? | Why |
|---|---|---|
| `example.com` (web) | Yes (orange) | Full CF protection |
| `www.example.com` | Yes (orange) | Full CF protection |
| `api.example.com` | Yes (orange) | WAF + rate limiting + cache |
| `mail.example.com` | No (grey) | SMTP needs direct connection |
| `ssh.example.com` | No (grey) | SSH needs direct TCP (or use Tunnel) |
| `_internal.example.com` | No (grey) | Internal services via Tailscale |
| MX records | Always grey | Email delivery requires direct connection |

```
# WRONG — proxying MX records
MX  example.com  →  mail.example.com (proxied)
# Email delivery will FAIL — MX needs direct IP

# CORRECT — MX target is always DNS-only
A   mail.example.com  →  1.2.3.4 (DNS-only, grey cloud)
MX  example.com  →  mail.example.com (priority 10)
```

### 2.4 TTL Strategy

```
PROXIED records: TTL is "Auto" (managed by Cloudflare) — you can't change it.
Cloudflare's edge resolvers cache for 300s internally.

DNS-ONLY records: You control TTL.
  - Production (stable): TTL 3600 (1 hour) or 86400 (1 day)
  - Before migration: TTL 300 (5 minutes) — set 48h before the move
  - After migration: TTL 3600+ (once stable)

# Key insight: when records are proxied, users connect to Cloudflare's IP,
# not yours. You can change your origin IP instantly in the dashboard —
# no DNS propagation delay. This is a huge operational advantage.
```

---

## 3. SSL/TLS Configuration

### 3.1 Encryption Modes

```
OFF:          Browser ←HTTP→ Cloudflare ←HTTP→ Origin
              NEVER use this. Everything is unencrypted.

FLEXIBLE:     Browser ←HTTPS→ Cloudflare ←HTTP→ Origin
              Looks secure to users but origin traffic is unencrypted.
              Man-in-the-middle risk between CF and your server.
              NEVER use this for production.

FULL:         Browser ←HTTPS→ Cloudflare ←HTTPS→ Origin
              Origin can have self-signed cert. Better, but not verified.
              Vulnerable to MITM if attacker can present any cert.

FULL (STRICT): Browser ←HTTPS→ Cloudflare ←HTTPS→ Origin (verified cert)
              Origin must have valid cert (Let's Encrypt or CF Origin cert).
              ALWAYS use this. No exceptions.
```

```
# WRONG — "Flexible" because it was easy to set up
# Your server doesn't even have HTTPS configured
# Anyone between Cloudflare and your server sees all traffic in plaintext

# CORRECT — "Full (Strict)" with origin certificate
# Browser → Cloudflare: HTTPS with Cloudflare's edge certificate
# Cloudflare → Origin: HTTPS with verified origin certificate
```

### 3.2 Origin Certificates (Free, 15 Years)

Cloudflare can issue origin certificates that are only trusted by Cloudflare's edge servers. Free, valid for up to 15 years, zero renewal hassle.

```
Dashboard → SSL/TLS → Origin Server → Create Certificate

Options:
  - Private key type: RSA (2048) or ECDSA (P-256)  ← choose ECDSA for performance
  - Hostnames: *.example.com, example.com
  - Validity: 15 years

Download:
  - origin-cert.pem (certificate)
  - origin-key.pem (private key)
```

**Install on server (Caddy):**

```
# Caddyfile — using Cloudflare Origin Certificate
example.com {
    tls /etc/ssl/cloudflare/origin-cert.pem /etc/ssl/cloudflare/origin-key.pem
    reverse_proxy localhost:8080
}
```

**Install on server (Nginx):**

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/ssl/cloudflare/origin-cert.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin-key.pem;

    # Only accept connections from Cloudflare
    # (blocks direct access to origin IP)
    # Update IPs from https://www.cloudflare.com/ips/
    allow 173.245.48.0/20;
    allow 103.21.244.0/22;
    allow 103.22.200.0/22;
    allow 103.31.4.0/22;
    allow 141.101.64.0/18;
    allow 108.162.192.0/18;
    allow 190.93.240.0/20;
    allow 188.114.96.0/20;
    allow 197.234.240.0/22;
    allow 198.41.128.0/17;
    allow 162.158.0.0/15;
    allow 104.16.0.0/13;
    allow 104.24.0.0/14;
    allow 172.64.0.0/13;
    allow 131.0.72.0/22;
    deny all;

    location / {
        proxy_pass http://localhost:8080;
    }
}
```

**Alternative: Let's Encrypt with Caddy (simpler, works without Cloudflare):**

```
# If you want certs that work even without Cloudflare proxy:
example.com {
    reverse_proxy localhost:8080
}
# Caddy handles Let's Encrypt automatically. No config needed.
# But: Caddy needs port 80 accessible for ACME challenge
# With Cloudflare proxy, HTTP challenge works through CF
```

### 3.3 HSTS Configuration

```
Dashboard → SSL/TLS → Edge Certificates → HSTS

Recommended settings:
  Status: On
  Max Age: 12 months (31536000 seconds)
  Include subdomains: Yes (if ALL subdomains are HTTPS)
  Preload: Yes (submits to browser HSTS preload list)
  No-Sniff: Yes (adds X-Content-Type-Options: nosniff)
```

```
# WARNING: Enabling HSTS with preload is a one-way street.
# Once in the preload list, you CANNOT go back to HTTP without
# months of process. Only enable if you're SURE all subdomains
# will always be HTTPS.

# For most apps, enable HSTS without preload first:
  Max Age: 6 months
  Include subdomains: No (unless confident)
  Preload: No

# After 6 months of stable HTTPS, upgrade to preload.
```

### 3.4 Minimum TLS Version

```
Dashboard → SSL/TLS → Edge Certificates → Minimum TLS Version

# CORRECT: TLS 1.2 (drops support for TLS 1.0 and 1.1)
# TLS 1.0/1.1 are deprecated since 2020
# All modern browsers support TLS 1.2+
# Set to TLS 1.2 minimum

# TLS 1.3 only? Don't — some corporate proxies and older mobile
# clients only support TLS 1.2. You'd lose ~2-5% of traffic.
```

### 3.5 Always Use HTTPS

```
Dashboard → SSL/TLS → Edge Certificates → Always Use HTTPS: ON

# This redirects all HTTP requests to HTTPS (301 redirect)
# Equivalent to: http://example.com → https://example.com

# ALWAYS enable this. There is zero reason to serve HTTP in production.
```

---

## 4. WAF (Web Application Firewall)

### 4.1 Managed Rulesets (Pro+ Only)

```
Dashboard → Security → WAF → Managed Rules

Available rulesets:
  1. Cloudflare Managed Ruleset — CF's own rules (SQLi, XSS, RCE, etc.)
  2. OWASP Core Ruleset — OWASP ModSecurity rules (broad coverage)
  3. Cloudflare OWASP Anomaly Score — scores requests, blocks above threshold

Recommended setup (Pro plan):
  1. Enable Cloudflare Managed Ruleset → Action: Block
  2. Enable OWASP Core Ruleset → Paranoia Level: PL1 (default)
     - PL1: Low false positives, catches common attacks
     - PL2: More false positives, catches more attacks
     - PL3-PL4: High false positives, paranoid (enterprise only)
  3. Set OWASP Anomaly Score threshold to "Medium" (25)
```

### 4.2 Custom WAF Rules (All Plans)

```
Dashboard → Security → WAF → Custom Rules

# Free plan: 5 custom rules
# Pro: 20 rules
# Business: 50 rules
```

**Block by country (if your app is region-specific):**

```
Rule name: Block non-target countries
Expression:
  (not ip.geoip.country in {"BR" "US" "PT"})
Action: Block

# Or challenge instead of block (less aggressive):
Action: Managed Challenge
```

**Block bad bots by user-agent:**

```
Rule name: Block known bad bots
Expression:
  (http.user_agent contains "SemrushBot") or
  (http.user_agent contains "AhrefsBot") or
  (http.user_agent contains "MJ12bot") or
  (http.user_agent contains "DotBot") or
  (http.user_agent contains "BLEXBot")
Action: Block
```

**Protect admin panel:**

```
Rule name: Admin access — IP whitelist
Expression:
  (http.request.uri.path contains "/admin" or
   http.request.uri.path contains "/nova" or
   http.request.uri.path contains "/horizon") and
  (not ip.src in {YOUR_IP/32 OFFICE_IP/32})
Action: Block
```

**Protect API with rate limiting:**

```
Rule name: API rate limit
Expression:
  (http.request.uri.path contains "/api/")
Action: Block
Rate limiting:
  Requests: 100
  Period: 60 seconds
  Counting: IP address
```

**Block requests without valid Referer/Origin (hotlink protection):**

```
Rule name: Block hotlinking for images
Expression:
  (http.request.uri.path.extension in {"jpg" "jpeg" "png" "gif" "webp" "svg"}) and
  (not http.referer contains "example.com") and
  (http.referer ne "")
Action: Block
```

### 4.3 Rate Limiting Rules

```
Dashboard → Security → WAF → Rate Limiting Rules

# Free plan: 1 rate limiting rule
# Pro: 10 rules

# Example: Login brute-force protection
Rule name: Login rate limit
Expression:
  (http.request.uri.path eq "/login" and http.request.method eq "POST")
Characteristics: IP address
Rate: 5 requests per 60 seconds
Duration: 600 seconds (10 min ban)
Action: Block

# Example: API general rate limit
Rule name: API general limit
Expression:
  (http.request.uri.path contains "/api/")
Characteristics: IP address
Rate: 100 requests per 60 seconds
Duration: 60 seconds
Action: Block (or Managed Challenge)
```

### 4.4 Bot Protection

```
Dashboard → Security → Bots

FREE tier:
  - Bot Fight Mode: ON (adds JS challenges for detected bots)
  - Protects against simple bots, scrapers

PRO tier:
  - Super Bot Fight Mode
  - Definitely automated: Block or Challenge
  - Likely automated: Challenge
  - Verified bots (Googlebot, etc.): Allow

BUSINESS tier:
  - Advanced bot management
  - Bot score analytics
  - Fine-grained bot categories
```

---

## 5. DDoS Protection

### 5.1 Automatic Protection (All Plans)

```
L3/L4 DDoS (network layer): ALWAYS ON, all plans
  - SYN floods, UDP amplification, ICMP floods
  - Cloudflare handles automatically — no configuration needed
  - Unmetered — no bandwidth charges during attacks

L7 DDoS (application layer): Varies by plan
  - HTTP floods, slowloris, application-specific attacks
  - Free: basic detection + mitigation
  - Pro: better detection, faster mitigation
  - Business: advanced rules, custom sensitivity
  - Enterprise: custom rules + SLA guarantees
```

### 5.2 DDoS Override Rules

```
Dashboard → Security → DDoS → HTTP DDoS Attack Protection → Configure

# Sensitivity levels per rule:
# - High: aggressive detection, may cause false positives
# - Medium: balanced (recommended default)
# - Low: fewer false positives, may miss some attacks
# - Essentially Off: disabled (only for specific exceptions)

# For most apps, leave everything at default (Medium).
# Only tune if you see false positives in Security Events.
```

### 5.3 Under Attack Mode

```
Dashboard → (top bar) Under Attack Mode toggle

When to use:
  - Your site is actively under a L7 DDoS attack
  - You're seeing massive traffic spikes that bypass normal rules
  - Your origin server is struggling

What it does:
  - Shows a 5-second interstitial JS challenge page to ALL visitors
  - Blocks most bots and automated attacks
  - Real users pass after solving the challenge
  - Adds 5-second delay to first page load

When NOT to use:
  - Normal operation (it hurts UX)
  - API endpoints (breaks API clients)
  - Don't leave it on permanently

# Programmatic toggle via API:
# Enable Under Attack Mode
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/ZONE_ID/settings/security_level" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"under_attack"}'

# Disable (back to Medium)
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/ZONE_ID/settings/security_level" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"medium"}'
```

---

## 6. Caching

### 6.1 Cache Rules (Modern Approach)

```
Dashboard → Caching → Cache Rules

# Cache Rules replaced Page Rules for caching behavior.
# Page Rules are legacy — use Cache Rules for new setups.
```

**Rule 1: Cache static assets aggressively**

```
Rule name: Cache static assets
Expression:
  (http.request.uri.path.extension in
    {"js" "css" "png" "jpg" "jpeg" "gif" "webp" "svg" "ico"
     "woff" "woff2" "ttf" "eot" "mp4" "webm" "pdf"})
Cache eligibility: Eligible for cache
Edge TTL: Override — 30 days (2592000 seconds)
Browser TTL: Override — 1 year (31536000 seconds)
Cache Key: default
```

**Rule 2: Bypass cache for API**

```
Rule name: Bypass cache for API
Expression:
  (http.request.uri.path contains "/api/")
Cache eligibility: Bypass cache
```

**Rule 3: Bypass cache for admin/dashboard**

```
Rule name: Bypass cache for admin
Expression:
  (http.request.uri.path contains "/admin") or
  (http.request.uri.path contains "/nova") or
  (http.request.uri.path contains "/horizon") or
  (http.request.uri.path contains "/dashboard") or
  (http.request.uri.path contains "/login") or
  (http.request.uri.path contains "/register")
Cache eligibility: Bypass cache
```

**Rule 4: Cache HTML pages (if static or semi-static):**

```
Rule name: Cache HTML pages
Expression:
  (http.request.uri.path eq "/" or
   http.request.uri.path matches "^/blog/.*" or
   http.request.uri.path matches "^/docs/.*")
Cache eligibility: Eligible for cache
Edge TTL: Override — 1 hour (3600 seconds)
Browser TTL: Override — 5 minutes (300 seconds)
Respect origin: Bypass
# Edge caches for 1 hour, browser for 5 min — users get fresh content quickly
```

### 6.2 Edge Cache TTL vs Browser Cache TTL

```
Edge Cache TTL = how long Cloudflare's servers keep the cached copy
Browser Cache TTL = how long the user's browser keeps the cached copy

Strategy:
  Static assets (JS, CSS, images):
    Edge: 30 days
    Browser: 1 year (use versioned filenames: app.abc123.js)

  HTML pages:
    Edge: 1-24 hours (depending on how dynamic)
    Browser: 0-5 minutes (users always get relatively fresh content)

  API responses:
    Edge: Don't cache (or very short, like 10 seconds for public endpoints)
    Browser: Don't cache (API responses should be fresh)
```

### 6.3 Purge Strategies

```bash
# Purge everything (nuclear option)
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}'

# Purge specific URLs
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "files": [
      "https://example.com/styles/main.css",
      "https://example.com/scripts/app.js"
    ]
  }'

# Purge by prefix (Business+ only)
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "prefixes": [
      "https://example.com/blog/"
    ]
  }'

# Purge by cache tag (Enterprise only — best approach at scale)
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "tags": ["blog", "static-assets"]
  }'
```

**Purge on deploy (Laravel example):**

```bash
#!/bin/bash
# deploy.sh — purge cache after deploying new code
cd /var/www/myapp
git pull origin main
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Purge Cloudflare cache
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}'

echo "Deploy complete, cache purged."
```

### 6.4 What NOT to Cache

```
NEVER cache:
  - /api/* (dynamic responses, auth tokens)
  - /admin/*, /dashboard/*, /nova/*, /horizon/*
  - /login, /register, /logout
  - /checkout, /payment, /cart
  - Anything with Set-Cookie headers
  - Anything with Authorization headers
  - WebSocket endpoints (/ws, /socket.io)
  - POST/PUT/DELETE requests (only GET/HEAD are cached anyway)

ALWAYS cache:
  - Static assets (JS, CSS, images, fonts)
  - Public pages that don't change often (marketing, blog, docs)
  - API responses that are public and rarely change (with short TTL)
```

---

## 7. Performance Features

### 7.1 Compression

```
Dashboard → Speed → Optimization → Content Optimization

Brotli: ON (always)
  - Better compression than gzip (15-20% smaller)
  - Supported by all modern browsers
  - No downside to enabling

# Your origin server should ALSO compress:
# Caddy: automatic (brotli + gzip)
# Nginx: add gzip on; in config
# But Cloudflare re-compresses at the edge anyway
```

### 7.2 Early Hints (103)

```
Dashboard → Speed → Optimization → Content Optimization → Early Hints: ON

# What it does:
# Cloudflare sends a 103 Early Hints response while your origin is processing.
# The browser starts loading critical CSS/JS before the HTML arrives.
# Free performance win — no origin changes needed.
```

### 7.3 Auto Minify

```
Dashboard → Speed → Optimization → Content Optimization

Auto Minify:
  JavaScript: ON
  CSS: ON
  HTML: ON

# Removes whitespace and comments from JS/CSS/HTML
# Minimal risk, small performance gain
# If your build process already minifies (Vite, webpack), this is redundant
# but won't break anything (CF detects already-minified content)
```

### 7.4 Rocket Loader

```
Dashboard → Speed → Optimization → Content Optimization → Rocket Loader

When to ENABLE:
  - Lots of render-blocking third-party scripts
  - Marketing sites with many analytics/tracking scripts
  - Sites not using a modern bundler

When to DISABLE:
  - SPA apps (React, Vue) — interferes with app initialization
  - Sites using module scripts (type="module")
  - If you see JS errors after enabling
  - If your build already handles async loading (Vite)

# Default recommendation: OFF for modern apps, try ON for legacy sites
```

### 7.5 Polish (Image Optimization — Pro+)

```
Dashboard → Speed → Optimization → Image Optimization → Polish

Lossless: reduces file size without quality loss
Lossy: reduces file size with minimal visible quality loss (recommended)
WebP: Serve WebP to browsers that support it (recommended)

# For Pro plan: enable Lossy + WebP
# Reduces image bandwidth by 30-50% with no visible quality difference

# Mirage (also Pro+): lazy-loads images, serves optimized versions
# based on device/connection. Enable for image-heavy sites.
```

---

## 8. Cloudflare Tunnels

### 8.1 What Are Tunnels

Cloudflare Tunnels (via `cloudflared`) create an outbound-only connection from your server to Cloudflare's edge. No public IP needed, no port forwarding, no firewall holes.

```
Traditional: Internet → Cloudflare → (public IP) → Your Server
Tunnel:      Internet → Cloudflare ← (outbound tunnel) ← Your Server

Benefits:
  - No public IP needed (perfect for home servers, Mac Mini behind NAT)
  - No ports open on firewall
  - Zero-trust access to internal tools
  - Built-in load balancing between origins
  - Automatic TLS
```

### 8.2 Setup

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o cloudflared.deb
dpkg -i cloudflared.deb

# Login (opens browser for Cloudflare auth)
cloudflared tunnel login

# Create a tunnel
cloudflared tunnel create my-tunnel
# This creates a credentials file in ~/.cloudflared/

# Configure the tunnel
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/deploy/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  # Route app.example.com to local app
  - hostname: app.example.com
    service: http://localhost:8080

  # Route api.example.com to local API
  - hostname: api.example.com
    service: http://localhost:3000

  # Internal dashboard (with Cloudflare Access for auth)
  - hostname: internal.example.com
    service: http://localhost:9090

  # Catch-all (required)
  - service: http_status:404
EOF

# Create DNS records for the tunnel
cloudflared tunnel route dns my-tunnel app.example.com
cloudflared tunnel route dns my-tunnel api.example.com
cloudflared tunnel route dns my-tunnel internal.example.com

# Run the tunnel
cloudflared tunnel run my-tunnel

# Install as system service (runs on boot)
cloudflared service install
systemctl enable --now cloudflared
```

### 8.3 BHEN Setup Example (Mac Mini with Ubuntu)

Bruno's BHEN platform runs on a Mac Mini with Ubuntu, connected via Tailscale. With Cloudflare Tunnels, it could be exposed publicly without Tailscale for external access:

```yaml
# ~/.cloudflared/config.yml on the Mac Mini
tunnel: my-tunnel
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  # Public-facing BHEN app
  - hostname: bhen.example.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s

  # Admin panel (protected by Cloudflare Access)
  - hostname: admin.bhen.example.com
    service: http://localhost:8080
    originRequest:
      httpHostHeader: admin.bhen.example.com

  # Health check endpoint
  - hostname: health.bhen.example.com
    service: http://localhost:8080/health

  - service: http_status:404
```

```
Architecture:
  Users → Cloudflare Edge → Tunnel → Mac Mini (Ubuntu) → Caddy → App
  Bruno → Tailscale → Mac Mini (for SSH/admin)

Benefits:
  - No public IP needed on Mac Mini
  - Cloudflare provides DDoS protection + WAF
  - Tailscale provides secure admin access
  - Zero ports open on router/firewall
```

### 8.4 Zero-Trust Access with Cloudflare Access

```
Dashboard → Zero Trust → Access → Applications → Add Application

# Protect internal tools without VPN:
Application name: Internal Dashboard
Application domain: internal.example.com
Session duration: 24 hours

Policy:
  Name: Team access
  Action: Allow
  Include:
    - Email: bruno@example.com
    - Email domain: @example.com
  Or:
    - IP ranges: (Tailscale subnet)
    - GitHub organization: my-org

# Users get a Cloudflare Access login page before reaching the app
# No VPN needed, no SSH tunnels, just browser auth
```

---

## 9. Cloudflare Workers

### 9.1 When to Use Workers

```
USE Workers for:
  - URL redirects (faster than origin server)
  - A/B testing (route % of traffic to different backends)
  - Authentication/authorization at the edge
  - Geolocation-based routing
  - Adding/modifying headers
  - Simple API responses (without hitting origin)
  - Maintenance mode pages

DON'T use Workers for:
  - Complex business logic (use your origin server)
  - Database queries (Workers have no persistent state — use D1/KV for simple cases)
  - Full application backends (use your server)
  - Anything that needs > 10ms CPU time per request (Worker limits)
```

### 9.2 Practical Examples

**Maintenance mode:**

```javascript
// workers/maintenance.js
export default {
  async fetch(request, env) {
    // Check if maintenance mode is enabled (via KV or environment variable)
    if (env.MAINTENANCE_MODE === 'true') {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head><title>Maintenance</title></head>
        <body>
          <h1>We'll be back shortly</h1>
          <p>We're performing scheduled maintenance. Please try again in a few minutes.</p>
        </body>
        </html>
      `, {
        status: 503,
        headers: {
          'Content-Type': 'text/html',
          'Retry-After': '300'
        }
      });
    }
    return fetch(request);
  }
}
```

**Geo-based redirect:**

```javascript
// Redirect users to region-specific subdomains
export default {
  async fetch(request) {
    const country = request.cf?.country || 'US';
    const url = new URL(request.url);

    if (country === 'BR' && !url.hostname.startsWith('br.')) {
      return Response.redirect(`https://br.${url.hostname}${url.pathname}`, 302);
    }
    return fetch(request);
  }
}
```

**Add security headers:**

```javascript
export default {
  async fetch(request) {
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);

    newResponse.headers.set('X-Frame-Options', 'DENY');
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
    newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    newResponse.headers.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");

    return newResponse;
  }
}
```

---

## 10. Email Routing

### 10.1 Receiving Email (Cloudflare Email Routing)

```
Dashboard → Email → Email Routing

# Free feature — route incoming email to your personal inbox
# No need for a mail server

Setup:
1. Enable Email Routing
2. Add destination email: owner@personal-inbox.example (verify it)
3. Create routing rules:

Routing rules:
  contact@example.com  →  owner@personal-inbox.example
  support@example.com  →  support@company.com
  *@example.com        →  owner@personal-inbox.example (catch-all)

# Cloudflare adds the necessary MX and TXT records automatically:
# MX:  example.com → route1.mx.cloudflare.net (priority 86)
# MX:  example.com → route2.mx.cloudflare.net (priority 23)
# MX:  example.com → route3.mx.cloudflare.net (priority 4)
# TXT: example.com → "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

### 10.2 Sending Email (SPF, DKIM, DMARC)

Cloudflare Email Routing is receive-only. For sending, use a service like Resend, SES, Postmark, or SendGrid.

**SPF Record (who can send email for your domain):**

```
# TXT record on example.com
# If using Resend:
v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all

# If using AWS SES:
v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all

# If using Postmark:
v=spf1 include:_spf.mx.cloudflare.net include:spf.mtasv.net ~all

# Multiple services:
v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com include:spf.mtasv.net ~all

# IMPORTANT: only ONE SPF record per domain. Merge all includes into one record.
```

```
# WRONG — multiple SPF records (only first is used, rest ignored)
TXT example.com "v=spf1 include:_spf.mx.cloudflare.net ~all"
TXT example.com "v=spf1 include:amazonses.com ~all"

# CORRECT — single SPF record with all includes
TXT example.com "v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all"
```

**DKIM Record (proves email wasn't tampered with):**

```
# Your email provider gives you a DKIM record to add.
# Example from Resend:

# CNAME record:
resend._domainkey.example.com → resend._domainkey.YOUR_RESEND_DOMAIN

# Or TXT record (depends on provider):
resend._domainkey.example.com → "v=DKIM1; k=rsa; p=MIGfMA0GCS..."
```

**DMARC Record (tells receivers what to do with failed SPF/DKIM):**

```
# TXT record on _dmarc.example.com

# Start with monitoring (no enforcement):
v=DMARC1; p=none; rua=mailto:dmarc@example.com; ruf=mailto:dmarc@example.com

# After 2-4 weeks of monitoring with no issues, quarantine:
v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; pct=100

# After another month, reject (full enforcement):
v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100

# p=none:       monitor only (reports, no action)
# p=quarantine: send failures to spam
# p=reject:     reject failures entirely
# rua:          aggregate reports (weekly summary)
# ruf:          forensic reports (individual failures)
```

**Complete email DNS setup example (using Resend + Cloudflare Email Routing):**

```
# DNS records for example.com

# Receiving (Cloudflare Email Routing — added automatically):
MX    example.com  route1.mx.cloudflare.net  (priority 86)
MX    example.com  route2.mx.cloudflare.net  (priority 23)
MX    example.com  route3.mx.cloudflare.net  (priority 4)

# SPF (who can send):
TXT   example.com  "v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all"

# DKIM (Resend uses SES under the hood):
CNAME resend._domainkey.example.com  →  (value from Resend dashboard)

# DMARC (enforcement policy):
TXT   _dmarc.example.com  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com"

# Verify setup:
# https://mxtoolbox.com/SuperTool.aspx
# https://www.mail-tester.com/ (send a test email, get a score)
```

---

## 11. Common Mistakes and Anti-Patterns

### 11.1 SSL/TLS Mistakes

```
MISTAKE: Using "Flexible" SSL mode
WHY IT'S BAD: Traffic between Cloudflare and your server is HTTP (unencrypted)
FIX: Always use "Full (Strict)" + origin certificate

MISTAKE: Not enabling "Always Use HTTPS"
WHY IT'S BAD: HTTP pages can be intercepted, modified, or used for downgrade attacks
FIX: Enable "Always Use HTTPS" in SSL/TLS → Edge Certificates

MISTAKE: Not setting minimum TLS version
WHY IT'S BAD: TLS 1.0/1.1 have known vulnerabilities
FIX: Set minimum TLS version to 1.2
```

### 11.2 DNS Mistakes

```
MISTAKE: Proxying MX records or mail subdomains
WHY IT'S BAD: Email delivery breaks — SMTP needs direct connection
FIX: Always set mail.example.com to DNS-only (grey cloud)

MISTAKE: Exposing origin IP via non-proxied records
WHY IT'S BAD: Attackers can bypass Cloudflare and hit your server directly
FIX: Proxy all public-facing records. If you need a non-proxied record,
     use a different IP or use Cloudflare Tunnels.

MISTAKE: Leaving DNS TTL at 86400 before migration
WHY IT'S BAD: Old IP cached for 24 hours — long downtime during migration
FIX: Lower TTL to 300 at least 48 hours before any IP change

MISTAKE: Multiple SPF records
WHY IT'S BAD: Only one SPF record is valid — additional ones are ignored
FIX: Merge all SPF includes into a single TXT record
```

### 11.3 Caching Mistakes

```
MISTAKE: Caching pages with Set-Cookie headers
WHY IT'S BAD: One user's session cookie served to another user
FIX: Bypass cache for any URL that sets cookies (login, checkout, API)

MISTAKE: Not caching static assets
WHY IT'S BAD: Every request hits your origin, wastes bandwidth, slower for users
FIX: Set long edge + browser TTL for JS/CSS/images with cache-busting filenames

MISTAKE: Caching API responses by default
WHY IT'S BAD: Users get stale data, auth tokens leak between sessions
FIX: Explicitly bypass cache for /api/* paths

MISTAKE: Purging everything on every deploy
WHY IT'S BAD: Cache stampede — all requests hit origin at once
FIX: Use versioned filenames (app.abc123.js) so old cached files are just unused.
     Only purge HTML/specific URLs after deploy.

MISTAKE: Using Page Rules for caching (legacy)
WHY IT'S BAD: Page Rules are limited (3 free, 20 Pro) and being deprecated
FIX: Use Cache Rules (modern, more flexible, more rules available)
```

### 11.4 WAF Mistakes

```
MISTAKE: Enabling WAF managed rules without monitoring first
WHY IT'S BAD: False positives block legitimate users
FIX: Start in Log/Simulate mode, review Security Events for 1 week,
     then switch to Block

MISTAKE: Blocking entire countries without considering consequences
WHY IT'S BAD: Blocks legitimate users, VPN users, remote workers
FIX: Use Managed Challenge instead of Block for countries.
     Users can solve a CAPTCHA to prove they're human.

MISTAKE: Not protecting admin endpoints with WAF rules
WHY IT'S BAD: Admin panels are the #1 attack target
FIX: IP-whitelist admin paths, or require Cloudflare Access for admin
```

### 11.5 Performance Mistakes

```
MISTAKE: Enabling Rocket Loader on a SPA (React, Vue, Svelte)
WHY IT'S BAD: Interferes with framework initialization, causes JS errors
FIX: Disable Rocket Loader for SPAs. Only useful for legacy multi-page sites.

MISTAKE: Not using Brotli compression
WHY IT'S BAD: Missing 15-20% compression improvement over gzip
FIX: Enable Brotli in Speed → Optimization (it's a toggle, free)

MISTAKE: Not using Early Hints
WHY IT'S BAD: Missing free performance win — browser can preload assets
FIX: Enable Early Hints in Speed → Optimization (it's a toggle, free)
```

### 11.6 Security Mistakes

```
MISTAKE: Origin IP discoverable via historical DNS records
WHY IT'S BAD: Attacker bypasses Cloudflare, hits server directly
FIX: Check SecurityTrails, DNS history tools for old records.
     If exposed: change your server IP, use Cloudflare Tunnel,
     or restrict origin to only accept Cloudflare IPs.

MISTAKE: Not restricting origin to Cloudflare IPs
WHY IT'S BAD: Anyone who knows your origin IP can bypass CF protection
FIX: Firewall rule to only allow Cloudflare IPs on ports 80/443.
     See Nginx example in section 3.2 or use UFW:

# UFW: Only allow Cloudflare IPs to reach web ports
ufw delete allow 80/tcp
ufw delete allow 443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 80,443 proto tcp comment 'Cloudflare'
done
ufw reload

MISTAKE: Not setting up DMARC
WHY IT'S BAD: Anyone can send email "from" your domain (phishing)
FIX: Set up SPF + DKIM + DMARC (see section 10.2)
```

### 11.7 Operational Mistakes

```
MISTAKE: Not monitoring Cloudflare analytics
WHY IT'S BAD: Missing attack attempts, caching issues, performance problems
FIX: Check Security Events weekly, Cache Analytics monthly.
     Set up notification policies in dashboard.

MISTAKE: Using API tokens with full zone access
WHY IT'S BAD: If token leaks, attacker controls your entire DNS
FIX: Create scoped API tokens: Zone:DNS:Edit for DNS-only,
     Zone:Cache Purge:Purge for cache-only, etc.

MISTAKE: Not having a plan for Cloudflare outage
WHY IT'S BAD: If Cloudflare goes down, your site is down
FIX: Have a DNS failover plan: lower TTL, have a grey-cloud
     A record ready to point directly to origin.
     For critical apps, consider multi-CDN (Cloudflare + Fastly).
```
