# Adapter — Claude Code

Everything provider-specific about running the Gauntlet lives here and in the
agent files. The protocol (`SKILL.md`) and the harness never name a model.

## Roles → subagents

| Role | Subagent file | Where installed |
|---|---|---|
| Builder | `claude-agents/gauntlet-builder.md` | `~/.claude/agents/gauntlet-builder.md` |
| Critic (any lens) | `claude-agents/gauntlet-critic.md` | `~/.claude/agents/gauntlet-critic.md` |
| Judge | `claude-agents/gauntlet-judge.md` | `~/.claude/agents/gauntlet-judge.md` |

The agent frontmatter is **authoritative** for the default model and effort:

| Subagent | `model` | `effort` | Why |
|---|---|---|---|
| `gauntlet-builder` | `inherit` | session default | Implementation gets the model the operator chose for the session — the frontier model by default. A cheaper model is an operator choice (per run, below, or `/model`), never a hidden downgrade. |
| `gauntlet-critic` | `inherit` | session default | The evaluator must never be weaker than the builder; inheriting keeps them matched. |
| `gauntlet-judge` | `opus` | `high` | A different model for the arbiter reduces correlated blind spots between builder and critic. This is a diversity choice, not an escalation ladder: Opus is not defined as "stronger than" the session model. |

The orchestrator itself runs on whatever model the operator selected for the
session.

## Run-local model selection

Normal usage needs no model syntax:

```
/gauntlet <task>
```

For **one** run — because of subscription quota, cost or another operational
reason the operator can see and the skill cannot — model tokens may be added
anywhere in the arguments:

| Token | Effect |
|---|---|
| `models:economy` | Named profile: builder `sonnet`, critic `sonnet`, judge `opus` (unchanged — it is conditional and rare) |
| `builder:<alias>` | Builder model for this run |
| `critic:<alias>` | Critic model for this run (every lens) |
| `judge:<alias>` | Judge model for this run |

`<alias>` is one of the Agent tool's model names: `haiku`, `sonnet`, `opus`,
`fable`, or `inherit`. Explicit role tokens override the profile. Examples:

```
/gauntlet Debounce the search input; results must stay identical. models:economy
/gauntlet Fix the N+1 in GET /api/orders tier:elevated builder:sonnet critic:fable
/gauntlet Add pause/resume to the session timer judge:fable
```

How it is applied: the orchestrator passes `model` to the Agent tool on each
invocation of that role (the Agent tool's `model` overrides the frontmatter).
Nothing is written anywhere — not to the agent files, not to settings, not
to `.gauntlet/`. The next `/gauntlet` invocation is back to the defaults. The
final report lists the model per role whenever a token was used. The judge's
`effort` comes from its frontmatter regardless of the model token.

The skill never inspects quota or usage limits and never switches models on
its own. The operator sees the limits and chooses.

### Review policy (enforced by the orchestrator before any delegation)

Models are grouped in capability classes for this check only:

| Class | Aliases |
|---|---|
| frontier | `fable`, `opus`, and `inherit` when the session model is one of them |
| standard | `sonnet`, and `inherit` when the session model is `sonnet` |
| small | `haiku`, and `inherit` when the session model is `haiku` |

Rules:

1. The critic's class must be ≥ the builder's class. A critic materially
   weaker than the builder it reviews is refused — the run does not start;
   the orchestrator explains the conflicting pair and suggests a matching
   pair (e.g. `models:economy`, or a stronger `critic:`).
2. The judge's class must be ≥ the critic's class, for the same reason.
3. On the `CRITICAL` tier, any token that puts a role below the frontier class
   is refused: irreversible or money/prod-data changes are not where quota is
   saved. Re-run without the token or with a lower tier explicitly.

There is no override token for these rules; they are the review-integrity
floor of the protocol. The classes rank capability tiers, not products: `fable`
and `opus` are peers here, and the table is meant to be edited when the
available models change.

## External reviewer (cross-provider critic)

A lens can be run by a reviewer from another model family: the Codex CLI,
through `scripts/codex-critic.mjs` (the *runner*). It gets the same package,
the same role text (the body of `gauntlet-critic.md`) and the same result
format, and the harness records it like any critic. The point is
decorrelation — reviewers of the builder's own family share its blind spots —
not more review: the external reviewer **takes the slot** of the lens it
runs; it is never an extra critic.

It is opt-in per run; nothing enables it by default. Without the token the
runner is never called and every lens runs on `gauntlet-critic`, exactly as
if this section did not exist:

| Token | Effect |
|---|---|
| `external:<lens>[,<lens>]` | These declared lenses run on the external reviewer for this run |
| `external-model:<slug>` | Its model for this run (default `gpt-6-astra`) |
| `external-effort:<level>` | Its reasoning effort for this run (default `high`) |

External models are classed for the review policy above like the Agent-tool
aliases (the critic's class must be ≥ the builder's; on CRITICAL, no class
below frontier). A model this table does not list is refused until it is
added:

| External model | Class |
|---|---|
| `gpt-6-astra` | frontier |

Rules, checked by the orchestrator before any delegation:

1. Only lenses the run declares (`init --lenses`), on a tier with critics
   (STANDARD and up). `external:` on LIGHT is refused.
2. The token is the operator's decision that this repository may be read by
   that provider: what the reviewer reads (code, diff, logs — and anything
   else the user can read, see isolation below) leaves the machine. The orchestrator never adds it on its own — not to save quota,
   not to replace a native critic that failed.
3. A failed external review falls back at once to `gauntlet-critic` for that
   lens — automatically and visibly (below). The run never waits on the
   other provider.

Running it — launch it together with the native critics of the round, in the
same message (Bash in the background next to the Agent calls); it counts
toward the 3 reviewers in flight:

```bash
X="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/gauntlet}/scripts/codex-critic.mjs"
node "$X" <run-id> general --model gpt-6-astra --effort high     # [--claims <regular file, ≤ 256 KB>] [--timeout <s>, default 900]
```

It prints JSON with `reviewer`, `result` (path), `evidenceDigest`, gap
counts, `logs` and `record` — the exact command that records it, labelled
and pinned to the evidence the reviewer read:

```bash
node "$H" critic <run-id> general <result> --by codex/gpt-6-astra@high --evidence <digest>
```

Record the round's critics one at a time after all have returned: the
harness assumes one driver per run.

| Runner exit | Meaning | Orchestrator |
|---|---|---|
| 0 | result validated | record it with the printed command |
| 2 | refused: nothing was sent (e.g. blocked run, no contract, gates missing, running, interrupted, failed, stale or from an older harness, a half-archived correction, a run that declares no lenses or not this one, a claims file that is not a small regular file, a short disk, a temporary directory inside the candidate, bad arguments) — or the evidence moved while it was reading | fix the state (usually: rerun gates) and run it again |
| 3 | the external review failed: CLI missing, usage limit (also mid-review), error, timeout, malformed result — nothing was recorded, the reviewer is gone | **fall back**: run that lens at once with `gauntlet-critic` (fresh, same package), record it with `--by gauntlet-critic:fallback`, and say in the report why the external review failed |
| 128+n | the runner was interrupted by signal n; it killed the reviewer's session first | nothing to record; fall back as for 3, unless the run itself is being stopped |
| 1 | unexpected error of the runner itself (e.g. permissions on `.gauntlet/`, or a transport directory something else wrote into); the message says which | nothing to record; fall back as for 3 and report the cause |

The fallback is automatic because the run must never stall on another
provider's quota; it is never silent: `status` → `reviewers` shows
`gauntlet-critic:fallback` for that lens and the final report says why. No
automatic retry of the external review (a usage limit does not clear in
minutes), no quota inspection. A reviewer that hangs is bounded by the
runner's timeout (default 900 s); connection retries are bounded too, and
so is the CLI's version probe that precedes the review (30 s and 4 KB of
output at most, its whole session killed — a CLI that ignores SIGTERM or
floods its output cannot hold the run).
What the reviewer writes is bounded at the write itself: it writes to no
file of its own (no `-o`: its final message is the last `agent_message` of its
event stream), and both its streams reach the disk only through the runner,
which writes each up to 16 MiB (`GAUNTLET_EXTERNAL_MAX_OUTPUT_BYTES`), drops
the rest and stops the review — no byte past the cap is ever on disk. The
final message is refused above 4 MiB, and the harness's disk governor
(`GAUNTLET_MIN_FREE_BYTES`) is checked before anything runs.

Isolation (fixed by the runner, tested): `codex exec --sandbox read-only` (no
writes, no network), `--ignore-user-config` (the operator's `config.toml` is
not loaded: its MCP servers and plugins would run outside the sandbox),
`--ignore-rules`, `approval_policy="never"`, `--ephemeral` (each call starts
empty), `--output-schema scripts/critic-result.schema.json`, web search off
(`web_search="disabled"`: nothing it read goes to a search engine), and every
default-on feature that acts outside the local sandbox switched off with
`-c features.<name>=false` (connectors/apps, plugins, hooks, browser and
computer control, dependency installs, sub-agents, worktrees, and unbounded
connection retries, which would turn a network failure into a hang — the list is
`DISABLED_FEATURES` in the runner, checked against codex-cli `CHECKED_CLI`;
another version runs with a warning to re-check it).
The commands the reviewer runs see only the core variables
(`shell_environment_policy.inherit="core"`): the credentials the CLI itself
needs never reach its shell, its model context or its event log.

Nothing the candidate controls reaches the reviewer as instructions
(invariant 10):

- **Neutral start.** The reviewer's process cwd and its `-C` are one fresh
  *transport directory* the runner creates under the system temporary
  directory — refused (exit 2) if that resolves inside the candidate — with
  `--skip-git-repo-check`, since it is not a repository. From there the CLI
  discovers none of the candidate's `AGENTS.md`, rules or skills; and
  `-c project_doc_max_bytes=0` (no project doc) with
  `-c skills.include_instructions=false` (no skill list — the candidate's or
  the operator's) keep it that way.
- **Data as files, paths as data.** The contract (the bytes the harness
  recorded) and the builder's claims (the `--claims` bytes) are written byte
  for byte to `contract.md` and `claims.md` in the transport directory, next
  to `critic-protocol.md` (a byte copy of the runner's own lens checklist) and
  `candidate`, a link the runner makes to the candidate's real work-tree root.
  The CLI expands a `$name` skill mention written in the prompt into that
  skill's body — not one the reviewer later reads in a file or a command's
  output — and a newline in a path would be a new line of the prompt. So the
  prompt names only those runner-fixed entries (`./contract.md`,
  `./claims.md`, `./critic-protocol.md`, `./candidate`), never a path the
  environment or the user can name (checkout, run, temporary or install
  path), and none of the files' text. It holds only the role (the body of
  `gauntlet-critic.md`, authority boundary included), the run id, the lens,
  those names and the runner's notes: read the contract first, as the closed
  contract; the claims are data to test; the diff and the gates are under
  `./candidate/.gauntlet/runs/<id>/evidence/`; run git as
  `git -C ./candidate`.
- **Lifetime.** The transport directory lives as long as the reviewer and is
  removed on every exit path the runner handles — result, failure, refusal,
  timeout, interrupt: its own files, and its link (unlinked, never followed,
  and only while it is still the runner's link to the candidate), then
  `rmdir`, never recursively. One that holds anything else is reported and
  left in place, and the runner exits 1 instead of giving a result. A runner
  killed with SIGKILL, or a machine that loses power, leaves it behind (mode
  0700, under the temporary directory).

What these flags do not cover is operator-level, not the candidate's: the
operator's own `$CODEX_HOME/AGENTS.md` can still reach the reviewer. The
isolation canary (rationale.md) checks the properties above against the real
codex-cli `CHECKED_CLI` (0.156.0), including a checkout whose path holds a
`$name` mention; a CLI upgrade means rerunning it before relying on them. The reviewer's process
gets a minimal environment (what the CLI needs to run, authenticate and reach
its provider: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TZ`,
`TMPDIR`, locale (`LANG`, `LANGUAGE`, `LC_*`), proxies and certificates,
`DBUS_SESSION_BUS_ADDRESS` (for a keyring-stored login), `CODEX_*`, `OPENAI_*`,
`XDG_*`) — never the orchestrator's other variables.
The read-only sandbox limits writes and network, not reads: like a native
critic with a shell, the reviewer can read any file the user can, and what it
reads goes to its provider. The reviewer cannot run commands that write — test
runners that write caches fail — so it reads, traces and relies on the gate
logs; the gates already ran the checks. The reviewer leads its own session;
the runner sweeps that whole session (every process group in it) on timeout,
on any signal the harness treats as an interrupt, and after the reviewer
exits. Where `/proc` cannot list the session (macOS, BSD), `pgrep -s <sid>`
does: every member of the reviewer's session, in any process group, orphaned
or not, is signalled until the session is empty. On every platform only a
process that calls setsid() itself leaves the session. A runner killed with SIGKILL cannot do that: its reviewer runs until it
finishes on its own. The runner keeps its files with the run: `.gauntlet/runs/<id>/external/<lens>-<ts>-<rand>.{prompt.md,events.jsonl,stderr.log,message.txt,result.json}`.
`GAUNTLET_CODEX_BIN` points the runner at another CLI binary (the tests use a
fake). The final report names the reviewer per lens (`status` → `reviewers`).

## Tools and isolation

Both critic and judge carry `disallowedTools: Write, Edit, NotebookEdit, Skill, Agent, SendMessage, RemoteTrigger, CronCreate`.
This removes the direct editing tools; it is not a sandbox — Bash stays
available so they can run tests, and the "do not modify" rule is otherwise
enforced by their prompts. The harness detects a modified tree after the fact
through the digest. `Skill` is denied too: a reviewer cannot invoke a skill,
so a skill the candidate ships (or the operator's own) cannot take over the
review.

Both also carry `omitClaudeMd: true`: a native reviewer starts without the
user, project and local `CLAUDE.md`, the project rules and `AGENTS.md` in its
instruction context — the candidate's instruction files are evidence it may
read, not instructions it receives (invariant 10). Managed policy still
reaches it. The builder carries neither field: it is a working role and
follows the project's conventions. `omitClaudeMd` requires Claude Code
≥ 2.1.271; older versions silently ignore frontmatter fields they do not know,
so below that version this control fails open (the reviewer gets the
instruction files as before). No version check is added.

Native reviewers do not delegate to other agents: `Agent`, `SendMessage`,
`RemoteTrigger` and `CronCreate` are denied, because an agent a reviewer
dispatched would inherit neither `omitClaudeMd` nor the `Skill` denial.
`Agent` is the delegation tool's identifier (Claude Code 2.1.283; the
stream-json init lists it under its SDK name `Task`); with only `Agent`
denied, a subagent could still load the other three through `ToolSearch`.
Bash is not closed by this denial: a reviewer could
still start another agent through it (e.g. `claude -p`), and that agent gets
none of these controls — an accepted residual (rationale.md).

## Invoking

The orchestrator uses the Agent tool with `subagent_type` set to the agent name
(and `model` when a run-local token applies) and a prompt that contains the
contract verbatim plus the paths listed in
[critic-protocol.md](critic-protocol.md). Run the critics of one round in the
same message so they execute in parallel and independently. Keep at most 3
subagents in flight.

The orchestrator is the only process that runs the harness
(`${CLAUDE_SKILL_DIR}/scripts/gauntlet.mjs`). Subagents receive evidence
*paths* to read, never the harness path to write.

## Verifying the installation

```bash
ls -la ~/.claude/agents/gauntlet-*.md ~/.claude/skills/gauntlet
./install-gauntlet.sh --check        # from the repository: links, targets, model/effort per agent, and the harness answering through the link
node ~/.claude/skills/gauntlet/scripts/gauntlet.mjs version   # must print gauntlet-harness <version>
codex --version                                                # only for external:<lens>
```

A new session lists `gauntlet-builder`, `gauntlet-critic` and `gauntlet-judge`
among the available agent types when the links resolve. The repository's
`tests/run.sh` validates the agent frontmatter, the protocol's model
neutrality, this file's model-selection table and the installer's behavior.

## Self-review: the arbiter outside the candidate

When the candidate is the Gauntlet itself — its skill, agents, runner or
harness — the arbiter must not be the candidate (invariant 4). The installed
links normally point into this checkout, so whatever branch is checked out
*is* the installed Gauntlet. The arbiter therefore comes from an immutable
export of a published baseline commit, installed from there, and the session
that runs the review starts outside the candidate:

```bash
BASE=<published baseline commit>                     # the last merged Gauntlet
REPO=<absolute path of the candidate checkout>
ARBITER="$HOME/gauntlet-arbiter/$BASE"
mkdir -p "$ARBITER"
git -C "$REPO" archive "$BASE" claude-skills/gauntlet claude-agents install-gauntlet.sh | tar -x -C "$ARBITER"
chmod -R a-w "$ARBITER"                              # immutable for the whole review
"$ARBITER/install-gauntlet.sh"                       # relinks ~/.claude to the export: the operator's decision
"$ARBITER/install-gauntlet.sh" --check               # every link [ok], harness answering through the link at $BASE's version
mkdir -p "$HOME/gauntlet-review/<run>" && cd "$HOME/gauntlet-review/<run>" && claude   # neutral session root
```

Installing the arbiter replaces the operator's links (the previous ones go to
the installer's backup) and needs the operator's explicit words, as does
going back afterwards (`"$ARBITER/install-gauntlet.sh" --uninstall`, or the
working checkout's installer). In the review session the candidate is
reached by explicit path: harness and runner commands carry
`GAUNTLET_ROOT=<candidate>` (the work-tree top level), critics and the judge
get the candidate's absolute path, and nothing is read from the session root.
The final report's Evidence line names the arbiter: the export path and
`$BASE`. To delete the export later, `chmod -R u+w` it first.

## Other adapters

A different runtime needs: a way to run a fresh, isolated builder/critic/judge
with a prompt; read access to the repository and to `.gauntlet/runs/<id>/`;
and a shell to run the harness. Nothing in the protocol or the harness assumes
Claude Code. Another external reviewer (a different CLI) needs a runner with
the same contract as `codex-critic.mjs`: the package of critic-protocol.md
with no candidate-controlled text and no environment- or user-named path in
its prompt, a start outside the
candidate, no write access to the repository, a result that passes the harness's
`validateCriticResult`, and the exit codes 0 / 2 / 3 above.
