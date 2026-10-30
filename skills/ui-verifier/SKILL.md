---
name: ui-verifier
description: Verifies a delivered UI against its briefing/spec — working on the rendered interface whenever the app can be run, using observable evidence (screenshots, DOM, console, Playwright, axe) and independent evaluators, then coordinating a bounded number of correction cycles. Answers "did this screen deliver what was specified, and does it work as an interface?" — not "is this design good?". Use before handing a screen/feature over, as a quality gate on a relevant interface, or to check an implementation against a frozen briefing/spec/DESIGN.md. Triggers on "verify this screen against the spec", "validate the UI against the briefing", "run the ui verifier", "quality gate for this interface", "check this feature visually before delivery", "did the implementation deliver what was asked". Do NOT use for open-ended design review, visual craft, hierarchy, or AI-slop critique (use impeccable), for building or refining UI (use frontend-expert / laravel-expert / react-native-expert), for spec/test/code verification (use tlc-spec-driven's Verifier), or as a routine check for any CSS change — this is a deliberate escalation mode, not the default path.
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# UI Verifier

**Impeccable judges the interface. `ui-verifier` judges the delivery.**

Verifies a rendered UI against briefing/spec using observable evidence, independent evaluations, and bounded correction cycles. It does not have its own taste: every factual claim it makes is anchored to a criterion extracted from a source of truth and to evidence someone else can re-observe.

## When to use

- A screen/feature is "done" and is about to be handed to a client or merged.
- There is a briefing, spec, frozen copy, or `DESIGN.md` to verify **against**.
- The interface matters enough to justify spending independent evaluation on it.

## When NOT to use

| Situation | Use instead |
| --- | --- |
| "What could be better here?" / craft, hierarchy, slop, polish | `impeccable` (`critique`, `audit`, `polish`) |
| Building or fixing the UI | `frontend-expert` · `laravel-expert` (Blade/Livewire) · `react-native-expert` |
| Verifying spec/tests/code | `tlc-spec-driven` (its Verifier) |
| Any CSS tweak, internal throwaway screen | nothing — just do the work |
| No briefing/spec/target at all | stop: without a target there is nothing to verify against |

## The loop (bounded Gauntlet Loop)

```
target (briefing / spec / DESIGN.md / reference)
   → builder output (already implemented)
   → evidence capture
   → independent evaluation (4 dimensions, separate contexts)
   → consolidated findings
   → PASS / ITERATE / STOP + HUMAN / FAIL-BLOCKED
   → bounded correction  ──┐
        ▲                  │
        └──────────────────┘  (capped by max_fix_cycles)
```

Phases: **Preflight → Criteria extraction → Evidence → Evaluation → Consolidation → Verdict → (bounded correction)**.

### 0. Preflight — declare the execution mode

Inventory what exists: briefing/spec · runnable app + URL · target viewports · `DESIGN.md`/tokens · visual reference · acceptance criteria. Then declare one of two modes, out loud, before anything else:

| Mode | Requires | Can emit |
| --- | --- | --- |
| **Full verification** | the app can actually be observed running (browser/screenshots/DOM/console/Playwright/axe) | any verdict, including `PASS` — the only mode that can |
| **Degraded / static** | no runnable app, but code + spec + screenshots + `DESIGN.md` are available | findings and `ITERATE` / `STOP + HUMAN` / `FAIL / BLOCKED` — **never `PASS`** |

In degraded mode you must state which dimensions could not be verified, and you must never describe runtime behavior as observed. **A degraded run can never end in `PASS`** — if the subset it could verify has no blockers, it ends in `STOP + HUMAN`, saying so explicitly. **Missing the target itself (no briefing/spec) is not degraded mode — it is `FAIL / BLOCKED`.**

Details: [evidence-and-tooling.md](references/evidence-and-tooling.md).

### 1. Criteria extraction

Turn briefing/spec/`DESIGN.md`/reference into verifiable criteria, tagged by dimension (`brief` · `system` · `visual` · `functional`) and by nature:

- `deterministic` — a tool can settle it (element exists, no overflow, contrast ratio, console clean)
- `judgment` — needs an evaluator's reading, always with evidence attached
- `human-only` — taste, brand, "feels premium". **Never scored, never iterated on** — routed straight to a human gate.

Two origins, never mixed up:

- **source criteria** — derived explicitly from briefing/spec/design system/reference. Never invent one that no source states.
- **verifier guardrails** — the verification's own technical baseline (console errors, gross overflow, automated accessibility, default viewports when none were specified). Always labeled as guardrails, **never attributed to the briefing or to the client**, and any assumption they carry (a default viewport) is declared.

See [criteria-extraction.md](references/criteria-extraction.md).

### 2. Evidence

One shared base capture per cycle, reused by all evaluators. An evaluator may request **supplemental, focused** evidence (a modal open, a specific breakpoint, hover/focus, a submitted form, an error state) when it answers a specific unresolved criterion — never a second full sweep. See [evidence-and-tooling.md](references/evidence-and-tooling.md).

### 3. Independent evaluation

Four dimensions, run in independent contexts (sub-agents when the harness supports them). Each receives target + **only its own criteria** + the evidence it needs — never the builder's own conclusion.

| # | Evaluator | Owned by | Question |
| --- | --- | --- | --- |
| A | Brief fidelity | **native** | Did it deliver exactly what was asked — nothing missing, nothing invented, nothing out of scope? |
| B | Design system | **native, thin** | Does it conform to the *explicit, structured* rules — tokens, defined colors, type scale, spacing, radius, required/existing components, documented patterns? |
| C | Visual quality | **delegated → `impeccable`** (`critique`, `audit`) | Is the craft at the expected level? |
| D | UX / functional | **native, deterministic-first** | Does it work as an interface — navigation, states, forms, feedback, responsiveness, overflow, basic a11y? |

**Determinism before judgment:** if axe settles contrast, no evaluator opines on contrast. If `impeccable` is unavailable, dimension C is declared *not verified* — never simulated. Evaluator B must not grow its own vocabulary for craft, beauty, composition, subjective hierarchy, or AI slop; that is C's territory.

Contracts and payloads: [evaluators.md](references/evaluators.md).

### 4. Consolidation

Deduplicate, rank by severity, and produce **one short actionable list** for the builder — not four reports. Findings without sufficient evidence are marked `status: hypothesis` and never presented as fact.

**Conflicts between sources of truth are detected, not decided.** There is no automatic precedence between briefing, spec, design system, accessibility, functional behavior, and visual reference. A visual reference does not override an explicit requirement; a briefing requirement does not silently authorize breaking functionality or accessibility. Real conflicts go to a human gate. See [consolidation.md](references/consolidation.md).

### 5. Verdict and bounded correction

Every correction cycle addresses the listed findings **and nothing else** — no free-roaming polish between cycles.

## Tiers and iteration budget

Chosen at invocation; default `standard`. The **initial evaluation never counts as a fix cycle**.

| Tier | `max_fix_cycles` | Evaluators | For |
| --- | --- | --- | --- |
| `quick` | **0** — evaluate once, report, stop | A + D (deterministic) | internal/admin/CRUD screens |
| `standard` (default) | **2** | A + B + C + D | a client-facing screen or a relevant flow |
| `high-stakes` | **4** | all + `the-fool` on the *criteria*, once, before cycle 1 | landing, onboarding, brand surface |

`standard` in full: `initial evaluation → findings → fix cycle 1 → re-evaluation → fix cycle 2 → final evaluation`. Reaching the cap is the exception, not the plan — stop conditions usually fire first.

## Verdicts and stop conditions

| Verdict | When |
| --- | --- |
| **PASS** | Full verification only. No mandatory P0/P1 remains and the criteria required by the tier were sufficiently evaluated. Remaining P2/P3 do not block it — report them as **PASS with advisories**, which is the same verdict with information attached, not another verdict. |
| **ITERATE** | A fixable P0/P1 remains, budget is left, **and** there is evidence of convergence between cycles. |
| **STOP + HUMAN** | The run was degraded (no `PASS` is available to it) · a blocker persists without convergence · the builder substantially repeats the same findings · the fix needs a human decision · **sources of truth conflict** · `max_fix_cycles` reached. |
| **FAIL / BLOCKED** | Verification is operationally impossible: no target, nothing observable *and* no usable artifacts, evidence that cannot be obtained at all. Not for conflicts — those are `STOP + HUMAN`. |

Four verdicts, no more. A degraded run whose verified subset has no blockers ends in `STOP + HUMAN`, stating: the verified subset has no blockers · runtime/unverified dimensions remain · a human decision is required because complete verification was impossible.

**Severity:** `P0` breaks the delivery (missing requirement, broken interaction, blocking a11y) · `P1` materially degrades it · `P2` worth fixing · `P3` micro-polish/advisory. That is the whole taxonomy.

**Only P0/P1 can justify a fix cycle.** P2/P3 on their own never do — they are advisories.

**Visual findings.** A purely visual/craft finding that violates no mandatory criterion is normally P2/P3. It may be P1 only when an explicit, mandatory visual criterion is materially unmet. **A finding is never P0 for aesthetics or craft alone** — P0 requires impact that actually breaks the delivery. A polish suggestion from `impeccable` must never, by itself, trigger a fix cycle.

**Diminishing returns.** Stop and recommend closing when findings repeat across cycles, blockers stop decreasing, only micro-polish remains, or cost keeps rising without material change. Heavy repetition between consecutive cycles (roughly two thirds of the list) is a *heuristic* signal that the builder is not converging — that is a human problem, not another cycle. Never a rigid formula.

## Human gates

The skill **stops** and asks. Always in this shape:

```
decision needed · evidence · options · what is blocked
```

1. Preflight missing an essential item (no target, or nothing observable at all).
2. Conflict between sources of truth (briefing × spec × design system × a11y × reference).
3. A structural layout change proposed by an evaluator — the builder does not redesign on its own.
4. `human-only` criteria (brand, "premium", "trustworthy").
5. Two good visual directions — never auto-resolved.
6. Budget exhausted with a live blocker.
7. Final acceptance on `high-stakes` — a technical PASS is not an approval.

## Routing

| Need | Skill |
| --- | --- |
| Visual quality, craft, critique/audit | `impeccable` (evaluator C) |
| Fix web UI | `frontend-expert` |
| Fix Blade/Livewire UI | `laravel-expert` |
| Fix mobile UI | `react-native-expert` |
| Spec/AC as a criteria source; code/test verification | `tlc-spec-driven` (`.specs/features/<f>/spec.md`) — not replaced |
| A functional criterion has no test mechanism to make it deterministic | `testing-strategist` — consulted on demand, not per cycle |
| Challenge the extracted criteria (high-stakes only, before cycle 1) | `the-fool` (programmatic mode) |

## Critical rules

- **NEVER emit `PASS` in degraded mode** — it closes in `STOP + HUMAN` — and never describe runtime behavior you did not observe.
- **NEVER let the builder be the only evaluator of its own change.**
- **NEVER present a finding without evidence as fact** — mark it `status: hypothesis`.
- **NEVER auto-resolve a conflict between sources of truth** — raise a human gate.
- **NEVER invent a criterion** that no source of truth states.
- **NEVER grow a design vocabulary of your own** — dimension C belongs to `impeccable`.
- **NEVER exceed `max_fix_cycles`**, and never allow polish outside the consolidated finding list.
- **ALWAYS declare the execution mode and the unverified dimensions up front.**
- **ALWAYS prefer deterministic evidence** over judgment when a tool can settle the criterion.
