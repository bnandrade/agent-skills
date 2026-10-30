# Refactoring Catalog

Catalogo de tecnicas de refatoracao praticas com before/after, quando aplicar e riscos. Inspirado em Martin Fowler, adaptado para uso diario.

---

## Table of Contents

1. [Extract Method/Function](#1-extract-methodfunction)
2. [Extract Class/Module](#2-extract-classmodule)
3. [Inline Method](#3-inline-method)
4. [Move Method](#4-move-method)
5. [Rename](#5-rename)
6. [Replace Conditional with Polymorphism](#6-replace-conditional-with-polymorphism)
7. [Introduce Parameter Object](#7-introduce-parameter-object)
8. [Replace Magic Numbers with Constants](#8-replace-magic-numbers-with-constants)
9. [Decompose Conditional](#9-decompose-conditional)
10. [Consolidate Duplicate Conditionals](#10-consolidate-duplicate-conditionals)
11. [Replace Loop with Pipeline](#11-replace-loop-with-pipeline)
12. [Replace Inheritance with Composition](#12-replace-inheritance-with-composition)
13. [Extract Interface](#13-extract-interface)
14. [Remove Dead Code](#14-remove-dead-code)
15. [Replace Nested Conditionals with Guard Clauses](#15-replace-nested-conditionals-with-guard-clauses)

---

## 1. Extract Method/Function

Pull a block of code into a named function. The most common and most valuable refactoring.

### When to Apply
- A function does more than one thing
- A code block needs a comment to explain what it does
- You see the same block repeated in multiple places
- A function is longer than 20-30 lines

### Risks
- Changing scope of variables (watch for closures and mutations)
- Performance: hot loops might suffer from function call overhead (rare in practice)

### Examples

```typescript
// WRONG: One function doing everything
async function processOrder(order: Order) {
  // Validate inventory
  for (const item of order.items) {
    const stock = await db.inventory.findOne({ sku: item.sku });
    if (!stock || stock.quantity < item.quantity) {
      throw new Error(`Insufficient stock for ${item.sku}`);
    }
  }

  // Calculate totals
  let subtotal = 0;
  for (const item of order.items) {
    subtotal += item.price * item.quantity;
  }
  const tax = subtotal * 0.08875;
  const shipping = subtotal > 100 ? 0 : 9.99;
  const total = subtotal + tax + shipping;

  // Create records
  const record = await db.orders.create({
    userId: order.userId,
    items: order.items,
    subtotal,
    tax,
    shipping,
    total,
    status: "pending",
  });

  // Send notification
  await emailService.send({
    to: order.userEmail,
    subject: "Order confirmed",
    template: "order-confirmation",
    data: { orderId: record.id, total },
  });

  return record;
}

// CORRECT: Each step is a named function
async function processOrder(order: Order) {
  await validateInventory(order.items);
  const totals = calculateTotals(order.items);
  const record = await createOrderRecord(order, totals);
  await sendOrderConfirmation(order.userEmail, record.id, totals.total);
  return record;
}

async function validateInventory(items: OrderItem[]) {
  for (const item of items) {
    const stock = await db.inventory.findOne({ sku: item.sku });
    if (!stock || stock.quantity < item.quantity) {
      throw new InsufficientStockError(item.sku);
    }
  }
}

function calculateTotals(items: OrderItem[]): OrderTotals {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.08875;
  const shipping = subtotal > 100 ? 0 : 9.99;
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}
```

```php
// WRONG: 80-line controller method
public function store(Request $request): JsonResponse
{
    // 20 lines of validation
    // 15 lines of business logic
    // 10 lines of database operations
    // 15 lines of notification
    // 10 lines of response formatting
    // 10 lines of error handling
}

// CORRECT: Controller delegates to focused methods/services
public function store(StoreOrderRequest $request): JsonResponse
{
    $validated = $request->validated();
    $order = $this->orderService->create($validated);
    return OrderResource::make($order);
}
```

---

## 2. Extract Class/Module

When a class has too many responsibilities, split it into focused classes.

### When to Apply
- A class has methods that can be grouped into subsets (half the methods use fields A and B, the other half use C and D)
- A class has more than 300 lines
- You describe the class with "and" (it handles users AND permissions AND notifications)

### Risks
- Over-extraction: creating too many tiny classes that are hard to navigate
- Breaking existing consumers that depend on the original interface

### Examples

```python
# WRONG: UserService does everything user-related
class UserService:
    def create_user(self, data): ...
    def update_user(self, id, data): ...
    def delete_user(self, id): ...
    def authenticate(self, email, password): ...
    def generate_token(self, user): ...
    def verify_token(self, token): ...
    def refresh_token(self, token): ...
    def send_welcome_email(self, user): ...
    def send_password_reset(self, user): ...
    def send_verification_email(self, user): ...
    def upload_avatar(self, user, file): ...
    def resize_avatar(self, file): ...
    def get_user_permissions(self, user): ...
    def check_permission(self, user, action): ...

# CORRECT: Split by responsibility
class UserService:
    def create_user(self, data): ...
    def update_user(self, id, data): ...
    def delete_user(self, id): ...

class AuthService:
    def authenticate(self, email, password): ...
    def generate_token(self, user): ...
    def verify_token(self, token): ...
    def refresh_token(self, token): ...

class UserNotificationService:
    def send_welcome_email(self, user): ...
    def send_password_reset(self, user): ...
    def send_verification_email(self, user): ...

class AvatarService:
    def upload(self, user, file): ...
    def resize(self, file): ...

class PermissionService:
    def get_permissions(self, user): ...
    def check(self, user, action): ...
```

```go
// WRONG: One massive struct
type Server struct {
    db        *sql.DB
    cache     *redis.Client
    mailer    *smtp.Client
    templates *template.Template
    logger    *slog.Logger
    // 15 more fields
}

func (s *Server) HandleCreateUser(w http.ResponseWriter, r *http.Request) { ... }
func (s *Server) HandleLogin(w http.ResponseWriter, r *http.Request) { ... }
func (s *Server) HandleUploadAvatar(w http.ResponseWriter, r *http.Request) { ... }
func (s *Server) SendEmail(to, subject, body string) error { ... }
func (s *Server) RenderTemplate(name string, data any) (string, error) { ... }
// 30 more methods

// CORRECT: Focused structs composed in the server
type UserHandler struct {
    users UserRepository
    auth  AuthService
}

type AuthService struct {
    db     *sql.DB
    tokens TokenGenerator
}

type Mailer struct {
    client    *smtp.Client
    templates *template.Template
}

type Server struct {
    userHandler *UserHandler
    authService *AuthService
    mailer      *Mailer
    logger      *slog.Logger
}
```

---

## 3. Inline Method

The reverse of extract method. When a function's body is as clear as its name, inline it.

### When to Apply
- A function is called only once
- The function body is simpler than the function name
- Over-extracted code: too many tiny functions that make reading harder

### Risks
- Making the calling function too long (don't inline into a 100-line function)

### Examples

```typescript
// WRONG: Over-extracted (function adds no clarity)
function isAdult(age: number): boolean {
  return isGreaterOrEqual(age, 18);
}

function isGreaterOrEqual(a: number, b: number): boolean {
  return a >= b;
}

// CORRECT: Inline the unnecessary abstraction
function isAdult(age: number): boolean {
  return age >= 18;
}
```

```php
// WRONG: Method exists just to delegate
class OrderService
{
    public function getOrderTotal(Order $order): Money
    {
        return $this->calculateTotal($order);
    }

    private function calculateTotal(Order $order): Money
    {
        return $order->items->sum(fn (Item $item) => $item->price->multiply($item->quantity));
    }
}

// CORRECT: Inline — one method is enough
class OrderService
{
    public function getOrderTotal(Order $order): Money
    {
        return $order->items->sum(fn (Item $item) => $item->price->multiply($item->quantity));
    }
}
```

---

## 4. Move Method

Move a method to the class that uses its data most. Methods should live close to the data they operate on.

### When to Apply
- A method uses more data from another class than its own
- Feature envy: a method accesses 3+ fields of another object

### Risks
- Breaking callers that expect the method on the original class
- Circular dependencies if both classes end up calling each other

### Examples

```typescript
// WRONG: Cart method that only uses Item data (feature envy)
class Cart {
  getItemSubtotal(item: CartItem): number {
    return item.price * item.quantity * (1 - item.discountPercent / 100);
  }
}

// CORRECT: Move to where the data lives
class CartItem {
  get subtotal(): number {
    return this.price * this.quantity * (1 - this.discountPercent / 100);
  }
}

class Cart {
  get total(): number {
    return this.items.reduce((sum, item) => sum + item.subtotal, 0);
  }
}
```

```python
# WRONG: Report class reaches into Order internals
class Report:
    def order_summary(self, order):
        name = order.customer.first_name + " " + order.customer.last_name
        total = sum(item.price * item.qty for item in order.items)
        tax = total * order.tax_rate
        return f"{name}: ${total + tax:.2f}"

# CORRECT: Order provides its own summary data
class Order:
    @property
    def customer_name(self) -> str:
        return f"{self.customer.first_name} {self.customer.last_name}"

    @property
    def total_with_tax(self) -> float:
        subtotal = sum(item.price * item.qty for item in self.items)
        return subtotal * (1 + self.tax_rate)

class Report:
    def order_summary(self, order):
        return f"{order.customer_name}: ${order.total_with_tax:.2f}"
```

---

## 5. Rename

Change a name to clearly communicate intent. The cheapest refactoring with the highest readability ROI.

### When to Apply
- A name doesn't describe what the thing does
- You need a comment to explain what a variable holds
- Abbreviations that aren't universally understood
- Names that are misleading

### Risks
- Renaming public APIs (use expand-contract)
- Missing a reference in strings, configs, or database columns

### Examples

```typescript
// WRONG: Cryptic names
const d = new Date();
const u = getUser(id);
const res = await fetch(url);
const tmp = process(data);
function calc(a: number, b: number, c: number): number { ... }
function handleIt(e: Event): void { ... }

// CORRECT: Descriptive names
const orderDate = new Date();
const currentUser = getUser(userId);
const apiResponse = await fetch(inventoryUrl);
const normalizedRecords = normalizeImportData(rawCsvData);
function calculateShippingCost(weight: number, distance: number, rate: number): number { ... }
function handleFormSubmit(event: SubmitEvent): void { ... }
```

```go
// WRONG: Go-style abbreviations taken too far
func PrcOrd(o *O, u *U) (*R, error) { ... }

// CORRECT: Short but clear
func ProcessOrder(order *Order, user *User) (*Receipt, error) { ... }
// Note: Go prefers short names in small scopes (i, ok, err)
// but exported functions and types should be descriptive
```

---

## 6. Replace Conditional with Polymorphism

When a switch/if-else chain selects behavior based on type, replace it with polymorphic objects.

### When to Apply
- The same switch/if-else appears in multiple places
- Adding a new type requires modifying multiple switch statements
- The conditional logic is complex and growing

### Risks
- Over-engineering: a simple 2-case if/else doesn't need polymorphism
- Adding indirection that makes debugging harder

### Examples

```typescript
// WRONG: Switch statement repeated in 3 places
function calculateShippingCost(method: string, weight: number): number {
  switch (method) {
    case "standard":
      return weight * 0.5;
    case "express":
      return weight * 1.5 + 10;
    case "overnight":
      return weight * 3.0 + 25;
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

function estimateDeliveryDays(method: string): number {
  switch (method) {
    case "standard": return 7;
    case "express": return 3;
    case "overnight": return 1;
    default: throw new Error(`Unknown method: ${method}`);
  }
}

// Adding a new method means editing BOTH functions (and any others)

// CORRECT: Polymorphism
interface ShippingMethod {
  calculateCost(weight: number): number;
  estimateDeliveryDays(): number;
}

class StandardShipping implements ShippingMethod {
  calculateCost(weight: number) { return weight * 0.5; }
  estimateDeliveryDays() { return 7; }
}

class ExpressShipping implements ShippingMethod {
  calculateCost(weight: number) { return weight * 1.5 + 10; }
  estimateDeliveryDays() { return 3; }
}

class OvernightShipping implements ShippingMethod {
  calculateCost(weight: number) { return weight * 3.0 + 25; }
  estimateDeliveryDays() { return 1; }
}

// Adding a new method = adding a new class (no existing code changes)

// Factory to get the right implementation
function getShippingMethod(method: string): ShippingMethod {
  const methods: Record<string, ShippingMethod> = {
    standard: new StandardShipping(),
    express: new ExpressShipping(),
    overnight: new OvernightShipping(),
  };
  const impl = methods[method];
  if (!impl) throw new Error(`Unknown method: ${method}`);
  return impl;
}
```

```go
// Same pattern in Go with interfaces
type ShippingMethod interface {
    Cost(weightKg float64) float64
    DeliveryDays() int
}

type StandardShipping struct{}
func (s StandardShipping) Cost(w float64) float64 { return w * 0.5 }
func (s StandardShipping) DeliveryDays() int      { return 7 }

type ExpressShipping struct{}
func (e ExpressShipping) Cost(w float64) float64 { return w*1.5 + 10 }
func (e ExpressShipping) DeliveryDays() int      { return 3 }

// Adding SameDayShipping = one new file, zero changes to existing code
```

---

## 7. Introduce Parameter Object

When multiple functions pass the same group of parameters, bundle them into a struct/object.

### When to Apply
- Three or more parameters always travel together
- Functions have long parameter lists (5+ params)
- You're adding yet another parameter to an already long list

### Risks
- Creating a "god object" that bundles unrelated things
- Making it harder to see what a function actually needs

### Examples

```python
# WRONG: Same parameters everywhere
def create_invoice(customer_name, customer_email, customer_address,
                   customer_phone, customer_tax_id):
    ...

def send_invoice(customer_name, customer_email, customer_address,
                 customer_phone, invoice_id):
    ...

def validate_customer(customer_name, customer_email, customer_address,
                      customer_phone, customer_tax_id):
    ...

# CORRECT: Parameter object
@dataclass
class Customer:
    name: str
    email: str
    address: str
    phone: str
    tax_id: str | None = None

def create_invoice(customer: Customer): ...
def send_invoice(customer: Customer, invoice_id: str): ...
def validate_customer(customer: Customer): ...
```

```typescript
// WRONG: Date range parameters repeated everywhere
function getOrders(startDate: Date, endDate: Date, timezone: string) { ... }
function getRevenue(startDate: Date, endDate: Date, timezone: string) { ... }
function getMetrics(startDate: Date, endDate: Date, timezone: string) { ... }

// CORRECT: DateRange object
interface DateRange {
  start: Date;
  end: Date;
  timezone: string;
}

function getOrders(range: DateRange) { ... }
function getRevenue(range: DateRange) { ... }
function getMetrics(range: DateRange) { ... }

// Bonus: DateRange can have its own methods
class DateRange {
  constructor(public start: Date, public end: Date, public timezone: string) {}

  get durationDays(): number {
    return (this.end.getTime() - this.start.getTime()) / (1000 * 60 * 60 * 24);
  }

  contains(date: Date): boolean {
    return date >= this.start && date <= this.end;
  }
}
```

---

## 8. Replace Magic Numbers with Constants

Give meaningful names to literal values.

### When to Apply
- Any number in code whose meaning isn't obvious
- Any string that represents a status, type, or configuration
- Repeated literals that might need to change

### Risks
- Over-constantifying: `const ONE = 1` is worse than just using `1`
- Constants in the wrong place (too far from usage, or too global)

### Examples

```typescript
// WRONG: Magic numbers everywhere
if (password.length < 8) { ... }
if (retries > 3) { ... }
if (response.status === 429) { ... }
setTimeout(callback, 86400000);
const tax = amount * 0.08875;

// CORRECT: Named constants
const MIN_PASSWORD_LENGTH = 8;
const MAX_RETRIES = 3;
const HTTP_TOO_MANY_REQUESTS = 429;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NYC_TAX_RATE = 0.08875;

if (password.length < MIN_PASSWORD_LENGTH) { ... }
if (retries > MAX_RETRIES) { ... }
if (response.status === HTTP_TOO_MANY_REQUESTS) { ... }
setTimeout(callback, ONE_DAY_MS);
const tax = amount * NYC_TAX_RATE;
```

```go
// WRONG: Magic strings for status
order.Status = "pending"
if order.Status == "completed" { ... }
// Typo "comeplted" compiles fine, fails at runtime

// CORRECT: Constants (or iota enum)
type OrderStatus string

const (
    OrderStatusPending   OrderStatus = "pending"
    OrderStatusCompleted OrderStatus = "completed"
    OrderStatusCancelled OrderStatus = "cancelled"
)

order.Status = OrderStatusPending
if order.Status == OrderStatusCompleted { ... }
// Typo in constant name = compile error
```

---

## 9. Decompose Conditional

When a conditional's condition or branches are complex, extract them into named functions.

### When to Apply
- The condition itself is hard to read
- The if/else branches contain multi-line blocks
- You need a comment to explain what the condition checks

### Risks
- Minimal. One of the safest refactorings.

### Examples

```php
// WRONG: Complex condition inline
if ($user->created_at->diffInDays(now()) > 365
    && $user->orders()->count() > 10
    && $user->orders()->sum('total') > 1000
    && !$user->hasFlag('banned')
    && $user->email_verified_at !== null) {
    // 15 lines of premium upgrade logic
} else {
    // 10 lines of standard user logic
}

// CORRECT: Named condition + extracted branches
if ($this->isEligibleForPremium($user)) {
    $this->upgradeToPremium($user);
} else {
    $this->applyStandardBenefits($user);
}

private function isEligibleForPremium(User $user): bool
{
    return $user->accountAge()->greaterThan(CarbonInterval::year())
        && $user->orders()->count() > 10
        && $user->totalSpent()->greaterThan(Money::of(1000))
        && !$user->isBanned()
        && $user->hasVerifiedEmail();
}
```

```python
# WRONG: Nested conditions
def apply_discount(order):
    if order.total > 100:
        if order.customer.is_premium:
            if order.has_coupon:
                discount = order.total * 0.25
            else:
                discount = order.total * 0.15
        else:
            if order.has_coupon:
                discount = order.total * 0.10
            else:
                discount = 0
    else:
        discount = 0
    return discount

# CORRECT: Decomposed
def apply_discount(order) -> float:
    if not qualifies_for_discount(order):
        return 0
    return calculate_discount_rate(order) * order.total

def qualifies_for_discount(order) -> bool:
    return order.total > 100

def calculate_discount_rate(order) -> float:
    base = 0.15 if order.customer.is_premium else 0.0
    coupon = 0.10 if order.has_coupon else 0.0
    return base + coupon
```

---

## 10. Consolidate Duplicate Conditionals

When multiple branches do the same thing, merge them.

### When to Apply
- Multiple if/else branches have identical code
- Switch cases share logic

### Examples

```typescript
// WRONG: Duplicate logic in branches
function getShippingLabel(country: string): string {
  if (country === "US") {
    validateAddress(address);
    const label = generateLabel(address);
    trackShipment(label.id);
    return label.url;
  } else if (country === "CA") {
    validateAddress(address);
    const label = generateLabel(address);
    trackShipment(label.id);
    return label.url;
  } else if (country === "MX") {
    validateAddress(address);
    const label = generateLabel(address);
    trackShipment(label.id);
    return label.url;
  } else {
    throw new Error("International shipping not supported");
  }
}

// CORRECT: Consolidate
function getShippingLabel(country: string): string {
  const supportedCountries = ["US", "CA", "MX"];
  if (!supportedCountries.includes(country)) {
    throw new Error("International shipping not supported");
  }
  validateAddress(address);
  const label = generateLabel(address);
  trackShipment(label.id);
  return label.url;
}
```

---

## 11. Replace Loop with Pipeline

Replace imperative loops with declarative pipelines (map, filter, reduce).

### When to Apply
- Loop body does filter + transform + accumulate
- Multiple nested loops that could be flattened
- Loop variable mutations that are hard to follow

### Risks
- Performance: for extremely hot loops, a for-loop may be faster
- Readability: deeply chained pipelines can be harder to read than a clear loop

### Examples

```typescript
// WRONG: Imperative loop
const results: string[] = [];
for (let i = 0; i < orders.length; i++) {
  if (orders[i].status === "completed") {
    if (orders[i].total > 100) {
      results.push(orders[i].customer.email);
    }
  }
}
const unique = [...new Set(results)];
unique.sort();

// CORRECT: Pipeline
const emails = orders
  .filter(order => order.status === "completed")
  .filter(order => order.total > 100)
  .map(order => order.customer.email)
  .filter((email, i, arr) => arr.indexOf(email) === i)
  .sort();
```

```go
// Go doesn't have built-in pipelines, but you can use slices package
// or write focused helper functions

// WRONG: Nested loop with accumulator
var total float64
for _, order := range orders {
    if order.Status != "completed" {
        continue
    }
    for _, item := range order.Items {
        if item.Category == "electronics" {
            total += item.Price * float64(item.Quantity)
        }
    }
}

// CORRECT: Still a loop (Go idiom), but decomposed
func completedElectronicsTotal(orders []Order) float64 {
    var total float64
    for _, order := range orders {
        if order.Status != "completed" {
            continue
        }
        total += electronicsSubtotal(order.Items)
    }
    return total
}

func electronicsSubtotal(items []Item) float64 {
    var sum float64
    for _, item := range items {
        if item.Category == "electronics" {
            sum += item.Price * float64(item.Quantity)
        }
    }
    return sum
}
```

---

## 12. Replace Inheritance with Composition

When inheritance creates rigid hierarchies, switch to composition.

### When to Apply
- Deep inheritance hierarchies (3+ levels)
- You need to inherit from multiple classes (and the language doesn't support it)
- Subclasses only use a fraction of the parent's methods
- The "is-a" relationship doesn't actually hold

### Examples

```python
# WRONG: Inheritance hierarchy nightmare
class Animal:
    def eat(self): ...
    def sleep(self): ...
    def move(self): ...

class Bird(Animal):
    def fly(self): ...     # What about penguins?
    def lay_eggs(self): ...

class Penguin(Bird):
    def fly(self):
        raise NotImplementedError("Penguins can't fly")  # LSP violation
    def swim(self): ...

# CORRECT: Composition with capabilities
class Animal:
    def __init__(self, movement: MovementStrategy, reproduction: ReproductionStrategy):
        self.movement = movement
        self.reproduction = reproduction

class FlyingMovement:
    def move(self): print("Flying")

class SwimmingMovement:
    def move(self): print("Swimming")

class WalkingMovement:
    def move(self): print("Walking")

class EggLaying:
    def reproduce(self): print("Laying eggs")

# Penguin: walks + swims + lays eggs (no problematic inheritance)
penguin = Animal(
    movement=SwimmingMovement(),  # or CompositeMovement([Walking, Swimming])
    reproduction=EggLaying(),
)
```

```typescript
// WRONG: React class inheritance anti-pattern
class BaseForm extends React.Component {
  validate() { ... }
  submit() { ... }
  renderErrors() { ... }
}

class UserForm extends BaseForm {
  // Inherits validate, submit, renderErrors
  // But also inherits render(), state management, lifecycle...
  // Tight coupling to BaseForm's implementation
}

// CORRECT: Composition with hooks
function useFormValidation(rules: ValidationRules) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const validate = (data: Record<string, any>) => { ... };
  return { errors, validate };
}

function useFormSubmit(endpoint: string) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (data: Record<string, any>) => { ... };
  return { submitting, submit };
}

function UserForm() {
  const { errors, validate } = useFormValidation(userRules);
  const { submitting, submit } = useFormSubmit("/api/users");
  // Compose behaviors without inheritance
}
```

---

## 13. Extract Interface

Define an interface for a class so you can swap implementations.

### When to Apply
- You need to test a class in isolation (mock its dependencies)
- You might have multiple implementations (now or future)
- You want to break a dependency between modules

### Risks
- Premature interfaces: don't extract an interface until you have a second implementation (or need one for testing)

### Examples

```go
// WRONG: Concrete dependency
type OrderService struct {
    repo *PostgresOrderRepo  // Can't test without Postgres
}

// CORRECT: Interface dependency
type OrderRepository interface {
    FindByID(ctx context.Context, id string) (*Order, error)
    Save(ctx context.Context, order *Order) error
    ListByUser(ctx context.Context, userID string) ([]*Order, error)
}

type OrderService struct {
    repo OrderRepository  // Can be Postgres, in-memory, mock
}

// PostgresOrderRepo implements OrderRepository
// InMemoryOrderRepo implements OrderRepository (for tests)
```

```php
// WRONG: Direct class dependency
class NotificationService
{
    public function __construct(private TwilioClient $sms) {}

    public function notifyUser(User $user, string $message): void
    {
        $this->sms->send($user->phone, $message);
    }
}

// CORRECT: Interface dependency
interface SmsGateway
{
    public function send(string $phone, string $message): void;
}

class TwilioGateway implements SmsGateway
{
    public function send(string $phone, string $message): void
    {
        // Twilio-specific implementation
    }
}

class NotificationService
{
    public function __construct(private SmsGateway $sms) {}

    public function notifyUser(User $user, string $message): void
    {
        $this->sms->send($user->phone, $message);
    }
}

// Now you can swap Twilio for Vonage, or use a fake in tests
```

---

## 14. Remove Dead Code

Delete code that is never executed. Dead code confuses readers and hides the real logic.

### When to Apply
- Commented-out code blocks
- Functions never called
- Feature flag paths that were never activated
- Branches for conditions that can never be true
- Imports that are unused

### Risks
- Removing code that IS used (via reflection, dynamic dispatch, or external systems)
- Removing code that is used only in rare paths (cron jobs, error handlers)

### How to Verify Code Is Dead

```bash
# Search for function name in entire codebase
grep -rn "functionName" src/ tests/ scripts/ config/

# Check git blame — when was it last modified?
git log --oneline -n 5 -- path/to/file.ts

# Check if it's called dynamically
grep -rn "functionName\|function_name" src/ --include="*.ts" --include="*.json"

# For endpoints: check access logs
grep "GET /api/old-endpoint" /var/log/nginx/access.log | wc -l
```

### Examples

```typescript
// WRONG: Dead code left "just in case"
function processOrder(order: Order) {
  // Old implementation — keeping just in case
  // if (order.type === "legacy") {
  //   return legacyProcess(order);
  // }

  // TODO: Remove after Q3 migration (it's Q2 next year)
  // const oldResult = oldProcessor.process(order);

  return newProcessor.process(order);
}

// CORRECT: Delete it. Git has the history if you ever need it.
function processOrder(order: Order) {
  return newProcessor.process(order);
}
```

```
Rule: If code is commented out, delete it.
Git is your backup. You can always recover it with:
  git log --all -p -- path/to/file.ts | grep "functionName"
```

---

## 15. Replace Nested Conditionals with Guard Clauses

Flip nested if/else blocks into early returns (guard clauses). Reduces nesting and makes the happy path obvious.

### When to Apply
- Nesting deeper than 2 levels
- The "happy path" is buried inside multiple conditions
- Error/edge cases wrap the main logic

### Risks
- Minimal. One of the safest refactorings.
- In languages with defer/cleanup (Go, C++), ensure early returns don't skip cleanup

### Examples

```php
// WRONG: Deep nesting, happy path buried
public function processPayment(Payment $payment): Result
{
    if ($payment !== null) {
        if ($payment->amount > 0) {
            if ($payment->currency !== null) {
                if ($this->gateway->isAvailable()) {
                    if ($payment->user->hasValidCard()) {
                        // Happy path (5 levels deep)
                        $charge = $this->gateway->charge($payment);
                        return Result::success($charge);
                    } else {
                        return Result::error('No valid card');
                    }
                } else {
                    return Result::error('Gateway unavailable');
                }
            } else {
                return Result::error('No currency');
            }
        } else {
            return Result::error('Invalid amount');
        }
    } else {
        return Result::error('No payment');
    }
}

// CORRECT: Guard clauses, happy path at the end (0 nesting)
public function processPayment(Payment $payment): Result
{
    if ($payment === null) {
        return Result::error('No payment');
    }
    if ($payment->amount <= 0) {
        return Result::error('Invalid amount');
    }
    if ($payment->currency === null) {
        return Result::error('No currency');
    }
    if (!$this->gateway->isAvailable()) {
        return Result::error('Gateway unavailable');
    }
    if (!$payment->user->hasValidCard()) {
        return Result::error('No valid card');
    }

    // Happy path — clear and obvious
    $charge = $this->gateway->charge($payment);
    return Result::success($charge);
}
```

```go
// WRONG: Nested error handling
func CreateUser(req CreateUserRequest) (*User, error) {
    if req.Name != "" {
        if req.Email != "" {
            if isValidEmail(req.Email) {
                user, err := db.CreateUser(req)
                if err != nil {
                    return nil, fmt.Errorf("creating user: %w", err)
                }
                return user, nil
            } else {
                return nil, errors.New("invalid email format")
            }
        } else {
            return nil, errors.New("email is required")
        }
    } else {
        return nil, errors.New("name is required")
    }
}

// CORRECT: Guard clauses (idiomatic Go)
func CreateUser(req CreateUserRequest) (*User, error) {
    if req.Name == "" {
        return nil, errors.New("name is required")
    }
    if req.Email == "" {
        return nil, errors.New("email is required")
    }
    if !isValidEmail(req.Email) {
        return nil, errors.New("invalid email format")
    }

    user, err := db.CreateUser(req)
    if err != nil {
        return nil, fmt.Errorf("creating user: %w", err)
    }
    return user, nil
}
```

---

## Quick Reference: When to Use What

| Smell | Refactoring | Section |
|---|---|---|
| Long function | Extract Method | 1 |
| God class | Extract Class | 2 |
| Unnecessary indirection | Inline Method | 3 |
| Feature envy | Move Method | 4 |
| Unclear name | Rename | 5 |
| Type-based switch | Replace Conditional with Polymorphism | 6 |
| Long parameter list | Introduce Parameter Object | 7 |
| Magic literal | Replace with Constant | 8 |
| Complex condition | Decompose Conditional | 9 |
| Duplicate branches | Consolidate Conditionals | 10 |
| Imperative loop | Replace with Pipeline | 11 |
| Deep inheritance | Replace with Composition | 12 |
| Tight coupling | Extract Interface | 13 |
| Commented/unused code | Remove Dead Code | 14 |
| Deep nesting | Guard Clauses | 15 |
