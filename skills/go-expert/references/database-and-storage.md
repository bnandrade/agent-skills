# Database & Storage

Patterns para trabalhar com bancos de dados e sistemas de armazenamento em Go.

---

## Table of Contents

1. [database/sql Fundamentals](#1-databasesql-fundamentals)
2. [SQLite](#2-sqlite)
3. [PostgreSQL](#3-postgresql)
4. [Connection Management](#4-connection-management)
5. [Query Patterns](#5-query-patterns)
6. [Transactions](#6-transactions)
7. [Migrations](#7-migrations)
8. [sqlc — SQL-First Approach](#8-sqlc)
9. [Redis](#9-redis)
10. [Qdrant (Vector Database)](#10-qdrant)

---

## 1. database/sql Fundamentals

### 1.1 Opening a Connection

```go
import (
    "database/sql"
    _ "github.com/mattn/go-sqlite3" // register driver
)

db, err := sql.Open("sqlite3", "app.db")
if err != nil {
    return fmt.Errorf("opening database: %w", err)
}
defer db.Close()

// Verify connection
if err := db.PingContext(ctx); err != nil {
    return fmt.Errorf("pinging database: %w", err)
}
```

### 1.2 Store Pattern

Wrap `*sql.DB` in a struct to add methods:

```go
type Store struct {
    db *sql.DB
}

func NewStore(db *sql.DB) *Store {
    return &Store{db: db}
}

func (s *Store) FindUserByID(ctx context.Context, id string) (*User, error) {
    var u User
    err := s.db.QueryRowContext(ctx,
        "SELECT id, name, email, created_at FROM users WHERE id = ?", id,
    ).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, ErrNotFound
        }
        return nil, fmt.Errorf("querying user %s: %w", id, err)
    }
    return &u, nil
}
```

---

## 2. SQLite

### 2.1 Drivers

```go
// CGo driver (fastest, requires gcc)
import _ "github.com/mattn/go-sqlite3"
db, err := sql.Open("sqlite3", "file:app.db?_journal_mode=WAL&_busy_timeout=5000")

// Pure Go driver (no CGo, easier cross-compile)
import _ "modernc.org/sqlite"
db, err := sql.Open("sqlite", "file:app.db?_journal_mode=WAL&_busy_timeout=5000")
```

### 2.2 Recommended Pragmas

```go
func configureSQLite(db *sql.DB) error {
    pragmas := []string{
        "PRAGMA journal_mode=WAL",       // Write-Ahead Logging
        "PRAGMA busy_timeout=5000",      // Wait 5s on lock
        "PRAGMA synchronous=NORMAL",     // Good perf/safety balance
        "PRAGMA foreign_keys=ON",        // Enforce foreign keys
        "PRAGMA cache_size=-20000",      // 20MB cache
    }
    for _, p := range pragmas {
        if _, err := db.Exec(p); err != nil {
            return fmt.Errorf("executing %s: %w", p, err)
        }
    }
    return nil
}
```

### 2.3 In-Memory SQLite for Tests

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("opening db: %v", err)
    }
    t.Cleanup(func() { db.Close() })

    if _, err := db.Exec(schema); err != nil {
        t.Fatalf("creating schema: %v", err)
    }
    return db
}
```

---

## 3. PostgreSQL

### 3.1 Using pgx (Preferred Driver)

```go
import (
    "github.com/jackc/pgx/v5/pgxpool"
)

pool, err := pgxpool.New(ctx, "postgres://user:pass@localhost:5432/mydb")
if err != nil {
    return fmt.Errorf("creating pool: %w", err)
}
defer pool.Close()

// Query
var name string
err = pool.QueryRow(ctx, "SELECT name FROM users WHERE id = $1", id).Scan(&name)
```

### 3.2 pgx with database/sql Interface

```go
import (
    "database/sql"
    _ "github.com/jackc/pgx/v5/stdlib"
)

db, err := sql.Open("pgx", "postgres://user:pass@localhost:5432/mydb")
```

---

## 4. Connection Management

### 4.1 Pool Configuration

```go
db.SetMaxOpenConns(25)              // Max concurrent connections
db.SetMaxIdleConns(10)              // Max idle connections
db.SetConnMaxLifetime(5 * time.Minute)  // Recycle connections
db.SetConnMaxIdleTime(1 * time.Minute)  // Close idle connections
```

### 4.2 Health Check

```go
func (s *Store) HealthCheck(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    return s.db.PingContext(ctx)
}
```

---

## 5. Query Patterns

### 5.1 Query Multiple Rows

```go
func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
    rows, err := s.db.QueryContext(ctx, "SELECT id, name, email FROM users ORDER BY name")
    if err != nil {
        return nil, fmt.Errorf("querying users: %w", err)
    }
    defer rows.Close()

    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
            return nil, fmt.Errorf("scanning user: %w", err)
        }
        users = append(users, u)
    }
    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("iterating users: %w", err)
    }
    return users, nil
}
```

### 5.2 Insert and Get ID

```go
func (s *Store) CreateUser(ctx context.Context, name, email string) (int64, error) {
    result, err := s.db.ExecContext(ctx,
        "INSERT INTO users (name, email) VALUES (?, ?)", name, email,
    )
    if err != nil {
        return 0, fmt.Errorf("inserting user: %w", err)
    }
    id, err := result.LastInsertId()
    if err != nil {
        return 0, fmt.Errorf("getting last insert id: %w", err)
    }
    return id, nil
}
```

### 5.3 Nullable Fields

```go
var bio sql.NullString
err := row.Scan(&u.Name, &bio)
if bio.Valid {
    u.Bio = bio.String
}
```

### 5.4 Prepared Statements

Use prepared statements for repeated queries:

```go
stmt, err := db.PrepareContext(ctx, "SELECT name FROM users WHERE id = ?")
if err != nil {
    return fmt.Errorf("preparing statement: %w", err)
}
defer stmt.Close()

for _, id := range ids {
    var name string
    if err := stmt.QueryRowContext(ctx, id).Scan(&name); err != nil {
        return fmt.Errorf("querying user %s: %w", id, err)
    }
}
```

---

## 6. Transactions

### 6.1 Basic Transaction

```go
func (s *Store) TransferFunds(ctx context.Context, from, to string, amount int) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("beginning transaction: %w", err)
    }
    defer tx.Rollback() // no-op if committed

    if _, err := tx.ExecContext(ctx,
        "UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, from,
    ); err != nil {
        return fmt.Errorf("debiting %s: %w", from, err)
    }

    if _, err := tx.ExecContext(ctx,
        "UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, to,
    ); err != nil {
        return fmt.Errorf("crediting %s: %w", to, err)
    }

    if err := tx.Commit(); err != nil {
        return fmt.Errorf("committing transfer: %w", err)
    }
    return nil
}
```

### 6.2 Transaction Helper

```go
func withTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("beginning transaction: %w", err)
    }
    defer tx.Rollback()

    if err := fn(tx); err != nil {
        return err
    }

    return tx.Commit()
}

// Usage
err := withTx(ctx, db, func(tx *sql.Tx) error {
    // all operations use tx
    return nil
})
```

---

## 7. Migrations

### 7.1 Embedded Migrations with golang-migrate

```go
import (
    "embed"
    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/source/iofs"
    _ "github.com/golang-migrate/migrate/v4/database/sqlite3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func runMigrations(dbURL string) error {
    source, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return fmt.Errorf("creating migration source: %w", err)
    }

    m, err := migrate.NewWithSourceInstance("iofs", source, "sqlite3://"+dbURL)
    if err != nil {
        return fmt.Errorf("creating migrator: %w", err)
    }

    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("running migrations: %w", err)
    }
    return nil
}
```

### 7.2 Simple Schema Initialization (SQLite)

For simpler projects without migration tooling:

```go
const schema = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

func initDB(db *sql.DB) error {
    _, err := db.Exec(schema)
    return err
}
```

---

## 8. sqlc

SQL-first code generation — write SQL, get type-safe Go:

### 8.1 Configuration

```yaml
# sqlc.yaml
version: "2"
sql:
  - engine: "sqlite"
    queries: "queries/"
    schema: "schema/"
    gen:
      go:
        package: "store"
        out: "internal/store"
```

### 8.2 Schema

```sql
-- schema/001_users.sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 8.3 Queries

```sql
-- queries/users.sql

-- name: GetUser :one
SELECT id, name, email, created_at FROM users WHERE id = ?;

-- name: ListUsers :many
SELECT id, name, email, created_at FROM users ORDER BY name;

-- name: CreateUser :exec
INSERT INTO users (name, email) VALUES (?, ?);

-- name: DeleteUser :exec
DELETE FROM users WHERE id = ?;
```

### 8.4 Generated Code Usage

```go
// sqlc generates type-safe functions:
queries := store.New(db)

user, err := queries.GetUser(ctx, 1)
users, err := queries.ListUsers(ctx)
err := queries.CreateUser(ctx, store.CreateUserParams{Name: "John", Email: "j@x.com"})
```

---

## 9. Redis

### 9.1 go-redis Client

```go
import "github.com/redis/go-redis/v9"

rdb := redis.NewClient(&redis.Options{
    Addr:     "localhost:6379",
    Password: "",
    DB:       0,
})
defer rdb.Close()

// Set/Get
err := rdb.Set(ctx, "key", "value", 10*time.Minute).Err()
val, err := rdb.Get(ctx, "key").Result()
if errors.Is(err, redis.Nil) {
    // key does not exist
}
```

### 9.2 Queue Pattern (List-Based)

```go
// Producer
func enqueue(ctx context.Context, rdb *redis.Client, queue string, job Job) error {
    data, err := json.Marshal(job)
    if err != nil {
        return fmt.Errorf("marshaling job: %w", err)
    }
    return rdb.LPush(ctx, queue, data).Err()
}

// Consumer (blocking)
func dequeue(ctx context.Context, rdb *redis.Client, queue string) (*Job, error) {
    result, err := rdb.BRPop(ctx, 5*time.Second, queue).Result()
    if errors.Is(err, redis.Nil) {
        return nil, nil // timeout, no job
    }
    if err != nil {
        return nil, fmt.Errorf("dequeuing: %w", err)
    }

    var job Job
    if err := json.Unmarshal([]byte(result[1]), &job); err != nil {
        return nil, fmt.Errorf("unmarshaling job: %w", err)
    }
    return &job, nil
}
```

### 9.3 Pub/Sub

```go
sub := rdb.Subscribe(ctx, "events")
defer sub.Close()

ch := sub.Channel()
for msg := range ch {
    fmt.Printf("channel=%s payload=%s\n", msg.Channel, msg.Payload)
}
```

---

## 10. Qdrant

### 10.1 Qdrant Go Client

```go
import "github.com/qdrant/go-client/qdrant"

client, err := qdrant.NewClient(&qdrant.Config{
    Host: "localhost",
    Port: 6334,
})

// Create collection
client.CreateCollection(ctx, &qdrant.CreateCollection{
    CollectionName: "documents",
    VectorsConfig: qdrant.NewVectorsConfig(&qdrant.VectorParams{
        Size:     1536,
        Distance: qdrant.Distance_Cosine,
    }),
})

// Upsert points
client.Upsert(ctx, &qdrant.UpsertPoints{
    CollectionName: "documents",
    Points: []*qdrant.PointStruct{
        {
            Id:      qdrant.NewIDNum(1),
            Vectors: qdrant.NewVectors(embedding...),
            Payload: qdrant.NewValueMap(map[string]any{
                "text":   "document content",
                "source": "file.md",
            }),
        },
    },
})

// Search
results, err := client.Query(ctx, &qdrant.QueryPoints{
    CollectionName: "documents",
    Query:          qdrant.NewQuery(queryVector...),
    Limit:          qdrant.PtrOf(uint64(5)),
    WithPayload:    qdrant.NewWithPayload(true),
})
```
