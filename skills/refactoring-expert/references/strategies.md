# Refactoring Strategies

Estrategias comprovadas para refatorar codebases de producao sem parar o desenvolvimento de features. Cada estrategia inclui quando usar, como executar e armadilhas comuns.

---

## Table of Contents

1. [Strangler Fig Pattern](#1-strangler-fig-pattern)
2. [Branch by Abstraction](#2-branch-by-abstraction)
3. [Parallel Run](#3-parallel-run)
4. [Expand and Contract](#4-expand-and-contract)
5. [Feature Flags for Refactoring](#5-feature-flags-for-refactoring)
6. [Mikado Method](#6-mikado-method)
7. [Sprout Class and Method](#7-sprout-class-and-method)
8. [Rewrite vs Refactor Decision Framework](#8-rewrite-vs-refactor-decision-framework)
9. [Incremental Migration Plan Template](#9-incremental-migration-plan-template)
10. [Anti-Patterns](#10-anti-patterns)

---

## 1. Strangler Fig Pattern

The most important refactoring pattern. Named after the strangler fig tree that grows around a host tree, eventually replacing it completely.

### 1.1 How It Works

```
Phase 1: IDENTIFY — Find the boundary
  ┌─────────────────┐
  │   Old System     │ ← All traffic goes here
  │                   │
  └─────────────────┘

Phase 2: BUILD — Create new alongside old
  ┌─────────────────┐     ┌─────────────────┐
  │   Old System     │     │   New System     │
  │                   │     │   (building)     │
  └─────────────────┘     └─────────────────┘

Phase 3: REDIRECT — Route traffic incrementally
  ┌─────────────────┐     ┌─────────────────┐
  │   Old System     │←10% │   New System     │←90%
  │                   │     │                   │
  └─────────────────┘     └─────────────────┘

Phase 4: REMOVE — Decommission old
                           ┌─────────────────┐
                           │   New System     │←100%
                           │                   │
                           └─────────────────┘
```

### 1.2 Implementation: API Route Level

```typescript
// WRONG: Rewrite all routes at once
// Delete old routes, deploy new ones, pray

// CORRECT: Strangler fig at the route level

// Step 1: Create a proxy/router that can redirect
// middleware/strangler-router.ts
import { NextFunction, Request, Response } from "express";

const NEW_ROUTES: Record<string, boolean> = {
  "GET /api/v2/users": true,
  "GET /api/v2/users/:id": true,
  // Add routes here as you migrate them
};

export function stranglerRouter(req: Request, res: Response, next: NextFunction) {
  const routeKey = `${req.method} ${req.route?.path || req.path}`;

  if (NEW_ROUTES[routeKey]) {
    // Forward to new service/handler
    return proxy.forward(req, res, { target: "http://new-service:3001" });
  }

  // Fall through to old handlers
  next();
}
```

```php
// Step 1: Laravel route-level strangler
// routes/api.php

// New implementation (migrated routes)
Route::prefix('v2')->group(function () {
    Route::get('/users', [NewUserController::class, 'index']);
    Route::get('/users/{id}', [NewUserController::class, 'show']);
});

// Old implementation (not yet migrated)
Route::prefix('v2')->group(function () {
    // These routes are still handled by the old controller
    Route::post('/users', [OldUserController::class, 'store']);
    Route::put('/users/{id}', [OldUserController::class, 'update']);
    Route::delete('/users/{id}', [OldUserController::class, 'destroy']);
});

// When you migrate store:
// 1. Write tests for OldUserController@store behavior
// 2. Implement NewUserController@store
// 3. Move the route from old group to new group
// 4. Deploy, monitor, verify
// 5. Repeat for update, delete
```

### 1.3 Implementation: Module Level

```go
// Strangler fig at the module level in Go

// BEFORE: Everything in one package
// pkg/orders/orders.go — 3000 lines, does everything

// AFTER: Gradually extract to new packages

// Step 1: New package for order validation
// pkg/orders/validation/validate.go
package validation

type OrderValidator struct {
    rules []Rule
}

func (v *OrderValidator) Validate(order Order) error {
    for _, rule := range v.rules {
        if err := rule.Check(order); err != nil {
            return fmt.Errorf("order validation: %w", err)
        }
    }
    return nil
}

// Step 2: Old code delegates to new code
// pkg/orders/orders.go
func (s *OrderService) CreateOrder(ctx context.Context, req CreateOrderRequest) (*Order, error) {
    // OLD: 200 lines of inline validation
    // NEW: delegate to extracted module
    validator := validation.NewOrderValidator(s.rules)
    if err := validator.Validate(req.ToOrder()); err != nil {
        return nil, err
    }

    // Rest of the old code (migrate next)
    // ...
}
```

### 1.4 When to Use Strangler Fig

| Situation | Use Strangler Fig? |
|---|---|
| Replacing a legacy system | Yes — the #1 use case |
| Migrating from monolith to services | Yes — extract one service at a time |
| Rewriting a module | Yes — build new alongside old |
| Changing a database | Yes (with expand-and-contract) |
| Renaming a function | No — too small, just rename |
| Fixing a bug | No — just fix it |

### 1.5 Common Mistakes

```
WRONG: Building the entire new system before routing any traffic
  → You're just doing a big bang rewrite with extra steps
  → The new system will have bugs you only discover in production

CORRECT: Route one endpoint at a time to the new system
  → Each migration is small, testable, reversible
  → You learn from early migrations and improve the process
```

---

## 2. Branch by Abstraction

Introduce an interface between consumers and the implementation you want to replace. Swap the implementation behind the interface.

### 2.1 The Four Steps

```
Step 1: EXTRACT INTERFACE
  Client → [OldImplementation]

Step 2: INTRODUCE ABSTRACTION
  Client → [Interface] → [OldImplementation]

Step 3: BUILD NEW
  Client → [Interface] → [OldImplementation]
                       → [NewImplementation] (building)

Step 4: SWITCH
  Client → [Interface] → [NewImplementation]
           (remove old)
```

### 2.2 Implementation Example

```typescript
// Step 1: You have direct coupling
// BEFORE: Every file imports the old payment module directly
import { chargeCard } from "./old-payment-module";

async function checkout(cart: Cart) {
  const result = await chargeCard(cart.total, cart.currency);
  return result;
}

// Step 2: Extract an interface
interface PaymentGateway {
  charge(amount: number, currency: string): Promise<ChargeResult>;
  refund(chargeId: string, amount: number): Promise<RefundResult>;
}

// Step 3: Wrap old code in the interface
class OldPaymentGateway implements PaymentGateway {
  async charge(amount: number, currency: string): Promise<ChargeResult> {
    // Delegates to old module — no behavior change
    return chargeCard(amount, currency);
  }
  async refund(chargeId: string, amount: number): Promise<RefundResult> {
    return refundCard(chargeId, amount);
  }
}

// Step 4: Build new implementation
class StripePaymentGateway implements PaymentGateway {
  async charge(amount: number, currency: string): Promise<ChargeResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: amount * 100,
      currency,
    });
    return { id: intent.id, status: intent.status };
  }
  async refund(chargeId: string, amount: number): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: chargeId,
      amount: amount * 100,
    });
    return { id: refund.id, status: refund.status };
  }
}

// Step 5: Switch via configuration
function createPaymentGateway(): PaymentGateway {
  if (config.PAYMENT_PROVIDER === "stripe") {
    return new StripePaymentGateway(config.STRIPE_SECRET);
  }
  return new OldPaymentGateway();
}

// Step 6: Update consumers (one at a time)
async function checkout(cart: Cart, gateway: PaymentGateway) {
  const result = await gateway.charge(cart.total, cart.currency);
  return result;
}
```

```go
// Same pattern in Go with interfaces

// Step 1: Define interface
type NotificationSender interface {
    Send(ctx context.Context, msg Message) error
}

// Step 2: Wrap old code
type LegacyEmailSender struct {
    oldClient *oldmail.Client
}

func (s *LegacyEmailSender) Send(ctx context.Context, msg Message) error {
    return s.oldClient.SendEmail(msg.To, msg.Subject, msg.Body)
}

// Step 3: New implementation
type SendGridSender struct {
    client *sendgrid.Client
}

func (s *SendGridSender) Send(ctx context.Context, msg Message) error {
    email := mail.NewSingleEmail(
        mail.NewEmail("App", "noreply@app.com"),
        msg.Subject,
        mail.NewEmail("", msg.To),
        msg.Body,
        msg.Body,
    )
    _, err := s.client.Send(email)
    return err
}

// Step 4: Switch with config
func NewNotificationSender(cfg Config) NotificationSender {
    if cfg.UseSendGrid {
        return &SendGridSender{client: sendgrid.NewClient(cfg.SendGridKey)}
    }
    return &LegacyEmailSender{oldClient: oldmail.New(cfg.SMTPHost)}
}
```

---

## 3. Parallel Run

Run old and new code simultaneously, compare results, alert on differences. Only switch when confidence is high.

### 3.1 When to Use

- Replacing critical business logic (billing, pricing, tax calculations)
- Where correctness matters more than speed
- When you can't fully characterize all edge cases in tests

### 3.2 Implementation

```python
# Parallel run for a pricing engine migration

import logging
from dataclasses import dataclass

@dataclass
class PriceResult:
    total: float
    tax: float
    discount: float

class ParallelPricingEngine:
    def __init__(self, old_engine, new_engine, comparison_logger):
        self.old = old_engine
        self.new = new_engine
        self.logger = comparison_logger

    def calculate(self, cart) -> PriceResult:
        # Always use old result (it's the source of truth)
        old_result = self.old.calculate(cart)

        try:
            new_result = self.new.calculate(cart)
            self._compare(cart, old_result, new_result)
        except Exception as e:
            # New code failure doesn't affect users
            self.logger.error(f"New engine failed: {e}", extra={
                "cart_id": cart.id,
                "error": str(e),
            })

        # Return old result — users never see new engine bugs
        return old_result

    def _compare(self, cart, old, new):
        if abs(old.total - new.total) > 0.01:
            self.logger.warning("Price mismatch", extra={
                "cart_id": cart.id,
                "old_total": old.total,
                "new_total": new.total,
                "difference": abs(old.total - new.total),
                "items": [item.sku for item in cart.items],
            })
```

```typescript
// WRONG: Just switch to the new code
const price = newPricingEngine.calculate(cart);

// CORRECT: Parallel run with comparison
const price = parallelRun({
  control: () => oldPricingEngine.calculate(cart),   // source of truth
  experiment: () => newPricingEngine.calculate(cart), // being validated
  compare: (old, new_) => Math.abs(old.total - new_.total) < 0.01,
  onMismatch: (old, new_, context) => {
    logger.warn("Pricing mismatch", { cartId: cart.id, old, new: new_ });
    metrics.increment("pricing.mismatch");
  },
});
// Returns the control (old) result until you're confident
```

### 3.3 Graduation Criteria

Switch to the new implementation when:

```
[ ] Parallel run for at least 2 weeks in production
[ ] Mismatch rate < 0.1%
[ ] All mismatches investigated and explained
[ ] New implementation handles all edge cases
[ ] Performance is equal or better
[ ] Rollback plan tested
```

---

## 4. Expand and Contract

Add the new thing, migrate to it, remove the old thing. Essential for database and API changes.

### 4.1 Database Schema Changes

```sql
-- WRONG: Rename column in one step (breaks running code)
ALTER TABLE users RENAME COLUMN name TO full_name;
-- Every query using "name" is now broken

-- CORRECT: Expand and contract (3 phases)

-- Phase 1: EXPAND (add new column)
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
-- Backfill existing data
UPDATE users SET full_name = name WHERE full_name IS NULL;
-- Add trigger to keep both in sync
CREATE TRIGGER sync_name_columns
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION sync_user_name();

-- Phase 2: MIGRATE (update application code)
-- Deploy code that reads from full_name and writes to both
-- Verify all consumers use full_name

-- Phase 3: CONTRACT (remove old column)
DROP TRIGGER sync_name_columns ON users;
ALTER TABLE users DROP COLUMN name;
```

### 4.2 API Changes

```typescript
// Phase 1: EXPAND — new field alongside old
// Both work, response includes both
interface UserResponse {
  name: string;       // deprecated, will be removed
  full_name: string;  // new field
}

app.get("/api/users/:id", (req, res) => {
  const user = findUser(req.params.id);
  res.json({
    name: user.fullName,       // old field (kept for compatibility)
    full_name: user.fullName,  // new field
  });
});

// Phase 2: MIGRATE — update all API consumers
// Log which clients still use "name"
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function(body) {
    // Track if response was accessed via old field
    return originalJson(body);
  };
  next();
});

// Phase 3: CONTRACT — remove old field after all consumers migrated
// Add deprecation header for 1 month
// Then remove "name" from response
```

### 4.3 Expand-Contract Timeline

```
Week 1-2:  EXPAND
  → Add new column/field/endpoint
  → Backfill data, sync old and new
  → Deploy code that reads new, writes both

Week 3-6:  MIGRATE
  → Update all consumers to use new
  → Monitor for any usage of old
  → Communicate deprecation

Week 7-8:  CONTRACT
  → Remove old column/field/endpoint
  → Remove sync triggers/code
  → Clean up deprecated code paths
```

---

## 5. Feature Flags for Refactoring

Use feature flags to control which code path executes. Roll out refactored code gradually.

### 5.1 Implementation

```typescript
// Simple feature flag for refactoring
class RefactoringFlags {
  private flags: Record<string, {
    enabled: boolean;
    percentage: number;  // 0-100, for gradual rollout
  }>;

  isEnabled(flag: string, userId?: string): boolean {
    const f = this.flags[flag];
    if (!f || !f.enabled) return false;
    if (f.percentage >= 100) return true;

    // Deterministic: same user always gets same result
    if (userId) {
      const hash = this.hashCode(userId + flag);
      return (hash % 100) < f.percentage;
    }

    return Math.random() * 100 < f.percentage;
  }
}

// Usage in code
async function searchProducts(query: string, userId: string) {
  if (flags.isEnabled("new-search-engine", userId)) {
    return newSearchEngine.search(query);  // Elasticsearch
  }
  return oldSearchEngine.search(query);    // SQL LIKE query
}
```

### 5.2 Rollout Schedule

```
Day 1:   flag on for internal team (1%)
Day 3:   flag on for beta users (5%)
Day 5:   flag on for 10% of users
Day 7:   flag on for 25%
Day 10:  flag on for 50%
Day 14:  flag on for 100%
Day 21:  remove flag, remove old code
```

### 5.3 Critical Rule

```
WRONG: Leave feature flags forever
  → 6 months later you have 47 flags, nobody knows which are active
  → Code has 47 if/else branches that are never exercised

CORRECT: Every flag has an expiration date
  → When you create a flag, create a ticket to remove it
  → Maximum flag lifetime: 30 days after 100% rollout
  → Run a monthly "flag cleanup" to remove stale flags
```

---

## 6. Mikado Method

When a refactoring has deep dependencies, graph them and refactor leaf nodes first.

### 6.1 How It Works

```
1. Try the refactoring you want
2. It fails — note what prerequisite is missing
3. Revert your change
4. Try the prerequisite
5. It fails — note what ITS prerequisite is
6. Revert
7. Repeat until you find a change that succeeds
8. Do that change, commit
9. Work back up the graph
```

### 6.2 Example: Extract Payment Module

```
GOAL: Extract PaymentService from OrderController

  Extract PaymentService
    ├── OrderController uses DB directly for payments
    │   ├── Create PaymentRepository interface
    │   │   ├── Payment model is coupled to Order model ← START HERE
    │   │   └── Payment queries are scattered in 3 files ← THEN THIS
    │   └── Extract payment logic from order validation
    └── 5 other controllers call OrderController for payments
        └── Create PaymentService facade ← THEN THIS

Execution order (bottom-up):
  1. Decouple Payment model from Order model
  2. Consolidate payment queries into one file
  3. Create PaymentRepository interface
  4. Extract payment logic from order validation
  5. Create PaymentService facade
  6. Update 5 controllers to use PaymentService
  7. Remove payment code from OrderController
```

### 6.3 Mikado Rules

```
WRONG: Try to do the goal directly
  → It breaks because of dependencies
  → You "fix" the dependencies while trying to do the goal
  → 4 hours later you have 47 changed files and nothing works

CORRECT: Graph first, execute bottom-up
  → Each step is small and independently committable
  → If interrupted, you have a clear map of what's left
  → Each commit is green — the system always works
```

---

## 7. Sprout Class and Method

When you need to add new functionality to messy code, don't modify the messy code. Create new, clean code alongside it.

### 7.1 Sprout Method

```php
// BEFORE: God method you don't want to modify
class OrderProcessor
{
    public function process(Order $order): void
    {
        // 200 lines of tangled logic
        // ...
        // You need to add discount calculation here
        // ...
        // 150 more lines
    }
}

// WRONG: Add discount logic inline (makes the god method worse)
class OrderProcessor
{
    public function process(Order $order): void
    {
        // 200 lines of tangled logic
        // ...
        // 30 NEW lines of discount logic mixed in
        // ...
        // 150 more lines
    }
}

// CORRECT: Sprout method — new code in a new, tested method
class OrderProcessor
{
    public function process(Order $order): void
    {
        // 200 lines of tangled logic (unchanged)
        // ...
        $discount = $this->calculateDiscount($order);
        $order->applyDiscount($discount);
        // ...
        // 150 more lines (unchanged)
    }

    // New, clean, tested method
    public function calculateDiscount(Order $order): Money
    {
        if ($order->customer->isPremium() && $order->total()->isGreaterThan(Money::of(100))) {
            return $order->total()->multiply(0.15);
        }
        return Money::zero();
    }
}
```

### 7.2 Sprout Class

```typescript
// BEFORE: Monolithic ReportGenerator
class ReportGenerator {
  generate(data: ReportData): string {
    // 500 lines that generates HTML, calculates stats, sends email
  }
}

// CORRECT: Sprout a new class for the new requirement (PDF export)
class PdfReportExporter {
  constructor(private readonly templateEngine: TemplateEngine) {}

  export(data: ReportData): Buffer {
    const html = this.templateEngine.render("report", data);
    return this.htmlToPdf(html);
  }

  private htmlToPdf(html: string): Buffer {
    // Clean, tested PDF generation
  }
}

// Old code calls the new class
class ReportGenerator {
  generate(data: ReportData): string {
    // 500 lines (unchanged)
  }

  generatePdf(data: ReportData): Buffer {
    const exporter = new PdfReportExporter(this.templateEngine);
    return exporter.export(data);
  }
}
```

### 7.3 When to Sprout

| Situation | Sprout? |
|---|---|
| Adding a feature to untested code | Yes — new code is tested, old is not |
| Can't easily test the old code | Yes — at least new code has tests |
| Time pressure (can't refactor now) | Yes — it's the responsible shortcut |
| The old code is well-tested | No — just modify the old code |

---

## 8. Rewrite vs Refactor Decision Framework

### 8.1 The Decision Matrix

```
                        Code is understandable
                        │
                   YES  │  NO
              ┌─────────┼──────────┐
  Tests exist │REFACTOR │ REFACTOR │
    YES       │(easy)   │ (harder) │
              ├─────────┼──────────┤
  Tests exist │REFACTOR │ CONSIDER │
    NO        │(add     │ REWRITE  │
              │ tests   │          │
              │ first)  │          │
              └─────────┼──────────┘
```

### 8.2 Rewrite Checklist

Only rewrite if ALL of these are true:

```
[ ] The system is so tangled that adding tests is impractical
[ ] Nobody on the team understands the code
[ ] The technology is truly obsolete (not just unfashionable)
[ ] You can define clear, testable requirements for the new system
[ ] You have enough time (rewrites always take 2-3x estimates)
[ ] Business can tolerate maintaining OLD system during rewrite
[ ] You have a strangler fig plan (not big bang switch)
```

### 8.3 The Second System Effect

```
WRONG: "We'll rewrite it and make it perfect this time"
  → You over-engineer the new system
  → It takes 3x longer than estimated
  → When it ships, it has different bugs
  → Meanwhile, old system needed features that were delayed

CORRECT: "We'll rewrite the most painful 20% and refactor the rest"
  → Strangler fig the worst parts
  → Refactor the rest incrementally
  → Never stop shipping features
```

---

## 9. Incremental Migration Plan Template

### 9.1 Template

```markdown
# Migration Plan: [From] → [To]

## Context
- What system/module is being migrated
- Why (business reason, not technical)
- Timeline: start date → target completion

## Current State
- Architecture diagram of current system
- Key dependencies
- Traffic/load characteristics
- Known issues with current system

## Target State
- Architecture diagram of target system
- Key improvements
- What stays the same

## Migration Strategy
- [ ] Strangler fig / Branch by abstraction / Parallel run / Expand-contract

## Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up new system skeleton
- [ ] Create abstraction layer / proxy
- [ ] Set up monitoring for both systems
- [ ] Define success metrics

### Phase 2: First Migration (Week 3-4)
- [ ] Migrate simplest component first (build confidence)
- [ ] Run parallel for N days
- [ ] Switch traffic for first component
- [ ] Retrospective: what did we learn?

### Phase 3: Core Migration (Week 5-8)
- [ ] Migrate components in order of dependency (leaves first)
- [ ] For each: test → parallel run → switch → verify
- [ ] Weekly check-in on metrics

### Phase 4: Cleanup (Week 9-10)
- [ ] Remove old code
- [ ] Remove abstraction layer (if no longer needed)
- [ ] Remove feature flags
- [ ] Update documentation
- [ ] Final retrospective

## Rollback Plan
- Each phase can be rolled back independently
- Rollback procedure for each component
- Data sync strategy during rollback

## Success Metrics
- Error rate: < X%
- Latency: < Xms p99
- Feature velocity: Y% improvement
- Incident frequency: Z% reduction

## Risks
| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Data inconsistency during migration | Medium | High | Dual-write + reconciliation |
| Performance regression | Low | Medium | Load testing before switch |
| Team bandwidth | High | Medium | Dedicate N devs, protect from interrupts |
```

---

## 10. Anti-Patterns

### 10.1 Big Bang Rewrite

```
WRONG: "Let's rewrite the whole thing"
  → 18 months later, the rewrite is only 60% done
  → The old system got 18 months of bug fixes the rewrite doesn't have
  → Management loses patience, cancels the rewrite
  → You're back to the old system, but now morale is destroyed

Notable failures:
  - Netscape Navigator rewrite (lost the browser war)
  - Perl 6 (took 15 years, renamed to Raku)
  - Many, many internal projects you'll never hear about
```

### 10.2 Refactoring Without a Goal

```
WRONG: "Let's clean up the codebase"
  → Two weeks later: "What did we achieve?"
  → "The code is cleaner" — but no measurable improvement
  → Management never approves refactoring time again

CORRECT: "Let's reduce the average time to add a payment method
  from 2 weeks to 3 days by extracting a PaymentGateway interface"
  → Measurable goal, clear scope, business-relevant outcome
```

### 10.3 Refactoring Everything at Once

```
WRONG: Refactoring all 200 files in one sprint
  → Merge conflicts with every other PR
  → If something breaks, the blast radius is the entire codebase
  → Code review is impossible (reviewer sees 5000 line diff)

CORRECT: Refactoring one module per sprint
  → Small, focused PRs (< 400 lines)
  → Clear before/after for code review
  → If it breaks, you know exactly what changed
```

### 10.4 Refactoring Without Tests

```
WRONG: "I'll refactor this and then add tests"
  → You refactor, something breaks silently
  → You deploy, bug reaches production
  → You hotfix, introducing more mess

CORRECT: "I'll add characterization tests, then refactor"
  → Tests capture current behavior (warts and all)
  → Refactor with confidence
  → Tests still pass = behavior preserved
```

### 10.5 Gold Plating During Refactoring

```
WRONG: "While I'm here, let me also add caching, optimize the
  queries, switch to a better ORM, and add comprehensive logging"
  → Scope creep turns a 2-day task into a 2-week odyssey
  → Each "improvement" is a potential regression

CORRECT: One refactoring goal per PR
  → "Extract PaymentService from OrderController"
  → That's it. Caching, ORM, and logging are separate tickets.
```

### 10.6 Premature Abstraction

```
WRONG: "We might need to support 5 databases, so let's create a
  DatabaseAbstractionLayer with adapters for each one"
  → You only ever use PostgreSQL
  → The abstraction makes simple queries 3x more complex
  → Nobody can debug because the real query is buried in 4 layers

CORRECT: Use PostgreSQL directly. If you ever need MySQL,
  THEN create the abstraction — with two real implementations
  to guide the design. "You Aren't Gonna Need It" (YAGNI).
```

---

## Quick Reference: Strategy Selection

```
What are you trying to do?

Replace a legacy system?
  → Strangler Fig (section 1)

Swap an implementation (library, service)?
  → Branch by Abstraction (section 2)

Replace critical business logic?
  → Parallel Run (section 3)

Change a database schema or API contract?
  → Expand and Contract (section 4)

Roll out refactored code gradually?
  → Feature Flags (section 5)

Untangle a complex dependency web?
  → Mikado Method (section 6)

Add features to messy code you can't change yet?
  → Sprout Class/Method (section 7)

Deciding whether to rewrite from scratch?
  → Decision Framework (section 8)
```
