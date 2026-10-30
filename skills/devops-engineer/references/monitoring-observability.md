# Monitoring & Observability

Three pillars of observability: metrics, logs, traces. Practical setup for small-to-medium teams using Prometheus, Grafana, Loki, Sentry, and cost-effective alternatives.

---

## Table of Contents

1. [Three Pillars Overview](#1-three-pillars-overview)
2. [Prometheus + Grafana Setup](#2-prometheus--grafana-setup)
3. [Application Metrics (RED Method)](#3-application-metrics-red-method)
4. [System Metrics](#4-system-metrics)
5. [Structured Logging](#5-structured-logging)
6. [Log Aggregation](#6-log-aggregation)
7. [Error Tracking with Sentry](#7-error-tracking-with-sentry)
8. [Uptime Monitoring](#8-uptime-monitoring)
9. [Alerting Strategies](#9-alerting-strategies)
10. [Laravel-Specific Monitoring](#10-laravel-specific-monitoring)
11. [Health Check Endpoints](#11-health-check-endpoints)
12. [Dashboard Design](#12-dashboard-design)
13. [Distributed Tracing with OpenTelemetry](#13-distributed-tracing-with-opentelemetry)
14. [Cost-Effective Monitoring for Small Teams](#14-cost-effective-monitoring-for-small-teams)

---

## 1. Three Pillars Overview

| Pillar | What | Tools | Priority |
|---|---|---|---|
| **Logs** | What happened (events, errors, context) | Loki, Better Stack, stdout | 1st — debug anything |
| **Metrics** | How much / how fast (counters, gauges, histograms) | Prometheus, Grafana | 2nd — spot trends |
| **Traces** | Where time was spent (request path across services) | OpenTelemetry, Jaeger | 3rd — when you have multiple services |

**For most teams:** start with structured logs + basic metrics + error tracking (Sentry). Add tracing only when you have 3+ services and need to debug cross-service latency.

```
# Priority order of investment:
# 1. Structured JSON logs → immediate debugging value
# 2. Sentry error tracking → catch exceptions before users report
# 3. Uptime monitoring → know when you're down before customers
# 4. Prometheus + Grafana → visualize trends, set metric alerts
# 5. Loki log aggregation → search logs across all services
# 6. OpenTelemetry traces → debug cross-service latency (only if needed)
```

---

## 2. Prometheus + Grafana Setup

### 2.1 Docker Compose Stack

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus:v3.2
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
      - '--storage.tsdb.retention.size=10GB'
      - '--web.enable-lifecycle'           # allows config reload via API
    ports:
      - "127.0.0.1:9090:9090"             # localhost only — behind reverse proxy
    restart: unless-stopped

  grafana:
    image: grafana/grafana:11.5
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-changeme}
      - GF_SERVER_ROOT_URL=https://grafana.myapp.com
      - GF_USERS_ALLOW_SIGN_UP=false
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - prometheus
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:v1.9
    command:
      - '--path.rootfs=/host'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    pid: host
    volumes:
      - '/:/host:ro,rslave'
    restart: unless-stopped

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.51
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
```

### 2.2 Prometheus Configuration

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - 'alerts.yml'

scrape_configs:
  # Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # Node Exporter — system metrics
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  # cAdvisor — container metrics
  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']

  # Your application
  - job_name: 'app'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['app:8080']

  # Multiple app instances
  - job_name: 'app-cluster'
    static_configs:
      - targets:
          - 'app-1:8080'
          - 'app-2:8080'
          - 'app-3:8080'
```

### 2.3 Grafana Auto-Provisioning

```yaml
# monitoring/grafana/provisioning/datasources/datasources.yml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
```

---

## 3. Application Metrics (RED Method)

The RED method covers the three most important signals for any service:

| Signal | What | Prometheus Type | Example |
|---|---|---|---|
| **R**ate | Requests per second | Counter | `http_requests_total` |
| **E**rrors | Failed requests per second | Counter | `http_requests_total{status="5xx"}` |
| **D**uration | Latency distribution | Histogram | `http_request_duration_seconds` |

### 3.1 Go Application Metrics

```go
package main

import (
    "net/http"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
    httpRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "path", "status"},
    )

    httpRequestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request duration in seconds",
            Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
        },
        []string{"method", "path"},
    )

    activeConnections = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "http_active_connections",
            Help: "Number of active HTTP connections",
        },
    )
)

func init() {
    prometheus.MustRegister(httpRequestsTotal, httpRequestDuration, activeConnections)
}

// Middleware that records RED metrics
func metricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        activeConnections.Inc()
        defer activeConnections.Dec()

        rec := &statusRecorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rec, r)

        duration := time.Since(start).Seconds()
        statusGroup := fmt.Sprintf("%dxx", rec.status/100)

        httpRequestsTotal.WithLabelValues(r.Method, r.URL.Path, statusGroup).Inc()
        httpRequestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
    })
}

func main() {
    mux := http.NewServeMux()
    mux.Handle("GET /metrics", promhttp.Handler())
    // ... your routes
    http.ListenAndServe(":8080", metricsMiddleware(mux))
}
```

### 3.2 Node.js Application Metrics

```javascript
// metrics.js
import client from 'prom-client';

// Default system metrics (CPU, memory, event loop)
client.collectDefaultMetrics({ prefix: 'app_' });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'path'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Express middleware
export function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const statusGroup = `${Math.floor(res.statusCode / 100)}xx`;
    httpRequestsTotal.inc({ method: req.method, path: req.route?.path || req.path, status: statusGroup });
    httpRequestDuration.observe({ method: req.method, path: req.route?.path || req.path }, duration);
  });
  next();
}

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

### 3.3 Useful Custom Metrics

```go
// Business metrics — these tell you if the product works, not just the server
var (
    ordersProcessed = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "orders_processed_total",
            Help: "Total orders processed",
        },
        []string{"status"}, // "success", "failed", "refunded"
    )

    queueDepth = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "queue_depth",
            Help: "Number of jobs waiting in queue",
        },
        []string{"queue_name"},
    )

    externalAPILatency = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "external_api_duration_seconds",
            Help:    "External API call duration",
            Buckets: prometheus.DefBuckets,
        },
        []string{"service"}, // "stripe", "sendgrid", "s3"
    )
)
```

### 3.4 Metric Label Pitfalls

```go
// WRONG: high cardinality labels — Prometheus will run out of memory
httpRequestsTotal.WithLabelValues(r.Method, r.URL.Path, statusCode)
// If path includes IDs: /users/123, /users/456 → millions of time series

// CORRECT: normalize paths to route patterns
httpRequestsTotal.WithLabelValues(r.Method, routePattern, statusGroup)
// /users/{id} → one time series, not millions

// WRONG: user IDs as labels
requestsByUser.WithLabelValues(userID)  // 100k users = 100k time series

// CORRECT: count total, use logs to investigate per-user
requestsTotal.Inc()
// Log user_id for debugging, don't metric it
```

---

## 4. System Metrics

### 4.1 Key System Metrics to Monitor

| Metric | Source | Alert When |
|---|---|---|
| CPU usage | node-exporter | > 80% for 5 min |
| Memory usage | node-exporter | > 85% |
| Disk usage | node-exporter | > 80% |
| Disk I/O wait | node-exporter | > 20% |
| Network errors | node-exporter | Any increase |
| Container restarts | cadvisor | > 0 in 5 min |
| Container memory | cadvisor | > 90% of limit |
| Container CPU throttle | cadvisor | Sustained throttling |

### 4.2 Alert Rules

```yaml
# monitoring/alerts.yml
groups:
  - name: system
    rules:
      - alert: HighCPU
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage on {{ $labels.instance }}"
          description: "CPU usage is {{ $value }}% for more than 5 minutes"

      - alert: HighMemory
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"

      - alert: DiskSpaceLow
        expr: (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) * 100 > 80
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disk usage above 80% on {{ $labels.instance }}: {{ $labels.mountpoint }}"

      - alert: DiskSpaceCritical
        expr: (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) * 100 > 95
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "CRITICAL: Disk almost full on {{ $labels.instance }}"

  - name: application
    rules:
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status="5xx"}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate above 5%"

      - alert: HighLatency
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency above 2 seconds"

      - alert: ContainerRestarting
        expr: increase(kube_pod_container_status_restarts_total[1h]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.container }} restarting frequently"

  - name: service
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"

      - alert: QueueBacklog
        expr: queue_depth > 1000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Queue {{ $labels.queue_name }} has {{ $value }} pending jobs"
```

---

## 5. Structured Logging

### 5.1 JSON Logging Format

```json
// WRONG: unstructured text logs
"[2026-04-11 10:30:00] ERROR: Payment failed for user 123, amount: $49.99, error: card declined"

// CORRECT: structured JSON (parseable, searchable, indexable)
{
  "timestamp": "2026-04-11T10:30:00.123Z",
  "level": "error",
  "msg": "payment failed",
  "service": "billing",
  "user_id": 123,
  "amount": 49.99,
  "currency": "USD",
  "error": "card_declined",
  "stripe_request_id": "req_abc123",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "request_id": "req-uuid-here"
}
```

### 5.2 Log Levels

| Level | When | Example |
|---|---|---|
| `error` | Something failed that needs attention | Payment failed, DB connection lost |
| `warn` | Degraded but working, or will be a problem soon | Disk at 80%, retry succeeded, deprecated API used |
| `info` | Normal operation milestones | Server started, user registered, deploy completed |
| `debug` | Developer detail for debugging | SQL queries, cache hits/misses, request bodies |

```bash
# WRONG: everything is INFO or ERROR
logger.info("Starting payment process")
logger.info("Payment succeeded")
logger.error("Payment failed")    # not all failures are errors (e.g., invalid card)
logger.info("Cache miss")         # this is debug, not info

# CORRECT: appropriate levels
logger.info("payment.started", user_id=123)
logger.info("payment.succeeded", user_id=123, amount=49.99)
logger.warn("payment.declined", user_id=123, reason="insufficient_funds")  # expected failure
logger.error("payment.failed", user_id=123, error="stripe_api_timeout")     # unexpected failure
logger.debug("cache.miss", key="user:123:profile")
```

### 5.3 Correlation IDs

Track a request across all log entries:

```go
// Go middleware — inject request ID into context and logs
func requestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestID := r.Header.Get("X-Request-ID")
        if requestID == "" {
            requestID = uuid.NewString()
        }
        ctx := context.WithValue(r.Context(), "request_id", requestID)
        w.Header().Set("X-Request-ID", requestID)

        // Add to structured logger
        logger := slog.With("request_id", requestID)
        ctx = context.WithValue(ctx, "logger", logger)

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

```php
// Laravel — add request ID to all log entries
// app/Http/Middleware/RequestId.php
class RequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $requestId = $request->header('X-Request-ID', (string) Str::uuid());
        $request->headers->set('X-Request-ID', $requestId);

        Log::shareContext(['request_id' => $requestId]);

        $response = $next($request);
        $response->headers->set('X-Request-ID', $requestId);

        return $response;
    }
}
```

### 5.4 Docker Logging Configuration

```yaml
# docker-compose.yml — consistent logging across all services
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "50m"    # rotate at 50MB
        max-file: "5"      # keep 5 rotated files
        tag: "{{.Name}}"   # tag with container name

# WRONG: no log rotation — disk fills up
services:
  app:
    logging:
      driver: json-file
      # no options = unlimited log growth!
```

---

## 6. Log Aggregation

### 6.1 Loki + Grafana (Self-Hosted)

Loki is like Prometheus but for logs — lightweight, label-based, integrates with Grafana.

```yaml
# docker-compose.monitoring.yml (add to existing stack)
services:
  loki:
    image: grafana/loki:3.4
    volumes:
      - ./monitoring/loki-config.yml:/etc/loki/local-config.yaml:ro
      - loki_data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    ports:
      - "127.0.0.1:3100:3100"
    restart: unless-stopped

  promtail:
    image: grafana/promtail:3.4
    volumes:
      - ./monitoring/promtail-config.yml:/etc/promtail/config.yml:ro
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    command: -config.file=/etc/promtail/config.yml
    restart: unless-stopped

volumes:
  loki_data:
```

```yaml
# monitoring/loki-config.yml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  retention_period: 30d

compactor:
  working_directory: /loki/compactor
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
```

```yaml
# monitoring/promtail-config.yml
server:
  http_listen_port: 9080

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # Docker container logs
  - job_name: docker
    static_configs:
      - targets:
          - localhost
        labels:
          job: docker
          __path__: /var/lib/docker/containers/*/*-json.log
    pipeline_stages:
      - docker: {}
      - json:
          expressions:
            level: level
            msg: msg
            service: service
      - labels:
          level:
          service:
```

### 6.2 Better Stack / Logtail (Managed)

For teams that don't want to self-host log infrastructure:

```bash
# Install vector (log shipper) — lighter than Promtail
curl --proto '=https' --tlsv1.2 -sSfL https://sh.vector.dev | bash

# /etc/vector/vector.toml
[sources.docker_logs]
type = "docker_logs"

[transforms.parse_json]
type = "remap"
inputs = ["docker_logs"]
source = '''
. = parse_json!(.message)
.container = del(.container_name)
'''

[sinks.betterstack]
type = "http"
inputs = ["parse_json"]
uri = "https://in.logs.betterstack.com"
encoding.codec = "json"
headers.Authorization = "Bearer ${LOGTAIL_SOURCE_TOKEN}"
```

```yaml
# Or via Docker Compose with Logtail
services:
  app:
    image: myapp:latest
    logging:
      driver: syslog
      options:
        syslog-address: "tcp+tls://in.logs.betterstack.com:6514"
        tag: "myapp-{{.Name}}"
        syslog-format: "rfc5424"
```

### 6.3 LogQL Examples (Querying Loki in Grafana)

```
# All error logs from the app service
{service="app"} |= "error"

# JSON parsing + filter
{service="app"} | json | level="error"

# Errors related to payments
{service="app"} | json | level="error" | msg=~"payment.*"

# Rate of errors per minute
sum(rate({service="app"} | json | level="error" [1m]))

# Top 10 error messages
topk(10, sum by(msg) (count_over_time({service="app"} | json | level="error" [1h])))

# Latency percentiles from access logs
quantile_over_time(0.95, {service="app"} | json | unwrap duration [5m]) by (path)
```

---

## 7. Error Tracking with Sentry

### 7.1 Setup

```bash
# Install SDK
npm install @sentry/node    # Node.js
pip install sentry-sdk       # Python
composer require sentry/sentry-laravel  # Laravel
go get github.com/getsentry/sentry-go   # Go
```

```javascript
// Node.js initialization
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV,   // 'production', 'staging'
  release: process.env.GIT_SHA,       // link errors to commits
  tracesSampleRate: 0.1,              // 10% of transactions for performance
  profilesSampleRate: 0.1,            // 10% profiling (Node 18+)

  // Don't send PII
  sendDefaultPii: false,

  // Filter noisy errors
  beforeSend(event) {
    // Don't report 404s
    if (event.exception?.values?.[0]?.type === 'NotFoundError') return null;
    // Don't report network errors from bots
    if (event.request?.headers?.['user-agent']?.includes('bot')) return null;
    return event;
  },
});
```

```php
// Laravel — config/sentry.php (after installing sentry-laravel)
return [
    'dsn' => env('SENTRY_DSN'),
    'environment' => env('APP_ENV', 'production'),
    'release' => env('SENTRY_RELEASE', trim(exec('git rev-parse --short HEAD'))),
    'traces_sample_rate' => (float) env('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    'send_default_pii' => false,
];
```

### 7.2 Source Maps for Frontend Errors

```yaml
# GitHub Actions — upload source maps on deploy
- name: Upload source maps to Sentry
  run: |
    npx @sentry/cli sourcemaps upload \
      --release=${{ github.sha }} \
      --org=myorg \
      --project=myapp-frontend \
      ./dist/assets
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

### 7.3 Sentry Alerts Configuration

```
# Alert rules (configure in Sentry UI or via API):

# 1. Critical: new error in production → Slack #alerts immediately
# 2. Warning: error rate > 10 events/hour → Slack #alerts
# 3. Info: regression (resolved error reappeared) → Slack #dev

# WRONG: alert on every single error
# → Alert fatigue, everyone ignores alerts within a week

# CORRECT: alert on new/regression errors and error rate spikes
# → Actionable alerts that mean "something changed, investigate"
```

---

## 8. Uptime Monitoring

### 8.1 UptimeRobot (Free Tier: 50 Monitors)

```
# Monitor configuration:
URL: https://myapp.com/health
Interval: 5 minutes
Alert contacts: Slack webhook, email
Keyword: "healthy" (check response body contains this)
```

### 8.2 Better Stack (Uptime + Logs in One)

```bash
# Status page + uptime monitoring
# Configure via dashboard:
# - HTTPS check: https://myapp.com/health
# - TCP check: myapp.com:5432 (database)
# - Heartbeat: expect ping from cron job every 5 min

# Heartbeat for cron job monitoring
# Add to end of cron job:
0 * * * * /usr/local/bin/backup.sh && curl -s https://uptime.betterstack.com/api/v1/heartbeat/abc123
```

### 8.3 Self-Hosted with Uptime Kuma

```yaml
# docker-compose.yml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    volumes:
      - uptime-kuma-data:/app/data
    ports:
      - "127.0.0.1:3001:3001"
    restart: unless-stopped

volumes:
  uptime-kuma-data:
```

---

## 9. Alerting Strategies

### 9.1 What to Alert On

```
# ALERT (wake someone up):
- Service is down (health check failing)
- Error rate > 5% for 5+ minutes
- P95 latency > 5x normal for 10+ minutes
- Disk > 95% full
- Database connection pool exhausted
- SSL certificate expires in < 7 days
- Backup job failed

# WARN (Slack channel, check next business day):
- Error rate > 1% for 15+ minutes
- P95 latency > 2x normal
- Disk > 80% full
- Memory > 85% for 15+ minutes
- Queue backlog growing for 30+ minutes
- Unusual traffic spike (> 3x normal)

# LOG ONLY (dashboard, investigate when convenient):
- Individual 5xx errors
- Slow queries > 1 second
- Cache miss rate increase
- Dependency latency increase
```

### 9.2 Avoiding Alert Fatigue

```yaml
# WRONG: alert on every error
- alert: AnyError
  expr: http_requests_total{status="5xx"} > 0
  for: 0m
  # Result: 50 alerts a day, everyone ignores them

# CORRECT: alert on error RATE exceeding threshold
- alert: HighErrorRate
  expr: sum(rate(http_requests_total{status="5xx"}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
  for: 5m
  # Result: only fires when > 5% of requests fail for 5+ minutes
```

```
# Alert hygiene rules:
# 1. Every alert MUST have a runbook or at least an action
# 2. If an alert fires and you do nothing → delete or fix threshold
# 3. Review alert history monthly — tune noisy alerts
# 4. Page-level alerts: max 1-2 per week or you have a problem
# 5. Slack alerts: max 5-10 per day or people stop reading
```

### 9.3 Alertmanager Configuration

```yaml
# monitoring/alertmanager.yml
global:
  slack_api_url: 'https://hooks.slack.com/services/T.../B.../xxx'
  resolve_timeout: 5m

route:
  receiver: 'slack-warnings'
  group_by: ['alertname', 'job']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      repeat_interval: 15m
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'slack-warnings'
    slack_configs:
      - channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
        send_resolved: true

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_KEY}'
```

---

## 10. Laravel-Specific Monitoring

### 10.1 Laravel Pulse (Built-in Dashboard)

```bash
composer require laravel/pulse
php artisan vendor:publish --provider="Laravel\Pulse\PulseServiceProvider"
php artisan migrate
```

```php
// config/pulse.php — configure recorders
'recorders' => [
    \Laravel\Pulse\Recorders\Requests::class => [
        'sample_rate' => 1,  // 100% in production (Pulse is lightweight)
    ],
    \Laravel\Pulse\Recorders\SlowQueries::class => [
        'threshold' => 500,  // ms — log queries slower than 500ms
    ],
    \Laravel\Pulse\Recorders\SlowJobs::class => [
        'threshold' => 10000,  // ms — jobs slower than 10s
    ],
    \Laravel\Pulse\Recorders\Exceptions::class => [],
    \Laravel\Pulse\Recorders\CacheInteractions::class => [
        'sample_rate' => 0.1,  // 10% sample for cache stats
    ],
],
```

```php
// routes/web.php — protect the dashboard
Route::middleware(['auth', 'can:viewPulse'])->get('/pulse', function () {
    return view('pulse::dashboard');
});
```

### 10.2 Laravel Telescope (Development)

```bash
# Install for local development only
composer require laravel/telescope --dev
php artisan telescope:install
php artisan migrate
```

```php
// app/Providers/TelescopeServiceProvider.php
public function register(): void
{
    // Only register in local environment
    if (! $this->app->isLocal()) {
        return;
    }

    $this->app->register(\Laravel\Telescope\TelescopeServiceProvider::class);
}
```

### 10.3 Horizon Dashboard (Queue Monitoring)

```bash
composer require laravel/horizon
php artisan horizon:install
```

```php
// Monitor queue health with Prometheus metrics
// Custom Horizon metrics exporter
Schedule::call(function () {
    $metrics = Horizon::getMetrics();
    // Push to Prometheus pushgateway
    // Or expose via /metrics endpoint
})->everyMinute();
```

---

## 11. Health Check Endpoints

### 11.1 Liveness vs Readiness

| Check | Purpose | Should Fail When | Used By |
|---|---|---|---|
| **Liveness** (`/healthz`) | "Is the process alive?" | Process is deadlocked or crashed | Container orchestrator (restart) |
| **Readiness** (`/readyz`) | "Can it handle requests?" | Dependencies unavailable | Load balancer (remove from pool) |

```go
// Go health check handlers
func livenessHandler(w http.ResponseWriter, r *http.Request) {
    // Liveness: just return 200 if the process is running
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func readinessHandler(w http.ResponseWriter, r *http.Request) {
    checks := map[string]string{}
    healthy := true

    // Check database
    if err := db.PingContext(r.Context()); err != nil {
        checks["database"] = "unhealthy: " + err.Error()
        healthy = false
    } else {
        checks["database"] = "healthy"
    }

    // Check Redis
    if err := redis.Ping(r.Context()).Err(); err != nil {
        checks["redis"] = "unhealthy: " + err.Error()
        healthy = false
    } else {
        checks["redis"] = "healthy"
    }

    checks["status"] = "ready"
    status := http.StatusOK
    if !healthy {
        checks["status"] = "not ready"
        status = http.StatusServiceUnavailable
    }

    w.WriteHeader(status)
    json.NewEncoder(w).Encode(checks)
}
```

### 11.2 Docker Compose Health Checks

```yaml
services:
  app:
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  db:
    image: postgres:17-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $POSTGRES_USER"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
```

---

## 12. Dashboard Design

### 12.1 Golden Signals Dashboard

Every service should have a dashboard with these four panels:

```
┌─────────────────────────────────────────────────────────────────┐
│ Service: myapp                                            [24h] │
├───────────────────────────────┬─────────────────────────────────┤
│ Request Rate (req/s)          │ Error Rate (%)                  │
│ ████████████▃▃▃▃▃▃▃▃         │ ▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁         │
│ avg: 120 req/s                │ current: 0.1% (target < 1%)    │
├───────────────────────────────┼─────────────────────────────────┤
│ Latency P50/P95/P99 (ms)     │ Saturation (CPU/Memory %)       │
│ P50: ▃▃▃▃▃▃▃▃ 45ms           │ CPU:  ████▃▃▃▃ 35%             │
│ P95: ▅▅▅▅▅▅▅▅ 200ms          │ Mem:  ██████▃▃ 60%             │
│ P99: ▇▇▇▇▇▇▇▇ 800ms          │ Disk: ███▃▃▃▃▃ 28%             │
└───────────────────────────────┴─────────────────────────────────┘
```

### 12.2 PromQL for Dashboard Panels

```promql
# Request rate
sum(rate(http_requests_total[5m]))

# Error rate percentage
sum(rate(http_requests_total{status="5xx"}[5m])) / sum(rate(http_requests_total[5m])) * 100

# Latency percentiles
histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# CPU usage
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Memory usage
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# Disk usage
(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100
```

### 12.3 SLIs and SLOs

```
# Define SLOs for your service:

# Availability SLO: 99.9% (43.8 min downtime/month)
SLI: percentage of successful health checks over 30 days
Error budget: 0.1% → ~43 minutes of downtime per month

# Latency SLO: P95 < 500ms
SLI: 95th percentile response time over 5-minute windows
Threshold: 500ms

# Error rate SLO: < 0.1% of requests return 5xx
SLI: ratio of 5xx responses to total responses

# PromQL for error budget remaining:
1 - (
  sum(rate(http_requests_total{status="5xx"}[30d]))
  / sum(rate(http_requests_total[30d]))
) / (1 - 0.999)
# Result: 1.0 = full budget, 0.0 = budget exhausted
```

---

## 13. Distributed Tracing with OpenTelemetry

### 13.1 When You Need Tracing

```
# You DON'T need tracing if:
- You have a monolith (logs + metrics are enough)
- You have < 3 services
- Your latency issues are obvious from metrics

# You DO need tracing if:
- Request crosses 3+ services
- "It's slow but we don't know where"
- Need to understand dependency chains
```

### 13.2 Basic OpenTelemetry Setup

```yaml
# docker-compose.monitoring.yml — add OTLP collector
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.116
    command: ["--config=/etc/otel-collector-config.yml"]
    volumes:
      - ./monitoring/otel-collector-config.yml:/etc/otel-collector-config.yml:ro
    ports:
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP
    restart: unless-stopped

  jaeger:
    image: jaegertracing/all-in-one:1.64
    ports:
      - "127.0.0.1:16686:16686"  # UI
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    restart: unless-stopped
```

```yaml
# monitoring/otel-collector-config.yml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
```

```go
// Go — basic OTEL instrumentation
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func initTracer() (*sdktrace.TracerProvider, error) {
    exporter, err := otlptracegrpc.New(context.Background(),
        otlptracegrpc.WithEndpoint("otel-collector:4317"),
        otlptracegrpc.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithSampler(sdktrace.TraceIDRatioBased(0.1)), // sample 10%
    )
    otel.SetTracerProvider(tp)
    return tp, nil
}
```

---

## 14. Cost-Effective Monitoring for Small Teams

### 14.1 Recommended Stack by Team Size

| Team Size | Stack | Monthly Cost |
|---|---|---|
| Solo / 2-3 devs | Sentry (free) + UptimeRobot (free) + `docker logs` | $0 |
| 3-5 devs | Above + Grafana Cloud free tier (metrics + logs) | $0-20 |
| 5-10 devs | Prometheus + Grafana + Loki (self-hosted) + Sentry (team) | $26/mo (Sentry) |
| 10+ devs | Above + Better Stack (managed logs) + PagerDuty | $100-300/mo |

### 14.2 Free Tier Maximization

```
# Grafana Cloud Free Tier (generous):
- 10,000 metrics series
- 50 GB logs
- 50 GB traces
- 3 users
# More than enough for most small projects

# Sentry Free Tier:
- 5,000 errors/month
- 10,000 performance transactions/month
- 1 GB attachments
# Sufficient for apps with < 100k MAU

# UptimeRobot Free Tier:
- 50 monitors
- 5-minute intervals
# Covers most small-medium projects
```

### 14.3 Minimal Monitoring Script (Zero Cost)

For a single VPS with budget constraints:

```bash
#!/bin/bash
# /usr/local/bin/health-check.sh — run via cron every 5 minutes
# Sends alerts to a Slack webhook or Telegram bot

SLACK_WEBHOOK="${SLACK_WEBHOOK_URL}"
HOSTNAME=$(hostname)

alert() {
    curl -s -X POST "$SLACK_WEBHOOK" \
        -H 'Content-type: application/json' \
        -d "{\"text\": \":rotating_light: [$HOSTNAME] $1\"}" > /dev/null
}

# Check disk usage
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
    alert "Disk usage: ${DISK_USAGE}%"
fi

# Check memory usage
MEM_USAGE=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_USAGE" -gt 90 ]; then
    alert "Memory usage: ${MEM_USAGE}%"
fi

# Check if app is responding
if ! curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    alert "App health check FAILED"
fi

# Check Docker containers
UNHEALTHY=$(docker ps --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null)
if [ -n "$UNHEALTHY" ]; then
    alert "Unhealthy containers: $UNHEALTHY"
fi
```

```bash
# Cron setup
echo "*/5 * * * * /usr/local/bin/health-check.sh" | crontab -
```
