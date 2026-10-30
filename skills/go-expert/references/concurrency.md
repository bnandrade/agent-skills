# Concurrency

Patterns de concorrência em Go para produção. Cada pattern inclui quando usar, exemplos, e armadilhas comuns.

---

## Table of Contents

1. [Goroutines Fundamentals](#1-goroutines-fundamentals)
2. [Channels](#2-channels)
3. [Select Statement](#3-select-statement)
4. [Mutexes & Shared State](#4-mutexes--shared-state)
5. [sync Package](#5-sync-package)
6. [Context Propagation](#6-context-propagation)
7. [Worker Pools](#7-worker-pools)
8. [Fan-Out / Fan-In](#8-fan-out--fan-in)
9. [Pipeline Pattern](#9-pipeline-pattern)
10. [Rate Limiting](#10-rate-limiting)
11. [Common Mistakes](#11-common-mistakes)

---

## 1. Goroutines Fundamentals

### 1.1 Always Have a Shutdown Path

Every goroutine must have a way to stop:

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case job, ok := <-jobs:
            if !ok {
                return // channel closed
            }
            process(job)
        case <-ctx.Done():
            return // context cancelled
        }
    }
}
```

### 1.2 Use errgroup for Coordinated Goroutines

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))

    for i, url := range urls {
        g.Go(func() error {
            res, err := fetch(ctx, url)
            if err != nil {
                return fmt.Errorf("fetching %s: %w", url, err)
            }
            results[i] = res // safe: each goroutine writes to its own index
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

### 1.3 Use sync.WaitGroup.Go() for Fire-and-Forget (Go 1.25+)

```go
// Go 1.25+: WaitGroup.Go() — handles Add(1) and Done() automatically
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Go(func() {
        process(task)
    })
}
wg.Wait()

// Pre-1.25 pattern (still valid but verbose):
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Add(1)
    go func() {
        defer wg.Done()
        process(task)
    }()
}
wg.Wait()
```

Prefer `wg.Go()` in new code — it eliminates the `Add`/`Done` boilerplate and prevents forgetting `defer wg.Done()`.

---

## 2. Channels

### 2.1 Unbuffered vs Buffered

```go
// Unbuffered: synchronization point — sender blocks until receiver reads
ch := make(chan int)

// Buffered: decoupling — sender blocks only when buffer is full
ch := make(chan int, 16)
```

**Rules of thumb:**
- Unbuffered when goroutines need to synchronize
- Buffered when producer and consumer have different speeds
- Buffer size should match expected burst, not arbitrary large numbers

### 2.2 Directional Channels in Function Signatures

```go
// Producer only sends
func produce(out chan<- int) {
    for i := 0; i < 10; i++ {
        out <- i
    }
    close(out) // producer closes
}

// Consumer only receives
func consume(in <-chan int) {
    for val := range in {
        fmt.Println(val)
    }
}
```

### 2.3 Channel Ownership

The goroutine that creates the channel should close it. Receivers should never close a channel:

```go
func generator(n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch) // creator closes
        for i := 0; i < n; i++ {
            ch <- i
        }
    }()
    return ch
}
```

### 2.4 Non-Blocking Send

```go
select {
case ch <- msg:
    // sent
default:
    // channel full, handle backpressure
    log.Printf("dropping message: channel full")
}
```

---

## 3. Select Statement

### 3.1 Timeout Pattern

```go
select {
case result := <-ch:
    process(result)
case <-time.After(5 * time.Second):
    return fmt.Errorf("timeout waiting for result")
case <-ctx.Done():
    return ctx.Err()
}
```

### 3.2 Ticker Pattern

```go
func poll(ctx context.Context, interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            if err := check(); err != nil {
                slog.Error("check failed", "error", err)
            }
        case <-ctx.Done():
            return
        }
    }
}
```

### 3.3 Priority Select (Drain Before Timeout)

```go
for {
    select {
    case msg := <-high:
        processHigh(msg)
    default:
        select {
        case msg := <-high:
            processHigh(msg)
        case msg := <-low:
            processLow(msg)
        case <-ctx.Done():
            return
        }
    }
}
```

---

## 4. Mutexes & Shared State

### 4.1 Protect State with sync.Mutex

```go
type SafeCounter struct {
    mu sync.Mutex
    n  int
}

func (c *SafeCounter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *SafeCounter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

### 4.2 Use sync.RWMutex for Read-Heavy Workloads

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]Item
}

func (c *Cache) Get(key string) (Item, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    item, ok := c.items[key]
    return item, ok
}

func (c *Cache) Set(key string, item Item) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[key] = item
}
```

### 4.3 Keep Critical Sections Small

```go
// WRONG: holding lock during I/O
func (s *Store) Update(id string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    data, err := s.fetchFromDB(id) // slow I/O under lock!
    s.cache[id] = data
    return err
}

// CORRECT: only lock for shared state access
func (s *Store) Update(id string) error {
    data, err := s.fetchFromDB(id) // I/O without lock
    if err != nil {
        return err
    }
    s.mu.Lock()
    s.cache[id] = data
    s.mu.Unlock()
    return nil
}
```

---

## 5. sync Package

### 5.1 sync.Once for Lazy Initialization

```go
type Client struct {
    once sync.Once
    conn *grpc.ClientConn
}

func (c *Client) getConn() *grpc.ClientConn {
    c.once.Do(func() {
        c.conn, _ = grpc.Dial("localhost:50051", grpc.WithInsecure())
    })
    return c.conn
}
```

### 5.2 sync.Map for Concurrent Map Access

Use when keys are stable (written once, read many) or when goroutines access disjoint key sets:

```go
var running sync.Map

func execute(jobID string) {
    // Deduplicate: only one goroutine per jobID
    if _, loaded := running.LoadOrStore(jobID, struct{}{}); loaded {
        return // already running
    }
    defer running.Delete(jobID)

    // do work...
}
```

For most other cases, `sync.RWMutex` + regular `map` is simpler and faster.

### 5.3 sync.Pool for Reusing Allocations

```go
var bufPool = sync.Pool{
    New: func() any {
        return new(bytes.Buffer)
    },
}

func process(data []byte) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()

    buf.Write(data)
    // use buf...
}
```

### 5.4 atomic for Simple Counters

```go
var requestCount atomic.Int64

func handler(w http.ResponseWriter, r *http.Request) {
    requestCount.Add(1)
    // ...
}

func metrics() int64 {
    return requestCount.Load()
}
```

---

## 6. Context Propagation

### 6.1 Always Pass Context as First Parameter

```go
func (s *Service) ProcessOrder(ctx context.Context, orderID string) error {
    user, err := s.users.FindByID(ctx, orderID)
    if err != nil {
        return fmt.Errorf("finding user: %w", err)
    }
    return s.notify(ctx, user)
}
```

### 6.2 Check Context Cancellation in Long Operations

```go
func processItems(ctx context.Context, items []Item) error {
    for _, item := range items {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        if err := process(item); err != nil {
            return fmt.Errorf("processing item %s: %w", item.ID, err)
        }
    }
    return nil
}
```

### 6.3 Create Child Contexts for Subtasks

```go
func (s *Service) Handle(ctx context.Context) error {
    // Timeout for this specific operation
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    return s.doWork(ctx)
}
```

---

## 7. Worker Pools

### 7.1 Bounded Worker Pool with errgroup

```go
func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(10) // max 10 concurrent workers

    for _, item := range items {
        g.Go(func() error {
            return process(ctx, item)
        })
    }

    return g.Wait()
}
```

### 7.2 Worker Pool with Channels

```go
func workerPool(ctx context.Context, numWorkers int, jobs <-chan Job) {
    var wg sync.WaitGroup
    for range numWorkers {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case job, ok := <-jobs:
                    if !ok {
                        return
                    }
                    process(job)
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    wg.Wait()
}
```

---

## 8. Fan-Out / Fan-In

### 8.1 Fan-Out: Distribute Work

```go
func fanOut(ctx context.Context, input <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := range workers {
        channels[i] = worker(ctx, input)
    }
    return channels
}
```

### 8.2 Fan-In: Merge Results

```go
func fanIn(ctx context.Context, channels ...<-chan int) <-chan int {
    merged := make(chan int)
    var wg sync.WaitGroup

    for _, ch := range channels {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case val, ok := <-ch:
                    if !ok {
                        return
                    }
                    select {
                    case merged <- val:
                    case <-ctx.Done():
                        return
                    }
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(merged)
    }()

    return merged
}
```

---

## 9. Pipeline Pattern

Stages connected by channels, each running in its own goroutine:

```go
func generate(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case out <- n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case out <- n * n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func filter(ctx context.Context, in <-chan int, pred func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            if pred(n) {
                select {
                case out <- n:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return out
}

// Usage
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

nums := generate(ctx, 1, 2, 3, 4, 5)
squared := square(ctx, nums)
even := filter(ctx, squared, func(n int) bool { return n%2 == 0 })

for val := range even {
    fmt.Println(val) // 4, 16
}
```

---

## 10. Rate Limiting

### 10.1 Token Bucket with time.Ticker

```go
func rateLimited(ctx context.Context, requests <-chan Request) {
    limiter := time.NewTicker(100 * time.Millisecond) // 10 req/s
    defer limiter.Stop()

    for {
        select {
        case <-limiter.C:
            select {
            case req, ok := <-requests:
                if !ok {
                    return
                }
                handle(req)
            case <-ctx.Done():
                return
            }
        case <-ctx.Done():
            return
        }
    }
}
```

### 10.2 Semaphore with Buffered Channel

```go
sem := make(chan struct{}, 10) // max 10 concurrent

for _, task := range tasks {
    sem <- struct{}{} // acquire
    go func() {
        defer func() { <-sem }() // release
        process(task)
    }()
}
```

---

## 11. Container-Aware GOMAXPROCS (Go 1.25+)

Since Go 1.25, the runtime automatically adjusts `GOMAXPROCS` to respect cgroup CPU limits:

```go
// In Docker/Kubernetes with CPU limits, Go auto-adjusts.
// If your container has a 2-CPU limit, GOMAXPROCS defaults to 2.

// You generally don't need to do anything. But if you previously set it manually:

// WRONG (Go 1.25+): hardcoded value ignores container limits
runtime.GOMAXPROCS(runtime.NumCPU())

// CORRECT: let the runtime handle it (default behavior)
// Or reset to default if previously overridden:
runtime.SetDefaultGOMAXPROCS()
```

**Key details:**
- Considers cgroup **CPU limits** (not requests) on Linux
- Dynamically updates if available CPUs or limits change
- Disable with `GODEBUG=containermaxprocs=0` if needed

---

## 12. Testing Concurrent Code with synctest (Go 1.25+)

The `testing/synctest` package provides deterministic testing of concurrent code with virtualized time:

```go
import "testing/synctest"

func TestDebounce(t *testing.T) {
    synctest.Test(t, func(ctx context.Context) {
        var count int
        debounced := NewDebouncer(100*time.Millisecond, func() {
            count++
        })

        debounced.Trigger()
        debounced.Trigger()
        debounced.Trigger()

        // Wait for all goroutines to block (time advances instantly)
        synctest.Wait()

        // Time hasn't passed yet — debounce timer waiting
        if count != 0 {
            t.Fatalf("expected 0, got %d", count)
        }

        // Advance past debounce window
        time.Sleep(150 * time.Millisecond) // instant in synctest
        synctest.Wait()

        if count != 1 {
            t.Fatalf("expected 1, got %d", count)
        }
    })
}
```

**Why synctest matters:**
- No more flaky tests with `time.Sleep` and race conditions
- Time advances instantly when all goroutines are blocked
- Deterministic — same result every run
- Use for: timers, debounce, rate limiters, timeouts, polling

---

## 13. Common Mistakes

### 11.1 Goroutine Leak — No Exit Path

```go
// LEAK: goroutine runs forever
go func() {
    for {
        data := <-ch // blocks forever if ch is never closed
        process(data)
    }
}()
```

### 11.2 Race Condition — Unsynchronized Map Access

```go
// DATA RACE: concurrent map writes
m := make(map[string]int)
go func() { m["a"] = 1 }()
go func() { m["b"] = 2 }()
```

### 11.3 Deadlock — Both Sides Blocking

```go
// DEADLOCK: unbuffered channel, same goroutine
ch := make(chan int)
ch <- 1        // blocks: no receiver
val := <-ch    // never reached
```

### 11.4 Closing a Channel Twice

```go
// PANIC: close of closed channel
close(ch)
close(ch)

// Rule: only the sender closes. Close once. Use sync.Once if needed.
```
