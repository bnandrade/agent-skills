# Mocking Strategies

When to mock, when to use real dependencies, test double hierarchy, and avoiding the over-mocking trap.

---

## Table of Contents

1. [Test Double Vocabulary](#1-test-double-vocabulary)
2. [When to Mock](#2-when-to-mock)
3. [When NOT to Mock](#3-when-not-to-mock)
4. [Test Doubles Hierarchy](#4-test-doubles-hierarchy)
5. [Database: Real vs In-Memory vs Mock](#5-database-real-vs-in-memory-vs-mock)
6. [HTTP: Testing Network Calls](#6-http-testing-network-calls)
7. [Time: Controlling the Clock](#7-time-controlling-the-clock)
8. [File System: Temp Dirs and Fakes](#8-file-system-temp-dirs-and-fakes)
9. [Email, Queue, Events: Framework Fakes](#9-email-queue-events-framework-fakes)
10. [Third-Party APIs: Record-Replay and Contract Tests](#10-third-party-apis-record-replay-and-contract-tests)
11. [Over-Mocking Anti-Pattern](#11-over-mocking-anti-pattern)
12. [Sociable vs Solitary Unit Tests](#12-sociable-vs-solitary-unit-tests)
13. [Snapshot Testing](#13-snapshot-testing)

---

## 1. Test Double Vocabulary

Precise definitions. These are not interchangeable.

| Term | What It Does | Example |
|---|---|---|
| **Dummy** | Fills a parameter slot, never used | `new Logger(dummyConfig)` — config never read |
| **Stub** | Returns predetermined values | `stub.getUser()` always returns `{name: "John"}` |
| **Fake** | Working implementation, simplified | In-memory database, fake SMTP server |
| **Spy** | Records calls for later assertion | `spy.send()` → assert `spy.wasCalled(2)` |
| **Mock** | Pre-programmed expectations, verifies calls | `mock.expect("send").once().with(email)` |

### The Important Distinction

- **Stubs** are about **providing input** — "when asked for X, return Y"
- **Mocks** are about **verifying output** — "assert that X was called with Y"
- **Fakes** are about **simulating behavior** — "a real thing, but simpler"

```typescript
// Stub — provides canned data
const userRepo = { findById: vi.fn().mockResolvedValue({ id: 1, name: 'Alice' }) };

// Spy — records calls, still works normally
const sendEmail = vi.spyOn(mailer, 'send');
// ... run code ...
expect(sendEmail).toHaveBeenCalledWith('alice@example.com', expect.any(String));

// Fake — simplified but functional implementation
class InMemoryUserRepo implements UserRepo {
  private users: Map<number, User> = new Map();
  async findById(id: number) { return this.users.get(id) ?? null; }
  async save(user: User) { this.users.set(user.id, user); }
}

// Mock — pre-programmed expectations (Mockery style in PHP)
$mock = Mockery::mock(PaymentGateway::class);
$mock->shouldReceive('charge')
    ->once()
    ->with(5000, 'usd')
    ->andReturn(new ChargeResult(success: true));
```

---

## 2. When to Mock

### Mock These

| Dependency | Why Mock It | What to Use |
|---|---|---|
| **External APIs** (Stripe, Twilio, AWS) | Slow, costs money, rate-limited, non-deterministic | HTTP fake, record-replay |
| **Email/SMS sending** | Side effect you don't want in tests | Framework fake (Mail::fake) |
| **Non-deterministic** (random, UUID, time) | Tests must be deterministic | Fake clock, seeded random |
| **Slow operations** (video processing, ML inference) | Tests must be fast | Stub the result |
| **Third-party SDKs** | You don't control the behavior | Interface + fake implementation |
| **External file storage** (S3, GCS) | Network dependency | Storage::fake, in-memory |

### Decision Flow

```
Is the dependency external (network call)?
  YES → Mock it (HTTP fake, record-replay, or stub)
  NO ↓

Is the dependency non-deterministic (time, random)?
  YES → Fake it (fake clock, seeded random)
  NO ↓

Is the dependency slow (> 100ms)?
  YES → Consider faking it (in-memory alternative)
  NO ↓

Is the dependency a side effect (email, SMS, webhook)?
  YES → Fake it (framework fakes)
  NO ↓

Use the real thing.
```

---

## 3. When NOT to Mock

### Don't Mock These

| Dependency | Why Not Mock It | What to Do Instead |
|---|---|---|
| **Your own code** | Mocking your own code means testing nothing | Use the real implementation |
| **Database** | DB bugs are the #1 source of production issues | Use real DB (testcontainers, SQLite) |
| **Simple functions** | The mock is more complex than the real thing | Call the real function |
| **Value objects / DTOs** | They have no behavior to mock | Use real instances |
| **HTTP middleware** | Test the full stack behavior | Use real middleware in test server |
| **File system** (for simple cases) | Temp dirs are fast and reliable | Use `t.TempDir()` or equivalent |

### WRONG vs CORRECT: Mocking Decisions

```python
# WRONG: Mocking the database
def test_user_creation(mock_db):
    mock_db.query.return_value = None  # "No existing user"
    mock_db.insert.return_value = {"id": 1, "name": "Alice"}

    user = create_user(mock_db, "Alice", "alice@example.com")

    assert user["name"] == "Alice"
    mock_db.insert.assert_called_once()
    # Problem: tests pass, but real DB has unique constraint violations,
    # wrong column types, missing indexes, etc.

# CORRECT: Real database
def test_user_creation(client, db_session):
    response = client.post("/api/users", json={
        "name": "Alice",
        "email": "alice@example.com",
    })

    assert response.status_code == 201
    user = db_session.query(User).filter_by(email="alice@example.com").first()
    assert user is not None
    assert user.name == "Alice"
```

```go
// WRONG: Mocking your own repository
func TestCreateOrder(t *testing.T) {
    mockRepo := &MockOrderRepo{}
    mockRepo.On("Save", mock.Anything).Return(nil)
    mockPricing := &MockPricingService{}
    mockPricing.On("Calculate", mock.Anything).Return(5000, nil)

    svc := NewOrderService(mockRepo, mockPricing)
    err := svc.CreateOrder(ctx, order)

    assert.NoError(t, err)
    mockRepo.AssertCalled(t, "Save", mock.Anything)
    // Problem: You're testing that your code calls methods in a specific order.
    // You're NOT testing that orders are created correctly.

// CORRECT: Use real dependencies, mock only external
func TestCreateOrder(t *testing.T) {
    db := testutil.NewTestDB(t)
    repo := NewOrderRepo(db)
    pricing := NewPricingService() // Real pricing logic

    svc := NewOrderService(repo, pricing)
    err := svc.CreateOrder(ctx, Order{
        UserID: 1, Items: []Item{{SKU: "A", Qty: 2, Price: 2500}},
    })

    require.NoError(t, err)
    order, _ := repo.FindByUserID(ctx, 1)
    assert.Equal(t, int64(5000), order.Total)
}
```

---

## 4. Test Doubles Hierarchy

### Prefer Fakes Over Stubs Over Mocks

```
Best  → Fake (real behavior, simplified)
        Stub (canned data, no behavior verification)
        Spy (records calls, verify after)
Worst → Mock (pre-programmed expectations, verify during)
```

### Why Fakes Are Better

A fake is a real, working implementation that's simplified for testing. It catches bugs that stubs and mocks miss.

```typescript
// STUB: Returns canned data — doesn't catch logic bugs
const cacheStub = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
};

// FAKE: Real behavior, in-memory — catches real bugs
class InMemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  async get(key: string): Promise<unknown | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

// The fake catches bugs like: "forgot to check expiry", "wrong TTL calculation"
// The stub catches nothing — it always returns what you told it to return
```

```go
// Fake SMTP for testing email
type FakeSMTP struct {
    mu       sync.Mutex
    Messages []Email
}

func (f *FakeSMTP) Send(to, subject, body string) error {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.Messages = append(f.Messages, Email{To: to, Subject: subject, Body: body})
    return nil
}

func (f *FakeSMTP) Sent() []Email {
    f.mu.Lock()
    defer f.mu.Unlock()
    return slices.Clone(f.Messages)
}

// In test:
func TestOrderConfirmationEmail(t *testing.T) {
    smtp := &FakeSMTP{}
    svc := NewOrderService(db, smtp)

    svc.CreateOrder(ctx, order)

    emails := smtp.Sent()
    require.Len(t, emails, 1)
    assert.Equal(t, "alice@example.com", emails[0].To)
    assert.Contains(t, emails[0].Subject, "Order Confirmed")
}
```

---

## 5. Database: Real vs In-Memory vs Mock

### Decision Guide

| Approach | Speed | Fidelity | Use When |
|---|---|---|---|
| **Real DB (PostgreSQL/MySQL)** | Slow-ish (100ms+) | Perfect | Testing queries, constraints, migrations |
| **Testcontainers** | Medium (startup cost) | Perfect | CI, when you need real DB but disposable |
| **SQLite in-memory** | Fast (< 10ms) | Good enough | Basic CRUD, no DB-specific features |
| **Mocked DB** | Fastest | Zero | **Never** (almost always wrong) |

### Real DB Setup Patterns

```php
// Laravel — uses SQLite in-memory by default, switch to real DB for specific tests
// phpunit.xml
// <env name="DB_CONNECTION" value="sqlite"/>
// <env name="DB_DATABASE" value=":memory:"/>

// For PostgreSQL-specific features, use real DB:
it('uses full-text search correctly', function () {
    // This test needs real PostgreSQL, not SQLite
    Product::factory()->create(['name' => 'Running Shoes', 'description' => 'Lightweight running shoes']);
    Product::factory()->create(['name' => 'Dress Shoes', 'description' => 'Formal leather shoes']);

    $results = Product::search('running')->get();

    expect($results)->toHaveCount(1);
    expect($results->first()->name)->toBe('Running Shoes');
})->group('postgres');
```

```go
// Go — testcontainers for real PostgreSQL
func NewPostgresDB(t *testing.T) *sql.DB {
    t.Helper()
    ctx := context.Background()

    container, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready").WithStartupTimeout(30*time.Second),
        ),
    )
    require.NoError(t, err)
    t.Cleanup(func() { container.Terminate(ctx) })

    connStr, err := container.ConnectionString(ctx, "sslmode=disable")
    require.NoError(t, err)

    db, err := sql.Open("postgres", connStr)
    require.NoError(t, err)
    t.Cleanup(func() { db.Close() })

    // Run migrations
    runMigrations(t, db)
    return db
}
```

```python
# Python — pytest fixtures with real DB
@pytest.fixture
def db_session():
    """Create a fresh database session for each test."""
    engine = create_engine("postgresql://test:test@localhost:5432/testdb")
    Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.rollback()
    session.close()
    Base.metadata.drop_all(engine)
```

---

## 6. HTTP: Testing Network Calls

### The Goal

Test against the **real HTTP shape** (headers, status codes, body format) but without hitting real external servers.

### PHP — Http::fake

```php
it('fetches weather data from external API', function () {
    Http::fake([
        'api.weather.com/current*' => Http::response([
            'temperature' => 22.5,
            'condition' => 'sunny',
            'location' => 'São Paulo',
        ], 200),
        'api.weather.com/*' => Http::response([], 404),
    ]);

    $weather = app(WeatherService::class)->getCurrent('São Paulo');

    expect($weather->temperature)->toBe(22.5);
    expect($weather->condition)->toBe('sunny');

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'api.weather.com/current')
            && $request['city'] === 'São Paulo';
    });
});

// Test error handling
it('handles weather API timeout gracefully', function () {
    Http::fake([
        'api.weather.com/*' => Http::response([], 504),
    ]);

    $weather = app(WeatherService::class)->getCurrent('São Paulo');

    expect($weather)->toBeNull();
    // Verify it doesn't throw, returns null/default
});
```

### TypeScript — MSW (Mock Service Worker)

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('https://api.weather.com/current', ({ request }) => {
    const url = new URL(request.url);
    const city = url.searchParams.get('city');

    return HttpResponse.json({
      temperature: 22.5,
      condition: 'sunny',
      location: city,
    });
  }),

  // Catch-all for unhandled requests
  http.all('*', ({ request }) => {
    console.error(`Unhandled request: ${request.method} ${request.url}`);
    return new HttpResponse(null, { status: 500 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('fetches weather data', async () => {
  const weather = await weatherService.getCurrent('São Paulo');

  expect(weather.temperature).toBe(22.5);
  expect(weather.condition).toBe('sunny');
});

// Override for specific test
test('handles API error', async () => {
  server.use(
    http.get('https://api.weather.com/current', () => {
      return new HttpResponse(null, { status: 503 });
    }),
  );

  const weather = await weatherService.getCurrent('São Paulo');
  expect(weather).toBeNull();
});
```

### Go — httptest

```go
func TestWeatherClient(t *testing.T) {
    // Create a fake HTTP server
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path != "/current" {
            w.WriteHeader(http.StatusNotFound)
            return
        }

        city := r.URL.Query().Get("city")
        json.NewEncoder(w).Encode(map[string]any{
            "temperature": 22.5,
            "condition":   "sunny",
            "location":    city,
        })
    }))
    defer server.Close()

    // Point client at fake server
    client := NewWeatherClient(server.URL)
    weather, err := client.GetCurrent(context.Background(), "São Paulo")

    require.NoError(t, err)
    assert.Equal(t, 22.5, weather.Temperature)
    assert.Equal(t, "sunny", weather.Condition)
}

// Test timeout
func TestWeatherClientTimeout(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(5 * time.Second) // Simulate slow response
    }))
    defer server.Close()

    client := NewWeatherClient(server.URL, WithTimeout(100*time.Millisecond))
    _, err := client.GetCurrent(context.Background(), "São Paulo")

    assert.Error(t, err)
    assert.Contains(t, err.Error(), "deadline exceeded")
}
```

---

## 7. Time: Controlling the Clock

### The Problem

Tests that depend on `time.Now()`, `Date.now()`, or `now()` are non-deterministic. They fail at midnight, on weekends, in different timezones.

### PHP — Carbon::setTestNow

```php
it('marks subscription as expired', function () {
    Carbon::setTestNow('2024-06-15 12:00:00');

    $subscription = Subscription::factory()->create([
        'expires_at' => Carbon::parse('2024-06-14'),
    ]);

    expect($subscription->isExpired())->toBeTrue();

    Carbon::setTestNow(); // Reset
});

it('calculates trial days remaining', function () {
    Carbon::setTestNow('2024-01-10');

    $user = User::factory()->create([
        'trial_ends_at' => Carbon::parse('2024-01-17'),
    ]);

    expect($user->trialDaysRemaining())->toBe(7);
});
```

### Go — Injected Clock

```go
// Define a clock interface
type Clock interface {
    Now() time.Time
}

type RealClock struct{}
func (RealClock) Now() time.Time { return time.Now() }

type FakeClock struct{ Time time.Time }
func (f FakeClock) Now() time.Time { return f.Time }

// Use it in your code
type SubscriptionService struct {
    DB    *sql.DB
    Clock Clock
}

func (s *SubscriptionService) IsExpired(sub *Subscription) bool {
    return s.Clock.Now().After(sub.ExpiresAt)
}

// Test with fake clock
func TestSubscriptionExpiry(t *testing.T) {
    clock := FakeClock{Time: time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)}
    svc := &SubscriptionService{DB: testDB, Clock: clock}

    sub := &Subscription{ExpiresAt: time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC)}

    assert.True(t, svc.IsExpired(sub))
}
```

### TypeScript — vi.useFakeTimers / sinon.useFakeTimers

```typescript
test('session expires after 30 minutes', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

  const session = createSession({ userId: 1 });
  expect(session.isValid()).toBe(true);

  // Advance 29 minutes — still valid
  vi.advanceTimersByTime(29 * 60 * 1000);
  expect(session.isValid()).toBe(true);

  // Advance 1 more minute — expired
  vi.advanceTimersByTime(1 * 60 * 1000);
  expect(session.isValid()).toBe(false);

  vi.useRealTimers();
});
```

### Python — freezegun

```python
from freezegun import freeze_time

@freeze_time("2024-06-15 12:00:00")
def test_subscription_expired():
    sub = Subscription(expires_at=datetime(2024, 6, 14))
    assert sub.is_expired() is True

@freeze_time("2024-01-10")
def test_trial_days_remaining():
    user = User(trial_ends_at=datetime(2024, 1, 17))
    assert user.trial_days_remaining() == 7
```

---

## 8. File System: Temp Dirs and Fakes

### Go — t.TempDir()

```go
func TestExportCSV(t *testing.T) {
    dir := t.TempDir() // Automatically cleaned up after test
    path := filepath.Join(dir, "export.csv")

    orders := []Order{
        {ID: 1, Total: 5000, CreatedAt: time.Now()},
        {ID: 2, Total: 3000, CreatedAt: time.Now()},
    }

    err := ExportOrdersCSV(path, orders)
    require.NoError(t, err)

    data, err := os.ReadFile(path)
    require.NoError(t, err)
    assert.Contains(t, string(data), "5000")
    assert.Contains(t, string(data), "3000")
}
```

### PHP — Storage::fake

```php
it('uploads profile avatar', function () {
    Storage::fake('avatars');

    $user = User::factory()->create();
    $file = UploadedFile::fake()->image('avatar.jpg', 200, 200);

    $response = $this->actingAs($user)
        ->postJson('/api/profile/avatar', ['avatar' => $file]);

    $response->assertOk();

    Storage::disk('avatars')->assertExists("users/{$user->id}/avatar.jpg");
});
```

### TypeScript — tmp directories

```typescript
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('exports data to CSV file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-'));
  const filePath = join(dir, 'export.csv');

  await exportCSV(filePath, [
    { id: 1, name: 'Alice', total: 5000 },
    { id: 2, name: 'Bob', total: 3000 },
  ]);

  const content = await readFile(filePath, 'utf-8');
  expect(content).toContain('Alice');
  expect(content).toContain('5000');
});
```

---

## 9. Email, Queue, Events: Framework Fakes

### PHP — Laravel Fakes

```php
// Email
it('sends welcome email on registration', function () {
    Mail::fake();

    $this->postJson('/api/register', [
        'name' => 'Alice',
        'email' => 'alice@example.com',
        'password' => 'password123',
    ]);

    Mail::assertSent(WelcomeEmail::class, function ($mail) {
        return $mail->hasTo('alice@example.com');
    });
    Mail::assertSent(WelcomeEmail::class, 1); // Exactly once
});

// Queue
it('dispatches order processing job', function () {
    Queue::fake();

    $order = Order::factory()->create();
    $this->postJson("/api/orders/{$order->id}/process");

    Queue::assertPushed(ProcessOrder::class, function ($job) use ($order) {
        return $job->orderId === $order->id;
    });
});

// Events
it('fires order placed event', function () {
    Event::fake([OrderPlaced::class]);

    $user = User::factory()->create();
    $this->actingAs($user)->postJson('/api/orders', [
        'product_id' => 1,
        'quantity' => 2,
    ]);

    Event::assertDispatched(OrderPlaced::class, function ($event) use ($user) {
        return $event->userId === $user->id;
    });
});

// Notifications
it('notifies admin of new order', function () {
    Notification::fake();

    $admin = User::factory()->admin()->create();
    $this->postJson('/api/orders', ['product_id' => 1, 'quantity' => 1]);

    Notification::assertSentTo($admin, NewOrderNotification::class);
});
```

### Go — Custom Fakes (no framework fakes, build your own)

```go
// Fake event bus
type FakeEventBus struct {
    mu     sync.Mutex
    Events []Event
}

func (f *FakeEventBus) Publish(e Event) {
    f.mu.Lock()
    defer f.mu.Unlock()
    f.Events = append(f.Events, e)
}

func (f *FakeEventBus) Published() []Event {
    f.mu.Lock()
    defer f.mu.Unlock()
    return slices.Clone(f.Events)
}

func TestOrderCreationPublishesEvent(t *testing.T) {
    db := testutil.NewTestDB(t)
    events := &FakeEventBus{}
    svc := NewOrderService(db, events)

    svc.Create(ctx, Order{UserID: 1, Total: 5000})

    published := events.Published()
    require.Len(t, published, 1)
    assert.Equal(t, "order.created", published[0].Type)
}
```

### Python — Django/FastAPI patterns

```python
# Django — override_settings for email backend
from django.core import mail

def test_sends_welcome_email(client):
    client.post("/api/register", json={
        "name": "Alice",
        "email": "alice@example.com",
        "password": "password123",
    })

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["alice@example.com"]
    assert "Welcome" in mail.outbox[0].subject
```

---

## 10. Third-Party APIs: Record-Replay and Contract Tests

### Strategy Overview

| Strategy | How It Works | Best For |
|---|---|---|
| **Record-Replay** | Record real API responses, replay in tests | APIs with stable responses |
| **Contract Tests** | Define expected shape, verify both sides | Service-to-service |
| **Mock Server** | Local server mimicking the real API | Complex API interactions |
| **HTTP Fakes** | Framework-level response faking | Simple request-response |

### Record-Replay Pattern

```python
# Using VCR.py for Python
import vcr

@vcr.use_cassette('fixtures/cassettes/stripe_create_customer.yaml')
def test_create_stripe_customer():
    # First run: hits real Stripe API, records response to YAML file
    # Subsequent runs: replays recorded response
    customer = stripe_service.create_customer(
        email="alice@example.com",
        name="Alice",
    )

    assert customer.id.startswith("cus_")
    assert customer.email == "alice@example.com"
```

### When to Re-Record

```
Re-record cassettes when:
- The external API releases a new version
- You change the request parameters
- Cassette is older than 6 months (stale risk)
- CI runs against real API weekly (scheduled, not per-commit)
```

### WRONG vs CORRECT: Third-Party Mocking

```typescript
// WRONG: Mocking at the wrong level
test('creates Stripe subscription', () => {
  // Mocking the Stripe SDK internals — brittle, doesn't test HTTP layer
  vi.mock('stripe', () => ({
    default: vi.fn().mockReturnValue({
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: 'sub_123', status: 'active' }),
      },
    }),
  }));

  const result = await billingService.subscribe(userId, planId);
  expect(result.subscriptionId).toBe('sub_123');
  // Problem: If Stripe SDK changes method signature, this test still passes
});

// CORRECT: Mocking at the HTTP level
const server = setupServer(
  http.post('https://api.stripe.com/v1/subscriptions', () => {
    return HttpResponse.json({
      id: 'sub_123',
      status: 'active',
      current_period_end: 1735689600,
    });
  }),
);

test('creates Stripe subscription', async () => {
  const result = await billingService.subscribe(userId, planId);

  expect(result.subscriptionId).toBe('sub_123');
  expect(result.status).toBe('active');
  // This test goes through the real Stripe SDK, catching SDK usage bugs
});
```

---

## 11. Over-Mocking Anti-Pattern

### Symptoms

```
- Tests pass, production fails
- Every test has 10+ lines of mock setup
- Refactoring breaks every test
- Tests verify mock interactions, not behavior
- Team can't tell if tests are meaningful
```

### WRONG: Over-Mocked Test

```typescript
// 15 lines of mocking for 3 lines of actual test
test('creates order', async () => {
  const mockUserRepo = { findById: vi.fn().mockResolvedValue({ id: 1 }) };
  const mockProductRepo = { findById: vi.fn().mockResolvedValue({ id: 2, price: 1000 }) };
  const mockOrderRepo = { save: vi.fn().mockResolvedValue({ id: 1 }) };
  const mockPricingService = { calculate: vi.fn().mockReturnValue(1000) };
  const mockInventoryService = { reserve: vi.fn().mockResolvedValue(true) };
  const mockEventBus = { publish: vi.fn() };
  const mockLogger = { info: vi.fn() };

  const service = new OrderService(
    mockUserRepo, mockProductRepo, mockOrderRepo,
    mockPricingService, mockInventoryService, mockEventBus, mockLogger,
  );

  await service.create({ userId: 1, productId: 2, quantity: 1 });

  expect(mockOrderRepo.save).toHaveBeenCalled();  // Tests nothing real
  expect(mockInventoryService.reserve).toHaveBeenCalledWith(2, 1);  // Tests wiring
  expect(mockEventBus.publish).toHaveBeenCalled();  // Tests wiring
});
```

### CORRECT: Integration with Real Dependencies

```typescript
test('creates order with correct total', async () => {
  const user = await createUser(db);
  const product = await createProduct(db, { price: 1000, stock: 5 });

  const response = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ productId: product.id, quantity: 2 });

  expect(response.status).toBe(201);
  expect(response.body.total).toBe(2000);

  // Verify real side effects
  const updatedProduct = await db.query('SELECT stock FROM products WHERE id = $1', [product.id]);
  expect(updatedProduct.rows[0].stock).toBe(3);
});
```

### The Rule of Thumb

If your mock setup is longer than your assertions, you're probably over-mocking. Step back and ask: "Could I write this as an integration test instead?"

---

## 12. Sociable vs Solitary Unit Tests

### Definitions

- **Solitary** — The unit under test is completely isolated. All collaborators are mocked/stubbed.
- **Sociable** — The unit under test uses real collaborators. Only external boundaries are mocked.

```
Solitary:  [Unit] → [Mock A] → [Mock B] → [Mock C]
Sociable:  [Unit] → [Real A] → [Real B] → [Mock External API]
```

### When to Use Each

| Approach | Best For | Drawback |
|---|---|---|
| **Solitary** | Testing complex logic in isolation (algorithms, state machines) | Doesn't catch integration bugs |
| **Sociable** | Testing behavior of collaborating objects | Slower, harder to pinpoint failures |

### Recommendation

Default to **sociable**. Only go solitary when:
- The collaborator is slow or non-deterministic
- The collaborator is external (network, filesystem)
- You need to test specific edge cases of one object

```python
# Sociable — uses real PricingEngine, real TaxCalculator
def test_order_total_with_tax():
    pricing = PricingEngine()
    tax = TaxCalculator(region="BR")
    order_service = OrderService(pricing=pricing, tax=tax)

    order = order_service.create(items=[
        {"sku": "A", "price": 10000, "qty": 2},
    ], region="BR")

    assert order.subtotal == 20000
    assert order.tax > 0  # Real tax calculation
    assert order.total == order.subtotal + order.tax

# Solitary — mocked PricingEngine (only if PricingEngine is very slow or external)
def test_order_applies_discount():
    pricing = Mock(spec=PricingEngine)
    pricing.calculate.return_value = 18000  # Pretend there's a discount
    order_service = OrderService(pricing=pricing)

    order = order_service.create(items=[...])

    assert order.subtotal == 18000
```

---

## 13. Snapshot Testing

### When Useful

- **API response structure** — Catch unintended changes to response shape
- **Serialization output** — JSON/XML/CSV format verification
- **Compiler/formatter output** — AST, generated code
- **Email templates** — HTML structure (not exact content)

### When Harmful

- **UI components** — Snapshots of HTML are fragile, change with every CSS tweak
- **Large objects** — Nobody reviews a 500-line snapshot diff
- **Dynamic data** — Timestamps, IDs, random values break snapshots constantly
- **As a crutch** — "I don't know what to assert, so I'll snapshot everything"

### WRONG vs CORRECT: Snapshot Usage

```typescript
// WRONG: Snapshot of entire React component output
test('renders product page', () => {
  const { container } = render(<ProductPage id="123" />);
  expect(container).toMatchSnapshot();
  // 200-line snapshot file that nobody reads
  // Breaks on every CSS change, every text change
});

// CORRECT: Snapshot of API response structure
test('GET /api/products/:id returns expected shape', async () => {
  const product = await createProduct(db, { name: 'Shoes', price: 9900 });
  const response = await request(app).get(`/api/products/${product.id}`);

  expect(response.body).toMatchInlineSnapshot(`
    {
      "id": Any<String>,
      "name": "Shoes",
      "price": 9900,
      "currency": "USD",
      "created_at": Any<String>,
    }
  `);
});

// CORRECT: Snapshot of serialization format
test('CSV export matches expected format', () => {
  const csv = exportCSV([
    { name: 'Alice', email: 'alice@example.com', role: 'admin' },
  ]);

  expect(csv).toMatchInlineSnapshot(`
    "name,email,role
    Alice,alice@example.com,admin"
  `);
});
```

### Snapshot Best Practices

```
DO:
- Use inline snapshots for small outputs (< 20 lines)
- Snapshot stable structures (API contracts, serialization formats)
- Review snapshot diffs in PRs (don't just update blindly)
- Use property matchers for dynamic values (expect.any(String))

DON'T:
- Snapshot entire React component trees
- Snapshot objects with timestamps, IDs, or random values
- Use snapshots as a replacement for specific assertions
- Auto-update snapshots without reviewing the diff
```
