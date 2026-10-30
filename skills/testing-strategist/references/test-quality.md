# Test Quality

Fixing flaky tests, speeding up test suites, test isolation, naming conventions, data management, and anti-patterns.

---

## Table of Contents

1. [Fixing Flaky Tests](#1-fixing-flaky-tests)
2. [Test Speed Optimization](#2-test-speed-optimization)
3. [Test Isolation](#3-test-isolation)
4. [Test Naming Conventions](#4-test-naming-conventions)
5. [Test Data Management](#5-test-data-management)
6. [Continuous Testing](#6-continuous-testing)
7. [Coverage Analysis](#7-coverage-analysis)
8. [Mutation Testing](#8-mutation-testing)
9. [Test Maintenance](#9-test-maintenance)
10. [Test Anti-Patterns](#10-test-anti-patterns)
11. [Tests as Living Documentation](#11-tests-as-living-documentation)

---

## 1. Fixing Flaky Tests

### What Makes a Test Flaky

A flaky test passes sometimes and fails sometimes with no code change. Flaky tests are worse than no tests — they erode trust in the suite. Team starts ignoring failures. Real bugs slip through.

### Common Causes and Fixes

| Cause | Symptom | Fix |
|---|---|---|
| **Shared state** | Test passes alone, fails in suite | Isolate — clean DB between tests |
| **Time dependency** | Fails at midnight, on weekends, in UTC | Fake the clock (see mocking-strategies.md) |
| **Race condition** | Fails intermittently, no pattern | Avoid shared mutable state, use proper waits |
| **External service** | Fails when API is slow/down | Mock external services |
| **Order dependency** | Fails when run in different order | Each test sets up its own data |
| **Async timeout** | Fails under CI load (slower machines) | Use polling/retries, not fixed sleeps |
| **Database leak** | Tests accumulate data across runs | Transaction rollback or truncate between tests |
| **Port conflict** | Fails when parallel tests bind same port | Use random ports or test isolation |

### WRONG vs CORRECT: Async Waits

```typescript
// WRONG: Fixed sleep — flaky under load
test('notification appears after action', async ({ page }) => {
  await page.click('#submit');
  await page.waitForTimeout(2000);  // May not be enough on slow CI
  expect(await page.textContent('.notification')).toBe('Saved!');
});

// CORRECT: Wait for the condition
test('notification appears after action', async ({ page }) => {
  await page.click('#submit');
  await expect(page.locator('.notification')).toHaveText('Saved!', {
    timeout: 10000,  // Max wait, but resolves as soon as it appears
  });
});
```

```go
// WRONG: Fixed sleep in Go test
func TestAsyncOperation(t *testing.T) {
    startAsyncJob(ctx, "process-data")
    time.Sleep(5 * time.Second)  // Flaky — may not be enough
    result, _ := getResult(ctx, "process-data")
    assert.Equal(t, "done", result.Status)
}

// CORRECT: Poll with timeout
func TestAsyncOperation(t *testing.T) {
    startAsyncJob(ctx, "process-data")

    require.Eventually(t, func() bool {
        result, err := getResult(ctx, "process-data")
        return err == nil && result.Status == "done"
    }, 10*time.Second, 100*time.Millisecond)
}
```

### Flaky Test Triage Process

```
Step 1: Quarantine the flaky test (mark as skip/pending, not delete)
Step 2: Reproduce locally (run 50x: `for i in $(seq 50); do go test -run TestFoo -count=1 || break; done`)
Step 3: Identify the cause (shared state? timing? external?)
Step 4: Fix the root cause (not the symptom)
Step 5: Run 100x to verify fix
Step 6: Un-quarantine
```

---

## 2. Test Speed Optimization

### The Speed Budget

```
Unit tests:         < 1 second per test (total suite < 30s)
Integration tests:  < 5 seconds per test (total suite < 5m)
E2E tests:          < 30 seconds per test (total suite < 15m)
Full suite (CI):    < 15 minutes total
```

### Parallelization

```php
// Pest — parallel execution
// pest.config.php or command line
// pest --parallel --processes=4

// Tests that can run in parallel MUST be isolated (no shared DB state)
```

```go
// Go — parallel tests (built-in)
func TestSomething(t *testing.T) {
    t.Parallel()  // This test runs in parallel with others

    tests := []struct{
        name string
        input int
        want int
    }{
        {"double 1", 1, 2},
        {"double 5", 5, 10},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()  // Subtests also parallel
            got := double(tt.input)
            assert.Equal(t, tt.want, got)
        })
    }
}
```

```typescript
// Vitest — parallel by default, configure worker count
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 2,
        maxThreads: 8,
      },
    },
  },
});
```

### In-Memory Database for Speed

```php
// Laravel — SQLite in-memory for unit/feature tests
// phpunit.xml
// <env name="DB_CONNECTION" value="sqlite"/>
// <env name="DB_DATABASE" value=":memory:"/>

// Use real PostgreSQL only for tests that need PG-specific features
// Tag those tests and run them separately
```

```python
# Django — in-memory SQLite for speed
# settings_test.py
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}
```

### Selective Running

```bash
# Run only tests affected by current changes
# PHP/Pest
pest --filter="OrderTest"
pest --group="payments"

# Go
go test ./internal/order/...
go test -run TestCreateOrder ./...

# TypeScript/Vitest
vitest --changed       # Only tests for changed files
vitest run src/order   # Only tests in order directory

# Python/pytest
pytest tests/test_order.py -k "test_create"
pytest --last-failed   # Only previously failing tests
```

### Other Speed Wins

```
High impact:
  - Parallel test execution (biggest win)
  - In-memory DB for non-DB-specific tests
  - Avoid unnecessary HTTP round trips (test at service level)
  - Cache test setup (shared fixtures for read-only data)

Medium impact:
  - Run only affected tests on PR (use --changed)
  - Profile slow tests and optimize individually
  - Use faster assertion libraries

Low impact:
  - Faster CI machines (diminishing returns)
  - Test file organization (minor I/O savings)
```

---

## 3. Test Isolation

### The Rule

Every test must be independent. Running any single test in isolation must produce the same result as running it in the full suite. Running tests in any order must produce the same results.

### Database Isolation Strategies

| Strategy | Speed | Isolation | Best For |
|---|---|---|---|
| **Transaction rollback** | Fastest | Good | Most tests (Laravel default) |
| **Truncate tables** | Fast | Perfect | Tests that commit transactions |
| **Recreate database** | Slow | Perfect | Migration testing |
| **Separate DB per test** | Slowest | Perfect | Parallel integration tests |

```php
// Laravel — RefreshDatabase trait (migrate + rollback per test)
uses(RefreshDatabase::class);

it('creates a user', function () {
    // Fresh database for this test — no data from other tests
    $this->postJson('/api/users', ['name' => 'Alice', 'email' => 'alice@example.com']);

    expect(User::count())->toBe(1);  // Always 1, regardless of test order
});
```

```go
// Go — transaction rollback per test
func NewTestDB(t *testing.T) *sql.DB {
    db := connectToTestDB()
    tx, err := db.Begin()
    require.NoError(t, err)

    t.Cleanup(func() {
        tx.Rollback()  // Undo everything this test did
    })

    return wrapTxAsDB(tx)  // Returns a *sql.DB-compatible wrapper
}
```

```python
# pytest — transaction rollback
@pytest.fixture
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)

    yield session

    session.close()
    transaction.rollback()  # Undo all changes
    connection.close()
```

### WRONG vs CORRECT: Test Isolation

```typescript
// WRONG: Tests share state via module-level variable
let userCount = 0;

test('first test creates user', async () => {
  await createUser({ name: 'Alice' });
  userCount++;
  expect(userCount).toBe(1);  // Passes
});

test('second test creates user', async () => {
  await createUser({ name: 'Bob' });
  userCount++;
  expect(userCount).toBe(1);  // FAILS — it's 2!
});

// CORRECT: Each test has its own state
test('creates first user', async () => {
  await createUser({ name: 'Alice' });
  const count = await db.query('SELECT COUNT(*) FROM users');
  expect(count).toBe(1);  // Own transaction, own data
});

test('creates second user', async () => {
  await createUser({ name: 'Bob' });
  const count = await db.query('SELECT COUNT(*) FROM users');
  expect(count).toBe(1);  // Own transaction, own data
});
```

### Environment Isolation

```
Test environment MUST have:
  - Own database (never share with dev or staging)
  - Own cache (or disabled cache)
  - Own queue (or synchronous queue)
  - Mocked external services (never hit real APIs)
  - Deterministic time (faked clock where needed)
  - Deterministic random (seeded where needed)
```

---

## 4. Test Naming Conventions

### The Principle

A test name should read like a sentence describing a behavior. When a test fails, the name alone should tell you what broke.

### WRONG vs CORRECT: Test Names

```php
// WRONG: Vague, implementation-focused
test('testUser');
test('testValidation');
test('test1');
test('testOrderService');
test('testProcess');

// CORRECT: Behavior-focused sentences
test('guest cannot access admin dashboard');
test('expired coupon returns validation error');
test('order total includes tax and shipping');
test('deleting last admin is prevented');
test('CSV export handles unicode characters');
```

```go
// WRONG: Function-name style
func TestCalculate(t *testing.T) { ... }
func TestValidate(t *testing.T) { ... }
func TestHandler(t *testing.T) { ... }

// CORRECT: Behavior descriptions
func TestCalculate_AppliesTieredDiscount(t *testing.T) { ... }
func TestValidate_RejectsExpiredCoupon(t *testing.T) { ... }
func TestCreateOrder_PreventsNegativeQuantity(t *testing.T) { ... }
```

```typescript
// WRONG
test('works');
test('handles error');
test('returns data');

// CORRECT
test('returns 404 when product does not exist');
test('retries failed payment up to 3 times');
test('sends welcome email after registration');
```

### Naming Patterns by Language

```
PHP (Pest):
  it('prevents duplicate order submission')
  it('applies discount for orders over $100')

PHP (PHPUnit):
  test_prevents_duplicate_order_submission()
  test_applies_discount_for_orders_over_100()

Go:
  TestCreateOrder_PreventsNegativeQuantity
  TestCreateOrder_AppliesDiscount_WhenOverMinimum

TypeScript (Vitest/Jest):
  test('prevents duplicate order submission')
  describe('createOrder') → it('applies discount for orders over $100')

Python (pytest):
  test_prevents_duplicate_order_submission()
  test_applies_discount_for_orders_over_100()
```

### Grouping Tests

```typescript
// Group by feature, not by class/function
describe('Order checkout', () => {
  it('creates order with correct total');
  it('applies coupon discount');
  it('prevents checkout with empty cart');
  it('sends confirmation email');
  it('reserves inventory');
});

// NOT grouped by class
describe('OrderService', () => {       // ← not useful
  describe('create', () => {           // ← not useful
    it('calls save on repository');     // ← tests implementation
  });
});
```

---

## 5. Test Data Management

### Factories

Factories create realistic test data with sensible defaults. Override only what matters for the test.

```php
// Laravel — Factory
$user = User::factory()->create();                           // Defaults
$admin = User::factory()->admin()->create();                 // State
$user = User::factory()->create(['email' => 'specific@example.com']); // Override

// Factory definition
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'password' => Hash::make('password'),
            'role' => 'user',
        ];
    }

    public function admin(): static
    {
        return $this->state(['role' => 'admin']);
    }

    public function withSubscription(): static
    {
        return $this->has(Subscription::factory()->active());
    }
}
```

```python
# Python — factory_boy
class UserFactory(factory.Factory):
    class Meta:
        model = User

    name = factory.Faker('name')
    email = factory.LazyAttribute(lambda o: f"{o.name.lower().replace(' ', '.')}@example.com")
    role = 'user'

    class Params:
        admin = factory.Trait(role='admin')

# Usage
user = UserFactory.create()
admin = UserFactory.create(admin=True)
user = UserFactory.create(email='specific@example.com')
```

```go
// Go — Builder pattern (no framework, build your own)
type UserBuilder struct {
    user User
}

func NewUserBuilder() *UserBuilder {
    return &UserBuilder{
        user: User{
            Name:  "John Doe",
            Email: fmt.Sprintf("user-%s@example.com", uuid.NewString()[:8]),
            Role:  "user",
        },
    }
}

func (b *UserBuilder) WithRole(role string) *UserBuilder {
    b.user.Role = role
    return b
}

func (b *UserBuilder) WithEmail(email string) *UserBuilder {
    b.user.Email = email
    return b
}

func (b *UserBuilder) Build() User {
    return b.user
}

func (b *UserBuilder) Create(t *testing.T, db *sql.DB) User {
    t.Helper()
    user := b.Build()
    err := insertUser(db, &user)
    require.NoError(t, err)
    return user
}

// Usage
user := NewUserBuilder().Create(t, db)
admin := NewUserBuilder().WithRole("admin").Create(t, db)
```

```typescript
// TypeScript — simple factory function
function createUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    name: 'John Doe',
    email: `user-${randomUUID().slice(0, 8)}@example.com`,
    role: 'user',
    ...overrides,
  };
}

// Usage
const user = createUser();
const admin = createUser({ role: 'admin' });
const specific = createUser({ email: 'alice@example.com' });
```

### WRONG vs CORRECT: Test Data

```php
// WRONG: Specifying every field (noisy, hides what matters)
it('admin can delete users', function () {
    $admin = User::factory()->create([
        'name' => 'Admin User',
        'email' => 'admin@example.com',
        'password' => Hash::make('password'),
        'role' => 'admin',
        'created_at' => now(),
        'updated_at' => now(),
        'email_verified_at' => now(),
    ]);

    $user = User::factory()->create([
        'name' => 'Regular User',
        'email' => 'user@example.com',
        'password' => Hash::make('password'),
        'role' => 'user',
        'created_at' => now(),
        'updated_at' => now(),
        'email_verified_at' => now(),
    ]);

    // What matters here? Hard to see.
    $this->actingAs($admin)->deleteJson("/api/users/{$user->id}")->assertOk();
});

// CORRECT: Only specify what's relevant to the test
it('admin can delete users', function () {
    $admin = User::factory()->admin()->create();
    $user = User::factory()->create();

    $this->actingAs($admin)
        ->deleteJson("/api/users/{$user->id}")
        ->assertOk();

    $this->assertDatabaseMissing('users', ['id' => $user->id]);
});
```

### Fixtures vs Factories

```
Factories (preferred for most cases):
  + Unique data per test (no collisions)
  + Override only what matters
  + States for common variants
  + No maintenance of fixture files

Fixtures (use for specific cases):
  + Stable data for snapshot tests
  + Large datasets for performance tests
  + Golden master test data
  + Seed data for development
```

---

## 6. Continuous Testing

### Watch Mode (Local Development)

```bash
# PHP/Pest
pest --watch

# Go (via external tool)
watchexec -e go -- go test ./...
# Or: air (for full app reload)

# TypeScript/Vitest
vitest        # Watch mode by default
vitest --ui   # Browser UI with watch

# Python/pytest
pytest-watch  # Or: ptw
ptw -- --last-failed  # Only re-run failures
```

### Pre-Commit Hooks

```bash
# .husky/pre-commit (JavaScript/TypeScript)
npx vitest run --changed

# .pre-commit-config.yaml (Python)
repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest tests/ --last-failed -x
        language: system
        always_run: true

# Makefile (Go)
.PHONY: pre-commit
pre-commit:
	go test ./... -short -count=1
```

### CI Pipeline Structure

```yaml
# Optimal CI test pipeline
test:
  parallel:
    - name: Lint + Static Analysis
      run: |
        eslint . --max-warnings 0
        tsc --noEmit

    - name: Unit Tests
      run: vitest run --reporter=junit

    - name: Integration Tests
      services: [postgres, redis]
      run: vitest run --project=integration

  sequential:
    - name: E2E Tests (after unit + integration pass)
      run: playwright test

    - name: Smoke Load Test (after E2E pass)
      run: k6 run tests/load/smoke.js
```

---

## 7. Coverage Analysis

### Branch Coverage vs Line Coverage

```python
def process_order(order):
    if order.total > 10000:           # Branch 1: > 10000
        apply_discount(order, 0.1)    # Line A
    else:                             # Branch 2: <= 10000
        apply_discount(order, 0.0)    # Line B

    if order.is_premium:              # Branch 3: premium
        add_free_shipping(order)      # Line C
    # Branch 4: not premium (implicit else — no line)

    return order                      # Line D

# Test: process_order(Order(total=15000, is_premium=True))
# Line coverage: A, C, D touched = 3/4 lines = 75%
# Branch coverage: Branch 1, 3 taken = 2/4 branches = 50%
# Branch 2 and 4 never tested!
```

**Branch coverage catches more bugs than line coverage.** Always prefer it.

### Finding Meaningful Gaps

```bash
# Generate coverage report
# PHP
pest --coverage --min=75

# Go
go test ./... -coverprofile=coverage.out
go tool cover -html=coverage.out  # Visual report

# TypeScript
vitest run --coverage

# Python
pytest --cov=src --cov-report=html
```

### What to Do With Coverage Gaps

```
Critical gap (fix immediately):
  - Auth/login code uncovered
  - Payment processing uncovered
  - Data mutation (CREATE/UPDATE/DELETE) uncovered

Important gap (fix soon):
  - Error handling paths uncovered
  - Validation logic uncovered
  - Edge cases in business rules uncovered

Acceptable gap (ignore):
  - Config/bootstrap code
  - Generated code (migrations, GraphQL types)
  - Dead code (delete it instead of testing it)
  - Trivial delegation methods
```

---

## 8. Mutation Testing

### What It Is

Mutation testing modifies your production code (injects "mutants") and runs your tests. If a test fails, the mutant is "killed" (good). If all tests pass despite the mutation, your tests missed something (bad).

### Example Mutations

```
Original:        if (age >= 18)
Mutant 1:        if (age > 18)      ← Boundary mutation
Mutant 2:        if (age <= 18)     ← Negation mutation
Mutant 3:        if (true)          ← Remove condition

If your tests don't catch Mutant 1, you're missing a test for age=18.
```

### Tools

| Language | Tool | Command |
|---|---|---|
| PHP | Infection | `infection --min-msi=70` |
| TypeScript | Stryker | `npx stryker run` |
| Python | mutmut | `mutmut run` |
| Go | go-mutesting | `go-mutesting ./...` |

### When to Use

```
USE mutation testing:
  - On critical business logic (pricing, auth, permissions)
  - Before major releases
  - When coverage is high but confidence is low
  - To validate that tests actually assert behavior

DON'T USE mutation testing:
  - On the full codebase (too slow)
  - On integration tests (mutations in glue code are noise)
  - On generated code
  - In CI on every push (run weekly or on-demand)
```

---

## 9. Test Maintenance

### When to Delete Tests

```
DELETE tests that:
  - Test removed features (dead code)
  - Are permanently flaky and unfixable
  - Duplicate other tests (same behavior, different setup)
  - Test implementation details that change with every refactor
  - Test third-party code behavior
  - Have been skipped for more than 3 months

KEEP tests that:
  - Guard against past bugs (regression tests)
  - Cover critical paths (even if "obvious")
  - Document tricky business rules
  - Verify edge cases that were hard to find
```

### When to Update Tests

```
UPDATE tests when:
  - Requirements change (new behavior, new validation rules)
  - API contract changes (new fields, changed responses)
  - Refactoring changes the public interface (not internal structure)

DO NOT update tests when:
  - Refactoring internals (tests should not break)
  - Changing implementation approach (same behavior, different code)
  
If refactoring internals breaks tests → your tests are coupled to implementation.
Fix the tests to test behavior, not implementation.
```

### WRONG vs CORRECT: Test Maintenance

```typescript
// WRONG: Test coupled to implementation — breaks on every refactor
test('fetches user', async () => {
  const spy = vi.spyOn(db, 'query');
  await userService.getById(1);
  expect(spy).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
  // Changing to Prisma, Drizzle, or even adding a JOIN breaks this test
});

// CORRECT: Test coupled to behavior — survives refactoring
test('returns user by ID', async () => {
  const created = await createUser(db, { name: 'Alice' });
  const user = await userService.getById(created.id);
  expect(user.name).toBe('Alice');
  // Doesn't care HOW the data is fetched
});
```

### Test Code Quality

Test code is production code. It needs:
- Readable naming
- No duplication (extract helpers)
- No complex logic in tests (no if/else, no loops with assertions)
- Clear AAA structure (Arrange-Act-Assert)

```php
// WRONG: Complex logic in test
it('processes all orders', function () {
    $orders = Order::factory()->count(5)->create();

    foreach ($orders as $order) {
        $response = $this->postJson("/api/orders/{$order->id}/process");
        if ($order->total > 10000) {
            $response->assertOk();
        } else {
            $response->assertStatus(422);
        }
    }
    // What is this testing? Hard to tell. Multiple behaviors in one test.
});

// CORRECT: One behavior per test
it('processes orders over $100', function () {
    $order = Order::factory()->create(['total' => 15000]);

    $this->postJson("/api/orders/{$order->id}/process")
        ->assertOk();
});

it('rejects orders under $100', function () {
    $order = Order::factory()->create(['total' => 5000]);

    $this->postJson("/api/orders/{$order->id}/process")
        ->assertStatus(422);
});
```

---

## 10. Test Anti-Patterns

### Anti-Pattern 1: Testing Implementation

```go
// WRONG: Testing that a specific method is called
func TestCreateOrder(t *testing.T) {
    mockRepo := new(MockRepo)
    mockRepo.On("Save", mock.Anything).Return(nil)

    svc := NewOrderService(mockRepo)
    svc.Create(ctx, order)

    mockRepo.AssertCalled(t, "Save", mock.Anything)
    // So what? This proves the method was called, not that the order was created.
}

// CORRECT: Testing the outcome
func TestCreateOrder(t *testing.T) {
    db := testutil.NewTestDB(t)
    svc := NewOrderService(NewOrderRepo(db))

    svc.Create(ctx, Order{UserID: 1, Total: 5000})

    order, err := FindOrderByUserID(db, 1)
    require.NoError(t, err)
    assert.Equal(t, int64(5000), order.Total)
}
```

### Anti-Pattern 2: Brittle CSS/DOM Selectors

```typescript
// WRONG: Brittle selectors
await page.click('.btn.btn-primary.submit-form');
await page.click('#root > div:nth-child(3) > button');
await page.click('[data-v-abc123]');

// CORRECT: Semantic selectors
await page.getByRole('button', { name: /submit/i }).click();
await page.getByLabel('Email').fill('alice@example.com');
await page.getByTestId('checkout-button').click();
```

### Anti-Pattern 3: Sleep in Tests

```python
# WRONG: Arbitrary sleep
def test_email_sent():
    trigger_email_send()
    time.sleep(5)  # Hope it's done by now
    assert len(mail.outbox) == 1

# CORRECT: Deterministic wait or synchronous processing
def test_email_sent():
    with override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
        trigger_email_send()  # Synchronous in test
        assert len(mail.outbox) == 1
```

### Anti-Pattern 4: God Test (Tests Everything)

```php
// WRONG: One test that tests everything
it('order flow works', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create();

    // Test creation
    $response = $this->actingAs($user)->postJson('/api/orders', [...]);
    $response->assertCreated();

    // Test retrieval
    $response = $this->getJson("/api/orders/{$response->json('id')}");
    $response->assertOk();

    // Test update
    $response = $this->putJson("/api/orders/{$response->json('id')}", [...]);
    $response->assertOk();

    // Test deletion
    $this->deleteJson("/api/orders/{$response->json('id')}")->assertOk();
    // If creation fails, everything else fails — no useful signal
});

// CORRECT: Separate tests per behavior
it('creates order with correct total', ...);
it('returns order details', ...);
it('updates order quantity', ...);
it('soft deletes order', ...);
```

### Anti-Pattern 5: Testing Exact Error Messages

```typescript
// WRONG: Coupled to exact wording
expect(error.message).toBe('The email field must be a valid email address.');
// Breaks when someone fixes a typo or adds punctuation

// CORRECT: Test for the type of error, not the exact message
expect(response.status).toBe(422);
expect(response.body.errors).toHaveProperty('email');
// Or if message matters:
expect(error.message).toContain('email');
expect(error.message).toMatch(/email|e-mail/i);
```

### Anti-Pattern 6: Copy-Paste Tests

```go
// WRONG: 10 nearly identical tests with copy-pasted setup
func TestValidateAge18(t *testing.T) {
    err := Validate(User{Age: 18})
    assert.NoError(t, err)
}
func TestValidateAge17(t *testing.T) {
    err := Validate(User{Age: 17})
    assert.Error(t, err)
}
// ... 8 more identical tests

// CORRECT: Table-driven tests
func TestValidateAge(t *testing.T) {
    tests := []struct {
        name    string
        age     int
        wantErr bool
    }{
        {"exactly 18", 18, false},
        {"17 rejected", 17, true},
        {"0 rejected", 0, true},
        {"negative rejected", -1, true},
        {"120 accepted", 120, false},
        {"121 rejected", 121, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := Validate(User{Age: tt.age})
            if tt.wantErr {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
            }
        })
    }
}
```

---

## 11. Tests as Living Documentation

### Tests Document Behavior

Well-written tests are the most accurate documentation of your system. Code comments lie (they get outdated). Documentation lies (it gets forgotten). Tests don't lie — if they pass, the behavior they describe is correct.

### Example: Tests as Specification

```php
describe('Coupon validation', function () {
    it('accepts valid coupon code');
    it('rejects expired coupon');
    it('rejects coupon that reached usage limit');
    it('allows multiple uses if coupon is multi-use');
    it('rejects coupon for wrong product category');
    it('applies percentage discount correctly');
    it('applies fixed discount without going below zero');
    it('stacks with existing promotions if allowed');
    it('does not stack with other coupons');
});

// Reading this test file tells you:
// - What a valid coupon is
// - What makes a coupon invalid
// - How discounts work
// - Stacking rules
// No documentation needed.
```

### Making Tests Readable

```go
// Tests should read like a story
func TestSubscription(t *testing.T) {
    t.Run("new user starts with 14-day trial", func(t *testing.T) { ... })
    t.Run("trial converts to paid on upgrade", func(t *testing.T) { ... })
    t.Run("expired trial blocks premium features", func(t *testing.T) { ... })
    t.Run("cancelled subscription remains active until period end", func(t *testing.T) { ... })
    t.Run("resubscribe restores premium features immediately", func(t *testing.T) { ... })
    t.Run("failed payment triggers 3-day grace period", func(t *testing.T) { ... })
    t.Run("grace period expiry downgrades to free", func(t *testing.T) { ... })
}

// A new developer reads this and understands the entire subscription lifecycle.
```

### The Test-Documentation Loop

```
When writing a feature:
  1. Define the behaviors (Given-When-Then)
  2. Write the tests (they become the spec)
  3. Implement the code
  4. Tests pass = spec is met

When onboarding a new developer:
  1. Read the test file for a feature
  2. Understand what the feature does
  3. Run the tests to confirm understanding
  4. No need for external documentation

When changing a feature:
  1. Update the tests to reflect new behavior
  2. Tests fail (new behavior not implemented)
  3. Implement the change
  4. Tests pass (documentation automatically updated)
```
