# Review Checklist

Checklist completo para code review, organizado por categoria. Cada item inclui o que verificar e exemplos cross-stack.

---

## 1. Correctness

### 1.1 Off-by-One

Check loop boundaries, pagination offsets, array slicing, and fence-post errors.

```php
// WRONG: misses last page (101 items, 10/page = 10, should be 11)
$totalPages = $total / $perPage;

// CORRECT
$totalPages = (int) ceil($total / $perPage);
```
```typescript
// WRONG: skips last element
for (let i = 0; i < items.length - 1; i++) { ... }

// CORRECT
for (let i = 0; i < items.length; i++) { ... }
```
```go
// WRONG: panics when slice is empty
last := items[len(items)-1]

// CORRECT
if len(items) > 0 { last = items[len(items)-1] }
```

### 1.2 Null / Nil Handling

Every external input, database result, and optional value can be null.

```php
// WRONG: crash if no address               // CORRECT
$city = $user->address->city;               $city = $user->address?->city ?? 'Unknown';
```
```typescript
// WRONG                                    // CORRECT
const name = response.data.user.name;       const name = response.data?.user?.name ?? 'Unknown';
```
```go
// WRONG: nil panic                         // CORRECT
func getEmail(u *User) string {             func getEmail(u *User) string {
    return u.Email                              if u == nil { return "" }
}                                               return u.Email
                                            }
```
```python
# WRONG: KeyError                           # CORRECT
name = response['user']['name']             name = response.get('user', {}).get('name', 'Unknown')
```

### 1.3 Error Handling

```php
// WRONG: unhandled exception
$response = Http::get('https://api.example.com/data');

// CORRECT
try {
    $response = Http::timeout(5)->get('https://api.example.com/data');
    $response->throw();
} catch (ConnectionException $e) {
    Log::error('API unreachable', ['error' => $e->getMessage()]);
    return $this->fallbackData();
}
```
```go
// WRONG                                    // CORRECT
result, _ := db.Exec(query, id)             result, err := db.Exec(query, id)
                                            if err != nil { return fmt.Errorf("deleting user: %w", err) }
```
```python
# WRONG: bare except                        # CORRECT
try:                                        try:
    data = requests.get(url).json()             response = requests.get(url, timeout=5)
except:                                         response.raise_for_status()
    pass                                    except requests.RequestException as e:
                                                logger.error("Failed", exc_info=e)
```

### 1.4 Unhandled Promises (JS/TS)

```typescript
// WRONG: silent failure                    // CORRECT
sendNotification(userId, message);          sendNotification(userId, message)
                                              .catch(err => logger.error('Failed', { err }));
```

### 1.5 Race Conditions

```php
// WRONG: race on balance                   // CORRECT: atomic update
$wallet = Wallet::find($userId);            Wallet::where('id', $userId)->increment('balance', $amount);
$wallet->balance += $amount;
$wallet->save();
```
```typescript
// WRONG: stale closure                     // CORRECT: functional update
setCount(count + 1);                        setCount(prev => prev + 1);
```
```go
// WRONG: concurrent map write              // CORRECT: mutex
var cache = map[string]string{}             var mu sync.RWMutex
cache[k] = v                                mu.Lock(); cache[k] = v; mu.Unlock()
```

### 1.6 Type Coercion

```php
// WRONG: loose comparison                  // CORRECT
if ($status == 0) { ... }                   if ($status === 0) { ... }
```

### 1.7 Money / Precision

Never use floats for money. Use integers (cents) or decimal types.

```php
// WRONG: float                             // CORRECT: cents
$total = 19.99 * 3;  // 59.969...          $total = 1999 * 3;  // 5997 cents
```

### 1.8 Timezone Bugs

```php
// WRONG: assumes server tz                 // CORRECT
$today = date('Y-m-d');                     $today = now()->timezone('America/Sao_Paulo')->toDateString();
```
```python
# WRONG: naive datetime                     # CORRECT
now = datetime.now()                        now = datetime.now(timezone.utc)
```

### 1.9 Empty Collections

Always check for empty arrays, zero values, and max boundaries.

```php
// WRONG: division by zero
$average = array_sum($scores) / count($scores);

// CORRECT
$average = count($scores) > 0 ? array_sum($scores) / count($scores) : 0;
```
```typescript
// WRONG: throws on empty array without initial value
numbers.reduce((a, b) => a + b);            // TypeError if empty

// CORRECT: provide initial value
numbers.reduce((a, b) => a + b, 0);
```
```go
// WRONG: index out of range
func first(items []string) string { return items[0] }

// CORRECT
func first(items []string) string {
    if len(items) == 0 { return "" }
    return items[0]
}
```

### 1.10 Partial Failure

```php
// WRONG: orphan user if role fails         // CORRECT
$user = User::create($data);               DB::transaction(function () use ($data, $roleId) {
$user->roles()->attach($roleId);               $user = User::create($data);
                                                $user->roles()->attach($roleId);
                                            });
```

---

## 2. Security

### 2.1 SQL Injection

```php
// WRONG                                    // CORRECT
DB::select("SELECT * FROM users             DB::select("SELECT * FROM users
  WHERE name = '".$request->name."'");        WHERE name = ?", [$request->name]);
```
```python
# WRONG                                     # CORRECT
cursor.execute(f"...'{email}'")              cursor.execute("... %s", (email,))
```

### 2.2 XSS

```php
// WRONG                                    // CORRECT
{!! $user->bio !!}                          {{ $user->bio }}
```
```typescript
// WRONG                                    // CORRECT
<div dangerouslySetInnerHTML=               <div>{userComment}</div>
  {{ __html: userComment }} />              // or sanitize: DOMPurify.sanitize(userComment)
```

### 2.3 CSRF

```php
// WRONG: form without token                // CORRECT
<form method="POST">                        <form method="POST">
    <input name="amount" />                     @csrf
</form>                                         <input name="amount" />
                                            </form>
```

### 2.4 Auth / IDOR

```php
// WRONG: no auth check                     // CORRECT
public function destroy(Post $post) {       public function destroy(Post $post) {
    $post->delete();                            $this->authorize('delete', $post);
}                                               $post->delete();
                                            }
```
```go
// WRONG: IDOR                              // CORRECT
order, _ := repo.FindOrder(orderID)         order, err := repo.FindOrder(orderID)
json.NewEncoder(w).Encode(order)            if err != nil || order.UserID != userID {
                                                http.Error(w, "not found", 404); return
                                            }
```

### 2.5 Input Validation

Validate at the boundary (controller/handler), not deep in business logic.

```php
// WRONG: validation inside model            // CORRECT: Form Request at boundary
class Order extends Model {                  class StoreOrderRequest extends FormRequest {
    public function setAmountAttribute($v){      public function rules(): array {
        if ($v < 0) throw new Exception();           return [
        $this->attributes['amount'] = $v;                'amount' => ['required', 'numeric', 'min:0.01'],
    }                                                    'product_id' => ['required', 'exists:products,id'],
}                                                    ];
                                                 }
                                             }
```
```go
// WRONG: trusts client data                 // CORRECT: validate at boundary
json.NewDecoder(r.Body).Decode(&req)         if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
svc.CreateUser(req.Name, req.Email)              respondError(w, 400, "invalid JSON"); return
                                             }
                                             if err := req.Validate(); err != nil {
                                                 respondError(w, 400, err.Error()); return
                                             }
```

### 2.6 Secret Exposure

```php
// WRONG                                    // CORRECT
new StripeClient('sk_live_abc123');          new StripeClient(config('services.stripe.secret'));
```

### 2.7 File Upload

```php
// WRONG: no validation, path traversal     // CORRECT
$file->move(public_path('uploads'),         $request->validate([
  $file->getClientOriginalName());              'file' => ['required', 'file', 'mimes:jpg,png', 'max:10240'],
                                            ]);
                                            $path = $request->file('file')->store('uploads', 'private');
```

---

## 3. Performance

### 3.1 N+1 Queries

```php
// WRONG: N+1                               // CORRECT
$posts = Post::all();                       $posts = Post::with('author')->get();
foreach ($posts as $post)
    echo $post->author->name;
```

### 3.2 Missing Pagination

```php
// WRONG                                    // CORRECT
return User::all();                         return User::paginate(25);
```
```go
// WRONG                                    // CORRECT
db.Query("SELECT * FROM users")             db.Query("SELECT * FROM users LIMIT $1 OFFSET $2", limit, offset)
```

### 3.3 Unbounded Queries

```php
// WRONG: OOM on large table                // CORRECT: chunk/stream
$logs = ActivityLog::all();                 ActivityLog::query()->chunk(1000, fn($logs) => ...);
```

### 3.4 Missing Indexes

```php
// Review: does this WHERE clause have an index?
Order::where('user_id', $userId)->where('status', 'pending')->orderBy('created_at')->get();
// Needs composite index: ['user_id', 'status', 'created_at']
```

### 3.5 Memory — Large Files

```go
// WRONG: reads all into memory             // CORRECT: stream
data, _ := os.ReadFile("large.csv")         scanner := bufio.NewScanner(file)
                                            for scanner.Scan() { processLine(scanner.Text()) }
```

### 3.6 Missing Caching

```php
// WRONG: recalculates every request        // CORRECT
$stats = Order::where('status',             $stats = Cache::remember('stats', 300, fn() =>
  'completed')->sum('total');                   Order::where('status', 'completed')->sum('total')
                                            );
```

### 3.7 Sync Heavy Work

```php
// WRONG: user waits for email              // CORRECT: queue
Mail::send(new WelcomeEmail($user));        Mail::queue(new WelcomeEmail($user));
```

---

## 4. Readability

### 4.1 Naming

```php
// WRONG                                    // CORRECT
$d = Carbon::now()->diff($u->created_at);   $daysSince = Carbon::now()->diffInDays($user->created_at);
```
```go
// WRONG                                    // CORRECT
func proc(d []byte) ([]byte, error)         func compressPayload(data []byte) ([]byte, error)
```

### 4.2 Function Length

Functions > 50 lines need splitting. Look for natural seams: validation, transformation, logic, response.

```php
// WRONG: 80-line controller method          // CORRECT: split by responsibility
public function store(Request $request) {    public function store(StoreOrderRequest $request) {
    // validation (20 lines)                     $dto = OrderDTO::fromRequest($request);
    // transform (15 lines)                      $order = $this->orderService->create($dto);
    // logic (25 lines)                          return new OrderResource($order);
    // response (20 lines)                   }
}
```

### 4.3 Deep Nesting — Guard Clauses

```typescript
// WRONG: nested 4 levels                   // CORRECT: early returns
if (order) {                                if (!order) return;
  if (order.items.length > 0) {             if (order.items.length === 0) return;
    if (order.status === 'pending') {       if (order.status !== 'pending') return;
      // logic                              // logic at top level
    }
  }
}
```

### 4.4 Magic Numbers

```go
// WRONG                                    // CORRECT
if resp.StatusCode == 429 {                 const rateLimitStatus = 429
    time.Sleep(60 * time.Second)            const backoff = 60 * time.Second
}                                           if resp.StatusCode == rateLimitStatus { time.Sleep(backoff) }
```

### 4.5 Dead Code

Commented-out code, unreachable branches, and unused imports must be removed.

```typescript
// WRONG: commented-out code is noise — git preserves history
// function oldCalculation(items: Item[]) {
//   return items.reduce((sum, i) => sum + i.price * 1.1, 0);
// }

// WRONG: unreachable code after return
function getStatus(code: number): string {
  return statusMap[code] ?? 'unknown';
  console.log('This never executes');
}
```

### 4.6 DRY Violations

Same logic in multiple places means one copy will be updated and the rest stay broken.

```php
// WRONG: duplicated discount logic in two controllers
// OrderController: $discount = $total > 100 ? $total * 0.1 : 0;
// CartController:  $discount = $total > 100 ? $total * 0.1 : 0;

// CORRECT: extract to shared service
class DiscountCalculator {
    public function calculate(float $total): float {
        return $total > self::THRESHOLD ? $total * self::RATE : 0;
    }
}
```

---

## 5. Testing

### 5.1 No Tests = Flag Immediately

No tests for new functionality is a blocking review comment.

```
[BUG] No tests for the new calculateDiscount() logic.
This method has 4 branches — add tests covering:
- amount below threshold (no discount)
- amount at threshold (edge case)
- amount above threshold (applies discount)
- negative amount (should it be rejected?)
```

### 5.2 Happy Path Coverage

```php
// WRONG: only checks status                // CORRECT: verify side effects
$response->assertStatus(201);               $response->assertStatus(201);
                                            $this->assertDatabaseHas('orders', ['user_id' => $user->id]);
                                            Queue::assertPushed(SendConfirmation::class);
```

### 5.3 Edge Case Coverage

Tests must cover boundaries, empty states, and error paths.

```typescript
// Minimum test cases for a pagination function:
describe('paginate', () => {
  it('returns first page', () => { ... });
  it('returns last page', () => { ... });
  it('returns empty for page beyond total', () => { ... });
  it('handles empty dataset', () => { ... });
  it('handles page size larger than total', () => { ... });
  it('throws for negative page number', () => { ... });
  it('throws for zero page size', () => { ... });
});
```

### 5.4 Test Naming

Test names should describe the scenario and expected outcome, not the implementation.

```php
// WRONG: describes implementation
public function test_calculate_discount() { ... }

// CORRECT: describes behavior
public function test_applies_10pct_discount_when_order_exceeds_100() { ... }
public function test_no_discount_when_order_below_100() { ... }
public function test_rejects_negative_order_amount() { ... }
```
```go
// WRONG
func TestProcess(t *testing.T) { ... }

// CORRECT
func TestProcess_ReturnsError_WhenInputIsEmpty(t *testing.T) { ... }
func TestProcess_TrimsWhitespace_WhenInputHasLeadingSpaces(t *testing.T) { ... }
```

### 5.5 Test Independence

Tests must not depend on execution order or shared mutable state.

```php
// WRONG: depends on another test's side effect
public function test_create_user() { User::create(['name' => 'John']); }
public function test_list_users() {
    $this->assertCount(1, User::all()); // fails if create didn't run first
}

// CORRECT: each test sets up own state
public function test_list_users() {
    User::factory()->count(3)->create();
    $this->assertCount(3, User::all());
}
```

---

## 6. Architecture

### 6.1 Single Responsibility

A function that validates, transforms, persists, AND notifies is doing too much.

```php
// WRONG: controller does everything
public function store(Request $request) {
    $validated = $request->validate([...]);   // validation
    $user = User::create($validated);         // persistence
    Mail::send(new WelcomeEmail($user));      // notification
    event(new UserRegistered($user));         // events
    Cache::forget('users:count');             // cache
    return new UserResource($user);           // response
}

// CORRECT: delegate to specialized classes
public function store(StoreUserRequest $request) {
    $user = $this->userService->register($request->validated());
    return new UserResource($user);
}
```

### 6.2 Tight Coupling

```typescript
// WRONG: direct Stripe dependency          // CORRECT: depend on interface
class PaymentService {                      interface PaymentGateway {
  async charge(amount: number) {              charge(amount: number): Promise<Result>;
    const stripe = new Stripe(key);         }
    return stripe.charges.create({amount}); class PaymentService {
  }                                           constructor(private gw: PaymentGateway) {}
}                                           }
```

### 6.3 Abstraction Level Consistency

A function should operate at one level of abstraction.

```python
# WRONG: mixes high and low level
def process_order(data):
    validate_order(data)                    # high-level
    conn = psycopg2.connect(host='...')     # suddenly low-level
    cursor.execute("INSERT INTO orders ..") # low-level
    send_confirmation(data['email'])        # back to high-level

# CORRECT: consistent level
def process_order(data):
    validate_order(data)
    save_order(data)
    send_confirmation(data['email'])
```

### 6.4 API Breaking Changes

Flag: removed/renamed fields, changed types (string->number, nullable->required), changed status codes, changed auth. Suggest deprecation + versioning over hard breaks.

### 6.5 Migration Safety

```php
// WRONG: locks large table (MySQL < 8.0.12)  // CORRECT: nullable first, backfill, then constrain
$table->string('tracking')->default('');       $table->string('tracking')->nullable();
```

```
Checklist: locks large table? | reversible (down works)? | drops columns? |
renames columns (rolling deploy risk)? | NOT NULL without default?
```

---

## 7. API & Data

### 7.1 Missing Transactions

Multi-table operations must be atomic. See 1.10 Partial Failure for examples.

### 7.2 Inconsistent Error Responses

```typescript
// WRONG: different shapes                   // CORRECT: consistent shape
res.status(400).json({error: 'Bad'});       res.status(400).json({error: {code: 'VALIDATION_ERROR', message: 'Bad'}});
res.status(404).json({message: 'Not found'});res.status(404).json({error: {code: 'NOT_FOUND', message: 'Not found'}});
```

### 7.3 Missing Rate Limiting

```php
// WRONG                                     // CORRECT
Route::post('/login', [AuthCtrl::class,     Route::post('/login', [AuthCtrl::class,
  'login']);                                   'login'])->middleware('throttle:5,1');
```

### 7.4 Missing Logging for Critical Operations

```php
// WRONG: impossible to debug failures       // CORRECT
$result = $gw->charge($amount);             Log::info('Payment attempt', ['order' => $id, 'amount' => $amount]);
                                            $result = $gw->charge($amount);
                                            if ($result->failed()) {
                                                Log::error('Payment failed', ['order' => $id, 'error' => $result->error()]);
                                            }
```

### 7.5 Sensitive Data in Logs

Never log passwords, tokens, or full card numbers. Log only IDs, status codes, counts, last-4 digits.

### 7.6 Missing Error Context

```go
// WRONG                                     // CORRECT
if err != nil { return err }                 if err != nil { return fmt.Errorf("fetching user %s: %w", id, err) }
```

---

## Decision Matrix

| Found | Severity | Blocks? |
|---|---|---|
| SQL injection, XSS, auth bypass | Critical | YES |
| Data corruption, crash on common input | Critical | YES |
| N+1 on high-traffic endpoint | High | YES |
| Missing tests for new logic | High | YES |
| Missing error handling on I/O | Medium | Usually |
| Missing pagination | Medium | Usually |
| Poor naming, magic numbers | Low | No |
| Style preference | None | No (linters) |
