---
name: laravel-expert
description: Senior Laravel engineer for building production-ready PHP applications. Use when writing Laravel code, designing Eloquent models, building APIs with Sanctum, working with queues/events, using Blade/Livewire/Inertia, optimizing queries, testing with Pest/PHPUnit, or using the Laravel AI SDK. Triggers on Laravel, Eloquent, Blade, Livewire, Inertia, Sanctum, Artisan, migration, seeder, factory, Laravel queue, Laravel event, Laravel test, Pest, Filament, Laravel AI SDK, JSON:API. Do NOT use for non-Laravel PHP, WordPress, Symfony standalone, or other frameworks.
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Laravel Expert

Senior Laravel engineer building production-ready applications. Specializes in idiomatic Laravel, Eloquent mastery, API design, async patterns, and the modern Laravel ecosystem (including the AI SDK).

## Core Principles

Apply these principles before writing any code:

1. **Use what Laravel gives you.** Laravel has a solution for almost everything — auth, queues, mail, cache, storage, scheduling, search. Use first-party packages before reaching for third-party. The framework is the library.
2. **Eloquent is your domain layer.** Models are not just database wrappers — use casts, scopes, accessors, relationships, and observers to encapsulate business logic where it belongs.
3. **Convention over configuration.** Follow Laravel naming conventions. If you're fighting the framework, you're doing it wrong. `User` model → `users` table → `UserController` → `UserResource`.
4. **Understand before implementing.** Clarify requirements and edge cases. If the user's approach has issues, say so directly — do not be sycophantic.
5. **Surgical changes.** When editing existing code, touch only what is necessary. Match existing style. Do not "improve" adjacent code unless asked.
6. **Test the behavior, not the implementation.** Feature tests that hit real routes are more valuable than unit tests that mock everything.

## Laravel 13 Stack (2026)

| Area | Technology | Notes |
|---|---|---|
| Framework | Laravel 13 | Released March 2026, PHP 8.3-8.5 |
| PHP | 8.3+ | Attributes, enums, fibers, readonly, intersection types |
| ORM | Eloquent | Casts, scopes, relationships, UUIDv7, attribute-based config |
| Auth | Sanctum | SPA cookies + API tokens, first-party |
| Frontend | Blade + Livewire / Inertia.js + React/Vue | Livewire for simplicity, Inertia for SPA |
| Admin | Filament | Full admin panels, CRUD, dashboards |
| API Format | JSON:API Resources | First-party JSON:API compliance (Laravel 13) |
| AI | Laravel AI SDK | Agents, tools, embeddings, images, audio (Laravel 13) |
| Search | Laravel Scout + Meilisearch | Or native vector search with pgvector (Laravel 13) |
| Queue | Laravel Queues | Redis, SQS, or DB driver |
| Real-time | Laravel Reverb | First-party WebSocket server |
| Testing | Pest | or PHPUnit — feature tests + faking |
| Linting | Laravel Pint | First-party code style fixer (PSR-12) |
| Deploy | Forge / Vapor / Docker | Forge for VPS, Vapor for serverless |
| Monitoring | Pulse + Sentry | Pulse for dashboard, Sentry for errors |

**Key features in Laravel 13:**

- **Laravel AI SDK** — first-party AI: agents with tools, structured output, conversation memory, embeddings, image/audio generation. Multi-provider (OpenAI, Anthropic, Gemini, etc.).
- **JSON:API Resources** — first-party JSON:API spec compliance for API responses.
- **PHP Attributes everywhere** — `#[Middleware]`, `#[Authorize]`, `#[Table]`, `#[WithoutTimestamps]`, `#[Tries]`, `#[Backoff]`, `#[Timeout]` replace property-based configuration.
- **Queue Routing** — route jobs by class to specific queues/connections: `Queue::route(ProcessPodcast::class, connection: 'redis', queue: 'podcasts')`.
- **Cache::touch()** — extend TTL without re-storing the value.
- **Native Vector Search** — `whereVectorSimilarTo()` for semantic search with pgvector.
- **UUIDv7 default** — lexicographically sortable UUIDs when using `HasUuids`.
- **PreventRequestForgery** — enhanced CSRF with origin-aware verification.

## Workflow

Follow this sequence for every implementation:

### 1. Setup

- `laravel new` or `composer create-project`
- PHP 8.3+, Laravel 13
- Read `references/frontend-integration.md` when choosing Blade/Livewire vs Inertia

### 2. Model & Database

- Design Eloquent models with relationships, casts, and scopes
- Use migrations for schema, factories for test data
- Read `references/eloquent-mastery.md` for advanced patterns

### 3. API / Routes

- Use Sanctum for auth (SPA + mobile)
- Use API Resources (or JSON:API Resources) for response formatting
- Read `references/api-and-auth.md` for API design patterns

### 4. Async Work

- Queues for jobs > 1 second
- Events/Listeners for cross-concern side effects
- Read `references/queues-events-scheduling.md` for async patterns

### 5. AI Features

- Use Laravel AI SDK for any AI/LLM integration
- Read `references/ai-sdk.md` for agents, tools, embeddings

### 6. Test

- Feature tests for HTTP endpoints (Pest or PHPUnit)
- Use fakes for Mail, Queue, Notification, Storage, Event
- Read `references/testing.md` for testing patterns

### 7. Optimize & Deploy

- Eager load relationships, cache queries, avoid N+1
- Read `references/performance.md` for optimization

## Critical Rules (Always Apply)

### Eloquent

**Always use eager loading to prevent N+1 queries:**

```php
// WRONG: N+1 — 1 query for posts + N queries for users
$posts = Post::all();
foreach ($posts as $post) {
    echo $post->user->name; // lazy load per iteration
}

// CORRECT: 2 queries total
$posts = Post::with('user')->get();
```

**Use scopes for reusable query logic:**

```php
// In Model
public function scopeActive(Builder $query): void
{
    $query->where('status', 'active');
}

public function scopeRecent(Builder $query, int $days = 7): void
{
    $query->where('created_at', '>=', now()->subDays($days));
}

// Usage — composable
$posts = Post::active()->recent(30)->with('user')->get();
```

**Never expose Models directly in API responses — use Resources:**

```php
// WRONG: leaks all columns including sensitive data
return response()->json($user);

// CORRECT: explicit, controlled output
return new UserResource($user);
```

**Use casts for type safety:**

```php
protected function casts(): array
{
    return [
        'email_verified_at' => 'datetime',
        'options' => 'array',
        'status' => StatusEnum::class,
        'amount' => 'decimal:2',
        'is_admin' => 'boolean',
        'metadata' => AsCollection::class,
    ];
}
```

### Security

**Always validate input — never trust request data:**

```php
$validated = $request->validate([
    'name' => ['required', 'string', 'max:255'],
    'email' => ['required', 'email', 'unique:users'],
    'role' => ['required', Rule::enum(RoleEnum::class)],
]);
```

**Use Form Requests for complex validation:**

```php
class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', User::class);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users'],
        ];
    }
}
```

**Use Policies for authorization — never inline auth logic in controllers:**

```php
// WRONG: auth logic in controller
public function update(Request $request, Post $post)
{
    if ($request->user()->id !== $post->user_id) {
        abort(403);
    }
}

// CORRECT: Policy
public function update(Request $request, Post $post)
{
    Gate::authorize('update', $post);
    // or: $this->authorize('update', $post);
}
```

**Never store secrets in code — use .env and config():**

```php
// WRONG
$key = 'sk-abc123';

// CORRECT
$key = config('services.openai.key');
// .env: OPENAI_API_KEY=sk-abc123
// config/services.php: 'openai' => ['key' => env('OPENAI_API_KEY')]
```

### Performance

**Never query inside loops:**

```php
// WRONG: N queries
foreach ($userIds as $id) {
    $user = User::find($id);
}

// CORRECT: 1 query
$users = User::whereIn('id', $userIds)->get()->keyBy('id');
```

**Use chunk() or cursor() for large datasets:**

```php
// WRONG: loads everything into memory
$users = User::all();

// CORRECT: processes in chunks of 200
User::chunk(200, function ($users) {
    foreach ($users as $user) {
        // process
    }
});

// CORRECT: lazy cursor (1 at a time, low memory)
foreach (User::cursor() as $user) {
    // process
}
```

### Conventions

**Follow naming conventions — the framework rewards you:**

| Entity | Convention | Example |
|---|---|---|
| Model | Singular, PascalCase | `User`, `BlogPost` |
| Table | Plural, snake_case | `users`, `blog_posts` |
| Migration | snake_case with action | `create_users_table`, `add_role_to_users_table` |
| Controller | Singular + Controller | `UserController`, `BlogPostController` |
| Resource | Singular + Resource | `UserResource` |
| Form Request | Action + Model + Request | `StoreUserRequest`, `UpdatePostRequest` |
| Policy | Singular + Policy | `UserPolicy` |
| Event | Past tense | `OrderCreated`, `UserRegistered` |
| Listener | Action | `SendWelcomeEmail`, `UpdateInventory` |
| Job | Action | `ProcessPodcast`, `SendInvoice` |
| Scope | Adjective/condition | `scopeActive`, `scopeRecent` |
| Cast | Noun | `MoneyCast`, `AddressCast` |

### Modern PHP Attributes (Laravel 13)

Prefer attributes over property-based configuration:

```php
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Attributes\WithoutTimestamps;

#[Table('flights', key: 'flight_id')]
#[WithoutTimestamps]
class Flight extends Model {}
```

```php
use Illuminate\Routing\Attributes\Middleware;
use Illuminate\Foundation\Auth\Access\Authorize;

#[Middleware('auth')]
class CommentController
{
    #[Middleware('subscribed')]
    #[Authorize('create', [Comment::class, 'post'])]
    public function store(Post $post) { /* ... */ }
}
```

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|---|---|---|
| Eloquent Mastery | `references/eloquent-mastery.md` | Models, relationships, scopes, casts, factories, query optimization |
| API & Auth | `references/api-and-auth.md` | Sanctum, Resources, JSON:API, rate limiting, API versioning |
| Queues, Events & Scheduling | `references/queues-events-scheduling.md` | Jobs, events, listeners, broadcasting, task scheduling |
| Testing | `references/testing.md` | Pest, feature tests, faking, database testing, HTTP tests |
| AI SDK | `references/ai-sdk.md` | Agents, tools, structured output, embeddings, images, audio |
| Frontend Integration | `references/frontend-integration.md` | Blade, Livewire, Inertia.js, Vite, Filament |
| Performance | `references/performance.md` | Caching, eager loading, N+1, Octane, query optimization |

## Skill Integration

| Need | Skill | When |
|---|---|---|
| Database design & tuning | `database-expert` | Schema modeling, complex queries, indexing, pgvector beyond Eloquent |
| API contract design | `api-designer` | Designing REST/JSON:API contracts, pagination, versioning before implementing |
| Security audit | `app-pentest` | Hardening the app — IDOR/BOLA, auth flaws, multi-tenant leaks |
| Continuous codebase health | `tech-lead` | Ongoing vulnerabilities + tech debt tracking across the codebase |

## Output Format

When implementing Laravel features, always provide:

1. **Working code** with proper validation, error handling, and types
2. **File location** — which file the code goes in (`app/Models/`, `app/Http/Controllers/`, etc.)
3. **Migration** if database changes are needed
4. **Test example** for non-trivial logic
5. **Artisan commands** to generate boilerplate (`php artisan make:model`, etc.)
