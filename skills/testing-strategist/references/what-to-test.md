# What to Test

Risk-based testing strategy, critical path identification, TDD workflow, and deciding what deserves a test.

---

## Table of Contents

1. [Risk-Based Testing](#1-risk-based-testing)
2. [Critical Path Identification](#2-critical-path-identification)
3. [Behavior Specifications (Given-When-Then)](#3-behavior-specifications-given-when-then)
4. [TDD Workflow](#4-tdd-workflow)
5. [Test-After Workflow](#5-test-after-workflow)
6. [What NOT to Test](#6-what-not-to-test)
7. [Feature-Driven Testing](#7-feature-driven-testing)
8. [Testing Legacy Code](#8-testing-legacy-code)
9. [Regression Test Strategy](#9-regression-test-strategy)
10. [Coverage Targets](#10-coverage-targets)
11. [Test-Driven Bug Fixing](#11-test-driven-bug-fixing)

---

## 1. Risk-Based Testing

### The Principle

Test where bugs happen, not everywhere equally. Every hour spent writing tests is an hour not spent on features. Invest test effort where the return is highest.

### Risk Assessment Matrix

| Factor | Low Risk | Medium Risk | High Risk |
|---|---|---|---|
| **User impact** | Cosmetic, nice-to-have | Workflow blocked, workaround exists | Data loss, money loss, security breach |
| **Frequency of change** | Stable, rarely touched | Monthly changes | Weekly/daily changes |
| **Complexity** | Straightforward CRUD | Business rules with conditions | Multi-step, stateful, concurrent |
| **Bug history** | No bugs reported | Occasional bugs | Repeated bugs in this area |
| **Dependency count** | Self-contained | 2-3 dependencies | External APIs, queues, cron, cache |

### How to Apply

```
HIGH RISK (test heavily):
- Auth/login/signup — security + every user touches it
- Payment processing — money is involved
- Data mutations — CREATE, UPDATE, DELETE that can't be undone
- Search/filtering — complex queries, edge cases, data-dependent
- Permissions/authorization — wrong access = security breach

MEDIUM RISK (test critical paths):
- List/index pages — pagination edge cases, empty states
- File upload/download — size limits, type validation, storage
- Email sending — triggers, content, deduplication
- Admin features — lower traffic but higher privilege

LOW RISK (minimal or no tests):
- Static pages — about, terms, privacy
- Settings that toggle features — simple boolean flags
- Cosmetic changes — color, spacing, copy changes
- Internal tools used by 2 people — manual testing suffices
```

### WRONG vs CORRECT: Test Investment

```typescript
// WRONG: Equal test effort everywhere
// 50 tests for the "About" page
test('about page shows title', ...);
test('about page shows paragraph 1', ...);
test('about page shows paragraph 2', ...);
// ... 47 more tests checking static content

// 3 tests for the checkout flow
test('checkout works', ...);  // Happy path only

// CORRECT: Investment proportional to risk
// 1 test for the "About" page
test('about page renders without errors', ...);

// 15 tests for the checkout flow
test('checkout completes with valid card', ...);
test('checkout rejects expired card', ...);
test('checkout handles 3D Secure redirect', ...);
test('checkout applies discount code', ...);
test('checkout prevents double submission', ...);
test('checkout calculates tax correctly for each region', ...);
// ... etc.
```

---

## 2. Critical Path Identification

### What Is a Critical Path

A critical path is a user flow that:
- Is used by most/all users (auth, core feature)
- Involves money (payments, billing, subscriptions)
- Can cause data loss (deletes, migrations, exports)
- Has legal implications (privacy, compliance, contracts)
- Cannot be worked around if broken (core functionality)

### Mapping Critical Paths

```
Step 1: List all user flows
Step 2: Score each flow:
  - Impact if broken (1-5)
  - Frequency of use (1-5)
  - Complexity (1-5)
Step 3: Priority = Impact × Frequency × Complexity
Step 4: Top 20% of flows get 80% of test investment
```

### Example: E-Commerce App

| Flow | Impact | Frequency | Complexity | Score | Test Level |
|---|---|---|---|---|---|
| Checkout + payment | 5 | 5 | 5 | 125 | E2E + integration + unit |
| User registration | 4 | 4 | 3 | 48 | Integration + E2E |
| Product search | 3 | 5 | 4 | 60 | Integration |
| Order history | 2 | 3 | 2 | 12 | Integration |
| Profile settings | 1 | 2 | 1 | 2 | Smoke test only |

### Example: SaaS App

| Flow | Impact | Frequency | Complexity | Score | Test Level |
|---|---|---|---|---|---|
| Subscription billing | 5 | 3 | 5 | 75 | E2E + integration + unit |
| User invitations | 4 | 3 | 4 | 48 | Integration + E2E |
| Core feature (domain-specific) | 5 | 5 | 4 | 100 | Full coverage |
| Dashboard analytics | 2 | 5 | 3 | 30 | Integration |
| Email preferences | 1 | 1 | 1 | 1 | None or smoke |

---

## 3. Behavior Specifications (Given-When-Then)

### The Format

```
Given [precondition / setup]
When [action / trigger]
Then [expected outcome]
```

This is not just BDD syntax — it's a thinking tool. Every test should be expressible in Given-When-Then, even if you don't use the keywords.

### Translating to Code

```php
// Given-When-Then as a test
// Given: a user with an active subscription
// When: the subscription expires
// Then: the user loses access to premium features

it('revokes premium access when subscription expires', function () {
    // Given
    $user = User::factory()->create();
    $subscription = Subscription::factory()
        ->for($user)
        ->create(['expires_at' => now()->subDay()]);

    // When
    $this->artisan('subscriptions:check-expired');

    // Then
    expect($user->fresh()->isPremium())->toBeFalse();
    $this->assertDatabaseHas('subscriptions', [
        'id' => $subscription->id,
        'status' => 'expired',
    ]);
});
```

```python
# Python equivalent
def test_revokes_premium_access_when_subscription_expires(client, db_session):
    # Given
    user = UserFactory.create()
    subscription = SubscriptionFactory.create(
        user=user,
        expires_at=datetime.now() - timedelta(days=1),
    )

    # When
    result = check_expired_subscriptions()

    # Then
    db_session.refresh(user)
    assert user.is_premium is False
    assert subscription.status == "expired"
```

```go
func TestRevokesPremiumAccessWhenSubscriptionExpires(t *testing.T) {
    // Given
    db := testutil.NewTestDB(t)
    user := testutil.CreateUser(t, db)
    sub := testutil.CreateSubscription(t, db, user.ID,
        testutil.WithExpiry(time.Now().Add(-24*time.Hour)),
    )

    // When
    err := CheckExpiredSubscriptions(db)
    require.NoError(t, err)

    // Then
    updatedUser, _ := FindUser(db, user.ID)
    assert.False(t, updatedUser.IsPremium)

    updatedSub, _ := FindSubscription(db, sub.ID)
    assert.Equal(t, "expired", updatedSub.Status)
}
```

### Edge Case Discovery with Given-When-Then

For each behavior, ask:
- What if the "Given" is missing? (no user, no subscription, null values)
- What if the "When" happens twice? (duplicate requests, idempotency)
- What if the "When" happens concurrently? (race conditions)
- What if the "Then" partially fails? (DB write succeeds, email fails)

---

## 4. TDD Workflow

### Red-Green-Refactor

```
RED:    Write a failing test for the next behavior
GREEN:  Write the minimum code to make it pass
REFACTOR: Clean up without changing behavior (tests stay green)
```

### When TDD Works Well

- **Well-defined requirements** — You know what the code should do before writing it
- **Pure domain logic** — Calculations, validations, transformations
- **Bug fixes** — Write failing test first, then fix (see section 11)
- **API design** — Tests define the contract before implementation
- **Complex state machines** — Each transition is a test case

### When TDD Doesn't Work Well

- **Exploratory coding** — You don't know what you're building yet
- **UI prototyping** — Layout and styling change too fast
- **Spike / proof of concept** — You're learning, not shipping
- **Integration-heavy glue code** — The test setup is heavier than the code

### TDD Example: Building a Pricing Engine

```typescript
// Step 1: RED — simplest case
test('calculates price for single item', () => {
  const cart = new Cart();
  cart.add({ sku: 'SHOE-1', price: 9900, quantity: 1 });
  expect(cart.total()).toBe(9900);
});
// Write Cart class with total() returning item price × quantity

// Step 2: RED — multiple items
test('calculates price for multiple items', () => {
  const cart = new Cart();
  cart.add({ sku: 'SHOE-1', price: 9900, quantity: 2 });
  cart.add({ sku: 'SHIRT-1', price: 4900, quantity: 1 });
  expect(cart.total()).toBe(24700);
});
// Extend total() to sum all items

// Step 3: RED — discount code
test('applies percentage discount', () => {
  const cart = new Cart();
  cart.add({ sku: 'SHOE-1', price: 9900, quantity: 1 });
  cart.applyDiscount({ code: 'SAVE10', type: 'percent', value: 10 });
  expect(cart.total()).toBe(8910);
});
// Add discount logic

// Step 4: RED — edge case
test('discount cannot make total negative', () => {
  const cart = new Cart();
  cart.add({ sku: 'SHOE-1', price: 100, quantity: 1 });
  cart.applyDiscount({ code: 'BIG', type: 'fixed', value: 5000 });
  expect(cart.total()).toBe(0);  // Not -4900
});
// Add floor(0) logic

// Step 5: REFACTOR — clean up Cart internals
// Tests stay green, code gets cleaner
```

### TDD Discipline Rules

```
DO:
- Write only ONE failing test at a time
- Write the MINIMUM code to pass
- Refactor only when green
- Commit after each green phase

DON'T:
- Write multiple failing tests at once
- Write production code without a failing test
- Refactor while red
- Skip the refactor step
```

---

## 5. Test-After Workflow

### When Test-After Is the Right Choice

- You're exploring and the design is unclear
- You're prototyping and expect major rewrites
- You're working with unfamiliar technology
- You've already written the code (inherited codebase)

### The Process

```
Step 1: Write the code (prototype, explore, ship)
Step 2: Identify the behaviors the code implements
Step 3: Write tests for each behavior (Given-When-Then)
Step 4: Focus on public API, not internal implementation
Step 5: Check coverage — find untested critical paths
```

### WRONG vs CORRECT: Test-After

```python
# WRONG: Test-after that mirrors implementation
def test_process_order():
    # This test just repeats the code line by line
    order = Order(user_id=1, product_id=2, qty=3)
    order.calculate_subtotal()  # Tightly coupled to internals
    assert order._subtotal == 300  # Testing private state
    order.apply_tax()
    assert order._tax == 30  # Testing intermediate state
    order.finalize()
    assert order.status == "finalized"

# CORRECT: Test-after that tests behavior
def test_finalized_order_includes_tax():
    order = Order(user_id=1, product_id=2, qty=3)
    order.finalize()

    assert order.total == 330  # Behavior: total includes tax
    assert order.status == "finalized"  # Behavior: status changes
```

---

## 6. What NOT to Test

### The "Don't Test" List

```
NEVER test (waste of time):
├── Framework internals
│   ├── Laravel's routing dispatch
│   ├── Django's ORM query builder
│   ├── Go's net/http multiplexer
│   └── Express middleware chain
├── Third-party libraries
│   ├── Stripe's SDK returns the right object
│   ├── AWS SDK sends the right request
│   └── bcrypt hashes correctly
├── Language features
│   ├── Map/filter/reduce work
│   ├── String concatenation works
│   └── JSON.parse parses JSON
├── Trivial code
│   ├── Getters and setters
│   ├── Constructors that only assign
│   ├── Constants and config values
│   └── DTOs / data classes
└── Implementation details
    ├── Private methods
    ├── Internal state
    ├── Method call order
    └── Specific SQL generated
```

### WRONG: Testing Things That Don't Need Tests

```go
// WRONG: Testing that Go's json.Marshal works
func TestUserToJSON(t *testing.T) {
    u := User{Name: "John", Email: "john@x.com"}
    data, err := json.Marshal(u)
    require.NoError(t, err)
    assert.Contains(t, string(data), "John")
}

// WRONG: Testing a getter
func TestUserName(t *testing.T) {
    u := User{Name: "John"}
    assert.Equal(t, "John", u.Name)
}

// CORRECT: Test the behavior that uses the user
func TestCreateUserReturnsJSONResponse(t *testing.T) {
    srv := httptest.NewServer(NewRouter(testDB))
    resp, _ := http.Post(srv.URL+"/users", "application/json",
        strings.NewReader(`{"name":"John","email":"john@x.com"}`))

    assert.Equal(t, 201, resp.StatusCode)

    var body map[string]any
    json.NewDecoder(resp.Body).Decode(&body)
    assert.Equal(t, "John", body["name"])
}
```

```php
// WRONG: Testing Laravel's validation
it('validates required fields', function () {
    // This tests Laravel's validation engine, not your code
    $validator = Validator::make([], ['name' => 'required']);
    expect($validator->fails())->toBeTrue();
});

// CORRECT: Test your API's validation behavior
it('rejects user creation without name', function () {
    $response = $this->postJson('/api/users', [
        'email' => 'john@example.com',
    ]);

    $response->assertStatus(422)
        ->assertJsonValidationErrors(['name']);
});
```

### The Gray Zone

Some things are borderline. Use judgment:

| Thing | Test It? | Why / Why Not |
|---|---|---|
| Custom validation rules | Yes | Your logic, your rules |
| Eloquent scopes | Yes (via integration) | They encode business logic |
| View composers | Sometimes | If they contain logic beyond assignment |
| Middleware | Yes (via feature test) | Security-critical, test the behavior |
| Config values | No | Test the behavior that uses them |
| Database migrations | No (usually) | They're tested by integration tests implicitly |
| Seeders | No | Test data setup, not production logic |

---

## 7. Feature-Driven Testing

### Test the Feature, Not the Function

A "feature" is something a user does. A "function" is an implementation detail. Tests should map to features.

```
Feature: User can reset their password
  Tests:
  1. Requesting reset sends email with valid link
  2. Clicking expired link shows error
  3. Setting new password works with valid token
  4. Old password no longer works after reset
  5. Cannot reuse the reset link

NOT:
  1. PasswordResetController@store works
  2. PasswordResetService@generateToken returns string
  3. PasswordResetMailer@send calls Mail facade
  4. PasswordResetModel@isExpired checks timestamp
```

### WRONG vs CORRECT: Feature-Driven

```typescript
// WRONG: Testing individual functions
test('hashPassword returns hash', () => {
  const hash = hashPassword('secret');
  expect(hash).not.toBe('secret');
});

test('comparePassword matches', () => {
  const hash = hashPassword('secret');
  expect(comparePassword('secret', hash)).toBe(true);
});

test('UserService.create calls repo', () => {
  const repo = mock<UserRepo>();
  const service = new UserService(repo);
  await service.create({ name: 'A', password: 'secret' });
  expect(repo.save).toHaveBeenCalled();
});

// CORRECT: Testing the feature
test('user can register and login with their password', async () => {
  // Register
  const res = await request(app)
    .post('/api/register')
    .send({ name: 'Alice', email: 'alice@example.com', password: 'secret123' });
  expect(res.status).toBe(201);

  // Login with correct password
  const login = await request(app)
    .post('/api/login')
    .send({ email: 'alice@example.com', password: 'secret123' });
  expect(login.status).toBe(200);
  expect(login.body.token).toBeDefined();

  // Login with wrong password
  const bad = await request(app)
    .post('/api/login')
    .send({ email: 'alice@example.com', password: 'wrong' });
  expect(bad.status).toBe(401);
});
```

---

## 8. Testing Legacy Code

### The Problem

Legacy code has no tests. You need to change it. Changing it without tests is risky. Writing tests for it is hard because it wasn't designed for testability.

### Strategy 1: Characterization Tests

Characterization tests capture **current behavior**, not desired behavior. They're a safety net for refactoring.

```php
// Step 1: Call the code with known inputs
// Step 2: Assert the actual output (whatever it is)
// Step 3: Now you can refactor safely

it('calculates shipping (characterization)', function () {
    // We don't know if this is correct, but this is what it does now
    $calculator = new LegacyShippingCalculator();

    expect($calculator->calculate(weight: 1.0, zone: 'US'))->toBe(599);
    expect($calculator->calculate(weight: 5.0, zone: 'US'))->toBe(1299);
    expect($calculator->calculate(weight: 1.0, zone: 'EU'))->toBe(1999);
    expect($calculator->calculate(weight: 0.0, zone: 'US'))->toBe(0);
    expect($calculator->calculate(weight: -1.0, zone: 'US'))->toBe(0); // Bug? Or feature?
});
```

### Strategy 2: Golden Master

Capture the entire output for a set of inputs. Compare future output against this "golden" snapshot.

```python
# Generate golden master
def generate_golden_master():
    inputs = load_test_inputs()  # Diverse set of inputs
    results = {}
    for input_data in inputs:
        results[input_data.id] = legacy_process(input_data)
    save_json("golden_master.json", results)

# Test against golden master
def test_legacy_process_matches_golden_master():
    golden = load_json("golden_master.json")
    inputs = load_test_inputs()

    for input_data in inputs:
        result = legacy_process(input_data)
        assert result == golden[input_data.id], (
            f"Output changed for input {input_data.id}: "
            f"expected {golden[input_data.id]}, got {result}"
        )
```

### Strategy 3: Strangler Fig for Tests

Don't test all legacy code at once. Add tests around the code you're about to change.

```
Step 1: Identify the code you need to change
Step 2: Write characterization tests for that code
Step 3: Make your changes
Step 4: Verify characterization tests still pass (or update them deliberately)
Step 5: Add proper behavior tests for the new behavior
Step 6: Over time, legacy code gets test coverage organically
```

### Making Legacy Code Testable

```go
// BEFORE: Untestable — hardcoded dependencies
func ProcessOrder(orderID int) error {
    db, _ := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    order := queryOrder(db, orderID)
    resp, _ := http.Post("https://payment.api/charge", ...)
    sendEmail(order.UserEmail, "Order confirmed")
    return nil
}

// AFTER: Testable — injected dependencies
type OrderProcessor struct {
    DB      *sql.DB
    Payment PaymentClient
    Mailer  Mailer
}

func (p *OrderProcessor) Process(ctx context.Context, orderID int) error {
    order, err := queryOrder(p.DB, orderID)
    if err != nil {
        return fmt.Errorf("query order: %w", err)
    }
    if err := p.Payment.Charge(ctx, order.Total); err != nil {
        return fmt.Errorf("charge: %w", err)
    }
    return p.Mailer.Send(order.UserEmail, "Order confirmed")
}
```

---

## 9. Regression Test Strategy

### The Rule

Every bug found in production gets a test. Before fixing the bug, write a failing test that reproduces it. Then fix the bug. The test goes green. That bug never returns.

### The Process

```
Bug report: "Users can't checkout with coupon code 'SAVE50%'"

Step 1: Write failing test
  test('checkout works with percentage sign in coupon code')
  → Run it → it fails (reproduces the bug)

Step 2: Fix the bug
  → URL-encode the coupon code before sending to payment API

Step 3: Run the test
  → It passes

Step 4: The bug is now permanently guarded
```

### Example: Regression Test

```typescript
// Bug: Orders with exactly $100 subtotal don't get free shipping
// Expected: Free shipping for orders >= $100
// Actual: Only orders > $100 get free shipping (off-by-one)

test('free shipping applies at exactly $100 (regression: #1234)', () => {
  const cart = new Cart();
  cart.add({ price: 10000, quantity: 1 }); // Exactly $100

  expect(cart.shippingCost()).toBe(0);
  expect(cart.qualifiesForFreeShipping()).toBe(true);
});

// Fix: change > to >= in shipping calculation
```

```php
// Bug: Duplicate orders when user double-clicks submit
it('prevents duplicate order creation (regression: JIRA-5678)', function () {
    $user = User::factory()->create();
    $product = Product::factory()->create(['stock' => 1]);

    // Simulate double submission
    $payload = ['product_id' => $product->id, 'quantity' => 1];

    $response1 = $this->actingAs($user)->postJson('/api/orders', $payload);
    $response2 = $this->actingAs($user)->postJson('/api/orders', $payload);

    $response1->assertCreated();
    $response2->assertStatus(409); // Conflict — duplicate detected

    expect(Order::count())->toBe(1);
    expect($product->fresh()->stock)->toBe(0);
});
```

### Tagging Regression Tests

Always reference the bug ticket in the test name or description. Future developers need to know **why** this specific edge case has a test.

```python
# Good: references the issue
def test_csv_export_handles_unicode_names_regression_gh_892():
    """Regression for GitHub #892: CSV export crashed on non-ASCII names."""
    user = UserFactory.create(name="José García")
    csv_data = export_users_csv([user])
    assert "José García" in csv_data
```

---

## 10. Coverage Targets

### Coverage Is a Compass, Not a Goal

```
WRONG mindset:
  "We need 90% coverage"
  → Team writes trivial tests to hit the number
  → Coverage is 90%, bugs still ship

CORRECT mindset:
  "We need coverage on critical paths"
  → Team writes meaningful tests where bugs happen
  → Coverage is 72%, but bugs don't ship
```

### Meaningful Coverage Metrics

| Metric | What It Measures | Usefulness |
|---|---|---|
| **Line coverage** | Lines executed during tests | Low — easy to game |
| **Branch coverage** | Decision paths taken | Medium — catches missed if/else |
| **Function coverage** | Functions called | Low — doesn't verify behavior |
| **Mutation coverage** | Tests that catch injected bugs | High — but slow to compute |

### Coverage Targets by Context

| Context | Suggested Target | Notes |
|---|---|---|
| **New project** | 80% line, focus on branch | Good starting point |
| **Critical path** | 95%+ branch | Auth, payments, data mutation |
| **Utility library** | 90%+ line | Public API fully covered |
| **Legacy code** | Ratchet (never decrease) | Add coverage with each change |
| **Prototype** | 0% | Don't bother yet |
| **Mature product** | 75-85% line, review gaps | Focus on uncovered critical code |

### Coverage Ratcheting

Never let coverage decrease. New code must come with tests.

```yaml
# In CI configuration — fail if coverage drops
coverage:
  check:
    global:
      lines: 75     # Current level — never goes down
      branches: 60  # Current level — never goes down
    # New files must have higher coverage
    new_files:
      lines: 85
      branches: 70
```

### The Coverage Trap

```
File: AdminDashboardController.php — 100% coverage
  But: All tests just check HTTP 200, no assertions on data

File: PaymentService.php — 60% coverage
  But: All critical paths tested with edge cases, error handling verified

Which file has better tests? PaymentService. Coverage says otherwise.
```

**Measure what tests verify, not what lines they touch.**

---

## 11. Test-Driven Bug Fixing

### The Workflow

```
Bug report arrives
    │
    ▼
Can you reproduce the bug?
    │
    ├── YES → Write a failing test that demonstrates the bug
    │         Fix the code → Test goes green → Ship
    │
    └── NO  → Investigate further
              Add logging / observability
              Try different inputs
              Check production data patterns
              → Once reproduced → Write failing test → Fix → Green
```

### Why This Matters

- **Proves the bug exists** — If the test passes, the bug isn't what you think it is
- **Proves the fix works** — Green test = bug fixed
- **Prevents regression** — The bug can't silently return
- **Documents the edge case** — Future developers see the exact scenario

### Full Example

```
Bug: "User reports they were charged twice for the same order"
```

```go
// Step 1: Write the failing test
func TestPreventsDuplicateCharge(t *testing.T) {
    db := testutil.NewTestDB(t)
    paymentSvc := &FakePaymentService{}
    handler := NewCheckoutHandler(db, paymentSvc)

    // Create order
    user := testutil.CreateUser(t, db)
    order := testutil.CreateOrder(t, db, user.ID, 5000)

    // Submit checkout twice (simulating double-click or retry)
    ctx := testutil.AuthContext(user)
    req1 := CheckoutRequest{OrderID: order.ID, IdempotencyKey: "key-123"}
    req2 := CheckoutRequest{OrderID: order.ID, IdempotencyKey: "key-123"}

    res1, err1 := handler.Checkout(ctx, req1)
    res2, err2 := handler.Checkout(ctx, req2)

    // First should succeed
    require.NoError(t, err1)
    assert.Equal(t, "success", res1.Status)

    // Second should return the same result without charging again
    require.NoError(t, err2)
    assert.Equal(t, "success", res2.Status)

    // Only one charge should have been made
    assert.Equal(t, 1, paymentSvc.ChargeCount())
    assert.Equal(t, int64(5000), paymentSvc.TotalCharged())
}

// Step 2: Run test → it fails (bug confirmed!)
// Step 3: Add idempotency key check to Checkout handler
// Step 4: Run test → it passes (bug fixed!)
// Step 5: This test lives forever, guarding against regression
```

```php
// Laravel equivalent
it('prevents duplicate charge on double submit (regression: #2847)', function () {
    $user = User::factory()->create();
    $order = Order::factory()->for($user)->create(['total' => 5000]);

    Http::fake([
        'payment.api/*' => Http::response(['status' => 'charged'], 200),
    ]);

    $payload = ['order_id' => $order->id, 'idempotency_key' => 'key-123'];

    $res1 = $this->actingAs($user)->postJson('/api/checkout', $payload);
    $res2 = $this->actingAs($user)->postJson('/api/checkout', $payload);

    $res1->assertOk();
    $res2->assertOk();

    // Payment API should have been called only once
    Http::assertSentCount(1);

    // Only one payment record in DB
    expect(Payment::where('order_id', $order->id)->count())->toBe(1);
});
```

### Bug Fix Checklist

```
[ ] Bug reproduced locally
[ ] Failing test written
[ ] Root cause identified
[ ] Fix implemented
[ ] Test passes
[ ] No other tests broken
[ ] Regression test tagged with bug/ticket reference
[ ] Fix deployed, bug verified in production
```
