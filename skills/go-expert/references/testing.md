# Testing

Patterns de teste em Go para produção. Table-driven tests, benchmarks, fuzzing, test doubles e httptest.

---

## Table of Contents

1. [Table-Driven Tests](#1-table-driven-tests)
2. [Subtests & Parallel](#2-subtests--parallel)
3. [Test Helpers](#3-test-helpers)
4. [HTTP Handler Testing](#4-http-handler-testing)
5. [Test Doubles (Fakes, Stubs, Mocks)](#5-test-doubles)
6. [Integration Tests](#6-integration-tests)
7. [Benchmarks](#7-benchmarks)
8. [Fuzzing](#8-fuzzing)
9. [Testable Examples](#9-testable-examples)
10. [Golden Files](#10-golden-files)
11. [Best Practices](#11-best-practices)

---

## 1. Table-Driven Tests

The standard Go testing pattern — every test should default to this:

```go
func TestParseStatus(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    Status
        wantErr bool
    }{
        {name: "valid active", input: "active", want: StatusActive},
        {name: "valid pending", input: "pending", want: StatusPending},
        {name: "empty string", input: "", wantErr: true},
        {name: "unknown value", input: "xyz", wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseStatus(tt.input)
            if tt.wantErr {
                if err == nil {
                    t.Fatal("expected error, got nil")
                }
                return
            }
            if err != nil {
                t.Fatalf("unexpected error: %v", err)
            }
            if got != tt.want {
                t.Errorf("got %v, want %v", got, tt.want)
            }
        })
    }
}
```

---

## 2. Subtests & Parallel

### 2.1 Parallel Tests

```go
func TestUserValidation(t *testing.T) {
    t.Parallel() // mark test as parallel-safe

    tests := []struct {
        name    string
        user    User
        wantErr bool
    }{
        {name: "valid", user: User{Name: "John", Email: "j@x.com"}},
        {name: "missing name", user: User{Email: "j@x.com"}, wantErr: true},
        {name: "missing email", user: User{Name: "John"}, wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // each subtest also parallel
            err := tt.user.Validate()
            if (err != nil) != tt.wantErr {
                t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### 2.2 Grouped Subtests

```go
func TestStore(t *testing.T) {
    db := setupTestDB(t)
    store := NewStore(db)

    t.Run("Create", func(t *testing.T) {
        err := store.Create(context.Background(), &User{Name: "John"})
        if err != nil {
            t.Fatalf("Create: %v", err)
        }
    })

    t.Run("FindByID", func(t *testing.T) {
        user, err := store.FindByID(context.Background(), "1")
        if err != nil {
            t.Fatalf("FindByID: %v", err)
        }
        if user.Name != "John" {
            t.Errorf("got %q, want %q", user.Name, "John")
        }
    })
}
```

---

## 3. Test Helpers

### 3.1 t.Helper() for Clean Stack Traces

```go
func assertNoError(t *testing.T, err error) {
    t.Helper() // marks this as helper — errors point to caller
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

### 3.2 t.Cleanup() for Resource Cleanup

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()

    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("opening db: %v", err)
    }

    t.Cleanup(func() {
        db.Close()
    })

    // Run migrations
    if _, err := db.Exec(schema); err != nil {
        t.Fatalf("migrating: %v", err)
    }

    return db
}
```

### 3.3 t.TempDir() for Temporary Files

```go
func TestWriteConfig(t *testing.T) {
    dir := t.TempDir() // auto-cleaned after test
    path := filepath.Join(dir, "config.json")

    err := WriteConfig(path, cfg)
    if err != nil {
        t.Fatalf("writing config: %v", err)
    }

    data, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("reading config: %v", err)
    }
    // assert contents...
}
```

---

## 4. HTTP Handler Testing

### 4.1 httptest.NewRequest + httptest.NewRecorder

```go
func TestUserHandler(t *testing.T) {
    store := &FakeUserStore{
        users: map[string]*User{
            "1": {ID: "1", Name: "John"},
        },
    }
    handler := NewUserHandler(store)

    req := httptest.NewRequest("GET", "/users/1", nil)
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    if w.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
    }

    var got User
    if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
        t.Fatalf("decoding response: %v", err)
    }
    if got.Name != "John" {
        t.Errorf("name = %q, want %q", got.Name, "John")
    }
}
```

### 4.2 httptest.NewServer for Integration

```go
func TestAPIClient(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
    }))
    defer srv.Close()

    client := NewAPIClient(srv.URL)
    status, err := client.HealthCheck()
    if err != nil {
        t.Fatalf("health check: %v", err)
    }
    if status != "ok" {
        t.Errorf("status = %q, want %q", status, "ok")
    }
}
```

### 4.3 Testing Middleware

```go
func TestAuthMiddleware(t *testing.T) {
    inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    handler := AuthMiddleware("secret-token")(inner)

    t.Run("valid token", func(t *testing.T) {
        req := httptest.NewRequest("GET", "/", nil)
        req.Header.Set("Authorization", "Bearer secret-token")
        w := httptest.NewRecorder()
        handler.ServeHTTP(w, req)
        if w.Code != http.StatusOK {
            t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
        }
    })

    t.Run("missing token", func(t *testing.T) {
        req := httptest.NewRequest("GET", "/", nil)
        w := httptest.NewRecorder()
        handler.ServeHTTP(w, req)
        if w.Code != http.StatusUnauthorized {
            t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
        }
    })
}
```

---

## 5. Test Doubles

### 5.1 Fakes (Preferred in Go)

Hand-written implementations that satisfy the interface:

```go
type FakeUserStore struct {
    users map[string]*User
    err   error // force errors for testing
}

func (f *FakeUserStore) FindByID(ctx context.Context, id string) (*User, error) {
    if f.err != nil {
        return nil, f.err
    }
    u, ok := f.users[id]
    if !ok {
        return nil, ErrNotFound
    }
    return u, nil
}

func (f *FakeUserStore) Create(ctx context.Context, u *User) error {
    if f.err != nil {
        return f.err
    }
    f.users[u.ID] = u
    return nil
}
```

### 5.2 Test with Forced Errors

```go
func TestHandlerStoreError(t *testing.T) {
    store := &FakeUserStore{
        err: fmt.Errorf("database down"),
    }
    handler := NewUserHandler(store)

    req := httptest.NewRequest("GET", "/users/1", nil)
    w := httptest.NewRecorder()
    handler.ServeHTTP(w, req)

    if w.Code != http.StatusInternalServerError {
        t.Errorf("status = %d, want %d", w.Code, http.StatusInternalServerError)
    }
}
```

### 5.3 When to Use testify

For complex assertions, testify/assert reduces boilerplate:

```go
import "github.com/stretchr/testify/assert"

func TestUser(t *testing.T) {
    user, err := store.FindByID(ctx, "1")
    assert.NoError(t, err)
    assert.Equal(t, "John", user.Name)
    assert.NotNil(t, user.CreatedAt)
}
```

Use testify/require for fatal assertions (stops test immediately):

```go
import "github.com/stretchr/testify/require"

func TestUser(t *testing.T) {
    user, err := store.FindByID(ctx, "1")
    require.NoError(t, err) // stops here if error
    assert.Equal(t, "John", user.Name)
}
```

---

## 6. Integration Tests

### 6.1 Build Tags for Separation

```go
//go:build integration

package store_test

func TestStoreIntegration(t *testing.T) {
    db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
    // ...
}
```

```bash
# Run unit tests only (default)
go test ./...

# Run integration tests
go test -tags=integration ./...
```

### 6.2 TestMain for Setup/Teardown

```go
func TestMain(m *testing.M) {
    // Setup
    db = setupTestDB()

    code := m.Run()

    // Teardown
    db.Close()
    os.Exit(code)
}
```

---

## 7. Benchmarks

### 7.1 Basic Benchmark

```go
func BenchmarkParseJSON(b *testing.B) {
    data := []byte(`{"name":"John","age":30}`)

    for b.Loop() {
        var u User
        json.Unmarshal(data, &u)
    }
}
```

```bash
go test -bench=. -benchmem ./...
# BenchmarkParseJSON-8   5000000   320 ns/op   128 B/op   3 allocs/op
```

### 7.2 Benchmark with Different Sizes

```go
func BenchmarkSort(b *testing.B) {
    for _, size := range []int{10, 100, 1000, 10000} {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            data := make([]int, size)
            for i := range data {
                data[i] = rand.Intn(size)
            }
            b.ResetTimer()
            for b.Loop() {
                sorted := slices.Clone(data)
                slices.Sort(sorted)
            }
        })
    }
}
```

### 7.3 Avoiding Compiler Optimization

```go
var result int // package-level to prevent optimization

func BenchmarkCompute(b *testing.B) {
    var r int
    for b.Loop() {
        r = compute(42)
    }
    result = r
}
```

---

## 8. Fuzzing

Go 1.18+ built-in fuzzing:

```go
func FuzzParseStatus(f *testing.F) {
    // Seed corpus
    f.Add("active")
    f.Add("pending")
    f.Add("")
    f.Add("ACTIVE")

    f.Fuzz(func(t *testing.T, input string) {
        status, err := ParseStatus(input)
        if err != nil {
            return // invalid input is expected
        }
        // Property: parsed status should round-trip
        if status.String() == "" {
            t.Errorf("parsed status has empty string representation")
        }
    })
}
```

```bash
go test -fuzz=FuzzParseStatus -fuzztime=30s ./...
```

---

## 9. Testable Examples

Examples that appear in documentation and run as tests:

```go
func ExampleNewServer() {
    srv := NewServer(":8080", WithTimeout(5*time.Second))
    fmt.Println(srv.Addr())
    // Output: :8080
}
```

---

## 10. Golden Files

For testing complex output (JSON, HTML, etc.):

```go
var update = flag.Bool("update", false, "update golden files")

func TestRenderTemplate(t *testing.T) {
    got := renderTemplate(testData)

    golden := filepath.Join("testdata", t.Name()+".golden")
    if *update {
        os.WriteFile(golden, []byte(got), 0o644)
        return
    }

    want, err := os.ReadFile(golden)
    if err != nil {
        t.Fatalf("reading golden file: %v", err)
    }
    if got != string(want) {
        t.Errorf("output mismatch:\ngot:\n%s\nwant:\n%s", got, want)
    }
}
```

```bash
# Update golden files
go test -run TestRenderTemplate -update ./...
```

---

## 11. Testing Concurrent Code with synctest (Go 1.25+)

Deterministic testing of concurrent code with virtualized time:

```go
import "testing/synctest"

func TestWorkerPool(t *testing.T) {
    synctest.Test(t, func(ctx context.Context) {
        results := make(chan int, 10)

        // Start workers
        var wg sync.WaitGroup
        for range 3 {
            wg.Go(func() {
                results <- compute()
            })
        }

        // Wait for all goroutines to reach a blocking point
        synctest.Wait()

        // All workers completed — collect results
        wg.Wait()
        close(results)

        var total int
        for r := range results {
            total += r
        }
        if total != expectedTotal {
            t.Errorf("got %d, want %d", total, expectedTotal)
        }
    })
}

func TestTimeout(t *testing.T) {
    synctest.Test(t, func(ctx context.Context) {
        ch := make(chan string)

        go func() {
            time.Sleep(10 * time.Second) // instant in synctest
            ch <- "done"
        }()

        select {
        case msg := <-ch:
            if msg != "done" {
                t.Errorf("unexpected: %s", msg)
            }
        case <-time.After(30 * time.Second): // also instant
            t.Fatal("timeout")
        }
    })
}
```

**When to use:**
- Timers, debounce, rate limiters, timeouts
- Worker pools, pipelines, fan-out/fan-in
- Any code with `time.Sleep`, `time.After`, `time.Ticker`
- Replaces flaky tests that used real `time.Sleep`

---

## 12. Test Artifacts and Attributes (Go 1.25-1.26)

### 12.1 ArtifactDir (Go 1.26)

Save test artifacts (screenshots, logs, debug output) to a persistent directory:

```go
func TestRender(t *testing.T) {
    output := render(testData)

    // Save artifact for inspection
    dir := t.ArtifactDir()
    os.WriteFile(filepath.Join(dir, "output.html"), []byte(output), 0o644)

    // Assert
    if !strings.Contains(output, "<h1>") {
        t.Error("missing h1 tag")
    }
}
```

```bash
# Run with -artifacts to persist artifacts
go test -artifacts ./...
```

### 12.2 Attr (Go 1.25)

Emit structured key-value attributes from tests:

```go
func TestPerformance(t *testing.T) {
    start := time.Now()
    result := process(largeDataset)
    elapsed := time.Since(start)

    t.Attr("duration_ms", fmt.Sprintf("%d", elapsed.Milliseconds()))
    t.Attr("items_processed", fmt.Sprintf("%d", len(result)))

    if elapsed > 5*time.Second {
        t.Errorf("too slow: %v", elapsed)
    }
}
```

With `-json` flag, attributes appear as `"attr"` actions in JSON output.

---

## 13. Best Practices

| Practice | Why |
|---|---|
| Test behavior, not implementation | Tests survive refactoring |
| Use `t.Helper()` on all test helpers | Stack traces point to callers |
| Use `t.Cleanup()` over `defer` | Runs even if test calls `t.Fatal` |
| Prefer fakes over mocks | Simpler, no mock framework dependency |
| Use `t.Parallel()` for independent tests | Faster test suite |
| Name test cases descriptively | `t.Run("empty input returns error", ...)` |
| Keep tests in same package | Access unexported functions when needed |
| Use `_test` package for black-box tests | `package foo_test` tests only public API |
| Put test data in `testdata/` | Go tooling ignores this directory |
| Run `go vet` and `go test -race` in CI | Catch bugs early |

### Running Tests

```bash
go test ./...                    # All tests
go test -v ./internal/store/     # Verbose, specific package
go test -run TestUser ./...      # Pattern match
go test -race ./...              # Race detector
go test -count=1 ./...           # Disable test caching
go test -cover ./...             # Coverage report
go test -coverprofile=cover.out && go tool cover -html=cover.out  # HTML coverage
```
