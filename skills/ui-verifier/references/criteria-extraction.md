# Criteria Extraction

Turns the sources of truth into a finite, checkable list **before** the first evaluation. If this step is sloppy, every later cycle argues about taste instead of delivery.

## Common sources of truth

| Source | Typical location | Yields |
| --- | --- | --- |
| Frozen briefing / client-approved copy & screens | project dossier, `docs/`, the conversation | `brief` criteria |
| Spec + acceptance criteria | `.specs/features/<feature>/spec.md` (`tlc-spec-driven`) | `brief` + `functional` |
| Design system / tokens | `DESIGN.md`, `PRODUCT.md` (impeccable), Tailwind `@theme`, token files, existing components | `system` |
| Visual reference | approved screenshot, mockup, competitor/reference the client named | `visual` (+ `system` when it defines tokens) |
| Explicit non-functional requirements | a11y level, target viewports, supported browsers | `functional` |

**The order of this table carries no precedence.** It is a checklist of places to look, not a ranking. When two sources demand incompatible things, the conflict goes to a human gate — see below.

Read what exists. **Do not invent a source and do not infer a requirement that nobody stated.** "The client would probably want…" is not a criterion.

## Source criteria vs. verifier guardrails

Every criterion has one of two origins, and they are never conflated:

- **source criteria** — traceable to a briefing, spec, design system, reference, or stated non-functional requirement. The `source` column names it. Never invent one.
- **verifier guardrails** — the verification's own technical baseline, applied even when nobody wrote them down: console free of errors, no gross horizontal overflow, automated accessibility violations, and the default viewports when none were specified. They are legitimate findings, and they are labeled `guardrail` in the `source` column — **never attributed to the briefing or to the client**.

A guardrail that carries an assumption (a default viewport) declares that assumption in the report. If the human says a guardrail does not apply here, drop it — a guardrail is a sane default, not a requirement smuggled in.

## Output shape

One flat list. Keep it short enough to read in one screen — a screen with 60 criteria means the scope is wrong, not that the extraction was thorough.

```
C-01 | brief      | deterministic | The "Export CSV" button exists in the report header       | briefing §3
C-02 | brief      | judgment      | The empty state explains what to do next, in the frozen copy | briefing §3.2
C-03 | system     | deterministic | Only palette tokens are used (no literal hex)             | DESIGN.md tokens
C-04 | system     | deterministic | Card radius = --radius-lg                                 | DESIGN.md
C-05 | functional | deterministic | No horizontal overflow at 360 / 768 / 1440                | NFR viewports
C-06 | functional | deterministic | Console is clean on load and on submit                    | guardrail
C-07 | functional | judgment      | Form errors are perceivable next to the offending field   | briefing §4
C-08 | visual     | judgment      | Hierarchy reads: title > metric > supporting              | reference shot
C-09 | visual     | human-only    | The surface feels premium                                 | client wording
C-10 | functional | deterministic | No horizontal overflow at the default viewports           | guardrail (assumed)
```

Columns: `id | dimension | nature | statement | source`. The `source` column reads `guardrail` for verifier guardrails.

## Dimensions

- `brief` — what was asked for. Missing element, ignored requirement, invented content, scope creep.
- `system` — explicit, structured conformance only (tokens, defined colors, type scale, spacing, radius, required/existing components, documented patterns).
- `visual` — craft, composition, hierarchy, slop. Evaluated by `impeccable`, not by a vocabulary of your own.
- `functional` — it works as an interface: navigation, states, forms, feedback, responsiveness, overflow, basic a11y.

## Nature

| Nature | Meaning | Handling |
| --- | --- | --- |
| `deterministic` | a tool settles it (DOM query, axe, Playwright, viewport screenshot, token grep) | must be settled by the tool; an evaluator must not opine on it |
| `judgment` | needs a reading, but is still anchored to a stated requirement | evaluated with evidence attached; a finding without evidence is a `hypothesis` |
| `human-only` | taste, brand, subjective feel | **never scored, never iterated on** — collected and routed to a human gate with the evidence |

Prefer `deterministic` whenever a mechanism exists. If a `judgment` criterion could become deterministic with a test that does not exist, note it once and consult `testing-strategist` — do not build the mechanism inside a cycle.

## Degraded mode

Mark every criterion that the current execution mode cannot settle as `NOT VERIFIABLE (degraded)` and carry that label all the way into the verdict. A degraded run never reaches `PASS`; that list is what the human needs in order to decide at the `STOP + HUMAN` gate.

## Conflicts detected at extraction time

If two sources demand incompatible things (the reference shows a pattern the design system forbids; the briefing asks for something that breaks an accessibility requirement), **do not pick a winner and do not average them**. Record both criteria, flag the pair, and raise the human gate before cycle 1 — the verdict for a conflict is `STOP + HUMAN`, never `FAIL / BLOCKED`. A loop run on contradictory criteria cannot converge.

## High-stakes only

Before cycle 1, `the-fool` may be invoked once (programmatic mode) to challenge the criteria list itself: what is missing, what is unfalsifiable, what is really taste wearing a requirement's clothes. Once — not per cycle.
