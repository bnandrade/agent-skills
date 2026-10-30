# Idioms & Patterns

Go idiomático para código de produção. Cada pattern inclui exemplos incorretos e corretos.

---

## Table of Contents

1. [Error Handling Patterns](#1-error-handling-patterns)
2. [Interfaces](#2-interfaces)
3. [Composition & Embedding](#3-composition--embedding)
4. [Zero Values](#4-zero-values)
5. [Option Patterns](#5-option-patterns)
6. [Enums & Sentinel Values](#6-enums--sentinel-values)
7. [Type Assertions & Switches](#7-type-assertions--switches)
8. [Slice & Map Idioms](#8-slice--map-idioms)
9. [String Handling](#9-string-handling)
10. [Package Design](#10-package-design)

---

## 1. Error Handling Patterns

### 1.1 Wrap with Operation Context

Every error return should describe what was being attempted:

```go
// Pattern: "verb + object: %w"
func (s *Store) FindUser(id string) (*User, error) {
    row := s.db.QueryRow("SELECT name, email FROM users WHERE id = ?", id)
    var u User
    if err := row.Scan(&u.Name, &u.Email); err != nil {
        return nil, fmt.Errorf("finding user %s: %w", id, err)
    }
    return &u, nil
}
```

### 1.2 Custom Error Types

Use custom errors when callers need to inspect error details:

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s %s", e.Field, e.Message)
}

// Caller checks with errors.As
var ve *ValidationError
if errors.As(err, &ve) {
    http.Error(w, ve.Message, http.StatusBadRequest)
}
```

### 1.3 Generic Error Matching (Go 1.26+)

`errors.AsType[T]()` is the type-safe, generic alternative to `errors.As`:

```go
// BEFORE (pre-1.26): verbose, requires var declaration
var ve *ValidationError
if errors.As(err, &ve) {
    fmt.Println(ve.Field)
}

// AFTER (Go 1.26+): generic, concise, type-safe
if ve, ok := errors.AsType[*ValidationError](err); ok {
    fmt.Println(ve.Field)
}
```

Prefer `errors.AsType` in new code — it's cleaner, avoids the `var` boilerplate, and the compiler catches type mismatches.

### 1.4 Sentinel Errors

Use package-level errors for expected conditions:

```go
var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
    ErrConflict     = errors.New("conflict")
)

// Caller checks with errors.Is
if errors.Is(err, ErrNotFound) {
    http.Error(w, "resource not found", http.StatusNotFound)
}
```

### 1.5 Error Handling in Cleanup

```go
func writeFile(path string, data []byte) (retErr error) {
    f, err := os.Create(path)
    if err != nil {
        return fmt.Errorf("creating %s: %w", path, err)
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && retErr == nil {
            retErr = fmt.Errorf("closing %s: %w", path, cerr)
        }
    }()

    if _, err := f.Write(data); err != nil {
        return fmt.Errorf("writing %s: %w", path, err)
    }
    return nil
}
```

### 1.6 Multi-error Collection

```go
func validate(u User) error {
    var errs []error
    if u.Name == "" {
        errs = append(errs, fmt.Errorf("name is required"))
    }
    if u.Email == "" {
        errs = append(errs, fmt.Errorf("email is required"))
    }
    return errors.Join(errs...)
}
```

---

## 2. Interfaces

### 2.1 Keep Interfaces Small

```go
// GOOD: focused, composable
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

type ReadWriter interface {
    Reader
    Writer
}

// BAD: kitchen sink interface
type DataManager interface {
    Read(p []byte) (n int, err error)
    Write(p []byte) (n int, err error)
    Close() error
    Flush() error
    Seek(offset int64, whence int) (int64, error)
    Stat() (FileInfo, error)
    Truncate(size int64) error
}
```

### 2.2 Accept Interfaces, Return Structs

```go
// GOOD: accepts interface — flexible for callers
func ProcessData(r io.Reader) error {
    data, err := io.ReadAll(r)
    // ...
}

// GOOD: returns concrete type — callers can see full API
func NewUserService(store UserStore) *UserService {
    return &UserService{store: store}
}

// BAD: returns interface — hides available methods
func NewUserService(store UserStore) Service {
    return &UserService{store: store}
}
```

### 2.3 Define Interfaces Where They're Used (Consumer Side)

```go
// In the consumer package, not the provider:

// package handler
type UserFinder interface {
    FindByID(ctx context.Context, id string) (*user.User, error)
}

type Handler struct {
    users UserFinder
}

// The store package just implements methods — no interface needed there
// package store
type Store struct { db *sql.DB }

func (s *Store) FindByID(ctx context.Context, id string) (*user.User, error) {
    // ...
}
```

### 2.4 Implicit Interface Satisfaction

Go interfaces are satisfied implicitly — no `implements` keyword. Verify at compile time:

```go
// Compile-time check that *Store satisfies UserFinder
var _ UserFinder = (*Store)(nil)
```

---

## 3. Composition & Embedding

### 3.1 Struct Embedding for Reuse

```go
type BaseModel struct {
    ID        string
    CreatedAt time.Time
    UpdatedAt time.Time
}

type User struct {
    BaseModel // embedded — User "has" BaseModel fields
    Name      string
    Email     string
}

u := User{
    BaseModel: BaseModel{
        ID:        "123",
        CreatedAt: time.Now(),
    },
    Name:  "John",
    Email: "john@example.com",
}
// Access promoted fields directly
fmt.Println(u.ID, u.CreatedAt)
```

### 3.2 Interface Embedding

```go
type ReadCloser interface {
    io.Reader
    io.Closer
}
```

### 3.3 Embedding for Delegation (Middleware Pattern)

```go
type LoggingStore struct {
    UserStore        // embed the interface
    logger    *slog.Logger
}

func (s *LoggingStore) FindByID(ctx context.Context, id string) (*User, error) {
    s.logger.Info("finding user", "id", id)
    return s.UserStore.FindByID(ctx, id) // delegate
}
```

---

## 4. Zero Values

### 4.1 Design Structs with Useful Zero Values

```go
// GOOD: zero value is ready to use
type Counter struct {
    mu sync.Mutex
    n  int // zero is valid starting count
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

// No constructor needed:
var c Counter
c.Inc()
```

```go
// GOOD: sync.Once for lazy initialization
type Client struct {
    once sync.Once
    conn net.Conn
}

func (c *Client) connect() {
    c.once.Do(func() {
        c.conn, _ = net.Dial("tcp", "localhost:8080")
    })
}
```

### 4.2 Use Pointer for Optional Fields

```go
type UpdateRequest struct {
    Name  *string `json:"name,omitempty"`  // nil = not provided, "" = clear
    Email *string `json:"email,omitempty"`
}
```

### 4.3 new() with Expressions (Go 1.26+)

The built-in `new` now accepts expressions, making pointer fields much cleaner:

```go
// BEFORE: needed a temp variable or helper function
age := 30
req := UpdateRequest{Age: &age}

// or a helper
func ptr[T any](v T) *T { return &v }
req := UpdateRequest{Age: ptr(30)}

// AFTER (Go 1.26+): direct initialization
req := UpdateRequest{Age: new(30)}

// Works with any expression
type Config struct {
    Timeout *time.Duration `json:"timeout,omitempty"`
}
cfg := Config{Timeout: new(5 * time.Second)}
```

---

## 5. Option Patterns

### 5.1 Functional Options

For constructors with many optional parameters:

```go
type Server struct {
    addr    string
    timeout time.Duration
    logger  *slog.Logger
}

type Option func(*Server)

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func WithLogger(l *slog.Logger) Option {
    return func(s *Server) { s.logger = l }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        addr:    addr,
        timeout: 30 * time.Second,          // sensible default
        logger:  slog.Default(),
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
srv := NewServer(":8080",
    WithTimeout(10*time.Second),
    WithLogger(myLogger),
)
```

### 5.2 Config Struct (Simpler Alternative)

When there are few options or they're all required:

```go
type Config struct {
    Addr    string
    Timeout time.Duration
    Logger  *slog.Logger
}

func NewServer(cfg Config) *Server {
    if cfg.Timeout == 0 {
        cfg.Timeout = 30 * time.Second
    }
    if cfg.Logger == nil {
        cfg.Logger = slog.Default()
    }
    return &Server{
        addr:    cfg.Addr,
        timeout: cfg.Timeout,
        logger:  cfg.Logger,
    }
}
```

---

## 6. Enums & Sentinel Values

### 6.1 Typed Constants with iota

```go
type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusInactive
)

func (s Status) String() string {
    switch s {
    case StatusPending:
        return "pending"
    case StatusActive:
        return "active"
    case StatusInactive:
        return "inactive"
    default:
        return fmt.Sprintf("Status(%d)", s)
    }
}

// Use in structs
type User struct {
    Name   string
    Status Status
}
```

### 6.2 String-Based Enums (For APIs)

```go
type Role string

const (
    RoleAdmin  Role = "admin"
    RoleUser   Role = "user"
    RoleGuest  Role = "guest"
)

func (r Role) Valid() bool {
    switch r {
    case RoleAdmin, RoleUser, RoleGuest:
        return true
    }
    return false
}
```

---

## 7. Type Assertions & Switches

### 7.1 Comma-ok Pattern

```go
// Safe assertion — never panics
if s, ok := val.(string); ok {
    fmt.Println(s)
}

// DANGEROUS: panics if val is not string
s := val.(string)
```

### 7.2 Type Switch

```go
func describe(i interface{}) string {
    switch v := i.(type) {
    case string:
        return fmt.Sprintf("string of length %d", len(v))
    case int:
        return fmt.Sprintf("integer %d", v)
    case error:
        return fmt.Sprintf("error: %s", v.Error())
    default:
        return fmt.Sprintf("unknown type %T", v)
    }
}
```

---

## 8. Slice & Map Idioms

### 8.1 Preallocate When Size is Known

```go
// WRONG: grows dynamically, multiple allocations
var result []string
for _, u := range users {
    result = append(result, u.Name)
}

// CORRECT: single allocation
result := make([]string, 0, len(users))
for _, u := range users {
    result = append(result, u.Name)
}
```

### 8.2 Use slices Package (Go 1.21+)

```go
import "slices"

sorted := slices.Clone(items)
slices.SortFunc(sorted, func(a, b Item) int {
    return strings.Compare(a.Name, b.Name)
})

idx := slices.IndexFunc(users, func(u User) bool {
    return u.Email == target
})

slices.Contains(names, "John")
```

### 8.3 Use maps Package (Go 1.21+)

```go
import "maps"

keys := maps.Keys(m)
values := maps.Values(m)
clone := maps.Clone(m)
```

### 8.4 Map as Set

```go
seen := make(map[string]struct{})
for _, item := range items {
    seen[item.ID] = struct{}{}
}
if _, exists := seen[id]; exists {
    // already processed
}
```

---

## 9. String Handling

### 9.1 Use strings.Builder for Concatenation

```go
// WRONG: O(n^2) — creates new string each iteration
var s string
for _, item := range items {
    s += item.Name + ", "
}

// CORRECT: O(n)
var b strings.Builder
for i, item := range items {
    if i > 0 {
        b.WriteString(", ")
    }
    b.WriteString(item.Name)
}
result := b.String()
```

### 9.2 Use fmt.Sprintf for Formatting, Not Concatenation

```go
// For complex formatting
msg := fmt.Sprintf("user %s (%d) logged in from %s", name, id, ip)

// For simple join, use strings.Join
result := strings.Join(names, ", ")
```

---

## 10. Package Design

### 10.1 Package Names

- Lowercase, single word: `user`, `store`, `config`
- No underscores, no mixedCaps: `httputil` not `http_util` or `httpUtil`
- Avoid stutter: `user.New()` not `user.NewUser()`
- Avoid utility packages: `utils`, `helpers`, `common` — distribute to specific packages

### 10.2 File Organization Within a Package

```
store/
  store.go        // types, constructors, exported API
  queries.go      // SQL queries and data access methods
  migrations.go   // schema migrations
  store_test.go   // tests
```

- One file per concern, not one file per type
- Test files go alongside: `foo.go` → `foo_test.go`
- Keep files under ~500 lines — split by responsibility when they grow

### 10.3 Constructor Pattern

```go
// NewX returns a ready-to-use instance
func NewStore(db *sql.DB, logger *slog.Logger) *Store {
    return &Store{
        db:     db,
        logger: logger,
    }
}

// Dependencies are explicit — no globals, no init()
```

### 10.4 Avoid init()

```go
// BAD: hidden side effect, hard to test
func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

// GOOD: explicit initialization in main
func main() {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
    store := NewStore(db)
    // ...
}
```
