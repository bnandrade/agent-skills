# Consolidation and Verdict

Four evaluators produce four lists. The builder receives **one** short, ordered, actionable list.

## Finding contract

Minimum fields. Resist adding more.

```
id:                 F-07
dimension:          brief | system | visual | functional
severity:           P0 | P1 | P2 | P3
criterion:          C-02
evidence:           axe rule color-contrast, 2.8:1 on .card-meta @1440 (shot: dash-1440.png)
location:           resources/views/dashboard/card.blade.php:34
recommended_action: use --color-text-muted (4.7:1) instead of the literal #9aa0a6
```

Add `status: hypothesis` when the evidence does not support asserting it — a code-level inference in degraded mode, a suspicion the base capture could not confirm. A hypothesis is reported as a hypothesis all the way to the human; it never silently becomes a fact in the next cycle, and it never justifies a fix cycle on its own.

## Severity

| | Meaning |
| --- | --- |
| **P0** | breaks the delivery — required element missing, primary interaction broken, blocking accessibility failure |
| **P1** | materially degrades it — wrong state, drifted copy, systematic token violation, overflow at a target viewport |
| **P2** | worth fixing, does not block |
| **P3** | micro-polish / advisory |

That is the whole taxonomy. Do not introduce sub-levels, scores, or weights.

**Only P0/P1 justify a fix cycle.** P2 and P3, alone or together, never do — they are reported as advisories and the run closes.

**Visual/craft findings.** Purely visual or craft findings that violate no mandatory criterion are normally P2/P3. P1 only when an explicit, mandatory visual criterion is materially unmet. **Never P0 for aesthetics or craft alone** — P0 requires impact that actually breaks the delivery. A polish suggestion from `impeccable` must not, by itself, start a cycle.

## Deduplication

Same defect seen by several evaluators → one finding, keeping the strongest evidence (tool output beats reading) and the highest severity, with the other dimensions listed as corroboration. Contrast reported by both axe and `impeccable audit` is one finding, owned by axe.

Related fixes in the same component are grouped into one action item so the builder makes one coherent change instead of four scattered edits.

## Conflicts — detect, never decide

There is **no automatic precedence** between briefing, spec, design system, accessibility, functional behavior, and visual reference. Apply these principles instead:

1. A verifiable hard constraint is never silently dropped in favor of an aesthetic preference.
2. A visual reference does not automatically override an explicit requirement.
3. A briefing requirement does not silently authorize breaking functionality, accessibility, or any other mandatory constraint.
4. A real conflict between sources of truth goes to a **human gate** — verdict `STOP + HUMAN`, never `FAIL / BLOCKED`.

The consolidator's job is to state the conflict precisely — which two criteria, from which two sources, and what each would require — and to stop. Choosing for the human, or quietly satisfying one side, is the failure mode this rule exists to prevent.

## The builder package

Per cycle, the builder receives: the ordered finding list (P0 → P1 → P2), the evidence for each, and one instruction — **fix these and nothing else**. No opportunistic refactors, no unrequested polish, no redesign. A structural layout change is not a fix: it is a human gate.

Re-evaluation is incremental: re-check the previous findings, plus regression on the areas that were touched. Not the whole screen from scratch.

## Verdict

| Verdict | Condition |
| --- | --- |
| **PASS** | **Full verification only.** No mandatory P0/P1 remains and the tier's criteria were sufficiently evaluated. Remaining P2/P3 are attached as advisories — report it as **PASS with advisories**, which is this same verdict carrying information, not a fifth state. |
| **ITERATE** | a fixable P0/P1 remains, `max_fix_cycles` is not exhausted, and cycle-over-cycle the findings are actually shrinking. |
| **STOP + HUMAN** | the run was degraded · blocker persists without convergence · the builder substantially repeats the same findings · the fix needs a human decision · sources of truth conflict · budget reached. |
| **FAIL / BLOCKED** | verification is operationally impossible: no target, nothing observable *and* no usable artifacts, evidence unobtainable. Contradictory requirements are **not** this — they are `STOP + HUMAN`. |

Four verdicts. Do not add a fifth.

**A degraded run never reaches `PASS`.** When its verified subset carries no blockers, close with `STOP + HUMAN` and state plainly: the verified subset has no blockers · runtime/unverified dimensions remain · a human decision is required because complete verification was impossible.

## Diminishing returns

Recommend stopping when: findings repeat across cycles, the blocker count stops falling, only micro-polish remains, or cost keeps rising with no material change. Heavy repetition between consecutive cycles — roughly two thirds of the list reappearing — is a *heuristic* that the builder is not converging, and that is a human problem, not another cycle. Never a rigid formula, never the sole trigger.

Note the correction to a tempting shortcut: "no *new* P0/P1 appeared" is not a stop condition. An **old, unresolved** P1 is still a blocker.

## Report shape

1. **Execution mode** (full / degraded) and unverified dimensions.
2. **Verdict** and the cycle count used, out of budget.
3. **Findings**, ordered, in the contract above; hypotheses clearly separated.
4. **Human gates raised**, each as `decision needed · evidence · options · what is blocked`.
5. **Criteria accounting** — settled vs. not settled, with ids.

No numeric overall score. A score invites arguing with the number instead of the finding.
