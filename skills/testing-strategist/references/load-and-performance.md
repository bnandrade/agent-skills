# Load & Performance Testing

When to load test, which tools to use, how to set performance budgets, and identifying bottlenecks.

---

## Table of Contents

1. [When to Load Test](#1-when-to-load-test)
2. [Tools Comparison](#2-tools-comparison)
3. [k6 Practical Guide](#3-k6-practical-guide)
4. [Load Test Types](#4-load-test-types)
5. [What to Measure](#5-what-to-measure)
6. [Performance Budgets](#6-performance-budgets)
7. [Database Performance Testing](#7-database-performance-testing)
8. [Frontend Performance Testing](#8-frontend-performance-testing)
9. [Testing in CI](#9-testing-in-ci)
10. [Analyzing Results](#10-analyzing-results)
11. [Common Bottlenecks](#11-common-bottlenecks)

---

## 1. When to Load Test

### Always Load Test Before

```
CRITICAL (load test or regret it):
- Production launch — know your limits before users find them
- Marketing push / viral campaign — sudden traffic spike
- Architecture changes — new DB, new cache layer, new proxy
- Black Friday / seasonal peak — simulate the peak
- New pricing tier with higher usage limits — verify you can serve it

RECOMMENDED:
- After adding a new heavy endpoint (file upload, report generation)
- After changing database queries (new indexes, new joins)
- After scaling down infrastructure (cost optimization)
- After adding real-time features (WebSockets, SSE)
- Monthly baseline (detect gradual degradation)

SKIP:
- Internal tools with < 10 users
- Prototype / MVP (solve performance problems when you have them)
- Purely static sites (CDN handles it)
```

### The Cost of Not Load Testing

```
Scenario: E-commerce site, first Black Friday
  - No load testing
  - Peak traffic: 50x normal
  - Database connections exhausted at 10x
  - Site down for 4 hours during peak sales
  - Revenue loss: tens of thousands

Scenario: Same site, load tested
  - Discovered connection pool limit at 10x
  - Added connection pooler (PgBouncer)
  - Discovered N+1 query in product listing
  - Fixed before launch
  - Site handled 60x with 200ms p95
```

---

## 2. Tools Comparison

| Tool | Language | Protocol | Distributed | Best For |
|---|---|---|---|---|
| **k6** | JavaScript | HTTP, WS, gRPC | Yes (k6 Cloud) | API load testing, scriptable scenarios |
| **Artillery** | JavaScript/YAML | HTTP, WS, Socket.IO | Yes (self-hosted) | Quick setup, YAML config |
| **Locust** | Python | HTTP (any via plugin) | Yes (built-in) | Python teams, custom protocols |
| **wrk** | C (Lua scripts) | HTTP | No | Simple HTTP benchmarks |
| **Apache Bench (ab)** | C | HTTP | No | Quick single-endpoint tests |
| **Vegeta** | Go | HTTP | No | Constant rate testing, CLI-friendly |
| **Gatling** | Scala/Java | HTTP, WS, JMS | Yes | Enterprise, JVM teams |

### Quick Comparison

```
Need simple "how many req/s?" → wrk or ab
Need realistic user scenarios → k6 or Artillery
Need Python team adoption → Locust
Need JVM/enterprise support → Gatling
Need CI integration today → k6 (best CLI + thresholds)
```

### When to Use Which

| Situation | Tool | Why |
|---|---|---|
| API endpoint benchmark | wrk, ab | Fast, zero config |
| Realistic user journey | k6, Locust | Scriptable, multi-step |
| CI pipeline gate | k6 | Thresholds + exit codes |
| WebSocket testing | k6, Artillery | Native protocol support |
| Team knows Python | Locust | Low learning curve |
| Quick YAML config | Artillery | No JS needed for basics |

---

## 3. k6 Practical Guide

### Basic Script Structure

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuration
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp up to 20 VUs
    { duration: '1m', target: 20 },     // Stay at 20 VUs
    { duration: '10s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'],     // Less than 1% errors
  },
};

export default function () {
  // Simulate user behavior
  const res = http.get('https://api.example.com/products');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'body has products': (r) => JSON.parse(r.body).length > 0,
  });

  sleep(1); // Think time between requests
}
```

### Realistic User Scenario

```javascript
import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  scenarios: {
    browse_and_buy: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 50 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{name:checkout}': ['p(95)<1000'],  // Checkout < 1s
    'http_req_duration{name:listing}': ['p(95)<300'],    // Listing < 300ms
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://staging.example.com';

export default function () {
  group('Browse products', () => {
    const listing = http.get(`${BASE_URL}/api/products`, {
      tags: { name: 'listing' },
    });
    check(listing, { 'listing 200': (r) => r.status === 200 });

    const products = JSON.parse(listing.body);
    if (products.length > 0) {
      const product = products[Math.floor(Math.random() * products.length)];
      const detail = http.get(`${BASE_URL}/api/products/${product.id}`, {
        tags: { name: 'detail' },
      });
      check(detail, { 'detail 200': (r) => r.status === 200 });
    }

    sleep(2); // Browsing time
  });

  group('Add to cart and checkout', () => {
    const addToCart = http.post(`${BASE_URL}/api/cart`, JSON.stringify({
      product_id: 1,
      quantity: 1,
    }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'cart' } });
    check(addToCart, { 'cart 200': (r) => r.status === 200 });

    sleep(1);

    const checkout = http.post(`${BASE_URL}/api/checkout`, JSON.stringify({
      payment_method: 'test_card',
    }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'checkout' } });
    check(checkout, { 'checkout 2xx': (r) => r.status >= 200 && r.status < 300 });

    sleep(3); // Post-purchase browsing
  });
}
```

### k6 Thresholds (CI-Friendly)

```javascript
export const options = {
  thresholds: {
    // Response time
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1000'],

    // Error rate
    http_req_failed: ['rate<0.01'],  // Less than 1% errors

    // Per-endpoint thresholds
    'http_req_duration{name:login}': ['p(95)<300'],
    'http_req_duration{name:search}': ['p(95)<500'],
    'http_req_duration{name:checkout}': ['p(95)<1000'],

    // Custom checks
    'checks': ['rate>0.99'],  // 99% of checks must pass
  },
};
// k6 exits with non-zero if thresholds fail — perfect for CI
```

---

## 4. Load Test Types

### Overview

| Type | VU Pattern | Duration | Purpose |
|---|---|---|---|
| **Smoke** | 1-5 VUs | 1-2 min | Verify script works, baseline |
| **Load** | Normal traffic | 5-15 min | Verify under expected load |
| **Stress** | 2-5x normal | 10-20 min | Find breaking point |
| **Spike** | Sudden burst | 5-10 min | Test auto-scaling, recovery |
| **Soak** | Normal traffic | 2-8 hours | Find memory leaks, connection leaks |

### Smoke Test

```javascript
// Quick sanity check — run first, always
export const options = {
  vus: 3,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};
```

### Load Test

```javascript
// Simulate expected production load
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp to expected load
    { duration: '10m', target: 100 },   // Hold at expected load
    { duration: '2m', target: 0 },      // Ramp down
  ],
};
```

### Stress Test

```javascript
// Push beyond limits to find breaking point
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Normal load
    { duration: '5m', target: 200 },   // 2x normal
    { duration: '5m', target: 400 },   // 4x normal
    { duration: '5m', target: 600 },   // 6x — where does it break?
    { duration: '2m', target: 0 },     // Ramp down — does it recover?
  ],
};
```

### Spike Test

```javascript
// Sudden traffic burst (flash sale, viral post, DDoS)
export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Normal
    { duration: '10s', target: 500 },   // SPIKE
    { duration: '2m', target: 500 },    // Hold spike
    { duration: '10s', target: 10 },    // Drop back
    { duration: '2m', target: 10 },     // Recovery period
  ],
};
```

### Soak Test

```javascript
// Long-running test for memory/connection leaks
export const options = {
  stages: [
    { duration: '5m', target: 50 },     // Ramp up
    { duration: '4h', target: 50 },     // Sustain for hours
    { duration: '5m', target: 0 },      // Ramp down
  ],
};
// Watch for: increasing response times, growing memory, connection exhaustion
```

---

## 5. What to Measure

### Core Metrics

| Metric | What It Tells You | Alert Threshold |
|---|---|---|
| **p50 (median)** | Typical user experience | Baseline + 50% |
| **p95** | Slow-but-common experience | < 500ms for APIs |
| **p99** | Worst-case tail latency | < 2s for APIs |
| **Throughput (req/s)** | System capacity | Must exceed expected peak |
| **Error rate** | System reliability | < 1% for load test |
| **Concurrent connections** | System limits | < max connection pool |

### Why Percentiles, Not Averages

```
WRONG: "Average response time is 200ms" ← hides problems

  Request 1:  100ms
  Request 2:  100ms
  Request 3:  100ms
  Request 4:  100ms
  Request 5: 1500ms
  Average:    380ms (looks ok-ish)
  p95:       1500ms (20% of users have terrible experience)

CORRECT: "p50=100ms, p95=500ms, p99=1500ms"
  → Clearly shows that most users are fine, but 1% suffer
```

### What to Monitor During Tests

```
Application level:
  - Response time (p50, p95, p99)
  - Error rate by status code (4xx vs 5xx)
  - Request throughput (req/s)
  - Active connections

Infrastructure level:
  - CPU usage (app servers, DB server)
  - Memory usage (watch for growth over time)
  - Disk I/O (especially for DB)
  - Network bandwidth

Database level:
  - Active connections vs pool limit
  - Query execution time
  - Lock wait time
  - Replication lag (if applicable)

External dependencies:
  - Response time of third-party APIs
  - Rate limit headroom
  - Queue depth
```

---

## 6. Performance Budgets

### Setting Budgets

Define maximum acceptable values **before** testing. Not after.

| Endpoint Type | p50 Budget | p95 Budget | Max Error Rate |
|---|---|---|---|
| Health check | < 10ms | < 50ms | 0% |
| Read (list, detail) | < 100ms | < 300ms | < 0.1% |
| Write (create, update) | < 200ms | < 500ms | < 0.5% |
| Search | < 200ms | < 500ms | < 0.5% |
| File upload | < 1s | < 3s | < 1% |
| Report generation | < 5s | < 15s | < 1% |
| Checkout / payment | < 500ms | < 1s | < 0.1% |

### Budget Enforcement in CI

```javascript
// k6 script with budgets as thresholds
export const options = {
  thresholds: {
    // Global
    http_req_failed: ['rate<0.01'],

    // Read endpoints
    'http_req_duration{type:read}': ['p(50)<100', 'p(95)<300'],

    // Write endpoints
    'http_req_duration{type:write}': ['p(50)<200', 'p(95)<500'],

    // Search
    'http_req_duration{type:search}': ['p(50)<200', 'p(95)<500'],

    // Checkout (critical path — tighter budget)
    'http_req_duration{type:checkout}': ['p(50)<300', 'p(95)<1000'],
  },
};
```

### When to Adjust Budgets

```
TIGHTEN budgets when:
  - Moving to a faster region or better hardware
  - Optimizing hot paths
  - User complaints about speed

LOOSEN budgets when:
  - Adding complex features (search, recommendations)
  - Serving more data per request
  - Supporting more concurrent users (throughput trade-off)

NEVER loosen budgets for:
  - Payment flows
  - Login/auth
  - Health checks
```

---

## 7. Database Performance Testing

### What to Test

```
Concurrent reads:
  - Can 100 users read the product listing simultaneously?
  - Does the query plan degrade with concurrent connections?
  - Are there lock contention issues on read-heavy tables?

Write throughput:
  - Can the system handle 50 orders/second?
  - Do INSERT operations block each other?
  - Does auto-increment cause contention at high throughput?

Mixed workload:
  - What happens when reads and writes compete?
  - Does a heavy report query degrade the API?
  - Can analytics queries run alongside OLTP workload?
```

### Testing with k6

```javascript
import http from 'k6/http';
import { check } from 'k6';
import sql from 'k6/x/sql'; // k6 extension for direct DB testing

// Test API endpoint that hits the DB
export default function () {
  // Simulate concurrent product listing (heavy read)
  const listing = http.get(`${BASE_URL}/api/products?page=1&per_page=50`);
  check(listing, {
    'listing < 300ms': (r) => r.timings.duration < 300,
    'returns 50 products': (r) => JSON.parse(r.body).data.length === 50,
  });

  // Simulate order creation (write)
  if (Math.random() < 0.1) { // 10% of VUs create orders
    const order = http.post(`${BASE_URL}/api/orders`, JSON.stringify({
      product_id: Math.floor(Math.random() * 1000) + 1,
      quantity: 1,
    }), { headers: { 'Content-Type': 'application/json' } });
    check(order, {
      'order created < 500ms': (r) => r.timings.duration < 500,
      'order 201': (r) => r.status === 201,
    });
  }
}
```

### Common DB Performance Patterns

```
Problem: Slow product listing under load
  → Check: Missing index on WHERE/ORDER BY columns
  → Check: N+1 queries (loading category for each product)
  → Check: No pagination (SELECT * FROM products)

Problem: Slow order creation under load
  → Check: Serializable transaction isolation causing locks
  → Check: Trigger running on every INSERT
  → Check: Foreign key checks on large tables

Problem: Degraded reads during writes
  → Check: Table-level locks (MyISAM, not InnoDB)
  → Check: Long-running transactions holding locks
  → Check: VACUUM not running (PostgreSQL)
```

---

## 8. Frontend Performance Testing

### Lighthouse CI

```yaml
# lighthouserc.yaml
ci:
  collect:
    url:
      - 'http://localhost:3000'
      - 'http://localhost:3000/products'
      - 'http://localhost:3000/checkout'
    numberOfRuns: 3
  assert:
    assertions:
      categories:performance:
        - error
        - minScore: 0.9
      first-contentful-paint:
        - error
        - maxNumericValue: 2000
      largest-contentful-paint:
        - error
        - maxNumericValue: 2500
      cumulative-layout-shift:
        - error
        - maxNumericValue: 0.1
      total-blocking-time:
        - error
        - maxNumericValue: 300
```

### Core Web Vitals Budgets

| Metric | Good | Needs Improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | < 2.5s | 2.5s - 4s | > 4s |
| **INP** (Interaction to Next Paint) | < 200ms | 200ms - 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 | 0.1 - 0.25 | > 0.25 |

### Bundle Size Budget

```json
// package.json
{
  "bundlewatch": {
    "files": [
      { "path": "dist/js/main.*.js", "maxSize": "150kB" },
      { "path": "dist/js/vendor.*.js", "maxSize": "300kB" },
      { "path": "dist/css/main.*.css", "maxSize": "50kB" }
    ]
  }
}
```

---

## 9. Testing in CI

### Lightweight Load Tests as CI Gate

```yaml
# GitHub Actions — run smoke + light load on every PR
name: Performance
on: [pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']

    steps:
      - uses: actions/checkout@v4

      - name: Start app
        run: |
          docker compose up -d app
          sleep 5  # Wait for app to be ready

      - name: Install k6
        run: |
          curl -sSL https://dl.k6.io/key.gpg | sudo apt-key add -
          echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6

      - name: Run smoke test
        run: k6 run --env BASE_URL=http://localhost:8080 tests/load/smoke.js

      - name: Run light load test
        run: k6 run --env BASE_URL=http://localhost:8080 tests/load/ci-load.js
```

### CI-Specific k6 Script

```javascript
// tests/load/ci-load.js — lightweight, fast, CI-appropriate
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Low VU count for CI
    { duration: '1m', target: 10 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// Test the hot paths only
export default function () {
  http.get(`${__ENV.BASE_URL}/api/health`);
  http.get(`${__ENV.BASE_URL}/api/products`);

  sleep(0.5);
}
```

### When NOT to Load Test in CI

```
Skip load tests in CI when:
- PR only changes docs, README, comments
- PR only changes frontend styles
- The CI environment doesn't match production topology
- You don't have a performance baseline to compare against

Run load tests in CI when:
- PR changes API endpoints
- PR changes database queries
- PR changes caching logic
- PR changes infrastructure config
```

---

## 10. Analyzing Results

### Reading k6 Output

```
     ✓ status is 200
     ✓ response time < 500ms

     checks.........................: 99.85% ✓ 14978 ✗ 22
     data_received..................: 12 MB   120 kB/s
     data_sent......................: 1.8 MB  18 kB/s
     http_req_blocked...............: avg=1.2ms   p(95)=5.1ms
     http_req_connecting............: avg=0.8ms   p(95)=3.2ms
     http_req_duration..............: avg=85ms    p(95)=245ms   p(99)=890ms
     http_req_failed................: 0.14%   ✓ 22   ✗ 14978
     http_reqs......................: 15000   150/s
     iteration_duration.............: avg=1.09s   p(95)=1.25s
     iterations.....................: 7500    75/s
     vus............................: 20      min=0  max=100
```

### What to Look For

```
HEALTHY results:
  - p95 within budget
  - Error rate < 1%
  - Response time stable (doesn't grow over time)
  - Throughput matches or exceeds expected peak

CONCERNING results:
  - p99 >> p95 (tail latency problem)
  - Error rate spikes at specific VU count (capacity limit)
  - Response time grows linearly with VUs (missing index, lock contention)
  - Throughput plateaus while VUs increase (bottleneck)

CRITICAL results:
  - Error rate > 5% (system is failing)
  - Response time > 10s (timeouts coming)
  - Memory/CPU at 100% (need more resources or optimization)
  - Connection refused errors (pool exhausted)
```

### Bottleneck Identification Process

```
Response time increasing?
  │
  ├── CPU at 100%?
  │     YES → Profile application code, find hot functions
  │     NO ↓
  │
  ├── Memory growing?
  │     YES → Memory leak — find allocations not being freed
  │     NO ↓
  │
  ├── DB query time increasing?
  │     YES → Missing index, lock contention, connection pool full
  │     NO ↓
  │
  ├── Network latency increasing?
  │     YES → Bandwidth limit, DNS issues, external API slow
  │     NO ↓
  │
  └── Disk I/O high?
        YES → DB writes, logging, temp files
        NO  → Deeper investigation needed (thread pool, GC, etc.)
```

---

## 11. Common Bottlenecks

### Database Bottlenecks

| Bottleneck | Symptom | Fix |
|---|---|---|
| **N+1 queries** | Response time scales with data size | Eager loading, joins |
| **Missing index** | Slow queries on filtered/sorted columns | Add appropriate index |
| **Connection pool exhaustion** | Connection refused / timeout at load | Increase pool, add PgBouncer |
| **Lock contention** | Writes slow down other writes | Reduce transaction scope, optimistic locking |
| **Full table scan** | CPU spike on large tables | Add index, limit result set |
| **Unoptimized JOIN** | Slow queries on related tables | Review query plan, add indexes |

### Application Bottlenecks

| Bottleneck | Symptom | Fix |
|---|---|---|
| **Synchronous external calls** | Latency = sum of all external calls | Async, parallel calls, circuit breaker |
| **No caching** | DB hit on every request | Add Redis/Memcached for hot data |
| **Large payloads** | High bandwidth, slow parsing | Pagination, field selection, compression |
| **Memory leak** | Memory grows over time | Profile, fix allocations, restart schedule |
| **Thread/goroutine exhaustion** | Requests queued | Increase pool, reduce blocking |

### Infrastructure Bottlenecks

| Bottleneck | Symptom | Fix |
|---|---|---|
| **Single server** | Can't scale beyond one machine | Load balancer + horizontal scaling |
| **No CDN** | Static assets served from app server | CloudFront, Cloudflare |
| **DNS resolution** | Slow initial connections | DNS caching, keep-alive |
| **SSL handshake** | High latency on new connections | Connection pooling, HTTP/2 |
| **Disk I/O** | High disk wait times | SSD, reduce logging, separate DB disk |

### WRONG vs CORRECT: Fixing Bottlenecks

```
WRONG: "Response times are high, let's add more servers"
  → Throwing hardware at a query that does a full table scan
  → Each server still runs the same slow query

CORRECT: "Response times are high, let's profile"
  → Found: product listing does 50 queries (N+1)
  → Fix: eager load with single JOIN query
  → Result: 50 queries → 1 query, 800ms → 40ms
  → Didn't need more servers
```

```
WRONG: "Add caching everywhere"
  → Cache invalidation bugs, stale data, complexity
  → Cache doesn't help write-heavy endpoints

CORRECT: "Cache the hot read path"
  → Product catalog changes once/day, read 1000x/minute
  → Cache product listing with 5-minute TTL
  → DB load drops 99%, response time drops 90%
  → No cache for cart/checkout (write-heavy, user-specific)
```
