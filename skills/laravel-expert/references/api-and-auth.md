# API & Auth

Patterns para construir APIs REST robustas com Laravel. Sanctum, Resources, JSON:API, rate limiting, validacao, autorizacao.

---

## Table of Contents

1. [Sanctum Setup](#1-sanctum-setup)
2. [API Resources](#2-api-resources)
3. [JSON:API Resources (Laravel 13)](#3-jsonapi-resources-laravel-13)
4. [Rate Limiting](#4-rate-limiting)
5. [API Versioning](#5-api-versioning)
6. [Error Handling](#6-error-handling)
7. [Pagination](#7-pagination)
8. [Filtering & Sorting](#8-filtering--sorting)
9. [Form Requests for API Validation](#9-form-requests-for-api-validation)
10. [Policies for Authorization](#10-policies-for-authorization)
11. [CORS Configuration](#11-cors-configuration)
12. [API Testing with Sanctum](#12-api-testing-with-sanctum)

---

## 1. Sanctum Setup

### 1.1 SPA Authentication (Cookie-Based)

For first-party SPAs (same domain or subdomain):

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS',
    'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1,app.example.com'
)),

// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->statefulApi(); // enables Sanctum's SPA auth
})
```

```php
// SPA login endpoint
class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        if (! Auth::attempt($request->validated())) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        $request->session()->regenerate();

        return response()->json(['message' => 'Logged in']);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Logged out']);
    }
}
```

**SPA flow:** The frontend calls `/sanctum/csrf-cookie` first, then `/login`. All subsequent API requests include the session cookie automatically.

### 1.2 API Token Authentication

For mobile apps, third-party integrations, CLI tools:

```php
class AuthController extends Controller
{
    public function createToken(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        $token = $user->createToken(
            name: $request->device_name,
            abilities: ['posts:read', 'posts:write'],
            expiresAt: now()->addDays(30),
        );

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
        ]);
    }
}

// Protect routes
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('posts', PostController::class);
});

// Check abilities
if ($request->user()->tokenCan('posts:write')) {
    // allowed
}
```

### 1.3 Token Abilities as Enum

```php
enum TokenAbility: string
{
    case PostsRead = 'posts:read';
    case PostsWrite = 'posts:write';
    case AdminFull = 'admin:full';

    public static function forRole(RoleEnum $role): array
    {
        return match ($role) {
            RoleEnum::Admin => self::cases(),
            RoleEnum::Editor => [self::PostsRead, self::PostsWrite],
            RoleEnum::Viewer => [self::PostsRead],
        };
    }
}

// Usage
$token = $user->createToken('api', TokenAbility::forRole($user->role));
```

---

## 2. API Resources

### 2.1 Basic Resource

```php
// php artisan make:resource UserResource

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'avatar_url' => $this->avatar_url,
            'role' => $this->role->value,
            'created_at' => $this->created_at->toIso8601String(),

            // Conditional relationships (only if loaded)
            'posts' => PostResource::collection($this->whenLoaded('posts')),
            'profile' => new ProfileResource($this->whenLoaded('profile')),

            // Conditional fields
            'posts_count' => $this->whenCounted('posts'),
            'orders_sum_total' => $this->whenAggregated('orders', 'total', 'sum'),

            // Only for admin requests
            'internal_notes' => $this->when(
                $request->user()?->isAdmin(),
                $this->internal_notes,
            ),
        ];
    }
}
```

### 2.2 Resource Collection with Meta

```php
class PostCollection extends ResourceCollection
{
    public function toArray(Request $request): array
    {
        return [
            'data' => $this->collection,
            'meta' => [
                'total_posts' => Post::count(),
                'filters_applied' => $request->query(),
            ],
        ];
    }
}

// Usage in controller
return new PostCollection(
    Post::with('user')->published()->paginate()
);
```

### 2.3 Wrapping & Response

```php
// Controller response
public function show(Post $post): PostResource
{
    return new PostResource(
        $post->load(['user', 'comments.user'])
    );
}

public function index(Request $request): AnonymousResourceCollection
{
    $posts = Post::with('user')
        ->published()
        ->latest()
        ->paginate();

    return PostResource::collection($posts);
}

// Disable wrapping globally (if needed)
// In AppServiceProvider::boot()
JsonResource::withoutWrapping();
```

---

## 3. JSON:API Resources (Laravel 13)

First-party JSON:API spec compliance:

```php
use Illuminate\Http\Resources\Json\JsonApiResource;

class PostResource extends JsonApiResource
{
    public function toAttributes(Request $request): array
    {
        return [
            'title' => $this->title,
            'slug' => $this->slug,
            'body' => $this->body,
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }

    public function toRelationships(Request $request): array
    {
        return [
            'author' => $this->belongsToOne(
                $this->whenLoaded('user'),
                UserResource::class,
            ),
            'comments' => $this->hasMany(
                $this->whenLoaded('comments'),
                CommentResource::class,
            ),
        ];
    }

    public function toLinks(Request $request): array
    {
        return [
            'self' => route('posts.show', $this->resource),
        ];
    }

    public function toMeta(Request $request): array
    {
        return [
            'views' => $this->views,
        ];
    }
}
```

**Response format:**

```json
{
    "data": {
        "type": "posts",
        "id": "01HQJY3V8Z",
        "attributes": {
            "title": "Laravel 13 Guide",
            "slug": "laravel-13-guide",
            "body": "...",
            "published_at": "2026-03-15T10:00:00Z"
        },
        "relationships": {
            "author": {
                "data": { "type": "users", "id": "42" }
            }
        },
        "links": {
            "self": "https://api.example.com/posts/01HQJY3V8Z"
        },
        "meta": {
            "views": 1523
        }
    }
}
```

---

## 4. Rate Limiting

### 4.1 Configuration

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->throttleApi('api');
})

// In AppServiceProvider::boot()
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});

// Different limits per user type
RateLimiter::for('api', function (Request $request) {
    $user = $request->user();

    return match (true) {
        $user?->isPremium() => Limit::perMinute(120)->by($user->id),
        $user !== null => Limit::perMinute(60)->by($user->id),
        default => Limit::perMinute(20)->by($request->ip()),
    };
});
```

### 4.2 Per-Route Rate Limiting

```php
Route::middleware('throttle:uploads')->group(function () {
    Route::post('/upload', [UploadController::class, 'store']);
});

// Define the limiter
RateLimiter::for('uploads', function (Request $request) {
    return Limit::perMinute(5)
        ->by($request->user()->id)
        ->response(function (Request $request, array $headers) {
            return response()->json([
                'message' => 'Too many uploads. Try again in a minute.',
            ], 429)->withHeaders($headers);
        });
});
```

---

## 5. API Versioning

### 5.1 URI Prefix Strategy (Recommended)

```php
// routes/api.php
Route::prefix('v1')->group(function () {
    Route::apiResource('posts', V1\PostController::class);
});

Route::prefix('v2')->group(function () {
    Route::apiResource('posts', V2\PostController::class);
});

// Directory structure:
// app/Http/Controllers/Api/V1/PostController.php
// app/Http/Controllers/Api/V2/PostController.php
// app/Http/Resources/V1/PostResource.php
// app/Http/Resources/V2/PostResource.php
```

### 5.2 Header-Based (Accept Header)

```php
// Middleware to resolve version
class ApiVersion
{
    public function handle(Request $request, Closure $next): Response
    {
        $version = $request->header('Accept-Version', 'v1');
        $request->attributes->set('api_version', $version);

        return $next($request);
    }
}
```

---

## 6. Error Handling

### 6.1 Consistent API Error Responses

```php
// bootstrap/app.php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->shouldRenderJsonWhen(function (Request $request) {
        return $request->is('api/*') || $request->expectsJson();
    });

    $exceptions->render(function (NotFoundHttpException $e, Request $request) {
        if ($request->is('api/*')) {
            return response()->json([
                'error' => [
                    'status' => 404,
                    'title' => 'Not Found',
                    'detail' => 'The requested resource was not found.',
                ],
            ], 404);
        }
    });

    $exceptions->render(function (AuthorizationException $e, Request $request) {
        if ($request->is('api/*')) {
            return response()->json([
                'error' => [
                    'status' => 403,
                    'title' => 'Forbidden',
                    'detail' => $e->getMessage(),
                ],
            ], 403);
        }
    });
})
```

### 6.2 Validation Error Format

Laravel automatically returns 422 with structured errors. Customize if needed:

```php
// WRONG: inconsistent error responses
return response()->json(['msg' => 'bad request'], 400);
return response()->json(['error' => 'not found'], 404);

// CORRECT: consistent envelope
return response()->json([
    'error' => [
        'status' => 400,
        'title' => 'Bad Request',
        'detail' => 'The order total must be positive.',
        'source' => ['pointer' => '/data/attributes/total'],
    ],
], 400);
```

### 6.3 Exception to HTTP Status Mapping

```php
// Custom exceptions with render()
class InsufficientBalanceException extends Exception
{
    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'error' => [
                'status' => 422,
                'title' => 'Insufficient Balance',
                'detail' => $this->getMessage(),
            ],
        ], 422);
    }
}

// Throw in service
throw new InsufficientBalanceException("Balance of {$balance} is not enough for {$amount}.");
```

---

## 7. Pagination

### 7.1 Standard Pagination

```php
// Controller
public function index(): AnonymousResourceCollection
{
    return PostResource::collection(
        Post::with('user')->latest()->paginate(perPage: 15)
    );
}

// simplePaginate for "next/prev" only (no total count — faster)
Post::simplePaginate(15);

// cursorPaginate for infinite scroll (most performant)
Post::cursorPaginate(15);
```

### 7.2 Custom Pagination Envelope

```php
// WRONG: exposing Laravel's internal pagination URLs with server paths
return Post::paginate(); // exposes full URLs, not API-friendly

// CORRECT: let Resources handle it — they preserve pagination meta
return PostResource::collection(Post::paginate());
// Response includes: data, links (first, last, prev, next), meta (current_page, total, etc.)
```

### 7.3 Per-Page Limit

```php
public function index(Request $request): AnonymousResourceCollection
{
    $perPage = min($request->integer('per_page', 15), 100); // cap at 100

    return PostResource::collection(
        Post::latest()->paginate($perPage)
    );
}
```

---

## 8. Filtering & Sorting

### 8.1 Query Parameter Pattern

```php
// GET /api/posts?status=published&sort=-created_at&search=laravel

class PostController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $posts = Post::query()
            ->with('user')
            ->when($request->status, fn ($q, $status) =>
                $q->where('status', $status)
            )
            ->when($request->search, fn ($q, $search) =>
                $q->where('title', 'like', "%{$search}%")
            )
            ->when($request->user_id, fn ($q, $userId) =>
                $q->where('user_id', $userId)
            )
            ->tap(fn ($q) => $this->applySorting($q, $request))
            ->paginate();

        return PostResource::collection($posts);
    }

    private function applySorting(Builder $query, Request $request): void
    {
        $allowed = ['created_at', 'title', 'views'];
        $sort = $request->string('sort', '-created_at');

        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $column = ltrim($sort, '-');

        if (in_array($column, $allowed, true)) {
            $query->orderBy($column, $direction);
        }
    }
}
```

### 8.2 Dedicated Filter Class

```php
class PostFilter
{
    public function __construct(
        private readonly Builder $query,
        private readonly Request $request,
    ) {}

    public function apply(): Builder
    {
        return $this->query
            ->when($this->request->status, fn ($q, $v) => $q->where('status', $v))
            ->when($this->request->author, fn ($q, $v) => $q->whereRelation('user', 'name', 'like', "%{$v}%"))
            ->when($this->request->from, fn ($q, $v) => $q->where('created_at', '>=', $v))
            ->when($this->request->to, fn ($q, $v) => $q->where('created_at', '<=', $v))
            ->when($this->request->has('featured'), fn ($q) => $q->where('is_featured', true));
    }
}

// Usage
$posts = (new PostFilter(Post::with('user'), $request))->apply()->paginate();
```

---

## 9. Form Requests for API Validation

### 9.1 Store Request

```php
class StorePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Post::class);
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string', 'min:10'],
            'status' => ['required', Rule::enum(PostStatus::class)],
            'category_id' => ['required', 'exists:categories,id'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'max:50'],
            'publish_at' => ['nullable', 'date', 'after:now'],
        ];
    }

    public function messages(): array
    {
        return [
            'body.min' => 'The post body must be at least 10 characters.',
        ];
    }
}
```

### 9.2 Update Request with Partial Validation

```php
class UpdatePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('update', $this->route('post'));
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'string', 'max:255'],
            'body' => ['sometimes', 'string', 'min:10'],
            'status' => ['sometimes', Rule::enum(PostStatus::class)],
        ];
    }
}
```

### 9.3 Controller Usage

```php
// WRONG: validate inline in controller for complex rules
public function store(Request $request)
{
    $request->validate([/* 20 rules here */]);
}

// CORRECT: Form Request — validation + authorization in one place
public function store(StorePostRequest $request): PostResource
{
    $post = $request->user()->posts()->create($request->validated());

    return new PostResource($post);
}
```

---

## 10. Policies for Authorization

### 10.1 Policy Definition

```php
// php artisan make:policy PostPolicy --model=Post

class PostPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Post $post): bool
    {
        return $post->is_published || $user->id === $post->user_id;
    }

    public function create(User $user): bool
    {
        return $user->hasVerifiedEmail();
    }

    public function update(User $user, Post $post): bool
    {
        return $user->id === $post->user_id;
    }

    public function delete(User $user, Post $post): bool
    {
        return $user->id === $post->user_id || $user->isAdmin();
    }

    // Before — super admin bypass
    public function before(User $user, string $ability): ?bool
    {
        if ($user->isSuperAdmin()) {
            return true;
        }

        return null; // fall through to regular checks
    }
}
```

### 10.2 Using Policies in Controllers

```php
// Via authorizeResource in constructor
class PostController extends Controller
{
    public function __construct()
    {
        $this->authorizeResource(Post::class, 'post');
    }

    public function update(UpdatePostRequest $request, Post $post): PostResource
    {
        // Authorization already handled by authorizeResource
        $post->update($request->validated());
        return new PostResource($post);
    }
}

// Or via PHP Attribute (Laravel 13)
use Illuminate\Foundation\Auth\Access\Authorize;

class PostController extends Controller
{
    #[Authorize('update', [Post::class, 'post'])]
    public function update(UpdatePostRequest $request, Post $post): PostResource
    {
        $post->update($request->validated());
        return new PostResource($post);
    }
}

// Or via Gate in service layer
Gate::authorize('update', $post);
```

---

## 11. CORS Configuration

```php
// config/cors.php
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => [
        'https://app.example.com',
        'https://admin.example.com',
    ],
    'allowed_origins_patterns' => [
        '#^https://.*\.example\.com$#',
    ],
    'allowed_headers' => ['*'],
    'exposed_headers' => ['X-Request-Id'],
    'max_age' => 86400,
    'supports_credentials' => true, // required for Sanctum SPA
];
```

```php
// WRONG: wildcard origin with credentials
'allowed_origins' => ['*'],
'supports_credentials' => true, // browsers reject this combination

// CORRECT: specific origins when using credentials
'allowed_origins' => ['https://app.example.com'],
'supports_credentials' => true,
```

---

## 12. API Testing with Sanctum

### 12.1 Authenticated Requests

```php
use Laravel\Sanctum\Sanctum;

it('lists posts for authenticated user', function () {
    $user = User::factory()->create();
    Post::factory()->count(3)->for($user)->create();

    Sanctum::actingAs($user, ['posts:read']);

    $response = $this->getJson('/api/posts');

    $response
        ->assertOk()
        ->assertJsonCount(3, 'data')
        ->assertJsonStructure([
            'data' => [['id', 'title', 'created_at']],
            'meta' => ['current_page', 'total'],
        ]);
});
```

### 12.2 Testing Token Abilities

```php
it('denies write access with read-only token', function () {
    $user = User::factory()->create();

    Sanctum::actingAs($user, ['posts:read']); // no write ability

    $response = $this->postJson('/api/posts', [
        'title' => 'Test Post',
        'body' => 'Test body content for the post.',
        'status' => 'draft',
        'category_id' => Category::factory()->create()->id,
    ]);

    $response->assertForbidden();
});
```

### 12.3 Testing Validation Errors

```php
it('validates required fields on post creation', function () {
    Sanctum::actingAs(User::factory()->create());

    $response = $this->postJson('/api/posts', []);

    $response
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['title', 'body', 'status', 'category_id']);
});
```

### 12.4 Testing Authorization

```php
it('prevents editing another users post', function () {
    $author = User::factory()->create();
    $other = User::factory()->create();
    $post = Post::factory()->for($author)->create();

    Sanctum::actingAs($other);

    $response = $this->putJson("/api/posts/{$post->id}", [
        'title' => 'Hacked Title',
    ]);

    $response->assertForbidden();
});
```

### 12.5 Full CRUD Test Suite

```php
describe('PostController', function () {
    beforeEach(function () {
        $this->user = User::factory()->create();
        Sanctum::actingAs($this->user);
    });

    it('creates a post', function () {
        $category = Category::factory()->create();

        $response = $this->postJson('/api/posts', [
            'title' => 'My Post',
            'body' => 'Content for the post body.',
            'status' => 'draft',
            'category_id' => $category->id,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.title', 'My Post');

        $this->assertDatabaseHas('posts', [
            'title' => 'My Post',
            'user_id' => $this->user->id,
        ]);
    });

    it('returns 404 for missing post', function () {
        $this->getJson('/api/posts/nonexistent')
            ->assertNotFound();
    });

    it('paginates results', function () {
        Post::factory()->count(20)->for($this->user)->create();

        $response = $this->getJson('/api/posts?per_page=5');

        $response->assertOk()
            ->assertJsonCount(5, 'data')
            ->assertJsonPath('meta.total', 20);
    });
});
```
