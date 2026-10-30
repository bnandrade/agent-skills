# Language-Specific Review Patterns

Patterns e anti-patterns especificos de cada linguagem/framework. O que verificar alem dos problemas genericos.

---

## 1. PHP / Laravel

### 1.1 Mass Assignment

```php
// WRONG: accepts any field — user can set is_admin=true
User::create($request->all());

// WRONG: guarded disabled
class User extends Model { protected $guarded = []; }

// CORRECT
class User extends Model { protected $fillable = ['name', 'email', 'password']; }
// or: User::create($request->only(['name', 'email', 'password']));
```

### 1.2 N+1 with Eloquent

```php
// WRONG: N+1 — 1 query for posts, N for authors
@foreach ($posts as $post)
    <p>{{ $post->author->name }}</p>       {{-- query per post --}}
    <p>{{ $post->comments->count() }}</p>   {{-- query per post --}}
@endforeach

// CORRECT: eager load
$posts = Post::with(['author', 'comments'])->paginate(20);

// BETTER: withCount for counts
$posts = Post::with('author')->withCount('comments')->paginate(20);
// Access: $post->comments_count — no extra query, no full collection
```

### 1.3 Raw DB Queries

```php
// WRONG: injectable
DB::select("SELECT * FROM users WHERE name LIKE '%" . $search . "%'");

// CORRECT: bindings
User::whereRaw('name LIKE ?', ['%' . $search . '%'])->get();

// WRONG: orderByRaw with user input
User::orderByRaw($request->sort_column)->get();

// CORRECT: whitelist columns
$allowed = ['name', 'email', 'created_at'];
$col = in_array($request->sort_column, $allowed) ? $request->sort_column : 'created_at';
User::orderBy($col)->get();
```

### 1.4 Missing Form Requests

```php
// WRONG: validation in controller           // CORRECT: Form Request
public function store(Request $request) {    class StorePostRequest extends FormRequest {
    $validated = $request->validate([            public function authorize(): bool {
        'title' => 'required|string|max:255',        return $this->user()->can('create', Post::class);
        'body' => 'required|string',             }
        'category_id' => 'required|exists:...',  public function rules(): array {
    ]);                                              return [
    // ...                                               'title' => ['required', 'string', 'max:255'],
}                                                        'body' => ['required', 'string'],
                                                     ];
                                                 }
                                             }
```

### 1.5 Missing Policies

```php
// WRONG: inline auth, easy to forget       // CORRECT: Policy
if ($post->user_id !== auth()->id()) {      class PostPolicy {
    abort(403);                                 public function update(User $user, Post $post): bool {
}                                                   return $user->id === $post->user_id;
                                                }
                                             }
                                             // Controller: $this->authorize('update', $post);
```

### 1.6 Returning Models in API

```php
// WRONG: exposes internal structure, all attributes
return $user;

// WRONG: fragile makeHidden
return $user->makeHidden(['password', 'remember_token']);

// CORRECT: API Resource — stable, explicit contract
class UserResource extends JsonResource {
    public function toArray(Request $request): array {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
return new UserResource($user);
```

### 1.7 Missing Queue

```php
// WRONG: user waits for PDF + email         // CORRECT: queue heavy work
$pdf = PDF::loadView('invoice', $data);      GenerateInvoicePdf::dispatch($invoice);
Storage::put("invoices/$id.pdf", $output);
Mail::send(new InvoiceCreated($invoice));
```

### 1.8 Debug Functions Left

Flag `dd()`, `dump()`, `ray()`, `var_dump()` immediately. They block execution or leak data in production.

### 1.9 Deprecated Helpers

```php
// WRONG                                     // CORRECT
str_slug($title);                            Str::slug($title);
array_first($items);                         Arr::first($items);
array_get($data, 'key');                     Arr::get($data, 'key');
```

### 1.10 Missing Enum Cast

```php
// WRONG: status is plain string             // CORRECT: enum cast
$order->status = 'shiped'; // typo           class Order extends Model {
                                                 protected $casts = ['status' => OrderStatus::class];
                                             }
                                             $order->status = OrderStatus::Shipped; // type-safe
```

---

## 2. TypeScript / React

### 2.1 `any` Type

Every `any` is a type hole where bugs hide.

```typescript
// WRONG                                     // CORRECT
function processData(data: any): any {       interface DataResponse { items: DataItem[]; }
  return data.items.map(                     function processData(data: DataResponse): number[] {
    (item: any) => item.value                  return data.items.map(item => item.value);
  );                                         }
}
// If truly unknown, use `unknown` and narrow with type guards
```

### 2.2 Missing Error Boundaries

```typescript
// WRONG: error in child = white screen     // CORRECT: granular boundaries
<App><Dashboard /></App>                    <ErrorBoundary fallback={<ChartError />}>
                                              <RevenueChart />
                                            </ErrorBoundary>
                                            <ErrorBoundary fallback={<TableError />}>
                                              <OrdersTable />
                                            </ErrorBoundary>
```

### 2.3 useEffect Dependency Issues

```typescript
// WRONG: missing dep — stale closure
useEffect(() => { fetchUser(userId).then(setUser); }, []);
// CORRECT
useEffect(() => { fetchUser(userId).then(setUser); }, [userId]);

// WRONG: object dep = infinite loop
const filters = { status, page }; // new object each render
useEffect(() => { fetchUsers(filters); }, [filters]);
// CORRECT
const filters = useMemo(() => ({ status, page }), [status, page]);

// WRONG: missing cleanup
useEffect(() => { const ws = new WebSocket(url); ws.onmessage = handle; }, [url]);
// CORRECT
useEffect(() => {
  const ws = new WebSocket(url);
  ws.onmessage = handle;
  return () => ws.close();
}, [url]);
```

### 2.4 State That Should Be Derived

```typescript
// WRONG: redundant state, can go out of sync
const [items, setItems] = useState<Item[]>([]);
const [totalPrice, setTotalPrice] = useState(0);  // derived!
const [itemCount, setItemCount] = useState(0);     // derived!

// CORRECT: derive from source of truth
const [items, setItems] = useState<Item[]>([]);
const totalPrice = useMemo(() => items.reduce((s, i) => s + i.price, 0), [items]);
const itemCount = items.length;
```

### 2.5 Direct DOM Manipulation

```typescript
// WRONG: bypasses React                     // CORRECT: refs and state
document.getElementById('x')!               const ref = useRef<HTMLInputElement>(null);
  .style.border = '2px solid red';           useEffect(() => { ref.current?.focus(); }, []);
document.getElementById('x')!.focus();       <input ref={ref} style={{ border: hasError ? '2px solid red' : undefined }} />
```

### 2.6 Missing key in Lists

```typescript
// WRONG: no key                             // WRONG: index as key (breaks on reorder)
{items.map(item => <Card item={item} />)}   {items.map((item, i) => <Card key={i} item={item} />)}

// CORRECT: stable unique identifier
{items.map(item => <Card key={item.id} item={item} />)}
```

### 2.7 Inline Objects in Render

New objects/arrays/functions in render break `React.memo`.

```typescript
// WRONG: new object every render            // CORRECT: stable references
<MemoChild                                   const style = useMemo(() => ({ color: 'red' }), []);
  style={{ color: 'red' }}                   const handleClick = useCallback(() => { ... }, []);
  data={[1, 2, 3]}                           <MemoChild style={style} data={data} onClick={handleClick} />
  onClick={() => handleClick()}
/>
```

### 2.8 Missing Loading/Error States

```typescript
// WRONG: only success                       // CORRECT: all states
const { data } = useQuery(['users'], fn);   const { data, isLoading, error } = useQuery(['users'], fn);
return <ul>                                  if (isLoading) return <Skeleton />;
  {data.map(u => <li>{u.name}</li>)}        if (error) return <ErrorMsg error={error} />;
</ul>;                                       if (!data.length) return <Empty />;
                                             return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
```

### 2.9 Unhandled Promise Rejections

```typescript
// WRONG: silent failure                     // CORRECT
async function handleSubmit() {             async function handleSubmit() {
  try {                                       try {
    await saveData(formData);                   await saveData(formData);
  } catch {                                     toast.success('Saved');
    // empty catch = silent                   } catch (error) {
  }                                             toast.error('Failed. Try again.');
}                                               logger.error('Save failed', { error });
                                              }
                                            }
```

### 2.10 Prop Drilling

```typescript
// WRONG: theme passed through 4 levels     // CORRECT: Context
<App theme={t}>                             const ThemeCtx = createContext<Theme>(def);
  <Layout theme={t}>                        function App() {
    <Sidebar theme={t}>                       return <ThemeCtx.Provider value={theme}>
      <NavItem theme={t} />                     <Layout><Sidebar><NavItem /></Sidebar></Layout>
                                              </ThemeCtx.Provider>;
                                            }
                                            // NavItem: const theme = useContext(ThemeCtx);
```

---

## 3. Go

### 3.1 Ignored Errors

```go
// WRONG: silent error                       // CORRECT
result, _ := json.Marshal(data)              result, err := json.Marshal(data)
                                             if err != nil { return fmt.Errorf("marshaling: %w", err) }
// If intentionally ignoring, document:
_ = db.Close() // best-effort; already in defer chain
```

### 3.2 Goroutine Leaks

```go
// WRONG: goroutine blocks forever           // CORRECT: context cancellation
ch := make(chan Result)                      ch := make(chan Result, 1) // buffered
go func() {                                  go func() {
    result := heavyWork()                        defer close(ch)
    ch <- result // blocks if nobody reads       select {
}()                                              case ch <- heavyWork():
                                                 case <-ctx.Done(): return
                                                 }
                                             }()
```

### 3.3 Missing Context Propagation

```go
// WRONG: context dropped                    // CORRECT: propagate context
func getUser(id string) (*User, error) {     func getUser(ctx context.Context, id string) (*User, error) {
    return db.Query("SELECT ...")                 return db.QueryRowContext(ctx, "SELECT ... WHERE id=$1", id)
}                                            }
```

### 3.4 Race Conditions

```go
// WRONG: concurrent map write = panic       // CORRECT: mutex
var counters = map[string]int{}              var (
func inc(k string) { counters[k]++ }            counters = map[string]int{}
                                                 mu sync.Mutex
                                             )
                                             func inc(k string) { mu.Lock(); counters[k]++; mu.Unlock() }
```

### 3.5 defer in Loops

```go
// WRONG: defers accumulate until function exit
for _, path := range paths {
    f, _ := os.Open(path)
    defer f.Close() // all close at function end, not iteration end
    process(f)
}

// CORRECT: extract to function
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil { return fmt.Errorf("opening %s: %w", path, err) }
    defer f.Close()
    return process(f)
}
```

### 3.6 Nil Pointer Dereference

```go
// WRONG                                     // CORRECT
user := repo.FindByID(id)                   user := repo.FindByID(id)
fmt.Println(user.Name) // panic if nil      if user == nil { return ErrNotFound }

// Map with pointer values:
s := sessions["unknown"] // nil for *Session
s.Touch() // panic
// CORRECT: s, ok := sessions["unknown"]; if !ok { return ErrNotFound }
```

### 3.7 Missing Input Validation

```go
// WRONG: trusts client data                 // CORRECT: validate at boundary
var req CreateUserRequest                    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
json.NewDecoder(r.Body).Decode(&req)             respondError(w, 400, "invalid JSON"); return
svc.CreateUser(req.Name, req.Email)          }
                                             if err := req.Validate(); err != nil {
                                                 respondError(w, 400, err.Error()); return
                                             }
```

### 3.8 Hardcoded Timeouts

```go
// WRONG: magic durations                    // CORRECT: configurable
client := &http.Client{                     type Config struct {
    Timeout: 30 * time.Second,                  HTTPTimeout time.Duration `env:"HTTP_TIMEOUT" default:"30s"`
}                                            }
                                             client := &http.Client{Timeout: cfg.HTTPTimeout}
```

### 3.9 Error Wrapping

```go
// WRONG: no context                         // CORRECT: wrap with operation
if err != nil {                              if err != nil {
    return nil, err                              return nil, fmt.Errorf("finding orders for user %s: %w", id, err)
}                                            }
```

---

## 4. Python

### 4.1 Bare except

```python
# WRONG: catches KeyboardInterrupt           # CORRECT: specific exceptions
try: process_data()                          try: process_data()
except: pass                                 except ValueError as e:
                                                 logger.warning("Invalid data", exc_info=e)
```

### 4.2 Mutable Default Arguments

```python
# WRONG: list shared across calls            # CORRECT: None sentinel
def add(item, items=[]):                     def add(item, items=None):
    items.append(item)                           if items is None: items = []
    return items                                 items.append(item)
add("a")  # ['a']                                return items
add("b")  # ['a', 'b'] — NOT ['b']!
```

### 4.3 Missing Type Hints

```python
# WRONG                                      # CORRECT
def process(order, discount, notify):        def process(order: Order, discount: float,
    total = order['amount'] * (1-discount)           notify: bool = False) -> float:
    ...                                          total = order.amount * (1 - discount)
                                                 ...
# BEST: use Pydantic/dataclass instead of dict
```

### 4.4 Global State

```python
# WRONG: global mutable state                # CORRECT: dependency injection
_conn = None                                 class OrderProcessor:
def get_conn():                                  def __init__(self, conn: Connection):
    global _conn                                     self.conn = conn
    if _conn is None: _conn = connect()
    return _conn
```

### 4.5 Missing Context Managers

```python
# WRONG: file not closed on exception        # CORRECT: with statement
f = open('data.csv')                         with open('data.csv') as f:
data = f.read()                                  data = f.read()
process(data)                                    process(data)
f.close()  # never reached if process throws
```

### 4.6 String Formatting

```python
# WRONG: old style                            # CORRECT: f-strings
"User %s has %d orders" % (name, count)       f"User {name} has {count} orders"
"User {} has {} orders".format(name, count)

# EXCEPTION: logging (deferred interpolation for performance)
logger.debug("Processing %s with %d items", user_id, count)
```

### 4.7 `is` vs `==`

```python
# WRONG: identity check for values           # CORRECT: equality check
if count is 1000: ...                        if count == 1000: ...
if status is "active": ...                   if status == "active": ...

# `is` only for: None, True, False, sentinel objects
if result is None: ...  # correct
```

### 4.8 Missing Virtual Environment

```bash
# WRONG: global pip install                   # CORRECT
pip install requests flask                   python -m venv .venv && source .venv/bin/activate
                                             # BETTER: uv sync / poetry install / pdm install
```

---

## 5. Cross-Language Patterns

### 5.1 Secrets in Code

Flag: `.env` committed, API keys in source, passwords in config, private keys. Check `.gitignore` covers `*.pem`, `*.key`, `credentials.*`.

### 5.2 Logging Sensitive Data

Flag: `log(user)` (may include password hash), `console.log(req.body)` (may include tokens), `logger.debug(payment)` (may include card number). Log only IDs, status codes, counts.

### 5.3 Hardcoded URLs

```
// Flag: environment-specific values in code
fetch('https://api.production.example.com/users')
DB_HOST = 'prod-db.example.com'

// Should be config/env vars
fetch(process.env.API_BASE_URL + '/users')
```

### 5.4 Missing Timeouts

Flag any external call without explicit timeout: HTTP clients, DB connections, gRPC calls, Redis ops, queue consumers. Default ranges: HTTP 5-30s, DB query 5-15s, external API 5-10s.
