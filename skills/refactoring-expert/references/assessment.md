# Codebase Assessment

Framework para avaliar a saude de um codebase e identificar onde investir esforco de refactoring. Metricas, ferramentas e comunicacao com stakeholders.

---

## Table of Contents

1. [Health Metrics](#1-health-metrics)
2. [Identifying Hot Spots](#2-identifying-hot-spots)
3. [Code Churn Analysis](#3-code-churn-analysis)
4. [Dependency Analysis](#4-dependency-analysis)
5. [Test Coverage as Health Indicator](#5-test-coverage-as-health-indicator)
6. [Technical Debt Inventory](#6-technical-debt-inventory)
7. [Impact vs Effort Matrix](#7-impact-vs-effort-matrix)
8. [Stakeholder Communication](#8-stakeholder-communication)
9. [Tools](#9-tools)

---

## 1. Health Metrics

### 1.1 Cyclomatic Complexity

Counts the number of independent paths through a function. Higher = harder to test, harder to understand.

| Complexity | Risk Level | Action |
|---|---|---|
| 1-5 | Low | Good — leave it |
| 6-10 | Moderate | Monitor — refactor if it changes often |
| 11-20 | High | Refactor — extract methods, simplify conditionals |
| 21+ | Critical | Urgent — this is a bug factory |

```python
# WRONG: Cyclomatic complexity = 12 (god function)
def process_order(order, user, payment):
    if not order:
        return {"error": "no order"}
    if not user:
        return {"error": "no user"}
    if user.is_banned:
        return {"error": "banned"}
    if not payment:
        return {"error": "no payment"}
    if payment.method == "card":
        if payment.amount > 10000:
            if user.verified:
                charge = stripe_charge(payment)
            else:
                return {"error": "verify first"}
        else:
            charge = stripe_charge(payment)
    elif payment.method == "pix":
        charge = pix_charge(payment)
    elif payment.method == "boleto":
        if order.total < 50:
            return {"error": "min 50 for boleto"}
        charge = boleto_charge(payment)
    else:
        return {"error": "unknown method"}
    # ... 40 more lines
```

```python
# CORRECT: Each function has complexity 2-3
def process_order(order, user, payment):
    validate_order_input(order, user, payment)
    authorize_user(user, payment)
    charge = execute_payment(payment, order)
    return create_order_record(order, user, charge)

def validate_order_input(order, user, payment):
    if not order:
        raise OrderError("no order")
    if not user:
        raise OrderError("no user")
    if not payment:
        raise OrderError("no payment")

def authorize_user(user, payment):
    if user.is_banned:
        raise AuthError("banned")
    if payment.amount > 10000 and not user.verified:
        raise AuthError("verify first")

def execute_payment(payment, order):
    strategies = {
        "card": stripe_charge,
        "pix": pix_charge,
        "boleto": lambda p: boleto_charge_with_min(p, order),
    }
    handler = strategies.get(payment.method)
    if not handler:
        raise PaymentError(f"unknown method: {payment.method}")
    return handler(payment)
```

### 1.2 Coupling (Afferent and Efferent)

- **Afferent coupling (Ca):** How many modules depend on THIS module. High = changing it is dangerous (many things break).
- **Efferent coupling (Ce):** How many modules THIS module depends on. High = it's fragile (many reasons to change).
- **Instability = Ce / (Ca + Ce):** 0 = maximally stable, 1 = maximally unstable.

```
WRONG: A single "Utils" module imported by 47 files (Ca=47, Ce=12)
  → Changing anything in Utils can break 47 files
  → Every dev touches Utils → merge conflicts constantly

CORRECT: Split Utils into focused modules
  utils/string-helpers.ts   (Ca=8, Ce=0)
  utils/date-formatting.ts  (Ca=12, Ce=1)
  utils/validation.ts       (Ca=15, Ce=2)
  utils/currency.ts         (Ca=6, Ce=0)
  → Each module has a clear responsibility and limited blast radius
```

### 1.3 Cognitive Complexity

Goes beyond cyclomatic — penalizes nesting, breaks in linear flow, and "WTF per minute" moments:

```typescript
// WRONG: Cognitive complexity = 23
function getDiscount(user: User, cart: Cart): number {
  let discount = 0;
  if (user.isPremium) {                         // +1
    if (cart.total > 100) {                     // +2 (nesting)
      discount = 15;
      if (user.yearsActive > 5) {              // +3 (nesting)
        discount = 20;
        for (const item of cart.items) {        // +4 (nesting)
          if (item.category === "electronics") { // +5 (nesting)
            discount = Math.min(discount + 5, 30);
            break;                               // +1 (break)
          }
        }
      }
    } else {                                    // +1
      discount = 5;
    }
  } else if (cart.total > 200) {                // +1
    discount = 10;
  }
  return discount;
}

// CORRECT: Cognitive complexity = 4
function getDiscount(user: User, cart: Cart): number {
  if (!user.isPremium) {
    return cart.total > 200 ? 10 : 0;
  }
  if (cart.total <= 100) {
    return 5;
  }

  const base = user.yearsActive > 5 ? 20 : 15;
  const electronicsBonus = hasElectronics(cart) ? 5 : 0;
  return Math.min(base + electronicsBonus, 30);
}

function hasElectronics(cart: Cart): boolean {
  return cart.items.some(item => item.category === "electronics");
}
```

### 1.4 Bug Density

Bugs per 1000 lines of code (or per module). Track over time to spot deteriorating modules.

```
Module                  | Lines | Bugs (6mo) | Bug Density
----------------------- | ----- | ---------- | -----------
payments/               | 2,400 | 18         | 7.5 per KLOC  ← FIX THIS
auth/                   | 1,800 | 3          | 1.7 per KLOC
notifications/          | 900   | 1          | 1.1 per KLOC
users/                  | 3,200 | 5          | 1.6 per KLOC
reports/                | 1,100 | 0          | 0.0 per KLOC
```

Industry benchmarks: < 1 per KLOC is good, 1-5 is normal, > 5 needs attention.

---

## 2. Identifying Hot Spots

Hot spots are files that change frequently AND have bugs. This intersection is where refactoring pays off most.

### 2.1 The Hot Spot Formula

```
Hot Spot Score = (change_frequency * 0.4) + (bug_count * 0.4) + (complexity * 0.2)
```

Normalize each metric to 0-1 range, then apply weights. Files scoring > 0.7 are hot spots.

### 2.2 Finding Hot Spots with Git

```bash
# Top 20 most-changed files in last 6 months
git log --since="6 months ago" --pretty=format: --name-only \
  | sort | uniq -c | sort -rn | head -20

# Files that appear in bug-fix commits
git log --since="6 months ago" --grep="fix\|bug\|hotfix" \
  --pretty=format: --name-only \
  | sort | uniq -c | sort -rn | head -20

# Combine: files that change often AND appear in bug fixes
comm -12 \
  <(git log --since="6mo" --pretty=format: --name-only | sort -u) \
  <(git log --since="6mo" --grep="fix\|bug" --pretty=format: --name-only | sort -u)
```

### 2.3 Visualizing Hot Spots

```
   High Change Frequency
         │
    ┌────┼────────────────┐
    │    │  HOT SPOTS     │
    │    │  (refactor NOW) │
    │    │                 │
    ├────┼─────────────────┤
    │    │  Stable code    │
    │    │  (leave alone)  │
    │    │                 │
    └────┼────────────────┘
         │
   Low Change Frequency
         └──────────────────────
         Low Bugs        High Bugs
```

Files in the top-right quadrant (high change + high bugs) are your highest priority.

---

## 3. Code Churn Analysis

Churn = lines added + lines removed over time. High churn on the same file indicates instability.

### 3.1 Measuring Churn

```bash
# Churn per file (last 3 months)
git log --since="3 months ago" --numstat --pretty=format: \
  | awk '{added[$3]+=($1+0); removed[$3]+=($2+0)} END {for(f in added) if(f!="") printf "%d\t%d\t%s\n", added[f], removed[f], f}' \
  | sort -t$'\t' -k1 -rn | head -20

# Churn by author (who touches this file most?)
git log --since="6 months ago" -- src/payments/ \
  --pretty=format:"%an" | sort | uniq -c | sort -rn
```

### 3.2 Interpreting Churn

| Pattern | Meaning | Action |
|---|---|---|
| High churn, many authors | Unclear ownership, conflicting approaches | Define ownership, extract modules |
| High churn, one author | Active development or constant fixing | Check if fixing bugs or adding features |
| High churn, test files | Tests are brittle, coupled to implementation | Refactor tests to test behavior not implementation |
| Low churn, high complexity | Scary code nobody wants to touch | This is the "lava layer" — assess carefully |

### 3.3 The Lava Layer Anti-Pattern

```
WRONG: Code nobody touches because it's scary
  → "Don't change payment_processor.php, it's been working for 3 years"
  → Nobody understands it, no tests, but it processes $2M/day
  → One day it WILL break and nobody will know how to fix it

CORRECT: Gradually add characterization tests
  → Write tests that document what it DOES (not what it should do)
  → Once test-covered, you can safely refactor
  → Each sprint, add a few more tests to the lava layer
```

---

## 4. Dependency Analysis

### 4.1 Module Dependency Graph

Map which modules depend on which. Look for:
- **Circular dependencies:** A depends on B depends on C depends on A
- **God modules:** Everything depends on one module
- **Orphan modules:** Nothing uses them (dead code candidates)

```bash
# TypeScript: find import chains
grep -rn "from ['\"]\.\./" src/ --include="*.ts" \
  | awk -F: '{print $1}' | sort | uniq -c | sort -rn

# PHP: find use statements crossing module boundaries
grep -rn "^use App\\\\Modules\\\\" app/Modules/ --include="*.php" \
  | sed 's/.*use App\\Modules\\\\//' | cut -d'\\' -f1 \
  | sort | uniq -c | sort -rn

# Go: find inter-package imports
grep -rn '"github.com/yourorg/yourapp/' --include="*.go" \
  | awk -F'"' '{print $2}' | sort | uniq -c | sort -rn
```

### 4.2 Circular Dependency Detection

```
WRONG: Circular dependency
  UserService → OrderService → PaymentService → UserService
  → Changes cascade unpredictably
  → Can't test any module in isolation

CORRECT: Break the cycle with events or interfaces
  UserService → OrderService → PaymentService
                                    │
                                    ├→ emits PaymentCompleted event
                                    │
  UserService ← listens to PaymentCompleted
  → Each module can be tested independently
  → Changes in PaymentService don't force changes in UserService
```

### 4.3 Dependency Metrics to Track

| Metric | Good | Warning | Critical |
|---|---|---|---|
| Max dependency depth | < 4 | 4-6 | > 6 |
| Circular dependencies | 0 | 1-2 | > 2 |
| Modules with > 10 dependents | 0-1 | 2-3 | > 3 |
| Average fan-out per module | < 5 | 5-8 | > 8 |

---

## 5. Test Coverage as Health Indicator

Coverage alone is misleading. Use it as one signal among many.

### 5.1 What Coverage Actually Tells You

```
WRONG interpretation:
  "We have 85% coverage, our code is well-tested"

CORRECT interpretation:
  "85% of lines execute during tests — but we don't know
   if the tests actually ASSERT anything meaningful"
```

### 5.2 Coverage Categories

| Coverage Type | What It Measures | Value |
|---|---|---|
| Line coverage | Which lines execute | Low — lines run doesn't mean behavior tested |
| Branch coverage | Which if/else paths run | Medium — better but still misses logic |
| Mutation coverage | Tests catch code changes | High — proves tests actually verify behavior |

### 5.3 Actionable Coverage Strategy

```
DON'T: Target 100% line coverage (leads to meaningless tests)

DO: Target high coverage on hot spots
  → 90%+ on modules that change often or have bugs
  → 70%+ on business-critical paths (payments, auth)
  → 50%+ on everything else
  → 0% on generated code, migrations, config
```

### 5.4 Coverage Diff in PRs

```bash
# Only show coverage for CHANGED files (not the whole project)
# This focuses review on what matters

# Jest example
npx jest --coverage --changedSince=main --coverageReporters=text

# PHPUnit example
php artisan test --coverage --min=80

# Go example
go test -coverprofile=coverage.out ./changed/package/...
go tool cover -func=coverage.out
```

---

## 6. Technical Debt Inventory

### 6.1 Debt Categories

| Category | Examples | How to Detect |
|---|---|---|
| **Code debt** | Duplicated code, god classes, magic numbers | Linters, complexity tools, code review |
| **Architecture debt** | Wrong patterns, circular deps, monolith that should be modular | Dependency analysis, team pain |
| **Infrastructure debt** | Manual deploys, no CI/CD, outdated runtimes | Operations incidents, deploy frequency |
| **Test debt** | No tests, brittle tests, slow test suite | Coverage reports, test failure rate |
| **Documentation debt** | No README, outdated API docs, tribal knowledge | Onboarding time for new devs |

### 6.2 Debt Registry Template

Track debt items like you track bugs:

```markdown
## Debt Item: Payment module has no tests

- **ID:** DEBT-042
- **Category:** Test debt
- **Module:** src/payments/
- **Pain level:** High (last 3 production bugs were here)
- **Effort:** Medium (2-3 days to add characterization tests)
- **Priority:** P1 (high pain, medium effort)
- **Owner:** Team Payments
- **Created:** 2024-01-15
- **Target:** 2024-Q1
- **Status:** In progress (40% covered)
```

### 6.3 Debt Decay Rate

Track how debt grows or shrinks over time:

```
Quarter  | New Debt Items | Resolved | Net | Total
---------|---------------|----------|-----|------
2024-Q1  | 12            | 5        | +7  | 47
2024-Q2  | 8             | 11       | -3  | 44
2024-Q3  | 6             | 9        | -3  | 41
2024-Q4  | 5             | 8        | -3  | 38
```

If net is consistently positive, debt is growing faster than you resolve it. This needs management attention.

---

## 7. Impact vs Effort Matrix

### 7.1 The Matrix

```
  High Impact
       │
  ┌────┼──────────────────┐
  │ P1 │  P2              │
  │ DO │  PLAN & SCHEDULE  │
  │ NOW│                   │
  ├────┼──────────────────┤
  │ P3 │  P4              │
  │ BOY│  DON'T DO        │
  │SCOUT                  │
  └────┼──────────────────┘
       │
  Low Impact
       └──────────────────────
       Low Effort       High Effort
```

### 7.2 Scoring Guide

**Impact (1-5):**
- 5: Causes production incidents, blocks feature development
- 4: Slows every PR in this area, confuses new developers
- 3: Causes occasional bugs, makes testing harder
- 2: Code smell but doesn't cause problems
- 1: Aesthetically unpleasant but functional

**Effort (1-5):**
- 1: < 1 day, low risk, can do in a PR alongside feature work
- 2: 1-3 days, moderate risk, standalone PR
- 3: 1-2 weeks, requires planning, multiple PRs
- 4: 1 month, needs architecture changes, cross-team coordination
- 5: 1+ quarter, major migration, significant risk

### 7.3 Prioritization Spreadsheet

```
Debt Item                        | Impact | Effort | Score | Priority
---------------------------------|--------|--------|-------|--------
Add tests to payments module     | 5      | 3      | 1.67  | P1
Extract auth from UserController | 4      | 2      | 2.00  | P1
Migrate from MySQL to Postgres   | 2      | 5      | 0.40  | P4
Rename inconsistent variables    | 1      | 1      | 1.00  | P3
Break circular dependency A↔B    | 4      | 4      | 1.00  | P2
```

Score = Impact / Effort. Higher = better ROI. But also consider risk and dependencies.

---

## 8. Stakeholder Communication

### 8.1 Explaining Tech Debt to Non-Technical People

```
WRONG: "We need to refactor the authentication module because
  the cyclomatic complexity is too high and there are circular
  dependencies between the user and payment services."

CORRECT: "Our login system was built 3 years ago for 100 users.
  Now we have 50,000. Every time we try to add a new feature
  (like SSO or 2FA), it takes 3x longer than it should because
  the code is tangled. Last month, a simple change caused a
  4-hour outage. We need 2 weeks to untangle it, which will
  make new features 3x faster to build going forward."
```

### 8.2 The Business Case Template

```markdown
## Refactoring Proposal: [Module Name]

### The Problem (business impact)
- Feature velocity in this area: X days (should be Y days)
- Production incidents in last 6 months: N
- Developer time spent on workarounds: Z hours/month

### The Proposal
- What we'll do (in plain language)
- Timeline: N weeks
- Team: N developers

### The Payoff
- Feature velocity improvement: from X days to Y days
- Incident reduction: estimated Z fewer incidents/quarter
- Developer satisfaction: less frustration, less turnover risk

### The Risk of NOT Doing It
- Incident frequency will increase as traffic grows
- New features will take even longer
- Good developers will leave (they hate working in bad code)
```

### 8.3 Metrics That Resonate with Management

| Technical Metric | Business Translation |
|---|---|
| Cyclomatic complexity | "Time to add a feature" |
| Bug density | "Customer-facing bugs per month" |
| Test coverage | "Confidence that deploys won't break" |
| Code churn | "How much rework we're doing" |
| Deploy frequency | "How fast we ship" |
| Mean time to recovery | "How fast we fix outages" |

### 8.4 The 20% Rule

Negotiate 20% of sprint capacity for tech debt. Don't ask for "refactoring sprints" — they get cancelled when deadlines approach:

```
WRONG: "We need a 2-week refactoring sprint"
  → Gets pushed back every quarter
  → Debt accumulates

CORRECT: "Every sprint, we allocate 2 story points for tech debt"
  → Consistent improvement
  → Compounding returns
  → Team morale stays healthy
```

---

## 9. Tools

### 9.1 Static Analysis

| Tool | Languages | Key Metrics | Free? |
|---|---|---|---|
| **SonarQube** | 30+ | Complexity, duplication, coverage, bugs, smells | Community Edition free |
| **Code Climate** | 10+ | Maintainability, test coverage, churn | Open source free |
| **PHPStan/Larastan** | PHP | Type errors, dead code, complexity | Free |
| **ESLint** (with metrics plugin) | JS/TS | Complexity, nesting, line length | Free |
| **golangci-lint** | Go | 50+ linters, complexity, style | Free |
| **Ruff** | Python | Speed-focused linter, replaces flake8+isort+black | Free |

### 9.2 SonarQube Quick Setup

```yaml
# docker-compose.yml
services:
  sonarqube:
    image: sonarqube:community
    ports:
      - "9000:9000"
    environment:
      - SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true
    volumes:
      - sonar_data:/opt/sonarqube/data

volumes:
  sonar_data:
```

```bash
# Scan a project
docker run --rm \
  -v "$(pwd):/usr/src" \
  sonarsource/sonar-scanner-cli \
  -Dsonar.projectKey=my-project \
  -Dsonar.sources=src/ \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=YOUR_TOKEN
```

### 9.3 Quick Complexity Check (No Tools Needed)

```bash
# Find the longest files (often the most complex)
find src/ -name "*.ts" -o -name "*.php" -o -name "*.go" \
  | xargs wc -l | sort -rn | head -20

# Find deeply nested code (4+ levels of indentation)
grep -rn "^                " src/ --include="*.ts" \
  | wc -l

# Find functions with too many parameters
grep -rn "function.*,.*,.*,.*,.*," src/ --include="*.ts"

# Find TODO/FIXME/HACK comments (indicators of known debt)
grep -rin "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" src/ \
  | wc -l
```

### 9.4 CI Integration

Run quality gates in CI to prevent debt from growing:

```yaml
# GitHub Actions example
name: Quality Gate
on: pull_request

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check complexity
        run: npx eslint src/ --rule '{"complexity": ["error", 15]}'

      - name: Check test coverage
        run: |
          npm test -- --coverage --coverageReporters=json-summary
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 70" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 70% threshold"
            exit 1
          fi

      - name: Check for new TODOs
        run: |
          NEW_TODOS=$(git diff origin/main --unified=0 | grep "^\+" | grep -i "TODO\|FIXME\|HACK" | wc -l)
          if [ "$NEW_TODOS" -gt 0 ]; then
            echo "WARNING: $NEW_TODOS new TODO/FIXME/HACK comments added"
          fi
```

---

## Quick Reference: Assessment Checklist

Before starting any refactoring effort, answer these questions:

```
[ ] What files change most often? (git log analysis)
[ ] What files have the most bugs? (bug tracker + git grep)
[ ] Where do these overlap? (hot spots)
[ ] What's the cyclomatic complexity of the worst files?
[ ] Are there circular dependencies?
[ ] What's the test coverage on hot spots?
[ ] Can we articulate the business impact of the debt?
[ ] Do we have buy-in from stakeholders for refactoring time?
[ ] Do we have a debt registry to track progress?
[ ] Is there a CI quality gate to prevent new debt?
```
