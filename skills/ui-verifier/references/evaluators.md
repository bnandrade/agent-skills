# Evaluators

Four dimensions, four independent readings. Independence is the point: the agent that built the screen must never be the only voice judging it.

## Independence contract

When the harness supports sub-agents or independent contexts, each evaluator runs in one. Each receives:

- the **target** (the relevant slice of briefing/spec/`DESIGN.md`/reference);
- **only its own criteria** (the extracted list, filtered by dimension);
- the **evidence** it needs from the base capture.

Each does **not** receive: the builder's narrative, the builder's self-assessment, another evaluator's findings, or the previous cycle's verdict. On a re-evaluation it may receive the specific findings it is re-checking — that is a scoped question, not a conclusion.

Without sub-agents, run them as separate, sequential passes with fresh framing, and say so in the report — sequential passes in one context are weaker evidence of independence.

## A — Brief fidelity (native)

The only fully native evaluator, and the reason this skill exists: nobody else in the ecosystem checks the rendered screen against what was asked for.

Looks for:

- **missing** — a required element/section/state is not there;
- **ignored** — it is there but does not do what the requirement stated;
- **invented** — content, copy, data, or features nobody asked for (placeholder text and lorem count here);
- **out of scope** — work beyond the briefing, which is a finding even when it looks nice;
- **drifted copy** — text differs from the frozen copy.

Evidence: the DOM/screenshot showing presence or absence, plus the source clause. Never softens a missing requirement because the alternative looks better — that is a conflict for the human gate.

## B — Design system (native, thin)

**Explicit, structured conformance only.** It checks rules someone wrote down:

- tokens actually used vs. literal values (hex, px, ad-hoc radii);
- colors from the defined palette;
- typography tokens / type scale;
- spacing scale;
- radius, border, elevation tokens;
- required components used, existing components reused instead of re-implemented;
- documented patterns from `DESIGN.md` (page shell, form layout, table conventions);
- cross-screen consistency against sibling screens *already conforming*.

Hard boundary: it must **not** develop a vocabulary for craft, composition, beauty, subjective hierarchy, AI slop, or refinement. If a claim cannot be traced to a written rule or a token, it is not this evaluator's claim. When the project has no design system, this evaluator reports "no explicit system to verify against" and produces nothing else.

## C — Visual quality (delegated → `impeccable`)

Invoke `impeccable` on the surface in scope — `critique` for the scored design review, `audit` for the technical quality pass (a11y, perf, responsive) when the deterministic instruments have not already covered it. Consume its output as this dimension's findings, mapped into the finding contract with the severity translated into P1–P3.

**Reuse before rerun.** If a recent `impeccable critique`/`audit` result already exists for *exactly* the same surface and state under evaluation — and the code has not changed since — consume it as this evaluator's evidence instead of rerunning. Otherwise invoke `impeccable` normally. Never reuse a stale result, a result from another screen, or a result from before the last fix cycle just to save tokens: that would evaluate a UI that no longer exists.

Do not paraphrase, re-litigate, or extend its judgments. If `impeccable` is not installed, declare dimension C **not verified** — never simulate it.

**Severity ceiling for this dimension.** A purely visual/craft finding that violates no mandatory criterion is normally P2/P3. It reaches P1 only when an explicit, mandatory visual criterion is materially unmet. **It is never P0 on aesthetics or craft alone.** Since only P0/P1 justify a fix cycle, a polish suggestion cannot trigger one by itself — that is the point of the ceiling.

Note the overlap: `impeccable audit` and the deterministic a11y run can both surface contrast/labels. Deterministic wins; deduplicate at consolidation.

## D — UX / functional (native, deterministic-first)

Runs the tools first, judges only the residue.

Deterministic pass: navigation reachable, primary interactions actually work, form submit and validation, no horizontal overflow at each target viewport, console clean, automatable a11y violations via axe or equivalent (contrast, labels, roles), keyboard reachability and focus behavior/order driven through the browser or Playwright — axe does not settle those — and empty/error/loading states rendered when the criteria call for them.

Judgment residue (evidence attached): is the feedback after an action perceivable, is an error message actionable, is a destructive action recoverable, does a state transition leave the user oriented.

In degraded mode this evaluator is the most crippled — say so explicitly; most of its criteria become `NOT VERIFIABLE`.

## Output from each evaluator

A list of findings in the shared contract (see [consolidation.md](consolidation.md)), plus two mandatory lines:

- **criteria settled** — ids it could conclude on;
- **criteria not settled** — ids it could not, and why (no evidence, no mechanism, out of mode).

An evaluator that returns "everything looks great" with no criteria accounting has not done the work.

## Capability classes, not model names

Route by capability, never by a hardcoded model name:

| Role | Capability needed |
| --- | --- |
| Builder / correction | strong coding model with edit access |
| Brief fidelity | reliable reasoning, careful reading of the target |
| Design system | cheap structured checker is sufficient |
| Visual quality | strongest multimodal/design-capable model available (or delegated wholesale to `impeccable`) |
| UX / functional | tool and browser access matters more than raw reasoning |

Concrete model names may appear as passing examples in conversation; they must never be load-bearing in the workflow.
