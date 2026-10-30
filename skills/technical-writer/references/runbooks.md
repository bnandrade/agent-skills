# Runbooks

Procedimentos operacionais passo a passo. Quando algo quebra as 3 da manha, o engenheiro de plantao le o runbook. Clareza e precisao salvam producao (e sono).

---

## Table of Contents

1. [What Is a Runbook](#1-what-is-a-runbook)
2. [When to Write One](#2-when-to-write-one)
3. [Runbook Structure](#3-runbook-structure)
4. [Deploy Runbook Template](#4-deploy-runbook-template)
5. [Incident Response Runbook Template](#5-incident-response-runbook-template)
6. [Database Maintenance Runbook Template](#6-database-maintenance-runbook-template)
7. [Service Restart and Recovery Template](#7-service-restart-and-recovery-template)
8. [Runbook Testing](#8-runbook-testing)
9. [Automating Runbooks](#9-automating-runbooks)
10. [Runbook Index](#10-runbook-index)

---

## 1. What Is a Runbook

A runbook is a step-by-step procedure for a specific operational task. It tells the reader exactly what to do, what to expect at each step, and what to do if something goes wrong.

### What a Runbook Is NOT

```
WRONG: "If the API is slow, check the database and maybe restart things"
  → Vague, no specific commands, no expected outputs
  → Useless at 3 AM when you're half asleep

CORRECT: Step-by-step with exact commands, expected outputs,
  and decision points
  → "Run `docker stats api` — if CPU > 90%, proceed to step 3"
  → "Run `psql -c 'SELECT count(*) FROM pg_stat_activity'` — if > 100, see Troubleshooting"
```

### The Audience

Write for the least experienced person who might run this procedure:
- Possibly a junior engineer
- Possibly someone from another team covering on-call
- Possibly you, 6 months from now, having forgotten everything
- Definitely someone who is stressed because something is broken

---

## 2. When to Write One

### Must Have Runbooks

| Procedure | Why |
|---|---|
| Deploy to production | Must be repeatable and safe |
| Rollback a deploy | Time-critical during incidents |
| Respond to a production incident | Can't improvise under pressure |
| Database migration (manual) | Data loss risk |
| Scale up/down infrastructure | Must be fast during traffic spikes |
| Rotate credentials/secrets | Security-critical, can lock everyone out |

### Should Have Runbooks

| Procedure | Why |
|---|---|
| Onboard new developer | Reduces bus factor |
| Set up monitoring/alerts | Must be consistent across services |
| Restore from backup | Must be tested before you need it |
| SSL certificate renewal | Prevents surprise outages |
| Data export/migration | One-off but complex |

### Rule of Thumb

```
If any of these are true, write a runbook:
  - The procedure has more than 5 steps
  - The procedure involves production data
  - The procedure is time-critical (incident, deploy)
  - The procedure is done by someone other than the creator
  - You've done it twice and expect to do it again
```

---

## 3. Runbook Structure

Every runbook follows this structure:

```markdown
# Runbook: [Procedure Name]

**Last tested:** [Date]
**Owner:** [Team/Person]
**Estimated time:** [Duration]
**Risk level:** Low / Medium / High / Critical

## Purpose

One sentence: when and why to use this runbook.

## Prerequisites

- [ ] Access to [system/tool]
- [ ] Credential: [where to find it]
- [ ] Tool: [name] version [X]+

## Steps

### 1. [Action verb] [what]

```bash
[exact command]
```

**Expected output:**
```
[what you should see]
```

**If unexpected:** [what to do]

### 2. [Next step]

...

## Verification

How to confirm the procedure succeeded.

```bash
[verification command]
```

**Expected:** [what success looks like]

## Rollback

How to undo everything if something went wrong.

## Troubleshooting

### [Common issue 1]

**Symptom:** [what you see]
**Cause:** [why it happens]
**Fix:**
```bash
[exact fix command]
```
```

### Writing Rules for Runbooks

```
1. EVERY step has an exact command (no "configure the service")
2. EVERY command has expected output (so the reader knows it worked)
3. EVERY step has a failure mode (what to do if it doesn't work)
4. Use copy-pasteable commands (no placeholders the reader has to guess)
5. Number every step (so you can say "go to step 5" in troubleshooting)
6. Include time estimates per step and total
```

```
WRONG:
  "Check the database and restart it if needed"

CORRECT:
  ### 3. Check database connection count

  ```bash
  docker exec postgres psql -U app -c "SELECT count(*) FROM pg_stat_activity;"
  ```

  **Expected:** Count < 100

  **If count > 100:**
  ```bash
  docker exec postgres psql -U app -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE state = 'idle'
    AND query_start < now() - interval '10 minutes';
  "
  ```
  Then re-check the count. If still > 100, proceed to step 4 (restart).
```

---

## 4. Deploy Runbook Template

```markdown
# Runbook: Deploy to Production

**Last tested:** 2024-03-10
**Owner:** Platform Team
**Estimated time:** 15-20 minutes
**Risk level:** Medium

## Purpose

Deploy a new version of the application to production.
Use this for regular releases (hotfixes use the Hotfix runbook).

## Prerequisites

- [ ] All CI checks pass on the `main` branch
- [ ] QA sign-off on staging (link to checklist)
- [ ] No active incidents (check #incidents Slack channel)
- [ ] SSH access to deploy server (or CI/CD permissions)

## Pre-Deploy Checks

### 1. Verify staging is healthy

```bash
curl -s https://staging.example.com/health | jq .
```

**Expected:**
```json
{"status": "ok", "version": "2.3.0", "database": "ok", "cache": "ok"}
```

### 2. Check current production version

```bash
curl -s https://api.example.com/health | jq .version
```

**Note:** Record this version for rollback: `______`

### 3. Check for pending database migrations

```bash
ssh deploy@prod "cd /app && php artisan migrate:status | grep -c 'No'"
```

**Expected:** `0` (no pending migrations). If > 0, see "Database Migration" section below.

## Deploy Steps

### 4. Start the deploy

```bash
# Using deploy script
ssh deploy@prod "cd /app && ./deploy.sh v2.4.0"

# Or if using Docker
ssh deploy@prod "cd /app && docker compose pull && docker compose up -d"
```

**Expected output:**
```
Pulling api ... done
Pulling worker ... done
Recreating app_api_1 ... done
Recreating app_worker_1 ... done
```

**Estimated time:** 2-3 minutes

### 5. Run database migrations (if any)

```bash
ssh deploy@prod "cd /app && php artisan migrate --force"
```

**Expected:** List of migrations applied, or "Nothing to migrate."

### 6. Clear caches

```bash
ssh deploy@prod "cd /app && php artisan cache:clear && php artisan config:cache"
```

## Verification

### 7. Check application health

```bash
curl -s https://api.example.com/health | jq .
```

**Expected:**
```json
{"status": "ok", "version": "2.4.0", "database": "ok", "cache": "ok"}
```

### 8. Check error rate

Open [Grafana dashboard](https://grafana.example.com/d/api-overview)
and verify error rate is not increasing. Wait 5 minutes.

### 9. Smoke test critical paths

```bash
# Test auth
curl -s -o /dev/null -w "%{http_code}" https://api.example.com/v2/auth/health
# Expected: 200

# Test main endpoint
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEST_TOKEN" \
  https://api.example.com/v2/users/me
# Expected: 200
```

## Post-Deploy

### 10. Announce the deploy

```
Post in #deploys:
  "Deployed v2.4.0 to production. Health: OK. Monitoring for 30 min."
```

### 11. Monitor for 30 minutes

Keep the Grafana dashboard open. Watch for:
- Error rate spike (> 1%)
- Latency increase (p99 > 2x baseline)
- Queue backlog growing

## Rollback

If any verification step fails:

### Quick rollback (< 2 minutes)

```bash
ssh deploy@prod "cd /app && ./deploy.sh v2.3.0"  # previous version
```

### Database rollback (if migration was applied)

```bash
ssh deploy@prod "cd /app && php artisan migrate:rollback --step=1"
```

**CAUTION:** Only rollback migrations that are safely reversible.
Check the migration file's `down()` method before running.

## Troubleshooting

### Deploy fails with "port already in use"

```bash
ssh deploy@prod "lsof -ti:8080 | xargs kill -9"
# Then retry from step 4
```

### Health check returns unhealthy after deploy

Wait 60 seconds (cold start). If still unhealthy:
```bash
ssh deploy@prod "docker logs app_api_1 --tail 50"
```
Look for error messages. Common causes:
- Missing environment variable → check `.env`
- Database connection failed → check `DATABASE_URL`
- Redis connection failed → check `REDIS_URL`
```

---

## 5. Incident Response Runbook Template

```markdown
# Runbook: API Error Rate Spike

**Last tested:** 2024-03-01
**Owner:** Platform Team
**Estimated time:** 15-60 minutes (varies by cause)
**Risk level:** High
**Alert:** `api_error_rate > 5% for 5 minutes`

## Purpose

Investigate and resolve API error rate spikes above 5%.

## Immediate Actions (first 5 minutes)

### 1. Acknowledge the alert

Claim the incident in PagerDuty / Slack #incidents.

### 2. Check scope

```bash
# Which endpoints are erroring?
curl -s "https://grafana.example.com/api/ds/query" \
  --data '{"queries":[{"expr":"topk(10, rate(http_requests_total{status=~\"5..\"}[5m]))"}]}' \
  | jq '.results[].frames[].schema.name'
```

**Or:** Open [Error Rate by Endpoint](https://grafana.example.com/d/errors-by-endpoint) dashboard.

### 3. Check recent deploys

```bash
# Was there a deploy in the last hour?
git log --oneline --since="1 hour ago" origin/main
```

**If yes:** Consider immediate rollback (see Deploy Runbook > Rollback).

### 4. Check dependencies

```bash
# Database
curl -s https://api.example.com/health | jq .database
# Expected: "ok"

# Redis
curl -s https://api.example.com/health | jq .cache
# Expected: "ok"

# External APIs
curl -s -o /dev/null -w "%{http_code}" https://external-api.example.com/health
# Expected: 200
```

## Investigation

### 5. Check application logs

```bash
# Last 100 error logs
ssh deploy@prod "docker logs app_api_1 --since 10m 2>&1 | grep -i error | tail -100"

# Group errors by message
ssh deploy@prod "docker logs app_api_1 --since 10m 2>&1 | grep -i error \
  | awk -F'message=' '{print \$2}' | sort | uniq -c | sort -rn | head 10"
```

### 6. Check resource usage

```bash
ssh deploy@prod "docker stats --no-stream"
```

| Metric | Normal | Concerning | Critical |
|---|---|---|---|
| CPU | < 60% | 60-85% | > 85% |
| Memory | < 70% | 70-90% | > 90% |
| Disk | < 75% | 75-90% | > 90% |

## Resolution Paths

### If: Database connection errors
→ See [Database Connection Runbook](./database-connection.md)

### If: Memory exhaustion (OOM)
```bash
ssh deploy@prod "docker compose restart api"
```
Then investigate the memory leak (check recent code changes).

### If: External API failure
Enable circuit breaker (if available):
```bash
ssh deploy@prod "cd /app && php artisan feature:enable circuit-breaker-external-api"
```

### If: Unknown cause but rolling back fixes it
```bash
# Rollback
ssh deploy@prod "cd /app && ./deploy.sh $PREVIOUS_VERSION"
```
Then investigate the diff between versions.

## Post-Incident

- [ ] Update incident timeline in #incidents
- [ ] Write post-mortem within 48 hours
- [ ] Create tickets for follow-up actions
- [ ] Update this runbook if the resolution wasn't covered
```

---

## 6. Database Maintenance Runbook Template

```markdown
# Runbook: Database Maintenance

**Last tested:** 2024-02-15
**Owner:** Platform Team
**Estimated time:** 30-60 minutes
**Risk level:** High
**Schedule:** Monthly, during low-traffic window (Sunday 03:00-05:00 UTC)

## Purpose

Routine database maintenance: vacuum, reindex, check bloat, and verify backups.

## Prerequisites

- [ ] Maintenance window announced 24h in advance (#ops channel)
- [ ] Recent backup verified (step 1 below)
- [ ] SSH access to database server

## Steps

### 1. Verify latest backup

```bash
# Check backup age
ls -la /backups/postgres/ | tail -5
```

**Expected:** Most recent backup < 24 hours old.

**If no recent backup:**
```bash
pg_dump -Fc -h localhost -U app mydb > /backups/postgres/mydb_$(date +%Y%m%d_%H%M).dump
```
**DO NOT proceed without a verified backup.**

### 2. Check table bloat

```bash
psql -U app -d mydb -c "
  SELECT schemaname, tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) -
      pg_relation_size(schemaname||'.'||tablename)) as bloat_estimate
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  LIMIT 20;
"
```

### 3. Run VACUUM ANALYZE on bloated tables

```bash
# For each table with significant bloat:
psql -U app -d mydb -c "VACUUM (VERBOSE, ANALYZE) users;"
psql -U app -d mydb -c "VACUUM (VERBOSE, ANALYZE) orders;"
psql -U app -d mydb -c "VACUUM (VERBOSE, ANALYZE) events;"
```

**Estimated time:** 5-15 minutes per large table.

### 4. Reindex if needed

```bash
# Check index bloat
psql -U app -d mydb -c "
  SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) as size
  FROM pg_stat_user_indexes
  ORDER BY pg_relation_size(indexrelid) DESC
  LIMIT 20;
"

# Reindex concurrently (doesn't lock the table)
psql -U app -d mydb -c "REINDEX INDEX CONCURRENTLY idx_users_email;"
```

### 5. Check slow queries

```bash
psql -U app -d mydb -c "
  SELECT query, calls, mean_exec_time::int as avg_ms,
    total_exec_time::int as total_ms
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"
```

**Action:** If any query > 1000ms avg, create a ticket for optimization.

## Verification

### 6. Verify database health

```bash
psql -U app -d mydb -c "SELECT 1 as health_check;"
curl -s https://api.example.com/health | jq .database
```

**Expected:** "ok"

## Rollback

If database becomes unresponsive during maintenance:
```bash
# Cancel running vacuum/reindex
psql -U app -d mydb -c "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE 'VACUUM%' OR query LIKE 'REINDEX%';"
```

If data corruption suspected:
```bash
# Restore from backup (DESTRUCTIVE — only as last resort)
pg_restore -Fc -h localhost -U app -d mydb_restored /backups/postgres/mydb_LATEST.dump
```
```

---

## 7. Service Restart and Recovery Template

```markdown
# Runbook: Service Restart / Recovery

**Last tested:** 2024-03-05
**Owner:** Platform Team
**Estimated time:** 5-15 minutes
**Risk level:** Medium

## Purpose

Restart a service that is unresponsive or degraded.
Use this when the service is not recovering on its own.

## Prerequisites

- [ ] Verified this isn't a wider infrastructure issue (check other services)
- [ ] Checked that a deploy isn't in progress

## Steps

### 1. Identify the unhealthy service

```bash
ssh deploy@prod "docker compose ps"
```

**Look for:** "unhealthy" status, "restarting" loop, or "exited" state.

### 2. Check logs before restarting

```bash
# Last 50 lines of logs (to understand WHY it's unhealthy)
ssh deploy@prod "docker logs app_api_1 --tail 50"
```

**Save this output** — you'll need it for the post-mortem.

### 3. Graceful restart

```bash
ssh deploy@prod "docker compose restart api"
```

**Wait 30 seconds, then check:**
```bash
ssh deploy@prod "docker compose ps api"
curl -s https://api.example.com/health | jq .
```

**Expected:** Service shows "healthy", health check returns "ok".

### 4. If graceful restart fails — force restart

```bash
ssh deploy@prod "docker compose stop api && docker compose up -d api"
```

### 5. If force restart fails — full stack restart

```bash
ssh deploy@prod "docker compose down && docker compose up -d"
```

**CAUTION:** This restarts ALL services. Do this only if individual restart failed.

## Verification

```bash
# Health check
curl -s https://api.example.com/health | jq .

# Check error rate is returning to normal
# Open Grafana dashboard and monitor for 5 minutes
```

## Post-Recovery

- [ ] Post in #incidents: "Service [name] restarted at [time]. Cause: [brief]"
- [ ] Create a ticket to investigate root cause
- [ ] If this is the 3rd+ restart this month, escalate to a proper fix
```

---

## 8. Runbook Testing

### 8.1 Why Test Runbooks

```
WRONG: Write the runbook, file it, never look at it again
  → 6 months later, during an actual incident:
  → "Step 3 fails because we changed the server name 4 months ago"
  → "The command in step 7 requires a tool we uninstalled"

CORRECT: Test runbooks regularly
  → Run through every runbook at least once per quarter
  → Record what breaks and update the runbook
  → Ideally, have someone OTHER than the author test it
```

### 8.2 Testing Schedule

| Runbook | Test Frequency | Test Environment |
|---|---|---|
| Deploy | Every 2 weeks (it runs every deploy) | Production (the real thing) |
| Rollback | Monthly (in staging) | Staging |
| Incident response | Quarterly (game day) | Staging or shadow |
| Database maintenance | After every significant schema change | Staging |
| Backup restore | Quarterly | Separate test environment |

### 8.3 Game Day Testing

Run a simulated incident to test runbooks under pressure:

```
1. Schedule a game day (2-hour window)
2. One person plays "chaos monkey" (injects failures)
3. On-call person uses runbooks to recover
4. Observer takes notes: what worked, what didn't
5. After: update runbooks with lessons learned
```

---

## 9. Automating Runbooks

### 9.1 The Automation Ladder

```
Level 0: No runbook (tribal knowledge)
  → Write the runbook

Level 1: Manual runbook (copy-paste commands)
  → This is where most teams are

Level 2: Semi-automated (script + manual decisions)
  → Turn the commands into a script with prompts

Level 3: Fully automated (triggered by alerts)
  → Script runs automatically, humans verify after
```

### 9.2 From Manual to Script

```bash
#!/bin/bash
# deploy.sh — semi-automated deploy runbook
set -euo pipefail

VERSION=${1:?Usage: ./deploy.sh <version>}

echo "=== Pre-deploy checks ==="

echo "Checking staging health..."
STAGING_STATUS=$(curl -sf https://staging.example.com/health | jq -r .status)
if [ "$STAGING_STATUS" != "ok" ]; then
  echo "ERROR: Staging is unhealthy. Fix staging before deploying."
  exit 1
fi

echo "Checking for active incidents..."
# Could query PagerDuty API here

echo "Current production version:"
CURRENT=$(curl -sf https://api.example.com/health | jq -r .version)
echo "  $CURRENT -> $VERSION"

read -p "Proceed with deploy? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Deploy cancelled."
  exit 0
fi

echo "=== Deploying $VERSION ==="
ssh deploy@prod "cd /app && ./deploy.sh $VERSION"

echo "=== Running migrations ==="
ssh deploy@prod "cd /app && php artisan migrate --force"

echo "=== Verification ==="
sleep 10
NEW_VERSION=$(curl -sf https://api.example.com/health | jq -r .version)
if [ "$NEW_VERSION" != "$VERSION" ]; then
  echo "ERROR: Expected $VERSION but got $NEW_VERSION"
  echo "Consider rolling back: ./deploy.sh $CURRENT"
  exit 1
fi

echo "Deploy successful: $VERSION"
echo "Monitor Grafana for 30 minutes: https://grafana.example.com/d/api-overview"
```

### 9.3 When NOT to Automate

```
Don't automate:
  - Procedures you run less than once a quarter (not worth the maintenance)
  - Procedures with many judgment calls ("is this error rate acceptable?")
  - Disaster recovery (too many unknowns — keep it manual with a checklist)

Do automate:
  - Procedures you run weekly or more often
  - Procedures that are pure commands with known expected outputs
  - Health checks and verification steps
```

---

## 10. Runbook Index

Every team should maintain a central index of all runbooks.

### 10.1 Template

```markdown
# Runbook Index

Last updated: 2024-03-15

## Deployment

| Runbook | File | Owner | Last Tested |
|---|---|---|---|
| Deploy to production | [deploy.md](runbooks/deploy.md) | Platform | 2024-03-10 |
| Deploy hotfix | [hotfix.md](runbooks/hotfix.md) | Platform | 2024-02-28 |
| Rollback production | [rollback.md](runbooks/rollback.md) | Platform | 2024-03-01 |

## Incident Response

| Runbook | File | Owner | Last Tested |
|---|---|---|---|
| API error rate spike | [api-errors.md](runbooks/api-errors.md) | Platform | 2024-03-01 |
| Database connection issues | [db-connection.md](runbooks/db-connection.md) | Platform | 2024-02-15 |
| High memory usage | [high-memory.md](runbooks/high-memory.md) | Platform | 2024-02-15 |

## Database

| Runbook | File | Owner | Last Tested |
|---|---|---|---|
| Monthly maintenance | [db-maintenance.md](runbooks/db-maintenance.md) | Platform | 2024-03-03 |
| Backup and restore | [db-backup.md](runbooks/db-backup.md) | Platform | 2024-02-01 |
| Emergency failover | [db-failover.md](runbooks/db-failover.md) | Platform | 2024-01-15 |

## Infrastructure

| Runbook | File | Owner | Last Tested |
|---|---|---|---|
| SSL certificate renewal | [ssl-renewal.md](runbooks/ssl-renewal.md) | Platform | 2024-02-20 |
| Scale up/down | [scaling.md](runbooks/scaling.md) | Platform | 2024-03-05 |
| Rotate secrets | [rotate-secrets.md](runbooks/rotate-secrets.md) | Platform | 2024-01-30 |
```

### 10.2 Runbook Review Process

```
Monthly:
  - Review the index: are all runbooks listed?
  - Check "last tested" dates: flag any > 3 months old
  - After incidents: did the runbook help? What was missing?

Quarterly:
  - Game day: run through critical runbooks
  - Remove obsolete runbooks (services decommissioned, etc.)
  - Identify gaps: are there procedures without runbooks?
```

---

## Quick Reference: Runbook Quality Checklist

```
For every runbook:
  [ ] Title clearly identifies the procedure
  [ ] Purpose says WHEN to use it (not just what it does)
  [ ] Prerequisites are complete (access, tools, credentials)
  [ ] Every step has an exact command (copy-pasteable)
  [ ] Every command has expected output
  [ ] Every step has failure handling ("if this fails, do X")
  [ ] Verification section confirms success
  [ ] Rollback section exists and is tested
  [ ] Troubleshooting covers known failure modes
  [ ] Last tested date is < 3 months ago
  [ ] Owner is specified and still on the team
```
