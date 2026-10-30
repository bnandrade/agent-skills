# Backup & Disaster Recovery

Backup strategies, database backups, file/storage backups, offsite storage, restore procedures, disaster recovery planning, monitoring, and automation. Real commands, real configs, copy-pasteable scripts.

---

## Table of Contents

1. [Backup Strategy Fundamentals](#1-backup-strategy-fundamentals)
2. [Database Backups](#2-database-backups)
3. [File and Storage Backups](#3-file-and-storage-backups)
4. [Server Snapshots](#4-server-snapshots)
5. [Offsite Storage](#5-offsite-storage)
6. [Restore Procedures](#6-restore-procedures)
7. [Disaster Recovery Planning](#7-disaster-recovery-planning)
8. [Monitoring Backups](#8-monitoring-backups)
9. [Automation](#9-automation)
10. [Complete Backup Setup Example](#10-complete-backup-setup-example)

---

## 1. Backup Strategy Fundamentals

### 1.1 The 3-2-1 Rule

**3** copies of your data, on **2** different media types, with **1** offsite.

```
Copy 1: Production database (live)
Copy 2: Local backup on same server or local storage (daily dump)
Copy 3: Offsite backup in different provider (Backblaze B2, S3 Glacier)
```

```
# WRONG: only backup is a database dump on the same server
/var/backups/db.sql.gz  ← server dies, backup dies too

# CORRECT: backup on server + synced to offsite storage
/var/backups/db.sql.gz  ← local copy (fast restore)
s3://backups/db.sql.gz  ← offsite copy (survives server loss)
```

### 1.2 RTO and RPO

| Term | Definition | Question It Answers |
|---|---|---|
| **RPO** (Recovery Point Objective) | Maximum acceptable data loss | "How much data can we lose?" |
| **RTO** (Recovery Time Objective) | Maximum acceptable downtime | "How long can we be down?" |

**RPO example:** If RPO = 1 hour, you need backups at least every hour. Any data created in the last hour before failure is lost.

**RTO example:** If RTO = 4 hours, you need to be able to restore everything and be back online within 4 hours.

### 1.3 RTO/RPO by Project Type

| Project Type | RPO | RTO | Backup Strategy |
|---|---|---|---|
| Personal blog | 24 hours | 48 hours | Daily dump to B2 |
| MVP/early SaaS | 4 hours | 8 hours | Every 4h dump + daily snapshot |
| SaaS (paying users) | 1 hour | 2 hours | Hourly dump + WAL archiving + snapshot |
| E-commerce | 15 minutes | 1 hour | WAL archiving + streaming replication |
| Fintech / health | Near zero | 15 minutes | Streaming replication + multi-region + hot standby |

### 1.4 What to Back Up

| Data | Priority | Method |
|---|---|---|
| Database | CRITICAL | pg_dump + WAL archiving |
| User uploads | HIGH | Sync to S3/B2 |
| Application config (.env, secrets) | HIGH | Encrypted in password manager or Vault |
| SSL certificates | MEDIUM | Re-issuable (Let's Encrypt), but save origin certs |
| Server config (Caddyfile, etc.) | MEDIUM | Version controlled (git) |
| Logs | LOW | Ship to log service, not critical to restore |
| Application code | ALREADY BACKED UP | In git (GitHub/GitLab) |

---

## 2. Database Backups

### 2.1 PostgreSQL

#### pg_dump (Logical Backup)

```bash
# Full database dump (compressed)
pg_dump -h localhost -U appuser -d mydb -Fc -f /var/backups/pg/mydb_$(date +%Y%m%d_%H%M%S).dump

# Dump as plain SQL (human-readable, larger file)
pg_dump -h localhost -U appuser -d mydb | gzip > /var/backups/pg/mydb_$(date +%Y%m%d_%H%M%S).sql.gz

# Dump specific tables
pg_dump -h localhost -U appuser -d mydb -t users -t orders -Fc -f /var/backups/pg/tables.dump

# Dump schema only (no data)
pg_dump -h localhost -U appuser -d mydb --schema-only -f /var/backups/pg/schema.sql

# All databases
pg_dumpall -h localhost -U postgres | gzip > /var/backups/pg/all_$(date +%Y%m%d).sql.gz
```

**pg_dump flags:**

| Flag | Meaning |
|---|---|
| `-Fc` | Custom format (compressed, supports parallel restore) |
| `-Fp` | Plain SQL format (readable, pipe-able) |
| `-Fd` | Directory format (parallel dump) |
| `-j 4` | Parallel jobs (with `-Fd`) |
| `--no-owner` | Don't output ownership commands |
| `--clean` | Include DROP commands before CREATE |

```
# WRONG: uncompressed dump wastes disk
pg_dump mydb > /var/backups/mydb.sql

# CORRECT: custom format (compressed, parallel restore)
pg_dump -Fc mydb -f /var/backups/mydb.dump
```

#### pg_basebackup (Physical Backup)

Full copy of the PostgreSQL data directory. Required for point-in-time recovery (PITR).

```bash
# Full base backup
pg_basebackup -h localhost -U replication_user -D /var/backups/pg/base \
    -Ft -z -Xs -P

# Flags:
# -Ft  = tar format
# -z   = compress with gzip
# -Xs  = stream WAL during backup (don't miss transactions)
# -P   = show progress
```

#### WAL Archiving (Point-in-Time Recovery)

WAL (Write-Ahead Log) archiving captures every transaction. Combined with a base backup, you can restore to any point in time.

```ini
# /etc/postgresql/16/main/postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/backups/pg/wal/%f && cp %p /var/backups/pg/wal/%f'
# Or archive to S3:
# archive_command = 'aws s3 cp %p s3://mybackups/wal/%f'
```

```bash
# Create WAL archive directory
sudo mkdir -p /var/backups/pg/wal
sudo chown postgres:postgres /var/backups/pg/wal

# Restart PostgreSQL after config change
sudo systemctl restart postgresql
```

**Point-in-Time Recovery (PITR):**

```bash
# 1. Stop PostgreSQL
sudo systemctl stop postgresql

# 2. Move current data directory aside
sudo mv /var/lib/postgresql/16/main /var/lib/postgresql/16/main.old

# 3. Restore base backup
sudo tar xzf /var/backups/pg/base/base.tar.gz -C /var/lib/postgresql/16/main

# 4. Create recovery signal and configure recovery target
sudo tee /var/lib/postgresql/16/main/postgresql.auto.conf <<'EOF'
restore_command = 'cp /var/backups/pg/wal/%f %p'
recovery_target_time = '2025-01-15 14:30:00 UTC'
recovery_target_action = 'promote'
EOF

# 5. Create recovery signal file
sudo touch /var/lib/postgresql/16/main/recovery.signal
sudo chown -R postgres:postgres /var/lib/postgresql/16/main

# 6. Start PostgreSQL — it will replay WAL up to the target time
sudo systemctl start postgresql

# 7. Check logs for successful recovery
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

### 2.2 MySQL

#### mysqldump

```bash
# Full database dump
mysqldump -u root -p --single-transaction --routines --triggers \
    mydb | gzip > /var/backups/mysql/mydb_$(date +%Y%m%d_%H%M%S).sql.gz

# All databases
mysqldump -u root -p --all-databases --single-transaction \
    --routines --triggers | gzip > /var/backups/mysql/all_$(date +%Y%m%d).sql.gz

# Specific tables
mysqldump -u root -p --single-transaction mydb users orders \
    | gzip > /var/backups/mysql/tables.sql.gz
```

**Important flags:**

| Flag | Why |
|---|---|
| `--single-transaction` | Consistent snapshot without locking (InnoDB) |
| `--routines` | Include stored procedures/functions |
| `--triggers` | Include triggers |
| `--quick` | Don't buffer entire result in memory (default in modern versions) |

```
# WRONG: dumping without --single-transaction (locks tables)
mysqldump mydb > backup.sql

# CORRECT: consistent snapshot without locks
mysqldump --single-transaction --routines --triggers mydb | gzip > backup.sql.gz
```

#### mysqlpump (Parallel Dumps)

```bash
# Parallel dump with 4 threads
mysqlpump -u root -p --default-parallelism=4 \
    --databases mydb | gzip > /var/backups/mysql/mydb.sql.gz
```

#### XtraBackup (Hot Physical Backup)

For large databases where mysqldump is too slow.

```bash
# Install Percona XtraBackup
sudo apt install percona-xtrabackup-80

# Full backup
xtrabackup --backup --target-dir=/var/backups/mysql/full \
    --user=root --password=xxx

# Prepare backup (apply logs)
xtrabackup --prepare --target-dir=/var/backups/mysql/full

# Restore
sudo systemctl stop mysql
sudo mv /var/lib/mysql /var/lib/mysql.old
xtrabackup --copy-back --target-dir=/var/backups/mysql/full
sudo chown -R mysql:mysql /var/lib/mysql
sudo systemctl start mysql
```

### 2.3 SQLite

SQLite is a single file. Backup is simple but has a catch with WAL mode.

```bash
# WRONG: just copy the file while the app is running
cp /var/data/app.db /var/backups/app.db  # Can be corrupted mid-write

# CORRECT: use SQLite's backup command
sqlite3 /var/data/app.db ".backup /var/backups/app_$(date +%Y%m%d).db"

# CORRECT: use VACUUM INTO (creates optimized copy)
sqlite3 /var/data/app.db "VACUUM INTO '/var/backups/app_$(date +%Y%m%d).db'"

# If using WAL mode, checkpoint first then copy
sqlite3 /var/data/app.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp /var/data/app.db /var/backups/app.db
```

### 2.4 Redis

```
# Redis persistence modes:

# RDB snapshots — point-in-time snapshots (default)
# Good for backups, fast restart, but can lose last few minutes of data

# AOF (Append Only File) — logs every write
# Better durability, slower restart, larger files

# Combined (recommended) — both RDB + AOF
```

```ini
# /etc/redis/redis.conf

# RDB snapshots
save 900 1      # Save if 1 key changed in 900 seconds
save 300 10     # Save if 10 keys changed in 300 seconds
save 60 10000   # Save if 10000 keys changed in 60 seconds

# AOF
appendonly yes
appendfsync everysec   # Sync every second (good balance)

# RDB file location
dbfilename dump.rdb
dir /var/lib/redis
```

```bash
# Manual backup: trigger RDB save and copy the file
redis-cli BGSAVE
# Wait for save to complete
redis-cli LASTSAVE
cp /var/lib/redis/dump.rdb /var/backups/redis/dump_$(date +%Y%m%d).rdb
```

---

## 3. File and Storage Backups

### 3.1 User Uploads to S3/Backblaze B2

```bash
# Using rclone (recommended — works with any cloud storage)
# Install
curl https://rclone.org/install.sh | sudo bash

# Configure B2 backend
rclone config
# Choose: Backblaze B2
# Enter: account ID and application key

# Sync uploads to B2
rclone sync /var/www/app/storage/app/public b2:mybucket/uploads --progress

# Cron: sync every hour
0 * * * * rclone sync /var/www/app/storage/app/public b2:mybucket/uploads --log-file=/var/log/rclone-sync.log --log-level=ERROR
```

```bash
# Using AWS CLI (for S3)
aws s3 sync /var/www/app/storage/app/public s3://mybucket/uploads --delete

# Only sync new/changed files (default behavior of sync)
# --delete removes files from S3 that were deleted locally
```

### 3.2 restic (Encrypted Incremental Backups)

restic is the recommended tool for file-level backups. Encrypted, deduplicated, incremental, and supports multiple backends.

```bash
# Install
sudo apt install restic

# Initialize repository on Backblaze B2
export B2_ACCOUNT_ID="your-account-id"
export B2_ACCOUNT_KEY="your-application-key"
restic -r b2:mybucket:/restic-repo init

# Or initialize on local disk
restic -r /var/backups/restic init

# Or S3-compatible storage
export AWS_ACCESS_KEY_ID="xxx"
export AWS_SECRET_ACCESS_KEY="yyy"
restic -r s3:s3.amazonaws.com/mybucket/restic init
```

```bash
# Backup
restic -r b2:mybucket:/restic-repo backup /var/www/app/storage \
    --exclude="*.log" \
    --exclude=".cache"

# Backup with tags
restic -r b2:mybucket:/restic-repo backup /var/www/app/storage \
    --tag="daily" --tag="production"

# List snapshots
restic -r b2:mybucket:/restic-repo snapshots

# Restore latest snapshot
restic -r b2:mybucket:/restic-repo restore latest --target /tmp/restore

# Restore specific snapshot
restic -r b2:mybucket:/restic-repo restore abc123 --target /tmp/restore

# Restore specific files
restic -r b2:mybucket:/restic-repo restore latest --target /tmp/restore \
    --include="/var/www/app/storage/app/public"
```

**Retention policy:**

```bash
# Keep: 7 daily, 4 weekly, 12 monthly, 2 yearly
restic -r b2:mybucket:/restic-repo forget \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 12 \
    --keep-yearly 2 \
    --prune

# --prune actually removes data (without it, snapshots are removed but data stays)
```

### 3.3 rclone (Cloud-to-Cloud Sync)

```bash
# Sync between two cloud providers
rclone sync s3:mybucket/uploads b2:mybucket-backup/uploads

# Encrypted backup to any cloud provider
rclone config
# Create a "crypt" remote that wraps another remote
# All filenames and contents are encrypted

# Sync with bandwidth limit
rclone sync /var/www/uploads b2:mybucket/uploads --bwlimit 10M

# Check what would change (dry run)
rclone sync /var/www/uploads b2:mybucket/uploads --dry-run
```

### 3.4 Backup Retention Policy

| Interval | Keep | Rationale |
|---|---|---|
| Daily | 7 | Recover from recent mistakes |
| Weekly | 4 | Recover from issues noticed days later |
| Monthly | 12 | Recover from long-term data corruption |
| Yearly | 2 | Compliance / legal requirements |

Total storage: roughly 25 snapshots. With deduplication (restic), actual disk usage is much less.

---

## 4. Server Snapshots

### 4.1 DigitalOcean Snapshots

```bash
# Create snapshot via API
doctl compute droplet-action snapshot <droplet-id> --snapshot-name "pre-deploy-$(date +%Y%m%d)"

# List snapshots
doctl compute snapshot list --resource droplet

# Restore from snapshot (creates new droplet)
doctl compute droplet create restored-server \
    --image <snapshot-id> \
    --size s-2vcpu-4gb \
    --region nyc1

# Automate weekly snapshots
# DigitalOcean has built-in weekly backups ($1/month per droplet, 4 weekly retained)
# Enable via dashboard: Droplet > Backups > Enable
```

**Pricing:** DigitalOcean snapshots cost $0.06/GB/month. A 25GB snapshot = $1.50/month.

### 4.2 Hetzner Snapshots

```bash
# Using hcloud CLI
hcloud server create-image --type snapshot --description "pre-deploy-$(date +%Y%m%d)" <server-id>

# List snapshots
hcloud image list --type snapshot

# Rebuild server from snapshot
hcloud server rebuild --image <snapshot-id> <server-id>
```

**Pricing:** Hetzner snapshots cost EUR 0.0108/GB/month. A 20GB snapshot = ~EUR 0.22/month. Very cheap.

### 4.3 AWS AMIs and EBS Snapshots

```bash
# Create AMI from running instance
aws ec2 create-image --instance-id i-xxx --name "pre-deploy-$(date +%Y%m%d)" --no-reboot

# Create EBS snapshot
aws ec2 create-snapshot --volume-id vol-xxx --description "daily-$(date +%Y%m%d)"

# Automate with AWS Data Lifecycle Manager (DLM)
# Or use AWS Backup service
```

**Pricing:** EBS snapshots cost $0.05/GB/month (incremental after first).

---

## 5. Offsite Storage

### 5.1 Provider Comparison

| Provider | Price (storage) | Price (egress) | Best For |
|---|---|---|---|
| **Backblaze B2** | $0.005/GB/month | $0.01/GB (free with Cloudflare) | General backups (cheapest) |
| **AWS S3 Standard** | $0.023/GB/month | $0.09/GB | App storage, CDN origin |
| **AWS S3 Glacier** | $0.004/GB/month | $0.09/GB + retrieval fee | Long-term archives |
| **AWS S3 Glacier Deep** | $0.00099/GB/month | Retrieval takes 12-48 hours | Compliance archives |
| **Hetzner Storage Box** | EUR 3.81/month for 1TB | Included | SFTP/rsync backups (cheap) |
| **Wasabi** | $0.0069/GB/month | Free egress | S3-compatible, no egress fees |

### 5.2 Backblaze B2 Setup

```bash
# Install B2 CLI
pip install b2

# Authorize
b2 authorize-account <account-id> <application-key>

# Create bucket
b2 create-bucket --defaultServerSideEncryption=SSE-B2 mybackups allPrivate

# Upload file
b2 upload-file mybackups /var/backups/pg/mydb.dump pg/mydb.dump

# Lifecycle rules (auto-delete old files)
b2 update-bucket --lifecycleRules '[
    {"daysFromHidingToDeleting": 30, "fileNamePrefix": "pg/"}
]' mybackups allPrivate
```

**B2 + Cloudflare bandwidth alliance:** Egress from B2 through Cloudflare is free. If you ever need to restore large amounts of data, use Cloudflare Workers to proxy the download.

### 5.3 Hetzner Storage Box

```bash
# Access via SFTP
sftp u123456@u123456.your-storagebox.de

# rsync over SSH (fast incremental sync)
rsync -avz --delete /var/backups/ u123456@u123456.your-storagebox.de:./backups/

# Mount as CIFS/SMB (for automated scripts)
sudo mount -t cifs -o username=u123456,password=xxx \
    //u123456.your-storagebox.de/backup /mnt/storagebox
```

**Pricing:** 1TB for EUR 3.81/month. Excellent for budget backups.

### 5.4 AWS S3 with Lifecycle Policy

```bash
# Create bucket
aws s3 mb s3://myapp-backups-prod

# Upload
aws s3 cp /var/backups/pg/mydb.dump s3://myapp-backups-prod/pg/

# Lifecycle: move to Glacier after 30 days, delete after 365
aws s3api put-bucket-lifecycle-configuration --bucket myapp-backups-prod \
    --lifecycle-configuration '{
    "Rules": [{
        "ID": "backup-lifecycle",
        "Filter": {"Prefix": "pg/"},
        "Status": "Enabled",
        "Transitions": [{
            "Days": 30,
            "StorageClass": "GLACIER"
        }],
        "Expiration": {"Days": 365}
    }]
}'
```

---

## 6. Restore Procedures

### 6.1 PostgreSQL Restore from Dump

```bash
# Restore custom format dump
pg_restore -h localhost -U postgres -d mydb --clean --if-exists \
    /var/backups/pg/mydb.dump

# Restore to a NEW database (safer — don't overwrite production)
createdb -h localhost -U postgres mydb_restored
pg_restore -h localhost -U postgres -d mydb_restored /var/backups/pg/mydb.dump

# Restore plain SQL dump
gunzip -c /var/backups/pg/mydb.sql.gz | psql -h localhost -U postgres -d mydb_restored

# Parallel restore (faster for large databases)
pg_restore -h localhost -U postgres -d mydb_restored -j 4 /var/backups/pg/mydb.dump
```

### 6.2 MySQL Restore

```bash
# Restore
gunzip -c /var/backups/mysql/mydb.sql.gz | mysql -u root -p mydb

# Restore to new database
mysql -u root -p -e "CREATE DATABASE mydb_restored"
gunzip -c /var/backups/mysql/mydb.sql.gz | mysql -u root -p mydb_restored
```

### 6.3 Full Server Rebuild from Backup

**Restore order matters.** Follow this sequence:

```
1. Provision new server (same specs or better)
2. Run initial hardening script (SSH keys, firewall, fail2ban)
3. Install required packages (PostgreSQL, Redis, PHP/Go, Caddy)
4. Restore configuration files:
   a. /etc/caddy/Caddyfile
   b. /etc/postgresql/16/main/pg_hba.conf
   c. Application .env files
5. Restore database (pg_restore)
6. Restore user uploads (from B2/S3)
7. Deploy application code (git pull or docker pull)
8. Restore cron jobs
9. Start services
10. Verify everything works
11. Update DNS to point to new server
```

### 6.4 Test Restore Checklist

Run this monthly. **A backup that has never been tested is not a backup.**

```markdown
## Monthly Restore Test — [DATE]

### Pre-Test
- [ ] Provisioned test server (separate from production)
- [ ] Downloaded latest backup from offsite storage

### Database Restore
- [ ] Restored PostgreSQL dump successfully
- [ ] Row counts match production (±expected delta)
- [ ] Sample queries return expected results
- [ ] Indexes are present and working

### File Restore
- [ ] User uploads restored from B2/S3
- [ ] Files are accessible and not corrupted
- [ ] Sample images/documents open correctly

### Application
- [ ] Application starts without errors
- [ ] Login works
- [ ] Critical user flows work (create order, submit form, etc.)
- [ ] Background jobs process correctly

### Timing
- [ ] Total restore time: _____ minutes
- [ ] Meets RTO target? YES / NO

### Issues Found
- [ ] (list any issues and fix them)

### Sign-off
- Tested by: _____
- Date: _____
```

---

## 7. Disaster Recovery Planning

### 7.1 Disaster Scenarios

| Scenario | Impact | Recovery |
|---|---|---|
| **Server crash** | All services down | Rebuild from snapshot + restore DB from backup |
| **Data corruption** | Database corrupted | PITR to before corruption event |
| **Provider outage** | All servers in region down | Fail over to different provider (if multi-provider) or wait |
| **Accidental deletion** | Data lost | Restore from backup (that's why we have them) |
| **Ransomware** | Data encrypted | Rebuild from clean backup (offsite, not accessible from server) |
| **DNS hijacking** | Traffic misdirected | Registrar lock, DNSSEC, monitor with cert transparency |
| **Security breach** | Data exfiltrated | Incident response plan, forensics, notification |

### 7.2 Recovery Runbook Template

```markdown
# Disaster Recovery Runbook — [APP NAME]

## Contacts
- On-call engineer: Bruno (+55 xx xxxxx-xxxx)
- Hosting provider support: [URL/phone]
- Domain registrar: [URL]
- Cloudflare: https://dash.cloudflare.com

## Critical Credentials Location
- Server SSH keys: [password manager entry]
- Database passwords: [password manager entry]
- Cloudflare API token: [password manager entry]
- Backblaze B2 keys: [password manager entry]

## Scenario: Server is Down

### 1. Assess (5 min)
- Check provider status page
- Check if server responds to ping
- Check Cloudflare analytics (is traffic reaching Cloudflare?)
- Check monitoring alerts

### 2. Quick Fix Attempt (10 min)
- Try server console (provider dashboard)
- Reboot via API: `doctl compute droplet-action reboot <id>`
- Check system logs via console

### 3. Rebuild (if server is unrecoverable)
1. Provision new server (same region, same specs)
2. Run setup script: `./setup-server.sh`
3. Restore database:
   ```
   # Download latest backup
   b2 download-file-by-name mybackups pg/latest.dump /tmp/restore.dump
   pg_restore -h localhost -U postgres -d mydb --clean /tmp/restore.dump
   ```
4. Restore uploads:
   ```
   rclone sync b2:mybucket/uploads /var/www/app/storage/app/public
   ```
5. Deploy application:
   ```
   cd /var/www/app && git pull origin main
   composer install --no-dev
   php artisan migrate
   ```
6. Start services:
   ```
   sudo systemctl start caddy php8.4-fpm redis postgresql
   ```
7. Update DNS (if IP changed):
   - Cloudflare: update A record to new IP
   - TTL is 5 min so propagation is fast

### 4. Verify
- [ ] Website loads
- [ ] API responds
- [ ] Login works
- [ ] Recent data is present
- [ ] Background jobs running

### 5. Post-Incident
- [ ] Write incident report
- [ ] Identify root cause
- [ ] Update runbook if needed
- [ ] Improve monitoring to detect earlier
```

### 7.3 Communication Plan

```markdown
## During an Outage

1. **Status page** — Update status.example.com immediately
   - Better Stack (formerly Better Uptime): free status page
   - Or Cloudflare Pages with manual updates

2. **Internal** — Notify team in Slack/Discord
   - #incidents channel
   - Tag on-call engineer

3. **External** — If outage > 30 min
   - Tweet/post about the issue
   - Email affected customers (if data loss)

4. **Post-mortem** — Within 48 hours
   - Timeline of events
   - Root cause
   - What we'll do to prevent recurrence
```

---

## 8. Monitoring Backups

### 8.1 Alert if Backup Didn't Run

Use a dead man's switch pattern: the backup script pings a monitoring URL on success. If the ping doesn't arrive on time, you get alerted.

**Healthchecks.io (recommended, free tier: 20 checks):**

```bash
#!/bin/bash
# /opt/scripts/backup-db.sh

HEALTHCHECK_URL="https://hc-ping.com/your-uuid-here"
BACKUP_DIR="/var/backups/pg"
DB_NAME="mydb"

# Signal start
curl -fsS -m 10 --retry 5 "${HEALTHCHECK_URL}/start" > /dev/null

# Run backup
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_$(date +%Y%m%d_%H%M%S).dump"
if pg_dump -h localhost -U appuser -d "$DB_NAME" -Fc -f "$BACKUP_FILE"; then
    # Upload to B2
    if rclone copy "$BACKUP_FILE" b2:mybucket/pg/; then
        # Signal success
        curl -fsS -m 10 --retry 5 "${HEALTHCHECK_URL}" > /dev/null
    else
        # Signal failure
        curl -fsS -m 10 --retry 5 "${HEALTHCHECK_URL}/fail" > /dev/null
        exit 1
    fi
else
    curl -fsS -m 10 --retry 5 "${HEALTHCHECK_URL}/fail" > /dev/null
    exit 1
fi
```

### 8.2 Alert if Backup Size is Suspicious

```bash
#!/bin/bash
# /opt/scripts/check-backup-size.sh

BACKUP_DIR="/var/backups/pg"
MIN_SIZE_MB=10       # Alert if backup is smaller than 10MB
MAX_SIZE_MB=5000     # Alert if backup is larger than 5GB
WEBHOOK_URL="https://hooks.slack.com/services/xxx/yyy/zzz"

LATEST=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    MESSAGE="CRITICAL: No backup files found in $BACKUP_DIR"
else
    SIZE_MB=$(du -m "$LATEST" | cut -f1)
    FILENAME=$(basename "$LATEST")

    if [ "$SIZE_MB" -lt "$MIN_SIZE_MB" ]; then
        MESSAGE="WARNING: Backup $FILENAME is suspiciously small (${SIZE_MB}MB < ${MIN_SIZE_MB}MB)"
    elif [ "$SIZE_MB" -gt "$MAX_SIZE_MB" ]; then
        MESSAGE="WARNING: Backup $FILENAME is suspiciously large (${SIZE_MB}MB > ${MAX_SIZE_MB}MB)"
    else
        exit 0  # Size is normal
    fi
fi

curl -s -X POST "$WEBHOOK_URL" \
    -H 'Content-type: application/json' \
    -d "{\"text\": \"$MESSAGE\"}"
```

### 8.3 Monitoring Services

| Service | Free Tier | Use For |
|---|---|---|
| **Healthchecks.io** | 20 checks | Dead man's switch for cron/backup jobs |
| **Better Stack** | 10 monitors | Uptime + SSL + status page |
| **UptimeRobot** | 50 monitors | HTTP/ping/port monitoring |
| **Grafana Cloud** | 10k metrics | Dashboard for backup metrics |

---

## 9. Automation

### 9.1 Cron Jobs for Backups

```bash
# /etc/cron.d/backups

# PostgreSQL: dump every 4 hours
0 */4 * * * root /opt/scripts/backup-db.sh >> /var/log/backup-db.log 2>&1

# User uploads: sync to B2 every hour
0 * * * * root rclone sync /var/www/app/storage/app/public b2:mybucket/uploads --log-file=/var/log/rclone-sync.log --log-level=ERROR

# Cleanup old local backups: keep 7 days
0 5 * * * root find /var/backups/pg -name "*.dump" -mtime +7 -delete

# Check backup sizes daily
0 8 * * * root /opt/scripts/check-backup-size.sh

# Monthly: test restore (sends reminder)
0 9 1 * * root echo "REMINDER: Run monthly restore test" | mail -s "Monthly Restore Test Due" admin@example.com
```

### 9.2 systemd Timers (Better than Cron)

systemd timers are better than cron for servers: better logging, dependency management, and resource control.

```ini
# /etc/systemd/system/backup-db.service
[Unit]
Description=PostgreSQL Backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/opt/scripts/backup-db.sh
User=root
Nice=10
IOSchedulingClass=idle
```

```ini
# /etc/systemd/system/backup-db.timer
[Unit]
Description=Run PostgreSQL backup every 4 hours

[Timer]
OnCalendar=*-*-* 00/4:00:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now backup-db.timer

# Check status
sudo systemctl list-timers --all | grep backup

# Check last run
sudo journalctl -u backup-db.service --since today

# Manual run
sudo systemctl start backup-db.service
```

**Why systemd timers are better than cron:**

| Feature | Cron | systemd Timer |
|---|---|---|
| Logging | Manual (redirect to file) | Automatic (journalctl) |
| Missed runs | Lost forever | `Persistent=true` runs on next boot |
| Resource limits | None | CPU/memory/IO limits |
| Dependencies | None | `After=postgresql.service` |
| Randomized delay | No | `RandomizedDelaySec` (prevents thundering herd) |
| Status | `crontab -l` | `systemctl list-timers` |

### 9.3 Backup Verification Script

```bash
#!/bin/bash
# /opt/scripts/verify-backup.sh
# Verifies the latest backup is restorable

set -euo pipefail

HEALTHCHECK_URL="https://hc-ping.com/your-verify-uuid"
BACKUP_DIR="/var/backups/pg"
VERIFY_DB="verify_restore_test"

curl -fsS -m 10 "${HEALTHCHECK_URL}/start" > /dev/null 2>&1 || true

LATEST=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    echo "ERROR: No backup found"
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    exit 1
fi

echo "Verifying backup: $LATEST"

# Drop test database if exists
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $VERIFY_DB;" 2>/dev/null

# Create test database
sudo -u postgres psql -c "CREATE DATABASE $VERIFY_DB;"

# Restore
if pg_restore -h localhost -U postgres -d "$VERIFY_DB" "$LATEST" 2>/dev/null; then
    # Run basic integrity checks
    TABLE_COUNT=$(sudo -u postgres psql -d "$VERIFY_DB" -t -c \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
    USERS_COUNT=$(sudo -u postgres psql -d "$VERIFY_DB" -t -c \
        "SELECT count(*) FROM users;" 2>/dev/null || echo "0")

    echo "Tables: $TABLE_COUNT"
    echo "Users: $USERS_COUNT"

    if [ "$TABLE_COUNT" -gt 0 ]; then
        echo "PASS: Backup verified successfully"
        curl -fsS -m 10 "${HEALTHCHECK_URL}" > /dev/null 2>&1 || true
    else
        echo "FAIL: No tables found after restore"
        curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    fi
else
    echo "FAIL: pg_restore failed"
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
fi

# Cleanup
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $VERIFY_DB;" 2>/dev/null

echo "Verification complete"
```

```ini
# /etc/systemd/system/verify-backup.timer
[Unit]
Description=Weekly backup verification

[Timer]
OnCalendar=Sun 06:00
Persistent=true

[Install]
WantedBy=timers.target
```

---

## 10. Complete Backup Setup Example

Full backup setup for a production Laravel app with PostgreSQL, user uploads, and a Hetzner VPS.

### 10.1 Directory Structure

```
/opt/scripts/
├── backup-db.sh            # PostgreSQL dump + upload to B2
├── backup-uploads.sh        # Sync uploads to B2
├── verify-backup.sh         # Weekly restore verification
├── check-backup-size.sh     # Size anomaly detection
└── restore-db.sh            # Documented restore procedure

/var/backups/
├── pg/                      # PostgreSQL dumps (local, 7 days retention)
└── redis/                   # Redis snapshots

# Offsite (Backblaze B2):
b2:myapp-backups/
├── pg/                      # PostgreSQL dumps
├── uploads/                 # User uploads mirror
├── wal/                     # WAL archives (if using PITR)
└── restic/                  # restic repo (server config files)
```

### 10.2 PostgreSQL Daily + WAL Archiving

```bash
#!/bin/bash
# /opt/scripts/backup-db.sh
set -euo pipefail

# Configuration
DB_NAME="myapp"
DB_USER="appuser"
BACKUP_DIR="/var/backups/pg"
B2_BUCKET="myapp-backups"
HEALTHCHECK_URL="https://hc-ping.com/uuid-for-db-backup"
SLACK_WEBHOOK="https://hooks.slack.com/services/xxx/yyy/zzz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Signal start
curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}/start" > /dev/null 2>&1 || true

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"

echo "[$(date)] Starting backup of $DB_NAME"

# Dump
if ! pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" -Fc -f "$BACKUP_FILE"; then
    echo "[$(date)] ERROR: pg_dump failed"
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    curl -s -X POST "$SLACK_WEBHOOK" -H 'Content-type: application/json' \
        -d '{"text":"CRITICAL: Database backup FAILED for '"$DB_NAME"'"}' || true
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Dump complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Upload to B2
if ! rclone copy "$BACKUP_FILE" "b2:${B2_BUCKET}/pg/" --log-level=ERROR; then
    echo "[$(date)] ERROR: Upload to B2 failed"
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    exit 1
fi

echo "[$(date)] Uploaded to B2"

# Cleanup old local backups (keep 7 days)
find "$BACKUP_DIR" -name "*.dump" -mtime +7 -delete

# Signal success
curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}" > /dev/null 2>&1 || true

echo "[$(date)] Backup complete: $DB_NAME ($BACKUP_SIZE)"
```

### 10.3 User Uploads to B2

```bash
#!/bin/bash
# /opt/scripts/backup-uploads.sh
set -euo pipefail

UPLOADS_DIR="/var/www/app/storage/app/public"
B2_BUCKET="myapp-backups"
HEALTHCHECK_URL="https://hc-ping.com/uuid-for-uploads-backup"

curl -fsS -m 10 "${HEALTHCHECK_URL}/start" > /dev/null 2>&1 || true

if rclone sync "$UPLOADS_DIR" "b2:${B2_BUCKET}/uploads/" \
    --log-level=ERROR \
    --log-file=/var/log/backup-uploads.log; then
    curl -fsS -m 10 "${HEALTHCHECK_URL}" > /dev/null 2>&1 || true
else
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    exit 1
fi
```

### 10.4 Server Snapshot Weekly

```bash
#!/bin/bash
# /opt/scripts/snapshot-server.sh
set -euo pipefail

# Hetzner Cloud
HCLOUD_TOKEN="${HCLOUD_TOKEN}"
SERVER_ID="12345"
HEALTHCHECK_URL="https://hc-ping.com/uuid-for-snapshot"

curl -fsS -m 10 "${HEALTHCHECK_URL}/start" > /dev/null 2>&1 || true

SNAPSHOT_NAME="weekly-$(date +%Y%m%d)"

# Create snapshot
if hcloud server create-image --type snapshot --description "$SNAPSHOT_NAME" "$SERVER_ID"; then
    echo "Snapshot created: $SNAPSHOT_NAME"

    # Delete snapshots older than 4 weeks
    OLD_SNAPSHOTS=$(hcloud image list --type snapshot -o noheader -o columns=id,description | \
        grep "weekly-" | head -n -4 | awk '{print $1}')

    for id in $OLD_SNAPSHOTS; do
        hcloud image delete "$id"
        echo "Deleted old snapshot: $id"
    done

    curl -fsS -m 10 "${HEALTHCHECK_URL}" > /dev/null 2>&1 || true
else
    curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" > /dev/null 2>&1 || true
    exit 1
fi
```

### 10.5 systemd Timer Setup (All Together)

```ini
# /etc/systemd/system/backup-db.service
[Unit]
Description=PostgreSQL backup to B2
After=postgresql.service network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scripts/backup-db.sh
User=root
Nice=10
IOSchedulingClass=idle
Environment="PGPASSWORD=xxx"
```

```ini
# /etc/systemd/system/backup-db.timer
[Unit]
Description=PostgreSQL backup every 4 hours

[Timer]
OnCalendar=*-*-* 00/4:00:00
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/backup-uploads.service
[Unit]
Description=Sync user uploads to B2
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scripts/backup-uploads.sh
User=root
Nice=15
IOSchedulingClass=idle
```

```ini
# /etc/systemd/system/backup-uploads.timer
[Unit]
Description=Sync uploads hourly

[Timer]
OnCalendar=hourly
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/snapshot-server.service
[Unit]
Description=Weekly server snapshot
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scripts/snapshot-server.sh
User=root
Environment="HCLOUD_TOKEN=xxx"
```

```ini
# /etc/systemd/system/snapshot-server.timer
[Unit]
Description=Weekly server snapshot

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/verify-backup.service
[Unit]
Description=Weekly backup verification
After=postgresql.service network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scripts/verify-backup.sh
User=root
```

```ini
# /etc/systemd/system/verify-backup.timer
[Unit]
Description=Weekly backup verification

[Timer]
OnCalendar=Sun 06:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
# Enable all timers
sudo systemctl daemon-reload
sudo systemctl enable --now backup-db.timer
sudo systemctl enable --now backup-uploads.timer
sudo systemctl enable --now snapshot-server.timer
sudo systemctl enable --now verify-backup.timer

# Verify all timers
sudo systemctl list-timers --all | grep -E "backup|snapshot|verify"
```

### 10.6 Cost Estimate

| Item | Monthly Cost |
|---|---|
| Backblaze B2 (50GB backups) | $0.25 |
| Hetzner snapshots (20GB x 4) | EUR 0.86 |
| Healthchecks.io (free tier) | $0 |
| **Total** | **~$1.25/month** |

For a SaaS with paying users, this is negligible. There is no excuse for not having backups.

### 10.7 Restore Cheat Sheet

```bash
# === Quick restore commands ===

# 1. Download latest DB backup from B2
rclone copy b2:myapp-backups/pg/ /tmp/restore/ --include="*.dump" --max-depth=1
LATEST=$(ls -t /tmp/restore/*.dump | head -1)

# 2. Restore PostgreSQL
createdb -U postgres myapp_restored
pg_restore -U postgres -d myapp_restored "$LATEST"

# 3. Restore uploads
rclone sync b2:myapp-backups/uploads/ /var/www/app/storage/app/public/

# 4. Verify
psql -U postgres -d myapp_restored -c "SELECT count(*) FROM users;"
ls -la /var/www/app/storage/app/public/ | head -20
```
