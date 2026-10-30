# Real-World Patterns

Patterns extraídos de projetos Go de produção, incluindo o Aurelia OS e projetos da comunidade. Cada pattern é um building block reutilizável.

---

## Table of Contents

1. [Constructor Injection (DI sem Framework)](#1-constructor-injection)
2. [NDJSON Multiplexing](#2-ndjson-multiplexing)
3. [Embedded Asset Distribution](#3-embedded-asset-distribution)
4. [Agent/Plugin Registry](#4-agentplugin-registry)
5. [Graceful Daemon with Signal Handling](#5-graceful-daemon)
6. [Long-Lived Subprocess Management](#6-subprocess-management)
7. [Event Streaming with Channels](#7-event-streaming)
8. [Memory/Cache Layer Pattern](#8-memorycache-layer)
9. [Layered Prompt Assembly](#9-layered-prompt-assembly)
10. [Cron Scheduler with Deduplication](#10-cron-scheduler)
11. [Modular Monolith Architecture](#11-modular-monolith)

---

## 1. Constructor Injection

All dependencies are explicit — no globals, no service locators, no DI frameworks:

```go
// Each package exposes a New() constructor
type Store struct {
    db     *sql.DB
    logger *slog.Logger
}

func NewStore(db *sql.DB, logger *slog.Logger) *Store {
    return &Store{db: db, logger: logger}
}

type Handler struct {
    store  *Store
    logger *slog.Logger
}

func NewHandler(store *Store, logger *slog.Logger) *Handler {
    return &Handler{store: store, logger: logger}
}

// main.go wires everything together
func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    db, err := sql.Open("sqlite3", "app.db")
    if err != nil {
        logger.Error("opening database", "error", err)
        os.Exit(1)
    }
    defer db.Close()

    store := NewStore(db, logger)
    handler := NewHandler(store, logger)
    // ...
}
```

**Why no framework:** Go's type system + constructors make DI containers unnecessary. Dependencies are visible in the function signature. Tests pass fakes directly. No reflection, no magic.

---

## 2. NDJSON Multiplexing

Pattern used by Aurelia for Go↔TypeScript IPC. Multiple concurrent requests share a single stdin/stdout pipe:

```go
// Protocol: one JSON object per line, routed by request_id

type Request struct {
    Command   string          `json:"command"`
    RequestID string          `json:"request_id"`
    Prompt    string          `json:"prompt"`
    Options   json.RawMessage `json:"options,omitempty"`
}

type Event struct {
    Type      string          `json:"type"` // "assistant", "tool_use", "result"
    RequestID string          `json:"request_id"`
    Data      json.RawMessage `json:"data"`
}

type Bridge struct {
    mu       sync.Mutex
    stdin    io.Writer
    counter  atomic.Uint64
    pending  sync.Map // map[string]chan Event
}

// Send a request and get a channel for events
func (b *Bridge) Send(ctx context.Context, prompt string) (<-chan Event, error) {
    id := fmt.Sprintf("req-%d", b.counter.Add(1))

    events := make(chan Event, 16) // buffered
    b.pending.Store(id, events)

    req := Request{
        Command:   "query",
        RequestID: id,
        Prompt:    prompt,
    }

    b.mu.Lock()
    err := json.NewEncoder(b.stdin).Encode(req)
    b.mu.Unlock()
    if err != nil {
        b.pending.Delete(id)
        close(events)
        return nil, fmt.Errorf("sending request: %w", err)
    }

    return events, nil
}

// readLoop runs in a goroutine, routing events to the right channel
func (b *Bridge) readLoop(stdout io.Reader) {
    scanner := bufio.NewScanner(stdout)
    for scanner.Scan() {
        var event Event
        if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
            slog.Error("parsing event", "error", err)
            continue
        }

        if ch, ok := b.pending.Load(event.RequestID); ok {
            eventCh := ch.(chan Event)
            select {
            case eventCh <- event:
            default:
                slog.Warn("dropping event: channel full", "request_id", event.RequestID)
            }

            // Close channel on terminal events
            if event.Type == "result" || event.Type == "error" {
                close(eventCh)
                b.pending.Delete(event.RequestID)
            }
        }
    }
}
```

---

## 3. Embedded Asset Distribution

Package non-Go assets into the binary for single-file distribution:

```go
import "embed"

//go:embed bridge/dist/bundle.js
var bundleJS []byte

//go:embed static/*
var staticFS embed.FS

// Auto-extract on first run
func ensureBridge(baseDir string) (string, error) {
    bundlePath := filepath.Join(baseDir, "bridge", "bundle.js")

    // Check if already extracted and up-to-date
    existing, err := os.ReadFile(bundlePath)
    if err == nil && bytes.Equal(existing, bundleJS) {
        return bundlePath, nil
    }

    // Extract
    if err := os.MkdirAll(filepath.Dir(bundlePath), 0o755); err != nil {
        return "", fmt.Errorf("creating bridge dir: %w", err)
    }
    if err := os.WriteFile(bundlePath, bundleJS, 0o644); err != nil {
        return "", fmt.Errorf("writing bundle: %w", err)
    }

    slog.Info("bridge extracted", "path", bundlePath)
    return bundlePath, nil
}
```

---

## 4. Agent/Plugin Registry

Load and route to specialized agents from markdown configuration:

```go
type Agent struct {
    Name        string   `yaml:"name"`
    Description string   `yaml:"description"`
    Model       string   `yaml:"model"`
    Triggers    []string `yaml:"triggers"`
    Prompt      string   // loaded from file body
}

type Registry struct {
    agents []Agent
}

func NewRegistry(dir string) (*Registry, error) {
    entries, err := os.ReadDir(dir)
    if err != nil {
        return nil, fmt.Errorf("reading agents dir: %w", err)
    }

    var agents []Agent
    for _, entry := range entries {
        if !strings.HasSuffix(entry.Name(), ".md") {
            continue
        }
        agent, err := parseAgent(filepath.Join(dir, entry.Name()))
        if err != nil {
            slog.Warn("skipping agent", "file", entry.Name(), "error", err)
            continue
        }
        agents = append(agents, agent)
    }

    return &Registry{agents: agents}, nil
}

// Route by prefix match first, then LLM classification as fallback
func (r *Registry) Route(ctx context.Context, message string) *Agent {
    // 1. Check prefix triggers
    for i := range r.agents {
        for _, trigger := range r.agents[i].Triggers {
            if strings.HasPrefix(strings.ToLower(message), trigger) {
                return &r.agents[i]
            }
        }
    }

    // 2. LLM-based classification (with timeout)
    ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
    defer cancel()

    return r.classifyWithLLM(ctx, message)
}
```

---

## 5. Graceful Daemon

Production-grade daemon with signal handling, health checks, and ordered shutdown:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer stop()

    if err := run(ctx); err != nil {
        slog.Error("fatal", "error", err)
        os.Exit(1)
    }
}

func run(ctx context.Context) error {
    cfg := LoadConfig()
    logger := setupLogger(cfg.LogLevel)

    // Initialize resources (ordered)
    db, err := openDB(cfg.DatabaseURL)
    if err != nil {
        return err
    }
    defer db.Close()

    rdb := openRedis(cfg.RedisURL)
    defer rdb.Close()

    store := NewStore(db)
    handler := NewHandler(store, logger)
    srv := &http.Server{Addr: cfg.Addr, Handler: handler}

    // Start background workers
    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            return fmt.Errorf("server: %w", err)
        }
        return nil
    })

    g.Go(func() error {
        return runCronScheduler(ctx, store)
    })

    g.Go(func() error {
        <-ctx.Done()
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    })

    return g.Wait()
}
```

---

## 6. Subprocess Management

Manage a long-lived child process (like Aurelia's TypeScript bridge):

```go
type Process struct {
    cmd    *exec.Cmd
    stdin  io.WriteCloser
    stdout io.ReadCloser
}

func StartProcess(ctx context.Context, name string, args ...string) (*Process, error) {
    cmd := exec.CommandContext(ctx, name, args...)

    stdin, err := cmd.StdinPipe()
    if err != nil {
        return nil, fmt.Errorf("stdin pipe: %w", err)
    }

    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return nil, fmt.Errorf("stdout pipe: %w", err)
    }

    cmd.Stderr = os.Stderr // passthrough stderr

    if err := cmd.Start(); err != nil {
        return nil, fmt.Errorf("starting %s: %w", name, err)
    }

    return &Process{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}

func (p *Process) Wait() error {
    return p.cmd.Wait()
}

func (p *Process) Close() error {
    p.stdin.Close()
    return p.cmd.Process.Kill()
}
```

---

## 7. Event Streaming

Fire-and-forget pattern with event channels for async processing:

```go
type EventBus struct {
    subscribers sync.Map // map[string][]chan Event
}

func (eb *EventBus) Subscribe(topic string) <-chan Event {
    ch := make(chan Event, 32)

    val, _ := eb.subscribers.LoadOrStore(topic, &[]chan Event{})
    subs := val.(*[]chan Event)
    *subs = append(*subs, ch)

    return ch
}

func (eb *EventBus) Publish(topic string, event Event) {
    val, ok := eb.subscribers.Load(topic)
    if !ok {
        return
    }
    subs := val.(*[]chan Event)
    for _, ch := range *subs {
        select {
        case ch <- event:
        default:
            // subscriber too slow, drop event
        }
    }
}
```

---

## 8. Memory/Cache Layer

Multi-tier memory system (like Aurelia's global/project/team memory):

```go
type MemoryLayer struct {
    baseDir string
}

func NewMemoryLayer(baseDir string) *MemoryLayer {
    return &MemoryLayer{baseDir: baseDir}
}

func (m *MemoryLayer) GlobalDir() string {
    return filepath.Join(m.baseDir, "memory")
}

func (m *MemoryLayer) ProjectDir(cwd string) string {
    // Hash cwd to create unique project dir
    h := sha256.Sum256([]byte(cwd))
    return filepath.Join(m.baseDir, "projects", hex.EncodeToString(h[:8]), "memory")
}

func (m *MemoryLayer) Load(dir string) ([]Memory, error) {
    entries, err := os.ReadDir(dir)
    if err != nil {
        if os.IsNotExist(err) {
            return nil, nil
        }
        return nil, fmt.Errorf("reading memory dir: %w", err)
    }

    var memories []Memory
    for _, entry := range entries {
        if !strings.HasSuffix(entry.Name(), ".md") {
            continue
        }
        mem, err := parseMemoryFile(filepath.Join(dir, entry.Name()))
        if err != nil {
            slog.Warn("skipping memory", "file", entry.Name(), "error", err)
            continue
        }
        memories = append(memories, mem)
    }
    return memories, nil
}
```

---

## 9. Layered Prompt Assembly

Build system prompts by composing layers:

```go
type PromptBuilder struct {
    parts []string
}

func (pb *PromptBuilder) Add(section, content string) {
    if content == "" {
        return
    }
    pb.parts = append(pb.parts, fmt.Sprintf("## %s\n\n%s", section, content))
}

func (pb *PromptBuilder) Build() string {
    return strings.Join(pb.parts, "\n\n---\n\n")
}

// Usage — layers assembled in order of priority
func buildSystemPrompt(persona Persona, agent *Agent, ctx SessionContext) string {
    pb := &PromptBuilder{}
    pb.Add("Identity", persona.Identity)
    pb.Add("Personality", persona.Soul)
    pb.Add("User Context", persona.UserProfile)
    if agent != nil {
        pb.Add("Agent Instructions", agent.Prompt)
    }
    pb.Add("Session", fmt.Sprintf("Working directory: %s", ctx.CWD))
    return pb.Build()
}
```

---

## 10. Cron Scheduler

SQLite-backed scheduler with deduplication:

```go
type Scheduler struct {
    store   *CronStore
    running sync.Map // dedup: jobID -> struct{}
    logger  *slog.Logger
}

func (s *Scheduler) Run(ctx context.Context) error {
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            s.tick(ctx)
        case <-ctx.Done():
            return nil
        }
    }
}

func (s *Scheduler) tick(ctx context.Context) {
    jobs, err := s.store.DueJobs(ctx, 50)
    if err != nil {
        s.logger.Error("fetching due jobs", "error", err)
        return
    }

    var wg sync.WaitGroup
    for _, job := range jobs {
        // Deduplicate: skip if already running
        if _, loaded := s.running.LoadOrStore(job.ID, struct{}{}); loaded {
            continue
        }

        wg.Go(func() { // Go 1.25+: WaitGroup.Go()
            defer s.running.Delete(job.ID)

            if err := s.execute(ctx, job); err != nil {
                s.logger.Error("executing job", "id", job.ID, "error", err)
            }

            if err := s.store.RecordExecution(ctx, job); err != nil {
                s.logger.Error("recording execution", "id", job.ID, "error", err)
            }
        })
    }
    // Note: wg.Wait() not called here — jobs run in background (fire-and-forget per tick)
}
```

---

## 11. Modular Monolith

Single binary, well-separated packages — the sweet spot between monolith and microservices:

```
cmd/app/main.go           # Wires everything, starts server
internal/
  telegram/               # All Telegram I/O (bot, handlers, rendering)
  bridge/                 # IPC with external process
  agents/                 # Agent loading, routing, classification
  cron/                   # Scheduler, store, runtime
  session/                # In-memory session tracking
  persona/                # Identity and prompt building
  config/                 # Configuration management
  runtime/                # Path resolution, directory setup
```

**Why modular monolith:**
- Single binary to deploy (no service mesh, no container orchestration)
- Packages enforce boundaries (`internal/` is compiler-checked)
- Refactoring is safe — compiler catches broken imports
- Can extract to microservices later if needed (packages are already isolated)
- Perfect for small-to-medium teams and single-machine deployment

**Rules:**
- Packages communicate via interfaces, not concrete types from other packages
- No circular imports (Go compiler enforces this)
- Each package has its own error types
- `main.go` is the only place that knows about all packages
