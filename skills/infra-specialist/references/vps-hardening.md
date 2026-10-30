# VPS Hardening

Complete security hardening guide for Ubuntu 24.04 VPS. From zero to production-secure in one script, plus deep dives into SSH, firewall, kernel, intrusion detection, and auditing.

---

## Table of Contents

1. [Complete VPS Setup Script](#1-complete-vps-setup-script)
2. [SSH Hardening Deep Dive](#2-ssh-hardening-deep-dive)
3. [Firewall Mastery](#3-firewall-mastery)
4. [Docker and UFW Gotcha](#4-docker-and-ufw-gotcha)
5. [Kernel Hardening](#5-kernel-hardening)
6. [AppArmor Security Profiles](#6-apparmor-security-profiles)
7. [System Auditing (auditd)](#7-system-auditing-auditd)
8. [Intrusion Detection](#8-intrusion-detection)
9. [User Management](#9-user-management)
10. [Automatic Security Updates](#10-automatic-security-updates)
11. [Log Management](#11-log-management)
12. [Monitoring Open Ports](#12-monitoring-open-ports)
13. [Pre-Production Security Checklist](#13-pre-production-security-checklist)

---

## 1. Complete VPS Setup Script

Run as root on a fresh Ubuntu 24.04 server. This is the foundation — every section below expands on parts of this script.

```bash
#!/bin/bash
# vps-hardening.sh — Complete VPS setup from zero
# Run as: curl -sL https://your-host/vps-hardening.sh | bash
# Or better: review it first, then run
set -euo pipefail

# ============================================================
# VARIABLES — CHANGE THESE
# ============================================================
NEW_USER="deploy"
SSH_PORT="2222"
TIMEZONE="America/Sao_Paulo"
SWAP_SIZE="2G"                    # Set to "" to skip swap
SSH_PUBLIC_KEY=""                  # Paste your public key here, or leave empty to copy from root
ENABLE_DOCKER="true"              # Set to "false" to skip Docker install

echo "=== Starting VPS Hardening ==="

# ============================================================
# 1. SYSTEM UPDATES
# ============================================================
echo "[1/10] System updates..."
export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y
apt install -y \
  curl wget git unzip htop ncdu iotop \
  ufw fail2ban \
  ca-certificates gnupg \
  unattended-upgrades apt-listchanges \
  logrotate \
  apparmor apparmor-utils \
  auditd audispd-plugins \
  rkhunter \
  net-tools lsof

# ============================================================
# 2. TIMEZONE & LOCALE
# ============================================================
echo "[2/10] Timezone & locale..."
timedatectl set-timezone "$TIMEZONE"
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8

# ============================================================
# 3. CREATE NON-ROOT USER
# ============================================================
echo "[3/10] Creating user '$NEW_USER'..."
if ! id "$NEW_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$NEW_USER"
  usermod -aG sudo "$NEW_USER"
fi

# SSH key setup
mkdir -p /home/$NEW_USER/.ssh

if [ -n "$SSH_PUBLIC_KEY" ]; then
  echo "$SSH_PUBLIC_KEY" > /home/$NEW_USER/.ssh/authorized_keys
elif [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/$NEW_USER/.ssh/authorized_keys
else
  echo "WARNING: No SSH key found. Set SSH_PUBLIC_KEY or add keys manually."
fi

chown -R $NEW_USER:$NEW_USER /home/$NEW_USER/.ssh
chmod 700 /home/$NEW_USER/.ssh
chmod 600 /home/$NEW_USER/.ssh/authorized_keys 2>/dev/null || true

# Passwordless sudo for deploy (remove NOPASSWD if you want password confirmation)
echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$NEW_USER
chmod 440 /etc/sudoers.d/$NEW_USER

# ============================================================
# 4. SSH HARDENING
# ============================================================
echo "[4/10] Hardening SSH..."
cat > /etc/ssh/sshd_config.d/hardened.conf << EOF
# --- Port ---
Port $SSH_PORT

# --- Authentication ---
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 20
MaxSessions 3
MaxStartups 3:50:10

# --- User restrictions ---
AllowUsers $NEW_USER

# --- Features to disable ---
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no
GatewayPorts no
PermitUserEnvironment no

# --- Protocol hardening ---
ClientAliveInterval 300
ClientAliveCountMax 2
UseDNS no
Compression no

# --- Crypto ---
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
EOF

# Validate config before restarting
sshd -t && systemctl restart sshd
echo "  SSH configured on port $SSH_PORT — test new connection BEFORE closing this session!"

# ============================================================
# 5. FIREWALL (UFW)
# ============================================================
echo "[5/10] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow $SSH_PORT/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Rate limit SSH (max 6 connections in 30 seconds)
ufw limit $SSH_PORT/tcp

# Enable without prompt
echo "y" | ufw enable
ufw status verbose

# ============================================================
# 6. FAIL2BAN
# ============================================================
echo "[6/10] Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd
action = %(action_mwl)s

[sshd]
enabled = true
port = $SSH_PORT
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400

[sshd-ddos]
enabled = true
port = $SSH_PORT
filter = sshd-ddos
logpath = /var/log/auth.log
maxretry = 5
bantime = 172800
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# ============================================================
# 7. SWAP (if needed)
# ============================================================
if [ -n "$SWAP_SIZE" ]; then
  echo "[7/10] Configuring ${SWAP_SIZE} swap..."
  if [ ! -f /swapfile ]; then
    fallocate -l $SWAP_SIZE /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo "/swapfile none swap sw 0 0" >> /etc/fstab

    # Optimize swap usage
    cat >> /etc/sysctl.d/99-swap.conf << EOF
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
    sysctl -p /etc/sysctl.d/99-swap.conf
  fi
else
  echo "[7/10] Skipping swap..."
fi

# ============================================================
# 8. KERNEL HARDENING
# ============================================================
echo "[8/10] Kernel hardening..."
cat > /etc/sysctl.d/99-hardening.conf << 'EOF'
# --- Network security ---
# Prevent SYN flood attacks
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Prevent IP spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP redirects (prevent MITM)
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# Don't send ICMP redirects
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Ignore ICMP broadcast requests (prevent Smurf attack)
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignore bogus ICMP error responses
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Log suspicious packets (spoofed, source-routed, redirect)
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Disable IPv6 if not needed (uncomment if you don't use IPv6)
# net.ipv6.conf.all.disable_ipv6 = 1
# net.ipv6.conf.default.disable_ipv6 = 1

# --- TCP hardening ---
net.ipv4.tcp_timestamps = 0
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 5

# --- File descriptors (for high-traffic apps) ---
fs.file-max = 2097152
fs.nr_open = 2097152

# --- Memory ---
vm.overcommit_memory = 0
vm.panic_on_oom = 0

# --- Kernel ---
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
EOF
sysctl -p /etc/sysctl.d/99-hardening.conf

# ============================================================
# 9. AUTOMATIC SECURITY UPDATES
# ============================================================
echo "[9/10] Configuring automatic security updates..."
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "root";
Unattended-Upgrade::MailReport "only-on-error";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

systemctl enable unattended-upgrades

# ============================================================
# 10. DOCKER (optional)
# ============================================================
if [ "$ENABLE_DOCKER" = "true" ]; then
  echo "[10/10] Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt update
  apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Add deploy user to docker group
  usermod -aG docker $NEW_USER

  # Docker daemon security settings
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-address-pools": [
    {"base": "172.17.0.0/16", "size": 24}
  ],
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false
}
DOCKEREOF

  systemctl restart docker
else
  echo "[10/10] Skipping Docker install..."
fi

# ============================================================
# CLEANUP & SUMMARY
# ============================================================
# Disable unused services
systemctl disable --now snapd.service 2>/dev/null || true
systemctl disable --now snapd.socket 2>/dev/null || true

echo ""
echo "============================================"
echo "  VPS HARDENING COMPLETE"
echo "============================================"
echo ""
echo "  User:     $NEW_USER"
echo "  SSH Port: $SSH_PORT"
echo "  Timezone: $TIMEZONE"
echo "  Swap:     $SWAP_SIZE"
echo "  Docker:   $ENABLE_DOCKER"
echo ""
echo "  IMPORTANT: Test SSH connection on new port"
echo "  BEFORE closing this session:"
echo ""
echo "    ssh -p $SSH_PORT $NEW_USER@$(curl -s ifconfig.me)"
echo ""
echo "============================================"
```

---

## 2. SSH Hardening Deep Dive

### 2.1 sshd_config — Every Relevant Option Explained

```bash
# /etc/ssh/sshd_config.d/hardened.conf
# Each option explained

# --- Port ---
Port 2222
# Non-standard port reduces log noise from bots (not real security, but practical)
# Pick any port between 1024-65535 that doesn't conflict with services

# --- Authentication ---
PermitRootLogin no
# NEVER allow root SSH login. Use a regular user + sudo

PasswordAuthentication no
# Key-only authentication. Passwords are brute-forceable

PubkeyAuthentication yes
# Enable public key authentication (Ed25519 preferred)

AuthenticationMethods publickey
# Only allow public key (no keyboard-interactive, no GSSAPI)

MaxAuthTries 3
# Lock out after 3 failed attempts per connection

LoginGraceTime 20
# 20 seconds to authenticate (default 120 is too generous)

MaxSessions 3
# Maximum sessions per connection (prevents session flooding)

MaxStartups 3:50:10
# Start dropping connections at 3 unauthenticated, 50% drop rate, refuse all at 10
# Prevents connection flooding attacks

# --- User restrictions ---
AllowUsers deploy
# Whitelist specific users (most restrictive approach)
# For multiple users: AllowUsers deploy admin ci-user
# Can also restrict by host: AllowUsers deploy@10.0.0.*

# --- Disable unnecessary features ---
X11Forwarding no
# No GUI forwarding (attack surface reduction)

AllowTcpForwarding no
# Prevent SSH tunneling (enable selectively if needed)

AllowAgentForwarding no
# Prevent agent forwarding (security risk — see 2.3)

PermitTunnel no
# Disable SSH VPN tunnels

GatewayPorts no
# Prevent remote port forwarding from binding to all interfaces

PermitUserEnvironment no
# Don't allow users to set env vars via ~/.ssh/environment

# --- Connection management ---
ClientAliveInterval 300
# Send keepalive every 5 minutes

ClientAliveCountMax 2
# Disconnect after 2 missed keepalives (10 min idle = disconnect)

UseDNS no
# Don't do reverse DNS lookup on connecting clients (faster, more secure)

Compression no
# Disable compression (prevents CRIME-style attacks, marginal perf impact)

# --- Cryptographic settings (modern, secure) ---
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
# Key exchange: only Curve25519 (strongest, fastest)

Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
# Encryption: ChaCha20 + AES-GCM only (AEAD ciphers)

MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
# Message authentication: SHA-2 with encrypt-then-MAC only

HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
# Server key types: Ed25519 preferred, RSA-SHA2 as fallback

# --- Logging ---
LogLevel VERBOSE
# Log more details (useful for forensics)
# Use INFO for less noise in production
```

### 2.2 SSH Key Management

```bash
# Generate Ed25519 key (ALWAYS use Ed25519, not RSA)
ssh-keygen -t ed25519 -C "bruno@machine-name" -f ~/.ssh/id_ed25519

# WRONG — still using RSA 2048
ssh-keygen -t rsa -b 2048

# CORRECT — Ed25519 (smaller, faster, more secure than RSA-4096)
ssh-keygen -t ed25519 -C "descriptive-comment"

# If you MUST use RSA (legacy systems), minimum 4096 bits
ssh-keygen -t rsa -b 4096 -C "legacy-system"
```

**Key per purpose, not one key for everything:**

```bash
# WRONG — one key for everything
~/.ssh/id_ed25519  → used for GitHub, servers, CI, personal

# CORRECT — separate keys per purpose
~/.ssh/id_ed25519_github     → GitHub only
~/.ssh/id_ed25519_servers    → production servers
~/.ssh/id_ed25519_personal   → personal projects

# Configure in ~/.ssh/config
Host github.com
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes

Host prod-server
    HostName 1.2.3.4
    Port 2222
    User deploy
    IdentityFile ~/.ssh/id_ed25519_servers
    IdentitiesOnly yes
```

### 2.3 Agent Forwarding Risks

```
# WRONG — enabling agent forwarding to jump hosts
ssh -A user@jump-host
# If jump-host is compromised, attacker can use your agent to SSH everywhere

# CORRECT — use ProxyJump instead
Host production
    HostName 10.0.1.5
    User deploy
    ProxyJump jump-host
    IdentityFile ~/.ssh/id_ed25519_servers

Host jump-host
    HostName jump.example.com
    User admin
    IdentityFile ~/.ssh/id_ed25519_jump

# Keys never leave your machine. jump-host never sees your private key.
```

### 2.4 Port Knocking (When It Makes Sense)

Port knocking hides SSH port until a specific sequence of "knocks" (connection attempts) is received. It is security through obscurity — use as an extra layer, not the only defense.

```bash
# Install knockd
apt install -y knockd

# /etc/knockd.conf
cat > /etc/knockd.conf << 'EOF'
[options]
    UseSyslog
    logfile = /var/log/knockd.log

[openSSH]
    sequence    = 7000,8000,9000
    seq_timeout = 5
    command     = /usr/sbin/ufw allow from %IP% to any port 2222 proto tcp
    tcpflags    = syn

[closeSSH]
    sequence    = 9000,8000,7000
    seq_timeout = 5
    command     = /usr/sbin/ufw delete allow from %IP% to any port 2222 proto tcp
    tcpflags    = syn
EOF

# Enable knockd
systemctl enable --now knockd

# Client side — knock before connecting:
knock server-ip 7000 8000 9000 && ssh -p 2222 deploy@server-ip
# After done:
knock server-ip 9000 8000 7000
```

**Use port knocking when:**
- Managing servers exposed to hostile networks
- Extra paranoia layer alongside key-only auth
- Want to make SSH invisible to port scans

**Don't bother when:**
- Tailscale/WireGuard already hides SSH from internet
- Using Cloudflare Tunnel for access
- Adds complexity for little gain if you already have key-only + fail2ban

---

## 3. Firewall Mastery

### 3.1 UFW Rules for Common Scenarios

```bash
# --- Basic web server ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 2222/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# --- Allow specific IP only (admin panel) ---
ufw allow from 10.0.0.5 to any port 8080 comment 'Admin from office'

# --- Allow Tailscale subnet ---
ufw allow in on tailscale0 comment 'Tailscale network'

# --- Allow Cloudflare IPs only (for origin server) ---
# Cloudflare IPv4 ranges (update periodically from https://cloudflare.com/ips/)
for ip in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
          141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
          197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
          104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
  ufw allow from $ip to any port 443 comment 'Cloudflare'
done

# --- Rate limiting ---
ufw limit 2222/tcp comment 'SSH rate limit'

# --- Delete a rule ---
ufw status numbered
ufw delete 5

# --- View rules ---
ufw status verbose
```

### 3.2 Advanced UFW — Application Profiles

```bash
# List available application profiles
ufw app list

# Create custom application profile
cat > /etc/ufw/applications.d/myapp << 'EOF'
[MyApp]
title=My Application
description=My web application
ports=8080/tcp

[MyApp-Full]
title=My Application (Full)
description=My web application with WebSocket
ports=8080/tcp|8443/tcp
EOF

ufw app update MyApp
ufw allow MyApp
```

### 3.3 iptables — When UFW Isn't Enough

```bash
# Rate limit new connections to port 443 (10 per second per IP)
iptables -A INPUT -p tcp --dport 443 -m conntrack --ctstate NEW \
  -m recent --set --name HTTPS
iptables -A INPUT -p tcp --dport 443 -m conntrack --ctstate NEW \
  -m recent --update --seconds 1 --hitcount 10 --name HTTPS -j DROP

# Block a specific IP
iptables -I INPUT -s 185.234.218.0/24 -j DROP

# Log dropped packets (useful for debugging)
iptables -A INPUT -j LOG --log-prefix "iptables-dropped: " --log-level 4

# Save iptables rules (persist across reboot)
apt install -y iptables-persistent
netfilter-persistent save
```

---

## 4. Docker and UFW Gotcha

**This is the most common VPS security mistake.** Docker modifies iptables directly, bypassing UFW entirely.

### 4.1 The Problem

```bash
# You think this protects you:
ufw default deny incoming
ufw allow 80/tcp
ufw allow 443/tcp

# But when you run a Docker container:
docker run -p 3306:3306 mysql

# Port 3306 is now OPEN TO THE INTERNET
# UFW didn't block it — Docker added its own iptables rules
```

### 4.2 The Fix — Disable Docker iptables Manipulation

```json
// /etc/docker/daemon.json
{
  "iptables": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

```bash
systemctl restart docker
```

**Important consequences of `"iptables": false`:**
- Docker containers can't reach the internet by default
- You need to manage NAT rules manually OR use Docker network mode `host`
- Container-to-container communication still works on Docker networks

### 4.3 Better Fix — Use docker-compose with Bind Address

```yaml
# WRONG — binds to all interfaces (0.0.0.0)
services:
  mysql:
    ports:
      - "3306:3306"

# CORRECT — bind to localhost only
services:
  mysql:
    ports:
      - "127.0.0.1:3306:3306"

# CORRECT — bind to Docker network only (no port mapping)
services:
  mysql:
    # No "ports:" at all — only accessible from other containers on same network
    networks:
      - backend

  app:
    ports:
      - "127.0.0.1:8080:8080"  # Only app is exposed, and only to localhost
    networks:
      - backend

networks:
  backend:
    driver: bridge
```

### 4.4 UFW-Docker — Recommended Solution

The `ufw-docker` utility properly integrates Docker with UFW:

```bash
# Install ufw-docker
wget -O /usr/local/bin/ufw-docker \
  https://github.com/chaifeng/ufw-docker/raw/master/ufw-docker
chmod +x /usr/local/bin/ufw-docker
ufw-docker install

# Now manage Docker container access through UFW
ufw-docker allow myapp 80/tcp
ufw-docker allow myapp 443/tcp

# Block all other Docker container ports from outside
# (this is the default after ufw-docker install)
```

---

## 5. Kernel Hardening

### 5.1 Network Security Parameters

```bash
# /etc/sysctl.d/99-hardening.conf
# All parameters explained

# === SYN FLOOD PROTECTION ===
net.ipv4.tcp_syncookies = 1
# Enable SYN cookies — prevents SYN flood by not allocating resources
# until the three-way handshake is complete

net.ipv4.tcp_max_syn_backlog = 2048
# Maximum number of queued SYN requests (increase for high-traffic servers)

net.ipv4.tcp_synack_retries = 2
# Reduce SYN-ACK retries (default 5 — wastes resources under attack)

# === IP SPOOFING PROTECTION ===
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
# Reverse path filtering — drop packets with source IPs that don't
# match the expected interface (prevents spoofed source IPs)

# === ICMP HARDENING ===
net.ipv4.icmp_echo_ignore_broadcasts = 1
# Ignore broadcast pings (prevents Smurf amplification attacks)

net.ipv4.icmp_ignore_bogus_error_responses = 1
# Ignore malformed ICMP error messages

net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
# Ignore all ICMP redirects — prevents MITM attacks via route poisoning

net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
# Don't send redirects (we're not a router)

# === SOURCE ROUTING ===
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
# Disable source routing — prevents attackers from specifying packet routes

# === LOGGING ===
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
# Log packets with impossible source addresses (useful for detecting attacks)
```

### 5.2 File Descriptor Limits for High-Traffic Apps

```bash
# Check current limits
ulimit -n       # User limit (typically 1024)
cat /proc/sys/fs/file-max  # System-wide limit

# /etc/sysctl.d/99-limits.conf — System-wide
fs.file-max = 2097152
fs.nr_open = 2097152

# /etc/security/limits.d/99-nofile.conf — Per-user
cat > /etc/security/limits.d/99-nofile.conf << 'EOF'
# For web servers / app processes
deploy  soft  nofile  65536
deploy  hard  nofile  65536
*       soft  nofile  65536
*       hard  nofile  65536
EOF

# For systemd services (e.g., Caddy, your app)
# Add to the [Service] section of the unit file:
# LimitNOFILE=65536

# Verify after reboot
su - deploy -c "ulimit -n"
```

### 5.3 Disable Unnecessary Services

```bash
# List running services
systemctl list-units --type=service --state=running

# Common services to disable on a web server VPS
systemctl disable --now snapd.service 2>/dev/null || true
systemctl disable --now snapd.socket 2>/dev/null || true
systemctl disable --now cups.service 2>/dev/null || true      # Printer service
systemctl disable --now avahi-daemon.service 2>/dev/null || true  # mDNS
systemctl disable --now ModemManager.service 2>/dev/null || true
systemctl disable --now bluetooth.service 2>/dev/null || true

# Check for unnecessary listening services
ss -tulnp
# Only these should be listening:
# - sshd on port 2222
# - Your web server on 80/443
# - Your app on localhost:8080
# Everything else → investigate and disable
```

---

## 6. AppArmor Security Profiles

### 6.1 AppArmor Basics

```bash
# Check status
aa-status

# Common modes:
# - enforce: block violations + log
# - complain: allow but log violations (learning mode)
# - unconfined: no restrictions

# List profiles
aa-status | head -20
```

### 6.2 Custom Profile for a Web App

```bash
# /etc/apparmor.d/usr.local.bin.myapp
cat > /etc/apparmor.d/usr.local.bin.myapp << 'EOF'
#include <tunables/global>

/usr/local/bin/myapp {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # Network access
  network inet stream,
  network inet6 stream,

  # Read app files
  /var/www/myapp/** r,
  /var/www/myapp/storage/** rw,

  # Temp files
  /tmp/** rw,

  # Read system libraries
  /usr/lib/** r,
  /lib/** r,

  # Read config
  /etc/myapp/** r,

  # Log files
  /var/log/myapp/** rw,

  # Deny everything else (implicit)
}
EOF

# Load in complain mode first (learning)
aa-complain /etc/apparmor.d/usr.local.bin.myapp

# Monitor what would be blocked
tail -f /var/log/syslog | grep apparmor

# After testing, switch to enforce
aa-enforce /etc/apparmor.d/usr.local.bin.myapp
```

---

## 7. System Auditing (auditd)

### 7.1 Setup and Key Rules

```bash
# Install (already in setup script)
apt install -y auditd audispd-plugins

# /etc/audit/rules.d/hardening.rules
cat > /etc/audit/rules.d/hardening.rules << 'EOF'
# Delete all existing rules
-D

# Buffer size (increase for busy servers)
-b 8192

# Failure mode (1=printk, 2=panic)
-f 1

# === FILE MONITORING ===
# Watch /etc/passwd and shadow for changes
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/sudoers -p wa -k sudoers
-w /etc/sudoers.d/ -p wa -k sudoers

# Watch SSH configuration
-w /etc/ssh/sshd_config -p wa -k sshd_config
-w /etc/ssh/sshd_config.d/ -p wa -k sshd_config

# Watch cron
-w /etc/crontab -p wa -k cron
-w /etc/cron.d/ -p wa -k cron
-w /var/spool/cron/ -p wa -k cron

# === PRIVILEGED COMMANDS ===
# Log all sudo usage
-a always,exit -F path=/usr/bin/sudo -F perm=x -k sudo_usage
-a always,exit -F path=/usr/bin/su -F perm=x -k su_usage

# Log user/group management
-a always,exit -F path=/usr/sbin/useradd -F perm=x -k user_mgmt
-a always,exit -F path=/usr/sbin/userdel -F perm=x -k user_mgmt
-a always,exit -F path=/usr/sbin/usermod -F perm=x -k user_mgmt
-a always,exit -F path=/usr/sbin/groupadd -F perm=x -k group_mgmt

# === NETWORK ===
# Log network configuration changes
-a always,exit -F arch=b64 -S sethostname -S setdomainname -k network_changes

# === DOCKER ===
-w /usr/bin/docker -p x -k docker
-w /var/lib/docker -p wa -k docker
-w /etc/docker -p wa -k docker

# Make rules immutable (can't be changed without reboot)
-e 2
EOF

# Load rules
augenrules --load

# Check loaded rules
auditctl -l

# Search audit logs
ausearch -k identity --start today
ausearch -k sudo_usage --start recent
aureport --summary
```

---

## 8. Intrusion Detection

### 8.1 rkhunter (Rootkit Hunter)

```bash
# Install (already in setup script)
apt install -y rkhunter

# Update database
rkhunter --update

# Set baseline (run BEFORE deploying apps)
rkhunter --propupd

# Run scan
rkhunter --check --skip-keypress

# Automate daily scan
cat > /etc/cron.daily/rkhunter << 'EOF'
#!/bin/bash
/usr/bin/rkhunter --check --skip-keypress --report-warnings-only 2>&1 | \
  mail -s "rkhunter report $(hostname)" root
EOF
chmod +x /etc/cron.daily/rkhunter

# Configure
cat >> /etc/rkhunter.conf.local << 'EOF'
MAIL-ON-WARNING=root
ALLOW_SSH_PROT_V1=0
ALLOW_SSH_ROOT_USER=no
SCRIPTWHITELIST=/usr/bin/egrep
SCRIPTWHITELIST=/usr/bin/fgrep
SCRIPTWHITELIST=/usr/bin/which
EOF
```

### 8.2 OSSEC/Wazuh (Full HIDS)

For more comprehensive intrusion detection, Wazuh is the modern fork of OSSEC:

```bash
# Quick Wazuh agent install (connects to Wazuh Manager)
curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring \
  --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import && \
  chmod 644 /usr/share/keyrings/wazuh.gpg

echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | \
  tee /etc/apt/sources.list.d/wazuh.list

apt update && apt install -y wazuh-agent

# If you just want standalone file integrity monitoring (FIM)
# without a full Wazuh deployment, rkhunter + auditd is sufficient
```

**When to use what:**

| Tool | Complexity | Use When |
|---|---|---|
| rkhunter | Low | Single VPS, basic rootkit detection |
| auditd | Low | File/command auditing (always use) |
| OSSEC | Medium | Multiple servers, log analysis |
| Wazuh | High | Enterprise, compliance (SOC2, PCI) |
| CrowdSec | Medium | Community-driven IP blocklist + behavior analysis |

### 8.3 CrowdSec (Modern Fail2ban Alternative)

```bash
# Install CrowdSec
curl -s https://install.crowdsec.net | bash

# Install firewall bouncer
apt install -y crowdsec-firewall-bouncer-iptables

# CrowdSec parses logs and detects attacks like fail2ban, but:
# - Shares threat intelligence with community
# - Gets updated IP blocklists
# - Has a web console (app.crowdsec.net)

# Check detected attacks
cscli alerts list
cscli decisions list
```

---

## 9. User Management

### 9.1 Principle of Least Privilege

```bash
# WRONG — one user for everything
ssh deploy@server
sudo su -
# Running everything as root or one sudo user

# CORRECT — separate users per purpose
# deploy   → SSH access, deploy code, sudo for system tasks
# app      → Runs application (no SSH, no sudo, no login shell)
# backup   → Runs backup scripts (limited sudo for specific commands)

# Create app user (no login, no home, runs your application)
useradd --system --no-create-home --shell /usr/sbin/nologin app

# Create backup user with limited sudo
useradd --system --create-home --shell /bin/bash backup
echo "backup ALL=(root) NOPASSWD: /usr/bin/pg_dump, /usr/bin/restic" > /etc/sudoers.d/backup
chmod 440 /etc/sudoers.d/backup
```

### 9.2 systemd Service with Dedicated User

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Application
After=network.target

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/var/www/myapp
ExecStart=/var/www/myapp/server
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=/var/www/myapp/storage /var/log/myapp

# Resource limits
LimitNOFILE=65536
MemoryMax=512M
CPUQuota=80%

# Environment
EnvironmentFile=/etc/myapp/env

[Install]
WantedBy=multi-user.target
```

```bash
# WRONG — running app as root via screen/tmux
ssh root@server
screen -S myapp
node server.js
# Ctrl+A, D

# CORRECT — systemd service with dedicated user
systemctl enable --now myapp.service
journalctl -u myapp -f
```

### 9.3 sudo Configuration Best Practices

```bash
# Always use visudo or sudoers.d drop-in files
# NEVER edit /etc/sudoers directly

# /etc/sudoers.d/deploy — full sudo (for system administration)
deploy ALL=(ALL) NOPASSWD:ALL

# If you want password confirmation (more secure, less convenient):
# deploy ALL=(ALL) ALL

# /etc/sudoers.d/ci — CI/CD user, limited commands
ci ALL=(root) NOPASSWD: /usr/bin/systemctl restart myapp, /usr/bin/systemctl restart caddy

# /etc/sudoers.d/backup — backup user, very limited
backup ALL=(root) NOPASSWD: /usr/bin/pg_dump *, /usr/bin/restic *

# Audit who has sudo
grep -r "" /etc/sudoers.d/
getent group sudo
```

---

## 10. Automatic Security Updates

### 10.1 unattended-upgrades Configuration

```bash
# /etc/apt/apt.conf.d/50unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    // Security updates only (safest)
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";

    // Uncomment to also apply regular updates (more risk):
    // "${distro_id}:${distro_codename}-updates";
};

// Remove unused dependencies after update
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";

// Auto-fix interrupted dpkg
Unattended-Upgrade::AutoFixInterruptedDpkg "true";

// Use minimal steps (reduces downtime for each update)
Unattended-Upgrade::MinimalSteps "true";

// Automatic reboot settings
Unattended-Upgrade::Automatic-Reboot "false";
// If you enable auto-reboot:
// Unattended-Upgrade::Automatic-Reboot "true";
// Unattended-Upgrade::Automatic-Reboot-Time "04:00";

// Email notification (only on errors)
Unattended-Upgrade::Mail "root";
Unattended-Upgrade::MailReport "only-on-error";

// Bandwidth limit (useful on metered connections)
// Acquire::http::Dl-Limit "1000";

// Blacklist packages that should NEVER be auto-updated
Unattended-Upgrade::Package-Blacklist {
    // "docker-ce";
    // "mysql-server";
};
EOF

# /etc/apt/apt.conf.d/20auto-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

# Test that it works
unattended-upgrades --dry-run --debug

# Check logs
cat /var/log/unattended-upgrades/unattended-upgrades.log
```

### 10.2 Kernel Updates (Livepatch)

```bash
# Ubuntu Pro includes kernel livepatch (no reboot needed for kernel security fixes)
# Free for up to 5 machines (personal use)
pro attach YOUR_TOKEN

# Check status
pro status

# Manual kernel update check
apt list --upgradable 2>/dev/null | grep linux

# Check if reboot is needed after kernel update
[ -f /var/run/reboot-required ] && echo "REBOOT REQUIRED" || echo "No reboot needed"
cat /var/run/reboot-required.pkgs 2>/dev/null
```

---

## 11. Log Management

### 11.1 journald Configuration

```bash
# /etc/systemd/journald.conf.d/retention.conf
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/retention.conf << 'EOF'
[Journal]
# Maximum disk usage
SystemMaxUse=500M
# Maximum age of entries
MaxRetentionSec=30day
# Compress logs
Compress=yes
# Forward to syslog (for logrotate/rsyslog)
ForwardToSyslog=yes
EOF

systemctl restart systemd-journald

# Useful journal commands
journalctl -u myapp --since "1 hour ago"    # Last hour for specific service
journalctl -u myapp -f                       # Follow (like tail -f)
journalctl --disk-usage                      # Check disk usage
journalctl --vacuum-size=200M                # Trim to 200MB
journalctl --vacuum-time=7d                  # Keep only 7 days
journalctl -p err --since today              # Errors only, today
```

### 11.2 logrotate Configuration

```bash
# /etc/logrotate.d/myapp
cat > /etc/logrotate.d/myapp << 'EOF'
/var/log/myapp/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 app app
    sharedscripts
    postrotate
        systemctl reload myapp 2>/dev/null || true
    endscript
}
EOF

# Test logrotate config
logrotate -d /etc/logrotate.d/myapp

# Force rotation (for testing)
logrotate -f /etc/logrotate.d/myapp
```

### 11.3 Centralized Logging (Simple)

```bash
# For 1-3 servers, rsyslog forwarding to a central server is sufficient:
# On each server:
cat >> /etc/rsyslog.d/50-remote.conf << 'EOF'
*.* @@log-server.internal:514
EOF
systemctl restart rsyslog

# For more servers, consider:
# - Loki + Grafana (free, lightweight)
# - Vector (Datadog's open-source log collector)
# - Promtail → Loki (pairs with Prometheus/Grafana stack)
```

---

## 12. Monitoring Open Ports

### 12.1 Regular Port Audit

```bash
# List all listening ports with process info
ss -tulnp

# Expected output for a hardened web server:
# tcp  LISTEN  0  128  0.0.0.0:2222   0.0.0.0:*  users:(("sshd",pid=...))
# tcp  LISTEN  0  128  0.0.0.0:443    0.0.0.0:*  users:(("caddy",pid=...))
# tcp  LISTEN  0  128  0.0.0.0:80     0.0.0.0:*  users:(("caddy",pid=...))
# tcp  LISTEN  0  128  127.0.0.1:5432 0.0.0.0:*  users:(("postgres",pid=...))
# tcp  LISTEN  0  128  127.0.0.1:6379 0.0.0.0:*  users:(("redis",pid=...))

# WRONG — database listening on 0.0.0.0 (all interfaces)
# tcp  LISTEN  0  128  0.0.0.0:5432   0.0.0.0:*

# CORRECT — database listening on 127.0.0.1 only
# tcp  LISTEN  0  128  127.0.0.1:5432 0.0.0.0:*

# Automated port monitoring script
cat > /opt/scripts/port-audit.sh << 'SCRIPT'
#!/bin/bash
EXPECTED_PORTS="2222 80 443"
ALERT_EMAIL="admin@example.com"

for port in $(ss -tulnp | awk '/LISTEN/ && /0.0.0.0/ {print $5}' | cut -d: -f2 | sort -u); do
  if ! echo "$EXPECTED_PORTS" | grep -qw "$port"; then
    echo "UNEXPECTED PORT: $port listening on 0.0.0.0" | \
      mail -s "Port Alert: $(hostname)" "$ALERT_EMAIL"
  fi
done
SCRIPT
chmod +x /opt/scripts/port-audit.sh

# Run daily
echo "0 6 * * * /opt/scripts/port-audit.sh" | crontab -
```

### 12.2 External Port Scanning

```bash
# Scan your own server from outside (use another VPS or your machine)
nmap -sS -sV -O target-ip

# Scan with service version detection
nmap -sV --version-intensity 5 -p- target-ip

# Online alternatives (no nmap needed):
# - https://www.shodan.io/host/YOUR_IP
# - https://check.have-i-been-pwned.com/
# - nmap.online
```

---

## 13. Pre-Production Security Checklist

### 13.1 Server Hardening

```
ACCESS CONTROL:
  [ ] Non-root user created with SSH key
  [ ] Root SSH login disabled (PermitRootLogin no)
  [ ] Password authentication disabled
  [ ] SSH on non-standard port
  [ ] SSH key is Ed25519
  [ ] fail2ban running and configured
  [ ] Only necessary users have sudo

FIREWALL:
  [ ] UFW enabled with default deny incoming
  [ ] Only ports 22(or custom)/80/443 open
  [ ] Docker UFW bypass addressed
  [ ] No database ports exposed to internet
  [ ] Rate limiting on SSH

UPDATES:
  [ ] unattended-upgrades configured for security updates
  [ ] System fully updated (apt update && apt upgrade)
  [ ] Reboot if kernel was updated

KERNEL:
  [ ] sysctl hardening applied (SYN flood, IP spoofing, ICMP)
  [ ] File descriptor limits set for app user
  [ ] Unnecessary services disabled

MONITORING:
  [ ] auditd running with key file watches
  [ ] rkhunter baseline established
  [ ] fail2ban monitoring SSH + HTTP
  [ ] Log rotation configured
  [ ] Port audit script scheduled
```

### 13.2 Application Security

```
WEB SERVER:
  [ ] HTTPS enforced everywhere (HTTP → HTTPS redirect)
  [ ] TLS 1.2+ only (no TLS 1.0/1.1)
  [ ] Strong cipher suites configured
  [ ] HSTS enabled (Strict-Transport-Security header)
  [ ] Security headers set (X-Frame-Options, CSP, etc.)

SERVICES:
  [ ] Database listening on localhost or private network only
  [ ] Redis listening on localhost with password (or Unix socket)
  [ ] Application running as non-root user (User=app in systemd)
  [ ] Secrets in env files, not in code (chmod 600)
  [ ] .env files excluded from git

DOCKER (if used):
  [ ] Images from trusted sources only
  [ ] Containers run as non-root user
  [ ] no-new-privileges set in daemon.json
  [ ] Port bindings use 127.0.0.1:port
  [ ] Docker socket not exposed to containers
  [ ] Log rotation configured for containers
```

### 13.3 Cloudflare (if applicable)

```
DNS:
  [ ] All public A/AAAA records proxied (orange cloud)
  [ ] SSL/TLS mode set to Full (Strict)
  [ ] Origin certificate installed on server
  [ ] HSTS enabled in Cloudflare
  [ ] Always Use HTTPS enabled

WAF:
  [ ] Managed rulesets enabled (OWASP + Cloudflare)
  [ ] Rate limiting rules for API endpoints
  [ ] Country blocking if applicable
  [ ] Bot protection enabled (if Pro+)

CACHING:
  [ ] Static assets cached at edge
  [ ] API endpoints bypass cache
  [ ] Admin paths bypass cache
  [ ] Browser cache TTL set appropriately
```

### 13.4 Backup & Recovery

```
BACKUPS:
  [ ] Database backup automated (daily minimum)
  [ ] File storage backup automated
  [ ] Backups stored offsite (different provider)
  [ ] Backups encrypted
  [ ] Backup restore tested (at least once)
  [ ] Backup retention policy defined

DISASTER RECOVERY:
  [ ] Server setup is scripted (can rebuild in < 1 hour)
  [ ] Configuration files versioned (git)
  [ ] Restore procedure documented
  [ ] DNS TTL can be lowered quickly for failover
  [ ] Contact info for provider support readily available
```

### 13.5 Quick Audit Commands

```bash
# Run these commands and review output before going to production

echo "=== Open Ports ==="
ss -tulnp

echo "=== Firewall Status ==="
ufw status verbose

echo "=== SSH Configuration ==="
sshd -T | grep -E "^(port|permitroot|passwordauth|pubkeyauth|maxauthtries|allowusers)"

echo "=== Users with Login Shells ==="
grep -v '/nologin\|/false' /etc/passwd

echo "=== Users with sudo ==="
getent group sudo

echo "=== Running Services ==="
systemctl list-units --type=service --state=running --no-legend | awk '{print $1}'

echo "=== Failed Services ==="
systemctl list-units --type=service --state=failed --no-legend

echo "=== Kernel Security Parameters ==="
sysctl net.ipv4.tcp_syncookies net.ipv4.conf.all.rp_filter \
  net.ipv4.conf.all.accept_redirects net.ipv4.conf.all.send_redirects \
  kernel.randomize_va_space

echo "=== Disk Usage ==="
df -h

echo "=== Memory ==="
free -h

echo "=== Uptime and Load ==="
uptime

echo "=== Last 10 Logins ==="
last -10

echo "=== Failed Login Attempts ==="
journalctl -u sshd --since "7 days ago" | grep "Failed" | tail -20

echo "=== unattended-upgrades Status ==="
systemctl is-active unattended-upgrades

echo "=== Reboot Required? ==="
[ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo "No reboot needed"
```
