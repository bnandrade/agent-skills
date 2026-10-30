# Risk triage

The tier decides verification depth, fan-out and budget. Pick it from concrete
signals, not from how important the task feels. Re-triage when the diff reveals
a surface the request did not mention (the builder touched auth while fixing a
label — that is now at least ELEVATED).

## Signals

| Signal | Minimum tier | Lens to add |
|---|---|---|
| Documentation, comments, copy, formatting, config values with no behavior change | LIGHT | — |
| Isolated function or component, existing tests cover the behavior, easy revert | LIGHT | — |
| Ordinary feature or bug fix with moderate blast radius | STANDARD | general |
| No automated check covers the changed behavior | STANDARD (builder adds a targeted test) | general |
| Unfamiliar codebase or unclear ownership of the touched state | ELEVATED | general |
| Logic that touches authentication, authorization, session, tenant isolation, secrets, crypto, permission checks, sandbox or filesystem boundaries (paths, realpath, symlinks) and keeps the intended boundary where it is — fixing, hardening or implementing enforcement already specified | ELEVATED | `security` |
| Deletion, overwrite or cleanup where **all** hold: bounded target set, local or non-prod, reliable rollback or restore, no material loss, no irreversible external effect (e.g. regenerable artifacts the process itself produced) | ELEVATED | `destructive` |
| Database schema, migrations, data backfills, serialization formats, caches with invalidation | ELEVATED | `data` |
| Concurrency, realtime, timers, cancellation, retries, queues, shared mutable state | ELEVATED | `concurrency` |
| Deployment, infrastructure, CI, build pipeline, environment configuration with broad blast radius | ELEVATED | `infra` |
| Public API contract or wire format consumed by others | ELEVATED | `api` |
| User-facing UI that matters (customer screens, onboarding, brand surface) | ELEVATED | `ux` → delegate to `ui-verifier` |
| A change that moves the intended security boundary: weakens or bypasses enforcement, expands a trust boundary, lets access reach outside a sandbox or filesystem root, materially changes who or what can access what or how auth/secrets are enforced | CRITICAL | `security` |
| Deletion, truncation, mass update of persisted data, irreversible external side effects (emails, webhooks, payments) — whenever any condition of the ELEVATED destructive row fails: material or irrecoverable loss possible, no reliable rollback or backup, material blast radius | CRITICAL | `destructive` (+ `security` or `data` as applicable) |
| Money movement, billing, entitlements | CRITICAL | `security` + `data` |
| Production data or production deploy in the same change | CRITICAL | `infra` + `destructive` |

Rules:

- The tier is the **highest** row that applies. Two ELEVATED rows do not make
  a CRITICAL.
- A lens is not a tier. A lens names the surface a critic inspects; the tier
  comes from impact and reversibility. `destructive` and `security` appear at
  ELEVATED or CRITICAL depending on which row applies. An ELEVATED destructive
  row holds only when the contract and the diff show all its conditions; if
  any is unknown, the CRITICAL row applies.
- Add a specialized lens only for a row that actually applies. The general lens
  is always present from STANDARD up.
- Two or three lenses is the practical ceiling for one round; more than that
  means the change should be split.
- A user-forced tier (`tier:...` in the arguments) is a closed decision. If the
  evidence later shows a higher-tier surface, report it and ask — do not
  silently escalate.
- Downgrade is allowed only before any delegation and only when the rubric shows
  no signal for the higher tier.

## Tier consequences

| Tier | Build | Verification | Critics | Judge | Budget | Human gate |
|---|---|---|---|---|---|---|
| LIGHT | orchestrator or builder | gates | none | no | 1 | none beyond git discipline |
| STANDARD | builder | gates | general | on dispute | 2 | as contract lists |
| ELEVATED | builder | gates (+ L3 when applicable) | general + 1 specialized | on dispute/conflict | 2 | as contract lists |
| CRITICAL | builder | gates (+ L3) | general + specialized (2+) | always | 2 | mandatory before any irreversible step |

## Examples

- "Fix the typo in the settings label" → LIGHT. Gates: lint + build.
- "Debounce the search input; keep results identical" → STANDARD. Gates:
  typecheck, unit for the search module, build. Critic: general.
- "Add pause/resume to the session timer" → STANDARD, or ELEVATED with
  `concurrency` if the timer shares state with other features.
- "Filter users by tenant in the export endpoint" → ELEVATED with `security`
  (tenant isolation) — even though the diff is small.
- "Resolve symlinks with realpath before the existing root-containment check"
  → ELEVATED with `security` (enforces the boundary already specified). "Let
  the tool read files outside its root behind a flag" → CRITICAL with
  `security` (the boundary moves).
- "Delete the files a command generated, scoped to its own output directory"
  → ELEVATED with `destructive` (bounded, local, regenerable). The same
  delete over user data, or with a target the input can widen → CRITICAL.
- "Add a migration that drops the legacy column after backfilling" → CRITICAL
  with `data` + `destructive`; mandatory judge; human gate before running the
  migration anywhere but locally.
- "Redesign the checkout screen" → ELEVATED with `ux` (ui-verifier) and
  `security` if payment fields are touched; visual approval stays human.
