# Queues, Events & Scheduling

Patterns para processamento assincrono em Laravel. Jobs, batches, events, listeners, broadcasting, scheduling, notifications.

---

## Table of Contents

1. [Queue Basics](#1-queue-basics)
2. [Job Middleware](#2-job-middleware)
3. [Job Batching](#3-job-batching)
4. [Job Chains](#4-job-chains)
5. [Failed Job Handling & Retries](#5-failed-job-handling--retries)
6. [PHP Attributes for Jobs](#6-php-attributes-for-jobs)
7. [Queue Routing (Laravel 13)](#7-queue-routing-laravel-13)
8. [Events & Listeners](#8-events--listeners)
9. [Event Subscribers](#9-event-subscribers)
10. [Broadcasting with Reverb](#10-broadcasting-with-reverb)
11. [Task Scheduling](#11-task-scheduling)
12. [Notifications](#12-notifications)

---

## 1. Queue Basics

### 1.1 Defining a Job

```php
// php artisan make:job ProcessPodcast

class ProcessPodcast implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly Podcast $podcast,
    ) {}

    public function handle(AudioProcessor $processor): void
    {
        $processor->process($this->podcast->audio_path);

        $this->podcast->update(['status' => PodcastStatus::Processed]);
    }

    public function failed(?Throwable $exception): void
    {
        Log::error('Podcast processing failed', [
            'podcast_id' => $this->podcast->id,
            'error' => $exception?->getMessage(),
        ]);

        $this->podcast->update(['status' => PodcastStatus::Failed]);
    }
}
```

### 1.2 Dispatching Jobs

```php
// Dispatch to default queue
ProcessPodcast::dispatch($podcast);

// Dispatch to specific queue/connection
ProcessPodcast::dispatch($podcast)
    ->onQueue('audio')
    ->onConnection('redis');

// Delay execution
ProcessPodcast::dispatch($podcast)->delay(now()->addMinutes(5));

// Dispatch after response is sent to client
ProcessPodcast::dispatchAfterResponse($podcast);

// Conditional dispatch
ProcessPodcast::dispatchIf($podcast->needsProcessing(), $podcast);
ProcessPodcast::dispatchUnless($podcast->isProcessed(), $podcast);

// Synchronous (skip queue, run immediately)
ProcessPodcast::dispatchSync($podcast);
```

### 1.3 Queue Connections & Drivers

```php
// .env
QUEUE_CONNECTION=redis

// config/queue.php — common drivers
'connections' => [
    'redis' => [
        'driver' => 'redis',
        'connection' => 'default',
        'queue' => 'default',
        'retry_after' => 90,
        'block_for' => 5,
    ],
    'sqs' => [
        'driver' => 'sqs',
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'prefix' => env('SQS_PREFIX'),
        'queue' => env('SQS_QUEUE', 'default'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],
    'database' => [
        'driver' => 'database',
        'table' => 'jobs',
        'queue' => 'default',
        'retry_after' => 90,
    ],
],
```

```bash
# Run worker
php artisan queue:work redis --queue=high,default,low

# Process single job
php artisan queue:work --once

# Process N jobs then stop
php artisan queue:work --max-jobs=100

# Stop after N seconds (for memory-safe deploys)
php artisan queue:work --max-time=3600
```

---

## 2. Job Middleware

### 2.1 Rate Limiting Middleware

```php
use Illuminate\Queue\Middleware\RateLimited;

class ProcessApiWebhook implements ShouldQueue
{
    use Queueable;

    public function middleware(): array
    {
        return [new RateLimited('webhooks')];
    }

    public function handle(): void { /* ... */ }
}

// Define the limiter in AppServiceProvider::boot()
RateLimiter::for('webhooks', function (object $job) {
    return Limit::perMinute(30);
});
```

### 2.2 Unique Jobs

```php
use Illuminate\Contracts\Queue\ShouldBeUnique;

class UpdateSearchIndex implements ShouldQueue, ShouldBeUnique
{
    use Queueable;

    public function __construct(
        public readonly Product $product,
    ) {}

    // Unique lock key
    public function uniqueId(): string
    {
        return $this->product->id;
    }

    // Lock timeout (seconds)
    public int $uniqueFor = 3600;

    public function handle(): void { /* ... */ }
}
```

### 2.3 Without Overlapping

```php
use Illuminate\Queue\Middleware\WithoutOverlapping;

class SyncInventory implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly Warehouse $warehouse,
    ) {}

    public function middleware(): array
    {
        return [
            (new WithoutOverlapping($this->warehouse->id))
                ->releaseAfter(60)       // release lock after 60s
                ->expireAfter(180),      // force expire after 180s
        ];
    }

    public function handle(): void { /* ... */ }
}
```

### 2.4 Skip When Batch Cancelled

```php
use Illuminate\Queue\Middleware\SkipIfBatchCancelled;

class ImportRow implements ShouldQueue
{
    use Batchable, Queueable;

    public function middleware(): array
    {
        return [new SkipIfBatchCancelled];
    }

    public function handle(): void { /* ... */ }
}
```

---

## 3. Job Batching

### 3.1 Creating a Batch

```php
use Illuminate\Bus\Batch;
use Illuminate\Support\Facades\Bus;

$batch = Bus::batch([
    new ImportCsvChunk($file, startRow: 0, endRow: 999),
    new ImportCsvChunk($file, startRow: 1000, endRow: 1999),
    new ImportCsvChunk($file, startRow: 2000, endRow: 2999),
])
->then(function (Batch $batch) {
    // All jobs completed successfully
    Notification::send($batch->createdBy, new ImportComplete($batch));
})
->catch(function (Batch $batch, Throwable $e) {
    // First failure
    Log::error('Batch failed', ['batch_id' => $batch->id, 'error' => $e->getMessage()]);
})
->finally(function (Batch $batch) {
    // Batch finished (success or failure)
    ImportTracker::where('batch_id', $batch->id)->update(['finished_at' => now()]);
})
->name('CSV Import')
->onQueue('imports')
->allowFailures()
->dispatch();

// Track progress
$batch = Bus::findBatch($batchId);
$batch->progress();       // percentage (0-100)
$batch->totalJobs;
$batch->processedJobs();
$batch->failedJobs;
$batch->finished();
$batch->cancelled();
```

### 3.2 Adding Jobs to Existing Batch

```php
class ImportCsvChunk implements ShouldQueue
{
    use Batchable, Queueable;

    public function handle(): void
    {
        if ($this->batch()->cancelled()) {
            return;
        }

        $rows = $this->parseChunk();

        // Dynamically add more jobs to the batch
        $moreJobs = $rows
            ->filter(fn ($row) => $row['needs_enrichment'])
            ->map(fn ($row) => new EnrichRecord($row));

        if ($moreJobs->isNotEmpty()) {
            $this->batch()->add($moreJobs);
        }
    }
}
```

---

## 4. Job Chains

Sequential execution — next job runs only after previous succeeds:

```php
Bus::chain([
    new ValidateOrder($order),
    new ChargePayment($order),
    new FulfillOrder($order),
    new SendConfirmation($order),
])->onQueue('orders')->dispatch();

// With error handling
Bus::chain([
    new ProcessUpload($file),
    new GenerateThumbnails($file),
    new NotifyUser($file),
])->catch(function (Throwable $e) {
    Log::error('Upload chain failed', ['error' => $e->getMessage()]);
})->dispatch();
```

```php
// WRONG: dispatching dependent jobs independently (no ordering guarantee)
ProcessUpload::dispatch($file);
GenerateThumbnails::dispatch($file);
NotifyUser::dispatch($file);

// CORRECT: chain ensures sequential execution
Bus::chain([
    new ProcessUpload($file),
    new GenerateThumbnails($file),
    new NotifyUser($file),
])->dispatch();
```

---

## 5. Failed Job Handling & Retries

### 5.1 Job Configuration

```php
class ProcessPayment implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public int $maxExceptions = 2;       // stop after 2 unique exceptions
    public int $timeout = 120;           // seconds
    public int $backoff = 10;            // seconds between retries

    // Or exponential backoff
    public function backoff(): array
    {
        return [5, 30, 120]; // 5s, 30s, 2min
    }

    // Retry until a time
    public function retryUntil(): DateTime
    {
        return now()->addHours(2);
    }

    public function handle(): void { /* ... */ }

    public function failed(?Throwable $exception): void
    {
        // Notify, cleanup, etc.
        $this->order->update(['payment_status' => 'failed']);
        Mail::to($this->order->user)->send(new PaymentFailedMail($this->order));
    }
}
```

### 5.2 Managing Failed Jobs

```bash
# List failed jobs
php artisan queue:failed

# Retry specific
php artisan queue:retry <job-id>

# Retry all
php artisan queue:retry all

# Forget a failed job
php artisan queue:forget <job-id>

# Flush all failed jobs
php artisan queue:flush
```

---

## 6. PHP Attributes for Jobs

Laravel 13 supports configuration via PHP attributes:

```php
use Illuminate\Queue\Attributes\Tries;
use Illuminate\Queue\Attributes\Backoff;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\Attributes\MaxExceptions;

#[Tries(3)]
#[Backoff(5, 30, 120)]
#[Timeout(60)]
#[MaxExceptions(2)]
class SendNewsletter implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly Newsletter $newsletter,
    ) {}

    public function handle(Mailer $mailer): void
    {
        foreach ($this->newsletter->subscribers()->cursor() as $subscriber) {
            $mailer->to($subscriber->email)->send(
                new NewsletterMail($this->newsletter)
            );
        }
    }
}
```

Attributes override property-based configuration and are the preferred approach in Laravel 13.

---

## 7. Queue Routing (Laravel 13)

Route specific job classes to queues/connections without configuring it in the job itself:

```php
// In AppServiceProvider::boot()
use Illuminate\Support\Facades\Queue;

Queue::route(ProcessPodcast::class, queue: 'audio', connection: 'redis');
Queue::route(SendNewsletter::class, queue: 'mail', connection: 'sqs');
Queue::route(GenerateReport::class, queue: 'reports');

// Job doesn't need onQueue/onConnection — routing is centralized
ProcessPodcast::dispatch($podcast); // automatically goes to redis:audio
```

**When to use:**
- Centralized queue configuration instead of per-job
- Easier to adjust routing without modifying job classes
- Production environment routing differs from local

---

## 8. Events & Listeners

### 8.1 Defining Events and Listeners

```php
// Event
class OrderPlaced
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly Order $order,
    ) {}
}

// Listener — sync
class UpdateInventory
{
    public function handle(OrderPlaced $event): void
    {
        foreach ($event->order->items as $item) {
            $item->product->decrement('stock', $item->quantity);
        }
    }
}

// Listener — queued (async)
class SendOrderConfirmation implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(OrderPlaced $event): void
    {
        Mail::to($event->order->user)->send(
            new OrderConfirmationMail($event->order)
        );
    }

    // Conditionally handle
    public function shouldQueue(OrderPlaced $event): bool
    {
        return $event->order->total > 0;
    }
}
```

### 8.2 Auto-Discovery (Default)

Laravel auto-discovers listeners by type-hinting. No manual registration needed:

```php
// This listener is auto-discovered because handle() type-hints OrderPlaced
class SendOrderConfirmation implements ShouldQueue
{
    public function handle(OrderPlaced $event): void { /* ... */ }
}
```

### 8.3 Dispatching Events

```php
// Via static dispatch
OrderPlaced::dispatch($order);

// Via event() helper
event(new OrderPlaced($order));

// From model (in controller/service)
class OrderService
{
    public function place(Order $order): void
    {
        $order->update(['status' => OrderStatus::Placed]);
        OrderPlaced::dispatch($order);
    }
}
```

```php
// WRONG: calling side-effects directly in controller
public function store(StoreOrderRequest $request)
{
    $order = Order::create($request->validated());
    Mail::to($order->user)->send(new OrderConfirmationMail($order));
    $order->items->each(fn ($item) => $item->product->decrement('stock', $item->quantity));
    Notification::send($order->user, new OrderPlacedNotification($order));
}

// CORRECT: dispatch event, let listeners handle side-effects
public function store(StoreOrderRequest $request)
{
    $order = Order::create($request->validated());
    OrderPlaced::dispatch($order);
    // Listeners handle: email, inventory, notifications, analytics...
}
```

---

## 9. Event Subscribers

Group related event handlers in one class:

```php
class OrderEventSubscriber
{
    public function handleOrderPlaced(OrderPlaced $event): void
    {
        Log::info('Order placed', ['order_id' => $event->order->id]);
    }

    public function handleOrderShipped(OrderShipped $event): void
    {
        Log::info('Order shipped', ['order_id' => $event->order->id]);
    }

    public function handleOrderCancelled(OrderCancelled $event): void
    {
        $event->order->items->each(
            fn ($item) => $item->product->increment('stock', $item->quantity)
        );
    }

    // Subscribe method maps events to handlers
    public function subscribe(Dispatcher $events): array
    {
        return [
            OrderPlaced::class => 'handleOrderPlaced',
            OrderShipped::class => 'handleOrderShipped',
            OrderCancelled::class => 'handleOrderCancelled',
        ];
    }
}

// Register in AppServiceProvider
Event::subscribe(OrderEventSubscriber::class);
```

---

## 10. Broadcasting with Reverb

### 10.1 Setup

```bash
# Install Reverb
php artisan install:broadcasting

# .env
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=my-app
REVERB_APP_KEY=my-key
REVERB_APP_SECRET=my-secret
REVERB_HOST=localhost
REVERB_PORT=8080
```

### 10.2 Broadcast Event

```php
class OrderStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly Order $order,
    ) {}

    // Channel
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("orders.{$this->order->user_id}"),
        ];
    }

    // Event name (optional, defaults to class name)
    public function broadcastAs(): string
    {
        return 'order.updated';
    }

    // Payload
    public function broadcastWith(): array
    {
        return [
            'order_id' => $this->order->id,
            'status' => $this->order->status->value,
            'updated_at' => $this->order->updated_at->toIso8601String(),
        ];
    }
}
```

### 10.3 Channel Authorization

```php
// routes/channels.php
Broadcast::channel('orders.{userId}', function (User $user, int $userId) {
    return $user->id === $userId;
});

// Presence channel (who is online)
Broadcast::channel('chat.{roomId}', function (User $user, int $roomId) {
    if ($user->canJoinRoom($roomId)) {
        return ['id' => $user->id, 'name' => $user->name];
    }
});
```

### 10.4 Frontend (Echo)

```javascript
// Laravel Echo + Reverb
Echo.private(`orders.${userId}`)
    .listen('.order.updated', (event) => {
        console.log('Order updated:', event.order_id, event.status);
    });

Echo.join(`chat.${roomId}`)
    .here((users) => { /* all current users */ })
    .joining((user) => { /* user joined */ })
    .leaving((user) => { /* user left */ });
```

---

## 11. Task Scheduling

### 11.1 Defining Schedules

```php
// routes/console.php
use Illuminate\Support\Facades\Schedule;

Schedule::command('model:prune')->daily();

Schedule::command('reports:generate')
    ->dailyAt('02:00')
    ->timezone('America/Sao_Paulo')
    ->withoutOverlapping()
    ->onOneServer()
    ->emailOutputOnFailure('admin@app.com');

Schedule::job(new CleanTempFiles)->hourly();

Schedule::call(function () {
    Cache::flush();
})->weekly()->sundays()->at('03:00');
```

### 11.2 Scheduling Frequency Options

```php
Schedule::command('foo')
    ->everyMinute()
    ->everyFiveMinutes()
    ->everyTenMinutes()
    ->everyFifteenMinutes()
    ->everyThirtyMinutes()
    ->hourly()
    ->hourlyAt(17)                    // :17 of every hour
    ->daily()
    ->dailyAt('13:00')
    ->twiceDaily(1, 13)               // 1:00 and 13:00
    ->weekly()
    ->weeklyOn(1, '8:00')             // Monday at 8:00
    ->monthly()
    ->monthlyOn(1, '00:00')           // 1st of month at midnight
    ->quarterly()
    ->yearly()
    ->cron('0 */6 * * *');            // custom cron
```

### 11.3 Constraints

```php
Schedule::command('emails:send')
    ->hourly()
    ->withoutOverlapping(30)          // lock for 30 min max
    ->onOneServer()                   // only on one server (needs cache driver)
    ->runInBackground()               // don't block scheduler
    ->when(fn () => app()->isProduction())
    ->skip(fn () => MaintenanceMode::isActive())
    ->before(function () {
        Log::info('Starting email send...');
    })
    ->after(function () {
        Log::info('Email send complete.');
    })
    ->onFailure(function () {
        Notification::route('slack', config('slack.webhook'))
            ->notify(new ScheduledTaskFailed('emails:send'));
    });
```

```bash
# Run the scheduler (cron entry on server)
* * * * * cd /path-to-your-project && php artisan schedule:run >> /dev/null 2>&1

# Debug schedules
php artisan schedule:list
php artisan schedule:test
```

---

## 12. Notifications

### 12.1 Defining a Notification

```php
// php artisan make:notification OrderShippedNotification

class OrderShippedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly Order $order,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail', 'database', 'broadcast'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("Order #{$this->order->reference} Shipped")
            ->greeting("Hello {$notifiable->name}!")
            ->line("Your order has been shipped.")
            ->action('Track Order', url("/orders/{$this->order->id}/track"))
            ->line('Thank you for your purchase.');
    }

    public function toDatabase(object $notifiable): array
    {
        return [
            'order_id' => $this->order->id,
            'message' => "Order #{$this->order->reference} has been shipped.",
            'tracking_url' => $this->order->tracking_url,
        ];
    }

    public function toBroadcast(object $notifiable): BroadcastMessage
    {
        return new BroadcastMessage([
            'order_id' => $this->order->id,
            'message' => "Your order has been shipped!",
        ]);
    }
}
```

### 12.2 Sending Notifications

```php
// Via Notifiable trait (on User model)
$user->notify(new OrderShippedNotification($order));

// Via Facade (multiple users)
Notification::send($users, new OrderShippedNotification($order));

// On-demand (no model)
Notification::route('mail', 'external@example.com')
    ->route('slack', config('slack.webhook'))
    ->notify(new SystemAlertNotification($message));
```

### 12.3 Database Notifications

```php
// Migration
php artisan notifications:table
php artisan migrate

// Reading notifications
$user->notifications;                    // all
$user->unreadNotifications;              // unread
$user->readNotifications;                // read

// Mark as read
$notification->markAsRead();
$user->unreadNotifications->markAsRead(); // bulk

// In API
public function index(Request $request): JsonResponse
{
    return response()->json([
        'notifications' => $request->user()->unreadNotifications,
        'unread_count' => $request->user()->unreadNotifications->count(),
    ]);
}
```

### 12.4 Conditional Delivery

```php
class OrderShippedNotification extends Notification
{
    // Only send if user opted in
    public function shouldSend(object $notifiable, string $channel): bool
    {
        return match ($channel) {
            'mail' => $notifiable->email_notifications_enabled,
            'broadcast' => true,
            default => true,
        };
    }
}
```
