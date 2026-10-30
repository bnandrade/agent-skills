# Testing

Patterns de teste em Laravel para producao. Pest, feature tests, faking, database testing, HTTP assertions, mocking.

---

## Table of Contents

1. [Pest vs PHPUnit](#1-pest-vs-phpunit)
2. [Feature Tests (HTTP Tests)](#2-feature-tests-http-tests)
3. [Database Testing](#3-database-testing)
4. [Faking](#4-faking)
5. [Testing APIs with Sanctum](#5-testing-apis-with-sanctum)
6. [Factory States & Relationships](#6-factory-states--relationships)
7. [Assertions](#7-assertions)
8. [Mocking with Mockery](#8-mocking-with-mockery)
9. [Test Organization & Naming](#9-test-organization--naming)
10. [Testing Jobs, Events & Listeners](#10-testing-jobs-events--listeners)
11. [Browser Testing with Dusk](#11-browser-testing-with-dusk)
12. [Testing AI SDK Agents](#12-testing-ai-sdk-agents)

---

## 1. Pest vs PHPUnit

### When to Use Which

| Criteria | Pest | PHPUnit |
|---|---|---|
| New Laravel project | Default choice | Still valid |
| Expressive syntax | Yes (`it`, `expect`) | Verbose (`$this->assert`) |
| Laravel first-party | Yes (since Laravel 11) | Yes |
| Existing PHPUnit suite | Migrate gradually | Keep using |
| Team familiarity | Lower learning curve | Industry standard |

### 1.1 Pest Syntax

```php
it('creates a user', function () {
    $response = $this->postJson('/api/users', [
        'name' => 'John',
        'email' => 'john@example.com',
        'password' => 'password123',
    ]);

    $response->assertCreated();

    $this->assertDatabaseHas('users', [
        'email' => 'john@example.com',
    ]);
});

// With description group
describe('UserController', function () {
    it('lists users', function () { /* ... */ });
    it('creates a user', function () { /* ... */ });
    it('updates a user', function () { /* ... */ });
    it('deletes a user', function () { /* ... */ });
});

// Expectations (Pest-style assertions)
expect($user->name)->toBe('John');
expect($user->email)->toContain('@');
expect($users)->toHaveCount(3);
expect($user->isAdmin())->toBeTrue();
expect($response->json('data'))->toMatchArray(['name' => 'John']);
```

### 1.2 PHPUnit Equivalent

```php
class UserControllerTest extends TestCase
{
    public function test_creates_a_user(): void
    {
        $response = $this->postJson('/api/users', [
            'name' => 'John',
            'email' => 'john@example.com',
            'password' => 'password123',
        ]);

        $response->assertCreated();

        $this->assertDatabaseHas('users', [
            'email' => 'john@example.com',
        ]);
    }
}
```

---

## 2. Feature Tests (HTTP Tests)

### 2.1 Basic HTTP Methods

```php
it('handles CRUD operations', function () {
    $user = User::factory()->create();

    // GET
    $this->getJson('/api/posts')->assertOk();

    // POST
    $this->actingAs($user)
        ->postJson('/api/posts', ['title' => 'Test', 'body' => 'Content here.', 'status' => 'draft'])
        ->assertCreated();

    // PUT
    $post = Post::factory()->for($user)->create();
    $this->actingAs($user)
        ->putJson("/api/posts/{$post->id}", ['title' => 'Updated'])
        ->assertOk();

    // DELETE
    $this->actingAs($user)
        ->deleteJson("/api/posts/{$post->id}")
        ->assertNoContent();
});
```

### 2.2 Testing Headers & Cookies

```php
it('requires accept json header', function () {
    $this->get('/api/posts', ['Accept' => 'application/json'])
        ->assertOk();
});

it('sets authentication cookie', function () {
    $this->postJson('/login', ['email' => 'user@test.com', 'password' => 'password'])
        ->assertOk()
        ->assertCookie('laravel_session');
});
```

### 2.3 Testing File Uploads

```php
it('uploads an avatar', function () {
    Storage::fake('public');

    $user = User::factory()->create();
    $file = UploadedFile::fake()->image('avatar.jpg', 200, 200);

    $this->actingAs($user)
        ->postJson('/api/profile/avatar', ['avatar' => $file])
        ->assertOk();

    Storage::disk('public')->assertExists("avatars/{$file->hashName()}");
});
```

### 2.4 Testing Redirects

```php
it('redirects guests to login', function () {
    $this->get('/dashboard')
        ->assertRedirect('/login');
});
```

---

## 3. Database Testing

### 3.1 RefreshDatabase vs DatabaseTransactions

```php
// RefreshDatabase — migrates + wraps in transaction (recommended)
uses(RefreshDatabase::class);

it('creates an order', function () {
    // DB is clean for each test
    $order = Order::factory()->create();
    $this->assertDatabaseCount('orders', 1);
});

// DatabaseTransactions — no migration, just rollback (faster if DB already migrated)
uses(DatabaseTransactions::class);
```

```php
// WRONG: tests depend on execution order
it('creates a user', function () {
    User::factory()->create(['email' => 'test@test.com']);
});

it('finds the user', function () {
    // Fails if 'creates a user' didn't run first
    $user = User::where('email', 'test@test.com')->first();
    expect($user)->not->toBeNull();
});

// CORRECT: each test sets up its own data
it('finds a user by email', function () {
    User::factory()->create(['email' => 'test@test.com']);

    $user = User::where('email', 'test@test.com')->first();
    expect($user)->not->toBeNull();
});
```

### 3.2 Database Assertions

```php
$this->assertDatabaseHas('users', [
    'email' => 'john@test.com',
    'role' => 'admin',
]);

$this->assertDatabaseMissing('users', [
    'email' => 'deleted@test.com',
]);

$this->assertDatabaseCount('users', 5);

$this->assertDatabaseEmpty('failed_jobs');

// Soft-deleted
$this->assertSoftDeleted('posts', ['id' => $post->id]);
$this->assertNotSoftDeleted('posts', ['id' => $activePost->id]);

// Model assertions
$this->assertModelExists($user);
$this->assertModelMissing($deletedUser);
```

---

## 4. Faking

### 4.1 Mail::fake

```php
it('sends welcome email on registration', function () {
    Mail::fake();

    $this->postJson('/api/register', [
        'name' => 'John',
        'email' => 'john@test.com',
        'password' => 'password123',
        'password_confirmation' => 'password123',
    ]);

    Mail::assertSent(WelcomeMail::class, function (WelcomeMail $mail) {
        return $mail->hasTo('john@test.com');
    });

    Mail::assertSent(WelcomeMail::class, 1);
    Mail::assertNotSent(AdminAlertMail::class);
});
```

### 4.2 Queue::fake

```php
it('dispatches podcast processing job', function () {
    Queue::fake();

    $podcast = Podcast::factory()->create();

    $this->postJson("/api/podcasts/{$podcast->id}/process");

    Queue::assertPushed(ProcessPodcast::class, function ($job) use ($podcast) {
        return $job->podcast->id === $podcast->id;
    });

    Queue::assertPushedOn('audio', ProcessPodcast::class);
    Queue::assertNotPushed(SendNewsletter::class);
});

// Fake specific jobs only (others execute normally)
Queue::fake([ProcessPodcast::class]);
```

### 4.3 Notification::fake

```php
it('notifies user when order ships', function () {
    Notification::fake();

    $user = User::factory()->create();
    $order = Order::factory()->for($user)->create();

    $order->markAsShipped();

    Notification::assertSentTo($user, OrderShippedNotification::class);

    // Or with conditions
    Notification::assertSentTo($user, OrderShippedNotification::class, function ($notification) use ($order) {
        return $notification->order->id === $order->id;
    });

    Notification::assertCount(1);
});
```

### 4.4 Storage::fake

```php
it('stores uploaded document', function () {
    Storage::fake('s3');

    $file = UploadedFile::fake()->create('document.pdf', 1024);

    $this->postJson('/api/documents', ['file' => $file])
        ->assertCreated();

    Storage::disk('s3')->assertExists("documents/{$file->hashName()}");
    Storage::disk('s3')->assertMissing('documents/other.pdf');
});
```

### 4.5 Event::fake

```php
it('dispatches order placed event', function () {
    Event::fake();

    $order = Order::factory()->create();

    $this->postJson("/api/orders/{$order->id}/place");

    Event::assertDispatched(OrderPlaced::class, function ($event) use ($order) {
        return $event->order->id === $order->id;
    });

    Event::assertNotDispatched(OrderCancelled::class);
});

// Fake specific events only
Event::fake([OrderPlaced::class]);
// Other events dispatch normally (useful for model events)
```

### 4.6 Http::fake (External API Calls)

```php
it('fetches exchange rates from external API', function () {
    Http::fake([
        'api.exchangerate.com/*' => Http::response([
            'rates' => ['BRL' => 5.25, 'EUR' => 0.92],
        ], 200),
        '*' => Http::response('Not Found', 404),
    ]);

    $rates = app(ExchangeRateService::class)->getRates('USD');

    expect($rates)->toMatchArray(['BRL' => 5.25, 'EUR' => 0.92]);

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'api.exchangerate.com')
            && $request->method() === 'GET';
    });

    Http::assertSentCount(1);
});

// Sequence of responses
Http::fake([
    'api.example.com/token' => Http::sequence()
        ->push(['token' => 'abc'], 200)
        ->push(['error' => 'expired'], 401),
]);
```

---

## 5. Testing APIs with Sanctum

```php
use Laravel\Sanctum\Sanctum;

it('returns authenticated user profile', function () {
    $user = User::factory()->create(['name' => 'John']);

    Sanctum::actingAs($user);

    $this->getJson('/api/profile')
        ->assertOk()
        ->assertJsonPath('data.name', 'John');
});

it('returns 401 for unauthenticated requests', function () {
    $this->getJson('/api/profile')
        ->assertUnauthorized();
});

// With token abilities
it('allows read with read token', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user, ['posts:read']);

    $this->getJson('/api/posts')->assertOk();
});

it('denies write with read-only token', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user, ['posts:read']);

    $this->postJson('/api/posts', ['title' => 'Test', 'body' => 'Content.'])
        ->assertForbidden();
});
```

---

## 6. Factory States & Relationships

### 6.1 States in Tests

```php
it('shows only published posts', function () {
    Post::factory()->count(3)->published()->create();
    Post::factory()->count(2)->draft()->create();

    $response = $this->getJson('/api/posts');

    $response->assertOk()
        ->assertJsonCount(3, 'data');
});

// Complex state combination
it('filters premium active users', function () {
    User::factory()->count(2)->premium()->active()->create();
    User::factory()->count(3)->free()->active()->create();
    User::factory()->count(1)->premium()->suspended()->create();

    $response = $this->getJson('/api/users?plan=premium&status=active');

    $response->assertJsonCount(2, 'data');
});
```

### 6.2 Relationships in Tests

```php
it('returns user with posts count', function () {
    $user = User::factory()
        ->has(Post::factory()->count(5)->published())
        ->create();

    Sanctum::actingAs($user);

    $this->getJson("/api/users/{$user->id}")
        ->assertOk()
        ->assertJsonPath('data.posts_count', 5);
});

it('creates order with items', function () {
    $user = User::factory()->create();
    $products = Product::factory()->count(3)->create();

    Sanctum::actingAs($user);

    $this->postJson('/api/orders', [
        'items' => $products->map(fn ($p) => [
            'product_id' => $p->id,
            'quantity' => 2,
        ])->all(),
    ])->assertCreated();

    $this->assertDatabaseCount('order_items', 3);
});
```

---

## 7. Assertions

### 7.1 HTTP Status Assertions

```php
$response->assertOk();                  // 200
$response->assertCreated();             // 201
$response->assertAccepted();            // 202
$response->assertNoContent();           // 204
$response->assertMovedPermanently();    // 301
$response->assertFound();               // 302
$response->assertBadRequest();          // 400
$response->assertUnauthorized();        // 401
$response->assertForbidden();           // 403
$response->assertNotFound();            // 404
$response->assertUnprocessable();       // 422
$response->assertTooManyRequests();     // 429
$response->assertServerError();         // 500
$response->assertStatus(418);           // custom
```

### 7.2 JSON Assertions

```php
// Exact path match
$response->assertJsonPath('data.name', 'John');
$response->assertJsonPath('data.id', $user->id);

// Structure validation
$response->assertJsonStructure([
    'data' => [
        'id',
        'name',
        'email',
        'posts' => [['id', 'title']],
    ],
    'meta' => ['current_page', 'total'],
]);

// Count items
$response->assertJsonCount(3, 'data');

// Exact match (subset)
$response->assertJson([
    'data' => [
        'name' => 'John',
        'email' => 'john@test.com',
    ],
]);

// Missing key
$response->assertJsonMissingPath('data.password');
$response->assertJsonMissing(['secret' => 'value']);

// Fragment anywhere in response
$response->assertJsonFragment(['name' => 'John']);
```

### 7.3 Validation Error Assertions

```php
$response->assertJsonValidationErrors(['title', 'email']);
$response->assertJsonMissingValidationErrors(['name']);

// Specific validation message
$response->assertJsonValidationErrorFor('email');

// With Pest expectations
$response->assertUnprocessable();
expect($response->json('errors.email.0'))->toContain('required');
```

### 7.4 Pest Expectations Cheat Sheet

```php
expect($value)->toBe('exact');              // ===
expect($value)->toEqual('loose');           // ==
expect($value)->toBeTrue();
expect($value)->toBeFalse();
expect($value)->toBeNull();
expect($value)->not->toBeNull();
expect($value)->toBeEmpty();
expect($value)->toContain('substring');
expect($value)->toStartWith('prefix');
expect($value)->toMatchArray(['key' => 'val']);
expect($value)->toHaveCount(3);
expect($value)->toHaveKey('name');
expect($value)->toBeInstanceOf(User::class);
expect($value)->toBeGreaterThan(0);
expect($value)->toBeBetween(1, 100);
expect(fn () => riskyCall())->toThrow(CustomException::class);
```

---

## 8. Mocking with Mockery

### 8.1 When to Mock

```php
// WRONG: mocking Eloquent models (test implementation, not behavior)
$mock = Mockery::mock(User::class);
$mock->shouldReceive('save')->once();

// CORRECT: use factories and test against the database
$user = User::factory()->create();
$this->assertDatabaseHas('users', ['id' => $user->id]);

// Mock external services, NOT Laravel internals
```

### 8.2 Mocking External Services

```php
it('processes payment via gateway', function () {
    $gateway = Mockery::mock(PaymentGateway::class);
    $gateway->shouldReceive('charge')
        ->once()
        ->with(1000, 'BRL', Mockery::type('string'))
        ->andReturn(new PaymentResult(
            success: true,
            transactionId: 'txn_123',
        ));

    $this->app->instance(PaymentGateway::class, $gateway);

    $order = Order::factory()->create(['total' => 1000]);

    $this->postJson("/api/orders/{$order->id}/pay")
        ->assertOk()
        ->assertJsonPath('data.payment_status', 'paid');
});
```

### 8.3 Partial Mocks & Spies

```php
// Spy — verify after the fact (no expectations upfront)
it('logs analytics event', function () {
    $spy = Mockery::spy(AnalyticsService::class);
    $this->app->instance(AnalyticsService::class, $spy);

    $this->postJson('/api/events', ['name' => 'page_view']);

    $spy->shouldHaveReceived('track')
        ->once()
        ->with('page_view', Mockery::type('array'));
});
```

---

## 9. Test Organization & Naming

### 9.1 Directory Structure

```
tests/
  Feature/
    Http/
      Controllers/
        PostControllerTest.php
        UserControllerTest.php
    Services/
      OrderServiceTest.php
  Unit/
    Models/
      UserTest.php
    ValueObjects/
      MoneyTest.php
  Pest.php           # Pest config (uses, shared datasets)
```

### 9.2 Pest.php Configuration

```php
// tests/Pest.php
uses(Tests\TestCase::class, RefreshDatabase::class)
    ->in('Feature');

uses(Tests\TestCase::class)
    ->in('Unit');
```

### 9.3 Naming Conventions

```php
// WRONG: vague test names
it('works', function () { /* ... */ });
it('test1', function () { /* ... */ });
test('post', function () { /* ... */ });

// CORRECT: behavior-driven names
it('creates a post with valid data', function () { /* ... */ });
it('returns 422 when title is missing', function () { /* ... */ });
it('prevents non-owners from editing posts', function () { /* ... */ });
it('dispatches notification when order is shipped', function () { /* ... */ });
```

### 9.4 Shared Datasets

```php
// In Pest.php or test file
dataset('invalid_emails', [
    'empty string' => [''],
    'no at sign' => ['invalidemail'],
    'no domain' => ['user@'],
    'spaces' => ['user @test.com'],
]);

it('rejects invalid emails', function (string $email) {
    $this->postJson('/api/users', [
        'name' => 'Test',
        'email' => $email,
        'password' => 'password123',
    ])->assertJsonValidationErrors(['email']);
})->with('invalid_emails');
```

### 9.5 beforeEach & Shared Setup

```php
describe('OrderController', function () {
    beforeEach(function () {
        $this->user = User::factory()->create();
        $this->product = Product::factory()->create(['price' => 1000]);
        Sanctum::actingAs($this->user);
    });

    it('creates an order', function () {
        $this->postJson('/api/orders', [
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();
    });

    it('calculates total correctly', function () {
        $this->postJson('/api/orders', [
            'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
        ])->assertJsonPath('data.total', '30.00');
    });
});
```

---

## 10. Testing Jobs, Events & Listeners

### 10.1 Testing a Job Directly

```php
it('processes podcast audio', function () {
    Storage::fake('local');
    Storage::disk('local')->put('podcasts/ep1.mp3', 'fake audio data');

    $podcast = Podcast::factory()->create([
        'audio_path' => 'podcasts/ep1.mp3',
        'status' => PodcastStatus::Pending,
    ]);

    (new ProcessPodcast($podcast))->handle(app(AudioProcessor::class));

    $podcast->refresh();
    expect($podcast->status)->toBe(PodcastStatus::Processed);
});
```

### 10.2 Testing Event Dispatch

```php
it('dispatches OrderPlaced when order is confirmed', function () {
    Event::fake([OrderPlaced::class]);

    $order = Order::factory()->create();

    app(OrderService::class)->confirm($order);

    Event::assertDispatched(OrderPlaced::class, function ($event) use ($order) {
        return $event->order->id === $order->id;
    });
});
```

### 10.3 Testing a Listener

```php
it('sends confirmation email on OrderPlaced', function () {
    Mail::fake();

    $order = Order::factory()->create();
    $event = new OrderPlaced($order);

    app(SendOrderConfirmation::class)->handle($event);

    Mail::assertSent(OrderConfirmationMail::class, function ($mail) use ($order) {
        return $mail->hasTo($order->user->email);
    });
});
```

### 10.4 Testing Job Batches

```php
it('dispatches import batch', function () {
    Bus::fake();

    $this->postJson('/api/imports', ['file' => 'data.csv']);

    Bus::assertBatched(function ($batch) {
        return $batch->jobs->count() > 0
            && $batch->jobs->first() instanceof ImportCsvChunk;
    });
});
```

---

## 11. Browser Testing with Dusk

For end-to-end browser tests (JavaScript-dependent flows):

```php
// php artisan dusk:install

class LoginTest extends DuskTestCase
{
    public function test_user_can_login(): void
    {
        $user = User::factory()->create();

        $this->browse(function (Browser $browser) use ($user) {
            $browser->visit('/login')
                ->type('email', $user->email)
                ->type('password', 'password')
                ->press('Log in')
                ->assertPathIs('/dashboard')
                ->assertSee("Welcome, {$user->name}");
        });
    }
}
```

```bash
php artisan dusk                # run all Dusk tests
php artisan dusk --filter=login # run specific test
```

**Use Dusk sparingly** — feature tests (HTTP tests) cover most cases faster and without a browser.

---

## 12. Testing AI SDK Agents

Laravel 13 provides `Ai::fake()` for testing AI SDK integrations:

```php
use Illuminate\Support\Facades\Ai;

it('generates product description with AI', function () {
    Ai::fake([
        'A premium leather wallet crafted from Italian calfskin.',
    ]);

    $product = Product::factory()->create(['name' => 'Leather Wallet']);

    $description = app(ProductDescriptionService::class)->generate($product);

    expect($description)->toContain('leather wallet');

    Ai::assertSent(function ($request) {
        return str_contains($request->prompt(), 'Leather Wallet');
    });
});

it('handles AI agent with tools', function () {
    Ai::fake([
        // First response: agent calls a tool
        Ai::toolCall('search_products', ['query' => 'wallet']),
        // Second response: agent returns final answer
        'I found 3 wallets matching your search.',
    ]);

    $response = app(ShoppingAssistant::class)->ask('Find me a wallet');

    expect($response)->toContain('3 wallets');

    Ai::assertSentCount(2);
});

it('tests structured output', function () {
    Ai::fake([
        Ai::structured([
            'sentiment' => 'positive',
            'confidence' => 0.95,
            'topics' => ['product', 'quality'],
        ]),
    ]);

    $analysis = app(SentimentAnalyzer::class)->analyze('Great product!');

    expect($analysis->sentiment)->toBe('positive');
    expect($analysis->confidence)->toBeGreaterThan(0.9);
});
```

### Running Tests

```bash
# Run all tests
php artisan test

# Run with Pest
php artisan test --pest

# Specific file
php artisan test tests/Feature/Http/Controllers/PostControllerTest.php

# Filter by name
php artisan test --filter="creates a post"

# Parallel (faster)
php artisan test --parallel

# Coverage
php artisan test --coverage --min=80

# Stop on first failure
php artisan test --stop-on-failure
```
