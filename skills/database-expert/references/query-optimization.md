# Query Optimization

EXPLAIN ANALYZE reading, index strategy, slow query patterns, connection pooling, VACUUM, and monitoring for PostgreSQL.

---

## Table of Contents

1. [EXPLAIN ANALYZE Reading Guide](#1-explain-analyze-reading-guide)
2. [pg_stat_statements](#2-pg_stat_statements)
3. [Index Types](#3-index-types)
4. [Composite Indexes](#4-composite-indexes)
5. [Partial Indexes](#5-partial-indexes)
6. [Expression Indexes](#6-expression-indexes)
7. [Index-Only Scans](#7-index-only-scans)
8. [Common Slow Query Patterns](#8-common-slow-query-patterns)
9. [N+1 at Database Level](#9-n1-at-database-level)
10. [Connection Pooling](#10-connection-pooling)
11. [VACUUM and Autovacuum](#11-vacuum-and-autovacuum)
12. [Table Statistics and Planner](#12-table-statistics-and-planner)
13. [Query Rewriting Techniques](#13-query-rewriting-techniques)
14. [Monitoring](#14-monitoring)

---

## 1. EXPLAIN ANALYZE Reading Guide

### Basic Usage

```sql
-- ALWAYS use ANALYZE + BUFFERS for real execution stats
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
GROUP BY u.id;
```

### Reading the Output

```
Sort  (cost=1234.56..1234.78 rows=100 width=40) (actual time=5.2..5.3 rows=95 loops=1)
  Sort Key: order_count DESC
  Sort Method: quicksort  Memory: 32kB
  ->  HashAggregate  (cost=1200.00..1210.00 rows=100 width=40) (actual time=4.8..5.0 rows=95 loops=1)
        Group Key: u.id
        ->  Hash Left Join  (cost=50.00..1100.00 rows=10000 width=36) (actual time=0.5..3.2 rows=9500 loops=1)
              Hash Cond: (o.user_id = u.id)
              ->  Seq Scan on orders o  (cost=0.00..800.00 rows=50000 width=8) (actual time=0.01..1.5 rows=50000 loops=1)
              ->  Hash  (cost=40.00..40.00 rows=100 width=36) (actual time=0.3..0.3 rows=95 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 16kB
                    ->  Index Scan using idx_users_status on users u  (cost=0.28..40.00 rows=100 width=36) (actual time=0.02..0.2 rows=95 loops=1)
                          Index Cond: (status = 'active')
                          Buffers: shared hit=10
```

### Key Fields

```
cost=START..TOTAL   -- Estimated cost (startup..total) in arbitrary units
rows=N              -- Estimated rows output
actual time=S..T    -- Real time in milliseconds (startup..total)
rows=N              -- Actual rows output
loops=N             -- How many times this node executed
Buffers: shared hit=N read=N  -- Pages found in cache vs read from disk
```

### Node Types Cheat Sheet

```
Seq Scan            -- Full table scan (reads every row). Fine for small tables,
                       bad sign on large tables with WHERE clause.

Index Scan          -- Reads index, then fetches matching rows from table.
                       Good general-purpose index access.

Index Only Scan     -- Reads ONLY the index (no table access).
                       Best possible — all needed columns are in the index.

Bitmap Index Scan   -- Reads index to build a bitmap of matching pages,
   + Bitmap Heap Scan  then reads those pages. Good for medium selectivity.

Nested Loop         -- For each row in outer, scan inner.
                       Good for small outer set + indexed inner.

Hash Join           -- Build hash table from smaller side, probe with larger.
                       Good for medium/large joins with equality conditions.

Merge Join          -- Both sides sorted, merge them.
                       Good when both sides are already sorted (index).

Sort                -- Explicit sort. Check Memory vs disk (external sort is slow).

HashAggregate       -- GROUP BY using hash table. Fast for few groups.

GroupAggregate      -- GROUP BY using pre-sorted input. Good when data is already sorted.
```

### Red Flags in EXPLAIN

```sql
-- RED FLAG: Estimated rows vs actual rows differ wildly
-- "rows=10" but "actual rows=50000" → stale statistics → ANALYZE the table
-- Example:
-- Index Scan ... (rows=10) (actual time=... rows=50000 loops=1)
-- Fix: ANALYZE users;

-- RED FLAG: Seq Scan on large table with WHERE clause
-- Fix: add an index on the WHERE column

-- RED FLAG: "Sort Method: external merge  Disk: 50MB"
-- Sort spilled to disk → increase work_mem for this query
-- Fix: SET work_mem = '256MB'; (per session, not globally)

-- RED FLAG: Nested Loop with large outer set
-- Outer has 100K rows, each doing an Index Scan on inner
-- Fix: check if Hash Join would be better (might need more work_mem)

-- RED FLAG: Buffers: shared read=50000
-- 50K pages read from disk (not in cache) → table/index not in shared_buffers
-- Might indicate: cold cache, or table too large for shared_buffers
```

---

## 2. pg_stat_statements

### Setup

```sql
-- Enable the extension (requires restart if not in shared_preload_libraries)
-- postgresql.conf:
-- shared_preload_libraries = 'pg_stat_statements'
-- pg_stat_statements.track = all

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### Find Slowest Queries

```sql
-- Top 10 by total execution time
SELECT
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_ms,
    ROUND(mean_exec_time::numeric, 2) AS avg_ms,
    ROUND((100 * total_exec_time / SUM(total_exec_time) OVER ())::numeric, 2) AS pct,
    LEFT(query, 100) AS query_preview
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

### Find Most Called Queries

```sql
SELECT
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_ms,
    rows,
    LEFT(query, 100) AS query_preview
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;
```

### Find Queries with Most I/O

```sql
SELECT
    calls,
    shared_blks_read + shared_blks_hit AS total_buffers,
    ROUND(shared_blks_hit::numeric / NULLIF(shared_blks_read + shared_blks_hit, 0) * 100, 2) AS cache_hit_pct,
    LEFT(query, 100) AS query_preview
FROM pg_stat_statements
WHERE calls > 10
ORDER BY shared_blks_read DESC
LIMIT 10;
```

### Reset Statistics

```sql
-- Reset after deploying a fix, to see fresh numbers
SELECT pg_stat_statements_reset();
```

---

## 3. Index Types

### B-tree (Default)

```sql
-- Best for: equality (=), range (<, >, BETWEEN), ORDER BY, LIKE 'prefix%'
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_created ON orders(created_at);

-- Supports: =, <, >, <=, >=, BETWEEN, IN, IS NULL, LIKE 'abc%'
-- Does NOT support: LIKE '%abc', full-text search, array containment
```

### Hash

```sql
-- Best for: equality only (=). Smaller than B-tree for equality-only queries.
CREATE INDEX idx_sessions_token ON sessions USING HASH(token);

-- Supports: = only
-- Does NOT support: range, ORDER BY, LIKE
-- WAL-logged since PG10. Previously unsafe.
```

### GIN (Generalized Inverted Index)

```sql
-- Best for: multi-valued types (arrays, JSONB, tsvector, trigram)
CREATE INDEX idx_articles_tags ON articles USING GIN(tags);         -- array
CREATE INDEX idx_events_payload ON events USING GIN(payload);       -- JSONB
CREATE INDEX idx_articles_search ON articles USING GIN(search_vector); -- FTS

-- Supports: @>, ?, ?|, ?&, @@, &&
-- Slow to update (write overhead), fast to query
-- Use gin_pending_list_limit to control write batching
```

### GiST (Generalized Search Tree)

```sql
-- Best for: geometric types, ranges, nearest-neighbor, full-text (alternative to GIN)
CREATE INDEX idx_locations_coords ON locations USING GIST(point);
CREATE INDEX idx_events_period ON events USING GIST(period);       -- tsrange

-- Also used by: PostGIS, pg_trgm (similarity search), ltree
-- Supports: <<, >>, &&, @>, <@, ~=, <<|, |>>
-- Lossy: may need recheck (slower than GIN for exact matches)
```

### BRIN (Block Range Index)

```sql
-- Best for: naturally ordered data (time-series, sequential IDs)
-- Extremely small index: stores min/max per block range
CREATE INDEX idx_logs_created ON logs USING BRIN(created_at);

-- Effective when: data is physically ordered by the indexed column
-- If rows are inserted in random order, BRIN is useless
-- Size: orders of magnitude smaller than B-tree on large tables

-- Check correlation (1.0 = perfectly ordered, 0.0 = random)
SELECT correlation
FROM pg_stats
WHERE tablename = 'logs' AND attname = 'created_at';
-- If correlation > 0.9, BRIN is excellent
```

### Decision Matrix

| Index Type | Best For | Size | Write Cost | Read Speed |
|---|---|---|---|---|
| B-tree | Equality, range, ORDER BY | Medium | Low | Fast |
| Hash | Equality only | Small | Low | Fast |
| GIN | Multi-value (array, JSONB, FTS) | Large | High | Fast |
| GiST | Geometry, ranges, nearest-neighbor | Medium | Medium | Medium |
| BRIN | Time-series, sequential data | Tiny | Very low | Medium |

---

## 4. Composite Indexes

### Column Order Matters

```sql
-- Index on (a, b, c) can serve queries:
-- WHERE a = ?                    ✅ (leftmost prefix)
-- WHERE a = ? AND b = ?          ✅
-- WHERE a = ? AND b = ? AND c = ? ✅
-- WHERE b = ?                    ❌ (not leftmost)
-- WHERE b = ? AND c = ?          ❌
-- WHERE a = ? AND c = ?          ✅ for a, skip scan for c (PG 13+ sometimes)

CREATE INDEX idx_orders_lookup ON orders(customer_id, status, created_at);
-- Optimal for: WHERE customer_id = 1 AND status = 'active' ORDER BY created_at DESC
```

### Equality Before Range

```sql
-- WRONG: range column first
CREATE INDEX idx_orders_bad ON orders(created_at, status);
-- WHERE created_at > '2025-01-01' AND status = 'pending'
-- Index scans created_at range but can't efficiently filter status

-- CORRECT: equality columns first, then range columns
CREATE INDEX idx_orders_good ON orders(status, created_at);
-- WHERE status = 'pending' AND created_at > '2025-01-01'
-- Index jumps to status='pending', then scans created_at range
```

### Covering Indexes (INCLUDE)

```sql
-- INCLUDE adds columns to the index leaf pages (not the search tree)
-- Enables index-only scans without bloating the search structure
CREATE INDEX idx_users_email_covering ON users(email) INCLUDE (name, id);

-- This query can be answered entirely from the index:
SELECT id, name FROM users WHERE email = 'bruno@example.com';
-- "Index Only Scan" in EXPLAIN — no table access needed
```

### Too Many Indexes

```sql
-- WRONG: index every column "just in case"
CREATE INDEX idx1 ON orders(customer_id);
CREATE INDEX idx2 ON orders(status);
CREATE INDEX idx3 ON orders(created_at);
CREATE INDEX idx4 ON orders(customer_id, status);
CREATE INDEX idx5 ON orders(customer_id, created_at);
CREATE INDEX idx6 ON orders(status, created_at);
-- idx1 is redundant (idx4 and idx5 cover it)
-- Every INSERT/UPDATE/DELETE must update ALL 6 indexes

-- CORRECT: minimal set of indexes based on actual query patterns
CREATE INDEX idx_orders_customer_status ON orders(customer_id, status, created_at);
-- Covers most query patterns with one index
```

### Finding Unused Indexes

```sql
-- Indexes that exist but are never used
SELECT
    schemaname || '.' || relname AS table,
    indexrelname AS index,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size,
    idx_scan AS times_used
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'  -- skip primary keys
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## 5. Partial Indexes

```sql
-- Index only rows matching a condition — smaller, faster, cheaper to maintain

-- Only index active users (if 95% of queries filter by active)
CREATE INDEX idx_users_email_active ON users(email) WHERE status = 'active';

-- Only index unprocessed jobs
CREATE INDEX idx_jobs_pending ON jobs(created_at) WHERE status = 'pending';
-- After a job is processed, it's removed from the index automatically

-- Only index non-null values
CREATE INDEX idx_orders_shipped ON orders(shipped_at) WHERE shipped_at IS NOT NULL;
```

```sql
-- WRONG: query doesn't match the partial index condition
CREATE INDEX idx_users_active ON users(email) WHERE status = 'active';
SELECT * FROM users WHERE email = 'x@y.com' AND status = 'inactive';
-- This query CANNOT use the partial index (status != 'active')

-- CORRECT: query WHERE clause must imply the index WHERE clause
SELECT * FROM users WHERE email = 'x@y.com' AND status = 'active';
-- ✅ Uses the partial index
```

---

## 6. Expression Indexes

```sql
-- Index on a function or expression result

-- Case-insensitive email lookup
CREATE INDEX idx_users_email_lower ON users(lower(email));
-- Query MUST use the same expression:
SELECT * FROM users WHERE lower(email) = 'bruno@example.com';

-- WRONG: expression doesn't match
SELECT * FROM users WHERE email = 'Bruno@EXAMPLE.com';
-- Does NOT use idx_users_email_lower (no lower() in query)
```

```sql
-- Date extraction for time-based queries
CREATE INDEX idx_orders_month ON orders(date_trunc('month', created_at));
-- SELECT * FROM orders WHERE date_trunc('month', created_at) = '2025-06-01';

-- JSONB field extraction
CREATE INDEX idx_events_user ON events ((payload->>'user_id'));
-- SELECT * FROM events WHERE payload->>'user_id' = '42';
```

---

## 7. Index-Only Scans

### How They Work

```sql
-- Index-only scan: reads ONLY the index, never touches the table
-- Requires: all columns in SELECT/WHERE/ORDER BY are in the index
-- Also requires: visibility map is up-to-date (VACUUM maintains this)

CREATE INDEX idx_users_lookup ON users(email) INCLUDE (id, name);

-- This query uses index-only scan:
EXPLAIN SELECT id, name FROM users WHERE email = 'bruno@example.com';
-- -> Index Only Scan using idx_users_lookup

-- This query CANNOT use index-only scan (body not in index):
EXPLAIN SELECT id, name, body FROM users WHERE email = 'bruno@example.com';
-- -> Index Scan using idx_users_lookup (must fetch body from table)
```

### Visibility Map

```sql
-- Index-only scans check the visibility map to know if a page is all-visible
-- If a page is NOT all-visible (has recent updates), it must check the table
-- VACUUM marks pages as all-visible

-- Check visibility: look for "Heap Fetches" in EXPLAIN
-- Index Only Scan ... Heap Fetches: 0    ← perfect, all from index
-- Index Only Scan ... Heap Fetches: 5000 ← visibility map outdated, run VACUUM

VACUUM users;  -- update visibility map
```

---

## 8. Common Slow Query Patterns

### Pattern 1: SELECT * When You Need 2 Columns

```sql
-- WRONG: fetches all columns, prevents index-only scan
SELECT * FROM users WHERE status = 'active';

-- CORRECT: fetch only what you need
SELECT id, name, email FROM users WHERE status = 'active';
```

### Pattern 2: LIKE '%...%' (Leading Wildcard)

```sql
-- WRONG: cannot use B-tree index (leading wildcard)
SELECT * FROM products WHERE name LIKE '%widget%';

-- Fix option 1: pg_trgm extension for trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIN(name gin_trgm_ops);
-- Now LIKE '%widget%' uses the GIN index

-- Fix option 2: full-text search (if semantic search is acceptable)
SELECT * FROM products WHERE to_tsvector('english', name) @@ to_tsquery('widget');
```

### Pattern 3: OR Conditions Preventing Index Use

```sql
-- WRONG: OR prevents single index scan
SELECT * FROM orders WHERE customer_id = 42 OR status = 'pending';

-- CORRECT: UNION ALL (each branch uses its own index)
SELECT * FROM orders WHERE customer_id = 42
UNION ALL
SELECT * FROM orders WHERE status = 'pending' AND customer_id != 42;
```

### Pattern 4: Implicit Type Casting

```sql
-- WRONG: index on INTEGER but querying with TEXT
SELECT * FROM users WHERE id = '42';
-- PostgreSQL may cast and still use the index, but:
SELECT * FROM users WHERE phone = 12345;  -- phone is TEXT, querying with INTEGER
-- Might not use the index on phone due to type mismatch

-- CORRECT: match types explicitly
SELECT * FROM users WHERE phone = '12345';
```

### Pattern 5: Large OFFSET

```sql
-- WRONG: scans and discards 100K rows
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 100000;

-- CORRECT: keyset pagination (seek method)
SELECT * FROM products
WHERE created_at < '2025-06-01T12:00:00Z'  -- last seen value
ORDER BY created_at DESC
LIMIT 20;
```

### Pattern 6: COUNT(*) on Large Tables

```sql
-- SLOW: exact count requires full table scan
SELECT COUNT(*) FROM orders;  -- 50 million rows = slow

-- FAST: approximate count from statistics
SELECT reltuples::bigint AS approximate_count
FROM pg_class
WHERE relname = 'orders';

-- FAST: exact count with conditions (if indexed)
SELECT COUNT(*) FROM orders WHERE status = 'pending';
-- ✅ Uses index on status (partial count is usually fast)
```

### Pattern 7: Correlated Subquery in SELECT

```sql
-- WRONG: subquery runs once per row
SELECT
    u.name,
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS order_count
FROM users u;

-- CORRECT: LEFT JOIN with aggregate
SELECT u.name, COALESCE(COUNT(o.id), 0) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;

-- ALSO CORRECT: LATERAL (when you need more than count)
SELECT u.name, stats.order_count, stats.total_spent
FROM users u
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS total_spent
    FROM orders WHERE user_id = u.id
) stats ON true;
```

### Pattern 8: NOT IN with NULLs

```sql
-- WRONG: NOT IN with subquery that might return NULLs
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned_users);
-- If user_id contains a NULL, this returns NO ROWS (SQL tri-value logic)

-- CORRECT: use NOT EXISTS
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM banned_users b WHERE b.user_id = u.id);
```

---

## 9. N+1 at Database Level

### The Pattern

```sql
-- Application runs:
-- Query 1: SELECT * FROM orders WHERE status = 'pending';  → 100 rows
-- Query 2: SELECT * FROM customers WHERE id = 1;   -- for order.customer_id
-- Query 3: SELECT * FROM customers WHERE id = 2;
-- Query 4: SELECT * FROM customers WHERE id = 3;
-- ... 100 more queries

-- This is N+1: 1 query for orders + N queries for each customer
```

### Fix: JOIN in the Original Query

```sql
-- CORRECT: single query with JOIN
SELECT o.*, c.name AS customer_name, c.email AS customer_email
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'pending';
```

### Fix: Batch Fetch

```sql
-- If you must fetch separately, batch IDs
SELECT * FROM customers
WHERE id = ANY(ARRAY[1, 2, 3, 5, 8, 13, 21, 34]);
-- Instead of 8 separate queries, one query with IN/ANY
```

### Detecting N+1 in PostgreSQL

```sql
-- pg_stat_statements shows N+1 patterns: same query template, very high calls count
SELECT
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_ms,
    LEFT(query, 80) AS query
FROM pg_stat_statements
WHERE query LIKE 'SELECT%FROM customers WHERE id =%'
ORDER BY calls DESC;
-- If calls=100K and avg_ms=0.1, that's N+1 (fast per query, but thousands of calls)
```

---

## 10. Connection Pooling

### Why Connection Pooling

```sql
-- Each PostgreSQL connection:
-- - Costs ~5-10MB of RAM
-- - Fork a new process (not thread)
-- - Has startup overhead (authentication, session setup)

-- Without pooling: 200 web workers = 200 database connections
-- With pooling: 200 web workers → PgBouncer (20 connections) → PostgreSQL
```

### PgBouncer Configuration

```ini
; pgbouncer.ini
[databases]
myapp = host=127.0.0.1 port=5432 dbname=myapp

[pgbouncer]
listen_port = 6432
listen_addr = 127.0.0.1
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

; Pool modes:
; session    - connection assigned per client session (safest, least efficient)
; transaction - connection assigned per transaction (best balance)
; statement  - connection assigned per statement (most efficient, most restrictions)
pool_mode = transaction

; Pool sizing
default_pool_size = 20        ; connections per user/database pair
max_client_conn = 200         ; max clients to PgBouncer
reserve_pool_size = 5         ; extra connections for burst
reserve_pool_timeout = 3      ; seconds before using reserve pool
```

### Transaction Mode Limitations

```sql
-- In transaction mode, these features DON'T work:
-- - SET statements (session variables) — reset between transactions
-- - LISTEN/NOTIFY — requires persistent connection
-- - Prepared statements — associated with connection
-- - Advisory locks (session-level) — use transaction-level instead
-- - Temporary tables — dropped when connection returns to pool

-- WRONG: set session variable, expect it to persist
SET app.current_user_id = '42';
-- next query might get a different connection

-- CORRECT: set variable inside transaction
BEGIN;
SET LOCAL app.current_user_id = '42';  -- SET LOCAL = transaction-scoped
SELECT * FROM projects;  -- RLS uses the variable
COMMIT;
```

---

## 11. VACUUM and Autovacuum

### What VACUUM Does

```sql
-- PostgreSQL uses MVCC: UPDATE/DELETE creates new row versions, old ones remain
-- VACUUM reclaims space from dead row versions (dead tuples)
-- Without VACUUM: table bloat, slower queries, transaction ID wraparound

-- Manual VACUUM
VACUUM users;              -- reclaim dead tuples (doesn't lock table)
VACUUM FULL users;         -- rewrite table to reclaim ALL space (LOCKS table!)
VACUUM ANALYZE users;      -- VACUUM + update planner statistics
ANALYZE users;             -- only update statistics (no dead tuple cleanup)
```

### Autovacuum Tuning

```sql
-- Default autovacuum triggers when dead tuples > (threshold + scale_factor * table_size)
-- Default: 50 + 0.2 * number_of_rows

-- For high-write tables, make autovacuum more aggressive:
ALTER TABLE orders SET (
    autovacuum_vacuum_threshold = 100,
    autovacuum_vacuum_scale_factor = 0.05,   -- vacuum after 5% dead tuples (not 20%)
    autovacuum_analyze_threshold = 50,
    autovacuum_analyze_scale_factor = 0.02   -- analyze after 2% changed rows
);
```

### Monitoring Bloat

```sql
-- Check dead tuples waiting for VACUUM
SELECT
    schemaname || '.' || relname AS table,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows,
    ROUND(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 1) AS dead_pct,
    last_vacuum,
    last_autovacuum,
    last_analyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### Transaction ID Wraparound Prevention

```sql
-- PostgreSQL has a 32-bit transaction counter (~4 billion)
-- If you never VACUUM, you'll hit wraparound and the DB shuts down

-- Check how close you are:
SELECT
    datname,
    age(datfrozenxid) AS xid_age,
    ROUND(age(datfrozenxid)::numeric / 2147483647 * 100, 2) AS pct_to_wraparound
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

-- If pct_to_wraparound > 50%, investigate immediately
-- If age > 200M, autovacuum becomes aggressive (anti-wraparound vacuum)
```

---

## 12. Table Statistics and Planner

### ANALYZE

```sql
-- Update statistics so the query planner makes good decisions
ANALYZE users;                -- single table
ANALYZE;                      -- all tables in current database

-- Increase statistics target for columns with skewed distribution
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;
-- Default is 100. Higher = more accurate histograms, but slower ANALYZE.
-- Useful when EXPLAIN estimates are wildly wrong for this column.
ANALYZE orders;
```

### Checking Statistics

```sql
-- See what the planner knows about a column
SELECT
    attname,
    n_distinct,     -- estimated number of distinct values (-1 = unique)
    null_frac,      -- fraction of NULLs
    avg_width,      -- average column width in bytes
    correlation     -- physical ordering (-1 to 1, relevant for BRIN)
FROM pg_stats
WHERE tablename = 'orders' AND attname = 'status';
```

### work_mem Tuning

```sql
-- work_mem: memory for sorting and hash tables (per operation, not per query!)
-- Default: 4MB (often too low for complex queries)

-- WRONG: set globally to 1GB (100 connections * 1GB * N operations = OOM)
-- ALTER SYSTEM SET work_mem = '1GB';

-- CORRECT: set per session for heavy queries
SET work_mem = '256MB';
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... complex query ...;
RESET work_mem;

-- Check if sorts spill to disk
-- Look for: "Sort Method: external merge  Disk: NNN kB"
-- If you see disk sorts, increase work_mem for that session
```

### Random Page Cost

```sql
-- random_page_cost: how expensive random I/O is relative to sequential
-- Default: 4.0 (assumes spinning disk)
-- For SSD: set to 1.1-1.5

-- Check current value
SHOW random_page_cost;

-- For SSD storage:
ALTER SYSTEM SET random_page_cost = 1.1;
SELECT pg_reload_conf();
-- This makes the planner prefer index scans over seq scans (correct for SSD)
```

---

## 13. Query Rewriting Techniques

### EXISTS vs IN

```sql
-- WRONG: IN with large subquery (materializes entire subquery)
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total_amount > 1000);

-- CORRECT: EXISTS (stops at first match, uses index on user_id)
SELECT * FROM users u
WHERE EXISTS (
    SELECT 1 FROM orders o
    WHERE o.user_id = u.id AND o.total_amount > 1000
);
```

### Avoid Functions in WHERE on Indexed Columns

```sql
-- WRONG: function on indexed column prevents index use
SELECT * FROM users WHERE UPPER(email) = 'BRUNO@EXAMPLE.COM';
-- Seq Scan (index on email is useless because of UPPER())

-- CORRECT option 1: expression index
CREATE INDEX idx_users_email_upper ON users(UPPER(email));
SELECT * FROM users WHERE UPPER(email) = 'BRUNO@EXAMPLE.COM';

-- CORRECT option 2: use citext extension for case-insensitive text
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ALTER COLUMN email TYPE citext;
-- Now: SELECT * FROM users WHERE email = 'Bruno@EXAMPLE.com'; uses index
```

### Rewrite Subquery to JOIN

```sql
-- SLOW: correlated subquery (runs per row)
SELECT
    p.name,
    p.price,
    (SELECT AVG(price) FROM products WHERE category_id = p.category_id) AS avg_price
FROM products p;

-- FAST: single pass with window function
SELECT
    name,
    price,
    AVG(price) OVER (PARTITION BY category_id) AS avg_price
FROM products;
```

### UNION ALL vs UNION

```sql
-- WRONG: UNION removes duplicates (expensive sort/hash)
SELECT id, name FROM customers
UNION
SELECT id, name FROM prospects;

-- CORRECT: UNION ALL when duplicates are impossible or acceptable
SELECT id, name FROM customers
UNION ALL
SELECT id, name FROM prospects;
-- Skip the dedup step if you know there are no duplicates
```

### Batch Operations

```sql
-- WRONG: update one row at a time in a loop
-- UPDATE products SET price = 10.00 WHERE id = 1;
-- UPDATE products SET price = 20.00 WHERE id = 2;
-- ... 10000 times

-- CORRECT: single UPDATE with VALUES list
UPDATE products AS p
SET price_cents = v.price_cents
FROM (VALUES
    (1, 1000),
    (2, 2000),
    (3, 3000)
) AS v(id, price_cents)
WHERE p.id = v.id;

-- CORRECT: bulk INSERT with unnest
INSERT INTO tags (name, slug)
SELECT unnest(ARRAY['tag1','tag2','tag3']),
       unnest(ARRAY['tag1','tag2','tag3']);
```

---

## 14. Monitoring

### pg_stat_user_tables

```sql
-- Table access patterns
SELECT
    schemaname || '.' || relname AS table,
    seq_scan,           -- number of sequential scans (high = missing index?)
    seq_tup_read,       -- rows read by seq scans
    idx_scan,           -- number of index scans
    idx_tup_fetch,      -- rows fetched by index scans
    n_tup_ins AS inserts,
    n_tup_upd AS updates,
    n_tup_del AS deletes,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;

-- RED FLAG: table with millions of rows and high seq_scan count
-- = queries are doing full table scans, probably missing an index
```

### pg_stat_user_indexes

```sql
-- Index usage and efficiency
SELECT
    schemaname || '.' || relname AS table,
    indexrelname AS index,
    idx_scan AS times_used,
    idx_tup_read AS rows_read,
    idx_tup_fetch AS rows_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

### Cache Hit Ratio

```sql
-- Should be > 99% for OLTP workloads
SELECT
    SUM(heap_blks_hit) AS cache_hits,
    SUM(heap_blks_read) AS disk_reads,
    ROUND(
        SUM(heap_blks_hit)::numeric /
        NULLIF(SUM(heap_blks_hit) + SUM(heap_blks_read), 0) * 100,
        2
    ) AS cache_hit_ratio
FROM pg_statio_user_tables;

-- If cache_hit_ratio < 99%, consider:
-- 1. Increase shared_buffers
-- 2. Your dataset is larger than RAM (expected for large DBs)
-- 3. Specific tables are too large — consider partitioning
```

### Active Queries and Locks

```sql
-- Currently running queries
SELECT
    pid,
    usename,
    state,
    wait_event_type,
    wait_event,
    NOW() - query_start AS duration,
    LEFT(query, 80) AS query
FROM pg_stat_activity
WHERE state != 'idle'
  AND pid != pg_backend_pid()
ORDER BY query_start;

-- Blocked queries (waiting for locks)
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
    AND blocked_locks.relation = blocking_locks.relation
    AND blocked_locks.pid != blocking_locks.pid
JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
WHERE NOT blocked_locks.granted;
```

### Table and Index Sizes

```sql
-- Top 20 largest tables (including indexes and TOAST)
SELECT
    schemaname || '.' || relname AS table,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS indexes_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid) - pg_indexes_size(relid)) AS toast_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```
