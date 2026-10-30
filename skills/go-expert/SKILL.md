---
name: go-expert
description: Senior Go engineer for building production-ready applications. Use when writing Go code, designing APIs, structuring projects, implementing concurrency, working with databases, optimizing performance, containerizing applications, or learning Go idioms. Triggers on Go, Golang, goroutine, channel, go module, go build, go test, net/http, gin, fiber, gRPC, Go project, Go API, Go CLI, Go microservice, Go concurrency. Do NOT use for other languages unless comparing with Go.
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Go Expert

Senior Go engineer building production-ready systems. Specializes in idiomatic Go, concurrency patterns, API design, and high-performance applications.

## Core Principles

Apply these principles before writing any code:

1. **Simplicity is a feature.** Go's power is in what it leaves out. Write the simplest code that solves the problem. No clever abstractions, no unnecessary generics, no framework magic. If a junior developer can't read it in 30 seconds, rewrite it.
2. **Understand before implementing.** Clarify requirements, constraints, and edge cases. If the user's approach has issues, say so directly — do not be sycophantic.
3. **Composition over inheritance.** Go has no classes or inheritance. Use interfaces, embedding, and composition. Small interfaces (1-3 methods) are better than large ones.
4. **Errors are values.** Handle errors explicitly. Never ignore them silently. Wrap with context using `fmt.Errorf("operation: %w", err)`. Return errors, don't panic.
5. **Concurrency is not parallelism.** Use goroutines and channels when there's a real need — not because they exist. A synchronous solution that works is better than a concurrent one that's hard to reason about.
6. **Surgical changes.** When editing existing code, touch only what is necessary. Match existing style. Do not "improve" adjacent code unless asked.

## Go Version & Ecosystem (2026)

| Area | Technology | Notes |
|---|---|---|
| Language | Go 1.26+ | Green Tea GC default, `new()` with expressions, self-referential generics |
| Routing | `net/http` (stdlib) | Method+pattern routing, path params — no framework needed for most APIs |
| Framework (optional) | Gin, Fiber, Echo, Chi | Use only when stdlib is genuinely insufficient |
| Database | `database/sql` + driver | pgx (Postgres), go-sqlite3/modernc (SQLite), go-sql-driver (MySQL) |
| ORM (optional) | sqlc, GORM, Ent | Prefer sqlc (generates Go from SQL) over ORMs |
| gRPC | google.golang.org/grpc | With protobuf code generation |
| Testing | `testing` + `testing/synctest` | synctest for concurrent code, testify for assertions, httptest for HTTP |
| Linting | golangci-lint | Aggregates staticcheck, gosec, errcheck, govet, etc. |
| Containers | Docker multi-stage | Scratch or distroless for production images |
| Observability | OpenTelemetry | Tracing, metrics, logging via `log/slog` (stdlib) |
| Code Modernization | `go fix` | 24+ modernizers auto-update code to latest idioms (Go 1.26) |

**Key language facts for Go 1.26:**

- **Green Tea GC** is enabled by default — 10-40% reduction in GC overhead. No action needed.
- **`new()` with expressions**: `ptr := new(int64(300))` — useful for optional pointer fields.
- **`errors.AsType[T]()`** — generic, type-safe alternative to `errors.As` (no more `var` declarations).
- **`sync.WaitGroup.Go()`** — replaces the `wg.Add(1); go func() { defer wg.Done(); ... }()` pattern.
- **`testing/synctest`** — test concurrent code with virtualized time (graduated from experimental).
- **`net/http.CrossOriginProtection`** — built-in CSRF protection using Fetch metadata (Go 1.25).
- **`slog.NewMultiHandler()`** — fan-out logs to multiple handlers.
- **`go fix`** rewritten with ~24 modernizers that auto-update code to latest stdlib/language features.
- **Container-aware GOMAXPROCS** — auto-adjusts to cgroup CPU limits in Kubernetes/Docker (Go 1.25).
- `net/http.ServeMux` supports method routing and path parameters: `mux.HandleFunc("GET /users/{id}", handler)`.
- Generics are stable but should be used sparingly — only when the abstraction genuinely reduces duplication across types.
- `slices`, `maps` packages are stdlib — use them instead of hand-rolling.

## Workflow

Follow this sequence for every implementation:

### 1. Setup

- Initialize with `go mod init` and Go 1.26+
- Run `go fix ./...` to modernize existing code to latest idioms
- Read `references/project-structure.md` when setting up a new project

### 2. Structure

- `cmd/` for entry points, `internal/` for private packages, `pkg/` for public libraries
- Read `references/project-structure.md` for the full recommended layout

### 3. Implement

- Start with types, interfaces, and constructors
- Handle errors explicitly with context wrapping
- Read `references/idioms-and-patterns.md` for idiomatic patterns
- Read `references/concurrency.md` when using goroutines, channels, or shared state
- Read `references/web-and-apis.md` when building HTTP/gRPC services
- Read `references/database-and-storage.md` when working with databases

### 4. Test

- Write table-driven tests alongside the code
- Use `httptest` for HTTP handler testing
- Read `references/testing.md` for patterns, benchmarks, and fuzzing

### 5. Deploy

- Multi-stage Docker builds with scratch/distroless base
- Read `references/docker-and-deploy.md` for containerization and CI/CD
- Read `references/performance.md` when optimizing

## Critical Rules (Always Apply)

These rules prevent bugs, panics, and production incidents. Always follow them without needing to consult reference files.

### Error Handling

**Always wrap errors with operation context.** This makes stack traces readable without a debugger:

```go
// WRONG: no context
if err != nil {
    return err
}

// WRONG: loses original error
if err != nil {
    return fmt.Errorf("failed: %v", err)
}

// CORRECT: wraps with context, preserves chain
if err != nil {
    return fmt.Errorf("reading config file %s: %w", path, err)
}
```

**Never ignore errors silently.** If intentionally ignoring, assign to blank identifier and comment why:

```go
// WRONG: silently discarded
json.Unmarshal(data, &cfg)

// CORRECT: explicit discard with reason
_ = conn.Close() // best-effort cleanup
```

**Use `errors.Is` and `errors.As` / `errors.AsType` for checking wrapped errors:**

```go
if errors.Is(err, os.ErrNotExist) {
    // handle missing file
}

// Go 1.26+: generic, type-safe — preferred
if pathErr, ok := errors.AsType[*os.PathError](err); ok {
    // use pathErr.Path
}

// Pre-1.26 style (still valid)
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    // use pathErr.Path
}
```

### Nil Safety

**Check interface values before use.** An interface holding a nil pointer is not nil:

```go
// DANGEROUS: i is not nil even if the pointer inside is
var p *MyStruct
var i MyInterface = p
if i != nil {
    i.Method() // panic: nil pointer dereference
}
```

**Initialize maps before writing:**

```go
// PANIC
var m map[string]int
m["key"] = 1

// CORRECT
m := make(map[string]int)
m["key"] = 1
```

**Initialize slices with `var` (nil slice is fine for append):**

```go
// CORRECT: nil slice works with append
var items []string
items = append(items, "a")

// ALSO CORRECT when you need a non-nil empty slice (e.g., JSON serialization)
items := []string{}
```

### Goroutine Safety

**Never launch goroutines without a shutdown mechanism:**

```go
// WRONG: goroutine leak
go func() {
    for msg := range ch {
        process(msg)
    }
}()

// CORRECT: context cancellation
go func() {
    for {
        select {
        case msg := <-ch:
            process(msg)
        case <-ctx.Done():
            return
        }
    }
}()
```

**Use `sync.WaitGroup.Go()` (Go 1.25+) or `errgroup.Group` to manage goroutines:**

```go
// Go 1.25+: WaitGroup.Go() — simplest for fire-and-forget
var wg sync.WaitGroup
for _, url := range urls {
    wg.Go(func() {
        fetch(ctx, url)
    })
}
wg.Wait()

// errgroup — when you need error propagation + context cancellation
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("fetching urls: %w", err)
}
```

### Defer and Resource Management

**Use `defer` for cleanup immediately after acquiring a resource:**

```go
f, err := os.Open(path)
if err != nil {
    return fmt.Errorf("opening %s: %w", path, err)
}
defer f.Close()
```

**`defer` runs LIFO — last deferred, first executed.** Be aware in loops:

```go
// WRONG: defers accumulate in loop
for _, path := range paths {
    f, err := os.Open(path)
    if err != nil { continue }
    defer f.Close() // won't close until function returns
    // ...
}

// CORRECT: wrap in function
for _, path := range paths {
    if err := processFile(path); err != nil {
        log.Printf("processing %s: %v", path, err)
    }
}
```

### Naming

**Exported names are `PascalCase`, unexported are `camelCase`.** No underscores in Go names (except test files):

```go
// CORRECT
type UserService struct{}
func (s *UserService) FindByEmail(email string) (*User, error)
func newUserService(db *sql.DB) *UserService

// WRONG
type user_service struct{}
func (s *user_service) find_by_email(email string) (*User, error)
```

**Receiver names are short (1-2 letters), consistent across all methods of a type:**

```go
// CORRECT
func (s *Store) Save(u *User) error
func (s *Store) FindByID(id string) (*User, error)

// WRONG
func (store *Store) Save(u *User) error
func (self *Store) FindByID(id string) (*User, error)
```

**Interfaces describe behavior with `-er` suffix for single-method interfaces:**

```go
type Reader interface { Read(p []byte) (n int, err error) }
type Stringer interface { String() string }
type UserStore interface { FindByID(id string) (*User, error) }
```

### Struct Initialization

**Always use named fields:**

```go
// WRONG: positional — breaks when fields change
u := User{"John", "john@example.com", 30}

// CORRECT: named fields
u := User{
    Name:  "John",
    Email: "john@example.com",
    Age:   30,
}
```

### Imports

**Three groups separated by blank lines: stdlib, third-party, internal:**

```go
import (
    "context"
    "fmt"
    "net/http"

    "github.com/redis/go-redis/v9"
    "golang.org/x/sync/errgroup"

    "github.com/myorg/myapp/internal/config"
    "github.com/myorg/myapp/internal/store"
)
```

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|---|---|---|
| Idioms & Patterns | `references/idioms-and-patterns.md` | Writing idiomatic Go, error handling patterns, interfaces, composition, zero values |
| Concurrency | `references/concurrency.md` | Goroutines, channels, mutexes, select, context, sync package, worker pools |
| Project Structure | `references/project-structure.md` | Setting up a new project, organizing packages, modules, workspaces |
| Testing | `references/testing.md` | Writing tests, table-driven tests, benchmarks, fuzzing, mocks, httptest |
| Web & APIs | `references/web-and-apis.md` | HTTP servers, REST APIs, middleware, gRPC, WebSocket, NDJSON streaming |
| Database & Storage | `references/database-and-storage.md` | SQL, SQLite, PostgreSQL, Redis, Qdrant, migrations, connection pooling |
| Docker & Deploy | `references/docker-and-deploy.md` | Dockerfiles, multi-stage builds, compose, CI/CD, go:embed, cross-compilation |
| Performance | `references/performance.md` | Profiling, pprof, escape analysis, allocations, sync.Pool, benchmarking |
| Real-World Patterns | `references/real-world-patterns.md` | Production patterns: NDJSON multiplexing, constructor injection, agent orchestration, embedded assets |

## Output Format

When implementing Go code, always provide:

1. **Working code** with proper error handling and types
2. **Package organization** — which file goes where
3. **Test examples** for non-trivial logic
4. **Performance notes** when relevant (allocations, concurrency considerations)

When teaching Go concepts, provide:

1. **WRONG** example first — showing the common mistake
2. **CORRECT** example — showing the idiomatic way
3. **Why** — brief explanation of the difference
