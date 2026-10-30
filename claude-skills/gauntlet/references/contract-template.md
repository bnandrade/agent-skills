# Contract template

The contract is the only source of truth for the run. Every agent receives it
verbatim. Write it before any delegation; derive what you can from the request
and the repository instead of asking. Keep it short — one line per item is the
norm. Record it with `node "$H" contract <run-id> -`. Recording a materially
different contract later is allowed, but it makes every critic and judge
result recorded so far stale (the evidence identity includes the contract):
the review must be redone against the new text.

```markdown
# Gauntlet contract — <run-id>

## Objective
One sentence: what must be true when this is done.

## Scope
- In: <files / modules / behaviors that may change>
- Out (non-goals): <what must not change even if tempting — refactors, style, unrelated bugs, dependencies, architecture>

## Acceptance criteria
- AC1: <observable, testable statement — and its scope: which routes, inputs, files or states it covers>
- AC2: ...
(Each AC declares its scope clearly enough to be evaluated and maps to at least one gate, test or critic check. A requirement only a human can verify is not an AC: it goes under Human gates, only there.)

## Invariants and forbidden regressions
- INV1: <existing behavior that must keep working — name the test or the check that proves it>
- INV2: ...

## Closed decisions
- <decision the user already made; not open for re-litigation>

## Deterministic gates available
- typecheck: <command>     (L0)
- unit: <command>          (L1)
- build: <command>         (L2)
- <artifact>: <command>    (L3, only if the contract needs it)
(Only commands the repository actually supports. If none exists for a required behavior, the builder adds the targeted test as part of the change.)

## Risk triage
Tier: LIGHT | STANDARD | ELEVATED | CRITICAL
Signals: <the concrete rubric signals that justify the tier, or "none">
Lenses: <general [+ security | data | concurrency | infra | destructive | api | ux]>

## Evidence required
- <gates record, diff, specific test output, screenshot via ui-verifier, migration up/down log ...>

## Human gates
- <what a technical PASS does not clear: merge, deploy, visual approval, product decision, destructive step, any requirement only a human can verify>
```

## Writing good acceptance criteria

- State the outcome, not the implementation: "channel filtering still narrows
  the list to the selected channel" — not "the `<select>` keeps working". An
  evaluator coupled to one implementation invalidates its own verdict.
- State the scope the clause covers — "every tenant-scoped route", "the three
  export handlers", "inputs up to 1 MB". A clause counts only when current
  evidence of matching scope establishes it; an evaluator reads the scope
  from what the clause names, so a vague one cannot be established.
- Prefer criteria a gate can prove. When only a human can judge (taste,
  product fit, a production-only observation), list it only under **Human
  gates** — never duplicated as an acceptance criterion.
- Name the negative cases that matter: empty input, concurrent access, failure
  path, rollback.

## Scope discipline

The contract is a constraint for every role. Scope drift found in the diff —
touched files outside the scope, new dependencies, deleted or weakened tests,
"while I was there" refactors — goes back to the builder before any gate is
spent on it.
