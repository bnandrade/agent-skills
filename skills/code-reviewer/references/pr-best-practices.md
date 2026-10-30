# PR Best Practices

Como criar e revisar Pull Requests de forma eficiente. Regras praticas sobre tamanho, descricao, commits, etiqueta de review.

---

## 1. Creating PRs

### 1.1 PR Size

Small PRs get reviewed faster and more thoroughly. Large PRs get rubber-stamped.

| Lines Changed | Category | Review Quality |
|---|---|---|
| < 100 | Small | Thorough, fast |
| 100-200 | Ideal | Good balance |
| 200-400 | Acceptable | Consider splitting |
| 400-600 | Large | Quality drops, split if possible |
| > 600 | Too large | Must split |

**Data:** Effectiveness drops significantly after 200 lines. After 400, reviewers skim. After 600, they approve to move on.

### 1.2 How to Split Large PRs

**By layer (vertical):**
```
PR 1: Migration + model
PR 2: Service layer + business logic
PR 3: API endpoints + validation
PR 4: Frontend UI
```

**By feature slice (horizontal):**
```
PR 1: Create order (minimal happy path)
PR 2: Add discount calculation
PR 3: Add cancellation
PR 4: Add notifications
```

**Refactor-then-feature:**
```
PR 1: Extract PaymentService from OrderController (no behavior change)
PR 2: Add new payment method via PaymentService
```

**Rules:**
- Each PR must be independently deployable
- Each PR must pass CI independently
- Use feature flags for incomplete features in production paths
- Reference follow-up PRs: "Part 1 of 3. See #456, #457"

### 1.3 PR Description

A good description saves reviewers 30 minutes of "why?"

```markdown
## What
Add rate limiting to login endpoint (5 attempts/min per IP).

## Why
Brute-force attempts on login — 50K failed logins/day (SEC-234).

## How
Laravel's built-in throttle middleware per-route. Considered Redis-based
but built-in is sufficient for current scale (< 10K RPM).

## Testing
- [x] Unit tests for throttle behavior
- [x] Manual: 6th attempt returns 429
- [x] Existing login tests pass

## Notes
- Configurable via RATE_LIMIT_LOGIN env var
- Throttle key is IP-based (blocks before auth)
```

### 1.4 Commit Messages

```
# Conventional Commits
<type>(<scope>): <description>

# Types
feat:     new feature          fix:      bug fix
refactor: code restructuring   test:     adding/fixing tests
docs:     documentation        perf:     performance
chore:    build, CI, tooling   style:    formatting only

# Examples
feat(orders): add bulk discount calculation
fix(auth): prevent session fixation on login
perf(search): add composite index for status+created_at
```

**Rules:**
- Imperative mood: "add feature" not "added feature"
- First line < 72 characters
- Body explains WHY, not WHAT
- Reference ticket: `fix(auth): prevent brute force (SEC-234)`

**Bad commits to flag:**
```
"fix", "wip", "asdf", "changes", "update file"
"add variable", "fix typo", "remove console.log"
# Should be squashed before requesting review
```

### 1.5 Self-Review Checklist

Before requesting review:
```
- [ ] Re-read entire diff
- [ ] Remove debug code (console.log, dd(), print())
- [ ] Remove commented-out code
- [ ] Remove TODO comments (create tickets instead)
- [ ] Check for sensitive data (API keys, passwords)
- [ ] Run full test suite locally
- [ ] Check description is complete
- [ ] Check size (< 400 lines, split if larger)
```

### 1.6 Draft PRs

Use for: proposing architecture, validating approach, getting early feedback on large features, learning a new codebase.

Include: "Draft — looking for feedback on approach", specific questions, what's done vs remaining.

### 1.7 Linking Issues

```markdown
Closes #123          # GitHub auto-close
Fixes #456           # GitHub auto-close
Implements JIRA-1234 # External tracker
```

---

## 2. Reviewing PRs

### 2.1 Turnaround Time

| PR Size | Target |
|---|---|
| Small (< 100 lines) | < 1 hour |
| Medium (100-300) | < 4 hours |
| Large (300-500) | < 24 hours |
| Very large (> 500) | Ask author to split |

If you can't review in time, let the author know and suggest another reviewer.

### 2.2 Review Workflow

**Step 1 — Description (2 min):** What problem? What approach? Any concerns?

**Step 2 — Diff overview (2 min):** How many files? Core vs boilerplate? Tests? Migrations?

**Step 3 — Architecture (5 min):** Does approach make sense? Simpler way? Follows patterns?

**Step 4 — Line-by-line:** Focus on logic, not style. Use review-checklist.md categories.

**Step 5 — Summary:** Overall assessment. Blocking vs non-blocking. Questions.

### 2.3 Suggestion Blocks

Don't just say "wrong" — show the fix.

````markdown
Instead of: "This might have an N+1 problem"

Use suggestion block:
```suggestion
$posts = Post::with(['author', 'comments'])->paginate(20);
```
Eager-loads relationships, fixing the N+1.
````

### 2.4 Blocking vs Non-Blocking

```
Blocking (must fix):
[BUG] Crashes on null input — line 42 dereferences nullable
[SEC] SQL injection — user input in raw query

Non-blocking (nice to have):
[SUG] Rename `data` to `orderItems` for clarity
[PERF] Could use caching, but traffic doesn't justify yet
nit: trailing whitespace on line 78

Questions:
[Q] Intentionally skipping validation for admins?
[Q] What happens if payment gateway times out?
```

**Prefix guide:**
| Prefix | Meaning | Blocks? |
|---|---|---|
| `[BUG]` | Logic error, crash | Yes |
| `[SEC]` | Security vulnerability | Yes |
| `[PERF]` | Performance issue | Usually |
| `[DESIGN]` | Wrong abstraction | Depends |
| `[READ]` | Naming, clarity | No |
| `[SUG]` | Alternative approach | No |
| `[Q]` | Clarification needed | Maybe |
| `[NICE]` | Praise | No |
| `nit:` | Trivial, cosmetic | Never |

### 2.5 Approve with Comments

When all issues are non-blocking, approve and leave comments. Don't "request changes" for nits.

```
"Approved with minor suggestions. Approach is solid.
Non-blocking items can be addressed here or in follow-up."
```

### 2.6 Request Changes — Only for Blockers

Reserve for: security vulnerabilities, bugs affecting users, missing tests for critical logic, breaking API changes, data loss risk.

Never for: naming preferences, style (linters), minor refactoring, "I'd do it differently."

### 2.7 Re-Review

After author pushes fixes:
1. Read responses to each comment
2. Check only new commits (not entire PR)
3. Verify blocking issues fixed
4. Approve if blockers resolved (don't re-block for new nits)

### 2.8 Don't Rewrite in the Review

If the PR needs a fundamentally different approach, say so early at the architecture level. Don't leave 50 line-by-line comments on code that should be deleted.

```
"The current approach processes orders synchronously in the request.
Given 10K orders/day, this should be a queued job:
1. Create ProcessOrder job
2. Dispatch from controller
3. Return 202 Accepted
Happy to pair on this."
```

---

## 3. Team Conventions

### 3.1 Required Approvals

```
Small PRs, non-core:               1 approval
Regular features/fixes:             1 approval
Core infra / auth / payments:       2 approvals
Production migrations:              2 approvals
Security-sensitive:                 2 approvals + security reviewer
Breaking API changes:               2 approvals + tech lead
```

### 3.2 CI Must Pass

Don't review code that fails CI — it wastes time.

```
Merge requirements:
- [ ] CI green
- [ ] No merge conflicts
- [ ] Required approvals met
- [ ] Branch up to date with target
```

### 3.3 CODEOWNERS

```
# .github/CODEOWNERS
/app/Models/          @backend-team
/app/Http/Middleware/ @backend-team @security-team
/resources/js/        @frontend-team
/database/migrations/ @backend-team @dba-team
*.yml                 @devops-team
```

### 3.4 Review Rotation

Spread load to avoid silos and burnout:
- Round-robin or load-balanced assignment
- Avoid one person reviewing everything (bottleneck)
- Include juniors in reviews (learning)
- Don't always pair the same reviewers (echo chamber)

### 3.5 Don't Self-Merge

Self-merge allowed: production hotfix (retrospective review within 24h), docs-only, automated dependency updates.

Never self-merge: code changes, config, infra, migrations.

### 3.6 Stale PRs

PRs open > 5 days are stuck. Day 3: ping reviewer. Day 5: escalate. Day 10: close, rebase, or prioritize.

---

## 4. Anti-Patterns

### 4.1 Rubber-Stamp

Approval in 2 min on a 500-line PR. "LGTM" without comments on complex changes. Prevention: keep PRs small, don't pressure reviewers.

### 4.2 Nitpick Spiral

20 comments about naming, 0 about logic. Multiple rounds for formatting. Prevention: use linters, prefix nits, approve with nits.

### 4.3 Review-by-Committee

5 reviewers, 5 opinions, conflicting feedback. Prevention: max 2 required reviewers, primary reviewer makes the call, use ADRs for architectural debates.

### 4.4 Drive-by Reviews

One unhelpful comment, no follow-up. "This looks weird" (no suggestion). If you start a review, finish it.

---

## 5. Templates

### 5.1 PR Description

```markdown
## What
[1-3 sentence summary]

## Why
[Issue link. Business reason]

## How
[Approach. Alternatives considered]

## Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual steps: [describe]

## Checklist
- [ ] Self-reviewed diff
- [ ] No debug code
- [ ] No secrets
- [ ] Migration reversible
- [ ] API backward-compatible
```

### 5.2 Reviewer Checklist

```markdown
- [ ] Understood purpose (read description + issue)
- [ ] Tests exist + cover edge cases
- [ ] Security (auth, injection, data exposure)
- [ ] Performance (N+1, pagination, caching)
- [ ] Error handling (all I/O handled)
- [ ] Breaking changes (API, migrations)
- [ ] Naming clear and consistent
- [ ] No dead code or debug statements
- [ ] PR size reasonable (< 400 lines)
```
