# Migrations

Safe migration practices, zero-downtime schema changes, expand-and-contract pattern, and Laravel migration conventions.

---

## Table of Contents

1. [Migration Best Practices](#1-migration-best-practices)
2. [Safe Column Operations](#2-safe-column-operations)
3. [Dangerous Operations Done Safely](#3-dangerous-operations-done-safely)
4. [Zero-Downtime Migrations](#4-zero-downtime-migrations)
5. [CREATE INDEX CONCURRENTLY](#5-create-index-concurrently)
6. [Large Data Backfills](#6-large-data-backfills)
7. [Migration Testing](#7-migration-testing)
8. [Rollback Strategies](#8-rollback-strategies)
9. [Migration Ordering in Teams](#9-migration-ordering-in-teams)
10. [Laravel Migration Conventions](#10-laravel-migration-conventions)
11. [Schema Seeding](#11-schema-seeding)

---

## 1. Migration Best Practices

### One Change per Migration

```sql
-- WRONG: multiple unrelated changes in one migration
-- Migration: 2025_06_15_add_features.sql
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
CREATE TABLE invoices (...);
CREATE INDEX idx_products_category ON products(category_id);

-- CORRECT: one logical change per migration
-- 2025_06_15_001_add_users_phone.sql
ALTER TABLE users ADD COLUMN phone TEXT;

-- 2025_06_15_002_add_orders_tracking.sql
ALTER TABLE orders ADD COLUMN tracking_number TEXT;

-- 2025_06_15_003_create_invoices.sql
CREATE TABLE invoices (...);
```

**Why:** If migration 3 fails, you can roll back only that migration. With everything in one file, you roll back all or nothing.

### Reversible Migrations

```sql
-- Every migration should have a clear rollback path

-- Up:
ALTER TABLE users ADD COLUMN phone TEXT;
-- Down:
ALTER TABLE users DROP COLUMN phone;

-- Up:
CREATE INDEX idx_orders_status ON orders(status);
-- Down:
DROP INDEX idx_orders_status;
```

```sql
-- Some operations are NOT reversible:
-- - DROP TABLE (data is gone)
-- - DROP COLUMN (data is gone)
-- - Data transformations (original values lost)

-- For these: take a backup reference or use expand-and-contract
```

### Idempotent Migrations

```sql
-- WRONG: fails if run twice
CREATE TABLE users (...);
-- ERROR: relation "users" already exists

-- CORRECT: idempotent (safe to re-run)
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- For ALTER TABLE (no IF NOT EXISTS):
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'phone'
    ) THEN
        ALTER TABLE users ADD COLUMN phone TEXT;
    END IF;
END $$;
```

### Transaction Safety

```sql
-- WRONG: mix DDL and DML in one transaction (risky on large tables)
BEGIN;
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
UPDATE users SET status = 'active';  -- locks entire table
ALTER TABLE users ALTER COLUMN status SET NOT NULL;
COMMIT;

-- CORRECT: separate steps
-- Migration 1: add column (instant in PG 11+)
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';

-- Migration 2: backfill (batched, no long lock)
-- See "Large Data Backfills" section

-- Migration 3: add constraint
ALTER TABLE users ALTER COLUMN status SET NOT NULL;
```

---

## 2. Safe Column Operations

### Add Column (Always Safe)

```sql
-- Adding a nullable column: instant, no table rewrite
ALTER TABLE users ADD COLUMN phone TEXT;

-- Adding column with DEFAULT: instant in PG 11+ (stored in catalog, not table)
ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false;
-- PG 10 and below: this rewrites the entire table! Very slow on large tables.

-- Adding column with volatile DEFAULT: rewrites table
ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- NOW() is volatile → table rewrite. Use clock_timestamp() or a constant instead.

-- CORRECT for volatile defaults:
ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ;
UPDATE users SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW();
```

### Add Index (Careful)

```sql
-- WRONG: standard CREATE INDEX locks the table for writes
CREATE INDEX idx_orders_status ON orders(status);
-- Blocks all INSERT/UPDATE/DELETE until index is built

-- CORRECT: use CONCURRENTLY (doesn't block writes)
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);
-- Takes longer, uses more resources, but no lock

-- IMPORTANT: CONCURRENTLY cannot run inside a transaction block
-- WRONG:
BEGIN;
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);
COMMIT;
-- ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
```

### Drop Column (Plan Carefully)

```sql
-- Step 1: Remove all code that reads/writes the column
-- Deploy this change first. Wait for all old processes to drain.

-- Step 2: Drop the column
ALTER TABLE users DROP COLUMN legacy_field;

-- WRONG: drop column while code still references it
-- Old application instances will crash with "column does not exist"
```

### Rename Column (Use Expand-and-Contract)

```sql
-- WRONG: direct rename breaks existing code instantly
ALTER TABLE users RENAME COLUMN name TO full_name;

-- CORRECT: expand-and-contract (3 deploys)

-- Deploy 1: Add new column, start writing to both
ALTER TABLE users ADD COLUMN full_name TEXT;

-- Deploy 2: Backfill, switch reads to new column
UPDATE users SET full_name = name WHERE full_name IS NULL;
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;
-- Update app: read from full_name, write to both name and full_name

-- Deploy 3: Drop old column (after all code uses new column)
ALTER TABLE users DROP COLUMN name;
```

### Change Column Type (Use Expand-and-Contract)

```sql
-- WRONG: ALTER TYPE locks table and may fail
ALTER TABLE orders ALTER COLUMN status TYPE INTEGER USING (
    CASE status WHEN 'pending' THEN 1 WHEN 'active' THEN 2 END
);
-- Full table rewrite + exclusive lock

-- CORRECT: expand-and-contract
-- Step 1: Add new column
ALTER TABLE orders ADD COLUMN status_code INTEGER;

-- Step 2: Backfill
UPDATE orders SET status_code = CASE status
    WHEN 'pending' THEN 1 WHEN 'active' THEN 2 WHEN 'completed' THEN 3
END WHERE status_code IS NULL;

-- Step 3: Dual-write in app (write both columns)
-- Step 4: Switch reads to new column
-- Step 5: Drop old column + rename
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN status_code TO status;
```

---

## 3. Dangerous Operations Done Safely

### Adding NOT NULL to Existing Column

```sql
-- WRONG: direct NOT NULL on populated column scans entire table with lock
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
-- Acquires AccessExclusiveLock, scans all rows to verify no NULLs

-- CORRECT (PG 12+): add NOT NULL check constraint first, then convert
-- Step 1: Add check constraint NOT VALID (instant, no scan)
ALTER TABLE users ADD CONSTRAINT chk_email_not_null
    CHECK (email IS NOT NULL) NOT VALID;

-- Step 2: Validate constraint (scans table without blocking writes)
ALTER TABLE users VALIDATE CONSTRAINT chk_email_not_null;

-- Step 3: Set NOT NULL (PG 12+ recognizes the validated constraint, instant)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

-- Step 4: Drop the now-redundant check constraint
ALTER TABLE users DROP CONSTRAINT chk_email_not_null;
```

### Adding Unique Constraint

```sql
-- WRONG: locks table while building index
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- CORRECT: build index concurrently, then attach as constraint
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email_unique ON users(email);
-- If the index build fails (duplicate values found), fix data, then retry

-- Then add constraint using existing index (instant, no rebuild)
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE USING INDEX idx_users_email_unique;
```

### Adding Foreign Key

```sql
-- WRONG: validates all existing rows with lock
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id);
-- Scans entire orders table to check all customer_ids exist

-- CORRECT: add NOT VALID, then validate separately
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    NOT VALID;
-- Instant: only new rows will be checked

-- Validate existing rows (no AccessExclusiveLock on orders)
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_customer;
-- Takes ShareUpdateExclusiveLock (allows reads and writes)
```

### Dropping a Table

```sql
-- WRONG: drop table while code might reference it
DROP TABLE legacy_reports;

-- CORRECT: multi-step
-- Step 1: Remove all code references to the table (deploy)
-- Step 2: Rename table (as a safety net)
ALTER TABLE legacy_reports RENAME TO _legacy_reports_to_drop;
-- Step 3: Wait a few days (in case something still uses it)
-- Step 4: Drop
DROP TABLE _legacy_reports_to_drop;
```

### Changing Primary Key

```sql
-- EXTREMELY dangerous. Plan carefully.

-- WRONG: drop and recreate PK (locks everything, breaks FKs)
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders ADD PRIMARY KEY (new_id);

-- CORRECT: expand-and-contract
-- Step 1: Add new column
ALTER TABLE orders ADD COLUMN new_id UUID DEFAULT gen_random_uuid();

-- Step 2: Backfill
UPDATE orders SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- Step 3: Add unique index on new column
CREATE UNIQUE INDEX CONCURRENTLY idx_orders_new_id ON orders(new_id);

-- Step 4: Update all foreign keys in other tables to reference new column
-- (This is the hardest part — each FK table needs expand-and-contract too)

-- Step 5: Swap primary key
-- Only after all FKs are migrated
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders ADD PRIMARY KEY USING INDEX idx_orders_new_id;
```

---

## 4. Zero-Downtime Migrations

### The Golden Rules

```
1. NEVER hold locks on large tables for more than a few milliseconds
2. NEVER mix DDL (schema changes) and DML (data changes) in one migration
3. ALWAYS use CONCURRENTLY for CREATE INDEX on production tables
4. ALWAYS use NOT VALID + VALIDATE for new constraints
5. ALWAYS use expand-and-contract for renames and type changes
6. ALWAYS deploy code changes BEFORE schema changes that remove things
7. ALWAYS deploy code changes AFTER schema changes that add things
```

### Deployment Order

```
Adding something new:
1. Add column/table/index (migration)     → deploy
2. Update code to use new column          → deploy

Removing something:
1. Update code to stop using column       → deploy
2. Remove column/table/index (migration)  → deploy

Renaming (expand-and-contract):
1. Add new column                         → deploy
2. Code writes to both, reads from new    → deploy
3. Backfill old rows                      → deploy
4. Code reads/writes only new column      → deploy
5. Drop old column                        → deploy
```

### Lock Timeout

```sql
-- Set a short lock timeout so migrations don't hang
SET lock_timeout = '5s';

-- If the migration can't acquire a lock within 5 seconds, it fails
-- instead of blocking all traffic while waiting for a lock

-- WRONG: migration waits 10 minutes for a lock while app is frozen
ALTER TABLE users ADD COLUMN phone TEXT;
-- (If a long-running query holds an AccessShareLock, this waits)

-- CORRECT: fail fast, retry later
SET lock_timeout = '5s';
ALTER TABLE users ADD COLUMN phone TEXT;
-- If it fails: retry during low-traffic period or after killing long queries
```

### Statement Timeout

```sql
-- Prevent runaway migrations
SET statement_timeout = '60s';
-- If the migration takes longer than 60 seconds, it's cancelled

-- For backfills, use a longer timeout:
SET statement_timeout = '300s';
```

---

## 5. CREATE INDEX CONCURRENTLY

### Why CONCURRENTLY

```sql
-- Standard CREATE INDEX:
-- 1. Acquires ShareLock on table (blocks writes)
-- 2. Scans entire table to build index
-- 3. Releases lock
-- Duration: proportional to table size (minutes for millions of rows)

-- CREATE INDEX CONCURRENTLY:
-- 1. Scans table without blocking writes (two passes)
-- 2. Takes longer overall, but no downtime
-- 3. Cannot run inside a transaction
```

### Usage

```sql
-- Standard (locks table):
CREATE INDEX idx_orders_status ON orders(status);

-- Concurrent (no lock):
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);

-- Concurrent unique index:
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email ON users(email);
```

### Error Handling

```sql
-- If CONCURRENTLY fails (e.g., unique violation, OOM), the index is left INVALID
-- Check for invalid indexes:
SELECT indexrelname, indisvalid
FROM pg_stat_user_indexes
JOIN pg_index ON pg_stat_user_indexes.indexrelid = pg_index.indexrelid
WHERE NOT indisvalid;

-- Fix: drop the invalid index and retry
DROP INDEX CONCURRENTLY idx_orders_status;  -- also use CONCURRENTLY for drop
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);
```

### REINDEX CONCURRENTLY (PG 12+)

```sql
-- Rebuild an existing index without locking
REINDEX INDEX CONCURRENTLY idx_orders_status;

-- Rebuild all indexes on a table
REINDEX TABLE CONCURRENTLY orders;
```

---

## 6. Large Data Backfills

### Batched Updates

```sql
-- WRONG: update all rows at once (locks table, generates huge WAL)
UPDATE users SET status = 'active' WHERE status IS NULL;
-- If table has 10M rows, this locks for minutes and generates GBs of WAL

-- CORRECT: batch by primary key
DO $$
DECLARE
    batch_size INT := 10000;
    last_id INT := 0;
    affected INT;
BEGIN
    LOOP
        UPDATE users
        SET status = 'active'
        WHERE id > last_id
          AND id <= last_id + batch_size
          AND status IS NULL;

        GET DIAGNOSTICS affected = ROW_COUNT;
        last_id := last_id + batch_size;

        -- Commit each batch (in a migration tool, use separate transactions)
        COMMIT;

        -- Small pause to let replicas catch up
        PERFORM pg_sleep(0.1);

        EXIT WHEN affected = 0;
    END LOOP;
END $$;
```

### Backfill with Progress

```sql
-- Track progress for long backfills
CREATE TABLE IF NOT EXISTS backfill_progress (
    name TEXT PRIMARY KEY,
    last_id BIGINT NOT NULL DEFAULT 0,
    rows_processed BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert or update progress
INSERT INTO backfill_progress (name) VALUES ('users_status_backfill')
ON CONFLICT (name) DO NOTHING;

-- In your batch script:
-- 1. Read last_id from backfill_progress
-- 2. Process batch from last_id to last_id + batch_size
-- 3. Update backfill_progress with new last_id
-- If script crashes, restart from last saved position
```

### Off-Peak Backfills

```sql
-- Run during low-traffic hours
-- Check current load before each batch:
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
-- If > 50 active queries, slow down or pause

-- Use pg_sleep between batches to reduce load
PERFORM pg_sleep(0.5);  -- 500ms between batches

-- Monitor replication lag (if using replicas)
SELECT
    client_addr,
    state,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
-- If lag > 100MB, pause backfill
```

---

## 7. Migration Testing

### Test Against Production-Size Data

```sql
-- WRONG: test migrations only on dev database (100 rows)
-- "ALTER TABLE takes 0.001s" → in production (50M rows) takes 30 minutes

-- CORRECT: test on a production-size dataset
-- 1. Restore a production backup to a test environment
-- 2. Run migrations with timing
-- 3. Measure lock duration, WAL generation, replication lag

-- Time a migration
\timing on
ALTER TABLE users ADD COLUMN phone TEXT;
-- Time: 2.345 ms  ← fast enough
```

### Check for Locks

```sql
-- Before running a migration, check what locks it will acquire
-- Use a test database and monitor pg_locks

-- In terminal 1: start the migration in a transaction (don't commit)
BEGIN;
ALTER TABLE users ADD COLUMN phone TEXT;
-- Don't COMMIT yet

-- In terminal 2: check locks
SELECT
    locktype,
    mode,
    granted,
    pid
FROM pg_locks
WHERE relation = 'users'::regclass;
-- Look for: AccessExclusiveLock = blocks everything
-- ShareLock = blocks writes but allows reads
```

### Pre-Flight Checklist

```
Before running a migration in production:
□ Tested on production-size dataset
□ Measured execution time
□ Verified lock mode (no AccessExclusiveLock on large tables)
□ Confirmed rollback plan exists
□ Checked for running long queries that might conflict
□ Set lock_timeout and statement_timeout
□ Scheduled during low-traffic window (if needed)
□ Informed team / set up monitoring
□ Verified backups are recent
```

---

## 8. Rollback Strategies

### Down Migrations

```sql
-- Every up migration should have a down migration

-- Up: 2025_06_15_add_users_phone.sql
ALTER TABLE users ADD COLUMN phone TEXT;

-- Down: 2025_06_15_add_users_phone_down.sql
ALTER TABLE users DROP COLUMN phone;
```

### Forward-Fix (Preferred)

```sql
-- Instead of rolling back, fix forward with a new migration
-- Why: rolling back can cause data loss (if the column had data written to it)

-- Original migration had a bug:
ALTER TABLE users ADD COLUMN age INTEGER NOT NULL DEFAULT 0;
-- Bug: should have been nullable, or should have had a check constraint

-- Forward-fix migration:
ALTER TABLE users ALTER COLUMN age DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT chk_users_age CHECK (age IS NULL OR age BETWEEN 0 AND 150);
```

### Emergency Rollback

```sql
-- When forward-fix isn't possible and you must roll back:

-- 1. Check if any data was written to new columns/tables
SELECT COUNT(*) FROM users WHERE phone IS NOT NULL;

-- 2. If no data was written: safe to drop
ALTER TABLE users DROP COLUMN phone;

-- 3. If data was written: back up first
CREATE TABLE _backup_users_phone AS
SELECT id, phone FROM users WHERE phone IS NOT NULL;
-- Then drop
ALTER TABLE users DROP COLUMN phone;
```

---

## 9. Migration Ordering in Teams

### Conflict Prevention

```
-- Problem: two developers create migrations at the same time
-- Developer A: 2025_06_15_100000_add_users_phone.php
-- Developer B: 2025_06_15_100000_add_orders_tracking.php
-- Timestamp collision!

-- Solution 1: Use precise timestamps (Laravel does this automatically)
-- 2025_06_15_143022_add_users_phone.php
-- 2025_06_15_143045_add_orders_tracking.php

-- Solution 2: Rebase before merging
-- If both use the same timestamp, rebase to resolve
```

### Migration Dependencies

```
-- WRONG: migration B depends on migration A, but they can run in wrong order
-- A: CREATE TABLE user_profiles (user_id REFERENCES users(id))
-- B: ALTER TABLE users ADD COLUMN has_profile BOOLEAN

-- CORRECT: explicit ordering or single migration
-- If B depends on A: combine them or use sequential timestamps
-- A: 2025_06_15_143000_create_user_profiles.php
-- B: 2025_06_15_143001_add_users_has_profile.php (runs after A guaranteed)
```

### Handling Merge Conflicts

```bash
# When two branches create migrations with conflicting order:
# 1. Check which migrations exist
php artisan migrate:status

# 2. If timestamps conflict, rename one migration file
# Change the timestamp portion to resolve ordering

# 3. Reset migration state if needed (dev only!)
php artisan migrate:fresh --seed  # drops all tables, re-runs all migrations
# NEVER run migrate:fresh in production
```

---

## 10. Laravel Migration Conventions

### File Naming

```php
// Laravel generates: YYYY_MM_DD_HHMMSS_description.php
// php artisan make:migration create_users_table
// → 2025_06_15_143022_create_users_table.php

// Naming conventions:
// create_TABLE_table           → new table
// add_COLUMN_to_TABLE_table    → add column
// remove_COLUMN_from_TABLE_table → remove column
// rename_OLD_to_NEW_in_TABLE_table → rename column
// create_TABLE1_TABLE2_table   → pivot table (alphabetical order)
```

### Table Creation

```php
Schema::create('products', function (Blueprint $table) {
    $table->id();                          // BIGINT unsigned auto-increment PK
    $table->string('name');                // VARCHAR(255) NOT NULL
    $table->text('description')->nullable();
    $table->integer('price_cents')->unsigned();
    $table->foreignId('category_id')       // BIGINT unsigned
          ->constrained()                  // FK to categories(id)
          ->cascadeOnDelete();             // ON DELETE CASCADE
    $table->string('status')->default('draft')
          ->index();
    $table->jsonb('metadata')->default('{}');
    $table->timestamps();                  // created_at, updated_at
    $table->softDeletes();                 // deleted_at

    // Composite index
    $table->index(['category_id', 'status', 'created_at']);

    // Unique constraint
    $table->unique(['name', 'category_id']);
});
```

### Column Modifications

```php
// Add column
Schema::table('users', function (Blueprint $table) {
    $table->string('phone')->nullable()->after('email');
});

// Rename column (requires doctrine/dbal)
Schema::table('users', function (Blueprint $table) {
    $table->renameColumn('name', 'full_name');
});

// Change column type
Schema::table('users', function (Blueprint $table) {
    $table->text('bio')->nullable()->change();  // was string, now text
});

// Drop column
Schema::table('users', function (Blueprint $table) {
    $table->dropColumn('legacy_field');
});

// Add index
Schema::table('orders', function (Blueprint $table) {
    $table->index('status');                    // standard index
    $table->unique('email');                    // unique index
    $table->rawIndex('created_at', 'idx_orders_created')  // custom
});
```

### Raw SQL in Migrations

```php
// For PostgreSQL-specific features not supported by Blueprint
public function up(): void
{
    // Concurrent index (not supported by Blueprint)
    DB::statement('CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status)');

    // Partial index
    DB::statement("CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending'");

    // pgvector column
    DB::statement('ALTER TABLE documents ADD COLUMN embedding vector(1536)');

    // Check constraint
    DB::statement("ALTER TABLE users ADD CONSTRAINT chk_age CHECK (age >= 0 AND age <= 150)");
}

public function down(): void
{
    DB::statement('DROP INDEX IF EXISTS idx_orders_status');
    DB::statement('DROP INDEX IF EXISTS idx_orders_pending');
    DB::statement('ALTER TABLE documents DROP COLUMN IF EXISTS embedding');
    DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_age');
}
```

### Migration Groups

```php
// For expand-and-contract, use multiple sequential migrations:

// 2025_06_15_143000_add_users_full_name.php
public function up(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->string('full_name')->nullable();
    });
}

// 2025_06_15_143001_backfill_users_full_name.php
public function up(): void
{
    // Batched backfill
    DB::statement("
        UPDATE users SET full_name = name
        WHERE full_name IS NULL
    ");
    // For large tables, use chunked approach in a command instead
}

// 2025_06_15_143002_finalize_users_full_name.php
// Run AFTER deploying code that reads from full_name
public function up(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->string('full_name')->nullable(false)->change();
        $table->dropColumn('name');
    });
}
```

---

## 11. Schema Seeding

### Reference Data (Seeders)

```php
// database/seeders/RolesAndPermissionsSeeder.php
// For data that must exist in every environment

class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        // Idempotent: use updateOrCreate
        $admin = Role::updateOrCreate(
            ['name' => 'admin'],
            ['description' => 'Full access']
        );

        $editor = Role::updateOrCreate(
            ['name' => 'editor'],
            ['description' => 'Content management']
        );

        // Sync permissions
        $permissions = [
            'users.manage', 'posts.create', 'posts.edit',
            'posts.delete', 'posts.publish', 'settings.manage',
        ];

        foreach ($permissions as $name) {
            Permission::updateOrCreate(['name' => $name]);
        }

        $admin->permissions()->sync(Permission::all());
        $editor->permissions()->sync(
            Permission::whereIn('name', ['posts.create', 'posts.edit'])->get()
        );
    }
}
```

### Factories for Development

```php
// database/factories/UserFactory.php
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'password' => Hash::make('password'),
            'email_verified_at' => now(),
        ];
    }

    public function admin(): static
    {
        return $this->afterCreating(function (User $user) {
            $user->roles()->attach(Role::where('name', 'admin')->first());
        });
    }

    public function withOrders(int $count = 3): static
    {
        return $this->afterCreating(function (User $user) use ($count) {
            Order::factory()->count($count)->for($user)->create();
        });
    }
}

// Usage in seeder:
User::factory()->count(100)->withOrders(5)->create();
User::factory()->admin()->create(['email' => 'admin@example.com']);
```

### Production Seeding

```php
// IMPORTANT: separate production seed data from dev seed data

// DatabaseSeeder.php
public function run(): void
{
    // Always run: reference data needed in every environment
    $this->call([
        RolesAndPermissionsSeeder::class,
        CountriesSeeder::class,
        CurrenciesSeeder::class,
    ]);

    // Only in non-production: fake data
    if (! app()->isProduction()) {
        $this->call([
            FakeUsersSeeder::class,
            FakeOrdersSeeder::class,
        ]);
    }
}
```

```php
-- WRONG: running seeders in production that create fake data
-- php artisan db:seed  (runs all seeders including fake data)

-- CORRECT: run specific seeders in production
-- php artisan db:seed --class=RolesAndPermissionsSeeder
```
