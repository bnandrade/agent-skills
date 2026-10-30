# Web & APIs

Patterns para construir APIs HTTP, gRPC e streaming em Go.

---

## Table of Contents

1. [net/http ServeMux](#1-nethttp-servemux)
2. [HTTP Handlers](#2-http-handlers)
3. [Middleware Pattern](#3-middleware-pattern)
4. [JSON Request/Response](#4-json-requestresponse)
5. [Request Validation](#5-request-validation)
6. [Graceful Shutdown](#6-graceful-shutdown)
7. [Structured Logging with slog](#7-structured-logging-with-slog)
8. [NDJSON Streaming](#8-ndjson-streaming)
9. [WebSocket](#9-websocket)
10. [gRPC](#10-grpc)
11. [REST API Conventions](#11-rest-api-conventions)

---

## 1. net/http ServeMux

Since Go 1.22, the stdlib ServeMux supports method routing and path parameters:

```go
func main() {
    mux := http.NewServeMux()

    // Method + path pattern
    mux.HandleFunc("GET /users", listUsers)
    mux.HandleFunc("POST /users", createUser)
    mux.HandleFunc("GET /users/{id}", getUser)
    mux.HandleFunc("PUT /users/{id}", updateUser)
    mux.HandleFunc("DELETE /users/{id}", deleteUser)

    // Static files
    mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

    // Health check
    mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    srv := &http.Server{
        Addr:         ":8080",
        Handler:      mux,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 30 * time.Second,
        IdleTimeout:  60 * time.Second,
    }

    log.Fatal(srv.ListenAndServe())
}
```

### Path Parameters

```go
func getUser(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id") // Go 1.22+
    // ...
}
```

### Wildcard Catch-All

```go
mux.HandleFunc("GET /files/{path...}", func(w http.ResponseWriter, r *http.Request) {
    filePath := r.PathValue("path") // matches everything after /files/
})
```

**Note (Go 1.26):** ServeMux trailing-slash redirects now use HTTP **307** (Temporary Redirect) instead of 301. This preserves the request method (POST stays POST) and prevents data loss on form submissions.

---

## 2. HTTP Handlers

### 2.1 Handler as Method on a Struct

```go
type UserHandler struct {
    store  UserStore
    logger *slog.Logger
}

func NewUserHandler(store UserStore, logger *slog.Logger) *UserHandler {
    return &UserHandler{store: store, logger: logger}
}

func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")

    user, err := h.store.FindByID(r.Context(), id)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            http.Error(w, "user not found", http.StatusNotFound)
            return
        }
        h.logger.Error("finding user", "id", id, "error", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }

    writeJSON(w, http.StatusOK, user)
}
```

### 2.2 Register Routes

```go
func (h *UserHandler) RegisterRoutes(mux *http.ServeMux) {
    mux.HandleFunc("GET /users", h.List)
    mux.HandleFunc("POST /users", h.Create)
    mux.HandleFunc("GET /users/{id}", h.Get)
    mux.HandleFunc("PUT /users/{id}", h.Update)
    mux.HandleFunc("DELETE /users/{id}", h.Delete)
}
```

---

## 3. Middleware Pattern

### 3.1 Standard Middleware Signature

```go
type Middleware func(http.Handler) http.Handler

func Logging(logger *slog.Logger) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()

            // Wrap response writer to capture status code
            wrapped := &statusWriter{ResponseWriter: w, status: http.StatusOK}

            next.ServeHTTP(wrapped, r)

            logger.Info("request",
                "method", r.Method,
                "path", r.URL.Path,
                "status", wrapped.status,
                "duration", time.Since(start),
            )
        })
    }
}

type statusWriter struct {
    http.ResponseWriter
    status int
}

func (w *statusWriter) WriteHeader(code int) {
    w.status = code
    w.ResponseWriter.WriteHeader(code)
}
```

### 3.2 Recovery Middleware

```go
func Recovery(logger *slog.Logger) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            defer func() {
                if err := recover(); err != nil {
                    logger.Error("panic recovered",
                        "error", err,
                        "stack", string(debug.Stack()),
                    )
                    http.Error(w, "internal error", http.StatusInternalServerError)
                }
            }()
            next.ServeHTTP(w, r)
        })
    }
}
```

### 3.3 CORS Middleware

```go
func CORS(allowedOrigins []string) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            origin := r.Header.Get("Origin")
            if slices.Contains(allowedOrigins, origin) {
                w.Header().Set("Access-Control-Allow-Origin", origin)
                w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
                w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
            }

            if r.Method == "OPTIONS" {
                w.WriteHeader(http.StatusNoContent)
                return
            }

            next.ServeHTTP(w, r)
        })
    }
}
```

### 3.4 CSRF Protection — CrossOriginProtection (Go 1.25+)

Built-in CSRF protection using browser Fetch metadata — no tokens or cookies required:

```go
// Wrap your handler with CrossOriginProtection
handler := http.CrossOriginProtection(mux)

srv := &http.Server{
    Addr:    ":8080",
    Handler: handler,
}
```

**How it works:**
- Uses Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest headers
- Rejects non-safe cross-origin browser requests automatically
- Safe requests (GET, HEAD) are allowed through
- No tokens, no cookies, no middleware configuration

### 3.5 Chaining Middleware

```go
func Chain(handler http.Handler, middlewares ...Middleware) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        handler = middlewares[i](handler)
    }
    return handler
}

// Usage
handler := Chain(mux,
    Recovery(logger),
    Logging(logger),
    CORS([]string{"https://example.com"}),
)
```

---

## 4. JSON Request/Response

### 4.1 JSON Helpers

```go
func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(v); err != nil {
        slog.Error("encoding json response", "error", err)
    }
}

func readJSON(r *http.Request, v any) error {
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    if err := dec.Decode(v); err != nil {
        return fmt.Errorf("decoding json: %w", err)
    }
    return nil
}
```

### 4.2 Error Response

```go
type APIError struct {
    Error   string `json:"error"`
    Code    string `json:"code,omitempty"`
    Details any    `json:"details,omitempty"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
    writeJSON(w, status, APIError{Error: msg})
}
```

### 4.3 Handler with JSON

```go
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := readJSON(r, &req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid request body")
        return
    }

    if err := req.Validate(); err != nil {
        writeError(w, http.StatusBadRequest, err.Error())
        return
    }

    user, err := h.store.Create(r.Context(), req.Name, req.Email)
    if err != nil {
        h.logger.Error("creating user", "error", err)
        writeError(w, http.StatusInternalServerError, "internal error")
        return
    }

    writeJSON(w, http.StatusCreated, user)
}
```

---

## 5. Request Validation

```go
type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

func (r CreateUserRequest) Validate() error {
    var errs []error
    if r.Name == "" {
        errs = append(errs, fmt.Errorf("name is required"))
    }
    if r.Email == "" {
        errs = append(errs, fmt.Errorf("email is required"))
    }
    if r.Email != "" && !strings.Contains(r.Email, "@") {
        errs = append(errs, fmt.Errorf("email is invalid"))
    }
    return errors.Join(errs...)
}
```

---

## 6. Graceful Shutdown

```go
func run(ctx context.Context) error {
    srv := &http.Server{
        Addr:    ":8080",
        Handler: mux,
    }

    // Start server in background
    errCh := make(chan error, 1)
    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            errCh <- err
        }
    }()

    // Wait for shutdown signal or error
    select {
    case err := <-errCh:
        return fmt.Errorf("server error: %w", err)
    case <-ctx.Done():
    }

    // Graceful shutdown with timeout
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    return srv.Shutdown(shutdownCtx)
}
```

---

## 7. Structured Logging with slog

```go
// Setup
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))

// Usage
logger.Info("server starting", "addr", ":8080")
logger.Error("query failed", "error", err, "query", q)

// With context (request-scoped fields)
logger.InfoContext(ctx, "processing request",
    "user_id", userID,
    "method", r.Method,
)

// Child logger with preset fields
reqLogger := logger.With("request_id", requestID, "method", r.Method)
reqLogger.Info("handling request")
```

### MultiHandler (Go 1.26+)

Fan-out logs to multiple destinations:

```go
// Send logs to both stdout and a file
jsonHandler := slog.NewJSONHandler(os.Stdout, nil)
fileHandler := slog.NewJSONHandler(logFile, nil)

logger := slog.New(slog.NewMultiHandler(jsonHandler, fileHandler))
logger.Info("this goes to both destinations")
```

---

## 8. NDJSON Streaming

Newline-delimited JSON — used for event streaming (like Aurelia's bridge protocol):

### 8.1 Server (Writer)

```go
func streamEvents(w http.ResponseWriter, r *http.Request) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming not supported", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/x-ndjson")
    w.Header().Set("Transfer-Encoding", "chunked")

    enc := json.NewEncoder(w)
    for event := range events(r.Context()) {
        if err := enc.Encode(event); err != nil {
            return // client disconnected
        }
        flusher.Flush()
    }
}
```

### 8.2 Client (Reader)

```go
func readNDJSON(r io.Reader, handler func(json.RawMessage) error) error {
    scanner := bufio.NewScanner(r)
    for scanner.Scan() {
        line := scanner.Bytes()
        if len(line) == 0 {
            continue
        }
        if err := handler(json.RawMessage(line)); err != nil {
            return fmt.Errorf("handling event: %w", err)
        }
    }
    return scanner.Err()
}
```

---

## 9. WebSocket

Using `golang.org/x/net/websocket` or `nhooyr.io/websocket`:

```go
import "nhooyr.io/websocket"

func handleWS(w http.ResponseWriter, r *http.Request) {
    conn, err := websocket.Accept(w, r, nil)
    if err != nil {
        slog.Error("accepting websocket", "error", err)
        return
    }
    defer conn.Close(websocket.StatusNormalClosure, "")

    ctx := r.Context()
    for {
        _, msg, err := conn.Read(ctx)
        if err != nil {
            return
        }
        if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
            return
        }
    }
}
```

---

## 10. gRPC

### 10.1 Proto Definition

```protobuf
syntax = "proto3";
package user;
option go_package = "github.com/myorg/myapp/gen/user";

service UserService {
    rpc GetUser(GetUserRequest) returns (User);
    rpc ListUsers(ListUsersRequest) returns (stream User);
}

message GetUserRequest { string id = 1; }
message User {
    string id = 1;
    string name = 2;
    string email = 3;
}
```

### 10.2 Server Implementation

```go
type userServer struct {
    user.UnimplementedUserServiceServer
    store UserStore
}

func (s *userServer) GetUser(ctx context.Context, req *user.GetUserRequest) (*user.User, error) {
    u, err := s.store.FindByID(ctx, req.GetId())
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            return nil, status.Error(codes.NotFound, "user not found")
        }
        return nil, status.Error(codes.Internal, "internal error")
    }
    return &user.User{Id: u.ID, Name: u.Name, Email: u.Email}, nil
}
```

---

## 11. REST API Conventions

| Method | Path | Action | Status |
|---|---|---|---|
| GET | /users | List all | 200 |
| POST | /users | Create | 201 |
| GET | /users/{id} | Get one | 200 / 404 |
| PUT | /users/{id} | Full update | 200 / 404 |
| PATCH | /users/{id} | Partial update | 200 / 404 |
| DELETE | /users/{id} | Delete | 204 / 404 |

### Common Response Patterns

```go
// List with pagination
type ListResponse[T any] struct {
    Data       []T   `json:"data"`
    Total      int   `json:"total"`
    Page       int   `json:"page"`
    PerPage    int   `json:"per_page"`
}

// Single resource
writeJSON(w, http.StatusOK, user)

// Created
w.Header().Set("Location", "/users/"+user.ID)
writeJSON(w, http.StatusCreated, user)

// No content
w.WriteHeader(http.StatusNoContent)
```
