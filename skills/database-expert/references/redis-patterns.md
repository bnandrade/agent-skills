# Redis Patterns

Data structures, caching, queues, rate limiting, pub/sub, distributed locks, streams, and operational patterns for Redis.

---

## Table of Contents

1. [Data Types](#1-data-types)
2. [Caching Patterns](#2-caching-patterns)
3. [Cache Invalidation](#3-cache-invalidation)
4. [Session Storage](#4-session-storage)
5. [Rate Limiting](#5-rate-limiting)
6. [Queue Patterns](#6-queue-patterns)
7. [Pub/Sub](#7-pubsub)
8. [Sorted Sets for Leaderboards](#8-sorted-sets-for-leaderboards)
9. [HyperLogLog](#9-hyperloglog)
10. [Distributed Locks](#10-distributed-locks)
11. [Redis Streams](#11-redis-streams)
12. [Memory Management](#12-memory-management)
13. [Persistence](#13-persistence)
14. [Security](#14-security)
15. [Redis in Laravel](#15-redis-in-laravel)

---

## 1. Data Types

### String

```redis
-- Most basic type. Stores text, numbers, or binary data (up to 512MB).
SET user:1:name "Bruno Andrade"
GET user:1:name  -- "Bruno Andrade"

-- With expiration
SET session:abc123 "{...}" EX 3600  -- expires in 1 hour
SETEX session:abc123 3600 "{...}"   -- same thing

-- Atomic increment (counters)
INCR page:views:home           -- 1
INCRBY page:views:home 10     -- 11
INCRBYFLOAT account:1:balance 99.50

-- Set only if not exists (for locks)
SET lock:order:42 "worker-1" NX EX 30  -- NX = only if not exists
-- Returns OK if set, nil if already exists
```

### Hash

```redis
-- Like a mini-object. Good for structured data with named fields.
HSET user:1 name "Bruno" email "bruno@example.com" plan "pro"
HGET user:1 name           -- "Bruno"
HGETALL user:1             -- {name: "Bruno", email: "bruno@example.com", plan: "pro"}
HMGET user:1 name email    -- ["Bruno", "bruno@example.com"]
HINCRBY user:1 login_count 1

-- WRONG: storing structured data as JSON string
SET user:1 '{"name":"Bruno","email":"bruno@example.com"}'
-- Must parse the entire JSON to read one field

-- CORRECT: use Hash for field-level access
HSET user:1 name "Bruno" email "bruno@example.com"
HGET user:1 name  -- no parsing needed
```

### List

```redis
-- Ordered collection. Doubly-linked list. Good for queues, recent items.
LPUSH notifications:user:1 "New order #42"
LPUSH notifications:user:1 "Payment received"
LRANGE notifications:user:1 0 9     -- last 10 notifications
LLEN notifications:user:1            -- count

-- Trim to keep only recent items
LTRIM notifications:user:1 0 99     -- keep last 100
```

### Set

```redis
-- Unordered collection of unique strings.
SADD tags:post:1 "postgresql" "database" "optimization"
SMEMBERS tags:post:1           -- {"postgresql", "database", "optimization"}
SISMEMBER tags:post:1 "redis"  -- 0 (false)
SCARD tags:post:1              -- 3 (count)

-- Set operations
SINTER tags:post:1 tags:post:2  -- tags in common
SUNION tags:post:1 tags:post:2  -- all tags from both
SDIFF tags:post:1 tags:post:2   -- tags in post:1 but not post:2

-- Track unique visitors
SADD visitors:2025-06-15 "user:1" "user:2" "user:3"
SCARD visitors:2025-06-15  -- 3 unique visitors
```

### Sorted Set

```redis
-- Like Set but each member has a score. Automatically sorted by score.
ZADD leaderboard 1500 "player:1" 1200 "player:2" 1800 "player:3"
ZRANGE leaderboard 0 -1 WITHSCORES   -- ascending by score
ZREVRANGE leaderboard 0 9 WITHSCORES -- top 10 (descending)
ZRANK leaderboard "player:1"          -- 0-indexed rank (ascending)
ZREVRANK leaderboard "player:1"       -- rank descending
ZSCORE leaderboard "player:1"         -- 1500
ZINCRBY leaderboard 100 "player:1"    -- 1600
```

### Stream

```redis
-- Append-only log with consumer groups. Like Kafka, but simpler.
XADD events * type "order.created" order_id "42" total "99.90"
-- Returns: "1718456789012-0" (timestamp-sequence ID)

XLEN events       -- count
XRANGE events - + COUNT 10  -- first 10 entries
```

---

## 2. Caching Patterns

### Cache-Aside (Lazy Loading)

```
1. App checks cache
2. Cache HIT → return cached data
3. Cache MISS → query database → store in cache → return
```

```php
// Pseudocode (Laravel-style)
function getUser(int $id): User {
    $key = "user:{$id}";

    // Check cache
    $cached = Redis::get($key);
    if ($cached) {
        return User::fromJson($cached);
    }

    // Cache miss: query DB
    $user = User::findOrFail($id);

    // Store in cache with TTL
    Redis::setex($key, 3600, $user->toJson());

    return $user;
}
```

### Write-Through

```
1. App writes to cache AND database simultaneously
2. Read always from cache
```

```php
function updateUser(int $id, array $data): User {
    // Write to DB
    $user = User::findOrFail($id);
    $user->update($data);

    // Write to cache (immediately consistent)
    Redis::setex("user:{$id}", 3600, $user->toJson());

    return $user;
}
```

### Write-Behind (Write-Back)

```
1. App writes to cache only
2. Asynchronous process flushes cache to database periodically
3. Risk: data loss if Redis crashes before flush
```

```redis
-- Use for: metrics, counters, non-critical data
INCR pageviews:post:42
-- Background worker periodically: GETSET pageviews:post:42 0 → flush to DB
```

### Cache Stampede Prevention

```php
// WRONG: many concurrent requests cache-miss at the same time
// All hit the database simultaneously (thundering herd)

// CORRECT: lock to prevent stampede
function getUserWithLock(int $id): User {
    $key = "user:{$id}";
    $lockKey = "lock:user:{$id}";

    $cached = Redis::get($key);
    if ($cached) return User::fromJson($cached);

    // Try to acquire lock
    $acquired = Redis::set($lockKey, '1', 'NX', 'EX', 5);
    if (!$acquired) {
        // Another process is fetching, wait and retry
        usleep(100_000); // 100ms
        return getUserWithLock($id);
    }

    try {
        // Double-check after lock
        $cached = Redis::get($key);
        if ($cached) return User::fromJson($cached);

        $user = User::findOrFail($id);
        Redis::setex($key, 3600, $user->toJson());
        return $user;
    } finally {
        Redis::del($lockKey);
    }
}
```

---

## 3. Cache Invalidation

### TTL-Based (Simplest)

```redis
-- Data expires automatically after TTL
SET user:1 "{...}" EX 3600  -- 1 hour TTL
-- Pro: simple, guaranteed freshness within TTL
-- Con: stale data within TTL window
```

### Event-Based (Immediate)

```php
// Invalidate on write events
function updateUser(int $id, array $data): User {
    $user = User::findOrFail($id);
    $user->update($data);

    // Invalidate all related cache keys
    Redis::del("user:{$id}");
    Redis::del("user:{$id}:profile");
    Redis::del("user:{$id}:permissions");

    return $user;
}
```

### Tag-Based Invalidation

```redis
-- Track which cache keys belong to a tag
SADD tag:user:1 "user:1" "user:1:profile" "user:1:orders"
SADD tag:tenant:42 "dashboard:42" "stats:42" "users:42"

-- Invalidate all keys for a tag
SMEMBERS tag:user:1  -- get all keys
-- DEL each key
DEL user:1 user:1:profile user:1:orders
DEL tag:user:1       -- cleanup tag
```

```php
// Laravel Cache Tags (built-in)
Cache::tags(['user:1', 'profiles'])->put('user:1:profile', $profile, 3600);
Cache::tags(['user:1'])->flush();  // invalidate everything tagged with user:1
```

### Pattern-Based Invalidation

```redis
-- WRONG: KEYS pattern (blocks Redis, O(N) over all keys)
KEYS user:1:*   -- NEVER use KEYS in production

-- CORRECT: SCAN pattern (non-blocking, cursor-based)
SCAN 0 MATCH user:1:* COUNT 100
-- Returns cursor + matching keys, iterate until cursor = 0
```

---

## 4. Session Storage

```redis
-- Store session as Hash
HSET session:abc123 user_id "1" name "Bruno" role "admin" ip "192.168.1.1"
EXPIRE session:abc123 7200  -- 2 hours

-- Read session
HGETALL session:abc123

-- Extend session on activity
EXPIRE session:abc123 7200  -- reset TTL on each request

-- Delete session (logout)
DEL session:abc123
```

```redis
-- WRONG: storing entire session as JSON string
SET session:abc123 '{"user_id":1,"name":"Bruno","cart":[...]}'
-- Must deserialize entire session to read one field

-- CORRECT: use Hash for field-level access
HSET session:abc123 user_id "1" name "Bruno"
HGET session:abc123 user_id  -- read single field without parsing
```

---

## 5. Rate Limiting

### Fixed Window

```redis
-- Simple: count requests per time window
-- Key: rate_limit:{identifier}:{window}
INCR rate_limit:user:1:2025-06-15T14:30
EXPIRE rate_limit:user:1:2025-06-15T14:30 60  -- 1 minute window

-- Check: if count > limit, reject
GET rate_limit:user:1:2025-06-15T14:30
-- If > 100, return 429 Too Many Requests
```

### Sliding Window (More Accurate)

```redis
-- Use sorted set with timestamps as scores
-- Each request adds a member with current timestamp

ZADD rate_limit:user:1 1718456789.123 "req:unique-id-1"

-- Count requests in the last 60 seconds
ZCOUNT rate_limit:user:1 (NOW-60) +inf

-- Cleanup old entries
ZREMRANGEBYSCORE rate_limit:user:1 -inf (NOW-60)

-- Set expiry on the key itself (safety net)
EXPIRE rate_limit:user:1 120
```

### Token Bucket

```redis
-- Allows bursts while maintaining average rate
-- Store: {tokens: float, last_refill: timestamp}
-- On each request: refill tokens based on elapsed time, then consume 1

-- Lua script for atomicity
EVAL "
    local key = KEYS[1]
    local max_tokens = tonumber(ARGV[1])    -- e.g., 100
    local refill_rate = tonumber(ARGV[2])   -- tokens per second, e.g., 10
    local now = tonumber(ARGV[3])           -- current timestamp

    local data = redis.call('HMGET', key, 'tokens', 'last_refill')
    local tokens = tonumber(data[1]) or max_tokens
    local last_refill = tonumber(data[2]) or now

    -- Refill tokens
    local elapsed = now - last_refill
    tokens = math.min(max_tokens, tokens + elapsed * refill_rate)

    -- Try to consume
    if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) * 2)
        return 1  -- allowed
    else
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        return 0  -- rejected
    end
" 1 rate:user:1 100 10 1718456789.123
```

---

## 6. Queue Patterns

### Simple Queue (LPUSH/BRPOP)

```redis
-- Producer: push to left
LPUSH queue:emails '{"to":"bruno@example.com","subject":"Welcome"}'

-- Consumer: blocking pop from right (FIFO)
BRPOP queue:emails 30  -- blocks up to 30 seconds waiting for a message
-- Returns: ["queue:emails", "{...}"]
```

### Reliable Queue (RPOPLPUSH / LMOVE)

```redis
-- Problem: if consumer crashes after BRPOP, the message is lost
-- Solution: move to processing list, remove only after successful processing

-- Consumer: atomically move from queue to processing list
LMOVE queue:emails processing:emails RIGHT LEFT
-- Or blocking version:
BLMOVE queue:emails processing:emails RIGHT LEFT 30

-- After successful processing: remove from processing list
LREM processing:emails 1 '{"to":"bruno@example.com","subject":"Welcome"}'

-- Recovery: check processing list for stuck messages (timeout-based)
-- If message has been in processing list for > 5 minutes, re-queue it
```

### Priority Queue

```redis
-- Use sorted sets: lower score = higher priority
ZADD queue:tasks 1 '{"type":"urgent","id":"a"}'   -- priority 1 (highest)
ZADD queue:tasks 5 '{"type":"normal","id":"b"}'    -- priority 5
ZADD queue:tasks 10 '{"type":"low","id":"c"}'      -- priority 10

-- Consumer: pop lowest score (highest priority)
ZPOPMIN queue:tasks  -- returns "a" (priority 1)
-- Blocking version (Redis 7+):
BZPOPMIN queue:tasks 30
```

### Dead Letter Queue

```redis
-- After N retries, move to dead letter queue
-- Track retry count in the message or in a separate hash
HINCRBY retries:message:abc123 count 1
HGET retries:message:abc123 count
-- If count > 3:
LPUSH queue:dead-letter '{"original_queue":"emails","message":{...},"error":"..."}'
```

---

## 7. Pub/Sub

### Basic Pub/Sub

```redis
-- Subscriber (connection 1):
SUBSCRIBE notifications:user:1
-- Blocks and receives messages...

-- Publisher (connection 2):
PUBLISH notifications:user:1 '{"type":"new_message","from":"user:2"}'
-- Returns: number of subscribers that received the message

-- Pattern subscription:
PSUBSCRIBE notifications:*
-- Receives messages from all notifications:* channels
```

### Limitations

```
- No persistence: if no one is listening, messages are lost
- No acknowledgment: publisher doesn't know if subscriber processed it
- No message history: new subscribers miss all previous messages
- For durable messaging, use Redis Streams instead
```

### Fan-Out Pattern

```redis
-- One event, multiple subscribers
-- Publisher:
PUBLISH order:created '{"order_id":42,"customer_id":1}'

-- Subscriber 1 (email service): SUBSCRIBE order:created
-- Subscriber 2 (inventory service): SUBSCRIBE order:created
-- Subscriber 3 (analytics service): SUBSCRIBE order:created
-- All three receive the same message simultaneously
```

---

## 8. Sorted Sets for Leaderboards

```redis
-- Add/update scores
ZADD leaderboard 1500 "player:alice"
ZADD leaderboard 1200 "player:bob"
ZADD leaderboard 1800 "player:charlie"
ZINCRBY leaderboard 100 "player:alice"  -- alice now 1600

-- Top 10 leaderboard
ZREVRANGE leaderboard 0 9 WITHSCORES

-- Player's rank (0-indexed, so add 1 for display)
ZREVRANK leaderboard "player:alice"  -- 1 (second place)

-- Players ranked 50-59 (pagination)
ZREVRANGE leaderboard 49 58 WITHSCORES

-- Count players with score > 1000
ZCOUNT leaderboard 1000 +inf

-- Time-windowed leaderboard (daily)
ZADD leaderboard:2025-06-15 100 "player:alice"
EXPIRE leaderboard:2025-06-15 172800  -- keep 2 days

-- Aggregate weekly leaderboard from daily
ZUNIONSTORE leaderboard:week:25 7 \
    leaderboard:2025-06-09 leaderboard:2025-06-10 \
    leaderboard:2025-06-11 leaderboard:2025-06-12 \
    leaderboard:2025-06-13 leaderboard:2025-06-14 \
    leaderboard:2025-06-15 AGGREGATE SUM
```

---

## 9. HyperLogLog

```redis
-- Probabilistic unique counting. ~12KB per counter regardless of cardinality.
-- Error rate: ~0.81%

PFADD unique_visitors:2025-06-15 "user:1" "user:2" "user:3"
PFADD unique_visitors:2025-06-15 "user:1" "user:4"  -- user:1 already counted

PFCOUNT unique_visitors:2025-06-15  -- ~4 (approximate)

-- Merge multiple counters (e.g., weekly unique visitors)
PFMERGE unique_visitors:week:25 \
    unique_visitors:2025-06-09 \
    unique_visitors:2025-06-10 \
    unique_visitors:2025-06-11

PFCOUNT unique_visitors:week:25  -- approximate unique across all days
```

```redis
-- WRONG: using a Set for unique counting at scale
SADD visitors:2025-06-15 "user:1" "user:2" ...  -- 1M members = ~64MB
SCARD visitors:2025-06-15

-- CORRECT: HyperLogLog for approximate unique counting at scale
PFADD visitors:2025-06-15 "user:1" "user:2" ...  -- always ~12KB
PFCOUNT visitors:2025-06-15  -- accurate within 0.81%
```

---

## 10. Distributed Locks

### Basic Lock (SET NX EX)

```redis
-- Acquire: SET key value NX EX ttl
SET lock:process-invoices "worker-1:abc123" NX EX 30
-- NX: only set if not exists
-- EX: auto-expire after 30 seconds (safety net)
-- Returns OK if acquired, nil if already locked

-- Release: only if we own the lock (Lua for atomicity)
EVAL "
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    else
        return 0
    end
" 1 lock:process-invoices "worker-1:abc123"
```

```redis
-- WRONG: release without checking ownership
DEL lock:process-invoices
-- Another worker might have acquired it after our TTL expired!

-- WRONG: no TTL on lock
SET lock:process-invoices "worker-1" NX
-- If worker crashes, lock is held forever (deadlock)

-- CORRECT: always set TTL, always verify ownership before release
SET lock:process-invoices "worker-1:unique-id" NX EX 30
-- Release with Lua script (check value matches)
```

### Lock with Extension (Heartbeat)

```redis
-- For long-running tasks: extend lock TTL periodically
-- Worker thread: every 10 seconds, if still processing:
EVAL "
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('EXPIRE', KEYS[1], ARGV[2])
    else
        return 0
    end
" 1 lock:process-invoices "worker-1:abc123" 30
-- Only extends if we still own the lock
```

### Redlock (Multi-Node)

```
-- For high-availability scenarios with multiple independent Redis nodes:
-- 1. Try to acquire lock on N/2+1 out of N nodes
-- 2. If majority acquired within timeout, lock is held
-- 3. Release on all nodes

-- Use a Redlock library (not manual implementation):
-- PHP: https://github.com/ronnylt/redlock-php
-- Node: https://github.com/mike-marcacci/node-redlock
-- Python: https://github.com/SPSCommerce/redlock-py
```

---

## 11. Redis Streams

### Producing Events

```redis
-- Append event to stream
XADD events * type "order.created" order_id "42" total "99.90"
-- * = auto-generate ID (timestamp-based)
-- Returns: "1718456789012-0"

-- With max length (trim old events)
XADD events MAXLEN ~ 10000 * type "page.viewed" page "/home"
-- ~ means approximately 10000 (more efficient than exact trim)
```

### Consumer Groups

```redis
-- Create consumer group (like Kafka consumer groups)
XGROUP CREATE events order-service $ MKSTREAM
-- $ = start from new messages only
-- 0 = start from beginning

-- Consumer reads from group
XREADGROUP GROUP order-service worker-1 COUNT 10 BLOCK 5000 STREAMS events >
-- > = only new messages not yet delivered to this consumer
-- BLOCK 5000 = wait up to 5 seconds for new messages

-- Acknowledge processed message
XACK events order-service "1718456789012-0"
```

### Pending Messages (Recovery)

```redis
-- Check pending (unacknowledged) messages
XPENDING events order-service - + 10
-- Shows: message ID, consumer, idle time, delivery count

-- Claim stuck messages (consumer crashed)
XCLAIM events order-service worker-2 60000 "1718456789012-0"
-- Claim messages idle for > 60 seconds, assign to worker-2

-- Auto-claim (Redis 6.2+)
XAUTOCLAIM events order-service worker-2 60000 0 COUNT 10
-- Automatically claim idle messages
```

### Streams vs Pub/Sub vs Lists

```
Feature          | Pub/Sub     | List (queue)    | Stream
-----------------|-------------|-----------------|------------------
Persistence      | No          | Yes             | Yes
Consumer groups  | No          | No              | Yes
Message replay   | No          | No              | Yes
Acknowledgment   | No          | Manual          | Built-in (XACK)
Fan-out          | Yes         | No (one consumer)| Yes (groups)
Best for         | Real-time   | Simple job queue | Event log, reliable messaging
```

---

## 12. Memory Management

### Maxmemory and Eviction Policies

```redis
-- Set max memory
CONFIG SET maxmemory 2gb

-- Eviction policies (what happens when maxmemory is reached):
CONFIG SET maxmemory-policy allkeys-lru
```

```
Policy              | Behavior
--------------------|------------------------------------------
noeviction          | Return errors on write when full (safest)
allkeys-lru         | Evict least recently used key (general cache)
allkeys-lfu         | Evict least frequently used key (Redis 4+)
volatile-lru        | LRU only among keys with TTL set
volatile-lfu        | LFU only among keys with TTL set
volatile-ttl        | Evict keys with shortest TTL first
allkeys-random      | Random eviction
volatile-random     | Random eviction among keys with TTL
```

**Recommendation:** `allkeys-lru` for general caching. `noeviction` if Redis is used as primary data store (queues, sessions).

### Memory Analysis

```redis
-- Total memory usage
INFO memory
-- used_memory: actual data
-- used_memory_rss: OS-reported (includes fragmentation)
-- mem_fragmentation_ratio: rss/used (>1.5 = fragmented, consider MEMORY PURGE)

-- Memory usage of a specific key
MEMORY USAGE user:1

-- Find big keys (non-blocking)
-- redis-cli --bigkeys (run from command line)

-- Memory doctor
MEMORY DOCTOR
```

---

## 13. Persistence

### RDB (Snapshot)

```redis
-- Point-in-time snapshot to disk
-- Configured in redis.conf:
-- save 900 1    -- snapshot every 15min if >= 1 key changed
-- save 300 10   -- snapshot every 5min if >= 10 keys changed
-- save 60 10000 -- snapshot every 1min if >= 10000 keys changed

-- Manual snapshot
BGSAVE  -- non-blocking (forks child process)
SAVE    -- blocking (NEVER use in production)

-- Pro: compact, fast to load, good for backups
-- Con: data loss between snapshots (up to last save interval)
```

### AOF (Append-Only File)

```redis
-- Logs every write operation
-- appendonly yes

-- Sync policies:
-- appendfsync always    -- every write (safest, slowest)
-- appendfsync everysec  -- every second (good balance, DEFAULT)
-- appendfsync no        -- OS decides (fastest, riskiest)

-- AOF rewrite (compaction)
BGREWRITEAOF  -- compact the AOF file in background

-- Pro: minimal data loss (at most 1 second with everysec)
-- Con: larger files, slower restart (must replay entire log)
```

### Hybrid (Recommended)

```redis
-- Redis 4+: RDB + AOF hybrid
-- aof-use-rdb-preamble yes
-- AOF file starts with RDB snapshot, then appends AOF entries
-- Fast restart (RDB) + minimal data loss (AOF)

-- This is the recommended configuration for production
```

---

## 14. Security

### Authentication

```redis
-- Simple password (Redis < 6)
-- requirepass YourStrongPasswordHere
AUTH YourStrongPasswordHere

-- ACLs (Redis 6+): granular user permissions
ACL SETUSER appuser on >secretpassword ~app:* +@read +@write -@admin
-- on: enable user
-- >password: set password
-- ~app:*: allow keys matching app:*
-- +@read +@write: allow read/write commands
-- -@admin: deny admin commands (FLUSHALL, CONFIG, etc.)

ACL SETUSER readonly on >readonlypass ~* +@read -@write -@admin
```

### Network Security

```redis
-- Bind to specific interfaces (not 0.0.0.0)
-- bind 127.0.0.1 ::1

-- Disable dangerous commands
-- rename-command FLUSHALL ""
-- rename-command FLUSHDB ""
-- rename-command CONFIG "CONFIG_a1b2c3"  -- rename to obscure name
-- rename-command DEBUG ""
-- rename-command KEYS ""  -- KEYS is dangerous in production anyway

-- TLS (Redis 6+)
-- tls-port 6380
-- tls-cert-file /path/to/redis.crt
-- tls-key-file /path/to/redis.key
-- tls-ca-cert-file /path/to/ca.crt
```

### Key Security Rules

```redis
-- WRONG: expose Redis to the internet without auth
-- bind 0.0.0.0
-- protected-mode no
-- # requirepass  (commented out)

-- CORRECT:
-- bind 127.0.0.1 (or private network IP)
-- protected-mode yes
-- requirepass <strong-password>
-- Use firewall rules to restrict access
-- Use TLS for connections over network
```

---

## 15. Redis in Laravel

### Cache

```php
// config/cache.php → 'default' => 'redis'

// Basic cache operations
Cache::put('key', 'value', now()->addHours(1));
Cache::get('key');
Cache::get('key', 'default');
Cache::forget('key');
Cache::has('key');

// Cache with closure (compute if missing)
$user = Cache::remember("user:{$id}", 3600, function () use ($id) {
    return User::findOrFail($id);
});

// Forever (no TTL)
Cache::forever('settings:global', $settings);

// Atomic lock
Cache::lock('process-invoices', 30)->get(function () {
    // Exclusively runs for up to 30 seconds
    processInvoices();
});

// Tags
Cache::tags(['users', "tenant:{$tenantId}"])->put("user:{$id}", $user, 3600);
Cache::tags(["tenant:{$tenantId}"])->flush();  // flush all tenant cache
```

### Queue

```php
// config/queue.php → 'default' => 'redis'

// Dispatch job
ProcessOrder::dispatch($order);
ProcessOrder::dispatch($order)->onQueue('high');

// Delayed job
ProcessOrder::dispatch($order)->delay(now()->addMinutes(5));

// Rate limited queue
// In AppServiceProvider:
RateLimiter::for('emails', function (object $job) {
    return Limit::perMinute(100);
});

// In job:
class SendEmail implements ShouldQueue
{
    public $tries = 3;
    public $backoff = [30, 60, 120];  // retry delays in seconds
    public string $queue = 'emails';

    public function middleware(): array
    {
        return [new RateLimited('emails')];
    }
}
```

### Session

```php
// config/session.php → 'driver' => 'redis'
// Stores sessions in Redis with automatic serialization
// Key format: laravel_session:{session_id}
```

### Rate Limiting

```php
// In RouteServiceProvider or bootstrap
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});

// Sliding window (Laravel 11+)
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)
        ->by($request->user()?->id ?: $request->ip())
        ->response(function () {
            return response()->json(['message' => 'Too many requests'], 429);
        });
});

// Multiple limits
RateLimiter::for('uploads', function (Request $request) {
    return [
        Limit::perMinute(10)->by($request->user()->id),
        Limit::perDay(100)->by($request->user()->id),
    ];
});
```

### Direct Redis Commands

```php
use Illuminate\Support\Facades\Redis;

// String
Redis::set('key', 'value');
Redis::get('key');
Redis::setex('key', 3600, 'value');

// Hash
Redis::hset('user:1', 'name', 'Bruno');
Redis::hgetall('user:1');

// Sorted Set
Redis::zadd('leaderboard', 1500, 'player:1');
Redis::zrevrange('leaderboard', 0, 9, 'WITHSCORES');

// Pub/Sub
Redis::publish('channel', json_encode($data));
Redis::subscribe(['channel'], function ($message) {
    // handle message
});

// Pipeline (batch commands, reduce round-trips)
Redis::pipeline(function ($pipe) {
    for ($i = 0; $i < 100; $i++) {
        $pipe->set("key:{$i}", "value:{$i}");
    }
});

// Transaction (MULTI/EXEC)
Redis::transaction(function ($tx) {
    $tx->set('key1', 'value1');
    $tx->set('key2', 'value2');
});
```
