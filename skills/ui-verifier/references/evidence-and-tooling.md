# Evidence and Tooling

Evidence is what separates this skill from an opinion. Every factual finding points at something a second person can re-observe.

## Execution modes

### Full verification

Available when the app can actually be observed running. Establish this at preflight by *doing* it, not by assuming it: locate how the app starts (`run`, project scripts, an already-running dev server) and reach a URL.

Available instruments, in rough order of preference:

| Instrument | Settles |
| --- | --- |
| Screenshots per target viewport | layout, overflow, presence of elements, visual dimension input |
| DOM inspection | element existence, text content, attributes, ARIA, applied tokens/classes |
| Console | runtime errors, warnings, failed requests |
| Playwright (or the project's E2E) | navigation, clicks, form submission, state transitions |
| axe (or equivalent) | contrast, labels, roles and other automatable a11y violations |
| Browser / Playwright keyboard traversal | keyboard reachability, focus behavior, and focus order where applicable |
| Computed styles / token files | design-system conformance |

Only this mode can emit `PASS`.

### Degraded / static

No runnable app, but usable artifacts exist: source code, previously captured screenshots, spec, briefing, `DESIGN.md`.

Rules, non-negotiable:

1. Declare "degraded mode" in the first output, before findings.
2. List the dimensions and criteria that could not be verified.
3. Never describe runtime behavior as observed — no "the modal opens correctly" from reading code. A code-level reading is a `hypothesis`, not a fact.
4. **Never emit `PASS`.** If the subset it could verify has no blockers, the run ends in `STOP + HUMAN`, stating: the verified subset has no blockers · runtime/unverified dimensions remain · a human decision is required because complete verification was impossible.

Degraded is an execution mode, not a verdict.

**Not degraded — `FAIL / BLOCKED`:** no briefing/spec at all, or neither a runnable app nor usable artifacts. There is nothing to verify against.

## Base capture (once per cycle)

Capture one shared set and hand slices of it to the evaluators:

- one screenshot per target viewport, per screen/state in scope (the states the criteria actually mention);
- the DOM of those states;
- the console log from load and from the primary interaction;
- the deterministic tool output for the criteria that call for it (axe, E2E run, token check).

Four evaluators never mean four full browsing sweeps. Capture once, distribute.

## Supplemental capture

An evaluator may request focused extra evidence **only when it answers a specific unresolved criterion** — an open modal, one breakpoint, hover/focus, a submitted form, an error state. The request names the criterion id. Anything broader is refused and folded into the next cycle's base capture.

## Target viewports

Take them from the sources of truth. When nothing is stated, fall back to the guardrail default — one narrow (~360), one mid (~768) and one wide (~1440) — and declare that you assumed it. An assumed viewport is a verifier guardrail, never a client requirement, and the assumption goes in the report.

## Evidence hygiene

- Point at the concrete artifact: file path and line, screenshot name plus viewport, DOM selector, the console line, the axe rule id.
- Tool output beats a reading. If axe reports the contrast ratio, quote the ratio.
- Absence of evidence is not evidence: "I could not check X" is a gap in the report, never a pass and never a failure.
- Discard supplemental captures once their criterion is settled; do not carry a growing pile of screenshots across cycles.
