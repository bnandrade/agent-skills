# Laravel AI SDK

First-party AI integration for Laravel 13. Unified API for agents, tools, structured output, embeddings, images, audio, and more — across multiple providers.

---

## Table of Contents

1. [Overview & Configuration](#1-overview--configuration)
2. [Agents](#2-agents)
3. [Tools](#3-tools)
4. [Structured Output](#4-structured-output)
5. [Conversation Memory](#5-conversation-memory)
6. [Streaming & Broadcasting](#6-streaming--broadcasting)
7. [Embeddings & Vector Search](#7-embeddings--vector-search)
8. [Image Generation](#8-image-generation)
9. [Audio (TTS & STT)](#9-audio-tts--stt)
10. [Reranking](#10-reranking)
11. [Files & Vector Stores](#11-files--vector-stores)
12. [Failover](#12-failover)
13. [Testing](#13-testing)
14. [Provider Support Matrix](#14-provider-support-matrix)

---

## 1. Overview & Configuration

The Laravel AI SDK ships with Laravel 13. Install provider-specific SDKs as needed:

```bash
# Already included in Laravel 13
# Install additional providers:
composer require openai/openai-php
composer require anthropic/anthropic-php
```

### Configuration

```php
// config/ai.php (published automatically)
return [
    'default' => env('AI_PROVIDER', 'openai'),

    'providers' => [
        'openai' => [
            'key' => env('OPENAI_API_KEY'),
            'organization' => env('OPENAI_ORGANIZATION'),
            'model' => env('AI_MODEL', 'gpt-5'),
        ],
        'anthropic' => [
            'key' => env('ANTHROPIC_API_KEY'),
            'model' => env('AI_MODEL', 'claude-sonnet-5'),
        ],
        'gemini' => [
            'key' => env('GOOGLE_AI_KEY'),
            'model' => env('AI_MODEL', 'gemini-2.5-pro'),
        ],
        'groq' => [
            'key' => env('GROQ_API_KEY'),
            'model' => env('AI_MODEL', 'llama-4-scout-17b'),
        ],
        'ollama' => [
            'url' => env('OLLAMA_URL', 'http://localhost:11434'),
            'model' => env('AI_MODEL', 'llama3'),
        ],
    ],
];
```

### Basic Usage

```php
use Illuminate\Support\Facades\Ai;

// Simple text generation
$response = Ai::text('Summarize this article: ' . $article->body);
echo $response->text;

// With specific provider
$response = Ai::using('anthropic')->text('Explain quantum computing');

// With model override
$response = Ai::using('openai', model: 'gpt-5')->text('Quick answer');
```

---

## 2. Agents

Agents are the core abstraction — an LLM with instructions, tools, and memory.

### Creating an Agent

```bash
php artisan make:agent CustomerSupportAgent
# Creates app/Agents/CustomerSupportAgent.php
```

```php
namespace App\Agents;

use Illuminate\AI\Agent;
use Illuminate\AI\Attributes\Tool;
use Illuminate\AI\Attributes\Instructions;
use Illuminate\AI\Attributes\Provider;
use Illuminate\AI\Attributes\Model;

#[Provider('anthropic')]
#[Model('claude-sonnet-5')]
#[Instructions(<<<'PROMPT'
You are a customer support agent for Acme Corp.
- Always check the order status before answering shipping questions.
- Be concise, professional, and empathetic.
- If you cannot resolve the issue, escalate to a human agent.
PROMPT)]
class CustomerSupportAgent extends Agent
{
    // Tools are defined as methods (see section 3)

    #[Tool('Look up an order by ID')]
    public function lookupOrder(string $orderId): array
    {
        $order = Order::where('order_number', $orderId)->firstOrFail();

        return [
            'id' => $order->order_number,
            'status' => $order->status->value,
            'items' => $order->items->pluck('name')->toArray(),
            'tracking' => $order->tracking_number,
        ];
    }
}
```

### Running an Agent

```php
use App\Agents\CustomerSupportAgent;

// Simple invocation
$response = CustomerSupportAgent::run('Where is my order #12345?');
echo $response->text;

// With context/messages
$response = CustomerSupportAgent::run(
    messages: [
        ['role' => 'user', 'content' => 'I placed an order 3 days ago'],
        ['role' => 'assistant', 'content' => 'I can help! What is your order number?'],
        ['role' => 'user', 'content' => 'Order #12345'],
    ],
);
```

### Agent with Dependencies (Injection)

```php
#[Instructions('You analyze sales data and provide insights.')]
class SalesAnalystAgent extends Agent
{
    public function __construct(
        private readonly SalesRepository $sales,
        private readonly CacheManager $cache,
    ) {}

    #[Tool('Get sales data for a date range')]
    public function getSalesData(string $from, string $to): array
    {
        return $this->cache->remember(
            "sales:{$from}:{$to}",
            3600,
            fn () => $this->sales->getRange($from, $to),
        );
    }
}

// Laravel auto-resolves dependencies from the container
$response = SalesAnalystAgent::run('How were sales last month?');
```

---

## 3. Tools

Tools let agents call PHP functions. Each tool has a name, description, and typed parameters.

### Tool as Agent Method (Preferred)

```php
class ResearchAgent extends Agent
{
    #[Tool('Search the knowledge base for relevant articles')]
    public function searchKnowledgeBase(
        string $query,
        int $limit = 5,
    ): array {
        return Article::search($query)->take($limit)->get()->map(fn ($a) => [
            'title' => $a->title,
            'excerpt' => Str::limit($a->body, 200),
            'url' => route('articles.show', $a),
        ])->toArray();
    }

    #[Tool('Get current weather for a city')]
    public function getWeather(string $city): array
    {
        $response = Http::get('https://api.weather.com/v1/current', [
            'city' => $city,
            'key' => config('services.weather.key'),
        ]);

        return $response->json();
    }
}
```

### Standalone Tool Classes

For reusable tools shared across agents:

```bash
php artisan make:tool SearchProducts
# Creates app/Tools/SearchProducts.php
```

```php
namespace App\Tools;

use Illuminate\AI\Tool;

class SearchProducts extends Tool
{
    public string $description = 'Search the product catalog by name or category';

    public function handle(
        string $query,
        ?string $category = null,
        int $limit = 10,
    ): array {
        return Product::query()
            ->when($category, fn ($q) => $q->where('category', $category))
            ->search($query)
            ->take($limit)
            ->get()
            ->toArray();
    }
}
```

```php
// Register tools from external classes
#[Instructions('You help customers find products.')]
class ShoppingAgent extends Agent
{
    protected array $tools = [
        SearchProducts::class,
        CheckInventory::class,
    ];
}
```

### WRONG/CORRECT: Tool Design

```php
// WRONG: tool that does too much — agent can't reason about it
#[Tool('Handle the entire checkout process')]
public function checkout(int $userId, array $items, string $paymentMethod): array
{
    // 200 lines of logic...
}

// CORRECT: small, focused tools the agent composes
#[Tool('Get the user cart contents')]
public function getCart(int $userId): array { /* ... */ }

#[Tool('Calculate total with tax and shipping')]
public function calculateTotal(array $items, string $region): array { /* ... */ }

#[Tool('Process payment')]
public function processPayment(int $userId, float $amount, string $method): array { /* ... */ }
```

```php
// WRONG: tool returns raw Eloquent model (serialization issues, data leak)
#[Tool('Get user')]
public function getUser(int $id): User
{
    return User::find($id);
}

// CORRECT: return clean arrays with only what the agent needs
#[Tool('Get user profile')]
public function getUser(int $id): array
{
    $user = User::findOrFail($id);

    return [
        'name' => $user->name,
        'email' => $user->email,
        'plan' => $user->plan->value,
        'member_since' => $user->created_at->diffForHumans(),
    ];
}
```

---

## 4. Structured Output

Force the agent to return data matching a JSON Schema — ideal for pipelines.

### Using PHP Classes (Recommended)

```php
use Illuminate\AI\Attributes\Schema;

class SentimentResult
{
    public function __construct(
        #[Schema(description: 'Sentiment label')]
        public readonly string $sentiment, // positive, negative, neutral

        #[Schema(description: 'Confidence from 0.0 to 1.0')]
        public readonly float $confidence,

        #[Schema(description: 'Key phrases that influenced the analysis')]
        public readonly array $keyPhrases,
    ) {}
}

$result = Ai::structured(
    prompt: "Analyze sentiment: '{$review->text}'",
    schema: SentimentResult::class,
);

// $result is a SentimentResult instance
echo $result->sentiment;    // "positive"
echo $result->confidence;   // 0.92
```

### Using Enums for Constrained Output

```php
enum ContentCategory: string
{
    case Tech = 'tech';
    case Business = 'business';
    case Health = 'health';
    case Entertainment = 'entertainment';
    case Other = 'other';
}

class ClassificationResult
{
    public function __construct(
        public readonly ContentCategory $category,
        public readonly float $confidence,
        public readonly string $reasoning,
    ) {}
}

$result = Ai::structured(
    prompt: "Classify this article: {$article->title}",
    schema: ClassificationResult::class,
);
// $result->category is a ContentCategory enum
```

### Inline JSON Schema

```php
$result = Ai::structured(
    prompt: 'Extract entities from: ' . $text,
    schema: [
        'type' => 'object',
        'properties' => [
            'people' => ['type' => 'array', 'items' => ['type' => 'string']],
            'places' => ['type' => 'array', 'items' => ['type' => 'string']],
            'dates' => ['type' => 'array', 'items' => ['type' => 'string']],
        ],
        'required' => ['people', 'places', 'dates'],
    ],
);
// $result is an array
```

---

## 5. Conversation Memory

Persist multi-turn conversations with the `RemembersConversations` trait.

```php
use Illuminate\AI\Concerns\RemembersConversations;

#[Instructions('You are a helpful coding tutor.')]
class TutorAgent extends Agent
{
    use RemembersConversations;

    // Memory is stored per-user by default (uses auth()->id())
    // Override to customize the memory key:
    protected function conversationKey(): string
    {
        return 'tutor:' . auth()->id();
    }

    // Max messages to keep in context window (oldest pruned first)
    protected int $maxMessages = 50;
}
```

### Usage in a Controller

```php
class ChatController extends Controller
{
    public function message(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'message' => ['required', 'string', 'max:5000'],
        ]);

        // Agent automatically loads prior messages for this user
        $response = TutorAgent::run($validated['message']);

        return response()->json([
            'reply' => $response->text,
            'tokens_used' => $response->usage->totalTokens,
        ]);
    }

    public function clearHistory(): JsonResponse
    {
        TutorAgent::forgetConversation(auth()->id());

        return response()->json(['status' => 'cleared']);
    }
}
```

### Storage Backends

```php
// config/ai.php
'memory' => [
    'driver' => env('AI_MEMORY_DRIVER', 'database'), // database, redis, cache
    'table' => 'ai_conversations', // for database driver
    'ttl' => 60 * 60 * 24, // 24 hours
],
```

```bash
php artisan migrate # creates ai_conversations table
```

---

## 6. Streaming & Broadcasting

### Streaming Responses

```php
// In a controller — returns Server-Sent Events (SSE)
public function stream(Request $request): StreamedResponse
{
    return Ai::stream(
        prompt: $request->input('message'),
        provider: 'anthropic',
    )->toResponse();
}
```

### Streaming with Agents

```php
$stream = CustomerSupportAgent::stream('Where is my order #12345?');

foreach ($stream as $chunk) {
    echo $chunk->text; // incremental text
    if ($chunk->toolCall) {
        echo "Calling tool: {$chunk->toolCall->name}";
    }
}
```

### Broadcasting via Reverb (WebSocket)

Push agent responses to the frontend in real-time:

```php
use Illuminate\AI\Events\AgentStreaming;

class ChatController extends Controller
{
    public function ask(Request $request): JsonResponse
    {
        $conversationId = $request->input('conversation_id');

        // Run agent in background — streams via WebSocket
        CustomerSupportAgent::streamAndBroadcast(
            message: $request->input('message'),
            channel: "conversation.{$conversationId}",
            event: AgentStreaming::class,
        );

        return response()->json(['status' => 'streaming']);
    }
}
```

```javascript
// Frontend (Echo + Reverb)
Echo.private(`conversation.${conversationId}`)
    .listen('AgentStreaming', (e) => {
        appendToChat(e.chunk);     // incremental text
        if (e.finished) {
            showComplete(e.fullText);
        }
    });
```

---

## 7. Embeddings & Vector Search

### Creating Embeddings

```php
use Illuminate\Support\Facades\Ai;

// Single embedding
$embedding = Ai::embed('What is Laravel?');
// Returns float[] (e.g., 1536 dimensions for OpenAI ada-3)

// Batch embeddings (more efficient)
$embeddings = Ai::embedMany([
    'What is Laravel?',
    'How do queues work?',
    'Explain Eloquent relationships',
]);
// Returns array of float[]
```

### Storing Embeddings in Eloquent

```bash
php artisan make:migration add_embedding_to_articles
```

```php
// Migration
Schema::table('articles', function (Blueprint $table) {
    $table->vector('embedding', dimensions: 1536)->nullable();
    $table->index('embedding', type: 'ivfflat'); // pgvector index
});
```

```php
// Model
class Article extends Model
{
    protected function casts(): array
    {
        return [
            'embedding' => 'vector',
        ];
    }

    public function generateEmbedding(): void
    {
        $this->update([
            'embedding' => Ai::embed($this->title . ' ' . $this->body),
        ]);
    }
}
```

### Native Vector Search (pgvector)

```php
// Find similar articles — uses cosine distance by default
$similar = Article::query()
    ->whereVectorSimilarTo('embedding', $queryEmbedding, distance: 0.3)
    ->orderByVectorSimilarity('embedding', $queryEmbedding)
    ->limit(10)
    ->get();
```

### Semantic Search Pipeline

```php
class SemanticSearchController extends Controller
{
    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'query' => ['required', 'string', 'max:500'],
        ]);

        // 1. Embed the query
        $queryVector = Ai::embed($validated['query']);

        // 2. Find similar documents
        $articles = Article::query()
            ->whereVectorSimilarTo('embedding', $queryVector, distance: 0.4)
            ->orderByVectorSimilarity('embedding', $queryVector)
            ->limit(5)
            ->get();

        // 3. (Optional) Use AI to synthesize an answer
        $context = $articles->map(fn ($a) => $a->body)->join("\n\n---\n\n");

        $answer = Ai::text(<<<PROMPT
        Based on these documents:
        {$context}

        Answer this question: {$validated['query']}
        PROMPT);

        return response()->json([
            'answer' => $answer->text,
            'sources' => ArticleResource::collection($articles),
        ]);
    }
}
```

### WRONG/CORRECT: Embedding Strategies

```php
// WRONG: embedding on every request (slow, expensive)
public function show(Article $article)
{
    $similar = Article::query()
        ->whereVectorSimilarTo('embedding', Ai::embed($article->body))
        ->get();
}

// CORRECT: pre-compute embeddings, store in DB
// Use observer or listener to generate on save
class ArticleObserver
{
    public function saved(Article $article): void
    {
        if ($article->wasChanged(['title', 'body'])) {
            GenerateEmbedding::dispatch($article);
        }
    }
}

public function show(Article $article)
{
    $similar = Article::query()
        ->whereVectorSimilarTo('embedding', $article->embedding)
        ->limit(5)
        ->get();
}
```

---

## 8. Image Generation

```php
use Illuminate\Support\Facades\Ai;

// Generate an image
$image = Ai::image(
    prompt: 'A serene mountain landscape at sunset, oil painting style',
    provider: 'openai', // openai, gemini, xai
    size: '1024x1024',
);

// Save to disk
Storage::put('images/landscape.png', $image->content);

// Get as base64
$base64 = $image->toBase64();

// Generate with options
$image = Ai::image(
    prompt: 'Product photo of a red sneaker',
    provider: 'openai',
    model: 'gpt-image-1',
    size: '1536x1024',
    quality: 'high',
    background: 'transparent',
);
```

### Image Input (Vision)

```php
$response = Ai::text(
    prompt: 'Describe what you see in this image',
    images: [
        Storage::get('uploads/photo.jpg'),
        // or URL:
        'https://example.com/image.png',
    ],
);
```

---

## 9. Audio (TTS & STT)

### Text-to-Speech

```php
$audio = Ai::speak(
    text: 'Welcome to our application!',
    voice: 'alloy', // alloy, echo, fable, onyx, nova, shimmer
    provider: 'openai',
);

Storage::put('audio/welcome.mp3', $audio->content);

// Stream TTS for long text
return Ai::speak(
    text: $article->body,
    voice: 'nova',
)->toStreamedResponse();
```

### Speech-to-Text

```php
$transcription = Ai::transcribe(
    audio: Storage::get('recordings/meeting.mp3'),
    language: 'en',
    provider: 'openai',
);

echo $transcription->text;

// With timestamps
$transcription = Ai::transcribe(
    audio: $request->file('audio')->get(),
    timestamps: 'word', // 'word' or 'segment'
);

foreach ($transcription->segments as $segment) {
    echo "[{$segment->start}s] {$segment->text}\n";
}
```

---

## 10. Reranking

Rerank search results by semantic relevance using Cohere or Jina:

```php
use Illuminate\Support\Facades\Ai;

$documents = Article::search($query)->take(20)->get();

$reranked = Ai::rerank(
    query: $query,
    documents: $documents->pluck('body')->toArray(),
    provider: 'cohere', // cohere, jina
    topN: 5,
);

// $reranked contains indices and relevance scores
foreach ($reranked->results as $result) {
    $article = $documents[$result->index];
    echo "{$article->title} (score: {$result->relevanceScore})\n";
}
```

### RAG Pipeline with Reranking

```php
// 1. Broad vector search
$candidates = Article::query()
    ->whereVectorSimilarTo('embedding', Ai::embed($query), distance: 0.5)
    ->limit(20)
    ->get();

// 2. Rerank for precision
$reranked = Ai::rerank(
    query: $query,
    documents: $candidates->pluck('body')->toArray(),
    topN: 5,
);

// 3. Use top results as context
$topArticles = $reranked->results->map(fn ($r) => $candidates[$r->index]);

$answer = Ai::text(
    prompt: "Answer based on: " . $topArticles->pluck('body')->join("\n\n") .
            "\n\nQuestion: {$query}",
);
```

---

## 11. Files & Vector Stores

For provider-managed file storage and retrieval (OpenAI Assistants, etc.):

```php
// Upload file to provider
$file = Ai::files()->upload(
    content: Storage::get('documents/manual.pdf'),
    purpose: 'assistants',
);

// Create a vector store
$store = Ai::vectorStores()->create(
    name: 'Product Documentation',
    fileIds: [$file->id],
);

// Query the vector store
$results = Ai::vectorStores()->search(
    storeId: $store->id,
    query: 'How to reset password?',
    maxResults: 5,
);

// Use with an agent
#[Instructions('Answer questions using the documentation.')]
class DocsAgent extends Agent
{
    protected array $vectorStores = ['vs_abc123'];
}
```

---

## 12. Failover

Automatically fall back to another provider when one fails:

```php
// config/ai.php
'failover' => [
    'providers' => ['anthropic', 'openai', 'gemini'],
    'retry' => 2,           // retries per provider before failover
    'throw' => true,        // throw if all providers fail
],
```

```php
// Or per-request
$response = Ai::withFailover(['anthropic', 'openai', 'gemini'])
    ->text('Summarize this document...');

// Provider used is available on the response
echo $response->provider; // "anthropic" or fallback
echo $response->model;    // actual model used
```

### WRONG/CORRECT: Failover Configuration

```php
// WRONG: wrapping in try/catch for manual failover
try {
    $response = Ai::using('anthropic')->text($prompt);
} catch (\Exception $e) {
    try {
        $response = Ai::using('openai')->text($prompt);
    } catch (\Exception $e) {
        $response = Ai::using('gemini')->text($prompt);
    }
}

// CORRECT: use built-in failover
$response = Ai::withFailover(['anthropic', 'openai', 'gemini'])
    ->text($prompt);
```

---

## 13. Testing

### Faking AI Responses

```php
use Illuminate\Support\Facades\Ai;

it('generates a summary', function () {
    Ai::fake([
        Ai::textResponse('This is a summarized version of the article.'),
    ]);

    $response = app(SummaryService::class)->summarize('Long article text...');

    expect($response)->toBe('This is a summarized version of the article.');

    Ai::assertSent(function ($request) {
        return str_contains($request->prompt, 'Long article text');
    });

    Ai::assertSentCount(1);
});
```

### Faking Agent Responses

```php
it('customer support agent looks up orders', function () {
    Ai::fake([
        Ai::agentResponse(
            text: 'Your order #12345 is being shipped. Tracking: TRK789.',
            toolCalls: [
                Ai::toolCall('lookupOrder', ['orderId' => '12345']),
            ],
        ),
    ]);

    $response = CustomerSupportAgent::run('Where is order #12345?');

    expect($response->text)->toContain('shipped');

    Ai::assertToolCalled('lookupOrder', function ($args) {
        return $args['orderId'] === '12345';
    });
});
```

### Faking Embeddings

```php
it('performs semantic search', function () {
    Ai::fake([
        Ai::embedResponse(array_fill(0, 1536, 0.1)),
    ]);

    $results = app(SearchService::class)->semanticSearch('test query');

    expect($results)->toHaveCount(5);
    Ai::assertEmbedded('test query');
});
```

### Faking Structured Output

```php
it('classifies content', function () {
    Ai::fake([
        Ai::structuredResponse(new ClassificationResult(
            category: ContentCategory::Tech,
            confidence: 0.95,
            reasoning: 'Article discusses programming concepts.',
        )),
    ]);

    $result = app(ClassificationService::class)->classify($article);

    expect($result->category)->toBe(ContentCategory::Tech);
    expect($result->confidence)->toBeGreaterThan(0.9);
});
```

### Preventing Real API Calls

```php
// In TestCase.php or Pest.php
beforeEach(function () {
    Ai::fake(); // empty fake — throws if any AI call is made
});
```

---

## 14. Provider Support Matrix

| Feature | OpenAI | Anthropic | Gemini | Groq | xAI | DeepSeek | Mistral | Ollama |
|---|---|---|---|---|---|---|---|---|
| Text Generation | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Streaming | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Structured Output | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Partial |
| Tool Calling | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Partial |
| Embeddings | Yes | No | Yes | No | No | No | Yes | Yes |
| Image Generation | Yes | No | Yes | No | Yes | No | No | No |
| Image Input (Vision) | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial |
| TTS | Yes | No | Yes | No | No | No | No | No |
| STT | Yes | No | Yes | Yes | No | No | No | No |
| Reranking | No | No | No | No | No | No | No | No |
| Files / Vector Stores | Yes | No | No | No | No | No | No | No |

**Reranking providers:** Cohere, Jina (require separate config in `config/ai.php`).

### Quick Reference: Common Patterns

```php
// Text generation
Ai::text('prompt');
Ai::using('anthropic')->text('prompt');

// Structured output
Ai::structured('prompt', MyClass::class);

// Embeddings
Ai::embed('text');
Ai::embedMany(['text1', 'text2']);

// Images
Ai::image(prompt: 'description', provider: 'openai');

// Audio
Ai::speak(text: 'hello', voice: 'nova');
Ai::transcribe(audio: $bytes);

// Reranking
Ai::rerank(query: 'q', documents: [...], provider: 'cohere');

// Failover
Ai::withFailover(['anthropic', 'openai'])->text('prompt');

// Testing
Ai::fake([Ai::textResponse('mocked')]);
Ai::assertSent(...);
```
