# Performance

Profiling, otimização e análise de performance em Go.

---

## Table of Contents

1. [Profiling com pprof](#1-profiling-com-pprof)
2. [Escape Analysis](#2-escape-analysis)
3. [Reduzindo Alocações](#3-reduzindo-alocacoes)
4. [sync.Pool](#4-syncpool)
5. [Strings e Bytes](#5-strings-e-bytes)
6. [JSON Performance](#6-json-performance)
7. [Benchmarking Efetivo](#7-benchmarking-efetivo)
8. [Memory Layout](#8-memory-layout)
9. [Concurrency Performance](#9-concurrency-performance)
10. [Quick Wins](#10-quick-wins)

---

## 0. Runtime Performance (Go 1.25-1.26)

Before optimizing your code, know what the runtime already does for you:

### Green Tea Garbage Collector (Default since Go 1.26)

- **10-40% reduction in GC overhead** — enabled by default, no action needed
- Improves small object marking/scanning via better locality and CPU scalability
- Modern CPUs (Intel Ice Lake+, AMD Zen 4+) get additional ~10% via vector instructions
- Disable (if needed): `GOEXPERIMENT=nogreenteagc`

### Container-Aware GOMAXPROCS (Go 1.25+)

- Runtime auto-adjusts `GOMAXPROCS` to cgroup CPU limits (Kubernetes, Docker)
- No need to use third-party `automaxprocs` libraries anymore
- If container has 2-CPU limit, `GOMAXPROCS` defaults to 2 (not host CPU count)
- Dynamically updates if limits change at runtime

```go
// DON'T: hardcode GOMAXPROCS in containerized apps
runtime.GOMAXPROCS(4)

// DO: let the runtime handle it (default behavior since 1.25)
// Or reset to default if previously overridden:
runtime.SetDefaultGOMAXPROCS()
```

### cgo Overhead Reduction (Go 1.26)

- Baseline cgo call overhead reduced by ~30%
- No code changes needed

### Stack-Allocated Slices (Go 1.25-1.26)

- Compiler allocates more slice backing stores on the stack
- Reduces GC pressure automatically for short-lived slices

### io.ReadAll ~2x Faster (Go 1.26)

- `io.ReadAll()` is ~2x faster and uses ~50% less memory
- Returns minimally-sized final slice
- No code changes needed

### Goroutine Leak Profile (Go 1.26, Experimental)

Detect leaked goroutines in production:

```go
import _ "net/http/pprof"

// Enable with: GOEXPERIMENT=goroutineleakprofile
// Access: /debug/pprof/goroutineleak
// Detects goroutines blocked on unreachable concurrency primitives
```

---

## 1. Profiling com pprof

### 1.1 HTTP Profiling Endpoint

```go
import _ "net/http/pprof"

// Add to main — exposes /debug/pprof/
go http.ListenAndServe(":6060", nil)
```

```bash
# CPU profile (30 seconds)
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# Memory profile
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine profile
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Interactive commands inside pprof
(pprof) top 20          # top 20 functions by CPU/memory
(pprof) list funcName   # source-annotated view
(pprof) web             # open graph in browser
```

### 1.2 Profiling in Tests

```bash
# CPU profile
go test -cpuprofile=cpu.out -bench=. ./...
go tool pprof cpu.out

# Memory profile
go test -memprofile=mem.out -bench=. ./...
go tool pprof mem.out

# Trace
go test -trace=trace.out ./...
go tool trace trace.out
```

### 1.3 Programmatic Profiling

```go
import "runtime/pprof"

f, _ := os.Create("cpu.prof")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()

// ... code to profile ...
```

---

## 2. Escape Analysis

The compiler decides whether a variable lives on the stack (fast, auto-freed) or escapes to the heap (slower, GC-managed).

### 2.1 View Escape Decisions

```bash
go build -gcflags="-m" ./...
# Output: ./main.go:15:2: moved to heap: x

go build -gcflags="-m -m" ./...  # More detail
```

### 2.2 Common Escape Causes

```go
// ESCAPES: returning pointer to local variable
func newUser() *User {
    u := User{Name: "John"} // escapes to heap
    return &u
}

// STAYS ON STACK: value return
func newUser() User {
    return User{Name: "John"} // stays on stack
}

// ESCAPES: interface boxing
func log(v any) { fmt.Println(v) }
func main() {
    x := 42
    log(x) // x escapes — boxed into interface
}

// ESCAPES: closure captures
func process() func() int {
    x := 42
    return func() int { return x } // x escapes
}

// ESCAPES: slice append may grow
func collect() []int {
    s := make([]int, 0) // may escape if grows
    s = append(s, 1)
    return s
}
```

### 2.3 Avoiding Unnecessary Heap Allocations

```go
// HOT PATH: pass by value for small structs (< 64 bytes)
type Point struct { X, Y float64 }
func distance(a, b Point) float64 { // value — stack
    dx := a.X - b.X
    dy := a.Y - b.Y
    return math.Sqrt(dx*dx + dy*dy)
}

// HOT PATH: accept []byte instead of string to avoid copies
func hash(data []byte) uint64 { /* ... */ }
```

---

## 3. Reduzindo Alocações

### 3.1 Preallocate Slices

```go
// BAD: multiple growths
var result []string
for _, u := range users {
    result = append(result, u.Name)
}

// GOOD: single allocation
result := make([]string, 0, len(users))
for _, u := range users {
    result = append(result, u.Name)
}
```

### 3.2 Preallocate Maps

```go
m := make(map[string]int, len(items))
```

### 3.3 Reuse Buffers

```go
// BAD: allocates every call
func encode(v any) ([]byte, error) {
    var buf bytes.Buffer
    err := json.NewEncoder(&buf).Encode(v)
    return buf.Bytes(), err
}

// GOOD: reuse with sync.Pool (see section 4)
```

### 3.4 Use Append to Avoid String Concatenation

```go
// BAD
s := "hello" + " " + "world" + "!" // 3 allocations

// GOOD for known values
s := fmt.Sprintf("hello %s!", name) // 1 allocation

// GOOD for loops — see strings.Builder in section 5
```

---

## 4. sync.Pool

Reuse expensive-to-allocate objects. Pool is GC-aware — items may be collected.

### 4.1 Buffer Pool

```go
var bufPool = sync.Pool{
    New: func() any {
        return new(bytes.Buffer)
    },
}

func process(data []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()

    buf.WriteString("prefix:")
    buf.Write(data)
    return buf.String()
}
```

### 4.2 Encoder Pool

```go
var encoderPool = sync.Pool{
    New: func() any {
        return &bytes.Buffer{}
    },
}

func writeJSON(w http.ResponseWriter, v any) {
    buf := encoderPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        encoderPool.Put(buf)
    }()

    if err := json.NewEncoder(buf).Encode(v); err != nil {
        http.Error(w, "encode error", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.Write(buf.Bytes())
}
```

---

## 5. Strings e Bytes

### 5.1 strings.Builder for Concatenation

```go
var b strings.Builder
b.Grow(estimatedSize) // preallocate
for _, s := range parts {
    b.WriteString(s)
}
result := b.String()
```

### 5.2 Avoid string ↔ []byte Conversions

Each conversion allocates. In hot paths, work with `[]byte` directly:

```go
// BAD: 2 conversions
func processString(s string) string {
    b := []byte(s)      // alloc
    // modify b...
    return string(b)    // alloc
}

// GOOD: work with bytes throughout
func processBytes(b []byte) []byte {
    // modify in place
    return b
}
```

### 5.3 Unsafe String ↔ Bytes (Zero-Copy)

Only for read-only use in hot paths where profiling shows the conversion matters:

```go
import "unsafe"

func unsafeString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func unsafeBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

---

## 6. JSON Performance

### 6.1 Standard Library Tips

```go
// Reuse decoders
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()

// Reuse encoders with buffer pool (see section 4)
```

### 6.2 High-Performance Alternatives

When profiling shows JSON is a bottleneck:

```go
// sonic — drop-in replacement, 2-5x faster
import "github.com/bytedance/sonic"

data, err := sonic.Marshal(v)
err = sonic.Unmarshal(data, &v)

// go-json — compatible API
import "github.com/goccy/go-json"
```

### 6.3 Streaming Large JSON

```go
// Don't load entire array into memory
dec := json.NewDecoder(file)
dec.Token() // read opening [
for dec.More() {
    var item Item
    if err := dec.Decode(&item); err != nil {
        return err
    }
    process(item)
}
dec.Token() // read closing ]
```

---

## 7. Benchmarking Efetivo

### 7.1 Compare Implementations

```bash
# Save baseline
go test -bench=. -benchmem -count=5 ./... > old.txt

# Make changes, then compare
go test -bench=. -benchmem -count=5 ./... > new.txt

# Compare with benchstat
go install golang.org/x/perf/cmd/benchstat@latest
benchstat old.txt new.txt
```

### 7.2 Benchmark Checklist

- Run with `-count=5` or more for statistical significance
- Use `-benchmem` to see allocations
- Use `b.ReportAllocs()` in the benchmark
- Use `b.ResetTimer()` after setup code
- Watch for compiler optimizing away work (assign to package-level var)

---

## 8. Memory Layout

### 8.1 Struct Field Ordering

Fields are padded to align. Order by size (largest first) to minimize padding:

```go
// BAD: 32 bytes (with padding)
type Bad struct {
    a bool    // 1 byte + 7 padding
    b int64   // 8 bytes
    c bool    // 1 byte + 7 padding
    d int64   // 8 bytes
}

// GOOD: 24 bytes (no wasted padding)
type Good struct {
    b int64   // 8 bytes
    d int64   // 8 bytes
    a bool    // 1 byte
    c bool    // 1 byte + 6 padding
}
```

Check struct sizes:

```go
fmt.Println(unsafe.Sizeof(Bad{}))  // 32
fmt.Println(unsafe.Sizeof(Good{})) // 24
```

---

## 9. Concurrency Performance

### 9.1 Avoid Lock Contention

```go
// BAD: global lock
var mu sync.Mutex
var cache map[string]any

// GOOD: sharded cache
type ShardedCache struct {
    shards [256]struct {
        mu    sync.RWMutex
        items map[string]any
    }
}

func (c *ShardedCache) shard(key string) *struct {
    mu    sync.RWMutex
    items map[string]any
} {
    h := fnv.New32a()
    h.Write([]byte(key))
    return &c.shards[h.Sum32()%256]
}
```

### 9.2 Use atomic for Counters

```go
// BAD: mutex for a counter
var mu sync.Mutex
var count int

// GOOD: atomic
var count atomic.Int64
count.Add(1)
```

### 9.3 Batch Work to Reduce Channel Overhead

```go
// BAD: one item per channel send
for _, item := range items {
    ch <- item
}

// GOOD: batch items
batch := make([]Item, 0, batchSize)
for _, item := range items {
    batch = append(batch, item)
    if len(batch) >= batchSize {
        ch <- batch
        batch = make([]Item, 0, batchSize)
    }
}
if len(batch) > 0 {
    ch <- batch
}
```

---

## 10. Quick Wins

| Optimization | Impact | Effort |
|---|---|---|
| Preallocate slices/maps with `make(T, 0, n)` | Medium | Low |
| Use `strings.Builder` for concatenation | Medium | Low |
| Use `sync.Pool` for frequently allocated buffers | High | Low |
| Order struct fields by size | Low-Medium | Low |
| Use `[]byte` instead of `string` in hot paths | Medium | Medium |
| Use `atomic` instead of `Mutex` for counters | Medium | Low |
| Use `slog` instead of `fmt.Printf` for logging | Low | Low |
| Profile before optimizing (`go tool pprof`) | — | Medium |
| Use `-benchmem` to find allocation hotspots | — | Low |
| Set `GOMAXPROCS` appropriately in containers | Medium | Low |
