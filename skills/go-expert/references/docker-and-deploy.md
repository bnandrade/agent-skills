# Docker & Deploy

Containerização, CI/CD e deployment de aplicações Go.

---

## Table of Contents

1. [Multi-Stage Dockerfile](#1-multi-stage-dockerfile)
2. [Base Images](#2-base-images)
3. [go:embed — Embedded Assets](#3-goembed)
4. [Docker Compose](#4-docker-compose)
5. [Code Modernization with go fix](#5-code-modernization-with-go-fix)
6. [Container-Aware GOMAXPROCS](#6-container-aware-gomaxprocs)
7. [Cross-Compilation](#7-cross-compilation)
8. [Makefile](#8-makefile)
9. [CI/CD (GitHub Actions)](#9-cicd)
10. [Graceful Shutdown & Signals](#10-graceful-shutdown--signals)
11. [Configuration via Environment](#11-configuration-via-environment)

---

## 1. Multi-Stage Dockerfile

### 1.1 Standard Production Dockerfile

```dockerfile
# Stage 1: Build
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

# Stage 2: Runtime
FROM scratch

COPY --from=builder /app/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080
ENTRYPOINT ["/server"]
```

### 1.2 With CGo (SQLite)

When using CGo (e.g., go-sqlite3), you need a base with libc:

```dockerfile
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /app/server ./cmd/server

# Use alpine (not scratch) for CGo binaries
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

### 1.3 With Pure Go SQLite (No CGo)

```dockerfile
FROM golang:1.26-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# modernc.org/sqlite is pure Go — no CGo needed
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server ./cmd/server

FROM scratch
COPY --from=builder /app/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 8080
ENTRYPOINT ["/server"]
```

---

## 2. Base Images

| Image | Size | Use When |
|---|---|---|
| `scratch` | ~0 MB | Pure Go, no CGo, no shell needed |
| `gcr.io/distroless/static` | ~2 MB | Pure Go, want non-root user, no shell |
| `alpine:3.20` | ~7 MB | CGo required, need shell for debugging |
| `debian:bookworm-slim` | ~80 MB | Complex native deps, debugging tools |

### Distroless (Recommended for Production)

```dockerfile
FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/server /server
USER nonroot:nonroot
ENTRYPOINT ["/server"]
```

---

## 3. go:embed

Embed files directly into the Go binary at compile time:

### 3.1 Single File

```go
import "embed"

//go:embed version.txt
var version string

//go:embed config.json
var defaultConfig []byte
```

### 3.2 Directory (Static Files, Templates)

```go
//go:embed static/*
var staticFiles embed.FS

// Serve embedded static files
mux.Handle("GET /static/", http.StripPrefix("/static/",
    http.FileServerFS(staticFiles)))
```

### 3.3 Embedded Migrations

```go
//go:embed migrations/*.sql
var migrationsFS embed.FS
```

### 3.4 Embedded Templates

```go
//go:embed templates/*.html
var templateFS embed.FS

tmpl, err := template.ParseFS(templateFS, "templates/*.html")
```

### 3.5 Embedded TypeScript Bundle (Aurelia Pattern)

```go
//go:embed bridge/dist/bundle.js
var bridgeBundle []byte

func extractBridge(destDir string) error {
    return os.WriteFile(
        filepath.Join(destDir, "bundle.js"),
        bridgeBundle,
        0o644,
    )
}
```

---

## 4. Docker Compose

### 4.1 Development Setup

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=file:/data/app.db
      - REDIS_URL=redis://redis:6379
      - LOG_LEVEL=debug
    volumes:
      - app-data:/data
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
    volumes:
      - redis-data:/data

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant-data:/qdrant/storage

volumes:
  app-data:
  redis-data:
  qdrant-data:
```

### 4.2 Development with Hot Reload

```yaml
services:
  app:
    build:
      context: .
      target: builder  # stop at builder stage
    command: ["air"]    # hot reload with cosmtrek/air
    volumes:
      - .:/app          # mount source code
    ports:
      - "8080:8080"
```

---

## 5. Code Modernization with go fix (Go 1.26)

`go fix` was rewritten in Go 1.26 with ~24 "modernizers" that auto-update code to latest idioms:

```bash
# Preview changes
go fix -diff ./...

# Apply changes
go fix ./...
```

**What it modernizes:**
- Updates to newer stdlib APIs
- Replaces deprecated patterns with modern equivalents
- Supports `//go:fix inline` directives for source-level inlining
- Built on the same analysis framework as `go vet`

Run `go fix` after upgrading Go versions to keep code idiomatic.

---

## 6. Container-Aware GOMAXPROCS

Since Go 1.25, the runtime auto-adjusts to cgroup CPU limits. This means:

- **No need for `automaxprocs`** or similar third-party packages
- Respects Kubernetes CPU limits (not requests)
- Dynamically updates if limits change

```dockerfile
# You no longer need to set GOMAXPROCS in Docker
# The runtime handles it automatically

# WRONG (outdated pattern):
ENV GOMAXPROCS=4

# CORRECT: just let Go handle it
```

---

## 7. Cross-Compilation

### 5.1 Build for Multiple Platforms

```bash
# Linux AMD64
GOOS=linux GOARCH=amd64 go build -o myapp-linux-amd64 ./cmd/myapp

# Linux ARM64
GOOS=linux GOARCH=arm64 go build -o myapp-linux-arm64 ./cmd/myapp

# macOS ARM (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o myapp-darwin-arm64 ./cmd/myapp

# Windows
GOOS=windows GOARCH=amd64 go build -o myapp-windows-amd64.exe ./cmd/myapp
```

### 5.2 Build with Version Info

```bash
go build -ldflags="-s -w \
  -X main.version=$(git describe --tags) \
  -X main.commit=$(git rev-parse --short HEAD) \
  -X main.date=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o myapp ./cmd/myapp
```

```go
// cmd/myapp/main.go
var (
    version = "dev"
    commit  = "unknown"
    date    = "unknown"
)
```

---

## 8. Makefile

```makefile
.PHONY: build test lint run clean docker

APP_NAME := myapp
VERSION  := $(shell git describe --tags --always)

build:
	go build -ldflags="-s -w -X main.version=$(VERSION)" -o bin/$(APP_NAME) ./cmd/$(APP_NAME)

test:
	go test -race -count=1 ./...

lint:
	golangci-lint run ./...

run:
	go run ./cmd/$(APP_NAME)

clean:
	rm -rf bin/

docker:
	docker build -t $(APP_NAME):$(VERSION) .

# Development with hot reload
dev:
	air

# Generate code (sqlc, protobuf, etc.)
generate:
	go generate ./...
```

---

## 9. CI/CD

### 7.1 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.26'

      - name: Download dependencies
        run: go mod download

      - name: Lint
        uses: golangci/golangci-lint-action@v6

      - name: Test
        run: go test -race -count=1 -coverprofile=coverage.out ./...

      - name: Build
        run: go build ./cmd/...

  docker:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:latest
```

---

## 10. Graceful Shutdown & Signals

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer stop()

    if err := run(ctx); err != nil {
        slog.Error("application error", "error", err)
        os.Exit(1)
    }
}

func run(ctx context.Context) error {
    // Initialize resources
    db, err := sql.Open("sqlite3", os.Getenv("DATABASE_URL"))
    if err != nil {
        return fmt.Errorf("opening database: %w", err)
    }
    defer db.Close()

    srv := &http.Server{Addr: ":8080", Handler: mux}

    // Start server
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            slog.Error("server error", "error", err)
        }
    }()

    slog.Info("server started", "addr", ":8080")

    // Block until signal
    <-ctx.Done()
    slog.Info("shutting down")

    // Graceful shutdown
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    defer cancel()

    return srv.Shutdown(shutdownCtx)
}
```

---

## 11. Configuration via Environment

### 9.1 Simple Pattern (No Dependencies)

```go
type Config struct {
    Addr        string
    DatabaseURL string
    RedisURL    string
    LogLevel    string
}

func LoadConfig() Config {
    return Config{
        Addr:        envOr("ADDR", ":8080"),
        DatabaseURL: envOr("DATABASE_URL", "file:app.db"),
        RedisURL:    envOr("REDIS_URL", "redis://localhost:6379"),
        LogLevel:    envOr("LOG_LEVEL", "info"),
    }
}

func envOr(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
```

### 9.2 .env File Support

```go
// Use joho/godotenv for .env files in development
import "github.com/joho/godotenv"

func init() {
    // Best-effort load — not an error if .env doesn't exist
    _ = godotenv.Load()
}
```
