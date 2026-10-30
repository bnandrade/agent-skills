# PostgreSQL Advanced

Advanced PostgreSQL features: CTEs, window functions, JSONB, arrays, full-text search, partitioning, RLS, and more.

---

## Table of Contents

1. [CTEs (Common Table Expressions)](#1-ctes-common-table-expressions)
2. [Window Functions](#2-window-functions)
3. [JSONB](#3-jsonb)
4. [Arrays](#4-arrays)
5. [Full-Text Search](#5-full-text-search)
6. [Generated Columns](#6-generated-columns)
7. [UPSERT (INSERT ON CONFLICT)](#7-upsert-insert-on-conflict)
8. [Lateral Joins](#8-lateral-joins)
9. [DISTINCT ON](#9-distinct-on)
10. [LISTEN / NOTIFY](#10-listen--notify)
11. [Partitioning](#11-partitioning)
12. [Row-Level Security (RLS)](#12-row-level-security-rls)
13. [Advisory Locks](#13-advisory-locks)

---

## 1. CTEs (Common Table Expressions)

### Basic CTE

```sql
-- Break complex queries into readable steps
WITH active_customers AS (
    SELECT id, name, email
    FROM customers
    WHERE status = 'active'
      AND last_order_at > NOW() - INTERVAL '90 days'
),
customer_revenue AS (
    SELECT
        ac.id,
        ac.name,
        SUM(o.total_amount) AS total_revenue,
        COUNT(o.id) AS order_count
    FROM active_customers ac
    JOIN orders o ON o.customer_id = ac.id
    WHERE o.created_at > NOW() - INTERVAL '1 year'
    GROUP BY ac.id, ac.name
)
SELECT
    name,
    total_revenue,
    order_count,
    total_revenue / NULLIF(order_count, 0) AS avg_order_value
FROM customer_revenue
WHERE total_revenue > 1000
ORDER BY total_revenue DESC;
```

### Recursive CTE

```sql
-- Organizational hierarchy: find all reports under a manager
WITH RECURSIVE org_tree AS (
    -- Base case: the manager
    SELECT id, name, manager_id, title, 1 AS depth
    FROM employees
    WHERE id = 1  -- CEO

    UNION ALL

    -- Recursive case: employees reporting to someone in the tree
    SELECT e.id, e.name, e.manager_id, e.title, ot.depth + 1
    FROM employees e
    JOIN org_tree ot ON e.manager_id = ot.id
    WHERE ot.depth < 10  -- safety limit to prevent infinite loops
)
SELECT * FROM org_tree ORDER BY depth, name;
```

```sql
-- Generate a date series (useful for filling gaps in time-series data)
WITH RECURSIVE dates AS (
    SELECT DATE '2025-01-01' AS dt
    UNION ALL
    SELECT dt + INTERVAL '1 day'
    FROM dates
    WHERE dt < DATE '2025-12-31'
)
SELECT
    d.dt AS date,
    COALESCE(COUNT(o.id), 0) AS order_count
FROM dates d
LEFT JOIN orders o ON DATE(o.created_at) = d.dt
GROUP BY d.dt
ORDER BY d.dt;

-- Better alternative: use generate_series (PostgreSQL built-in)
SELECT
    d.dt::date AS date,
    COALESCE(COUNT(o.id), 0) AS order_count
FROM generate_series('2025-01-01'::date, '2025-12-31'::date, '1 day') AS d(dt)
LEFT JOIN orders o ON DATE(o.created_at) = d.dt
GROUP BY d.dt
ORDER BY d.dt;
```

### CTE with INSERT/UPDATE/DELETE (Writeable CTEs)

```sql
-- Archive old orders and return what was archived
WITH archived AS (
    DELETE FROM orders
    WHERE status = 'completed'
      AND created_at < NOW() - INTERVAL '2 years'
    RETURNING *
)
INSERT INTO orders_archive
SELECT *, NOW() AS archived_at FROM archived;
```

```sql
-- UPSERT and return affected rows
WITH upserted AS (
    INSERT INTO product_prices (product_id, price_cents, effective_from)
    VALUES (42, 1999, NOW())
    ON CONFLICT (product_id) DO UPDATE
        SET price_cents = EXCLUDED.price_cents,
            effective_from = NOW()
    RETURNING *
)
SELECT * FROM upserted;
```

### CTE Performance Note

```sql
-- PostgreSQL 12+: CTEs are automatically inlined (optimized) when:
-- 1. Referenced only once, AND
-- 2. Not recursive, AND
-- 3. Have no side effects

-- Force materialization (if you want the CTE to act as an optimization fence):
WITH expensive_query AS MATERIALIZED (
    SELECT id, complex_calculation(data) AS result
    FROM big_table
    WHERE condition
)
SELECT * FROM expensive_query WHERE result > 100;

-- Force inlining (default for single-use non-recursive CTEs):
WITH simple_filter AS NOT MATERIALIZED (
    SELECT * FROM users WHERE status = 'active'
)
SELECT * FROM simple_filter WHERE name ILIKE '%bruno%';
```

---

## 2. Window Functions

### ROW_NUMBER, RANK, DENSE_RANK

```sql
-- ROW_NUMBER: unique sequential number, no gaps
-- RANK: same rank for ties, gaps after ties (1, 2, 2, 4)
-- DENSE_RANK: same rank for ties, no gaps (1, 2, 2, 3)

SELECT
    name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num,
    RANK()       OVER (PARTITION BY department ORDER BY salary DESC) AS rank,
    DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank
FROM employees;
```

### Top-N per Group

```sql
-- Get top 3 highest-paid employees per department
SELECT * FROM (
    SELECT
        name,
        department,
        salary,
        ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn
    FROM employees
) ranked
WHERE rn <= 3;
```

### LAG and LEAD

```sql
-- Compare each month's revenue with previous month
SELECT
    month,
    revenue,
    LAG(revenue) OVER (ORDER BY month) AS prev_month_revenue,
    revenue - LAG(revenue) OVER (ORDER BY month) AS month_over_month,
    ROUND(
        (revenue - LAG(revenue) OVER (ORDER BY month))
        / NULLIF(LAG(revenue) OVER (ORDER BY month), 0) * 100,
        1
    ) AS pct_change
FROM monthly_revenue;
```

### Running Totals

```sql
-- Cumulative sum
SELECT
    date,
    amount,
    SUM(amount) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM transactions;
```

### Moving Averages

```sql
-- 7-day moving average
SELECT
    date,
    daily_revenue,
    AVG(daily_revenue) OVER (
        ORDER BY date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS moving_avg_7d
FROM daily_revenue;

-- WRONG: using RANGE instead of ROWS for moving average (includes ties)
-- RANGE BETWEEN ... includes all rows with the same ORDER BY value
-- ROWS BETWEEN ... counts exactly N rows
```

### FIRST_VALUE, LAST_VALUE, NTH_VALUE

```sql
-- Get first and last order date per customer
SELECT DISTINCT
    customer_id,
    FIRST_VALUE(created_at) OVER w AS first_order,
    LAST_VALUE(created_at) OVER w AS last_order,
    COUNT(*) OVER w AS total_orders
FROM orders
WINDOW w AS (
    PARTITION BY customer_id
    ORDER BY created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
);
-- NOTE: LAST_VALUE needs the full window frame (ROWS BETWEEN ... UNBOUNDED FOLLOWING)
-- Default frame is ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

### Named Window

```sql
-- Reuse window definition
SELECT
    name,
    department,
    salary,
    AVG(salary) OVER w AS dept_avg,
    MAX(salary) OVER w AS dept_max,
    salary - AVG(salary) OVER w AS diff_from_avg
FROM employees
WINDOW w AS (PARTITION BY department);
```

### Percentiles

```sql
-- Median salary per department
SELECT DISTINCT
    department,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY salary) OVER (PARTITION BY department) AS median_salary,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY salary) OVER (PARTITION BY department) AS p90_salary
FROM employees;

-- Or without window (aggregate):
SELECT
    department,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY salary) AS median_salary
FROM employees
GROUP BY department;
```

---

## 3. JSONB

### Storing JSONB

```sql
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO events (event_type, payload) VALUES
    ('user.signup', '{"user_id": 1, "email": "bruno@example.com", "plan": "pro"}'),
    ('order.placed', '{"order_id": 42, "items": [{"sku": "A1", "qty": 2}], "total": 99.90}');
```

### Querying JSONB

```sql
-- Access field (returns JSONB)
SELECT payload->'user_id' FROM events;        -- JSONB: 1
-- Access field (returns TEXT)
SELECT payload->>'email' FROM events;         -- TEXT: 'bruno@example.com'
-- Nested access
SELECT payload->'items'->0->>'sku' FROM events; -- TEXT: 'A1'
-- Path access
SELECT payload #>> '{items,0,sku}' FROM events;  -- TEXT: 'A1'

-- Filter by JSONB field
SELECT * FROM events WHERE payload->>'plan' = 'pro';

-- Check if key exists
SELECT * FROM events WHERE payload ? 'email';

-- Check if JSONB contains another JSONB
SELECT * FROM events WHERE payload @> '{"plan": "pro"}';
```

### JSONB Operators Cheat Sheet

```sql
->    -- Get JSON object field by key (returns JSONB)
->>   -- Get JSON object field by key (returns TEXT)
#>    -- Get JSON object at path (returns JSONB)
#>>   -- Get JSON object at path (returns TEXT)
@>    -- Contains (left contains right)
<@    -- Contained by (left is contained by right)
?     -- Key exists
?|    -- Any key exists
?&    -- All keys exist
||    -- Concatenate (merge)
-     -- Delete key or array element
#-    -- Delete at path
```

### Modifying JSONB

```sql
-- Add/update a field
UPDATE events SET payload = payload || '{"verified": true}' WHERE id = 1;

-- Set nested field
UPDATE events SET payload = jsonb_set(payload, '{address,city}', '"Sao Paulo"') WHERE id = 1;

-- Remove a key
UPDATE events SET payload = payload - 'temporary_field' WHERE id = 1;

-- Remove nested key
UPDATE events SET payload = payload #- '{items,0}' WHERE id = 1;
```

### Indexing JSONB

```sql
-- GIN index: supports @>, ?, ?|, ?& operators
CREATE INDEX idx_events_payload ON events USING GIN(payload);

-- GIN with jsonb_path_ops: smaller index, supports only @>
CREATE INDEX idx_events_payload_path ON events USING GIN(payload jsonb_path_ops);

-- Expression index on specific field (most efficient for single-field queries)
CREATE INDEX idx_events_plan ON events ((payload->>'plan'));

-- Partial index on JSONB field
CREATE INDEX idx_events_pro ON events ((payload->>'plan')) WHERE payload->>'plan' = 'pro';
```

### When JSONB vs Relational

```sql
-- Use JSONB when:
-- 1. Schema varies per row (user preferences, form data, API responses)
-- 2. You query the whole document, rarely individual fields
-- 3. The data is truly semi-structured

-- Use relational columns when:
-- 1. You query/filter/join on the field frequently
-- 2. The field is part of business logic (status, price, email)
-- 3. You need constraints (NOT NULL, UNIQUE, FK)
-- 4. You need type safety (JSONB stores everything as JSON types)

-- WRONG: hiding structured data in JSONB
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    data JSONB  -- {"customer_id": 1, "total": 99.90, "status": "pending"}
);

-- CORRECT: structured columns for structured data, JSONB for the rest
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    total_amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata JSONB DEFAULT '{}'  -- extra unstructured data
);
```

---

## 4. Arrays

### Basics

```sql
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    scores INTEGER[]
);

INSERT INTO articles (title, tags, scores) VALUES
    ('PostgreSQL Tips', ARRAY['postgresql', 'database', 'tips'], ARRAY[10, 8, 9]),
    ('Redis Caching', '{redis,caching,performance}', '{7,9}');
```

### Querying Arrays

```sql
-- Check if array contains a value
SELECT * FROM articles WHERE 'postgresql' = ANY(tags);

-- Check if array contains all values
SELECT * FROM articles WHERE tags @> ARRAY['postgresql', 'tips'];

-- Check if arrays overlap (share any element)
SELECT * FROM articles WHERE tags && ARRAY['redis', 'postgresql'];

-- Array length
SELECT title, array_length(tags, 1) AS tag_count FROM articles;

-- Access element (1-indexed!)
SELECT tags[1] FROM articles;  -- first element
```

### Array Aggregation and Unnest

```sql
-- Aggregate values into an array
SELECT
    customer_id,
    array_agg(product_name ORDER BY product_name) AS purchased_products
FROM order_items oi
JOIN products p ON p.id = oi.product_id
GROUP BY customer_id;

-- Unnest: expand array into rows
SELECT id, title, unnest(tags) AS tag
FROM articles;

-- Unnest with ordinality (get position)
SELECT id, title, tag, pos
FROM articles, unnest(tags) WITH ORDINALITY AS t(tag, pos);
```

### Index Arrays

```sql
-- GIN index for array containment queries
CREATE INDEX idx_articles_tags ON articles USING GIN(tags);
-- Supports: @>, &&, = ANY()
```

---

## 5. Full-Text Search

### Basic Setup

```sql
-- Add tsvector column (stored, indexed)
ALTER TABLE articles ADD COLUMN search_vector tsvector;

-- Populate from existing data
UPDATE articles SET search_vector =
    setweight(to_tsvector('portuguese', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('portuguese', COALESCE(body, '')), 'B');

-- Keep it updated with a trigger
CREATE OR REPLACE FUNCTION articles_search_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('portuguese', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('portuguese', COALESCE(NEW.body, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_articles_search
BEFORE INSERT OR UPDATE OF title, body ON articles
FOR EACH ROW EXECUTE FUNCTION articles_search_update();

-- GIN index on the tsvector column
CREATE INDEX idx_articles_search ON articles USING GIN(search_vector);
```

### Searching

```sql
-- Basic search
SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('portuguese', 'postgresql & otimização') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- Prefix search (autocomplete)
SELECT title
FROM articles
WHERE search_vector @@ to_tsquery('portuguese', 'post:*');

-- Phrase search (words in order)
SELECT title
FROM articles
WHERE search_vector @@ phraseto_tsquery('portuguese', 'banco de dados');

-- Highlight matches
SELECT
    title,
    ts_headline('portuguese', body, to_tsquery('portuguese', 'postgresql'),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') AS excerpt
FROM articles
WHERE search_vector @@ to_tsquery('portuguese', 'postgresql');
```

### FTS Configuration

```sql
-- List available configurations
SELECT cfgname FROM pg_ts_config;

-- Use 'portuguese' for PT-BR content, 'english' for EN
-- 'simple' for no stemming (exact word matching)

-- Custom dictionary for project-specific terms
-- (Usually overkill — 'portuguese' or 'english' covers 95% of cases)
```

---

## 6. Generated Columns

```sql
-- Stored generated columns (PostgreSQL 12+)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    price_cents INTEGER NOT NULL,
    tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0,
    -- Automatically computed and stored
    tax_cents INTEGER GENERATED ALWAYS AS (ROUND(price_cents * tax_rate)::integer) STORED,
    full_name TEXT,
    -- Search-friendly slug
    search_name TEXT GENERATED ALWAYS AS (lower(regexp_replace(full_name, '\s+', '-', 'g'))) STORED
);

-- You can index generated columns normally
CREATE INDEX idx_products_search_name ON products(search_name);

-- WRONG: trying to INSERT/UPDATE a generated column
INSERT INTO products (price_cents, tax_rate, tax_cents) VALUES (1000, 0.10, 100);
-- ERROR: cannot insert a non-DEFAULT value into column "tax_cents"

-- CORRECT: omit generated columns
INSERT INTO products (price_cents, tax_rate, full_name)
VALUES (1000, 0.10, 'Widget Pro');
-- tax_cents = 100 (auto-computed)
```

---

## 7. UPSERT (INSERT ON CONFLICT)

### Basic UPSERT

```sql
-- Insert or update on unique constraint violation
INSERT INTO user_settings (user_id, key, value)
VALUES (1, 'theme', 'dark')
ON CONFLICT (user_id, key) DO UPDATE
SET value = EXCLUDED.value;

-- EXCLUDED refers to the row that was proposed for insertion
```

### Conditional UPSERT

```sql
-- Only update if the new value is "newer"
INSERT INTO product_prices (product_id, price_cents, updated_at)
VALUES (42, 1999, NOW())
ON CONFLICT (product_id) DO UPDATE
SET price_cents = EXCLUDED.price_cents,
    updated_at = EXCLUDED.updated_at
WHERE product_prices.updated_at < EXCLUDED.updated_at;
```

### DO NOTHING

```sql
-- Insert if not exists, skip if exists (no error)
INSERT INTO tags (name, slug)
VALUES ('PostgreSQL', 'postgresql')
ON CONFLICT (slug) DO NOTHING;
```

### Bulk UPSERT

```sql
-- Upsert multiple rows
INSERT INTO inventory (product_id, warehouse_id, quantity)
VALUES
    (1, 1, 100),
    (1, 2, 50),
    (2, 1, 200)
ON CONFLICT (product_id, warehouse_id) DO UPDATE
SET quantity = inventory.quantity + EXCLUDED.quantity;
```

### UPSERT with RETURNING

```sql
-- Know if a row was inserted or updated
INSERT INTO users (email, name)
VALUES ('bruno@example.com', 'Bruno')
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name
RETURNING *, (xmax = 0) AS was_inserted;
-- xmax = 0 means the row was freshly inserted
-- xmax != 0 means the row was updated
```

---

## 8. Lateral Joins

### Problem: Get Top-N Per Group Efficiently

```sql
-- WRONG: subquery fetches ALL orders, then filters in outer query
SELECT c.name,
    (SELECT SUM(total_amount) FROM orders WHERE customer_id = c.id) AS total
FROM customers c;
-- This is a correlated subquery — runs once per customer, cannot use indexes well

-- CORRECT: LATERAL join — like a correlated subquery but more powerful
SELECT c.name, recent_orders.*
FROM customers c
CROSS JOIN LATERAL (
    SELECT id, total_amount, created_at
    FROM orders
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 3
) recent_orders;
-- LATERAL can reference columns from preceding tables (c.id)
-- The subquery runs per customer but can use indexes efficiently
```

### LATERAL with LEFT JOIN

```sql
-- Include customers with no orders (LEFT JOIN LATERAL)
SELECT c.name, recent_orders.*
FROM customers c
LEFT JOIN LATERAL (
    SELECT id, total_amount, created_at
    FROM orders
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 3
) recent_orders ON true;
-- "ON true" because the correlation is inside the LATERAL subquery
```

### LATERAL for Unnesting

```sql
-- Expand JSONB array and join with main data
SELECT
    o.id AS order_id,
    item->>'product_id' AS product_id,
    (item->>'quantity')::int AS quantity
FROM orders o
CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item;
```

---

## 9. DISTINCT ON

PostgreSQL-specific feature for getting the first row per group.

```sql
-- Get most recent order per customer
-- WRONG: requires GROUP BY + subquery or window function
SELECT o.*
FROM orders o
JOIN (
    SELECT customer_id, MAX(created_at) AS max_created
    FROM orders
    GROUP BY customer_id
) latest ON o.customer_id = latest.customer_id AND o.created_at = latest.max_created;
-- Problem: ties on created_at return multiple rows

-- CORRECT: DISTINCT ON (concise, unambiguous)
SELECT DISTINCT ON (customer_id)
    id, customer_id, total_amount, status, created_at
FROM orders
ORDER BY customer_id, created_at DESC;
-- Returns exactly one row per customer_id: the one with the latest created_at
```

```sql
-- WRONG: ORDER BY doesn't match DISTINCT ON
SELECT DISTINCT ON (customer_id) *
FROM orders
ORDER BY created_at DESC;
-- ERROR: SELECT DISTINCT ON expressions must match initial ORDER BY expressions

-- CORRECT: DISTINCT ON columns must be the leftmost ORDER BY columns
SELECT DISTINCT ON (customer_id) *
FROM orders
ORDER BY customer_id, created_at DESC;

-- If you want the final result in a different order, wrap it:
SELECT * FROM (
    SELECT DISTINCT ON (customer_id) *
    FROM orders
    ORDER BY customer_id, created_at DESC
) latest_orders
ORDER BY created_at DESC;
```

### Use Cases

```sql
-- Latest status per entity
SELECT DISTINCT ON (ticket_id)
    ticket_id, status, changed_at, changed_by
FROM ticket_status_history
ORDER BY ticket_id, changed_at DESC;

-- Latest price per product
SELECT DISTINCT ON (product_id)
    product_id, price_cents, effective_from
FROM product_price_history
ORDER BY product_id, effective_from DESC;
```

---

## 10. LISTEN / NOTIFY

### Real-Time Notifications from Database

```sql
-- Publisher: send notifications when rows change
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'order_changes',
        json_build_object(
            'action', TG_OP,
            'order_id', NEW.id,
            'status', NEW.status,
            'customer_id', NEW.customer_id
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_notify
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION notify_order_change();
```

```sql
-- Subscriber: listen for notifications
LISTEN order_changes;

-- In application code (e.g., Node.js with pg library):
-- client.query('LISTEN order_changes');
-- client.on('notification', (msg) => {
--     const data = JSON.parse(msg.payload);
--     console.log('Order changed:', data);
-- });
```

### Limitations

```sql
-- Payload is limited to 8000 bytes
-- NOTIFY is transactional — only fires on COMMIT
-- No persistence — if no one is listening, the notification is lost
-- For durable events, use a queue table or Redis pub/sub instead
```

---

## 11. Partitioning

### Range Partitioning (Most Common)

```sql
-- Partition orders by month
CREATE TABLE orders (
    id BIGSERIAL,
    customer_id INTEGER NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create partitions
CREATE TABLE orders_2025_01 PARTITION OF orders
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orders_2025_02 PARTITION OF orders
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- ... create future partitions via cron job or pg_partman

-- Default partition (catches rows that don't match any partition)
CREATE TABLE orders_default PARTITION OF orders DEFAULT;

-- Indexes are created on each partition automatically
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at);
```

### List Partitioning

```sql
-- Partition by region
CREATE TABLE events (
    id BIGSERIAL,
    region TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY LIST (region);

CREATE TABLE events_br PARTITION OF events FOR VALUES IN ('BR');
CREATE TABLE events_us PARTITION OF events FOR VALUES IN ('US');
CREATE TABLE events_eu PARTITION OF events FOR VALUES IN ('EU', 'UK');
CREATE TABLE events_other PARTITION OF events DEFAULT;
```

### Hash Partitioning

```sql
-- Distribute evenly across N partitions (for load balancing)
CREATE TABLE sessions (
    id UUID NOT NULL,
    user_id INTEGER NOT NULL,
    data JSONB,
    expires_at TIMESTAMPTZ NOT NULL
) PARTITION BY HASH (id);

CREATE TABLE sessions_0 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE sessions_1 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE sessions_2 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE sessions_3 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

### When to Partition

```sql
-- Partition when:
-- 1. Table has 100M+ rows
-- 2. Queries always filter by the partition key (date range, tenant, region)
-- 3. You need to drop old data efficiently (DROP partition vs DELETE millions)
-- 4. You want parallel query on partitions

-- DON'T partition when:
-- 1. Table has < 10M rows (overhead not worth it)
-- 2. Queries don't filter by partition key (scans all partitions = slower)
-- 3. You need global unique constraints (only local to partition)
```

---

## 12. Row-Level Security (RLS)

### Setup

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owner (optional, for testing)
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

-- Create policy: users can only see their own projects
CREATE POLICY user_projects ON projects
    FOR ALL
    USING (owner_id = current_setting('app.current_user_id')::int)
    WITH CHECK (owner_id = current_setting('app.current_user_id')::int);

-- Set user context per request
SET app.current_user_id = '42';
SELECT * FROM projects;  -- only shows projects WHERE owner_id = 42
```

### Multiple Policies

```sql
-- Admins can see everything
CREATE POLICY admin_all ON projects
    FOR ALL
    USING (current_setting('app.current_role', true) = 'admin')
    WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- Regular users can only see own projects
CREATE POLICY user_own ON projects
    FOR ALL
    USING (owner_id = current_setting('app.current_user_id')::int)
    WITH CHECK (owner_id = current_setting('app.current_user_id')::int);

-- Policies are combined with OR by default
-- (user sees rows matching ANY policy)
```

### Restrictive Policies

```sql
-- RESTRICTIVE policies are combined with AND (must satisfy ALL)
CREATE POLICY tenant_isolation ON documents
    AS RESTRICTIVE
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::int);

CREATE POLICY user_access ON documents
    AS PERMISSIVE  -- default
    FOR ALL
    USING (
        owner_id = current_setting('app.user_id')::int
        OR is_public = true
    );
-- Result: tenant_id must match AND (owner must match OR is_public)
```

### Per-Operation Policies

```sql
-- Different policies for SELECT, INSERT, UPDATE, DELETE
CREATE POLICY select_own ON documents
    FOR SELECT USING (owner_id = current_setting('app.user_id')::int OR is_public);

CREATE POLICY insert_own ON documents
    FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id')::int);

CREATE POLICY update_own ON documents
    FOR UPDATE USING (owner_id = current_setting('app.user_id')::int)
               WITH CHECK (owner_id = current_setting('app.user_id')::int);

CREATE POLICY delete_own ON documents
    FOR DELETE USING (owner_id = current_setting('app.user_id')::int);
```

---

## 13. Advisory Locks

### Session-Level Locks

```sql
-- Acquire lock (blocks until acquired)
SELECT pg_advisory_lock(12345);

-- Try to acquire (non-blocking, returns true/false)
SELECT pg_try_advisory_lock(12345);

-- Release
SELECT pg_advisory_unlock(12345);
```

### Transaction-Level Locks

```sql
-- Lock is automatically released at end of transaction
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('process-invoices'));
-- ... do exclusive work ...
COMMIT;  -- lock is released
```

### Use Cases

```sql
-- Prevent concurrent cron job execution
-- Key: use a consistent hash of the job name
SELECT pg_try_advisory_lock(hashtext('daily-report-generation'));
-- Returns false if another process already holds it

-- Prevent concurrent updates to the same entity
-- Use two-argument form: (namespace, entity_id)
SELECT pg_advisory_xact_lock(1, 42);  -- lock entity 42 in namespace 1

-- Idempotent migrations or one-time operations
DO $$
BEGIN
    IF pg_try_advisory_lock(hashtext('migration-backfill-v2')) THEN
        -- Run backfill...
        PERFORM pg_advisory_unlock(hashtext('migration-backfill-v2'));
    ELSE
        RAISE NOTICE 'Backfill already running, skipping';
    END IF;
END $$;
```

### Monitoring Locks

```sql
-- See current advisory locks
SELECT * FROM pg_locks WHERE locktype = 'advisory';

-- See who is waiting
SELECT
    pid,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';
```
