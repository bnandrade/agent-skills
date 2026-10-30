# Critic protocol and lenses

A critic's job is to **refute** the conclusion that the contract is satisfied.
It inspects the artifact and the evidence; it does not review the builder's
story. It returns ranked gaps with a severity that means something downstream,
and `gaps: []` when it finds nothing material.

## What the orchestrator hands to a critic

```
Contract: <verbatim>
Lens: <general | security | data | concurrency | infra | destructive | api | ux>
Lens checklist: ${CLAUDE_SKILL_DIR}/references/critic-protocol.md   (this file — the critic applies only its lens's section)
Repository: <path>   (read anything; modify nothing)
Diff: .gauntlet/runs/<id>/evidence/diff.patch
Gates: .gauntlet/runs/<id>/evidence/gates.json  (+ logs under evidence/gates/)
Claims to test (optional): <the builder's claims, labelled as claims>
Output: the JSON format below, nothing else after it
```

Never hand over: the builder's report as evidence, another critic's result,
a previous round's critic result, or the orchestrator's opinion.

An **external reviewer** — a reviewer from another model family, run through
the adapter — receives this package from its runner (the contract and the
claims as files it reads, never pasted into its prompt) and follows the same
rules and result format. It takes the slot of the lens it runs; it is not an
extra critic.

The result is recorded through the harness, which binds it to the evidence
identity of the moment (tree + contract + the concrete gate execution on
record). If the contract changes or the gates are executed again afterwards,
the result becomes stale and a fresh critic must run; do not reuse a critic's
conclusion across those changes by hand. Record who reviewed with
`--by <reviewer>`; for a review that runs long or in the background, pin it
with `--evidence <digest>` (the `identity.evidence` that `status` showed when
the package was handed over) so the harness refuses it if that evidence moved
while the critic was reading.

## Result format

```json
{
  "gaps": [
    {
      "severity": "BLOCKER | CRITICAL | MAJOR | MINOR | POLISH",
      "contract": "the clause violated — AC2, INV1, scope, or an objective gate",
      "evidence": "file:line, test name, command output, reproduction — something a third party can re-check",
      "description": "what is wrong and why it matters for this contract",
      "reproduction": "optional: the exact sequence that shows the defect"
    }
  ],
  "summary": "one paragraph: what was inspected, what was executed, the conclusion",
  "verified": ["optional list of what the critic actually ran or traced"]
}
```

Rules for the critic:

- Rank gaps by severity, largest first. Material gaps (`BLOCKER`, `CRITICAL`,
  `MAJOR`) need reproducible evidence. Cap material gaps at five; if there are
  more, the change is not reviewable and that is itself the BLOCKER.
- `MAJOR` only when an acceptance criterion or invariant is unmet or not
  established, or a material in-scope risk is unmet. Optional improvements
  are `MINOR` or `POLISH`, never `MAJOR`.
- A suspicion that cannot be demonstrated is not a gap — put it in the summary
  as "not verified: …" with what evidence would settle it. An explicit
  mandatory acceptance criterion or invariant that current evidence of
  sufficient scope does not establish is not a suspicion: it is material —
  `MAJOR`, or `BLOCKER` when it cannot be evaluated at all with the
  environment and evidence available. A requirement listed only under Human
  gates is never a gap because automation cannot prove it.
- Objective gates take precedence over preference. Do not re-litigate a passed
  gate with an opinion.
- Do not request a broad audit for a local change. Do not invent requirements.
- Do not modify files. Run tests, read code, trace calls, reproduce — that is
  all allowed; editing is not.

## Lenses

The general lens is always present from STANDARD up. Add a specialized lens
only for a surface the triage rubric flagged.

### `general`

This lens alone owns the **clause-establishment audit**. For each explicit
acceptance criterion and invariant of the contract, ask:

1. What evidence establishes this clause?
2. Was that evidence actually produced in this execution?
3. Is it current — produced for the evidence identity under review?
4. Does its scope cover the scope the clause states?

- Evidence is a gate log, a test that actually executed, or a trace or
  reproduction you made yourself. A test name, a comment, a builder claim or
  a narrative assertion alone is not evidence. A skipped test establishes
  nothing; a test command that collected zero tests does not establish the
  behavior it names.
- Evidence narrower than the requirement does not prove the requirement: a
  test of one handler does not establish "every tenant-scoped route". Scope
  is what the clause actually names or quantifies — a universal statement is
  not a demand to enumerate every conceivable input; representative tests
  plus a trace of the code path they share can establish it.
- Try to establish the clause yourself first (run the check, trace the
  path). Only a clause you could not establish is a gap. Several clauses
  unestablished for the same root cause are one gap, not one per clause.
- Requirements under Human gates are not audited as automated clauses.

Then:

- Does each acceptance criterion hold on the actual code path, not just in the test's fixture?
- Invariants and forbidden regressions: trace the touched paths; run the checks that prove them.
- Failure paths: errors, empty inputs, timeouts, partial state.
- Tests added: do they assert the contract's outcome or the implementation's shape? Would they still pass if the feature were broken? (kill one line mentally.)
- Scope: files outside the contract, dependency or architecture changes, weakened or deleted tests.
- Rollback: can the change be reverted as a unit without data or config residue?

### `security`
- Authentication and authorization on every new or changed entry point; object-level checks (IDOR/BOLA); tenant isolation in queries and caches.
- Input handling: injection (SQL, command, template, header), path traversal, deserialization, SSRF.
- Secrets in code, logs, fixtures or error messages; crypto choices; token lifetimes.
- Trust boundaries crossed by the change (browser → server → third party → agent tools); prompt injection surfaces when an LLM consumes untrusted content.
- Denials fail closed; errors do not leak internals.

### `data`
- Schema changes: reversible? Down migration real? Locks and duration on large tables?
- Backfills: idempotent, resumable, batched; nulls and defaults; constraints added after data is consistent.
- Serialization and cache: versioning, invalidation, stale reads; ordering assumptions.
- Integrity: foreign keys, uniqueness, transactions around multi-step writes; partial failure leaves a consistent state.

### `concurrency`
- Shared mutable state and its owner; races between timers, events, retries and cancellation.
- Idempotency of handlers; double submission; lost updates; ordering guarantees.
- Resource lifecycle: what is started is stopped on every path (timers, sockets, browsers, processes, locks).
- Tests that are deterministic under scheduling variance — no `sleep`-based assumptions.

### `infra`
- Blast radius of the configuration change; staged rollout or all-at-once; rollback path and its duration.
- Secrets and environment handling; least privilege; drift between environments.
- Health checks, readiness, migrations ordering relative to deploy; observability of the failure mode.

### `destructive`
- Which operation is irreversible, exactly, and what guards it (dry-run, confirmation, scoping, backups).
- Filters and scoping of deletes/updates: can the where-clause be empty? Is the target set logged before acting?
- Idempotency and re-run safety; external side effects (emails, webhooks, payments) cannot fire twice.
- Human gate: does the change execute anything irreversible without an explicit human step?

### `api`
- Backward compatibility of the wire format; versioning; deprecation path.
- Error contract, pagination, filtering, idempotency keys; documentation matches behavior.
- Consumers inside the repository updated; contract tests present.

### `ux`
Delegate observable verification to the `ui-verifier` skill (it owns
screenshots, DOM, console, accessibility and the bounded correction cycles) and
record its verdict as an L3 artifact. A `ux` critic without a runnable UI may
only review source and artifacts and must say that runtime behavior was not
observed. Visual approval stays human.

## Judge protocol (conditional)

The judge receives the contract, the diff, the gates record and the critic JSON
files, plus the repository. It classifies each **material** finding by
reference and may add a finding of its own only with evidence.

```json
{
  "findings": [
    { "ref": "general#1", "classification": "CONFIRMED", "severity": "MAJOR", "evidence": "AC3 (every tenant-scoped route) not established: its only test is skipped (tests/export.test.ts:40) and no gate covers the export routes; I could not establish it either" },
    { "ref": "security#0", "classification": "REFUTED", "evidence": "AC2 established: src/auth.ts:88 is global middleware on every route; test tenant_scope ran in gate unit and covers all three routes" },
    { "ref": "general#0", "classification": "UNPROVEN", "evidence": "claimed defect, a race between pause and resume: no interleaving reproduces it and no trace shows the shared write; it needs a stress harness this repository does not have" },
    { "ref": null, "classification": "CONFIRMED", "severity": "BLOCKER", "contract": "INV2", "evidence": "…", "description": "…" }
  ],
  "summary": "what was checked and how"
}
```

- `CONFIRMED` keeps the finding material (optionally re-graded).
- `REFUTED` and `UNPROVEN` remove it from the material set; both stay in the
  report with the judge's evidence.
- A finding that an explicit contract clause is **not established** is
  `CONFIRMED` unless the judge itself establishes that clause with current
  evidence of sufficient scope; it is `REFUTED` only when the judge does, and
  cites that evidence. A judge that cannot establish the clause either
  confirms the finding — that is never `UNPROVEN`. `UNPROVEN` is for a
  claimed defect that cannot be demonstrated.
- The judge does not fail a candidate for subjective preference, cosmetic
  polish, speculative risk without evidence, optional refactors or future
  enhancements. It respects closed decisions.
