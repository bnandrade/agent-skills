# Safe Refactoring

Tecnicas para refatorar codigo de producao com seguranca. Testes de caracterizacao, seams, golden master, feature flags, migracao de banco, rollback e monitoramento.

---

## Table of Contents

1. [Characterization Tests](#1-characterization-tests)
2. [Finding Seams](#2-finding-seams)
3. [Golden Master Testing](#3-golden-master-testing)
4. [Feature Flags for Safe Rollout](#4-feature-flags-for-safe-rollout)
5. [Database Refactoring Safety](#5-database-refactoring-safety)
6. [API Refactoring Safety](#6-api-refactoring-safety)
7. [Monitoring During Refactoring](#7-monitoring-during-refactoring)
8. [Rollback Strategies](#8-rollback-strategies)
9. [Zero-Downtime Refactoring](#9-zero-downtime-refactoring)
10. [Pair Programming for Risky Refactoring](#10-pair-programming-for-risky-refactoring)

---

## 1. Characterization Tests

Tests that document what the code actually does — not what it should do. The safety net you write BEFORE refactoring.

### 1.1 What They Are

```
Normal tests:  "Given input X, the code SHOULD return Y"
  → Written from requirements
  → Describe desired behavior

Characterization tests:  "Given input X, the code DOES return Y"
  → Written from observation
  → Describe actual behavior (including bugs)
```

### 1.2 Writing Characterization Tests

```python
# Step 1: Call the function with various inputs
# Step 2: Assert whatever it actually returns
# Step 3: Now you have a safety net

# WRONG: Guessing what the function should do
def test_calculate_tax():
    # "I think it should return 10% tax"
    assert calculate_tax(100, "NY") == 10.0  # might be wrong!

# CORRECT: Observe what it actually does, then lock it in
def test_calculate_tax_characterization():
    # Run it, see what happens, lock in the result
    result = calculate_tax(100, "NY")
    # Turns out it returns 8.875 (NYC rate with local tax)
    assert result == 8.875

    result = calculate_tax(100, "OR")
    # Oregon has no sales tax
    assert result == 0.0

    result = calculate_tax(0, "NY")
    # Edge case: zero amount
    assert result == 0.0

    result = calculate_tax(-50, "NY")
    # Edge case: negative (returns negative tax — is that a bug?)
    assert result == -4.4375
    # Document it: "Known behavior: negative amounts produce negative tax.
    # This is likely a bug but existing callers may depend on it."
```

### 1.3 Characterization Test Strategy

```
1. Identify the code you want to refactor
2. Find all entry points (public methods, API endpoints, event handlers)
3. For each entry point:
   a. Find the "happy path" inputs
   b. Find edge cases (nulls, empty, negative, unicode, huge values)
   c. Find error cases (invalid inputs, missing dependencies)
   d. Call the code, observe the output, write assertions
4. Run the tests, make sure they pass
5. NOW you can refactor — the tests are your guardrails
```

### 1.4 How Many Characterization Tests?

```
WRONG: "100% coverage before we start refactoring"
  → You'll never start refactoring
  → 3 weeks writing tests for code you're about to change

CORRECT: Cover the paths you're going to change
  → Look at the code you'll modify
  → Write tests for THOSE paths
  → Also cover the main happy path (even if you're not changing it)
  → Total: 10-30 tests, takes 1-2 days
```

---

## 2. Finding Seams

A seam is a place where you can change behavior without editing the code. Seams are your insertion points for refactoring.

### 2.1 Types of Seams

```
OBJECT SEAM:
  Replace an object with a test double or alternative implementation
  → Dependency injection is a seam factory

PREPROCESSING SEAM:
  Change behavior by changing configuration/environment
  → Feature flags, env vars, config files

LINK SEAM:
  Change behavior by linking to a different module
  → Middleware, interceptors, proxy objects
```

### 2.2 Finding Object Seams

```php
// WRONG: No seams — everything is hardcoded
class OrderService
{
    public function createOrder(array $data): Order
    {
        $user = User::find($data['user_id']);           // hardcoded DB call
        $tax = TaxCalculator::calculate($data['total']); // static call
        mail($user->email, 'Order created', '...');     // global function
        return Order::create([
            'user_id' => $user->id,
            'total' => $data['total'] + $tax,
        ]);
    }
}
// Can't test without a database, can't test without sending email

// CORRECT: Seams everywhere via dependency injection
class OrderService
{
    public function __construct(
        private UserRepository $users,
        private TaxCalculator $taxCalc,
        private Mailer $mailer,
    ) {}

    public function createOrder(array $data): Order
    {
        $user = $this->users->find($data['user_id']);
        $tax = $this->taxCalc->calculate($data['total']);
        $this->mailer->send($user->email, 'Order created', '...');
        return Order::create([
            'user_id' => $user->id,
            'total' => $data['total'] + $tax,
        ]);
    }
}
// Each dependency is a seam: swap in test doubles, alternative implementations
```

### 2.3 Creating Seams in Legacy Code

When code has no seams, create them with minimal changes:

```typescript
// BEFORE: No seams
class ReportGenerator {
  generate(): string {
    const data = db.query("SELECT * FROM sales WHERE ...");
    const formatted = this.formatData(data);
    const html = this.renderTemplate(formatted);
    emailClient.send("boss@company.com", "Weekly Report", html);
    return html;
  }
}

// Step 1: Extract dependencies as parameters (minimal change)
class ReportGenerator {
  generate(
    queryFn = () => db.query("SELECT * FROM sales WHERE ..."),
    sendFn = (to: string, subject: string, body: string) =>
      emailClient.send(to, subject, body),
  ): string {
    const data = queryFn();
    const formatted = this.formatData(data);
    const html = this.renderTemplate(formatted);
    sendFn("boss@company.com", "Weekly Report", html);
    return html;
  }
}
// Now you can test: generate(() => mockData, () => {})
// Existing callers are unchanged (default parameters)
```

```go
// Go: Create seams with function fields in structs
// BEFORE
type Importer struct{}

func (i *Importer) Import(filename string) error {
    data, err := os.ReadFile(filename)        // hard to test
    if err != nil {
        return err
    }
    return db.BulkInsert(parseCSV(data))      // hard to test
}

// AFTER: Function fields as seams
type Importer struct {
    ReadFile   func(string) ([]byte, error)     // seam
    BulkInsert func([]Record) error             // seam
}

func NewImporter() *Importer {
    return &Importer{
        ReadFile:   os.ReadFile,                 // default: real implementation
        BulkInsert: db.BulkInsert,               // default: real implementation
    }
}

func (i *Importer) Import(filename string) error {
    data, err := i.ReadFile(filename)
    if err != nil {
        return err
    }
    return i.BulkInsert(parseCSV(data))
}

// Test: inject fakes
func TestImport(t *testing.T) {
    imp := &Importer{
        ReadFile:   func(string) ([]byte, error) { return []byte("a,b\n1,2"), nil },
        BulkInsert: func(records []Record) error { return nil },
    }
    err := imp.Import("test.csv")
    assert.NoError(t, err)
}
```

---

## 3. Golden Master Testing

Capture the entire output of the system, use it as a reference. After refactoring, compare new output to the golden master.

### 3.1 When to Use

- Legacy code with no tests and complex output
- Report generators, PDF generators, email templates
- Data transformations with many edge cases
- Any function where the output is too complex to manually specify

### 3.2 Implementation

```python
import json
import hashlib
from pathlib import Path

GOLDEN_DIR = Path("tests/golden_master")

def create_golden_master(name: str, inputs: list[dict]):
    """Run once to capture the baseline."""
    results = []
    for inp in inputs:
        output = system_under_test(**inp)
        results.append({"input": inp, "output": output})

    golden_file = GOLDEN_DIR / f"{name}.json"
    golden_file.write_text(json.dumps(results, indent=2, default=str))
    print(f"Golden master saved: {golden_file}")

def test_against_golden_master(name: str):
    """Run after refactoring to verify behavior preserved."""
    golden_file = GOLDEN_DIR / f"{name}.json"
    golden_data = json.loads(golden_file.read_text())

    for i, case in enumerate(golden_data):
        actual = system_under_test(**case["input"])
        expected = case["output"]

        assert actual == expected, (
            f"Case {i} mismatch:\n"
            f"  Input:    {case['input']}\n"
            f"  Expected: {expected}\n"
            f"  Actual:   {actual}"
        )
```

### 3.3 Golden Master for HTTP APIs

```bash
# Capture golden master: run all API endpoints, save responses
#!/bin/bash
ENDPOINTS=(
  "GET /api/users"
  "GET /api/users/1"
  "GET /api/products?category=electronics"
  "POST /api/orders -d '{\"user_id\":1,\"product_id\":2}'"
)

mkdir -p tests/golden_master/api

for endpoint in "${ENDPOINTS[@]}"; do
  method=$(echo "$endpoint" | cut -d' ' -f1)
  url=$(echo "$endpoint" | cut -d' ' -f2)
  extra=$(echo "$endpoint" | cut -d' ' -f3-)
  filename=$(echo "${method}_${url}" | tr '/' '_' | tr '?' '_')

  curl -s -X "$method" "http://localhost:3000${url}" $extra \
    -H "Content-Type: application/json" \
    | jq --sort-keys '.' > "tests/golden_master/api/${filename}.json"
done

echo "Golden master captured."
```

### 3.4 Limitations

```
WRONG: Golden master as your ONLY testing strategy
  → It tests exact output, not behavior
  → Any change in formatting, timestamps, or IDs breaks all tests
  → Gives false failures constantly

CORRECT: Golden master as a TEMPORARY safety net
  → Use it to safely refactor
  → Replace with proper unit/integration tests over time
  → Remove golden master tests once proper tests exist
```

Normalize output before comparing (strip timestamps, sort keys, replace dynamic IDs):

```python
def normalize(output: dict) -> dict:
    """Remove non-deterministic fields before comparison."""
    normalized = copy.deepcopy(output)
    for key in ["created_at", "updated_at", "request_id", "trace_id"]:
        normalized.pop(key, None)
    if "id" in normalized:
        normalized["id"] = "NORMALIZED_ID"
    return normalized
```

---

## 4. Feature Flags for Safe Rollout

### 4.1 Refactoring-Specific Flag Patterns

```typescript
// Pattern 1: Old/New code path
async function processPayment(order: Order): Promise<Result> {
  if (await featureFlag.isEnabled("new-payment-flow", order.userId)) {
    return newPaymentProcessor.process(order);
  }
  return oldPaymentProcessor.process(order);
}

// Pattern 2: Shadow mode (run both, use old result)
async function processPayment(order: Order): Promise<Result> {
  const oldResult = await oldPaymentProcessor.process(order);

  if (await featureFlag.isEnabled("shadow-new-payment", order.userId)) {
    try {
      const newResult = await newPaymentProcessor.process(order);
      compareResults(oldResult, newResult, order.id);
    } catch (err) {
      logger.error("New payment processor error (shadow mode)", { err, orderId: order.id });
    }
  }

  return oldResult; // Always return old result in shadow mode
}

// Pattern 3: Percentage rollout with automatic rollback
async function processPayment(order: Order): Promise<Result> {
  if (await featureFlag.isEnabled("new-payment-flow", order.userId)) {
    try {
      const result = await newPaymentProcessor.process(order);
      metrics.increment("payment.new.success");
      return result;
    } catch (err) {
      metrics.increment("payment.new.failure");
      // Auto-rollback: if error rate > 5%, flag system disables automatically
      return oldPaymentProcessor.process(order);
    }
  }
  return oldPaymentProcessor.process(order);
}
```

### 4.2 Flag Lifecycle

```
CREATE flag → SHADOW mode → CANARY (1%) → RAMP (10/25/50/100%) → REMOVE flag

Timeline:
  Day 0:  Create flag, shadow mode (run both, use old)
  Day 3:  Review shadow results, fix mismatches
  Day 5:  Canary — 1% of users get new code path
  Day 7:  Ramp to 10%
  Day 10: Ramp to 25%
  Day 14: Ramp to 50%
  Day 17: Ramp to 100%
  Day 24: Remove flag and old code path (don't skip this!)
```

---

## 5. Database Refactoring Safety

### 5.1 The Golden Rule

```
NEVER make a database change that breaks the current running version of the code.
The database migration MUST be compatible with both old and new application code.
```

### 5.2 Safe Schema Changes

| Change | Safe Strategy |
|---|---|
| Add column | Add with DEFAULT or NULL — old code ignores it |
| Rename column | Expand-contract: add new, sync, migrate code, drop old |
| Drop column | Deploy code that doesn't use it first, THEN drop |
| Change column type | Add new column, backfill, migrate code, drop old |
| Add table | Just add it — nothing uses it yet |
| Drop table | Verify no code references it, then drop |
| Add index | Safe — might be slow on large tables, run off-peak |
| Add NOT NULL | Add column NULL first, backfill, then ALTER to NOT NULL |

### 5.3 Expand-Contract for Column Rename

```sql
-- WRONG: Single migration (breaks running code)
ALTER TABLE users RENAME COLUMN email TO email_address;
-- Every running instance of the app NOW FAILS

-- CORRECT: Three separate deployments

-- Migration 1: EXPAND (deploy with old AND new code support)
ALTER TABLE users ADD COLUMN email_address VARCHAR(255);
UPDATE users SET email_address = email WHERE email_address IS NULL;

-- Add trigger to keep in sync during transition
CREATE OR REPLACE FUNCTION sync_email()
RETURNS trigger AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_address := NEW.email;
  END IF;
  IF NEW.email_address IS DISTINCT FROM OLD.email_address THEN
    NEW.email := NEW.email_address;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_email_trigger
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_email();

-- Deploy 2: MIGRATE (update application to use email_address)
-- All code now reads/writes email_address
-- Old code is gone from production

-- Migration 3: CONTRACT (remove old column)
DROP TRIGGER sync_email_trigger ON users;
DROP FUNCTION sync_email();
ALTER TABLE users DROP COLUMN email;
```

### 5.4 Large Table Migrations

```
WRONG: ALTER TABLE with 50M rows during business hours
  → Locks the table for 20 minutes
  → All writes fail, users see errors

CORRECT: Online schema migration tools
  → pt-online-schema-change (MySQL/MariaDB)
  → pg_repack / pg_squeeze (PostgreSQL)
  → gh-ost (GitHub's MySQL migration tool)
  → Run during low-traffic windows
  → Monitor lock wait times during migration
```

```bash
# PostgreSQL: Create index without locking writes
CREATE INDEX CONCURRENTLY idx_users_email ON users(email_address);
# Takes longer but doesn't block writes

# MySQL: gh-ost for zero-downtime ALTER TABLE
gh-ost \
  --host=db-primary \
  --database=myapp \
  --table=users \
  --alter="ADD COLUMN email_address VARCHAR(255)" \
  --execute
```

---

## 6. API Refactoring Safety

### 6.1 Versioning Strategy

```
WRONG: Modify existing endpoint behavior
  PUT /api/users/:id  ← change the response format
  → All existing API consumers break

CORRECT: Version the endpoint
  PUT /api/v1/users/:id  ← old format (maintained)
  PUT /api/v2/users/:id  ← new format
  → Old consumers continue working
  → New consumers use v2
```

### 6.2 Deprecation Process

```
Phase 1: DEPRECATE (announce + warn)
  - Add Deprecation header to old endpoint responses
  - Add Sunset header with removal date
  - Document the migration path
  - Notify API consumers directly

Phase 2: MONITOR (track usage)
  - Log every call to deprecated endpoints
  - Identify which clients still use them
  - Contact those clients with migration help

Phase 3: SUNSET (remove)
  - Return 410 Gone after sunset date
  - Keep endpoint for 30 more days returning 410 with migration info
  - Then remove entirely
```

```typescript
// Deprecation headers
app.get("/api/v1/users", (req, res) => {
  res.set("Deprecation", "true");
  res.set("Sunset", "Sat, 01 Mar 2025 00:00:00 GMT");
  res.set("Link", '</api/v2/users>; rel="successor-version"');

  // Log deprecated usage
  logger.warn("Deprecated endpoint called", {
    endpoint: "GET /api/v1/users",
    clientId: req.headers["x-client-id"],
    userAgent: req.headers["user-agent"],
  });

  // Still return the data (old format)
  const users = userService.getAll();
  res.json(users.map(toV1Format));
});
```

### 6.3 Backward-Compatible Changes (Safe)

These changes are safe — existing clients won't break:

- Adding a new field to a response
- Adding a new optional parameter
- Adding a new endpoint
- Adding a new enum value (if clients handle unknown values)

### 6.4 Breaking Changes (Unsafe)

These changes REQUIRE versioning or expand-contract:

- Removing a field from a response
- Renaming a field
- Changing a field type
- Making an optional parameter required
- Changing the meaning of a field
- Removing an endpoint

---

## 7. Monitoring During Refactoring

### 7.1 Key Metrics to Watch

```
BEFORE refactoring:
  → Capture baseline for all metrics below
  → Save as a dashboard for easy comparison

DURING refactoring (check after each deploy):
  → Error rate (should not increase)
  → Latency p50/p95/p99 (should not increase significantly)
  → Business metrics (orders, signups, revenue — should stay stable)
  → Log volume (sudden spike = something is wrong)
```

### 7.2 Alert Configuration

```yaml
# Alert rules during refactoring
alerts:
  - name: error_rate_spike
    condition: error_rate > baseline * 1.5
    for: 5m
    action: page on-call + auto-rollback

  - name: latency_regression
    condition: p99_latency > baseline * 2
    for: 10m
    action: alert on-call

  - name: business_metric_drop
    condition: orders_per_minute < baseline * 0.8
    for: 15m
    action: page on-call + auto-rollback
```

### 7.3 Structured Logging for Refactoring

```typescript
// Add context to distinguish old vs new code paths
function processWithLogging(order: Order, codePath: "old" | "new") {
  const startTime = Date.now();

  try {
    const result = codePath === "new"
      ? newProcessor.process(order)
      : oldProcessor.process(order);

    logger.info("Order processed", {
      codePath,
      orderId: order.id,
      durationMs: Date.now() - startTime,
      success: true,
    });

    return result;
  } catch (err) {
    logger.error("Order processing failed", {
      codePath,
      orderId: order.id,
      durationMs: Date.now() - startTime,
      error: err.message,
    });
    throw err;
  }
}
```

### 7.4 Comparison Dashboard

```
Create a dashboard with two columns: OLD vs NEW

Metric          | Old Code Path | New Code Path | Delta
----------------|---------------|---------------|------
Error rate      | 0.12%         | 0.08%         | -33% ✓
p50 latency     | 45ms          | 38ms          | -16% ✓
p99 latency     | 280ms         | 310ms         | +11% ⚠
Throughput      | 1,200 req/s   | 1,180 req/s   | -2%  ✓
Memory usage    | 512MB         | 480MB         | -6%  ✓
```

---

## 8. Rollback Strategies

### 8.1 Rollback Matrix

| Refactoring Type | Rollback Method | Time to Rollback |
|---|---|---|
| Code-only change | Git revert + deploy | 5-15 minutes |
| Feature flag change | Disable flag | Seconds |
| Database + code | Code first, then reverse migration | 15-60 minutes |
| API versioning | Route back to old version | 1-5 minutes |
| Infrastructure change | Terraform/Pulumi rollback | 5-30 minutes |

### 8.2 Code Rollback

```bash
# WRONG: Manually undo changes
# You'll forget something, introduce bugs

# CORRECT: Git revert
git revert HEAD    # revert last commit
git push origin main
# Deploy pipeline picks it up automatically

# If multiple commits need reverting
git revert --no-commit HEAD~3..HEAD
git commit -m "Revert: rollback payment refactoring (commits abc..def)"
git push origin main
```

### 8.3 Feature Flag Rollback

```typescript
// Instant rollback — no deploy needed

// Before (flag enabled)
featureFlags.set("new-search-engine", { enabled: true, percentage: 100 });

// Rollback (disable flag)
featureFlags.set("new-search-engine", { enabled: false, percentage: 0 });

// This is why feature flags are the safest rollout mechanism:
// → No deploy needed
// → Takes effect in seconds
// → Can target specific users/percentages
```

### 8.4 Database Rollback

```
WRONG: Rollback a destructive migration
  → You dropped a column. The data is gone.
  → "We'll restore from backup" — hope you tested that backup recently

CORRECT: Never make irreversible database changes during refactoring
  → Don't DROP columns until the new code is stable for 2+ weeks
  → Keep the old column (it costs disk space, not correctness)
  → Rollback = just deploy the old code (old column is still there)
```

### 8.5 Rollback Decision Framework

```
Should I rollback?

Error rate increased > 50% from baseline?
  → YES: Rollback immediately, investigate after

Latency p99 increased > 100%?
  → MAYBE: Check if it's a cold cache. Wait 10 minutes.
  → If persists → Rollback

Business metrics dropped > 20%?
  → YES: Rollback immediately. Revenue loss > investigation time.

One user reports an edge case bug?
  → NO: Disable the flag for that user, fix forward.

The new code works but is slightly slower?
  → NO: Optimize, don't rollback. You can always rollback later.
```

---

## 9. Zero-Downtime Refactoring

### 9.1 The Principle

Every step of the refactoring must be deployable. The system must work before, during, and after each step.

### 9.2 Deploy Sequence for Breaking Changes

```
WRONG: Deploy code that expects new schema before running migration
  App v2 (expects email_address) → DB still has email → CRASH

WRONG: Run migration before deploying compatible code
  DB has email_address → App v1 (uses email) → WORKS (but next step...)
  → If migration adds NOT NULL without default → CRASH on insert

CORRECT: Three-step deploy
  Step 1: Deploy code that works with BOTH old AND new schema
    App v1.5 (reads email, writes both email and email_address)
    DB still has only email column

  Step 2: Run migration (add new column, backfill)
    App v1.5 still works (reads email, new column is bonus)
    DB now has both columns

  Step 3: Deploy code that uses new schema
    App v2 (reads/writes email_address)
    DB has both columns (drop old later)
```

### 9.3 Rolling Deploys During Refactoring

```
During a rolling deploy, OLD and NEW instances run simultaneously.
Your code must handle this:

WRONG:
  Old instance writes: { name: "John" }
  New instance reads:  expects { full_name: "John" }  → null!

CORRECT:
  New instance reads:  full_name || name  (fallback to old field)
  New instance writes: { name: "John", full_name: "John" }  (write both)
  → Works regardless of which instance processes the next request
```

```typescript
// Code that works during rolling deploy (old and new instances coexist)
function getUserName(user: Record<string, any>): string {
  // New field takes precedence, fall back to old
  return user.full_name ?? user.name ?? "Unknown";
}

function updateUser(user: User, name: string): void {
  // Write to both fields during transition
  user.name = name;        // old instances can read this
  user.full_name = name;   // new instances prefer this
}
```

---

## 10. Pair Programming for Risky Refactoring

### 10.1 When to Pair

```
Always pair when:
  - Refactoring code nobody fully understands
  - Refactoring without comprehensive tests
  - Refactoring payment, auth, or data-critical code
  - The blast radius is high (many consumers)
  - The refactoring spans multiple systems

Don't need to pair when:
  - Simple extract method/rename
  - Well-tested code with clear boundaries
  - Low blast radius (internal utility)
```

### 10.2 Pairing Roles

```
NAVIGATOR:
  - Watches for side effects and edge cases
  - Thinks about the bigger picture
  - Checks that tests still make sense
  - Keeps track of the refactoring plan

DRIVER:
  - Makes the changes
  - Runs the tests
  - Commits frequently
  - Explains what they're doing and why

Switch roles every 25-30 minutes (Pomodoro-style).
```

### 10.3 Pre-Refactoring Checklist (Review Together)

```
Before starting:
  [ ] Both pair partners understand the current code
  [ ] Both agree on the target state
  [ ] Both agree on the step-by-step plan
  [ ] Characterization tests are in place
  [ ] Monitoring dashboard is open
  [ ] Rollback plan is documented
  [ ] Feature flag is configured (if using one)

During:
  [ ] Commit after every green test run
  [ ] Run full test suite every 15 minutes
  [ ] Check monitoring every 30 minutes (if deploying continuously)
  [ ] If stuck for > 20 minutes, revert to last good commit and rethink

After:
  [ ] All tests pass
  [ ] Monitoring shows no regression
  [ ] Old code is removed (or removal is scheduled)
  [ ] Feature flag removal is scheduled
  [ ] Documentation is updated
```

---

## Quick Reference: Safety Checklist

Before every refactoring step:

```
[ ] Tests cover the behavior I'm about to change
[ ] I can deploy this change independently
[ ] The system works before, during, and after this change
[ ] I know how to rollback if something goes wrong
[ ] Monitoring is in place to detect problems
[ ] The change is small enough to review in < 15 minutes
```
