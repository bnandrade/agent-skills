# Project Structure

Standard Go project layouts for different application types.

---

## Table of Contents

1. [Standard Layout](#1-standard-layout)
2. [CLI Application](#2-cli-application)
3. [Web API Service](#3-web-api-service)
4. [Library Package](#4-library-package)
5. [Monorepo / Multi-Module](#5-monorepo--multi-module)
6. [Go Modules](#6-go-modules)
7. [Go Workspaces](#7-go-workspaces)

---

## 1. Standard Layout

The widely-adopted Go project layout for production applications:

```
myapp/
├── cmd/                          # Entry points (one per binary)
│   ├── myapp/
│   │   └── main.go               # Main binary
│   └── worker/
│       └── main.go               # Secondary binary (worker, cli tool)
├── internal/                     # Private packages (enforced by Go compiler)
│   ├── config/
│   │   └── config.go             # Configuration loading
│   ├── store/
│   │   ├── store.go              # Database access layer
│   │   ├── queries.go            # SQL queries
│   │   └── store_test.go         # Tests
│   ├── handler/
│   │   ├── handler.go            # HTTP handlers
│   │   ├── middleware.go         # HTTP middleware
│   │   └── handler_test.go       # Tests
│   └── domain/
│       ├── user.go               # Domain types
│       └── order.go
├── pkg/                          # Public packages (importable by other projects)
│   └── client/
│       └── client.go             # SDK / client library
├── migrations/                   # Database migrations
│   ├── 001_create_users.up.sql
│   └── 001_create_users.down.sql
├── api/                          # API definitions
│   └── openapi.yaml              # OpenAPI spec
├── scripts/                      # Development/deploy scripts
│   └── seed.go
├── go.mod
├── go.sum
├── Dockerfile
├── docker-compose.yml
└── Makefile
```

### Key directories

| Directory | Purpose | Compiler enforced? |
|---|---|---|
| `cmd/` | One `main.go` per binary. Thin — wire deps, start server, handle signals | No |
| `internal/` | Private to this module. Cannot be imported by other modules | **Yes** |
| `pkg/` | Public library code. Importable by anyone. Only use when building SDKs | No |

### When NOT to use `pkg/`

Most applications don't need `pkg/`. Use it only when you explicitly want other Go modules to import your packages. Otherwise, put everything in `internal/`.

---

## 2. CLI Application

```
mytool/
├── cmd/
│   └── mytool/
│       └── main.go
├── internal/
│   ├── cli/
│   │   ├── root.go           # Root command
│   │   ├── run.go            # Run subcommand
│   │   └── config.go         # Config subcommand
│   └── runner/
│       ├── runner.go         # Core logic
│       └── runner_test.go
├── go.mod
└── Makefile
```

### Thin main.go

```go
// cmd/mytool/main.go
package main

import (
    "fmt"
    "os"

    "github.com/myorg/mytool/internal/cli"
)

func main() {
    if err := cli.Execute(); err != nil {
        fmt.Fprintf(os.Stderr, "error: %v\n", err)
        os.Exit(1)
    }
}
```

---

## 3. Web API Service

```
myapi/
├── cmd/
│   └── myapi/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go         # Env-based configuration
│   ├── server/
│   │   ├── server.go         # HTTP server setup
│   │   ├── routes.go         # Route registration
│   │   └── middleware.go     # Logging, auth, CORS, recovery
│   ├── handler/
│   │   ├── user.go           # User handlers
│   │   ├── order.go          # Order handlers
│   │   └── health.go         # Health check
│   ├── store/
│   │   ├── store.go          # DB connection + Store struct
│   │   ├── user.go           # User queries
│   │   ├── order.go          # Order queries
│   │   └── store_test.go
│   ├── domain/
│   │   ├── user.go           # User type + business rules
│   │   └── order.go          # Order type + business rules
│   └── middleware/
│       ├── auth.go           # Authentication
│       └── logging.go        # Request logging
├── migrations/
├── go.mod
├── Dockerfile
└── docker-compose.yml
```

### Wiring in main.go

```go
// cmd/myapi/main.go
package main

import (
    "context"
    "database/sql"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    _ "github.com/mattn/go-sqlite3"
    "github.com/myorg/myapi/internal/config"
    "github.com/myorg/myapi/internal/handler"
    "github.com/myorg/myapi/internal/server"
    "github.com/myorg/myapi/internal/store"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    cfg, err := config.Load()
    if err != nil {
        logger.Error("loading config", "error", err)
        os.Exit(1)
    }

    db, err := sql.Open("sqlite3", cfg.DatabaseURL)
    if err != nil {
        logger.Error("opening database", "error", err)
        os.Exit(1)
    }
    defer db.Close()

    st := store.New(db)
    h := handler.New(st, logger)
    srv := server.New(cfg.Addr, h, logger)

    // Graceful shutdown
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go func() {
        logger.Info("server starting", "addr", cfg.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            logger.Error("server error", "error", err)
            os.Exit(1)
        }
    }()

    <-ctx.Done()
    logger.Info("shutting down")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        logger.Error("shutdown error", "error", err)
    }
}
```

---

## 4. Library Package

For reusable libraries (published as Go modules):

```
mylib/
├── mylib.go            # Main package API
├── mylib_test.go       # Tests
├── options.go          # Functional options
├── errors.go           # Error types
├── internal/           # Private implementation
│   └── parser/
│       └── parser.go
├── examples_test.go    # Testable examples (shown in pkg.go.dev)
├── go.mod
└── README.md
```

### Testable Examples

```go
// examples_test.go
package mylib_test

import (
    "fmt"
    "github.com/myorg/mylib"
)

func ExampleNew() {
    client := mylib.New("https://api.example.com")
    result, err := client.Fetch("key")
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println(result)
    // Output: expected_value
}
```

---

## 5. Monorepo / Multi-Module

For larger projects with multiple services:

```
platform/
├── services/
│   ├── api/
│   │   ├── go.mod            # github.com/myorg/platform/services/api
│   │   ├── cmd/api/main.go
│   │   └── internal/
│   ├── worker/
│   │   ├── go.mod            # github.com/myorg/platform/services/worker
│   │   ├── cmd/worker/main.go
│   │   └── internal/
│   └── gateway/
│       ├── go.mod
│       └── ...
├── libs/
│   ├── auth/
│   │   ├── go.mod            # github.com/myorg/platform/libs/auth
│   │   ├── auth.go
│   │   └── auth_test.go
│   └── observability/
│       ├── go.mod
│       └── ...
├── go.work                    # Go workspace for local development
└── docker-compose.yml
```

---

## 6. Go Modules

### Initialize a Module

```bash
go mod init github.com/myorg/myapp
```

### Key Commands

```bash
go mod tidy          # Add missing, remove unused dependencies
go mod download      # Download dependencies to local cache
go mod verify        # Verify checksums
go mod vendor        # Copy deps to vendor/ (for reproducible builds)
go mod graph         # Print dependency graph
go get -u ./...      # Update all dependencies
go get pkg@v1.2.3    # Pin specific version
go fix ./...         # Modernize code to latest Go idioms (Go 1.26+)
```

### ignore Directive (Go 1.25+)

Exclude directories from package pattern matching:

```
// go.mod
module github.com/myorg/myapp

go 1.26

ignore (
    testdata
    scripts
    _archived
)
```

Files in ignored directories are excluded from `./...` and `all` patterns but still included in module zip files.

### go.mod Best Practices

- Commit both `go.mod` and `go.sum`
- Run `go mod tidy` before every commit
- Use `go get -u ./...` periodically but verify nothing breaks
- Pin major versions: `go get github.com/redis/go-redis/v9`

---

## 7. Go Workspaces

For developing multiple modules locally:

```bash
# go.work — NOT committed to git (add to .gitignore)
go 1.23

use (
    ./services/api
    ./services/worker
    ./libs/auth
)
```

```bash
go work init ./services/api ./services/worker ./libs/auth
go work sync    # Sync workspace modules
```

- `go.work` is for **local development only** — it replaces `replace` directives in `go.mod`
- Add `go.work` and `go.work.sum` to `.gitignore`
- CI uses individual `go.mod` files, not the workspace

---

## Quick Reference

| Convention | Rule |
|---|---|
| Package name | Lowercase, single word (`store`, `handler`, `config`) |
| File name | `lowercase_with_underscores.go` |
| Test file | Same name + `_test.go` (`store_test.go`) |
| One binary | `cmd/<name>/main.go` |
| Private code | `internal/` — compiler-enforced |
| Public library | `pkg/` — only when external import is intentional |
| Config | Environment variables via `os.Getenv` or config file |
| Entry point | `main.go` is thin — wire dependencies, start, handle signals |
