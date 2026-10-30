# Performance

Query optimization, caching strategies, Octane, queues, and production tuning for Laravel 13.

---

## Table of Contents

1. [N+1 Query Detection & Prevention](#1-n1-query-detection--prevention)
2. [Query Optimization](#2-query-optimization)
3. [Caching Strategies](#3-caching-strategies)
4. [Config, Route & View Caching](#4-config-route--view-caching)
5. [Database Optimization](#5-database-optimization)
6. [Laravel Octane](#6-laravel-octane)
7. [Queue Optimization](#7-queue-optimization)
8. [Memory Optimization](#8-memory-optimization)
9. [Response Caching](#9-response-caching)
10. [Image Optimization](#10-image-optimization)
11. [Production Optimization Commands](#11-production-optimization-commands)
12. [Performance Checklist](#12-performance-checklist)

---

## 1. N+1 Query Detection & Prevention

### Enable N+1 Detection in Development

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Database\Eloquent\Model;

public function boot(): void
{
    // Throws exception on N+1 in local, logs in production
    Model::preventLazyLoading(! $this->app->isProduction());

    // Or log instead of throwing:
    Model::handleLazyLoadingViolationUsing(function ($model, $relation) {
        logger()->warning("N+1 detected: {$model}::{$relation}");
    });
}
```

### Eager Loading Strategies

```php
// WRONG: N+1 — 1 query for posts + 1 per post for user + 1 per post for tags
$posts = Post::all();
foreach ($posts as $post) {
    echo $post->user->name;
    echo $post->tags->pluck('name')->join(', ');
}
// Total: 1 + N + N queries

// CORRECT: eager load — always 3 queries total
$posts = Post::with(['user', 'tags'])->get();
```

```php
// WRONG: eager loading everything "just in case"
$posts = Post::with([
    'user', 'user.profile', 'user.roles', 'user.permissions',
    'tags', 'comments', 'comments.user', 'comments.likes',
    'media', 'categories',
])->get();
// Loads tons of data you probably don't use

// CORRECT: load only what the view/response actually needs
$posts = Post::with(['user:id,name,avatar', 'tags:id,name'])->get();
```

### Nested Eager Loading

```php
// Load nested relationships
$orders = Order::with([
    'customer:id,name,email',
    'items.product:id,name,price',
    'items.product.category:id,name',
])->get();
```

### Constrained Eager Loading

```php
// Only load recent comments, not all of them
$posts = Post::with([
    'comments' => fn ($q) => $q->latest()->limit(5)->with('user:id,name'),
])->get();

// With aggregates instead of loading the full relation
$posts = Post::withCount('comments')
    ->withAvg('ratings', 'score')
    ->withExists('bookmarks as is_bookmarked')
    ->get();

// $post->comments_count, $post->ratings_avg_score, $post->is_bookmarked
```

### Preventing N+1 in API Resources

```php
// WRONG: accessing relations inside Resource without eager loading
class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'author' => $this->user->name,        // N+1 if not eager loaded
            'tags' => $this->tags->pluck('name'),  // N+1 again
        ];
    }
}

// CORRECT: ensure the controller eager loads what the Resource needs
// Controller:
return PostResource::collection(
    Post::with(['user:id,name', 'tags:id,name'])->paginate(15)
);

// Or use whenLoaded() to conditionally include:
class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'author' => $this->whenLoaded('user', fn () => $this->user->name),
            'tags' => $this->whenLoaded('tags', fn () => $this->tags->pluck('name')),
        ];
    }
}
```

---

## 2. Query Optimization

### Select Only What You Need

```php
// WRONG: selects all columns including large text/blob fields
$users = User::all();

// CORRECT: select specific columns
$users = User::select(['id', 'name', 'email', 'avatar'])->get();

// With relationships
$users = User::select(['id', 'name'])
    ->with('department:id,name,user_id')
    ->get();
```

### Use Proper Indices

```php
// Migration: add indices for commonly queried columns
Schema::table('orders', function (Blueprint $table) {
    $table->index('status');                           // single column
    $table->index(['user_id', 'status']);               // composite
    $table->index(['created_at', 'status']);             // for date + filter queries
    $table->unique(['user_id', 'product_id']);           // unique composite
    $table->fullText('description');                     // full-text search
});
```

### EXPLAIN Queries

```php
// Debug slow queries
$query = Order::where('status', 'pending')
    ->where('created_at', '>', now()->subDays(30));

// Get the EXPLAIN output
dd($query->explain());

// Or use toSql() + getBindings() for manual analysis
dump($query->toSql());
dump($query->getBindings());
```

### Efficient Aggregates

```php
// WRONG: loading all records to count
$count = User::all()->count();             // loads every row into memory
$total = Order::all()->sum('total');        // same problem

// CORRECT: database-level aggregation
$count = User::count();
$total = Order::sum('total');
$avg = Order::where('status', 'completed')->avg('total');
```

### Use whereIn for Batch Lookups

```php
// WRONG: query inside loop
foreach ($orderIds as $id) {
    $order = Order::find($id);   // N queries
    $order->update(['status' => 'processing']);
}

// CORRECT: single query + bulk update
Order::whereIn('id', $orderIds)->update(['status' => 'processing']);

// When you need the models:
$orders = Order::whereIn('id', $orderIds)->get()->keyBy('id');
foreach ($orderIds as $id) {
    $order = $orders[$id]; // no query
}
```

### Raw Queries When Needed

```php
// Complex reporting query — Eloquent would be more verbose and slower
$report = DB::select(<<<'SQL'
    SELECT
        DATE(orders.created_at) as date,
        COUNT(*) as order_count,
        SUM(orders.total) as revenue,
        AVG(orders.total) as avg_order
    FROM orders
    WHERE orders.created_at >= ?
      AND orders.status = 'completed'
    GROUP BY DATE(orders.created_at)
    ORDER BY date DESC
    LIMIT 30
SQL, [now()->subDays(30)]);
```

### Subquery Selects

```php
// Instead of loading related data, use subqueries
$users = User::query()
    ->addSelect([
        'last_order_at' => Order::select('created_at')
            ->whereColumn('user_id', 'users.id')
            ->latest()
            ->limit(1),
    ])
    ->withCast(['last_order_at' => 'datetime'])
    ->orderByDesc('last_order_at')
    ->get();
```

---

## 3. Caching Strategies

### Basic Cache Patterns

```php
use Illuminate\Support\Facades\Cache;

// Remember pattern — fetch from cache or compute
$stats = Cache::remember('dashboard:stats', 3600, function () {
    return [
        'users' => User::count(),
        'orders' => Order::where('status', 'completed')->count(),
        'revenue' => Order::sum('total'),
    ];
});

// Remember forever — invalidate manually
$settings = Cache::rememberForever('site:settings', function () {
    return Setting::all()->pluck('value', 'key');
});
```

### Cache Tags (Redis/Memcached Only)

```php
// Tag-based cache — invalidate groups of related cache entries
Cache::tags(['users', 'profile'])->put("user:{$id}:profile", $profile, 3600);
Cache::tags(['users', 'posts'])->put("user:{$id}:posts", $posts, 3600);

// Flush all user-related cache
Cache::tags('users')->flush();

// Flush only profile cache
Cache::tags('profile')->flush();
```

### Cache Lock (Prevent Thundering Herd)

```php
// Prevent multiple processes from computing the same expensive value
$stats = Cache::lock('compute:stats', 10)->block(5, function () {
    return Cache::remember('dashboard:stats', 3600, function () {
        return $this->computeExpensiveStats();
    });
});
```

### Cache::touch() (Laravel 13)

```php
// Extend TTL without re-storing the value
Cache::put('session:active:' . $userId, true, 1800);

// On activity, just extend the TTL — no re-serialization
Cache::touch('session:active:' . $userId, 1800);
```

### WRONG/CORRECT: Caching Patterns

```php
// WRONG: caching inside a loop
foreach ($products as $product) {
    $reviews = Cache::remember("product:{$product->id}:reviews", 3600, function () use ($product) {
        return $product->reviews()->latest()->limit(5)->get();
    });
}

// CORRECT: cache the whole collection, or eager load
$products = Product::with(['reviews' => fn ($q) => $q->latest()->limit(5)])->get();
// Cache at a higher level if needed:
$products = Cache::remember('products:featured', 3600, function () {
    return Product::with('reviews')->featured()->get();
});
```

```php
// WRONG: no invalidation strategy (stale data)
Cache::rememberForever('user:' . $id, fn () => User::find($id));
// User updates their profile... cache still shows old data

// CORRECT: invalidate on change
// In UserObserver:
public function updated(User $user): void
{
    Cache::forget("user:{$user->id}");
    Cache::tags('users')->flush(); // if using tags
}

// Or use short TTL instead of forever
Cache::remember("user:{$id}", 300, fn () => User::find($id));
```

---

## 4. Config, Route & View Caching

### What Each Cache Does

| Command | What It Does | When to Use |
|---|---|---|
| `config:cache` | Merges all config files into one cached file | Always in production |
| `route:cache` | Serializes route definitions | Always in production |
| `view:cache` | Pre-compiles all Blade templates | Always in production |
| `event:cache` | Caches event-listener mappings | Always in production |

### WRONG/CORRECT: Environment Access

```php
// WRONG: using env() outside of config files
// This breaks when config is cached (env() returns null)
$key = env('STRIPE_KEY');

// CORRECT: reference config values that wrap env()
// config/services.php: 'stripe' => ['key' => env('STRIPE_KEY')]
$key = config('services.stripe.key');
```

### Clear and Rebuild

```bash
# Clear everything
php artisan optimize:clear

# Rebuild everything
php artisan optimize
# This runs: config:cache, route:cache, view:cache, event:cache
```

---

## 5. Database Optimization

### Connection Pooling

```php
// config/database.php — for high-traffic apps
'mysql' => [
    'driver' => 'mysql',
    'pool' => [
        'enabled' => true,        // Laravel 13 native pooling with Octane
        'min' => 5,
        'max' => 20,
    ],
    // ...
],
```

### Read Replicas

```php
// config/database.php
'mysql' => [
    'read' => [
        'host' => [
            env('DB_READ_HOST_1', '10.0.0.1'),
            env('DB_READ_HOST_2', '10.0.0.2'),
        ],
    ],
    'write' => [
        'host' => [env('DB_WRITE_HOST', '10.0.0.3')],
    ],
    'sticky' => true, // after write, reads use write connection for this request
    // ...
],
```

```php
// Force read from write connection (after important write)
$order = Order::create($data);
$order = Order::onWriteConnection()->find($order->id); // reads from write DB

// Force read replica
$stats = DB::connection('mysql::read')->table('orders')->sum('total');
```

### Efficient Migrations for Large Tables

```php
// WRONG: altering large table without thinking
Schema::table('orders', function (Blueprint $table) {
    $table->string('tracking_number')->nullable(); // locks entire table on MySQL < 8.0
});

// CORRECT: for very large tables, use raw DDL or do it in steps
// MySQL 8+ handles most ALTER TABLE operations with instant DDL:
Schema::table('orders', function (Blueprint $table) {
    $table->string('tracking_number')->nullable()->after('status');
});

// For truly huge tables (100M+ rows), consider pt-online-schema-change
```

### Database Transactions

```php
// WRONG: no transaction for multi-step operations
$order = Order::create($data);
$order->items()->createMany($items);
$order->payment()->create($paymentData);
// If payment creation fails, you have an order without payment

// CORRECT: wrap in transaction
DB::transaction(function () use ($data, $items, $paymentData) {
    $order = Order::create($data);
    $order->items()->createMany($items);
    $order->payment()->create($paymentData);
});
```

---

## 6. Laravel Octane

Octane boots your application once and keeps it in memory, serving requests without the bootstrap overhead.

### When to Use Octane

| Use Octane | Don't Use Octane |
|---|---|
| High-traffic API (>100 rps) | Shared hosting |
| Low-latency requirements | Simple CRUD apps |
| WebSocket / real-time | Apps with poorly written singletons |
| Long-running processes | Legacy code with global state |

### Setup

```bash
composer require laravel/octane
php artisan octane:install
# Choose: FrankenPHP (recommended) or Swoole
```

```bash
# Start with FrankenPHP
php artisan octane:start --server=frankenphp --workers=4 --port=8000

# Or Swoole
php artisan octane:start --server=swoole --workers=auto --task-workers=6
```

### WRONG/CORRECT: Octane Pitfalls

```php
// WRONG: storing state in static properties (shared across requests!)
class PriceCalculator
{
    private static float $taxRate = 0;

    public static function setTaxRate(float $rate): void
    {
        self::$taxRate = $rate; // persists across ALL requests
    }
}

// CORRECT: use request-scoped state or the container
class PriceCalculator
{
    public function __construct(
        private readonly float $taxRate,
    ) {}
}

// Bind per-request in a service provider
$this->app->bind(PriceCalculator::class, function ($app) {
    return new PriceCalculator(
        taxRate: config('shop.tax_rate'),
    );
});
```

```php
// WRONG: mutating a singleton that persists across requests
class CartService
{
    private array $items = []; // never cleared between requests!

    public function add(Product $product): void
    {
        $this->items[] = $product;
    }
}

// CORRECT: use Octane's flush mechanism or bind as scoped
use Laravel\Octane\Facades\Octane;

// In OctaneServiceProvider:
Octane::flush(CartService::class);

// Or register as scoped (recreated per request)
$this->app->scoped(CartService::class);
```

### Octane Concurrent Tasks

```php
use Laravel\Octane\Facades\Octane;

// Run expensive operations in parallel within a single request
[$users, $orders, $stats] = Octane::concurrently([
    fn () => User::active()->count(),
    fn () => Order::today()->sum('total'),
    fn () => Cache::get('dashboard:stats'),
]);
```

---

## 7. Queue Optimization

### Horizontal Workers

```bash
# Run multiple queue workers (use Supervisor in production)
php artisan queue:work --queue=high,default,low --tries=3 --timeout=90

# Separate workers for different queues
php artisan queue:work --queue=high --tries=3 --timeout=30
php artisan queue:work --queue=default --tries=3 --timeout=60
php artisan queue:work --queue=low --tries=3 --timeout=300
```

### Queue Routing (Laravel 13)

```php
use Illuminate\Support\Facades\Queue;

// Route specific jobs to specific connections/queues
Queue::route(ProcessPodcast::class, connection: 'redis', queue: 'podcasts');
Queue::route(SendInvoice::class, connection: 'sqs', queue: 'billing');
Queue::route(ResizeImage::class, queue: 'media');
```

### Job Middleware

```php
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\Middleware\ThrottlesExceptions;

#[Tries(3)]
#[Backoff(30, 60, 120)]
#[Timeout(120)]
class ProcessPayment implements ShouldQueue
{
    use Queueable;

    public function middleware(): array
    {
        return [
            new RateLimited('payments'),           // rate limit
            new WithoutOverlapping($this->orderId), // prevent duplicate processing
            new ThrottlesExceptions(3, 5 * 60),    // 3 exceptions per 5 min, then release
        ];
    }

    public function handle(): void
    {
        // process payment
    }
}
```

### Batch Processing

```php
use Illuminate\Bus\Batch;
use Illuminate\Support\Facades\Bus;

$batch = Bus::batch([
    new ProcessImage($image1),
    new ProcessImage($image2),
    new ProcessImage($image3),
])
->then(function (Batch $batch) {
    // All jobs completed successfully
    Notification::send($user, new ImagesProcessed($batch));
})
->catch(function (Batch $batch, \Throwable $e) {
    // First failure
    logger()->error('Batch failed', ['batch' => $batch->id, 'error' => $e->getMessage()]);
})
->finally(function (Batch $batch) {
    // Batch finished (success or failure)
})
->allowFailures()
->dispatch();

// Track progress
$batch = Bus::findBatch($batchId);
echo $batch->progress(); // 66 (percent)
```

### WRONG/CORRECT: Queue Patterns

```php
// WRONG: dispatching inside a loop without batching
foreach ($users as $user) {
    SendNewsletter::dispatch($user);
    // Dispatches thousands of individual jobs, overloads the queue
}

// CORRECT: use batch or chunk dispatch
Bus::batch(
    $users->map(fn ($user) => new SendNewsletter($user))->toArray()
)->dispatch();

// Or chunk for very large sets
$users->chunk(100)->each(function ($chunk) {
    Bus::batch(
        $chunk->map(fn ($user) => new SendNewsletter($user))->toArray()
    )->dispatch();
});
```

```php
// WRONG: storing Eloquent model in job payload (serializes entire model)
class ProcessOrder implements ShouldQueue
{
    public function __construct(
        public Order $order, // serializes full model — large payload, stale data
    ) {}
}

// CORRECT: store only the ID, fetch fresh in handle()
class ProcessOrder implements ShouldQueue
{
    public function __construct(
        public readonly int $orderId,
    ) {}

    public function handle(): void
    {
        $order = Order::findOrFail($this->orderId);
        // fresh data, small payload
    }
}
```

---

## 8. Memory Optimization

### Lazy Collections

```php
// WRONG: loads entire table into memory
$users = User::all(); // 1M users = 1M Eloquent objects in memory

// CORRECT: lazy collection — yields one model at a time
User::lazy()->each(function (User $user) {
    // processes one at a time, constant memory usage
    $user->sendAnnualReport();
});
```

### Cursor for Read-Only Iteration

```php
// cursor() uses a single query + PHP generator — lowest memory
foreach (User::cursor() as $user) {
    // one model in memory at a time
    $csv->addRow([$user->name, $user->email]);
}

// chunk() vs cursor() vs lazy():
// chunk(N) — N queries (LIMIT/OFFSET), N models in memory at a time
// cursor() — 1 query, 1 model in memory, but keeps DB connection open
// lazy()   — multiple queries (chunked internally), 1 model yielded at a time
// lazy() is the safest default for large datasets
```

### WRONG/CORRECT: Memory Patterns

```php
// WRONG: collecting everything then filtering
$activeUsers = User::all()->filter(fn ($u) => $u->isActive());

// CORRECT: filter at the database level
$activeUsers = User::where('status', 'active')->get();
// Or with scope:
$activeUsers = User::active()->get();
```

```php
// WRONG: building a huge array in memory for export
$data = [];
foreach (Order::all() as $order) {
    $data[] = [$order->id, $order->total, $order->created_at];
}
return response()->download(CsvWriter::write($data));

// CORRECT: stream the CSV response
return response()->streamDownload(function () {
    $handle = fopen('php://output', 'w');
    fputcsv($handle, ['ID', 'Total', 'Date']);

    Order::lazy()->each(function (Order $order) use ($handle) {
        fputcsv($handle, [
            $order->id,
            $order->total,
            $order->created_at->toDateString(),
        ]);
    });

    fclose($handle);
}, 'orders.csv', ['Content-Type' => 'text/csv']);
```

---

## 9. Response Caching

### HTTP Cache Headers

```php
// Middleware for cacheable responses
class CacheResponse
{
    public function handle(Request $request, Closure $next, int $minutes = 60): Response
    {
        $response = $next($request);

        if ($request->isMethod('GET') && $response->isSuccessful()) {
            $response->headers->set('Cache-Control', "public, max-age=" . ($minutes * 60));
            $response->headers->set('ETag', md5($response->getContent()));
        }

        return $response;
    }
}
```

### Full Page Cache (for Public Pages)

```php
// Use spatie/laravel-responsecache or similar
// config/responsecache.php
'enabled' => env('RESPONSE_CACHE_ENABLED', true),
'cache_lifetime_in_seconds' => 3600,

// In routes
Route::middleware('cacheResponse:3600')->group(function () {
    Route::get('/blog', [BlogController::class, 'index']);
    Route::get('/blog/{post:slug}', [BlogController::class, 'show']);
});

// Invalidate on content change
// In PostObserver:
public function saved(Post $post): void
{
    ResponseCache::clear();
    // Or selectively: ResponseCache::forget('/blog/' . $post->slug);
}
```

---

## 10. Image Optimization

### On Upload

```php
use Intervention\Image\Laravel\Facades\Image;

class ImageService
{
    public function store(UploadedFile $file, string $directory): array
    {
        $image = Image::read($file);

        // Generate multiple sizes
        $sizes = [
            'thumb' => [150, 150],
            'medium' => [600, null],    // null = maintain aspect ratio
            'large' => [1200, null],
        ];

        $paths = [];

        foreach ($sizes as $name => [$width, $height]) {
            $resized = $image->scaleDown(width: $width, height: $height);
            $path = "{$directory}/{$name}/" . Str::uuid() . '.webp';

            Storage::put($path, $resized->toWebp(quality: 80));
            $paths[$name] = $path;
        }

        return $paths;
    }
}
```

### Responsive Images in Blade

```blade
<picture>
    <source srcset="{{ Storage::url($image['large']) }}" media="(min-width: 1024px)">
    <source srcset="{{ Storage::url($image['medium']) }}" media="(min-width: 640px)">
    <img src="{{ Storage::url($image['thumb']) }}"
         alt="{{ $alt }}"
         loading="lazy"
         decoding="async"
         class="w-full h-auto rounded">
</picture>
```

---

## 11. Production Optimization Commands

### Deploy Script

```bash
#!/bin/bash
# deploy.sh — run after pulling new code

# Install dependencies (no dev)
composer install --no-dev --optimize-autoloader

# Build assets
npm ci && npm run build

# Cache everything
php artisan optimize          # config, routes, views, events
php artisan icons:cache       # if using Blade Icons
php artisan filament:cache-components  # if using Filament

# Run migrations
php artisan migrate --force

# Restart queue workers (pick up new code)
php artisan queue:restart

# Restart Octane (if using)
php artisan octane:reload

# Clear expired cache entries
php artisan cache:prune-stale-tags  # if using Redis cache tags
```

### Composer Autoloader Optimization

```bash
# Level 1: classmap (default with --optimize-autoloader)
composer install --optimize-autoloader

# Level 2: APCu autoloading (if APCu extension is available)
composer install --optimize-autoloader --apcu-autoloader
```

### OPcache Configuration

```ini
; php.ini — production OPcache settings
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0          ; disable in production (restart PHP to pick up changes)
opcache.jit=1255                       ; enable JIT (PHP 8.3+)
opcache.jit_buffer_size=128M
```

---

## 12. Performance Checklist

| Check | Impact | Effort |
|---|---|---|
| Enable `preventLazyLoading()` in dev | High | Low |
| Eager load relationships in controllers | High | Low |
| Add database indices for WHERE/ORDER columns | High | Low |
| Use `php artisan optimize` in production | High | Low |
| Use `select()` to limit columns | Medium | Low |
| Cache expensive queries with `Cache::remember()` | High | Medium |
| Use `lazy()` / `cursor()` for large datasets | High | Low |
| Configure OPcache + JIT | High | Low |
| Use queue jobs for work > 1 second | High | Medium |
| Use `config()` not `env()` outside config files | Critical | Low |
| Set up read replicas for read-heavy apps | High | Medium |
| Use Laravel Octane for high-traffic APIs | High | Medium |
| Optimize images on upload (WebP, resize) | Medium | Medium |
| Add HTTP cache headers for public pages | Medium | Low |
| Use `composer install --optimize-autoloader` | Medium | Low |
| Profile with Laravel Debugbar / Telescope | — | Low |
| Use Redis for cache + sessions + queues | High | Low |
| Batch queue dispatches instead of looping | Medium | Low |
