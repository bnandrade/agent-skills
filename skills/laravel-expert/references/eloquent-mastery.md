# Eloquent Mastery

Patterns avancados de Eloquent para producao. Relationships, scopes, casts, factories, observers, performance.

---

## Table of Contents

1. [Relationships](#1-relationships)
2. [Query Scopes](#2-query-scopes)
3. [Attribute Casting](#3-attribute-casting)
4. [Accessors & Mutators](#4-accessors--mutators)
5. [Factories & Seeders](#5-factories--seeders)
6. [Observers vs Events](#6-observers-vs-events)
7. [Model Events Lifecycle](#7-model-events-lifecycle)
8. [Eager Loading Strategies](#8-eager-loading-strategies)
9. [Subqueries & Advanced Query Builder](#9-subqueries--advanced-query-builder)
10. [Soft Deleting Patterns](#10-soft-deleting-patterns)
11. [UUIDv7 / ULID Usage](#11-uuidv7--ulid-usage)
12. [Pruning Models](#12-pruning-models)
13. [Performance Tips](#13-performance-tips)

---

## 1. Relationships

### 1.1 Core Relationships

```php
class User extends Model
{
    // One-to-One
    public function profile(): HasOne
    {
        return $this->hasOne(Profile::class);
    }

    // One-to-Many
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }

    // Many-to-Many (pivot table: role_user)
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class)
            ->withTimestamps()
            ->withPivot('assigned_by');
    }
}

class Post extends Model
{
    // Inverse One-to-Many
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

### 1.2 Polymorphic Relationships

```php
// A Comment can belong to a Post or a Video
class Comment extends Model
{
    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }
}

class Post extends Model
{
    public function comments(): MorphMany
    {
        return $this->morphMany(Comment::class, 'commentable');
    }
}

// Migration for comments table
Schema::create('comments', function (Blueprint $table) {
    $table->id();
    $table->morphs('commentable'); // commentable_type + commentable_id
    $table->text('body');
    $table->timestamps();
});
```

### 1.3 Has-Through Relationships

```php
class Country extends Model
{
    // Country -> Users -> Posts
    public function posts(): HasManyThrough
    {
        return $this->hasManyThrough(Post::class, User::class);
    }

    // Country -> Users -> Profile (single)
    public function latestProfile(): HasOneThrough
    {
        return $this->hasOneThrough(Profile::class, User::class)
            ->latestOfMany();
    }
}
```

### 1.4 Relationship Constraints

```php
// Default ordering on relationship
public function comments(): HasMany
{
    return $this->hasMany(Comment::class)->latest();
}

// Relationship with conditions
public function activeSubscriptions(): HasMany
{
    return $this->hasMany(Subscription::class)
        ->where('status', 'active')
        ->where('expires_at', '>', now());
}

// One of Many — latest/oldest/min/max
public function latestOrder(): HasOne
{
    return $this->hasOne(Order::class)->latestOfMany();
}

public function largestOrder(): HasOne
{
    return $this->hasOne(Order::class)->ofMany('total', 'max');
}
```

---

## 2. Query Scopes

### 2.1 Local Scopes

```php
class Post extends Model
{
    public function scopePublished(Builder $query): void
    {
        $query->whereNotNull('published_at')
              ->where('published_at', '<=', now());
    }

    public function scopeByAuthor(Builder $query, User $user): void
    {
        $query->where('user_id', $user->id);
    }

    public function scopePopular(Builder $query, int $minViews = 1000): void
    {
        $query->where('views', '>=', $minViews);
    }
}

// Usage — composable
$posts = Post::published()->popular(500)->byAuthor($user)->get();
```

### 2.2 Global Scopes

```php
// As a class
class ActiveScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $builder->where('is_active', true);
    }
}

// Register in model
class Tenant extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope);

        // Or inline
        static::addGlobalScope('tenant', function (Builder $builder) {
            $builder->where('tenant_id', auth()->user()?->tenant_id);
        });
    }
}

// Remove global scope when needed
Tenant::withoutGlobalScope(ActiveScope::class)->get();
Tenant::withoutGlobalScopes()->get(); // remove all
```

---

## 3. Attribute Casting

### 3.1 Built-in Casts

```php
class Order extends Model
{
    protected function casts(): array
    {
        return [
            'total' => 'decimal:2',
            'metadata' => 'array',
            'options' => AsCollection::class,
            'address' => AsEnumCollection::class . ':' . AddressType::class,
            'is_priority' => 'boolean',
            'shipped_at' => 'datetime',
            'tags' => AsStringable::class,
            'status' => OrderStatus::class,         // backed enum
            'settings' => AsEncryptedArrayObject::class,
        ];
    }
}
```

### 3.2 Enum Casting

```php
enum OrderStatus: string
{
    case Pending = 'pending';
    case Processing = 'processing';
    case Shipped = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Aguardando',
            self::Processing => 'Processando',
            self::Shipped => 'Enviado',
            self::Delivered => 'Entregue',
            self::Cancelled => 'Cancelado',
        };
    }

    public function canTransitionTo(self $new): bool
    {
        return match ($this) {
            self::Pending => in_array($new, [self::Processing, self::Cancelled]),
            self::Processing => in_array($new, [self::Shipped, self::Cancelled]),
            self::Shipped => $new === self::Delivered,
            default => false,
        };
    }
}

// Usage
$order->status = OrderStatus::Shipped;
$order->save(); // stores 'shipped' in DB

$order->status->label(); // 'Enviado'

// Query with enums
Order::where('status', OrderStatus::Pending)->get();
```

### 3.3 Custom Cast

```php
class MoneyCast implements CastsAttributes
{
    public function __construct(
        private readonly string $currency = 'BRL',
    ) {}

    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        return new Money(
            amount: (int) $value,
            currency: $this->currency,
        );
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): int
    {
        if ($value instanceof Money) {
            return $value->amount;
        }

        return (int) $value;
    }
}

// Usage in model
protected function casts(): array
{
    return [
        'price' => MoneyCast::class . ':BRL',
    ];
}
```

---

## 4. Accessors & Mutators

Modern approach using `Attribute` (Laravel 9+):

```php
use Illuminate\Database\Eloquent\Casts\Attribute;

class User extends Model
{
    // Accessor
    protected function fullName(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value, array $attributes) =>
                "{$attributes['first_name']} {$attributes['last_name']}",
        );
    }

    // Mutator
    protected function email(): Attribute
    {
        return Attribute::make(
            get: fn (string $value) => $value,
            set: fn (string $value) => strtolower($value),
        );
    }

    // Cached accessor (computed once per instance)
    protected function rank(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->calculateRank(),
        )->shouldCache();
    }
}
```

```php
// WRONG: old-style accessors (still work but not idiomatic)
public function getFullNameAttribute(): string
{
    return $this->first_name . ' ' . $this->last_name;
}

// CORRECT: modern Attribute approach
protected function fullName(): Attribute
{
    return Attribute::make(
        get: fn (mixed $value, array $attributes) =>
            "{$attributes['first_name']} {$attributes['last_name']}",
    );
}
```

---

## 5. Factories & Seeders

### 5.1 Factory Definition

```php
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => Hash::make('password'),
            'role' => RoleEnum::User,
        ];
    }

    // States
    public function admin(): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => RoleEnum::Admin,
        ]);
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    // After creating hook
    public function configure(): static
    {
        return $this->afterCreating(function (User $user) {
            $user->profile()->create(
                Profile::factory()->make()->toArray()
            );
        });
    }
}
```

### 5.2 Factory Usage Patterns

```php
// Basic
$user = User::factory()->create();

// With state
$admin = User::factory()->admin()->create();

// With relationship
$user = User::factory()
    ->has(Post::factory()->count(3)->published())
    ->has(Order::factory()->count(2))
    ->create();

// Magic relationship methods
$user = User::factory()
    ->hasPosts(3, ['status' => 'published'])
    ->create();

// Belong-to (attach parent)
$posts = Post::factory()
    ->count(5)
    ->for(User::factory()->admin())
    ->create();

// Sequence
$users = User::factory()
    ->count(3)
    ->sequence(
        ['role' => RoleEnum::Admin],
        ['role' => RoleEnum::Editor],
        ['role' => RoleEnum::User],
    )
    ->create();
```

### 5.3 Seeder Best Practices

```php
// WRONG: seeder that breaks on re-run
class UserSeeder extends Seeder
{
    public function run(): void
    {
        User::factory()->count(50)->create(); // duplicates every run
    }
}

// CORRECT: idempotent seeder
class UserSeeder extends Seeder
{
    public function run(): void
    {
        // Fixed admin user
        User::firstOrCreate(
            ['email' => 'admin@app.com'],
            [
                'name' => 'Admin',
                'password' => Hash::make('password'),
                'role' => RoleEnum::Admin,
            ],
        );

        // Random users only if empty
        if (User::count() <= 1) {
            User::factory()->count(50)->create();
        }
    }
}
```

---

## 6. Observers vs Events

### When to Use Which

| Use Case | Observers | Events + Listeners |
|---|---|---|
| Single model lifecycle hook | Yes | Overkill |
| Cross-model side effects | No | Yes |
| Async processing needed | No (sync only) | Yes (queued listeners) |
| Multiple listeners per action | Awkward | Yes |
| Domain events (OrderPlaced, UserRegistered) | No | Yes |
| Simple cache clearing on save | Yes | Overkill |

### 6.1 Observer

```php
// php artisan make:observer UserObserver --model=User

class UserObserver
{
    public function created(User $user): void
    {
        Cache::forget("users.count");
    }

    public function updated(User $user): void
    {
        Cache::forget("user.{$user->id}");
    }

    public function deleting(User $user): void
    {
        // Cascade manual cleanup
        $user->posts()->delete();
    }
}

// Register in AppServiceProvider or via attribute
// In AppServiceProvider::boot()
User::observe(UserObserver::class);
```

### 6.2 Events + Listeners

```php
// Event
class OrderPlaced
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly Order $order,
    ) {}
}

// Listener (queued)
class SendOrderConfirmation implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        Mail::to($event->order->user)->send(
            new OrderConfirmationMail($event->order)
        );
    }
}

// Dispatch
OrderPlaced::dispatch($order);
```

---

## 7. Model Events Lifecycle

Order of events during model operations:

```
Creating: retrieved → creating → created
Updating: retrieved → updating → updated → saving → saved
Deleting: retrieved → deleting → deleted
Restoring (soft): retrieved → restoring → restored

saving/saved fire on BOTH create and update.
```

```php
// Use in boot() for inline hooks
class Order extends Model
{
    protected static function booted(): void
    {
        static::creating(function (Order $order) {
            $order->reference = Str::ulid()->toBase32();
        });

        static::saving(function (Order $order) {
            $order->total = $order->items->sum('subtotal');
        });
    }
}
```

---

## 8. Eager Loading Strategies

### 8.1 with() — At Query Time

```php
// Load specific relationships
$posts = Post::with(['user', 'comments.user'])->get();

// Constrained eager loading
$users = User::with([
    'posts' => fn (HasMany $query) => $query
        ->published()
        ->select('id', 'user_id', 'title', 'published_at')
        ->latest()
        ->limit(5),
])->get();
```

### 8.2 load() — After Query (Lazy Eager Loading)

```php
$users = User::all();

// Conditionally eager load
if ($includeOrders) {
    $users->load('orders');
}
```

### 8.3 loadMissing() — Only If Not Loaded

```php
// Won't re-query if already loaded
$user->loadMissing(['posts', 'profile']);
```

### 8.4 withCount / withSum / withAvg

```php
$users = User::withCount('posts')
    ->withSum('orders', 'total')
    ->withAvg('reviews', 'rating')
    ->having('posts_count', '>', 5)
    ->get();

// Access: $user->posts_count, $user->orders_sum_total, $user->reviews_avg_rating
```

### 8.5 Preventing N+1 — Strict Mode

```php
// In AppServiceProvider::boot()
Model::preventLazyLoading(! app()->isProduction());

// Now lazy loading throws an exception in dev/testing
// Forces you to eager load correctly
```

---

## 9. Subqueries & Advanced Query Builder

### 9.1 Subquery Selects

```php
$users = User::query()
    ->select('users.*')
    ->addSelect([
        'last_login_at' => Login::select('created_at')
            ->whereColumn('user_id', 'users.id')
            ->latest()
            ->limit(1),
    ])
    ->get();
```

### 9.2 Subquery OrderBy

```php
$users = User::orderByDesc(
    Order::select('created_at')
        ->whereColumn('user_id', 'users.id')
        ->latest()
        ->limit(1)
)->get();
```

### 9.3 Conditional Queries (when)

```php
$posts = Post::query()
    ->when($request->status, fn ($q, $status) => $q->where('status', $status))
    ->when($request->search, fn ($q, $search) => $q->where('title', 'like', "%{$search}%"))
    ->when($request->sort === 'popular', fn ($q) => $q->orderByDesc('views'))
    ->when($request->sort !== 'popular', fn ($q) => $q->latest())
    ->paginate();
```

### 9.4 Raw Expressions

```php
$users = User::select([
    'users.*',
    DB::raw('(SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) as posts_count'),
    DB::raw("CONCAT(first_name, ' ', last_name) as full_name"),
])->get();

// Safer with selectRaw
$orders = Order::selectRaw('DATE(created_at) as date, SUM(total) as revenue')
    ->groupByRaw('DATE(created_at)')
    ->havingRaw('SUM(total) > ?', [1000])
    ->get();
```

---

## 10. Soft Deleting Patterns

```php
use Illuminate\Database\Eloquent\SoftDeletes;

class Post extends Model
{
    use SoftDeletes;
}

// Migration
$table->softDeletes(); // adds deleted_at column

// Queries automatically exclude soft-deleted
Post::all();                       // only non-deleted
Post::withTrashed()->get();        // include deleted
Post::onlyTrashed()->get();        // only deleted

// Operations
$post->delete();                   // soft delete
$post->forceDelete();              // permanent
$post->restore();                  // undo soft delete
$post->trashed();                  // bool: is soft-deleted?

// Cascade soft deletes (manual, in observer or model event)
static::deleting(function (Post $post) {
    $post->comments()->delete();
});

static::restoring(function (Post $post) {
    $post->comments()->restore();
});
```

---

## 11. UUIDv7 / ULID Usage

### 11.1 UUIDv7 (Recommended for Laravel 13)

```php
use Illuminate\Database\Eloquent\Concerns\HasUuids;

class Order extends Model
{
    use HasUuids; // Laravel 13 defaults to UUIDv7 (sortable)

    // Optional: specify which columns use UUIDs
    public function uniqueIds(): array
    {
        return ['id', 'public_id'];
    }
}

// Migration
Schema::create('orders', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->uuid('public_id')->unique();
    // ...
});
```

### 11.2 ULID Alternative

```php
use Illuminate\Database\Eloquent\Concerns\HasUlids;

class Event extends Model
{
    use HasUlids; // 26-char, base32, sortable

    // Generates: 01HQJY3V8Z2QK9T6XR5J4N8M7P
}

// Migration
$table->ulid('id')->primary();
```

**When to use which:**
- **UUIDv7** — default choice, widely supported, sortable by time
- **ULID** — shorter (26 chars vs 36), URL-friendly, also sortable
- **Auto-increment** — internal tables where sequential IDs are fine and you want simplicity

---

## 12. Pruning Models

Automatic cleanup of old records:

```php
use Illuminate\Database\Eloquent\Prunable;
// or MassPrunable for bulk deletes without model events

class AuditLog extends Model
{
    use Prunable;

    public function prunable(): Builder
    {
        // Delete logs older than 90 days
        return static::where('created_at', '<', now()->subDays(90));
    }

    // Optional: cleanup before pruning (e.g., delete files)
    protected function pruning(): void
    {
        Storage::delete($this->file_path);
    }
}

// MassPrunable — faster, no model events, no pruning() hook
class TempUpload extends Model
{
    use MassPrunable;

    public function prunable(): Builder
    {
        return static::where('created_at', '<', now()->subDay());
    }
}
```

```bash
# Schedule in routes/console.php
Schedule::command('model:prune')->daily();

# Or with specific models
Schedule::command('model:prune', ['--model' => [AuditLog::class, TempUpload::class]])->daily();
```

---

## 13. Performance Tips

### 13.1 Select Specific Columns

```php
// WRONG: selects all columns including large text/blob
$users = User::all();

// CORRECT: select only what you need
$users = User::select('id', 'name', 'email')->get();

// With relationships
$users = User::select('id', 'name')
    ->with('posts:id,user_id,title')
    ->get();
```

### 13.2 chunk() vs cursor() vs lazy()

```php
// chunk() — batched queries, moderate memory
// Use for: write operations (update/delete in batches)
User::where('inactive', true)->chunk(200, function ($users) {
    foreach ($users as $user) {
        $user->delete();
    }
});

// cursor() — single query, yields one model at a time
// Use for: read-only iteration, lowest memory
foreach (User::cursor() as $user) {
    // process one at a time
}

// lazy() — like cursor but returns LazyCollection
// Use for: chaining collection methods lazily
User::lazy()->filter(fn ($u) => $u->isActive())->each(fn ($u) => process($u));

// chunkById() — safer for mutations (avoids offset drift)
User::where('needs_sync', true)->chunkById(200, function ($users) {
    foreach ($users as $user) {
        $user->update(['synced_at' => now(), 'needs_sync' => false]);
    }
});
```

### 13.3 Avoid N+1 in Collections

```php
// WRONG: triggers N+1 inside map
$posts = Post::all();
$data = $posts->map(fn ($post) => [
    'title' => $post->title,
    'author' => $post->user->name, // lazy load per post
]);

// CORRECT: eager load first
$posts = Post::with('user')->get();
$data = $posts->map(fn ($post) => [
    'title' => $post->title,
    'author' => $post->user->name, // already loaded
]);
```

### 13.4 Query Caching

```php
// Cache expensive queries
$stats = Cache::remember('dashboard.stats', 3600, function () {
    return [
        'users' => User::count(),
        'orders' => Order::where('created_at', '>=', now()->startOfMonth())->sum('total'),
        'active_subscriptions' => Subscription::active()->count(),
    ];
});

// Invalidate on change (in observer or event listener)
Cache::forget('dashboard.stats');
```

### 13.5 Database Index Hints

```php
// Always add indexes for columns you query on
Schema::table('orders', function (Blueprint $table) {
    $table->index('status');                          // single column
    $table->index(['user_id', 'created_at']);          // composite
    $table->index(['status', 'created_at']);            // for scope + ordering
    $table->fullText('description');                    // full-text search
});

// WRONG: querying without an index on a large table
Order::where('reference', $ref)->first(); // full table scan

// CORRECT: ensure unique index exists
$table->unique('reference');
```

### 13.6 toQuery() for Bulk Updates

```php
// WRONG: loads all models into memory
$users = User::where('trial_ends_at', '<', now())->get();
foreach ($users as $user) {
    $user->update(['status' => 'expired']);
}

// CORRECT: single UPDATE query
User::where('trial_ends_at', '<', now())->update(['status' => 'expired']);

// Or with toQuery on a collection (when you need the collection for other things)
$users = User::where('trial_ends_at', '<', now())->get();
$users->toQuery()->update(['status' => 'expired']);
```
