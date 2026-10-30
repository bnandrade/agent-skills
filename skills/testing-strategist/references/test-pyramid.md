# Test Pyramid

Models for structuring test suites, ratio guidance by app type, and when to break the rules.

---

## Table of Contents

1. [Classic Test Pyramid](#1-classic-test-pyramid)
2. [Testing Trophy](#2-testing-trophy)
3. [Testing Honeycomb](#3-testing-honeycomb)
4. [Testing Diamond](#4-testing-diamond)
5. [Decision Matrix: Which Model for Which App](#5-decision-matrix-which-model-for-which-app)
6. [Unit Tests: Boundaries of Value](#6-unit-tests-boundaries-of-value)
7. [Integration Tests: Testing Real Dependencies](#7-integration-tests-testing-real-dependencies)
8. [End-to-End Tests: When Worth the Cost](#8-end-to-end-tests-when-worth-the-cost)
9. [Contract Tests](#9-contract-tests)
10. [Test Ratios by App Type](#10-test-ratios-by-app-type)
11. [When to Break the Pyramid](#11-when-to-break-the-pyramid)

---

## 1. Classic Test Pyramid

Mike Cohn's original model. Most teams start here.

```
        /  E2E  \          Few, slow, expensive
       /----------\
      / Integration \      Some, medium speed
     /----------------\
    /    Unit Tests     \  Many, fast, cheap
   /____________________\
```

### The Logic

- Unit tests are fast, cheap, deterministic — write many.
- Integration tests verify components work together — write enough.
- E2E tests verify the whole system — write few, only critical paths.

### When It Works

- Libraries and SDKs (heavy unit, light integration, minimal E2E)
- Domain-heavy apps with complex business logic
- Projects where units of work are well-isolated

### When It Fails

- CRUD APIs where unit tests test almost nothing interesting
- Microservices where inter-service behavior is the real risk
- SPAs where component interactions matter more than isolated logic

---

## 2. Testing Trophy

Kent C. Dodds' model. Dominant in frontend/JavaScript ecosystems.

```
        /  E2E  \              Few
       /----------\
      /             \
     / Integration   \        MOST tests here
    /                  \
   / Unit    |  Static  \    Some + linting/types
  /________________________\
```

### The Layers

1. **Static analysis** — TypeScript, ESLint, type checking. Catches typos, type mismatches, unused vars. Zero runtime cost.
2. **Unit tests** — Pure functions, utilities, transformations. Only where logic is isolated.
3. **Integration tests** — The bulk. Test components with their children, test API routes with real middleware, test services with real DB.
4. **E2E tests** — Critical user flows only. Login, checkout, signup.

### Why Integration-Heavy

Integration tests give the highest confidence-per-line-of-test. A single integration test covers multiple units working together, catching bugs that unit tests miss.

```typescript
// WRONG: Unit testing a React component in isolation with mocked everything
test('Button calls onClick', () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick} />);
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalled();
});

// CORRECT: Integration test — the feature, not the component
test('user can add item to cart', async () => {
  render(<ProductPage productId="123" />);

  await screen.findByText('Running Shoes');
  await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

  expect(screen.getByText('1 item in cart')).toBeInTheDocument();
  expect(await screen.findByText('Added to cart')).toBeInTheDocument();
});
```

### When to Use the Trophy

- React/Vue/Svelte SPAs
- Next.js / Nuxt.js full-stack apps
- Any frontend-heavy project with TypeScript

---

## 3. Testing Honeycomb

Spotify's model for microservices. Integration tests dominate.

```
        /  E2E  \                 Very few (cross-service)
       /----------\
      /             \
     /  Integration  \           MOST tests here
    /    (service      \         (test each service with
   /      boundaries)   \        real DB, real HTTP)
  /                      \
  \     Unit Tests       /       Few (complex domain logic only)
   \____________________/
```

### The Logic for Microservices

In a microservice architecture:
- Individual services are small — there's not much to unit test
- The risk is in how services communicate
- Integration tests per service (real DB, real HTTP) catch the real bugs
- Cross-service E2E tests catch contract violations

### What "Integration" Means Here

For each microservice, test:
- HTTP handlers with real request/response
- Database queries against real (test) database
- Message consumers with real message payloads
- Outgoing HTTP calls against contract stubs

```go
// WRONG: Unit testing a handler with mocked everything
func TestGetUser(t *testing.T) {
    mockRepo := &MockUserRepo{}
    mockRepo.On("FindByID", 1).Return(&User{Name: "John"}, nil)
    handler := NewHandler(mockRepo)
    // ... tests handler in complete isolation
}

// CORRECT: Integration test — real DB, real HTTP
func TestGetUser(t *testing.T) {
    db := testutil.NewTestDB(t)
    testutil.SeedUser(t, db, &User{ID: 1, Name: "John"})

    srv := httptest.NewServer(NewRouter(db))
    defer srv.Close()

    resp, err := http.Get(srv.URL + "/users/1")
    require.NoError(t, err)
    require.Equal(t, 200, resp.StatusCode)

    var user User
    json.NewDecoder(resp.Body).Decode(&user)
    assert.Equal(t, "John", user.Name)
}
```

### When to Use the Honeycomb

- Microservice architectures (3+ services)
- Event-driven systems
- Service mesh / API gateway setups

---

## 4. Testing Diamond

Backend-heavy variant. Integration tests are the widest layer.

```
        /  E2E  \              Few
       /----------\
      /             \
     / Integration   \        MOST tests here
    /                  \
     \  Unit Tests   /         Some (pure domain logic)
      \_____________/
```

### Why Diamond for Backends

A typical backend API:
- Receives HTTP request
- Validates input
- Queries/writes to database
- Calls external services
- Returns HTTP response

Most of this is **integration by nature**. The valuable test hits the real endpoint with a real database. Unit tests only add value for complex domain calculations.

```python
# WRONG: Unit testing a view function with mocked DB
def test_create_order(mock_db, mock_user):
    mock_db.query.return_value = [Product(id=1, price=1000)]
    result = create_order(mock_user, product_id=1, qty=2)
    assert result.total == 2000  # But does it actually work with real DB?

# CORRECT: Integration test with real database
def test_create_order(client, db_session):
    user = UserFactory.create()
    product = ProductFactory.create(price=1000)

    response = client.post("/api/orders", json={
        "product_id": product.id,
        "quantity": 2,
    }, headers=auth_headers(user))

    assert response.status_code == 201
    order = db_session.query(Order).first()
    assert order.total == 2000
    assert order.user_id == user.id
```

### When to Use the Diamond

- REST/GraphQL APIs
- Backend monoliths (Laravel, Django, Rails, Spring)
- CRUD-heavy applications

---

## 5. Decision Matrix: Which Model for Which App

| App Type | Recommended Model | Reasoning |
|---|---|---|
| **Library / SDK** | Classic Pyramid | Pure logic, well-defined inputs/outputs, unit tests are king |
| **CLI tool** | Classic Pyramid | Input → process → output, mostly unit-testable |
| **SPA (React/Vue)** | Trophy | Integration between components is the real risk |
| **Full-stack (Next/Nuxt)** | Trophy | Static analysis + integration cover most risk |
| **REST API** | Diamond | DB integration is where bugs live |
| **GraphQL API** | Diamond | Resolver + DB interaction is the core |
| **Microservice** | Honeycomb | Service boundaries are the risk |
| **Mobile app** | Trophy + E2E | Component integration + critical flow E2E |
| **Monolith** | Diamond | Heavy integration, some unit for domain logic |
| **Event-driven system** | Honeycomb | Message contracts are the risk |
| **Data pipeline** | Classic Pyramid | Transform functions are unit-testable |

### Decision Flow

```
Is your code mostly pure logic with few side effects?
  YES → Classic Pyramid (unit-heavy)
  NO ↓

Is your code mostly glue between database, HTTP, and services?
  YES → Diamond or Honeycomb (integration-heavy)
  NO ↓

Is your code a frontend with component interactions?
  YES → Trophy (integration + static analysis)
  NO ↓

Default → Diamond (integration-heavy is rarely wrong for backends)
```

---

## 6. Unit Tests: Boundaries of Value

### What Counts as a Unit Test

A unit test:
- Tests a single behavior (not a single function — a single behavior)
- Runs without external dependencies (no DB, no HTTP, no file system)
- Is deterministic (same input, same output, every time)
- Is fast (< 10ms)

### When Unit Tests Are Valuable

```
HIGH VALUE:
- Complex calculations (tax, pricing, discounts, scoring)
- Data transformations (parsing, formatting, mapping)
- Validation logic (business rules, input validation)
- State machines (workflow transitions)
- Pure domain logic (DDD entities, value objects)
- Algorithm implementations (sorting, search, graph traversal)

LOW VALUE:
- Thin wrappers around framework (controllers that just delegate)
- CRUD operations (the integration test covers this better)
- Getters and setters
- Constructor initialization
- Delegating methods (just calls another method)
```

### WRONG vs CORRECT: Unit Test Value

```php
// WRONG: Unit testing a trivial getter
test('user has name', function () {
    $user = new User(name: 'John');
    expect($user->name)->toBe('John');
});

// CORRECT: Unit testing complex business logic
test('order discount applies tiered pricing', function () {
    $order = new Order(items: [
        new LineItem(price: 10000, quantity: 5),  // $500
        new LineItem(price: 5000, quantity: 10),   // $500
    ]);

    // Tier: $0-$500 = 0%, $500-$1000 = 10%
    expect($order->discount())->toBe(5000);  // 10% of second $500
    expect($order->total())->toBe(95000);    // $1000 - $50
});
```

```typescript
// WRONG: Unit testing a pass-through service
test('UserService.getById calls repo', () => {
  const repo = { findById: vi.fn().mockResolvedValue({ id: 1 }) };
  const service = new UserService(repo);
  await service.getById(1);
  expect(repo.findById).toHaveBeenCalledWith(1);  // Testing implementation!
});

// CORRECT: Unit testing a complex transformation
test('formatCurrency handles all locales', () => {
  expect(formatCurrency(1234.5, 'en-US')).toBe('$1,234.50');
  expect(formatCurrency(1234.5, 'pt-BR')).toBe('R$ 1.234,50');
  expect(formatCurrency(1234.5, 'de-DE')).toBe('1.234,50 €');
  expect(formatCurrency(0, 'en-US')).toBe('$0.00');
  expect(formatCurrency(-99.9, 'en-US')).toBe('-$99.90');
});
```

---

## 7. Integration Tests: Testing Real Dependencies

### What Makes a Test "Integration"

An integration test uses at least one real external dependency:
- Real database (PostgreSQL, MySQL, SQLite)
- Real HTTP (actual request/response cycle)
- Real file system (temp dirs, actual file I/O)
- Real message queue (or in-memory equivalent)

### Database Integration

```php
// Laravel — real database, real Eloquent, real relationships
it('filters orders by date range', function () {
    Order::factory()->create(['created_at' => '2024-01-15']);
    Order::factory()->create(['created_at' => '2024-02-15']);
    Order::factory()->create(['created_at' => '2024-03-15']);

    $response = $this->getJson('/api/orders?from=2024-02-01&to=2024-02-28');

    $response->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.created_at', fn ($date) =>
            str_starts_with($date, '2024-02-15')
        );
});
```

```go
// Go — real PostgreSQL via testcontainers
func TestOrderRepository_FilterByDate(t *testing.T) {
    ctx := context.Background()
    db := testutil.NewPostgresDB(t)

    repo := NewOrderRepo(db)
    repo.Create(ctx, &Order{CreatedAt: time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC)})
    repo.Create(ctx, &Order{CreatedAt: time.Date(2024, 2, 15, 0, 0, 0, 0, time.UTC)})
    repo.Create(ctx, &Order{CreatedAt: time.Date(2024, 3, 15, 0, 0, 0, 0, time.UTC)})

    orders, err := repo.FilterByDate(ctx,
        time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC),
        time.Date(2024, 2, 28, 0, 0, 0, 0, time.UTC),
    )

    require.NoError(t, err)
    assert.Len(t, orders, 1)
    assert.Equal(t, 2, orders[0].CreatedAt.Month())
}
```

### HTTP Integration

```python
# FastAPI — real HTTP via TestClient, real DB
def test_create_and_retrieve_user(client, db_session):
    # Create
    response = client.post("/api/users", json={
        "name": "Alice",
        "email": "alice@example.com",
    })
    assert response.status_code == 201
    user_id = response.json()["id"]

    # Retrieve
    response = client.get(f"/api/users/{user_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Alice"

    # Verify DB
    user = db_session.query(User).get(user_id)
    assert user is not None
    assert user.email == "alice@example.com"
```

```typescript
// Express/Fastify — real HTTP via supertest
describe('POST /api/users', () => {
  it('creates user and returns 201', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: 'Alice',
      email: 'alice@example.com',
    });

    // Verify in DB
    const user = await db.query('SELECT * FROM users WHERE id = $1', [res.body.id]);
    expect(user.rows[0].name).toBe('Alice');
  });
});
```

### When Real DB vs In-Memory

| Situation | Use Real DB | Use SQLite/In-Memory |
|---|---|---|
| Testing queries with PostgreSQL-specific features | Yes | No |
| Testing basic CRUD operations | Either works | Faster option |
| Testing migrations | Yes | No |
| Testing concurrent access | Yes | No |
| CI pipeline (speed matters) | Testcontainers | Acceptable shortcut |
| Local development (fast feedback) | Docker | Acceptable shortcut |

---

## 8. End-to-End Tests: When Worth the Cost

### The Cost of E2E

- **Slow** — browser automation, full stack boot, network round trips
- **Flaky** — timing issues, animation waits, external dependencies
- **Expensive** — maintenance, infrastructure, debug time
- **Valuable** — catches bugs nothing else catches

### When E2E Is Worth It

```
ALWAYS E2E:
- Authentication (login, signup, password reset, MFA)
- Payment processing (checkout, subscription, refund)
- Core business workflow (the thing users pay you for)
- Onboarding flow (first-time user experience)

SOMETIMES E2E:
- Search functionality (if complex)
- File upload/download (if critical)
- Email notification triggers (if revenue-impacting)

RARELY E2E:
- Settings pages
- About/info pages
- Admin-only features with few users
- Features already well-covered by integration tests
```

### Keeping E2E Manageable

```typescript
// WRONG: Testing every detail in E2E
test('complete checkout', async ({ page }) => {
  await page.goto('/products');
  await expect(page.locator('.product-card')).toHaveCount(12);  // Fragile
  await expect(page.locator('.product-card').first()).toContainText('$'); // Noise
  await page.click('.product-card:first-child .add-to-cart');
  await expect(page.locator('.cart-count')).toHaveText('1');  // Implementation detail
  // ... 50 more assertions on UI details
});

// CORRECT: Testing the critical path, not the UI details
test('user can complete checkout', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('button', { name: /add to cart/i }).first().click();
  await page.getByRole('link', { name: /cart/i }).click();
  await page.getByRole('button', { name: /checkout/i }).click();

  await page.fill('[name="card"]', '4242424242424242');
  await page.fill('[name="expiry"]', '12/30');
  await page.fill('[name="cvc"]', '123');
  await page.getByRole('button', { name: /pay/i }).click();

  await expect(page.getByText(/order confirmed/i)).toBeVisible();
});
```

---

## 9. Contract Tests

### The Problem

Service A calls Service B. Service B changes its response format. Service A's unit tests pass (they mock B). Integration tests pass (they test A in isolation). Production breaks.

### Pact — Consumer-Driven Contract Testing

```
Consumer (Service A)        Provider (Service B)
     |                              |
     |--- defines expectations ---->|
     |    (what I expect you to     |
     |     return for X request)    |
     |                              |
     |    Pact generates a          |
     |    contract file             |
     |                              |
     |                   Provider verifies
     |                   contract against
     |                   real implementation
```

### When to Use Contracts

| Situation | Contract Tests? |
|---|---|
| 2+ services owned by different teams | Yes, strongly recommended |
| Microservices same team | Yes, helpful |
| Frontend consuming a backend API | Yes, if API changes frequently |
| Monolith (all in one deploy) | No, integration tests suffice |
| Third-party API you don't control | No, use record-replay instead |

### Contract Test Example (TypeScript + Pact)

```typescript
// Consumer side (frontend or calling service)
describe('User API Contract', () => {
  it('returns user by ID', async () => {
    await provider.addInteraction({
      state: 'user with ID 1 exists',
      uponReceiving: 'a request for user 1',
      withRequest: {
        method: 'GET',
        path: '/api/users/1',
      },
      willRespondWith: {
        status: 200,
        body: {
          id: like(1),
          name: like('John'),
          email: like('john@example.com'),
        },
      },
    });

    const user = await userClient.getById(1);
    expect(user.name).toBeDefined();
    expect(user.email).toBeDefined();
  });
});
```

```python
# Provider side (the API being consumed)
# Pact verifier runs the contract against the real API
def test_provider_honors_contract():
    verifier = Verifier(
        provider="UserService",
        provider_base_url="http://localhost:8000",
    )
    output, _ = verifier.verify_pacts(
        "path/to/pacts/consumer-userservice.json",
        provider_states_setup_url="http://localhost:8000/_pact/setup",
    )
    assert output == 0
```

---

## 10. Test Ratios by App Type

These are starting points, not mandates. Adjust based on where your bugs actually happen.

### CRUD API (Laravel, Django, Express, Go HTTP)

```
Unit:        20%  — Business rules, validation, calculations
Integration: 60%  — API endpoints with real DB
E2E:         20%  — Critical flows (auth, payment)
```

### Library / SDK

```
Unit:        70%  — Public API surface, edge cases
Integration: 20%  — Works with real filesystem, HTTP, etc.
E2E:         10%  — Example apps / smoke tests
```

### SPA (React, Vue)

```
Static:      20%  — TypeScript + ESLint
Unit:        10%  — Utility functions, hooks with complex logic
Integration: 50%  — Component interactions, page behavior
E2E:         20%  — Critical user journeys
```

### Microservices (per service)

```
Unit:        15%  — Complex domain logic only
Integration: 65%  — HTTP handlers, DB queries, message handlers
Contract:    15%  — Service-to-service boundaries
E2E:          5%  — Cross-service critical paths (sparse)
```

### Mobile App (React Native, Flutter)

```
Unit:        15%  — Business logic, state reducers
Integration: 45%  — Screen components with navigation, API integration
E2E:         30%  — Critical user flows on real device/emulator
Snapshot:    10%  — UI regression (selective, not everything)
```

### CLI Tool

```
Unit:        60%  — Command parsing, output formatting, logic
Integration: 30%  — Full command execution with temp files
E2E:         10%  — Full binary execution, exit codes
```

### Data Pipeline / ETL

```
Unit:        50%  — Transform functions, validators, parsers
Integration: 40%  — Full pipeline with test data
E2E:         10%  — End-to-end with real (sampled) data
```

---

## 11. When to Break the Pyramid

The pyramid is a default. Break it deliberately, not accidentally.

### More E2E Than Usual

- **Payment flows** — The cost of a bug is too high. E2E every payment path.
- **Regulatory compliance** — Healthcare, finance, legal. Prove it works end-to-end.
- **Multi-step wizards** — State flows across pages are hard to test in isolation.
- **Third-party integrations** — Stripe webhooks, OAuth flows, SMS providers.

### More Unit Than Usual

- **Algorithm-heavy code** — ML preprocessing, mathematical models, compilers.
- **Libraries consumed by others** — Every public method needs edge case coverage.
- **Pure domain logic** — DDD bounded contexts with complex invariants.

### Fewer Tests Overall

- **Prototype / throw-away code** — Ship it, learn, rewrite. Zero tests is fine.
- **Hackathon / spike** — Speed matters more than correctness.
- **One-time scripts** — Run it, verify manually, delete it.

### Warning Signs You Broke It Wrong

```
WRONG reasons to skip integration tests:
- "They're slow" — Fix the slowness, don't skip the tests
- "They're flaky" — Fix the flakiness, don't skip the tests
- "We have unit tests" — Unit tests don't catch integration bugs
- "We do manual testing" — Manual testing doesn't scale

WRONG reasons to skip unit tests:
- "We have integration tests" — Integration tests are too slow for edge cases
- "The code is simple" — Simple code with complex rules needs unit tests
- "We'll add them later" — You won't

CORRECT reasons to adjust ratios:
- "Our bugs come from X, so we test X more" — Risk-based
- "This is a prototype, we'll rewrite in 2 weeks" — Pragmatic
- "This code path handles money" — Critical path
- "We changed the architecture" — New risk profile
```

### The Meta-Rule

**Test where the bugs are.** Track where production bugs originate. If 80% of your bugs come from database queries, your test suite should be integration-heavy. If 80% come from business logic, go unit-heavy. Let your bug history drive your test ratio.

```
Step 1: Start with the recommended ratio for your app type
Step 2: Ship, observe, track bugs
Step 3: After 3 months, look at bug sources
Step 4: Shift ratio toward where bugs actually happen
Step 5: Repeat
```

This is the only honest way to optimize a test suite. Everything else is theory.
