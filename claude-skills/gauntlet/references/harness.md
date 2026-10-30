# Harness reference — `scripts/gauntlet.mjs`

A single-file, zero-dependency Node script (Node ≥ 20) that persists the state
and the evidence of one run and enforces the protocol's invariants. It is
model- and provider-neutral; the orchestrator is its only caller. It is
normally invoked through the installed symlink; `node "$H" version` proves the
entrypoint works (the installer's `--check` runs exactly that).

```bash
H="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/gauntlet}/scripts/gauntlet.mjs"
node "$H" <command> ...
```

## Git is required

The repository root is the git work-tree top level of the current directory
(`git rev-parse --show-toplevel`), or `GAUNTLET_ROOT=<path>` when set — and
then it must be that top level, not a subdirectory. Every command except
`version` refuses outside a git work tree (exit 2). There is no degraded
non-git mode: evidence is bound to the candidate tree, and without a tree
digest nothing could be called stale. Run `git init` first; an unborn HEAD
is fine (SHA-1 or SHA-256 object format: the empty tree is derived from the
repository). Git worktrees are supported (`.gauntlet/` is excluded through the
common `info/exclude`). `.gauntlet/` is reserved: while the repository
tracks any path under it, `init` and every command that computes the tree
digest refuse (exit 2) — the digest excludes that namespace, so a tracked
project file there could change without changing the candidate identity.

Every git call the harness makes runs in a controlled environment: inherited
`GIT_*` variables are dropped (a hook's `GIT_DIR`/`GIT_WORK_TREE`,
`GIT_INDEX_FILE`, configuration injected through `GIT_CONFIG_*` — so a
repository reachable only through `GIT_DIR`/`GIT_WORK_TREE`, such as a bare
dotfiles repository, is not supported), fsmonitor, the untracked cache and
optional locks are off (the harness never takes `index.lock` behind the
user's back), and replace refs are ignored. Each call is
bounded by `GAUNTLET_GIT_TIMEOUT_S` and runs in its own process group, so a
hanging clean filter, hook or lock kills the whole group and refuses the
command (exit 2) instead of blocking it; any git failure is a refusal with
git's message, never a stack trace.

## Commands

| Command | Effect | Refuses when |
|---|---|---|
| `init <run-id> [--tier T] [--lenses a,b] [--budget N] [--critics N] [--judge\|--no-judge]` | Creates `.gauntlet/runs/<run-id>/`, records tier defaults and the required lenses, excludes `.gauntlet/` via `.git/info/exclude`, checkpoint `PLANNED`. Flags may only raise a tier's floor | run exists; free disk below the governor threshold; unknown tier; invalid or duplicate lens name; non-integer or negative `--critics`/`--budget`; `--critics` below the tier floor; `--no-judge` on a tier that requires the judge; `.gauntlet` or `.gauntlet/runs` is a symlink or not a directory (state is never created through a link) |
| `contract <run-id> <file\|-> [--approved "<who/why>"]` | Stores `contract.md` atomically (temporary file, fsync, rename: a crash never leaves a truncated contract). Replacing a contract that differs from the recorded one makes every critic/judge result stale (the harness says so on stderr). After a material verdict in the round, a replacement reopens the round to another candidate — a scope decision: it needs `--approved`, recorded in `humanApprovals` | empty input; run blocked; a replacement after a material verdict without a non-empty `--approved`; the tree digest refuses (checked before anything is written) |
| `checkpoint <run-id> <PLANNED\|BUILDING\|VERIFYING> [note]` | Manual progress note | any other status (those are derived from evidence); run blocked |
| `gates <run-id> [--force] [--timeout <s>] name=cmd ...` | Runs each command with `sh -c` in order (own session — killed after the timeout, default 1800 s, and when the harness itself is interrupted; settled by the shell's exit, leftovers reaped), stops at the first failure, clears the superseded execution's logs, writes `evidence/gates/<name>.log` (capped, cut marked), `evidence/gates.json` (tree digest **after** the gates, `digestBefore`, `treeChangedByGates`, `specDigest`, `unresolvedFailures`, `evidenceFormat`), `evidence/diff.patch`; exit 1 if any failed. A gate that failed in an earlier execution **of the same round, under the same contract** stays in `unresolvedFailures` (name and command) until **that same command** is observed passing: dropping, renaming, skipping it or running another command under its name proves nothing (a replaced contract may redefine the gates) | invalid, duplicate or empty gate spec; `--timeout` blank, non-numeric or outside `[0, 2147483]` (numeric flags — `--timeout`, `--budget`, `--critics` — never coerce a blank value to 0); run blocked; the round already has a material verdict (`GAP`/`STAGNATING`/`REGRESSION`) for **another** candidate under the same contract — a fix is a correction round: run `correction` (it accepts that verdict even when the candidate was already edited), then gates; processes of an earlier gate are still alive (a survivor of its cleanup, or of a harness killed without cleanup); a correction was interrupted mid-archive; another execution of the same run holds `gates.lock` (a live pid); another process is taking over a stale lock. Reuses the record when tree digest **and** spec digest (commands and effective timeout) are unchanged, all gates passed with nothing unresolved, the gates did not change the tree and the record has the current evidence format |
| `critic <run-id> <lens> <file\|-> [--by <reviewer>] [--evidence <digest>]` | Validates and stores `evidence/critic-<lens>.json` bound to the current evidence digest; `--by` keeps an opaque label of who reviewed (`reviewer`, shown by `status` and `verdict`; the harness never branches on it and cannot verify it); `--evidence` pins the result to the evidence digest the reviewer was handed (from `status`), for reviews that run long; a critic recorded after `judge.json` invalidates it (renamed `judge.invalidated-<ts>.json`), and one recorded after `verdict.json` invalidates the verdict (renamed `verdict.invalidated-<ts>.json`) — a replaced critic changes the gaps while the evidence identity stays the same; rerun `verdict` | no gates; gates failed (including a failure unresolved in the round); tree changed since gates; no contract; invalid lens; `--by` not matching `[A-Za-z0-9][A-Za-z0-9_.:@+/-]{0,63}`; `--evidence` not the current evidence digest (the tree, contract or gate execution moved while the reviewer read); malformed JSON, a key repeated in one object (JSON would keep only the last) or a wrongly typed field; gates record of an older evidence format; a correction interrupted mid-archive; run blocked. A lens recorded again moves the previous result to `evidence/replaced/` |
| `judge <run-id> <file\|->` | Validates and stores `evidence/judge.json` bound to the current evidence digest **and to the exact critic records it read** (`criticsDigest`: it adjudicates findings by reference, so a critic replaced afterwards makes it stale, and an old decision never lands on a new finding at the same index); invalidates an existing `verdict.json` like `critic` does | no gates; gates failed; tree changed; no contract; no critic recorded for the current evidence digest; unknown `ref` or unknown field; malformed JSON or a repeated key; a persisted critic record that no longer validates; a critic recorded while the judge result was being checked; a correction interrupted mid-archive; run blocked |
| `verdict <run-id>` | Derives status and convergence from the evidence recorded for the current evidence digest, writes `evidence/verdict.json` with the `reviewsDigest` of the exact critic and judge records it read (a verdict counts only while they are unchanged), checkpoints. A material verdict (`GAP`/`STAGNATING`/`REGRESSION`) closes the round to other candidates (`run.json` `roundGap`); a `PASS` on the same candidate (a judge refuted the gaps) reopens it | no gates; tree changed since gates; no contract; gates record of an older evidence format; a correction interrupted mid-archive; a critic or judge recorded while it was being derived; a persisted critic or judge record that no longer validates (corrupted or hand-edited, including a malformed `reviewer` label); run blocked |
| `correction <run-id> [--approved "<who/why>"]` | Archives the whole round (`verdict.json` first, then critic/judge files, `replaced/`, `gates.json`, `gates/`, `diff.patch`) under `evidence/rounds/<n>/`, increments the round, reopens it to a new candidate, checkpoint `BUILDING`; completes a crashed archive step — and while `rounds/<n>/` is populated, `gates`, `critic`, `judge` and `verdict` refuse (`status` reports `pendingArchive`). The round's material verdict opens the round even if the candidate was edited after it (the fix made first): the round was closed, so its evidence is still that verdict's own (recovery does not compare the identity — that transition was already legitimately started — but refuses an archived verdict with no evidence identity or from another run) | verdict is stale — its `identity.evidence` differs from the current one because the contract or the gate evidence (specification, timeout, or a re-execution such as `--force`) moved since it was computed, the critic or judge records it read changed (`reviewsDigest`), or the tree moved while the verdict had not closed the round: rerun gates and verdict first; verdict is PASS/CRITIQUE; no material gap; budget spent or STAGNATING/REGRESSION without a non-empty `--approved`; run blocked; archive already populated while a current verdict exists |
| `block <run-id> <reason>` | Marks the run `BLOCKED` in `run.json` with the pending human decision; `verdict.json` is left untouched so the stagnation/budget guards survive the block | empty reason; already blocked; the tree digest refuses (before anything is written) |
| `unblock <run-id> --approved "<who/why>"` | Records the human decision in `humanApprovals`, clears the block, checkpoint `VERIFYING`. It is **not** an approval to continue past stagnation or budget — that needs its own `correction --approved` | not blocked; missing/empty `--approved`; the tree digest refuses (before anything is written) |
| `status <run-id>` | Resume summary: status, block, round, the current evidence identity, whether the gates on record passed (`gatesPassed`), what is recorded and what is stale (critics with their `reviewers` — a label the harness would not have written is never echoed: that record is listed under `malformedCritics` —, judge, and `verdict.stale` for the last verdict), whether the tree or the contract moved since the gates, `unresolvedFailures`, `gatesRunning` (a live lock holder) vs `gatesInterrupted`, `orphanedGateProcesses` (live processes of the recorded gate session), `pendingArchive`, history | `run.json` malformed (a guard field missing or mistyped: refused rather than failing open) |
| `list` / `clean <run-id> [--force]` / `digest` / `version` | List runs; remove one run; print the tree digest; print the harness version (entrypoint check, works outside git) | `clean` on a BLOCKED run without `--force`; `clean` when `.gauntlet`, `.gauntlet/runs` or the run directory is a symlink, or the run's physical location is not `<work tree>/.gauntlet/runs/<id>` (the only recursive deletion in the harness never follows a link); `list` and every command that loads a run refuse the same symlinked or relocated state; `clean` while gates are running for that run or processes of an earlier gate still live (`clean` takes `gates.lock` first: no execution starts while a run is removed, and `gates.session` — their only record — outlives them) |

Exit codes: `0` success, `1` a gate failed or an unexpected error, `2` usage,
environment or protocol refusal — including invalid reviewer JSON and any git
failure or timeout (the message says why). Every refusal of a command's input
or preconditions is decided before its first write. The one exception is a
refusal only the executed gates can cause (a gate leaves an unreadable file,
so the digest after the gates refuses): the execution then stands as
interrupted, which `status` reports and the next `gates` replaces.

`--approved` stores whatever string it is given. The protocol requires it to
be the user's own decision, quoted; the harness records it, it cannot verify
who said it.

## Evidence layout

```
.gauntlet/runs/<run-id>/
  run.json          schemaVersion 3, tier, criticsRequired, lenses, judgeRequired, budget, round, blocked, humanApprovals, roundGap (the round's material verdict: round, tree, contract, status), git revision/branch at init
  gates.lock        exists while a gate execution holds the run: "<pid> <token>" (a hard link, never half-written)
  gates.session     "<sid> <leader start time>" of the last gate started, kept while any of its processes lives (how survivors and an execution killed without cleanup are detected; the start time tells a reused id apart)
  state.json        current status + checkpoint + tree digest (+ evidenceDigest when relevant), and the full history of transitions
  contract.md
  evidence/
    gates.json      per-gate name, command, passed, skipped, exitCode, signal, timedOut, leakedProcesses, leftoverSignal, leftoverOutcome, durationMs, log, logDigest;
                    changedFiles (the top-level paths the patch shows, rename sources included, raw names); digest (tree after) + digestBefore + treeChangedByGates; specDigest + timeoutS (effective); executionId + gateEvidenceDigest; unresolvedFailures; evidenceFormat + harness version; contractDigest (at the time); cleanupIncomplete
    gates/<name>.log
    gates.in-progress.json   exists only while a real execution is running (or after it was interrupted): runId, round, executionId, specDigest, timeoutS, startedAt, supersedes
    diff.patch      bytes exactly as git emitted them (no textconv, no external driver, no color, mode changes shown): tracked changes vs HEAD — git's clean-filter/EOL-normalized view, which the digest does not rely on (assume-unchanged/skip-worktree files included through a throwaway index copy with those flags cleared; an absent skip-worktree file stays out) plus untracked files, nested repositories file by file, every checked-out submodule recursively against the commit its parent records (paths under the submodule's location, ignore settings overridden; a clean checkout moved to another commit shows that source diff; a new submodule, or one whose recorded commit its checkout lacks, is shown whole), and the files of an ordinary directory at a gitlink path (non-regular entries named, not read; a --no-index error is kept as a `#` line) (capped at 5 MB)
    critic-<lens>.json   evidenceDigest + treeDigest + contractDigest + specDigest + gateEvidenceDigest + reviewer (when recorded with --by) + the validated result
    judge.json           same identity fields + the validated result
    verdict.json         status, identity {tree, contract, spec, gateEvidence, evidence}, reviewsDigest (the critic/judge records it read), failedGateSpecs (name and command of each failed gate, for the next round), gaps, backlog, dismissed, critics/judge freshness (with the reviewer label per lens), convergence, evidenceFormat
    replaced/            critic results replaced by a later result for the same lens (kept, never counted)
    rounds/<n>/     the previous round's evidence (verdict, critic/judge, replaced/, gates.json, gates/, diff.patch), moved here by `correction`
  external/         written by an adapter's external-reviewer runner (prompt, event log, raw message, result per call); the harness never reads it, `clean` removes it with the run
```

## Evidence identity

Four digests, all SHA-256:

- **Tree digest** — the candidate, bound to raw bytes and never to git's
  view of them (textconv, clean filters, EOL normalization, `core.fileMode`,
  index flags, fsmonitor, the stat cache and presentation settings can all
  make different bytes look alike, so no `git diff` output enters it): the
  HEAD revision; **every tracked path** (the index's path set, content from
  the working tree) and every untracked, non-ignored entry, each as a
  fixed-size sub-digest — so one file's content can never forge the next
  record — of what `lstat` says it is: regular files by full mode
  (setuid/setgid/sticky included) and content, symlinks by target,
  FIFOs/sockets/devices by type, mode and device number (never opened),
  directories by mode and each child's sub-digest; a nested work tree binds
  its HEAD instead of its `.git` (any other `.git` entry is ordinary).
  `.gauntlet/` is excluded. Every gitlink is visited: a checked-out submodule
  (a real directory, never a symlink to some checkout) is hashed recursively
  the same way; anything else at that path (an ordinary directory git no
  longer looks into, a file, a symlink) is walked like an untracked entry. A
  tracked path beneath a directory that is now a symlink is absent, as it is
  for git — nothing is read through the link. A path that vanished (or whose
  parent is no longer a directory) is hashed as missing; an entry the harness
  cannot read (permissions, including a directory git cannot open) or a path
  that is not valid UTF-8 is refused (exit 2) — a fixed placeholder or a lossy
  name would let its bytes change unseen. Cost: each digest reads every
  candidate byte (about 0.1 s for a small repository, about 1 s per few
  hundred MB), sub-digests computed with bounded concurrency and folded in
  order. `gates` records the digest of the tree **after** the gates ran
  (build artifacts included), so the next `critic`/`verdict` sees a
  consistent tree.

  **What the identity does not cover** — the gate's *environment*, not the
  candidate; when it changes, rerun the gates with `--force`: paths git
  ignores (`.gitignore`, `info/exclude`, `core.excludesFile` — dependencies,
  virtualenvs, local config, build outputs); FIFOs, sockets, devices, empty
  directories and directory modes outside a walked directory (git never lists
  them); an entry named `.git` that git skips outside a walked nested
  repository; a case variant of a tracked path under `core.ignorecase=true` on
  a case-sensitive filesystem; environment variables, services, ports and the
  network. Digest time grows with the apparent size of candidate files: a
  huge sparse file makes every command slow.
- **Contract digest** — the bytes of `contract.md`. `.gauntlet/` is outside
  the tree digest, so this is what makes a contract edit visible.
- **Spec digest** — the deterministic verification package the reviewers
  relied on: the ordered `[name, command]` list of the gates on record **and
  the effective timeout they ran under** (explicit `--timeout`, or
  `GAUNTLET_GATE_TIMEOUT_S` / the 1800 s default when absent; persisted as
  `timeoutS` in `gates.json`). A stricter timeout is a different package: the
  same command may pass under 30 s and be killed under 1 s. Only
  harness-controlled semantics are bound, never arbitrary environment.

- **Gate-evidence digest** — the concrete execution the reviewers read, not
  the specification: a random `executionId` persisted in `gates.json`, the
  spec digest, the tree after the gates, and every gate's outcome and log
  digest (`logDigest`). It is recomputable from the persisted record alone.
  The digest also binds `unresolvedFailures`. **Reuse** (tree and spec
  unchanged, all passed with nothing unresolved, tree untouched by the gates,
  current evidence format) executes nothing and keeps the record, so the
  identity stays.
  **Any execution** — a changed tree or spec, or `--force` on an unchanged
  spec, even with the same outcome — writes a new record with a new
  `executionId`: a new evidence instance that nobody has reviewed yet. A
  record without `gateEvidenceDigest` (written by a harness before 2.2.1),
  or with an `evidenceFormat` other than the current one (the same version
  string spanned builds with different evidence rules), is never reused,
  `critic`, `judge` and `verdict` refuse it with "rerun gates", and `status`
  reports `gatesLegacy: true` for a record `critic`, `judge` and `verdict` would refuse as older: without the digest, or of another evidence format (since 2.4.0; 2.3.0 flagged only a missing digest). A verdict
  with a null identity is always stale for `correction` (also on the
  crash-recovery path, which then asks to resolve by hand) and for `status`
  (`verdict.stale: true`).

**In-flight invalidation.** When `gates` decides that reuse does not apply,
it writes `gates.in-progress.json` atomically **before** the first gate
command runs and before any log is replaced, and removes it only after the
new `gates.json` has been committed atomically. While the marker names an
execution other than the one in `gates.json` (or there is no `gates.json`),
no gate record is current: `status` reports `gatesInterrupted`, `critic`,
`judge` and `verdict` refuse with "rerun gates", the previous reviews are
stale and `correction` refuses the previous verdict as stale. Nothing depends
on signal handlers: the marker is on disk before any side effect. A marker
that names the committed execution (crash between commit and marker removal)
is harmless and the record is complete. An unreadable (truncated) marker
counts as an interruption too, and `gates` replaces it. Reuse writes no
marker. Every evidence artifact — JSON records, each gate log and
`diff.patch` — is written to a temporary file, fsynced, renamed into place
and the directory fsynced, and the logs and the patch are persisted **before**
`gates.json` is committed, so a power loss cannot persist a replaced log
without the marker that supersedes it, nor a committed record whose
`logDigest` names bytes that never reached the disk. Ordering of one
execution: marker → gate logs and `diff.patch` durable → `gates.json`
durable → marker removed.

**Evidence digest** = SHA-256 of the evidence format + tree + contract +
gate-evidence digest (the spec is inside the latter); a critic, judge or
verdict recorded under another evidence format is therefore stale. It is the identity that critic and judge files
carry, and the only identity `verdict`, `judge`, `status` and `correction`
compare against. A critic or judge file whose `evidenceDigest` differs from
the current one is `stale`: it is listed, never counted. So:

| Change | Gates record | Critic/judge evidence |
|---|---|---|
| Candidate tree | stale (`gates` reruns; `verdict` refuses until it has) | stale |
| Contract (`contract` with different bytes) | still valid (objective gates depend on tree + spec only) | stale |
| Gate specification (different names, commands, order **or effective timeout**) | rerun | stale |
| Gates executed again on an unchanged spec (`--force`, or after a tree change) | new record | stale — even when the outcome is identical |
| A real execution started and the harness died before committing its record (SIGKILL, power loss) | none current — `gates` must run again | stale — `critic`, `judge`, `verdict` refuse; `correction` sees a stale verdict |
| None of the above | reused | reused |

Objective gate results are reused when tree and spec digests match; review
evidence is reused only when the full evidence digest matches. A verdict can
therefore never reach `PASS` on reviews produced for another candidate, another
contract or another verification package.

## States

`PLANNED → BUILDING → VERIFYING → CRITIQUE → GAP | REGRESSION | STAGNATING | BLOCKED | PASS`

- `VERIFYING` — gates running or just finished.
- `CRITIQUE` — gates passed; required critic(s) or judge not yet recorded for
  the current evidence digest.
- `GAP` — a material gap is open (failed gate or confirmed critic finding).
- `REGRESSION` — after a correction, a gate that used to pass now fails.
- `STAGNATING` — after a correction, the material gap count did not go down
  within the same stage.
- `BLOCKED` — a human decision is pending. Persisted in `run.json`; every
  command except `status`, `list`, `digest`, `version`, `unblock` and
  `clean --force` refuses until the decision is recorded.
- `PASS` — `result: FIT_FOR_PURPOSE`. `perfect` is always `false`.

## Verdict rules

1. Any failed gate → `CRITICAL` gap per gate, status `GAP`; critic files are
   ignored (hard gates first). A gate whose leftovers `SURVIVED` is failed,
   whatever its exit code (a record from an older harness reads the same), and
   so is a gate in `unresolvedFailures` (failed earlier in the round under
   the same contract, not observed passing since), and so is a gate that
   failed in the previous round and is not observed passing now. A failed
   gate is identified by its name **and command**: another command under the
   same name does not resolve it, and does not count as progress for
   convergence either — unless the
   contract was replaced since and the gate is no longer in the package (a
   recorded scope decision). Each of these is an explicit `CRITICAL` gap, so a
   stop is never a dead end: `correction --approved` can act on it.
2. Otherwise, fewer current critics than `criticsRequired`, any declared lens
   missing, or judge required and not current → `CRITIQUE`.
3. Otherwise, apply the judge (if current: same evidence digest and the same critic records it read): `REFUTED`/`UNPROVEN` findings
   move to `dismissed`; `CONFIRMED` may re-grade; judge-added findings join
   the set.
4. Material = `BLOCKER`, `CRITICAL`, `MAJOR`. Any material gap → `GAP`;
   `MINOR`/`POLISH` → `backlog`; none material → `PASS`.
5. Convergence (round ≥ 1, compared with `rounds/<n-1>/verdict.json`) treats
   gate failures and critic findings as two **stages**:
   - a gate that **passed** in the previous round (`passedGates` in its
     verdict) and fails now → `REGRESSING`. A verdict recorded before
     `passedGates` existed keeps the stricter pre-2.2 reading: any current
     failure that was not failing before.
   - the previous round had failing gates (gate stage): `IMPROVING` only when
     **every** gate that failed then is observed passing now — whether the run
     reached critique or stopped at a later gate. A previously failing gate
     that was merely not executed (skipped behind a new or reordered gate, or
     dropped from the spec) proves nothing → `STAGNATING`.
   - the previous round reached critique: a gate that never passed failing
     now → `STAGNATING` (fail safe); otherwise fewer material gaps or zero →
     `IMPROVING`, the same or more → `STAGNATING`.
   `STAGNATING`/`REGRESSING` override the status — also when no gap is left:
   a gate that failed last round and is not observed passing now (dropped,
   renamed or skipped) keeps the run `STAGNATING`, never `PASS` (rule 1 makes
   it an explicit gap); rerun that gate, or replace the contract with the
   user's approval if it no longer belongs. The comparison is by count,
   not by finding identity: alternating findings (fix A breaks B, fix B breaks
   A) must be recognized by the orchestrator and reported as stagnation.
6. A material verdict closes its round: `gates` refuses another candidate (under
   the same contract) until `correction` opens the next round, where the
   budget and convergence guards apply — editing and re-verifying inside the
   round cannot reach `PASS` past an exhausted budget or a `STAGNATING`
   verdict. `correction` accepts that verdict even when the fix was already
   made; gates that only change their own artifacts keep the round's
   candidate; a `PASS` reopens the round; a contract replacement reopens it
   only with `--approved`. Before the round's first verdict, iterating on
   gates is free.

## Governor and process cleanup

- Refuses `init` and `gates` when free disk at the repository root is below
  `GAUNTLET_MIN_FREE_BYTES` (default 512 MiB).
- Warns on `init` when `GAUNTLET_RUNS_WARNING` (default 5) or more runs exist.
- Gate output is captured up to 8 MB per gate and the patch up to 5 MB; both
  carry an explicit truncation marker when cut.
- A gate is the leader of its own session. The session, not the process
  group, is the unit of every kill and probe: coreutils `timeout` and
  job-control shells move the gate's command into another process group of
  the same session (a `nohup … &` child stays in it too). Only a process that
  calls `setsid()` itself leaves the session, and is neither tracked nor
  killed. A kill sweeps the session until it is empty (bounded): a single pass
  could miss a child forked into a new group while `/proc` was being read.
- A gate is settled by the exit of the shell that runs it, not by its pipes
  closing. Once the shell has exited (after at most a 500 ms drain), the
  harness probes the gate's session and reaps what is left, bounded: SIGTERM
  → up to `GAUNTLET_LEFTOVER_GRACE_MS` (default 2000) → SIGKILL → up to
  1000 ms more → one last probe. The gate records `leakedProcesses` and
  `leftoverOutcome`: `null` (nothing was left), `TERMINATED` (gone after
  SIGTERM), `KILLED` (gone after SIGKILL) or `SURVIVED` (a live process still
  observed after the final wait — uninterruptible state, or a process the
  harness may not signal; the record then has `cleanupIncomplete: true` and
  stderr warns). A `SURVIVED` gate is recorded `passed: false` even when its
  command exited 0: surviving processes keep acting on the candidate, so the
  later gates are skipped and nothing is reused, reviewed or passed on top of
  that execution until they are gone and gates are rerun. "Live" excludes
  zombies: on Linux the session is read from `/proc` and a member in state
  `Z` does not count. Where `/proc` cannot be enumerated, the probe falls back
  to `kill(-pgid, 0)` on the leader's group (`EPERM` counts as present; a
  zombie then counts as present; unverified platforms, see below). The
  harness never claims a clean session it did not observe, and never waits
  beyond those bounds. The gate's result is its own exit code; a shell killed
  by a signal is recorded `exitCode: null`, `signal: <name>`.
- A gate still running after `--timeout` seconds (default 1800,
  `GAUNTLET_GATE_TIMEOUT_S`; `0` disables) is killed with its whole session
  and recorded `timedOut: true`, `passed: false`. The session is then probed
  for up to 1000 ms like any other: gone → `leftoverOutcome: null`; still
  observed → `SURVIVED`, `cleanupIncomplete: true`. No path records a clean
  session without probing it.
- Interrupting the harness with any terminating signal it can catch (SIGINT,
  SIGTERM, SIGHUP, SIGQUIT, SIGUSR2, SIGALRM, SIGVTALRM, SIGPROF, SIGXCPU,
  SIGXFSZ) sweeps the running gate's session, kills the process groups of
  any git command in flight (they run detached, so a Ctrl-C would not reach a
  hanging filter), and releases `gates.lock` before exiting. SIGKILL (or an
  OOM kill) cannot be caught: the gate's session keeps running, unbounded.
  `gates.session` records the session (with its leader's start time, so a
  reused id is not mistaken for it) and is kept while any of its processes
  lives; `status` reports them as `orphanedGateProcesses`, and every `gates`
  (and `clean`) refuses (listing the pids) until they are gone, instead of
  running alongside them. Where `/proc` cannot be enumerated, the gate
  shell's own process group is probed instead (`kill(-sid, 0)`; `EPERM`
  counts as present): it still blocks, but a member moved to another group
  is not seen there.
- Gate executions of one run are serialized by `gates.lock` (a hard link to a
  file already holding the holder's pid and a token). A lock whose holder is
  gone is stale: it is taken over under an exclusive mutex
  (`gates.lock.takeover`), re-checked and removed only if unchanged, so two
  processes can never both take it. Concurrency of agents is a protocol rule
  (max 3), not something the harness can observe. `clean` takes the same
  lock. The other commands are short read-modify-writes that assume one
  driver per run; a verdict is additionally bound to the review records it
  read, so a critic or judge recorded concurrently makes it stale instead of
  leaving it current.

## Environment knobs

| Variable | Default | Accepts |
|---|---|---|
| `GAUNTLET_ROOT` | git top level of the cwd | that top level (a subdirectory is refused) |
| `GAUNTLET_MIN_FREE_BYTES` | 536870912 | integer ≥ 0 |
| `GAUNTLET_RUNS_WARNING` | 5 | integer ≥ 0 |
| `GAUNTLET_GATE_TIMEOUT_S` | 1800 | finite number in `[0, 2147483]` (the timer range) |
| `GAUNTLET_LEFTOVER_GRACE_MS` | 2000 | integer in `[0, 2147483647]` |
| `GAUNTLET_GIT_TIMEOUT_S` | 600 | finite number in `[0, 2147483]` — the bound of every internal git call (`0` disables) |
| `GAUNTLET_TEST_HALT` | unset | test-only seam: `after-evidence` or `after-record` SIGKILLs `gates` at that persistence boundary; any other value is refused |
| `GAUNTLET_TEST_NO_PROC` | unset | test-only seam: `1` makes the harness behave as on a host without an enumerable `/proc` (the macOS/BSD fallbacks); any other value is refused |

An unset or empty variable takes the default. Any other value that is not a
finite number in range (`Infinity`, `NaN`, `abc`, `-1`, an overflowing
timeout that would fire immediately) makes every command refuse with exit 2
before touching any state.

## Platform

Verified on GNU/Linux (the production environment; `tests/run.sh` needs GNU
coreutils, `pgrep`, `setsid` and `python3` for the process-group cases). The
harness itself uses only POSIX facilities (`sh -c`, sessions and process
groups, `git`, `statfs`) plus a Linux `/proc` read for the session-wide,
zombie-aware leftover probe, and is expected to work on macOS/BSD with the
`kill(-pgid, 0)` fallback — which tracks the leader's process group only — but
that is **unverified** and not claimed. Windows is not supported.

## Degraded mode (no Node available)

Create the same layout by hand: `.gauntlet/runs/<run-id>/contract.md`, run the
gate commands yourself and save each output as `evidence/gates/<name>.log`,
write a minimal `evidence/gates.json` with `{"allPassed": true|false, "gates":
[{"name","command","passed"}]}`, save critic results as
`evidence/critic-<lens>.json`, and apply the verdict rules above manually.
Evidence identity is then enforced by nobody: say in the report that the run
was degraded, which invariants were only enforced by hand, and that no
`FIT_FOR_PURPOSE` from a degraded run carries the harness's assurance.
