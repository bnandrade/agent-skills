# Data Modeling

Practical data modeling patterns for PostgreSQL. Normalization, relationships, common schema patterns, and evolution strategies.

---

## Table of Contents

1. [Normalization (Practical Guide)](#1-normalization-practical-guide)
2. [When to Denormalize](#2-when-to-denormalize)
3. [Relationship Design](#3-relationship-design)
4. [Polymorphic Associations](#4-polymorphic-associations)
5. [Self-Referential Relationships](#5-self-referential-relationships)
6. [Soft Delete Design](#6-soft-delete-design)
7. [Audit Trail Patterns](#7-audit-trail-patterns)
8. [Multi-Tenant Schema Design](#8-multi-tenant-schema-design)
9. [Primary Key Strategy](#9-primary-key-strategy)
10. [Enum Columns](#10-enum-columns)
11. [Common Schema Patterns](#11-common-schema-patterns)
12. [Schema Evolution](#12-schema-evolution)

---

## 1. Normalization (Practical Guide)

### 1NF — Atomic Values

Each column holds a single value. No arrays-in-text, no CSV strings.

```sql
-- WRONG: multiple values in one column
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone_numbers TEXT  -- '11999990000,11888880000'
);

-- CORRECT: separate table for multi-valued attributes
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE contact_phones (
    id SERIAL PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'mobile'  -- mobile, work, home
);
```

**Exception:** PostgreSQL arrays are fine when you query the whole set and don't need to JOIN on individual values:

```sql
-- Acceptable: tags as array when you always read/write the full list
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}'
);
-- Query: WHERE 'postgresql' = ANY(tags)
-- Index: CREATE INDEX idx_articles_tags ON articles USING GIN(tags);
```

### 2NF — No Partial Dependencies

Every non-key column depends on the **entire** primary key, not just part of it. Only matters with composite primary keys.

```sql
-- WRONG: student_name depends only on student_id, not on (student_id, course_id)
CREATE TABLE enrollments (
    student_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,   -- partial dependency
    course_name TEXT NOT NULL,    -- partial dependency
    grade CHAR(1),
    PRIMARY KEY (student_id, course_id)
);

-- CORRECT: separate entities, junction table with only relationship data
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE enrollments (
    student_id INTEGER NOT NULL REFERENCES students(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    grade CHAR(1),
    PRIMARY KEY (student_id, course_id)
);
```

### 3NF — No Transitive Dependencies

Non-key columns depend only on the primary key, not on other non-key columns.

```sql
-- WRONG: city and state depend on zip_code, not on user.id
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    zip_code TEXT,
    city TEXT,     -- depends on zip_code, not user.id
    state TEXT     -- depends on zip_code, not user.id
);

-- CORRECT: separate address lookup (if you need zip normalization)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    zip_code TEXT,
    city TEXT,
    state TEXT
);
-- In practice: 3NF zip normalization is overkill for most apps.
-- Store city/state on user directly. Normalize only if you actually
-- maintain a zip code database and need consistency.
```

**Pragmatic rule:** Normalize until it hurts, then denormalize where it helps. Most production schemas are 3NF with strategic denormalization.

### BCNF — Boyce-Codd Normal Form

Every determinant is a candidate key. Rarely matters in practice. Example where it does:

```sql
-- Problem: a teacher can only teach one subject, but a subject can have multiple teachers
-- student_id + subject determines teacher (but teacher determines subject too)

-- BCNF solution: separate the teacher-subject dependency
CREATE TABLE teacher_subjects (
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    PRIMARY KEY (teacher_id),  -- one subject per teacher
    UNIQUE (teacher_id, subject_id)
);
CREATE TABLE enrollments (
    student_id INTEGER NOT NULL REFERENCES students(id),
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    PRIMARY KEY (student_id, teacher_id)
);
```

---

## 2. When to Denormalize

### Materialized Views

Best for expensive aggregations that don't need real-time data.

```sql
-- Expensive query: monthly revenue by product category
CREATE MATERIALIZED VIEW mv_monthly_revenue AS
SELECT
    date_trunc('month', o.created_at) AS month,
    c.name AS category,
    SUM(oi.quantity * oi.unit_price) AS revenue,
    COUNT(DISTINCT o.id) AS order_count
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
JOIN categories c ON c.id = p.category_id
WHERE o.status = 'completed'
GROUP BY 1, 2;

-- Index the materialized view
CREATE UNIQUE INDEX idx_mv_monthly_revenue ON mv_monthly_revenue(month, category);

-- Refresh (run via cron or after batch operations)
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_revenue;
```

### Computed / Denormalized Columns

Store a computed value to avoid repeated JOINs or aggregations.

```sql
-- orders.total_amount — denormalized from order_items
ALTER TABLE orders ADD COLUMN total_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Keep it in sync with a trigger
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET total_amount = (
        SELECT COALESCE(SUM(quantity * unit_price), 0)
        FROM order_items WHERE order_id = NEW.order_id
    )
    WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION update_order_total();
```

### Generated Columns (PostgreSQL 12+)

Stored computed values maintained automatically by the database.

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    -- Generated column: always consistent, no trigger needed
    total_cents INTEGER GENERATED ALWAYS AS (price_cents * quantity) STORED
);
```

### JSON Columns for Flexible/Sparse Data

```sql
-- WRONG: 50 nullable columns for rarely-used fields
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    size TEXT,
    weight_kg NUMERIC,
    battery_mah INTEGER,
    screen_size NUMERIC,
    ram_gb INTEGER
    -- ... 40 more sparse columns
);

-- CORRECT: structured core + JSONB for flexible attributes
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    price_cents INTEGER NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'
);
-- Query: WHERE attributes->>'color' = 'red'
-- Index: CREATE INDEX idx_products_attrs ON products USING GIN(attributes);
```

---

## 3. Relationship Design

### One-to-One

```sql
-- Separate table when: data is large, rarely accessed, or has different access patterns
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);
CREATE TABLE user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    avatar_url TEXT,
    social_links JSONB DEFAULT '{}'
);
-- UNIQUE on user_id enforces one-to-one
```

### One-to-Many

```sql
-- Standard FK on the "many" side
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TIMESTAMPTZ
);
CREATE INDEX idx_posts_author ON posts(author_id);
```

### Many-to-Many

```sql
-- Junction table with composite PK
CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);
-- Index for reverse lookup (tag -> posts)
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);
```

### Many-to-Many with Attributes

```sql
-- When the relationship itself has data
CREATE TABLE course_enrollments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    grade CHAR(1),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dropped')),
    UNIQUE (student_id, course_id)
);
```

### Choosing ON DELETE Behavior

```sql
-- CASCADE: child rows are deleted when parent is deleted
-- Use for: components that cannot exist without parent
user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE

-- RESTRICT (default): prevent parent deletion if children exist
-- Use for: important business entities that should not be accidentally removed
customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT

-- SET NULL: set FK to NULL when parent is deleted
-- Use for: optional relationships where child can exist without parent
assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL

-- WRONG: CASCADE on financial records
-- Deleting a customer should NOT delete their invoices
invoice_id REFERENCES customers(id) ON DELETE CASCADE  -- DATA LOSS RISK

-- CORRECT: RESTRICT and use soft delete instead
customer_id REFERENCES customers(id) ON DELETE RESTRICT
```

---

## 4. Polymorphic Associations

### The Problem

"A comment can belong to a post, a video, or a product."

### Anti-Pattern: The Rails Way (Single Table Polymorphism)

```sql
-- WRONG: no FK constraint possible
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    commentable_type TEXT NOT NULL,  -- 'Post', 'Video', 'Product'
    commentable_id INTEGER NOT NULL, -- FK to... which table?
    body TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id)
);
-- Problems:
-- 1. No FOREIGN KEY constraint (database cannot enforce integrity)
-- 2. No JOIN without dynamic SQL or UNION
-- 3. commentable_id 42 in type 'Post' is not the same as 42 in type 'Video'
-- 4. Index on (commentable_type, commentable_id) but no FK check
```

### Pattern A: Separate FK Columns (Exclusive Belongs To)

```sql
-- CORRECT: one nullable FK per target, with a CHECK constraint
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- Exactly one FK must be set
    CONSTRAINT chk_one_parent CHECK (
        (post_id IS NOT NULL)::int +
        (video_id IS NOT NULL)::int +
        (product_id IS NOT NULL)::int = 1
    )
);
-- Pro: real FK constraints, simple queries
-- Con: new column per type, NULLs in most FK columns
-- Best when: 2-4 types, unlikely to add more
```

### Pattern B: Separate Join Tables

```sql
-- CORRECT: each relationship gets its own table
CREATE TABLE post_comments (
    comment_id INTEGER PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE
);
CREATE TABLE video_comments (
    comment_id INTEGER PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE
);
-- Pro: clean FK constraints, easy to add new types
-- Con: extra tables, need UNION for "all comments on anything"
-- Best when: many types, or types added over time
```

### Pattern C: Separate Comment Tables

```sql
-- CORRECT: each parent type has its own comments table
CREATE TABLE post_comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE video_comments (
    id SERIAL PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id)
);
-- Pro: simplest, cleanest FK, best performance per type
-- Con: duplicated schema, harder to do "all comments by user X"
-- Best when: types have different fields or access patterns
```

**Recommendation:** Use Pattern A for 2-3 types. Use Pattern B for 4+ types or when new types are added frequently. Avoid Rails-style polymorphism in PostgreSQL.

---

## 5. Self-Referential Relationships

### Simple Parent-Child (Adjacency List)

```sql
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

-- Get direct children
SELECT * FROM categories WHERE parent_id = 5;

-- Get full tree (recursive CTE)
WITH RECURSIVE tree AS (
    SELECT id, name, parent_id, 0 AS depth, ARRAY[id] AS path
    FROM categories
    WHERE parent_id IS NULL  -- root nodes
    UNION ALL
    SELECT c.id, c.name, c.parent_id, t.depth + 1, t.path || c.id
    FROM categories c
    JOIN tree t ON c.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;
```

### Materialized Path (Fast Reads)

```sql
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL  -- '/1/5/12/' — ancestors as string
);
CREATE INDEX idx_categories_path ON categories USING BTREE(path text_pattern_ops);

-- Get all descendants of category 5
SELECT * FROM categories WHERE path LIKE '/1/5/%';

-- Get all ancestors of category 12 (path = '/1/5/12/')
-- Parse the path in application code or use string_to_array
```

### Org Chart Example

```sql
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    title TEXT NOT NULL
);

-- Find all reports (direct and indirect) for a manager
WITH RECURSIVE reports AS (
    SELECT id, name, title, manager_id, 1 AS level
    FROM employees
    WHERE manager_id = 1  -- CEO's direct reports
    UNION ALL
    SELECT e.id, e.name, e.title, e.manager_id, r.level + 1
    FROM employees e
    JOIN reports r ON e.manager_id = r.id
)
SELECT * FROM reports ORDER BY level, name;
```

### ltree Extension (PostgreSQL-Specific)

```sql
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    path ltree NOT NULL
);
CREATE INDEX idx_categories_ltree ON categories USING GIST(path);

-- Insert
INSERT INTO categories (name, path) VALUES
    ('Electronics', 'electronics'),
    ('Phones', 'electronics.phones'),
    ('Smartphones', 'electronics.phones.smartphones');

-- All descendants of electronics
SELECT * FROM categories WHERE path <@ 'electronics';

-- All ancestors of smartphones
SELECT * FROM categories WHERE path @> 'electronics.phones.smartphones';
```

---

## 6. Soft Delete Design

### Option A: deleted_at Timestamp

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    deleted_at TIMESTAMPTZ  -- NULL = active, timestamp = deleted
);

-- Partial unique index: email must be unique among active users
CREATE UNIQUE INDEX idx_users_email_active ON users(email) WHERE deleted_at IS NULL;

-- Partial index for common queries (active only)
CREATE INDEX idx_users_active ON users(id) WHERE deleted_at IS NULL;
```

```sql
-- WRONG: forget to filter deleted records
SELECT * FROM users WHERE email = 'foo@bar.com';

-- CORRECT: always filter
SELECT * FROM users WHERE email = 'foo@bar.com' AND deleted_at IS NULL;

-- Or use a view:
CREATE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL;
```

### Option B: Status Column

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted'))
);
CREATE UNIQUE INDEX idx_users_email_active ON users(email) WHERE status = 'active';
-- Pro: can represent multiple states, not just alive/dead
-- Con: more verbose WHERE clauses
```

### Option C: Archive Table

```sql
-- Move deleted rows to a separate table
CREATE TABLE users_archive (LIKE users INCLUDING ALL);
ALTER TABLE users_archive ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users_archive ADD COLUMN archived_by INTEGER;

-- Delete = move to archive
WITH deleted AS (
    DELETE FROM users WHERE id = 42 RETURNING *
)
INSERT INTO users_archive
SELECT *, NOW(), current_setting('app.current_user_id')::int
FROM deleted;
```

**Recommendation:**
- `deleted_at` — simplest, works for most cases, use partial indexes
- Status column — when you need more states than active/deleted
- Archive table — when deleted data is large and you want to keep main table fast

---

## 7. Audit Trail Patterns

### Pattern A: Trigger-Based Audit Log

```sql
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    old_data JSONB,
    new_data JSONB,
    changed_by TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_changed_at ON audit_log(changed_at);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log(table_name, record_id, action, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW),
                current_setting('app.current_user_id', true));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log(table_name, record_id, action, old_data, new_data, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
                current_setting('app.current_user_id', true));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log(table_name, record_id, action, old_data, changed_by)
        VALUES (TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD),
                current_setting('app.current_user_id', true));
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Apply to any table
CREATE TRIGGER trg_users_audit
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

### Pattern B: Event Sourcing Table

```sql
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,   -- 'Order', 'User'
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,       -- 'OrderPlaced', 'OrderShipped'
    payload JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',   -- user_id, ip, request_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id, created_at);

-- Rebuild current state from events
SELECT payload FROM events
WHERE aggregate_type = 'Order' AND aggregate_id = '123'
ORDER BY created_at;
```

### Pattern C: Temporal Tables (System-Versioned)

```sql
-- PostgreSQL doesn't have native temporal tables like SQL Server,
-- but you can emulate them with range types:
CREATE TABLE products (
    id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ NOT NULL DEFAULT 'infinity',
    PRIMARY KEY (id, valid_from)
);

-- "Update" = close current row, insert new one
-- Close old version
UPDATE products SET valid_to = NOW()
WHERE id = 1 AND valid_to = 'infinity';
-- Insert new version
INSERT INTO products (id, name, price_cents)
VALUES (1, 'Widget', 1999);

-- Query current state
SELECT * FROM products WHERE id = 1 AND valid_to = 'infinity';

-- Query state at a point in time
SELECT * FROM products
WHERE id = 1 AND valid_from <= '2025-06-15' AND valid_to > '2025-06-15';
```

---

## 8. Multi-Tenant Schema Design

### Option A: Shared Table with tenant_id (Row-Level)

```sql
-- Every table has a tenant_id column
CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRITICAL: composite index with tenant_id first
CREATE INDEX idx_projects_tenant ON projects(tenant_id, created_at DESC);

-- Row-Level Security (RLS) to enforce isolation
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::int)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::int);

-- Set tenant context per request
SET app.current_tenant_id = '42';
SELECT * FROM projects;  -- automatically filtered to tenant 42
```

```sql
-- WRONG: forget tenant_id in queries
SELECT * FROM projects WHERE name ILIKE '%demo%';

-- CORRECT: always filter by tenant (or use RLS)
SELECT * FROM projects
WHERE tenant_id = 42 AND name ILIKE '%demo%';
```

**Pro:** Simple, single database, easy backups, efficient storage.
**Con:** Must remember tenant_id on every query (RLS helps), noisy neighbor risk.

### Option B: Schema per Tenant

```sql
-- Each tenant gets their own PostgreSQL schema
CREATE SCHEMA tenant_acme;
CREATE TABLE tenant_acme.projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Switch schema per request
SET search_path TO tenant_acme, public;
SELECT * FROM projects;  -- queries tenant_acme.projects
```

**Pro:** Strong isolation, easy to drop tenant, per-tenant backups possible.
**Con:** Many schemas = more complex migrations (must run on ALL schemas), higher connection overhead.

### Option C: Database per Tenant

```sql
-- Each tenant gets their own database
-- Pro: strongest isolation, independent scaling, simple backups
-- Con: most operational complexity, many connections, migrations on all DBs
-- Only justified for: compliance requirements, very large tenants, regulated industries
```

**Recommendation:** Start with Option A (shared table + RLS) for most SaaS apps. Move to Option B only when isolation requirements demand it.

---

## 9. Primary Key Strategy

### SERIAL / BIGSERIAL (Auto-Increment)

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,       -- 4 bytes, max ~2 billion
    -- or
    id BIGSERIAL PRIMARY KEY,    -- 8 bytes, max ~9.2 quintillion
    name TEXT NOT NULL
);
```

**Pro:** Small, fast, sorted by insertion order, great for B-tree indexes.
**Con:** Predictable (security risk in URLs), doesn't work across distributed systems, merging databases is painful.

### UUID v4 (Random)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL
);
```

**Pro:** Globally unique, safe for URLs, merge-friendly, no coordination needed.
**Con:** 16 bytes (vs 4), random = poor B-tree locality, slower inserts on large tables, harder to debug ("which user is a1b2c3d4...?").

### UUID v7 / ULID (Time-Ordered)

```sql
-- UUID v7: time-ordered UUID (PostgreSQL 17+ has native support)
-- Before PG 17, use an extension or generate in application code
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),  -- PG 17+
    name TEXT NOT NULL
);

-- ULID alternative (26 chars, base32, time-ordered)
-- Generate in application code, store as TEXT or convert to UUID
CREATE TABLE users (
    id TEXT PRIMARY KEY CHECK (length(id) = 26),  -- ULID
    name TEXT NOT NULL
);
```

**Pro:** Globally unique AND time-ordered (good B-tree locality), sortable by creation time.
**Con:** 16 bytes for UUID v7, application-level generation for older PG versions.

### Decision Matrix

| Factor | SERIAL | UUID v4 | UUID v7 / ULID |
|---|---|---|---|
| Size | 4-8 bytes | 16 bytes | 16 bytes (UUID) / 26 chars (ULID) |
| Insert performance | Best | Worst (random I/O) | Good (sequential) |
| URL-safe | No (enumerable) | Yes | Yes |
| Distributed generation | No | Yes | Yes |
| Sortable by time | Yes | No | Yes |
| **Recommendation** | Internal tables, high-volume | External IDs, legacy | **Default choice for new projects** |

---

## 10. Enum Columns

### Option A: TEXT with CHECK Constraint

```sql
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled'))
);
```

**Pro:** Simple, easy to add values (ALTER TABLE ... DROP CONSTRAINT, ADD CONSTRAINT), standard SQL.
**Con:** No auto-complete in tools, stored as full text (more bytes).

### Option B: Native ENUM Type

```sql
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status order_status NOT NULL DEFAULT 'pending'
);
```

```sql
-- Adding a value is easy (PG 9.1+)
ALTER TYPE order_status ADD VALUE 'refunded' AFTER 'cancelled';

-- DANGER: you CANNOT remove or rename values from a native ENUM
-- You'd have to: create new type, migrate data, drop old type
-- This makes native ENUMs painful for evolving schemas
```

**Pro:** 4 bytes storage (efficient), type safety.
**Con:** Cannot remove values, renaming is painful, schema migrations are complex.

### Option C: Lookup Table

```sql
CREATE TABLE order_statuses (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO order_statuses (name, display_name, sort_order) VALUES
    ('pending', 'Pending', 1),
    ('processing', 'Processing', 2),
    ('shipped', 'Shipped', 3),
    ('delivered', 'Delivered', 4),
    ('cancelled', 'Cancelled', 5);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status_id INTEGER NOT NULL REFERENCES order_statuses(id)
);
```

**Pro:** Full CRUD on values, extra metadata, FK integrity.
**Con:** Extra JOIN, more complex queries, overkill for simple enums.

**Recommendation:**
- 2-5 values, rarely changes: TEXT with CHECK
- 5+ values or needs metadata: Lookup table
- Avoid native ENUM: the migration pain isn't worth the 4-byte savings

---

## 11. Common Schema Patterns

### Users / Roles / Permissions (RBAC)

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,       -- 'admin', 'editor', 'viewer'
    description TEXT
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,       -- 'posts.create', 'posts.delete', 'users.manage'
    description TEXT
);

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Check if user has permission
SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = 1 AND p.name = 'posts.create'
) AS has_permission;
```

### Tags / Taggables

```sql
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

-- Option A: separate join table per type (preferred)
CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);
CREATE TABLE product_tags (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, tag_id)
);
```

### Settings / Preferences (Key-Value)

```sql
-- WRONG: one column per setting
CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    theme TEXT DEFAULT 'light',
    language TEXT DEFAULT 'pt-BR',
    notifications_email BOOLEAN DEFAULT true,
    notifications_push BOOLEAN DEFAULT true
    -- adding a new setting = migration
);

-- CORRECT for many/dynamic settings: JSONB column
CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'
);
-- Query: SELECT settings->>'theme' FROM user_settings WHERE user_id = 1;
-- Update: UPDATE user_settings SET settings = settings || '{"theme":"dark"}' WHERE user_id = 1;

-- ALSO CORRECT for typed, queryable settings: EAV with type safety
CREATE TABLE user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
```

### Addresses (Shared)

```sql
CREATE TABLE addresses (
    id SERIAL PRIMARY KEY,
    street TEXT NOT NULL,
    number TEXT,
    complement TEXT,
    neighborhood TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'BR',
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7)
);

-- Link to entities
CREATE TABLE user_addresses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'home',  -- home, work, billing, shipping
    is_default BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, address_id)
);
```

---

## 12. Schema Evolution

### Adding Columns Safely

```sql
-- Safe: add nullable column (instant, no table rewrite)
ALTER TABLE users ADD COLUMN phone TEXT;

-- Safe: add column with DEFAULT (PG 11+, instant for most types)
ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false;

-- DANGEROUS: adding NOT NULL without DEFAULT on existing table
-- WRONG (fails if table has rows):
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL;

-- CORRECT: add with default, then remove default if desired
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
```

### Renaming Columns (Expand and Contract)

```sql
-- WRONG: rename directly (breaks all code referencing old name)
ALTER TABLE users RENAME COLUMN name TO full_name;  -- instant downtime

-- CORRECT: expand-and-contract pattern
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN full_name TEXT;

-- Step 2: Backfill
UPDATE users SET full_name = name WHERE full_name IS NULL;

-- Step 3: Add NOT NULL constraint (after backfill)
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;

-- Step 4: Update application code to write to BOTH columns, read from new
-- Step 5: Deploy code that reads only from new column
-- Step 6: Drop old column
ALTER TABLE users DROP COLUMN name;
```

### Changing Column Types

```sql
-- WRONG: direct type change (locks table, may fail)
ALTER TABLE orders ALTER COLUMN status TYPE INTEGER USING status::integer;

-- CORRECT: expand-and-contract
-- Step 1: Add new column
ALTER TABLE orders ADD COLUMN status_new INTEGER;
-- Step 2: Backfill with conversion
UPDATE orders SET status_new = CASE status
    WHEN 'pending' THEN 1
    WHEN 'shipped' THEN 2
    WHEN 'delivered' THEN 3
END;
-- Step 3: Add constraints
ALTER TABLE orders ALTER COLUMN status_new SET NOT NULL;
-- Step 4: Update app code
-- Step 5: Drop old column
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN status_new TO status;
```

### Adding Unique Constraints

```sql
-- WRONG: adds index with table lock
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- CORRECT: create index concurrently, then add constraint using the index
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email_unique ON users(email);
-- Then add constraint using existing index (instant)
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE USING INDEX idx_users_email_unique;
```

### Dropping Columns Safely

```sql
-- Step 1: Stop reading the column in application code (deploy first)
-- Step 2: Stop writing the column in application code (deploy)
-- Step 3: Drop the column
ALTER TABLE users DROP COLUMN legacy_field;

-- WRONG: drop column while code still references it
-- Always remove code references BEFORE dropping the column
```

### Adding Foreign Keys to Existing Tables

```sql
-- WRONG: adding FK with validation on large table (long lock)
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id);

-- CORRECT: add NOT VALID first (instant), then validate separately
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    NOT VALID;

-- Validate without holding a long lock (ShareUpdateExclusiveLock)
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_customer;
```
