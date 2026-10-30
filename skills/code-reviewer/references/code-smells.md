# Code Smells

Catalogo de code smells comuns com deteccao, exemplos WRONG/CORRECT cross-stack, e como refatorar.

---

## 1. God Class / God Function

**Detection:** Class > 500 lines or > 10 public methods. Function > 50 lines. Name has "Manager/Handler/Processor" and does everything.

```php
// WRONG: UserManager handles auth, profile, notifications, reports, import/export
class UserManager
{
    public function register(array $data) { /* 40 lines */ }
    public function login(string $email, string $password) { /* 30 lines */ }
    public function updateProfile(int $id, array $data) { /* 25 lines */ }
    public function sendVerificationEmail(User $user) { /* 15 lines */ }
    public function calculateLoyaltyPoints(int $id) { /* 30 lines */ }
    public function exportToCSV() { /* 60 lines */ }
}

// CORRECT: split by responsibility
class RegistrationService { public function register(RegisterDTO $dto): User { ... } }
class AuthenticationService { public function login(string $email, string $password): AuthToken { ... } }
class ProfileService { public function update(int $userId, UpdateProfileDTO $dto): User { ... } }
```

```typescript
// WRONG: 83-line function
async function handleCheckout(cart: Cart, user: User) {
  // validate (10) + discounts (15) + taxes (10) + payment (12) + order (8) + email (5) ...
}

// CORRECT: orchestrate smaller functions
async function handleCheckout(cart: Cart, user: User): Promise<Order> {
  validateCart(cart);
  const pricing = calculatePricing(cart);
  const payment = await chargePayment(user, pricing.total);
  const order = await createOrder(cart, pricing, payment);
  await postCheckout(order);
  return order;
}
```

**Refactor:** Identify distinct responsibilities. Extract each into its own class. Original becomes a thin orchestrator.

---

## 2. Feature Envy

**Detection:** Method uses another object's data more than its own. Many getters called on another class.

```php
// WRONG: OrderPrinter "envies" Order's data
class OrderPrinter {
    public function formatSummary(Order $order): string {
        $subtotal = $order->getItems()->sum('price');
        $tax = $subtotal * $order->getTaxRate();
        $shipping = $order->getShippingMethod() === 'express' ? 15 : 5;
        return "Total: " . ($subtotal + $tax + $shipping);
    }
}

// CORRECT: move calculation to Order
class Order {
    public function calculateTotal(): OrderTotal { /* uses $this data */ }
}
class OrderPrinter {
    public function formatSummary(Order $order): string {
        $total = $order->calculateTotal();
        return "Total: {$total->grand}";
    }
}
```

**Refactor:** Move the method to the class whose data it uses. Or extract a value object.

---

## 3. Data Clumps

**Detection:** Same 3+ parameters in multiple function signatures. Related data passed separately.

```typescript
// WRONG: lat/lng always travel together
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number) { ... }
function isWithinRadius(lat: number, lng: number, centerLat: number, centerLng: number, r: number) { ... }

// CORRECT: extract value object
interface Coordinate { latitude: number; longitude: number; }
function calculateDistance(from: Coordinate, to: Coordinate) { ... }
function isWithinRadius(point: Coordinate, center: Coordinate, radius: number) { ... }
```

```php
// WRONG: address fields everywhere          // CORRECT: Address value object
function createShipment(                     class Address {
    string $street, string $city,                public function __construct(
    string $state, string $zip,                      public readonly string $street,
    string $country, float $weight               // ...
) { ... }                                        ) {}
                                             }
                                             function createShipment(Address $address, float $weight) { ... }
```

**Refactor:** Create a class/struct for the clump. Replace all occurrences.

---

## 4. Primitive Obsession

**Detection:** Email as `string`, money as `float`, status as `string`, IDs as `int` without type distinction.

```php
// WRONG: any string accepted, typos compile
if ($order->status === 'pendding') { ... }

// CORRECT: enum — typo is a compile error
enum OrderStatus: string { case Pending = 'pending'; case Shipped = 'shipped'; }
if ($order->status === OrderStatus::Pending) { ... }
```

```go
// WRONG: can mix user ID and order ID      // CORRECT: typed IDs
func GetOrder(userID string,                type UserID string
  orderID string) (*Order, error)           type OrderID string
// GetOrder(orderID, userID) compiles       func GetOrder(u UserID, o OrderID) (*Order, error)
                                            // GetOrder(orderID, userID) = compile error
```

**Refactor:** Introduce value objects or branded types. Validate on construction.

---

## 5. Long Parameter Lists

**Detection:** > 3 parameters. Boolean params that change behavior. Same params in multiple functions.

```go
// WRONG: 7 params                          // CORRECT: config struct
func NewServer(host string, port int,       type ServerConfig struct {
  timeout time.Duration, maxConn int,           Host    string
  tlsCert, tlsKey string,                       Port    int
  logger *slog.Logger) *Server              // ...
                                            }
                                            func NewServer(cfg ServerConfig) *Server
```

```typescript
// WRONG                                    // CORRECT
function fetchUsers(page: number,           interface FetchUsersOptions {
  limit: number, sortBy: string,              page: number; limit: number;
  sortDir: 'asc'|'desc',                     sortBy?: string; sortDir?: 'asc'|'desc';
  filter: string,                             filter?: string; includeDeleted?: boolean;
  includeDeleted: boolean) { ... }          }
                                            function fetchUsers(opts: FetchUsersOptions) { ... }
```

**Refactor:** Group into object/struct/DTO. Use builder pattern for complex construction.

---

## 6. Shotgun Surgery

**Detection:** One conceptual change requires editing 10+ files. Adding a status means 5+ switch statements change.

```typescript
// WRONG: new status = changes in model, controller, list, detail, service, tests, CSS

// CORRECT: centralize behavior in registry
const ORDER_STATUSES = {
  pending:   { label: 'Pending', color: 'yellow', actions: ['confirm', 'cancel'] },
  confirmed: { label: 'Confirmed', color: 'blue', actions: ['ship', 'cancel'] },
  shipped:   { label: 'Shipped', color: 'purple', actions: ['deliver'] },
} as const;
// Adding a new status: one file. Components read from config.
```

**Refactor:** Centralize varying data into a registry/config. Components consume it instead of hard-coding.

---

## 7. Divergent Change

**Detection:** `git log` for one file shows commits about billing, auth, reporting, notifications. Class changed for many unrelated reasons.

```php
// WRONG: UserService changed for every feature
class UserService {
    public function register() { ... }          // auth
    public function calculateLoyalty() { ... }  // loyalty
    public function generateReport() { ... }    // reporting
    public function syncMailchimp() { ... }     // marketing
}

// CORRECT: one class per reason-to-change
class RegistrationService { ... }
class LoyaltyService { ... }
class UserReportingService { ... }
```

**Refactor:** Split class by reason-to-change. Each class has one axis of modification.

---

## 8. Speculative Generality

**Detection:** Interface with 1 implementation. Abstract class with 1 subclass. Comments "in case we need to...". Generic names: `AbstractProcessor`.

```typescript
// WRONG: over-engineered for single use case
interface INotificationChannel { send(msg: string, to: string): Promise<void>; }
class EmailChannel implements INotificationChannel { ... }
class NotificationManager { channels: INotificationChannel[] = []; ... }

// CORRECT: just send the email; add abstraction when second channel arrives
class NotificationService {
  async sendEmail(to: string, subject: string, body: string): Promise<void> { ... }
}
```

```go
// WRONG: interface defined with 5 methods, only 2 used anywhere
type Repository interface {
    Find(id string) (*Entity, error)
    FindAll() ([]*Entity, error)
    Create(e *Entity) error
    Update(e *Entity) error
    Delete(id string) error
}

// CORRECT: minimal interface at consumer
type UserFinder interface { Find(id string) (*User, error) }
```

**Refactor:** Delete unused abstractions. Add them when the second use case actually arrives.

---

## 9. Dead Code

**Detection:** Commented-out blocks, uncalled functions, unused imports, unreachable code after return.

```php
// WRONG: commented-out code                 // CORRECT: delete it, trust git
// public function oldCalc($order) {
//     return $order->total * 0.1;
// }
```

```typescript
// WRONG: unused imports
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// only useState and useEffect used

// CORRECT
import { useState, useEffect } from 'react';
```

**Refactor:** Delete it. Dead code rots. Version control preserves history.

---

## 10. Duplicated Logic

**Detection:** Two functions with > 70% similar structure. Same validation in multiple controllers. Same error handling repeated.

```go
// WRONG: duplicated JSON response pattern in every handler
func handleGetUser(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(user)
}
// same 3 lines in handleGetOrder, handleGetProduct, ...

// CORRECT: extract helper
func respondJSON(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}
```

**Refactor:** Extract shared logic into function/service/middleware. Keep unique parts in place.

---

## 11. Boolean Parameters

**Detection:** `doSomething(user, true, false)` at call site — incomprehensible.

```php
// WRONG: what does true mean?               // CORRECT: enum or named option
$order->send(true);                          $order->send(ShippingMethod::Express);
```

```typescript
// WRONG                                     // CORRECT
createUser(data, true, false);               createUser({ data, sendWelcome: true, role: 'user' });
```

**Refactor:** Replace boolean with enum, separate methods, or options object. Call site must be self-documenting.

---

## 12. Stringly-Typed Code

**Detection:** String comparisons for type discrimination. Same string literal in multiple files. Typos compile.

```php
// WRONG: typo compiles, never matches       // CORRECT: enum
if ($order->status === 'pendding') { ... }   if ($order->status === OrderStatus::Pending) { ... }
```

```go
// WRONG                                     // CORRECT
SetLogLevel("deubg") // compiles             type LogLevel int
                                             const (Debug LogLevel = iota; Info; Warn; Error)
                                             SetLogLevel(Debug)
```

**Refactor:** Replace string literals with enums/union types/typed constants.

---

## 13. Callback Hell

**Detection:** 4+ levels of nested callbacks. `.then().then().then()` chains.

```typescript
// WRONG: pyramid of doom
getUser(id, (err, user) => {
  getOrders(user.id, (err, orders) => {
    getPayments(orders[0].id, (err, payments) => {
      processRefund(payments[0], (err, result) => { done(); });
    });
  });
});

// CORRECT: async/await
const user = await getUser(id);
const orders = await getOrders(user.id);
const payments = await getPayments(orders[0].id);
await processRefund(payments[0]);
```

**Refactor:** Convert to async/await. Extract steps into named functions.

---

## 14. Magic Numbers and Strings

**Detection:** Numeric literals in conditions (except 0, 1). Same literal in multiple places.

```php
// WRONG                                     // CORRECT
if ($attempts >= 5) {                        const MAX_ATTEMPTS = 5;
    $lockout = now()->addSeconds(1800);      const LOCKOUT_SECONDS = 1800;
}                                            if ($attempts >= self::MAX_ATTEMPTS) { ... }
```

**Refactor:** Extract to named constants. Group related constants.

---

## 15. Inappropriate Intimacy

**Detection:** Class A accesses internal/private fields of class B. Changing internals of one breaks the other.

```typescript
// WRONG: reaches into Cart internals
const subtotal = cart._items.reduce((sum, i) => sum + i._priceInCents / 100 * i._qty, 0);
const tax = subtotal * cart._taxConfig.rate;

// CORRECT: Cart exposes behavior, hides internals
const { subtotal, tax, total } = cart.calculateTotals();
```

**Refactor:** Apply Law of Demeter. Expose behavior (methods), not internal data.

---

## 16. Temporal Coupling

**Detection:** Methods must be called in specific order with nothing enforcing it. Comments "must call init() first".

```php
// WRONG: order matters, nothing enforces it
$report = new Report();
$report->setDateRange($start, $end);
$report->loadData();
$report->applyFilters($filters);
$result = $report->generate();

// CORRECT: required params in constructor, single atomic method
$result = new Report($dateRange, $filters)->generate();
```

```go
// WRONG: temporal coupling                  // CORRECT: required in constructor
server := &Server{}                          server := NewServer(8080, WithTimeout(60*time.Second))
server.SetPort(8080)                         server.Start()
server.SetTimeout(30)
server.Start()
```

**Refactor:** Pass required data at construction. Make multi-step operations atomic.

---

## Quick Smell Detection

| Symptom | Smell | Fix |
|---|---|---|
| Class > 500 lines | God class | Split by responsibility |
| Function > 50 lines | God function | Extract sub-functions |
| > 3 parameters | Long param list | Use object/DTO |
| Boolean parameter | Boolean flag | Enum or separate methods |
| Same code in 2+ places | Duplication | Extract shared function |
| String for types | Stringly-typed | Enum/union type |
| Nesting 4+ levels | Callback hell | Early returns, async/await |
| Commented-out code | Dead code | Delete, trust git |
| Method uses other class's data | Feature envy | Move method |
| One change = many files | Shotgun surgery | Centralize config |
| Many changes = one file | Divergent change | Split by responsibility |
| Interface with 1 impl | Speculative generality | Remove until needed |
| Hard-coded numbers | Magic numbers | Named constants |
| Same fields passed together | Data clumps | Value object |
| "Must call X before Y" | Temporal coupling | Constructor + atomic method |
