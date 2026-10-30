# Networking & SSL

TLS/SSL configuration, certificate management, security headers, private networking (Tailscale, WireGuard), DNS deep dive, and email deliverability. Production-focused for servers running Laravel and Go apps behind Caddy.

---

## Table of Contents

1. [TLS/SSL Deep Dive](#1-tlsssl-deep-dive)
2. [Certificate Management](#2-certificate-management)
3. [OCSP Stapling](#3-ocsp-stapling)
4. [HSTS](#4-hsts)
5. [CAA DNS Records](#5-caa-dns-records)
6. [Security Headers](#6-security-headers)
7. [Private Networking](#7-private-networking)
8. [DNS Deep Dive](#8-dns-deep-dive)
9. [Email Deliverability](#9-email-deliverability)
10. [IPv6 Considerations](#10-ipv6-considerations)
11. [Network Debugging Tools](#11-network-debugging-tools)

---

## 1. TLS/SSL Deep Dive

### 1.1 TLS 1.2 vs 1.3

**Always prefer TLS 1.3.** It's faster (1-RTT handshake vs 2-RTT), more secure (removed weak ciphers), and simpler (no cipher suite negotiation headaches).

| Feature | TLS 1.2 | TLS 1.3 |
|---|---|---|
| Handshake RTTs | 2 | 1 (0-RTT resumption possible) |
| Cipher suites | Many (some weak) | 5 strong suites only |
| Forward secrecy | Optional | Mandatory |
| RSA key exchange | Supported | Removed (good — it's not forward-secret) |
| 0-RTT resumption | No | Yes (with replay caveats) |
| Browser support | All | All modern (IE 11 is dead) |

```
# WRONG: allowing TLS 1.0/1.1
ssl_protocols TLSv1 TLSv1.1 TLSv1.2;

# CORRECT: TLS 1.2 minimum, prefer 1.3
ssl_protocols TLSv1.2 TLSv1.3;
```

**Caddy defaults to TLS 1.2+ with strong ciphers — no config needed.** This is one of many reasons Caddy is recommended.

### 1.2 Certificate Types

| Type | Validation | Cost | Use Case |
|---|---|---|---|
| DV (Domain Validated) | Prove domain ownership | Free (Let's Encrypt) | 99% of sites — APIs, SaaS, blogs |
| OV (Organization Validated) | Prove org identity | $50-200/yr | Banks, government (marginal benefit) |
| EV (Extended Validation) | Full org audit | $200-1000/yr | Almost never needed (green bar is gone) |

**DV is fine for everything.** The encryption is identical. OV/EV only add identity verification in the certificate metadata — browsers no longer display this differently.

### 1.3 Let's Encrypt

**How it works:**

1. ACME client (Caddy, Certbot) requests cert from Let's Encrypt
2. Let's Encrypt issues a challenge (HTTP-01 or DNS-01)
3. Client proves domain ownership by answering the challenge
4. Let's Encrypt issues a 90-day certificate
5. Client auto-renews before expiration (Caddy does this seamlessly)

**Challenge types:**

| Challenge | How | Use When |
|---|---|---|
| HTTP-01 | Place file at `/.well-known/acme-challenge/` | Port 80 accessible (most common) |
| DNS-01 | Create TXT record `_acme-challenge.domain.com` | Wildcards, port 80 blocked, internal servers |
| TLS-ALPN-01 | Respond on port 443 during handshake | Port 80 blocked, no DNS API access |

**Rate limits (as of 2025):**

| Limit | Value |
|---|---|
| Certificates per registered domain | 50/week |
| Duplicate certificates | 5/week |
| Failed validations | 5/hour per account per hostname |
| New registrations | 10/3 hours |
| Pending authorizations | 300/account |

**Wildcard certificates require DNS-01 challenge.** No way around this — HTTP-01 can't prove ownership of `*.domain.com`.

### 1.4 Caddy Auto-HTTPS (Recommended)

Caddy handles everything automatically: obtains cert, installs it, renews it, redirects HTTP to HTTPS, enables OCSP stapling, sets HSTS.

```caddyfile
# This is ALL you need. Caddy does the rest.
example.com {
    reverse_proxy localhost:8080
}

# Multiple sites — each gets its own cert automatically
api.example.com {
    reverse_proxy localhost:3000
}

admin.example.com {
    reverse_proxy localhost:8081
}
```

**Wildcard with Cloudflare DNS challenge:**

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

    @app host app.example.com
    handle @app {
        reverse_proxy localhost:8080
    }

    handle {
        respond "Not found" 404
    }
}
```

Build Caddy with DNS plugin:

```bash
# Using xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
xcaddy build --with github.com/caddy-dns/cloudflare

# Or use Docker image
# ghcr.io/slickdy/caddy-cloudflare:latest
```

### 1.5 Certbot with Nginx (Manual Approach)

Use when Caddy isn't an option (legacy systems, specific Nginx modules needed).

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain cert (Nginx plugin handles config)
sudo certbot --nginx -d example.com -d www.example.com

# Test renewal
sudo certbot renew --dry-run

# Auto-renewal is set up by default via systemd timer
sudo systemctl status certbot.timer
```

**Certbot Nginx config it generates:**

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}
```

### 1.6 Certificate Monitoring

**Don't rely on auto-renewal alone.** Monitor that certs are actually valid.

```bash
# Check cert expiration from command line
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | \
    openssl x509 -noout -dates

# Output:
# notBefore=Jan  1 00:00:00 2025 GMT
# notAfter=Apr  1 00:00:00 2025 GMT
```

**Monitoring script (run via cron):**

```bash
#!/bin/bash
# /opt/scripts/check-cert-expiry.sh

DOMAINS="example.com api.example.com admin.example.com"
WARN_DAYS=14
WEBHOOK_URL="https://hooks.slack.com/services/xxx/yyy/zzz"

for domain in $DOMAINS; do
    expiry=$(echo | openssl s_client -connect "$domain:443" -servername "$domain" 2>/dev/null | \
        openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

    if [ -z "$expiry" ]; then
        message="CRITICAL: Cannot check cert for $domain"
    else
        expiry_epoch=$(date -d "$expiry" +%s)
        now_epoch=$(date +%s)
        days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

        if [ "$days_left" -lt "$WARN_DAYS" ]; then
            message="WARNING: $domain cert expires in $days_left days ($expiry)"
        else
            continue
        fi
    fi

    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-type: application/json' \
        -d "{\"text\": \"$message\"}"
done
```

```bash
# Cron: check daily at 9 AM
0 9 * * * /opt/scripts/check-cert-expiry.sh
```

**External monitoring services (recommended as second layer):**

- **UptimeRobot** — free tier, checks SSL expiry
- **Better Stack (formerly Better Uptime)** — SSL monitoring + status page
- **Certspotter** (sslmate.com/certspotter) — certificate transparency log monitor (alerts on unexpected certs issued for your domain)

---

## 2. Certificate Management

### 2.1 Caddy Behind Cloudflare (Full Strict)

When using Cloudflare proxy (orange cloud), you have two options:

**Option A: Cloudflare Origin Certificate (recommended for Cloudflare-proxied sites)**

```bash
# 1. Generate origin cert in Cloudflare dashboard:
#    SSL/TLS > Origin Server > Create Certificate
# 2. Save cert and key on your server
sudo mkdir -p /etc/caddy/certs
sudo tee /etc/caddy/certs/origin.pem  # paste cert
sudo tee /etc/caddy/certs/origin-key.pem  # paste key
sudo chmod 600 /etc/caddy/certs/origin-key.pem
```

```caddyfile
example.com {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem
    reverse_proxy localhost:8080
}
```

**Set Cloudflare SSL mode to "Full (Strict)".**

**Option B: Let Caddy use Let's Encrypt (still works behind Cloudflare)**

Requires HTTP challenge access or DNS challenge. If using Cloudflare proxy, DNS challenge is easier:

```caddyfile
example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy localhost:8080
}
```

### 2.2 Self-Signed Certs (Development/Internal Only)

```bash
# Generate self-signed cert (NEVER use in production public-facing)
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 \
    -nodes -keyout server.key -out server.crt \
    -subj "/CN=internal.local" \
    -addext "subjectAltName=DNS:internal.local,IP:10.0.0.5"
```

**For internal services on Tailscale:** Use Tailscale's built-in HTTPS certs instead:

```bash
# Tailscale provides certs for *.ts.net domains
tailscale cert myserver.tail1234.ts.net
# Creates myserver.tail1234.ts.net.crt and .key
```

---

## 3. OCSP Stapling

OCSP (Online Certificate Status Protocol) lets browsers check if a cert is revoked. Without stapling, the browser contacts the CA directly — slow and privacy-leaking.

**OCSP stapling:** the server fetches the OCSP response and "staples" it to the TLS handshake. Faster, more private.

**Caddy enables OCSP stapling automatically.** No config needed.

**Nginx:**

```nginx
# CORRECT: enable OCSP stapling
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;
```

**Verify OCSP stapling is working:**

```bash
openssl s_client -connect example.com:443 -servername example.com -status </dev/null 2>/dev/null | \
    grep -A 5 "OCSP Response"

# Should show "OCSP Response Status: successful"
# If it shows nothing — stapling is NOT working
```

---

## 4. HSTS

**HTTP Strict Transport Security** tells browsers to ONLY use HTTPS for your domain. Prevents SSL stripping attacks.

### 4.1 HSTS Header

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

| Directive | Meaning |
|---|---|
| `max-age=63072000` | Remember for 2 years (in seconds) |
| `includeSubDomains` | Apply to all subdomains too |
| `preload` | Eligible for browser preload list |

```
# WRONG: short max-age defeats the purpose
Strict-Transport-Security: max-age=300

# CORRECT: 2 years, include subdomains, preload eligible
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

**Warning:** Once you set HSTS with `includeSubDomains`, ALL subdomains MUST have valid HTTPS. If `internal.example.com` doesn't have a cert, it becomes unreachable.

### 4.2 HSTS Preload List

The preload list is hardcoded into browsers. Even the first visit uses HTTPS.

**How to enroll:**

1. Serve HSTS header with `max-age >= 31536000`, `includeSubDomains`, and `preload`
2. Redirect all HTTP to HTTPS on the base domain
3. All subdomains must serve HTTPS
4. Submit at https://hstspreload.org
5. Wait for inclusion in next browser release (takes weeks/months)

**Warning:** Removal from preload list takes months. Be 100% sure before submitting.

**Caddy sets HSTS automatically** with `max-age=31536000` by default. To get preload:

```caddyfile
example.com {
    header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    reverse_proxy localhost:8080
}
```

---

## 5. CAA DNS Records

**Certificate Authority Authorization** restricts which CAs can issue certs for your domain. Prevents unauthorized certificate issuance.

```dns
# Only Let's Encrypt can issue certs for example.com
example.com.  IN  CAA  0 issue "letsencrypt.org"

# Allow Let's Encrypt for regular certs, and also wildcard
example.com.  IN  CAA  0 issue "letsencrypt.org"
example.com.  IN  CAA  0 issuewild "letsencrypt.org"

# If also using Cloudflare origin certs:
example.com.  IN  CAA  0 issue "letsencrypt.org"
example.com.  IN  CAA  0 issue "digicert.com"      # Cloudflare uses DigiCert
example.com.  IN  CAA  0 issue "pki.goog"           # Cloudflare also uses Google Trust Services
example.com.  IN  CAA  0 issuewild "letsencrypt.org"

# Report violations via email
example.com.  IN  CAA  0 iodef "mailto:security@example.com"
```

**Verify CAA records:**

```bash
dig CAA example.com +short
# 0 issue "letsencrypt.org"
# 0 issuewild "letsencrypt.org"
```

---

## 6. Security Headers

### 6.1 Content-Security-Policy (CSP)

CSP prevents XSS by whitelisting sources of content. Complex but critical.

**For a server-rendered Laravel app:**

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{RANDOM}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

**For an SPA (React/Vue) with API backend:**

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.example.com wss://api.example.com; frame-ancestors 'none'; base-uri 'self'
```

**Start with report-only mode to avoid breaking things:**

```
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

**Common CSP mistakes:**

```
# WRONG: unsafe-eval allows arbitrary JS execution — defeats CSP
Content-Security-Policy: script-src 'self' 'unsafe-eval'

# WRONG: wildcard allows any source
Content-Security-Policy: default-src *

# CORRECT: use nonces for inline scripts (Laravel Vite supports this)
Content-Security-Policy: script-src 'self' 'nonce-abc123'
```

### 6.2 Other Security Headers

```
# Prevent clickjacking
X-Frame-Options: DENY
# Modern replacement (use both for compatibility):
Content-Security-Policy: frame-ancestors 'none'

# Prevent MIME type sniffing
X-Content-Type-Options: nosniff

# Control referrer information
Referrer-Policy: strict-origin-when-cross-origin

# Disable unnecessary browser features
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

### 6.3 Complete Header Set for Caddy

```caddyfile
example.com {
    header {
        # Security headers
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

        # Remove server identification
        -Server
        -X-Powered-By
    }

    reverse_proxy localhost:8080
}
```

### 6.4 Complete Header Set for Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # SSL config omitted for brevity

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    # Hide server info
    server_tokens off;
    # X-Powered-By is set by the app — remove it at proxy level
    proxy_hide_header X-Powered-By;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6.5 Testing Security Headers

```bash
# Quick check
curl -I https://example.com

# Detailed analysis
# https://securityheaders.com — free online scanner
# https://observatory.mozilla.org — Mozilla's security audit

# Check specific header
curl -sI https://example.com | grep -i "strict-transport"
```

---

## 7. Private Networking

### 7.1 Tailscale (Recommended)

Tailscale builds a WireGuard mesh VPN with zero config. Perfect for homelab (BHEN platform) and connecting servers.

**Install:**

```bash
# Ubuntu/Debian
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# With exit node (route all traffic through this node)
sudo tailscale up --advertise-exit-node

# On the client side, to use exit node
sudo tailscale up --exit-node=<exit-node-ip>
```

**Key concepts:**

| Feature | What It Does |
|---|---|
| MagicDNS | Access devices by name: `myserver.tail1234.ts.net` |
| Tailscale Serve | Expose a local port to your tailnet (private) |
| Tailscale Funnel | Expose a local port to the internet (public) |
| ACLs | Fine-grained access control (who can reach what) |
| Subnet routers | Expose an entire subnet to tailnet |
| Exit nodes | Route all traffic through a specific node |
| HTTPS certs | Free certs for `*.ts.net` domains |

**Tailscale Serve vs Funnel:**

```bash
# Serve: expose port 8080 to your tailnet only (private)
tailscale serve https / http://localhost:8080

# Funnel: expose to the public internet via Tailscale's infrastructure
tailscale funnel https / http://localhost:8080

# Check status
tailscale serve status
```

**ACLs (Access Control Lists):**

ACLs are defined in the Tailscale admin console as JSON:

```jsonc
{
    "acls": [
        // Admin can access everything
        {"action": "accept", "src": ["group:admin"], "dst": ["*:*"]},

        // Developers can access dev servers on specific ports
        {"action": "accept", "src": ["group:dev"], "dst": ["tag:dev-server:80,443,22"]},

        // Monitoring can reach all servers on monitoring port
        {"action": "accept", "src": ["tag:monitoring"], "dst": ["tag:server:9090,9100"]},

        // Database access only from app servers
        {"action": "accept", "src": ["tag:app-server"], "dst": ["tag:database:5432"]},
    ],

    "tagOwners": {
        "tag:dev-server": ["group:admin"],
        "tag:app-server": ["group:admin"],
        "tag:database":   ["group:admin"],
        "tag:monitoring": ["group:admin"],
        "tag:server":     ["group:admin"],
    },

    "groups": {
        "group:admin": ["bruno@example.com"],
        "group:dev":   ["bruno@example.com", "dev@example.com"],
    },
}
```

**Sharing with external users:**

```bash
# Share a device with someone outside your tailnet
# Done via admin console: Machines > Share > Enter email
# They get access to that specific machine only
```

**Tailscale for homelab (BHEN on Mac Mini Ubuntu):**

```bash
# On the Mac Mini
sudo tailscale up --advertise-routes=192.168.1.0/24 --accept-dns=false

# Now any device on your tailnet can reach 192.168.1.x through the Mac Mini
# Enable the subnet route in admin console: Machines > Edit route settings
```

**Tailscale HTTPS certs for internal services:**

```bash
# Get a cert for your machine's tailnet domain
tailscale cert myserver.tail1234.ts.net
# Creates: myserver.tail1234.ts.net.crt and myserver.tail1234.ts.net.key

# Use with Caddy for internal services
```

```caddyfile
# Caddyfile for internal service on Tailscale
myserver.tail1234.ts.net {
    tls /path/to/myserver.tail1234.ts.net.crt /path/to/myserver.tail1234.ts.net.key
    reverse_proxy localhost:8080
}
```

### 7.2 WireGuard (Manual Setup)

Use when Tailscale isn't an option (air-gapped networks, custom requirements).

**Server setup:**

```bash
# Install
sudo apt install wireguard

# Generate keys
wg genkey | tee /etc/wireguard/server-private.key | wg pubkey > /etc/wireguard/server-public.key
chmod 600 /etc/wireguard/server-private.key
```

```ini
# /etc/wireguard/wg0.conf (server)
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = <server-private-key>

# Enable IP forwarding and NAT
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
# Client 1
PublicKey = <client-public-key>
AllowedIPs = 10.0.0.2/32
```

**Client setup:**

```bash
wg genkey | tee client-private.key | wg pubkey > client-public.key
```

```ini
# /etc/wireguard/wg0.conf (client)
[Interface]
Address = 10.0.0.2/24
PrivateKey = <client-private-key>
DNS = 1.1.1.1

[Peer]
PublicKey = <server-public-key>
Endpoint = server-public-ip:51820
AllowedIPs = 10.0.0.0/24  # Only route VPN traffic
# AllowedIPs = 0.0.0.0/0  # Route ALL traffic through VPN
PersistentKeepalive = 25
```

```bash
# Start
sudo systemctl enable --now wg-quick@wg0

# Check status
sudo wg show

# Allow through firewall
sudo ufw allow 51820/udp
```

### 7.3 VPC/VPN Between Servers

**DigitalOcean VPC:**

- All droplets in same VPC get private IPs (10.x.x.x)
- Free, no config needed beyond selecting the VPC at creation
- Private traffic doesn't count toward bandwidth

```bash
# WRONG: connect to database over public IP
DB_HOST=159.65.xx.xx

# CORRECT: use private IP within VPC
DB_HOST=10.114.0.2
```

**AWS VPC:**

- Default VPC exists in every region
- For production: create custom VPC with public/private subnets
- Database in private subnet (no public IP)
- App in public subnet (or behind ALB)

```
# Minimal AWS VPC layout
VPC: 10.0.0.0/16
├── Public Subnet:  10.0.1.0/24  (web servers, NAT gateway)
├── Private Subnet: 10.0.2.0/24  (app servers)
└── Private Subnet: 10.0.3.0/24  (databases)
```

### 7.4 Private Networking for Database Connections

```
# WRONG: database accessible from the internet
postgresql://user:pass@public-ip:5432/mydb

# CORRECT: database only accessible from private network
postgresql://user:pass@10.114.0.2:5432/mydb
# AND firewall blocks port 5432 from everywhere except app server

# CORRECT: database only accessible via Tailscale
postgresql://user:pass@dbserver.tail1234.ts.net:5432/mydb
```

**PostgreSQL: bind to private interface only:**

```ini
# /etc/postgresql/16/main/postgresql.conf
listen_addresses = '10.114.0.2'  # Private IP only, NOT '*'

# /etc/postgresql/16/main/pg_hba.conf
# Only allow connections from app server's private IP
host  mydb  appuser  10.114.0.3/32  scram-sha-256
```

---

## 8. DNS Deep Dive

### 8.1 Record Types

| Record | Purpose | Example |
|---|---|---|
| A | Maps name to IPv4 | `example.com. A 93.184.216.34` |
| AAAA | Maps name to IPv6 | `example.com. AAAA 2606:2800:220:1:...` |
| CNAME | Alias to another name | `www.example.com. CNAME example.com.` |
| MX | Mail server | `example.com. MX 10 mail.example.com.` |
| TXT | Arbitrary text | `example.com. TXT "v=spf1 ..."` |
| SRV | Service location | `_sip._tcp.example.com. SRV 10 5 5060 sip.example.com.` |
| CAA | Cert authority auth | `example.com. CAA 0 issue "letsencrypt.org"` |
| NS | Nameserver delegation | `example.com. NS ns1.cloudflare.com.` |
| PTR | Reverse lookup (IP→name) | `34.216.184.93.in-addr.arpa. PTR example.com.` |
| NAPTR | Name authority pointer | Used in VoIP/SIP routing |

**CNAME restrictions:**

```
# WRONG: CNAME at zone apex (bare domain)
example.com.  CNAME  something.cdn.com.

# CORRECT: CNAME only on subdomains
www.example.com.  CNAME  something.cdn.com.

# For apex: use A record, or Cloudflare's CNAME flattening
example.com.  A  93.184.216.34
```

### 8.2 DNSSEC

DNSSEC adds cryptographic signatures to DNS responses, preventing DNS spoofing.

**Enable DNSSEC (Cloudflare):**

1. Cloudflare dashboard > DNS > DNSSEC > Enable
2. Copy the DS record Cloudflare provides
3. Add DS record at your domain registrar
4. Wait for propagation (up to 48 hours)

**Verify DNSSEC:**

```bash
dig +dnssec example.com
# Look for "ad" flag in response (Authenticated Data)

# Or use online tool: https://dnsviz.net
```

### 8.3 TTL Strategy

| Situation | TTL | Why |
|---|---|---|
| Normal operation | 3600-86400 (1h-24h) | Less DNS queries, faster resolution |
| Before migration | 300 (5 min) | Reduce TTL days before migration |
| During migration | 60-300 | Fast propagation of changes |
| After migration stable | 3600+ | Back to normal |

```
# WRONG: TTL of 86400 and then doing a migration
# Users will hit old IP for up to 24 hours

# CORRECT: lower TTL 48 hours BEFORE migration
# Day -2: Set TTL to 300
# Day 0: Migrate, update DNS
# Day +1: Verify, raise TTL back to 3600
```

---

## 9. Email Deliverability

Complete setup to avoid spam folders. All three records (SPF + DKIM + DMARC) are required for good deliverability.

### 9.1 SPF (Sender Policy Framework)

Specifies which servers can send email for your domain.

```dns
# Basic: only your mail server and Google Workspace
example.com.  IN  TXT  "v=spf1 mx include:_spf.google.com ~all"

# With additional senders (Mailgun, Postmark, etc.)
example.com.  IN  TXT  "v=spf1 mx include:_spf.google.com include:spf.mandrillapp.com include:mailgun.org ~all"
```

| Mechanism | Meaning |
|---|---|
| `mx` | Allow servers listed in MX records |
| `include:` | Include another domain's SPF |
| `ip4:1.2.3.4` | Allow specific IP |
| `-all` | Hard fail: reject non-matching (strict) |
| `~all` | Soft fail: mark as suspicious (recommended to start) |

```
# WRONG: multiple SPF records (only first is used, causes errors)
example.com.  TXT  "v=spf1 include:google.com ~all"
example.com.  TXT  "v=spf1 include:mailgun.org ~all"

# CORRECT: single SPF record with all senders
example.com.  TXT  "v=spf1 include:_spf.google.com include:mailgun.org ~all"
```

**SPF has a 10 DNS lookup limit.** Each `include:` counts. Exceeding it breaks SPF.

### 9.2 DKIM (DomainKeys Identified Mail)

Cryptographically signs emails so recipients can verify they weren't tampered with.

```dns
# DKIM record (provided by your email service)
google._domainkey.example.com.  IN  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq..."

# Mailgun DKIM
smtp._domainkey.example.com.  IN  TXT  "v=DKIM1; k=rsa; p=..."
```

Setup depends on your email provider — they generate the key pair and give you the TXT record to add.

### 9.3 DMARC (Domain-based Message Authentication, Reporting & Conformance)

Tells receiving servers what to do when SPF/DKIM fail.

```dns
# Start with monitoring (p=none) — don't reject yet, just collect reports
_dmarc.example.com.  IN  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com; ruf=mailto:dmarc@example.com; pct=100"

# After monitoring confirms everything works, enforce:
_dmarc.example.com.  IN  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100"
```

| Tag | Meaning |
|---|---|
| `p=none` | Monitor only (start here) |
| `p=quarantine` | Mark as spam |
| `p=reject` | Reject outright (goal) |
| `rua=` | Aggregate report destination |
| `ruf=` | Forensic report destination |
| `pct=` | Percentage of messages to apply policy to |

**Rollout strategy:**

1. `p=none` for 2-4 weeks — monitor reports
2. `p=quarantine; pct=10` — quarantine 10% of failures
3. Increase pct gradually to 100
4. `p=reject; pct=100` — full enforcement

### 9.4 Complete Email DNS Setup

```dns
; MX records (Google Workspace example)
example.com.  IN  MX  1  aspmx.l.google.com.
example.com.  IN  MX  5  alt1.aspmx.l.google.com.
example.com.  IN  MX  5  alt2.aspmx.l.google.com.
example.com.  IN  MX  10 alt3.aspmx.l.google.com.
example.com.  IN  MX  10 alt4.aspmx.l.google.com.

; SPF
example.com.  IN  TXT  "v=spf1 include:_spf.google.com ~all"

; DKIM (from Google Admin console)
google._domainkey.example.com.  IN  TXT  "v=DKIM1; k=rsa; p=MIIBIjAN..."

; DMARC
_dmarc.example.com.  IN  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com; pct=100"

; CAA (optional but recommended)
example.com.  IN  CAA  0 issue "letsencrypt.org"
```

**Verify email setup:**

```bash
# Check SPF
dig TXT example.com +short | grep spf

# Check DKIM
dig TXT google._domainkey.example.com +short

# Check DMARC
dig TXT _dmarc.example.com +short

# Send test email: https://mail-tester.com (free, scores your setup)
# Or use: https://mxtoolbox.com/diagnostic.aspx
```

---

## 10. IPv6 Considerations

### 10.1 When to Care About IPv6

- **Most web apps:** IPv6 is handled by Cloudflare (they serve IPv6 to clients, connect to your server via IPv4). You're covered.
- **Mobile-heavy audiences:** Many mobile carriers use IPv6. Cloudflare handles this.
- **Direct server access (no CDN):** Add AAAA records if your provider supports it.
- **Hetzner, DigitalOcean:** Both provide IPv6 by default. Enable it.

### 10.2 Dual-Stack Setup

```bash
# Check if IPv6 is enabled
ip -6 addr show

# UFW: allow IPv6
sudo ufw default deny incoming
sudo ufw allow 22/tcp    # Applies to both IPv4 and IPv6 by default
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

```dns
; Dual-stack DNS
example.com.  IN  A     93.184.216.34
example.com.  IN  AAAA  2606:2800:220:1::
```

```nginx
# Nginx: listen on both
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name example.com;
}
```

```caddyfile
# Caddy: dual-stack by default, no config needed
example.com {
    reverse_proxy localhost:8080
}
```

### 10.3 IPv6-Only Servers (Cost Saving)

Some providers offer cheaper IPv6-only servers. Use NAT64/DNS64 for outbound IPv4 access.

```bash
# Hetzner Cloud IPv6-only: ~20% cheaper
# Outbound IPv4 works via NAT64 (transparent)
# Inbound: use Cloudflare proxy (they handle IPv4→IPv6 translation)
```

---

## 11. Network Debugging Tools

### 11.1 dig (DNS Queries)

```bash
# Basic query
dig example.com

# Specific record type
dig MX example.com
dig TXT example.com
dig AAAA example.com
dig CAA example.com

# Short output
dig +short example.com

# Query specific DNS server
dig @1.1.1.1 example.com

# Trace full resolution path
dig +trace example.com

# Check DNSSEC
dig +dnssec example.com

# Reverse lookup
dig -x 93.184.216.34
```

### 11.2 curl (HTTP Debugging)

```bash
# Show response headers
curl -I https://example.com

# Verbose output (shows TLS handshake, headers, etc.)
curl -v https://example.com

# Show timing breakdown
curl -w "\
    DNS:        %{time_namelookup}s\n\
    Connect:    %{time_connect}s\n\
    TLS:        %{time_appconnect}s\n\
    TTFB:       %{time_starttransfer}s\n\
    Total:      %{time_total}s\n\
    HTTP Code:  %{http_code}\n" \
    -o /dev/null -s https://example.com

# Test specific TLS version
curl --tlsv1.3 https://example.com

# Test with specific Host header (useful during migration)
curl -H "Host: example.com" https://93.184.216.34/ --resolve example.com:443:93.184.216.34

# Follow redirects
curl -L http://example.com

# Check security headers
curl -sI https://example.com | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy"
```

### 11.3 openssl s_client (TLS Debugging)

```bash
# Connect and show certificate info
openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null

# Show full certificate details
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | \
    openssl x509 -noout -text

# Check expiration
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | \
    openssl x509 -noout -dates

# Check certificate chain
openssl s_client -connect example.com:443 -servername example.com -showcerts </dev/null

# Test specific TLS version
openssl s_client -connect example.com:443 -tls1_3

# Check OCSP stapling
openssl s_client -connect example.com:443 -servername example.com -status </dev/null 2>/dev/null | \
    grep -A 5 "OCSP Response"
```

### 11.4 traceroute / mtr (Path Analysis)

```bash
# Basic traceroute
traceroute example.com

# TCP traceroute (more reliable through firewalls)
sudo traceroute -T -p 443 example.com

# MTR — combines traceroute + ping, shows packet loss per hop
sudo mtr example.com

# MTR report mode (non-interactive, great for sharing)
sudo mtr --report --report-cycles=100 example.com
```

### 11.5 ss / netstat (Local Network State)

```bash
# Show listening ports
sudo ss -tlnp

# Show established connections
sudo ss -tnp

# Show connections to specific port
sudo ss -tnp | grep :5432

# Count connections by state
ss -s
```

### 11.6 nmap (Port Scanning — Use on YOUR Servers)

```bash
# Scan common ports
nmap example.com

# Scan all ports
nmap -p- example.com

# Check specific ports
nmap -p 22,80,443,5432 example.com

# SSL audit
nmap --script ssl-enum-ciphers -p 443 example.com

# Service version detection
nmap -sV -p 22,80,443 example.com
```

### 11.7 Quick Diagnostic Script

```bash
#!/bin/bash
# /opt/scripts/diagnose-domain.sh
# Usage: ./diagnose-domain.sh example.com

DOMAIN=${1:?"Usage: $0 <domain>"}

echo "=== DNS Resolution ==="
dig +short "$DOMAIN" A
dig +short "$DOMAIN" AAAA

echo -e "\n=== Certificate ==="
echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | \
    openssl x509 -noout -subject -dates -issuer

echo -e "\n=== Security Headers ==="
curl -sI "https://$DOMAIN" | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|server:"

echo -e "\n=== TLS Version ==="
curl -sI --tlsv1.3 "https://$DOMAIN" -o /dev/null -w "TLS 1.3: %{http_code}\n" 2>/dev/null || echo "TLS 1.3: FAILED"

echo -e "\n=== Response Time ==="
curl -w "DNS: %{time_namelookup}s | Connect: %{time_connect}s | TLS: %{time_appconnect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s\n" \
    -o /dev/null -s "https://$DOMAIN"

echo -e "\n=== HTTP to HTTPS redirect ==="
curl -sI "http://$DOMAIN" | head -3

echo -e "\n=== SPF ==="
dig +short TXT "$DOMAIN" | grep spf

echo -e "\n=== DMARC ==="
dig +short TXT "_dmarc.$DOMAIN"

echo -e "\n=== CAA ==="
dig +short CAA "$DOMAIN"
```
