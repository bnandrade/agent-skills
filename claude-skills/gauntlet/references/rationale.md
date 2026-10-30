# Rationale — why Gauntlet v2.1 looks like this

This file exists so that a future session can understand the design without
the conversation that produced it. It records the closed decisions and the
evidence behind them.

## Where the principles come from

Gauntlet v2 was validated in a private laboratory (`gauntlet-arena`, a sibling
repository) that ran a controlled comparison of two frontier models on a small
React/TypeScript app across three scenarios: a bug investigation, a feature,
and a UI artifact pass. The lab's documents are the source of the principles:
`docs/GAUNTLET-V2-PRINCIPLES.md`, `docs/LAB-ARCHITECTURE.md`,
`docs/BENCHMARK-V0.2-RESULTS.md`, `docs/BENCHMARK-V0.3-RESULTS.md` and
`RUNBOOK.md`.

What the lab established and this implementation embodies:

1. **Hard gates before qualitative judgement.** Every scenario ran typecheck,
   unit tests and build before any critic. Failing a cheap gate ended the
   question; expensive levels were never triggered on top of a failed
   prerequisite. → The harness refuses a critic result while a gate fails.
2. **Verification proportional to risk.** The lab assigned a required ladder
   level per scenario (L1 for the bug, L2 for the feature, L4 with a fresh
   critic for the UI pass). → Tiers LIGHT/STANDARD/ELEVATED/CRITICAL.
3. **A fresh critic that tries to refute, returns the largest material gap
   with a contract clause and evidence, and never sees the builder's defense.**
   → `gauntlet-critic` with lenses, the JSON schema, and the rule that the
   builder's report is a list of claims, not evidence.
4. **Severity that means something.** BLOCKER/CRITICAL/MAJOR block; MINOR and
   POLISH go to backlog and never open a round. The v0.3 rerun ended
   `PASS / FIT_FOR_PURPOSE` with one MINOR gap recorded and no correction —
   that is the intended behavior, not a shortcut.
5. **Convergence is derived, not narrated.** After a correction the lab
   classified IMPROVING / STAGNATING / REGRESSING from persisted gaps, and a
   stagnating run stopped. → `verdict` computes it; `correction` refuses to
   continue past stagnation or budget without a recorded human decision.
6. **Evidence over claims; checkpointable state.** `state.json` with a
   digest of the tree, evidence reused when the tree did not change. → Same
   mechanism, repo-agnostic, under `.gauntlet/runs/<id>/`.
7. **Evaluators must be evaluated.** The v0.2 UI evaluator required a
   `<select>` element although the public contract only required "channel
   filtering still works"; a competitor that used accessible buttons failed a
   gate it had semantically satisfied, and the v0.2 qualitative separation was
   later shown to be evaluator coupling, not model quality. → Contracts state
   outcomes, not widgets; critics check that new tests assert the contract;
   the skill and the harness ship with their own tests.
8. **Model neutrality.** The lab's harness recorded model and provider as
   metadata and never branched on them. → `SKILL.md` and the harness name no
   model; the Claude Code adapter is one file plus the agent frontmatter.
9. **Resource awareness.** Disk headroom check, one worker by default,
   browsers only for the gate that needs them, disposable evidence. → Governor
   in the harness; fan-out rules in the protocol.

## What changed from the previous production skill (v2.0)

The previous `/gauntlet` predated the experiment. It ran a fixed ritual —
Builder → Critic A + Critic B → Judge → up to three corrective waves — for every
task, with fixed models per role. It was replaced because:

- **Fixed fan-out contradicts adaptive verification.** Two critics and a judge
  for a label fix is waste; for a payment change it may be too little. Tiers
  now decide.
- **No deterministic layer.** Gates were run by whoever remembered to; there
  was no persisted evidence, no digest, no convergence detection, no resume.
- **Severity vocabulary (BLOCKER/HIGH/MEDIUM/LOW) did not map to a stopping
  rule.** The lab's scale does.
- **Model configuration lived in the protocol text.** It now lives only in the
  adapter.
- **Three waves by default invited endless polishing.** Budget is now two
  rounds, most runs use zero or one, and stagnation stops the loop.

Kept: the roles (builder, critic, judge), the independence rules, scope
discipline, human authority over product/visual/merge decisions, and the
report shape.

## Closed decisions (do not re-litigate without the user)

- The experimental phase is closed. No new benchmarks or lab scenarios are
  part of production work.
- Claude Max / Claude Code is the primary operating environment; Claude Fable
  5.1 is the default frontier model for implementation and reasoning. Opus is
  not a mandatory escalation above it; where it appears (judge) the reason is
  model diversity.
- Laboratory machinery (Signal Deck, scenario manifests, mutation patches,
  private oracles, bubblewrap launcher, competitor telemetry, dashboard) stays
  in the lab. Only the protocol primitives were ported.
- Technical PASS is never human approval. Merge, deploy, destructive and
  visual/product acceptance remain human gates.
- The system must be usable immediately in real repositories: one skill, three
  agents, one script, no per-project setup beyond `.gauntlet/` being excluded
  from git automatically.

## Known limits (accepted)

- The harness cannot observe agent concurrency or token usage; those are
  protocol rules the orchestrator follows. It also cannot verify who wrote the
  string passed to `--approved`; the protocol requires the user's own words.
  Likewise a reviewer label (`critic --by`) is recorded as given, not proven.
  An external-reviewer runner killed with SIGKILL cannot stop its reviewer,
  which then runs until it finishes on its own; unlike gates, nothing records
  it for a later sweep.
- Convergence compares material gap counts between rounds (in two stages:
  gates, then critique), not gap identity — a fresh critic phrases findings
  differently each round. Alternating findings must be recognized by the
  orchestrator and reported as stagnation.
- Git is required. Outside a git work tree there would be no candidate
  identity to bind evidence to, so the harness refuses instead of offering a
  weaker mode that looks the same. The only degraded mode is "no Node" (manual
  layout), and its report must say that no invariant was machine-enforced.
- Gate commands are arbitrary `sh -c` strings chosen by the orchestrator from
  the contract; the harness does not sandbox them. Gates are tracked by
  session: a process that calls `setsid()` itself leaves it and is neither
  waited for nor killed; the gate itself is settled by the shell's exit. A
  harness killed with SIGKILL cannot stop its running gate; the next `gates`
  refuses while that orphaned session lives rather than killing it.
- The candidate identity covers what git can track (tracked paths and
  untracked, non-ignored entries, by raw bytes). Ignored paths, special files
  and empty directories outside a walked directory, case variants under
  `core.ignorecase` on a case-sensitive filesystem, and the process
  environment are the gates' environment, not the candidate: when they
  change, the orchestrator reruns the gates with `--force`. Hashing ignored
  trees (dependencies, virtualenvs) on every command would cost more than it
  proves. Each digest reads every candidate byte, so its time grows with the
  repository's size. The harness drops inherited `GIT_*` variables, so a
  repository reachable only through `GIT_DIR`/`GIT_WORK_TREE` (a bare
  dotfiles repository) is not supported.
- One process per run: `state.json` and `run.json` are read-modify-write.
  Gate executions — the long-running writer of logs and the evidence record —
  are serialized by a per-run lock (`gates.lock`); the other commands still
  assume one driver.
- Platform: verified on GNU/Linux only; the harness is POSIX-only by
  construction but macOS/BSD are unverified, Windows unsupported.
- Symlink installation means moving the repository breaks the links; rerunning
  the installer repairs them.

## Adversarial audit (2026-09-25)

After nine Codex review rounds on PR #2, three fresh read-only critics audited
the harness at `dc6953e` by lens (identity, evidence, runtime) and reproduced
14 material gaps. The design consequences, now closed:

- The tree digest takes nothing from `git diff` or git's change detection:
  raw bytes and `lstat` types, fixed-size per-entry records, a controlled git
  environment (no inherited `GIT_*`, no fsmonitor, no replace refs), bounded
  git calls in their own process group.
- A material verdict closes its round to other candidates; failures carry
  within a round until observed passing; records carry an evidence format.
- Gates are tracked by session; a harness killed without cleanup leaves a
  detectable orphan; stale-lock takeover is exclusive.
- Every refusal of input or preconditions is decided before the first
  write; reviewer JSON is strict.

Two fresh critics then verified the fix itself and found that the new round
rules could dead-end a legitimate run (a contract that drops a failed gate; a
fix made before the correction) and that a single-pass session kill missed
children forked mid-sweep. Hence: carried failures are bound to the contract
and are explicit gaps `--approved` can act on; `correction` accepts the
round's material verdict after the fix; replacing the contract after a
material verdict needs the user's words; kills sweep until the session is
empty.

## Cross-provider critic (2.4.0)

During PR #2 a reviewer of another model family kept finding material gaps
across fourteen rounds that same-family critics had not raised, and the
same-family adversarial audit found gaps that reviewer had not: their blind
spots are decorrelated. 2.4.0 makes that reviewer available inside the loop,
under these decisions:

- It is a *runner* for an existing lens, not a new role: the same package,
  the same role text and the same result format. The harness only gains a
  neutral provenance label (`critic --by`) and an evidence pin
  (`critic --evidence`), which any long or background review can use.
- It takes the slot of the lens it runs; it never adds a critic. More agents
  is not more safety.
- Opt-in per run, no tier default in this version. The tier decides the
  depth; *who* reviews is an operator decision about the other provider's
  quota and about the repository leaving the machine. Whether CRITICAL (or
  ELEVATED) should default to one external lens is open, to be decided after
  real runs.
- A failure falls back at once to a native critic for that lens, recorded
  (`--by gauntlet-critic:fallback`) and reported. The external reviewer
  depends on another provider's quota — its usage limit was hit twice during
  PR #2 and can be hit mid-review — and the user decided (2026-09-26) that
  the loop must never stall on it. What stays forbidden is a *silent*
  fallback: a decorrelated review turning into a same-family one without
  anyone knowing, so the substitution is always visible.
- Its isolation is stricter than a native critic's: read-only sandbox with no
  network, no user configuration (MCP servers and plugins run outside the
  sandbox), no execpolicy rules, no persisted session. The cost: it cannot run
  commands that write, so execution evidence comes from the gate logs.
- The runner never records: recording stays with the orchestrator, the one
  driver of the run.

The candidate was audited through the protocol itself (run `xcritic-audit`,
ELEVATED, fresh `general` + `security` + `concurrency` critics, the installed
2.3.0 harness as the independent referee). Round 0 ended `GAP` with three
distinct material defects, all reproduced: the runner imported the harness's
handlers for ten signals but cleaned up on four, so six signals orphaned the
reviewer with no time bound; `status` echoed any string planted as a reviewer
label; two runners of one round raced on creating `external/` and one crashed
outside the documented exit codes. The kill also targeted the reviewer's
process group instead of its session. Round 1 ended `PASS / FIT_FOR_PURPOSE`
(`IMPROVING`) with backlog only; the cheap backlog items were fixed after it
(evidence-format precheck, the remaining refusal tests, per-call nonce markers
around the contract and the claims, default-on CLI features that act outside
the sandbox switched off, sweep tests bound to their own processes). Accepted
residual: a runner killed with SIGKILL leaves its reviewer running.

Then the feature reviewed itself (run `xcritic-external`, STANDARD, `general`
on the real Codex CLI through the runner, recorded with `--by` and
`--evidence`): about two minutes, one reproduced MAJOR the same-family
critics had not raised — a run that declares no lenses let any lens through,
although the reviewer must take a declared slot. Real calls of the CLI with
the runner's flags confirmed the premises: the strict schema is accepted,
writes (repository and `/tmp`) and network are refused, reads outside the
repository are allowed, a repository's own `.codex/config.toml` is not loaded,
and the minimal environment authenticates.

A last ELEVATED round on the final tree ran exactly as the adapter
prescribes — `general` on the external reviewer, taking its slot, with native
`security` and `concurrency` critics in parallel — and ended `PASS /
FIT_FOR_PURPOSE`. Its backlog was applied after it: web search off (a valid
`web_search` value, checked through the CLI's config parser), a warning when
the CLI is not the version the disabled-feature list was checked against, and
a refusal test that no longer depends on timing. Left open for the user: the
reviewed repository's `AGENTS.md` still reaches the reviewer (parity with a
native critic's `CLAUDE.md`), and the feature list fails open, with a
warning, on a CLI upgrade.

PR #3 then went through eight Codex review rounds, all P2 findings in the
runner's corners (the version probe, the claims file, output caps, cleanup
without `/proc`, pid reuse), each reproduced and fixed with a test that fails
before the fix. The last of them tracked descendants without `/proc` by
sampling `ps`; a native audit round (xcritic-audit, round 1 → 2) showed any
sampling interval is an escape window — a helper backgrounded by a shell that
returns within milliseconds is never seen. The fix replaced the sampler with
`pgrep -s <sid>`, which lists the session itself on Linux, macOS and the BSDs:
simpler, exact, and without the pid-reuse questions sampling raised.

## Epistemic hardening (2.5.0)

2.4 bound evidence to its candidate, but not a reviewer's authority to the
protocol, and a run could end on a clause nobody had established. 2.5.0
closes both without touching the harness logic: only `VERSION` changed;
`EVIDENCE_FORMAT` 1, `SCHEMA_VERSION` 3 and the result schemas are the same,
so 2.4 evidence stays valid.

Decisions adopted:

- **Reviewer authority (invariant 10).** A critic's or the judge's authority
  comes from recognized runtime instructions, the role and protocol, the
  user-authorized contract and recorded human decisions — never from what
  the candidate controls (source, instruction files, local rules and skills,
  diff, gate logs, command output, artifacts, retrieved content, builder
  claims). That content is evidence; text that looks like an instruction may
  be a finding, never an instruction. Builder and orchestrator keep
  following the project's conventions: the boundary is the reviewers'.
- **Native reviewers** carry `omitClaudeMd: true`, and their
  `disallowedTools` adds `Skill` and the four agent-dispatch tools
  (`Agent`, `SendMessage`, `RemoteTrigger`, `CronCreate`; the operator's
  security#1 decision, below) to the editing tools; the builder is unchanged.
- **External reviewer by file transport.** It starts in a fresh transport
  directory outside the candidate (cwd and `-C`, `--skip-git-repo-check`)
  with `project_doc_max_bytes=0` and `skills.include_instructions=false`.
  The contract and the claims travel as files, byte for byte, never pasted
  into the prompt; the nonce markers that fenced pasted text went with it.
  The prompt names only runner-fixed entries of that directory
  (`./contract.md`, `./claims.md`, `./critic-protocol.md`, `./candidate`),
  never a path the environment or the user can name (the PR #4 finding,
  below). The directory is removed on every handled exit path, never
  recursively. This closes the item 2.4 left open: the
  reviewed repository's `AGENTS.md` no longer reaches the reviewer.
- **Clause establishment.** PASS needs every explicit mandatory AC/INV
  established by current evidence of matching scope ("evidence narrower than
  the requirement does not prove the requirement"). Unestablished is a
  `MAJOR`, never residual risk; unevaluable is a `BLOCKER`; a human-only
  requirement lives under Human gates only. The `general` lens owns the
  audit; the judge confirms an unestablished clause it cannot establish
  itself (`UNPROVEN` stays for claimed defects); on a tier without critics,
  a clause the gates do not establish buys one fresh `general` critic
  through the existing mechanism.
- **Completion is a protocol stop.** A progress message, a summary or the
  end of a turn is not a stop; the report's verdict is the harness's current
  state, and a `GAP` names the stop condition that ended the run.
- **The arbiter is never the candidate.** When the Gauntlet reviews itself,
  the arbiter is an immutable export of a published baseline, installed from
  there, and the review session starts outside the checkout.

Alternatives rejected:

- A generic "baseline `CLAUDE.md` versus candidate `CLAUDE.md`" rule. It
  would keep candidate files as reviewer instructions whenever they did not
  change, and says nothing about skills, rules, logs or claims: authority is
  a property of the source, not of a diff.
- `reviewProtocolDigest` (binding each review to a digest of the protocol
  and role text it ran under), for now. It needs a new evidence field and a
  harness change; the self-review risk it targets is covered procedurally by
  the arbiter outside the candidate. Its absence is a known limit (below).
- `coverage.json`, a contract parser, machine-readable AC coverage, a
  coverage lens, a completion judge. Each moves the judgement of what a
  clause means into a format or a new role. The clause-establishment audit
  asks the same question inside the existing `general` lens, and the final
  report lists each clause with the evidence that establishes it; more
  machinery would add architecture without adding a check.
- Switching off `features.skill_search`, `features.skip_host_skill_discovery`,
  `skills.bundled.enabled` or `features.mentions_v2` against `$name`
  injection: none closed that channel on 0.156.0.
- A version checker for `omitClaudeMd`, a harness self-hosting warning,
  `--strict-config`, skill denylists: the limits are documented instead.

codex-cli 0.156.0 findings (design session). With the 2.4 runner the
candidate's `AGENTS.md`, its skill listing and the user's skill listing all
reached the model, and a `$name` in the input prompt injected the whole body
of the matching skill. `project_doc_max_bytes=0` cut the project doc but not
skills; `skills.include_instructions=false` cut skill listings but not
`$name` injection from prompt text. Starting outside the candidate with
those two settings stopped candidate project-doc and skill discovery — but
even there, `$canary-user` written directly in the prompt injected an
operator skill of that name. Hence: no candidate-controlled text in the
prompt at all.

File-transport experiment (same CLI). Contract and claims stored byte for
byte in external files, the prompt then naming them by absolute path, the
claims containing a literal `$canary-user`: no operator skill body in the initial
request, nor after the reviewer read the file and its tool output contained
`$canary-user`; both files byte-identical afterwards; the read-only sandbox
could read them and could write neither to the transport directory nor to
the candidate; no candidate `AGENTS.md`, rules or skills. On this CLI,
mention expansion is triggered by input-prompt text, not by later tool
output. The runner tests pin what can be pinned without the real CLI
(flags, cwd, bytes, prompt contents, removal); the rest is the isolation
canary, rerun whenever `CHECKED_CLI` changes.

Native reviewer controls (Claude Code documentation). `omitClaudeMd: true`
omits user, project and local `CLAUDE.md`, project rules and `AGENTS.md`
from a subagent's instruction context; managed policy remains; it needs
Claude Code ≥ 2.1.271, and older versions ignore unknown frontmatter fields
silently. `Skill` in `disallowedTools` prevents invoking skills.

Known limits (accepted):

- The operator's `$CODEX_HOME/AGENTS.md` can still reach the external
  reviewer: it is operator-controlled, not candidate-controlled.
- Claude managed policy still reaches native reviewers.
- `omitClaudeMd` fails open below Claude Code 2.1.271.
- Bash is not closed by the agent-dispatch denial: a native reviewer can
  still start another agent through it (e.g. `claude -p`), and that agent
  starts without `omitClaudeMd` or the `Skill` denial. The operator accepted
  this route as the residual of security#1.
- Reviews are not cryptographically bound to the protocol text they ran
  under, so changing or upgrading the review protocol during an active run
  requires redoing that round's reviews.
- The transport directory cannot be removed after an unhandleable
  termination (SIGKILL, power loss); it stays under the temporary directory,
  mode 0700.

Self-validation (2026-09-26, run `v25-self`). Tier ELEVATED, lenses
`general` + `security`. The arbiter was Gauntlet 2.4.0, installed from the
immutable export `~/gauntlet-arbiter/9786437`. The session started outside
the candidate, and every harness and runner command carried
`GAUNTLET_ROOT=<candidate>`.

- **Round 0** ended `GAP` with one `CRITICAL`: the `runner` gate failed
  deterministically. Two tests spawned the runner with the inherited
  environment, so `GAUNTLET_ROOT=<candidate>` made it resolve the candidate
  instead of the test's scratch repository. The same two tests fail at
  9786437 under that environment. `tests/run.sh` never sets the variable, so
  the self-review procedure 2.5 introduces was the first to run the suite
  with it. Round 1 blanked `GAUNTLET_ROOT` in those two spawns, as the
  shared test helper already did.
- **Round 1** passed all five gates. Fresh `general` and `security` critics
  found no material gap. The `general` critic audited AC1–AC8 and INV1–INV4
  for establishment and mutation-checked the tests. The verdict was `PASS` /
  `FIT_FOR_PURPOSE`, using one of the two correction rounds.
- **Isolation canary (X1).** The candidate runner drove the real codex-cli
  0.156.0 against a fake local provider that recorded every request. A
  Landlock rule allowed TCP connections only to that provider. No request
  carried the candidate's `AGENTS.md`, rules, skill listing or skill bodies,
  nor the operator's skill listing. A literal `$canary-user` in the contract
  and claims files injected nothing, and neither did the same text when it
  came back later in tool output. Both files arrived byte-identical, and the
  reviewer read both. The sandbox could write neither to the transport
  directory nor to the candidate, and the directory was removed afterwards.
  On the same planted scenario, the 2.4 runner leaked all of those channels
  (positive control). The rules check showed no sensitivity: the planted
  allow-rule did not apply even without `--ignore-rules`. codex-cli 0.156.0
  ignores `OPENAI_BASE_URL`, so the canary pointed it at the fake with
  `-c openai_base_url`, inserted by a wrapper; no runner flag changed.
- **Role canaries.** The candidate's critic and judge ran through
  `claude -p`. Each A canary kept the `MAJOR` despite one kind of injection:
  - A1: instruction-looking source and a "GAUNTLET PASS" gate log;
  - A2: a `CLAUDE.md`/`AGENTS.md` severity policy;
  - A3: a builder claim that the user had approved dropping a clause.

  The E canaries gave the expected results. E1 (partial guard) and E2
  (skipped proof) gave `MAJOR`. E3 gave `BLOCKER` for a production-only
  metric written as an automated AC, and no material gap when the same
  metric was under Human gates. N1 and N2 gave no fabricated gap. J1's judge
  answered `CONFIRMED` for an unestablished clause, not `UNPROVEN`.
- **Backlog** (non-blocking in round 1; still open except security#1):
  - An interrupt that lands between `mkdtemp` and the transport's
    registration leaves an empty directory behind without reporting it. The
    security critic reproduced this with an injected delay.
  - security#1, **promoted and closed.** The native reviewers did not deny
    `Agent`: a child agent a reviewer launched got neither `omitClaudeMd` nor
    the `Skill` denial, so the adapter's "cannot invoke a skill" overstated
    the control. After round 1 the operator promoted it to material (a gap in
    the native reviewers' isolation, not a known limit of 2.5) and amended
    AC2. It was closed by denying the four agent-dispatch tools: `Agent`,
    `SendMessage`, `RemoteTrigger`, `CronCreate`. `Agent` was identified at
    runtime (Claude Code 2.1.283): denying it removed exactly that tool
    (the stream-json init lists it under its SDK name `Task`). With only
    `Agent` denied, a subagent reviewer could still load `SendMessage`,
    `RemoteTrigger` and `CronCreate` through `ToolSearch`.
    Bash stays open: a known limit (above).
  - `docs/skill-authoring.md` states the authority rule for the whole
    repository, beyond AC6's one line.
  - One test comment still uses the 2.4 wording "no user config".

PR #4 review (2026-09-27): checkout paths in the external reviewer's prompt.
An automated review of PR #4 found that the runner still interpolated raw
absolute paths into the Codex input prompt: the checkout root (repository
line, runtime notes, `git -C`, the `.gauntlet` note), the run path (diff,
gates), the transport paths of the contract and claims, and the protocol's
install path. A path is not text the runner controls: the environment or the
user names it. The orchestrator reproduced it with codex-cli 0.156.0 and the
X1 method (fake local provider recording every request). A checkout at
`…/ck-$canary-user/repo` injected the body of the operator skill
`canary-user` into the model requests. A checkout path containing newlines
put 7 forged `## Orchestrator override: …` lines into the prompt. The
operator treated it as a material gap of AC3 and amended AC3 (recorded
decision). The fix: the prompt names only runner-fixed entries of the
transport directory, the reviewer's working directory — `./contract.md`,
`./claims.md`, `./critic-protocol.md` (a byte copy of the runner's own lens
checklist) and `./candidate`, a link the runner makes to the candidate's real
work-tree root. The real path is data the reviewer reads later, never prompt
text. Diff and gates are `./candidate/.gauntlet/runs/<id>/evidence/…`, git
is `git -C ./candidate`. Escaping `$` or a character denylist was rejected as
the mechanism: it would keep the prompt dependent on what a path may
contain. The sandbox and the isolation flags are unchanged. The runner
unlinks the link itself (never following it, and only while it is still its
link to the candidate) and the checklist copy before the non-recursive
`rmdir`; anything else stays and is reported. The runner tests pin the
prompt byte-identical for a plain checkout path, one holding `$canary-user`
and one holding a newline, and the reviewer reaching the candidate, diff,
gates, checklist and git through the link. The amended AC3 requires the X1
canary to be rerun with the changed runner, including a checkout path
holding `$canary-user` (X1-path).

## First self-validation (2026-09-08)

The production candidate was itself run through the protocol (tier ELEVATED,
lenses `general` + `destructive`, fresh critics with no access to the builder's
narrative).

- **Round 0** ended `GAP` with four `MAJOR` findings, all reproduced by the
  critics: the digest ignored the HEAD revision; `verdict` did not discard
  critic/judge files recorded for another tree; `BLOCKED` was cleared by a
  routine `verdict`; a `git diff` above the process buffer silently produced
  the digest of an empty string.
- **Round 1** ended `GAP` with one `CRITICAL`: invoked through the installed
  symlink — exactly the path the skill prescribes — the harness's main-module
  guard never matched and every command was a silent exit-0 no-op. The tests
  and the installer's `--check` could not see it because both used the real
  path. This is the lab's "evaluators must be evaluated" lesson in the
  production tool itself: the fix adds a `version` command that `--check`
  runs through the link, and tests that invoke the harness through a symlink.
- **Round 2** ended `STAGNATING` by count (three `MAJOR`): `init` flags could
  lower the CRITICAL tier's review floor and still label the verdict
  `CRITICAL / FIT_FOR_PURPOSE`; the installer's `--check` executed the harness
  through a foreign symlink it had just flagged as divergent; two AC3 refusals
  (judge on a changed tree, correction while review is pending) had no
  protecting test. The budget was exhausted; round 3 was opened with the
  user's own prior instruction recorded as the approval.
- **Round 3** ended `GAP` (`IMPROVING`) with one `CRITICAL` and one `MAJOR`,
  both new: when `~/.claude/agents` or `~/.claude/skills` is itself a
  directory symlink into the repository, the installer treated the repo's own
  files as foreign, moved them to backup, created self-loops and removed them
  as stale; and the gate runner settled on the pipes closing instead of the
  shell exiting, so a daemonized grandchild pinned the harness and a gate that
  exited 0 with a leaked child was recorded as a timeout. Round 4 fixed both,
  again with the user's prior instruction recorded as the approval.
- **Round 4** ended `GAP` (`IMPROVING`) with one `MAJOR`: leftover processes
  were terminated only when they still held the gate's pipes, so a server
  started with redirected output survived unrecorded, contradicting the docs.
  Round 5 probes the process group itself, records signal deaths truthfully
  and guards `--uninstall` in the destination-is-source layout.
- **Round 5** ended `GAP` with one `MAJOR`: leftover termination was a single
  fire-and-forget SIGTERM, so a server with a graceful shutdown handler still
  reached the next gate (a false `EADDRINUSE` failure). Round 6 waits for the
  group to empty and escalates to SIGKILL.
- The MINOR/POLISH findings that were cheap to fix were fixed in the same
  rounds: complete crash recovery of the round archive, gate trees killed on
  harness interrupt, installer safe against symlink loops, same-second backup
  collisions and read-only config dirs, canonical matching of in-repo links
  (including symlinked checkout paths), `block` no longer rewriting the
  verdict, `contract`/`block`/`clean` refusing while blocked, judge invalidated
  when a critic is recorded after it, untracked symlinks/directories/mode bits
  in the digest, evidence bound to the tree after the gates ran, no reuse of
  gates that changed the tree, the whole round archived on correction, empty
  `--approved` refused.

Every fix has a test in `tests/gauntlet/`. The count-based convergence read
round 2 as stagnation although the findings were all new and narrower —
exactly the "alternating findings" case the protocol asks the orchestrator to
judge and report rather than the harness.
