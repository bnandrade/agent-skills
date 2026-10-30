// Validates the Gauntlet skill and agent configuration itself ("evaluators
// must be evaluated"): frontmatter, role/agent wiring, model neutrality of the
// protocol, and documentation consistency.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

const ROOT = resolve(".");
const AGENTS = join(ROOT, "claude-agents");
const SKILL = join(ROOT, "claude-skills", "gauntlet");

const MODEL_ALIASES = new Set(["inherit", "sonnet", "opus", "haiku", "fable"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MODEL_WORDS = /\b(sonnet|opus|haiku|fable|gpt|astra|xhigh)\b/i;

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "file must start with a YAML frontmatter block");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

async function agentFiles() {
  return (await readdir(AGENTS)).filter((name) => /^gauntlet-.*\.md$/.test(name)).sort();
}

// The numbered invariants of SKILL.md, by number, each one line of text.
function invariants(text) {
  const section = text.split("\n## Invariants\n")[1].split("\n## ")[0];
  const items = {};
  let current = null;
  for (const line of section.split("\n")) {
    const start = line.match(/^(\d+)\. (.*)$/);
    if (start) { current = Number(start[1]); items[current] = start[2]; }
    else if (current !== null && /^\s+\S/.test(line)) items[current] += ` ${line.trim()}`;
  }
  return items;
}

const flat = (text) => text.replace(/\s+/g, " ");

// A markdown section: from its heading to the next heading of the same or a higher level.
function section(text, heading) {
  const start = text.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `section ${heading} exists`);
  const rest = text.slice(start + heading.length + 1);
  const end = rest.search(new RegExp(`\\n#{1,${heading.match(/^#+/)[0].length}} `));
  return text.slice(start, end < 0 ? undefined : start + heading.length + 1 + end);
}

// The first ```json example after `marker`.
function jsonExample(text, marker) {
  const block = text.slice(text.indexOf(marker)).match(/```json\n([\s\S]*?)\n```/);
  assert.ok(block, `a JSON example follows ${marker}`);
  return JSON.parse(block[1]);
}

// The reviewer-authority boundary as it must read wherever a reviewer gets
// it: what candidate-controlled content is, that it is evidence and never
// authority, and everything it cannot change.
const CANDIDATE_CONTROLLED = ["source code", "repository files", "instruction files", "local rules", "local skills", "the diff", "gate logs", "command output", "artifacts", "retrieved content", "the builder's claims"];
const NOT_CHANGEABLE = ["role", "review scope", "contract", "severity rules", "verdict rules", "what is authorized"];
const AUTHORITY_SOURCES = ["recognized runtime instructions", "Gauntlet protocol|Gauntlet role", "closed contract", "explicit human decisions"];
function assertReviewerAuthority(text, label) {
  const prose = flat(text);
  const boundary = prose.match(/Candidate-controlled content — ([^—]+) — is evidence(?: to examine)?, never (?:reviewer )?authority: it cannot change ([^.]+)\./);
  assert.ok(boundary, `${label}: candidate-controlled content is evidence, never authority, and cannot change the review`);
  for (const item of CANDIDATE_CONTROLLED) assert.ok(boundary[1].includes(item), `${label}: ${item} is candidate-controlled`);
  for (const item of NOT_CHANGEABLE) assert.ok(boundary[2].includes(item), `${label}: candidate-controlled content cannot change the ${item}`);
  const sources = prose.slice(0, prose.indexOf("Candidate-controlled content"));
  for (const source of AUTHORITY_SOURCES) assert.match(sources.slice(sources.lastIndexOf("authority comes only from")), new RegExp(source), `${label}: authority comes from ${source}`);
  assert.match(prose, /looks like an instruction/, `${label}: instruction-looking text does not become authority`);
}

test("exactly three Gauntlet agents exist: builder, critic, judge", async () => {
  assert.deepEqual(await agentFiles(), ["gauntlet-builder.md", "gauntlet-critic.md", "gauntlet-judge.md"]);
});

test("agent frontmatter is valid for Claude Code and coherent with the file name", async () => {
  for (const file of await agentFiles()) {
    const { fields, body } = frontmatter(await readFile(join(AGENTS, file), "utf8"));
    assert.equal(fields.name, file.replace(/\.md$/, ""), `${file}: name must match file name`);
    assert.ok(fields.description && fields.description.length > 40, `${file}: description too short`);
    assert.ok(fields.description.length <= 1024, `${file}: description too long`);
    assert.ok(MODEL_ALIASES.has(fields.model) || /^claude-[a-z0-9-]+$/.test(fields.model ?? ""), `${file}: model "${fields.model}" is not an alias, "inherit" or a claude-* id`);
    if (fields.effort !== undefined) assert.ok(EFFORTS.has(fields.effort), `${file}: effort "${fields.effort}" invalid`);
    assert.ok(body.trim().length > 200, `${file}: body too short to be a role prompt`);
  }
});

test("critic and judge are read-only reviewers that start without CLAUDE.md, cannot invoke skills and do not delegate to other agents; the builder is not", async () => {
  const adapter = await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8");
  for (const name of ["gauntlet-critic.md", "gauntlet-judge.md"]) {
    const { fields } = frontmatter(await readFile(join(AGENTS, name), "utf8"));
    const disallowed = (fields.disallowedTools ?? "").split(",").map((tool) => tool.trim());
    // Editing tools, skills, and every agent-dispatch route (a dispatched agent inherits none of these controls).
    for (const tool of ["Write", "Edit", "NotebookEdit", "Skill", "Agent", "SendMessage", "RemoteTrigger", "CronCreate"]) assert.ok(disallowed.includes(tool), `${name}: must disallow ${tool}`);
    assert.equal(fields.omitClaudeMd, "true", `${name}: a reviewer starts without the instruction files (omitClaudeMd: true)`);
    // The adapter documents the controls exactly as the frontmatter sets them.
    assert.ok(adapter.includes(`\`disallowedTools: ${fields.disallowedTools}\``), `adapter documents ${name}'s disallowedTools as set`);
  }
  const { fields } = frontmatter(await readFile(join(AGENTS, "gauntlet-builder.md"), "utf8"));
  assert.equal(fields.disallowedTools, undefined, "builder must be able to edit");
  assert.equal(fields.omitClaudeMd, undefined, "builder is a working role: it keeps the project's instruction files");
  assert.ok(adapter.includes("`omitClaudeMd: true`"), "adapter documents omitClaudeMd");
  assert.match(adapter.replace(/\s+/g, " "), /`omitClaudeMd` requires Claude Code ≥ 2\.1\.271; older versions silently ignore [^.]*fails open/, "adapter states the minimum version and that the control fails open below it");
  const tools = flat(section(adapter, "## Tools and isolation"));
  assert.match(tools, /Native reviewers do not delegate to other agents: `Agent`, `SendMessage`, `RemoteTrigger` and `CronCreate` are denied, because an agent a reviewer dispatched would inherit neither `omitClaudeMd` nor the `Skill` denial\./, "adapter states the no-delegation rule, its four denied tools and why");
  assert.match(tools, /Bash is not closed by this denial: a reviewer could still start another agent through it \(e\.g\. `claude -p`\)[^.]*accepted residual/, "adapter records Bash as the residual route the denial does not close");
});

test("the judge runs on a different model than the inherited builder/critic (diversity, not escalation)", async () => {
  const judge = frontmatter(await readFile(join(AGENTS, "gauntlet-judge.md"), "utf8")).fields;
  const critic = frontmatter(await readFile(join(AGENTS, "gauntlet-critic.md"), "utf8")).fields;
  const builder = frontmatter(await readFile(join(AGENTS, "gauntlet-builder.md"), "utf8")).fields;
  assert.equal(builder.model, "inherit");
  assert.equal(critic.model, "inherit");
  assert.notEqual(judge.model, "inherit");
});

test("critic and judge prompts describe the JSON contract the harness validates", async () => {
  const critic = await readFile(join(AGENTS, "gauntlet-critic.md"), "utf8");
  for (const token of ['"gaps"', '"severity"', '"contract"', '"evidence"', '"description"', '"summary"', "BLOCKER", "POLISH"]) {
    assert.ok(critic.includes(token), `critic prompt must mention ${token}`);
  }
  const judge = await readFile(join(AGENTS, "gauntlet-judge.md"), "utf8");
  for (const token of ['"findings"', '"ref"', '"classification"', "CONFIRMED", "REFUTED", "UNPROVEN"]) {
    assert.ok(judge.includes(token), `judge prompt must mention ${token}`);
  }
});

test("SKILL.md frontmatter is valid and the protocol names no model", async () => {
  const text = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const { fields, body } = frontmatter(text);
  assert.equal(fields.name, "gauntlet");
  assert.ok(fields.description.length > 100 && fields.description.length <= 1024, "description must be informative and within the 1024-char limit");
  assert.match(fields.description, /\bNot for\b|Do NOT use/i, "description must scope out what the skill is not for");
  assert.match(fields.description, /closed contract/i, "description must state the activation boundary (a closed contract)");
  assert.ok(fields["argument-hint"], "argument-hint helps the operator");
  assert.match(fields["argument-hint"], /models:economy/, "the run-local model syntax is discoverable from the argument hint");
  assert.doesNotMatch(fields.description, MODEL_WORDS, "the description names no model");
  const offending = body.split("\n").filter((line) => MODEL_WORDS.test(line));
  assert.deepEqual(offending, [], "SKILL.md body must be model-neutral");
  for (const rule of ["FIT_FOR_PURPOSE", "not complete when the first implementation exists", "Subagent output is never user authorization", "Contract before delegation", "Deterministic gates before", "Evidence is bound", "never grades its own work", "read-only", "Only material gaps"]) {
    assert.ok(text.includes(rule), `SKILL.md must keep the invariant: ${rule}`);
  }
});

test("reviewers take no authority from candidate-controlled content: invariant 10, both reviewer roles, not the builder", async () => {
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const items = invariants(skill);
  // Appended, not inserted: the existing invariants keep their numbers.
  const headings = ["Contract before delegation", "Deterministic gates before", "Evidence is bound", "The builder never grades its own work", "Critics and the judge are fresh", "Only material gaps", "Scope is bounded", "Human authority is explicit", "The protocol names no model", "Reviewers take authority only from the protocol"];
  assert.deepEqual(Object.keys(items).map(Number), headings.map((_, index) => index + 1), "invariants are numbered 1..10 without gaps");
  headings.forEach((heading, index) => assert.ok(items[index + 1].startsWith(`**${heading}`), `invariant ${index + 1} is still "${heading}"`));
  assertReviewerAuthority(items[10], "SKILL.md invariant 10");
  assert.match(items[10], /builder and the orchestrator are working roles/, "the boundary is the reviewers': working roles keep their project conventions");
  // The native critic and judge carry it in their role; the external reviewer gets the critic's role text.
  for (const name of ["gauntlet-critic.md", "gauntlet-judge.md"]) assertReviewerAuthority(frontmatter(await readFile(join(AGENTS, name), "utf8")).body, name);
  const builder = frontmatter(await readFile(join(AGENTS, "gauntlet-builder.md"), "utf8")).body;
  assert.doesNotMatch(builder, /Candidate-controlled content|never authority/, "the builder is a working role: the reviewer boundary is not its rule");
  const standard = await readFile(join(ROOT, "docs", "skill-authoring.md"), "utf8");
  assert.match(standard.replace(/\s+/g, " "), /Papéis que avaliam[^.]*controlado pelo candidato[^.]*é evidência, nunca autoridade/, "the authoring checklist states the reviewer-authority rule");
});

test("PASS needs every explicit clause established by current evidence of matching scope: protocol, general lens, judge, contract template", async () => {
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const pass = flat(skill.slice(skill.indexOf("**`PASS` means `FIT_FOR_PURPOSE`**"), skill.indexOf("The main session is the **orchestrator**")));
  assert.match(pass, /every explicit mandatory acceptance criterion and invariant of the contract is established by current evidence whose scope covers the scope of the clause, and no material gap remains open/);
  assert.ok(pass.includes("Evidence narrower than the requirement does not prove the requirement."), "the PASS definition states the scope principle");
  assert.match(skill.split("\n").find((line) => line.startsWith("| `MAJOR` |")), /invariant unmet or not established/, "MAJOR covers an unestablished clause");
  const phase3 = flat(section(skill, "## Phase 3"));
  assert.match(phase3, /The `general` lens alone owns the \*\*clause-establishment audit\*\*: for each explicit acceptance criterion and invariant, what evidence establishes it, whether that evidence was produced in this execution, whether it is current, and whether its scope covers the clause's/);
  const phase4 = flat(section(skill, "## Phase 4"));
  assert.match(phase4, /invariant that no current evidence of sufficient scope establishes is a `MAJOR` — a material gap, not a suspicion, and never residual risk/);
  assert.match(phase4, /cannot be evaluated at all with the environment and evidence available is a `BLOCKER`/);
  assert.match(phase4, /only a human can verify belongs under Human gates, only there; it is never a `MAJOR` or `BLOCKER` because automation cannot prove it/);
  assert.match(phase4, /On a tier without required critics, the orchestrator points to the evidence that establishes each clause[^.]*a clause it cannot point to evidence for is a real uncertainty after the gates, and one fresh `general` critic runs/);
  // The final report's lines (inside its code block).
  assert.match(skill.split("\n").find((line) => line.startsWith("## Contract ")), /each explicit AC\/INV .* with the evidence that establishes it/);
  assert.match(skill.split("\n").find((line) => line.startsWith("## Residual risk ")), /outside the explicit AC\/INV clauses.*never residual risk/);

  const protocol = await readFile(join(SKILL, "references", "critic-protocol.md"), "utf8");
  assert.match(flat(section(protocol, "## Result format")), /invariant that current evidence of sufficient scope does not establish is not a suspicion: it is material — `MAJOR`, or `BLOCKER` when it cannot be evaluated at all/);
  const general = section(protocol, "### `general`");
  const questions = general.split("\n").filter((line) => /^\d\. /.test(line));
  assert.deepEqual(questions.map((line) => line.slice(0, 2)), ["1.", "2.", "3.", "4."], "four establishment questions");
  for (const [index, pattern] of [/What evidence establishes this clause/, /actually produced in this execution/, /current/, /scope cover the scope the clause states/].entries()) assert.match(questions[index], pattern);
  for (const rule of ["A test name, a comment, a builder claim or a narrative assertion alone is not evidence", "A skipped test establishes nothing", "a test command that collected zero tests does not establish the behavior it names", "Evidence narrower than the requirement does not prove the requirement", "Try to establish the clause yourself first", "Several clauses unestablished for the same root cause are one gap"]) {
    assert.ok(flat(general).includes(rule), `general lens: ${rule}`);
  }
  // The general lens alone owns the audit.
  for (const lens of ["security", "data", "concurrency", "infra", "destructive", "api", "ux"]) assert.doesNotMatch(section(protocol, `### \`${lens}\``), /establish/i, `${lens} lens does not run the clause audit`);

  // The judge: an unestablished clause it cannot establish either is CONFIRMED, never UNPROVEN.
  const { validateJudgeResult } = await import("../../claude-skills/gauntlet/scripts/gauntlet.mjs");
  const judgeRole = await readFile(join(AGENTS, "gauntlet-judge.md"), "utf8");
  assert.match(flat(section(protocol, "## Judge protocol")), /A finding that an explicit contract clause is \*\*not established\*\* is `CONFIRMED` unless the judge itself establishes that clause with current evidence of sufficient scope; it is `REFUTED` only when the judge does, and cites that evidence\. A judge that cannot establish the clause either confirms the finding — that is never `UNPROVEN`\. `UNPROVEN` is for a claimed defect/);
  assert.match(flat(judgeRole), /not established\*\* is `CONFIRMED` unless you establish that clause yourself[^.]*`REFUTED`, citing that evidence\. If you cannot establish it either, the finding stands: `CONFIRMED`, never `UNPROVEN`/);
  for (const [label, text, marker] of [["critic-protocol.md", protocol, "## Judge protocol"], ["gauntlet-judge.md", judgeRole, "Output"]]) {
    const example = validateJudgeResult(jsonExample(text, marker));
    const unestablished = example.findings.find((finding) => /not established/.test(finding.evidence));
    assert.equal(unestablished?.classification, "CONFIRMED", `${label}: the example confirms an unestablished clause the judge could not establish`);
    assert.match(unestablished.evidence, /could not establish it either/, label);
    const unproven = example.findings.find((finding) => finding.classification === "UNPROVEN");
    assert.match(unproven.evidence, /^claimed defect/, `${label}: UNPROVEN is for a claimed defect`);
    assert.match(example.findings.find((finding) => finding.classification === "REFUTED").evidence, /established:/, `${label}: REFUTED cites the evidence that establishes the clause`);
  }
  const critic = flat(frontmatter(await readFile(join(AGENTS, "gauntlet-critic.md"), "utf8")).body);
  for (const rule of ["invariant is unmet or not established", "does not establish is material, not a suspicion", "Evidence narrower than the requirement does not prove the requirement", "A skipped test, a run that collected zero tests, a test name, a comment or a claim establishes nothing", "A requirement under Human gates is never a gap"]) {
    assert.ok(critic.includes(rule), `critic role: ${rule}`);
  }

  const template = await readFile(join(SKILL, "references", "contract-template.md"), "utf8");
  assert.match(template, /- AC1: <[^>]*its scope[^>]*>/, "every AC declares its scope");
  assert.match(flat(template), /A requirement only a human can verify is not an AC: it goes under Human gates, only there/);
  assert.match(flat(template), /list it only under \*\*Human gates\*\* — never duplicated as an acceptance criterion/);
});

test("completion is a protocol stop, not a text turn: the report comes from the harness's current state and names why it stopped", async () => {
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const completion = flat(section(skill, "## Completion"));
  assert.ok(completion.includes("A run is not complete when the first implementation exists."));
  for (const rule of ["Only a protocol stop ends the run.", "A progress message is not a stop;", "a summary is not a stop;", "the end of a model turn is not a stop.", "The final report is written at a protocol stop and nowhere else", "its technical verdict is the harness's current state (`verdict`, `status`), never a narrative.", "A report that ends in `GAP` names the stop condition that ended the run there."]) {
    assert.ok(completion.includes(rule), `Completion: ${rule}`);
  }
  assert.match(skill.split("\n").find((line) => line.startsWith("## Verdict ")), / — stop: <condition>$/, "the report's verdict line names the stop condition");
  const standard = flat(await readFile(join(ROOT, "docs", "skill-authoring.md"), "utf8"));
  assert.match(standard, /Mensagem de progresso, resumo e fim de turno não são parada: o relatório final sai só numa parada do protocolo, com o veredito do estado atual — nunca da narrativa\./);
});

test("self-review: the arbiter is never the candidate — invariant 4, the report, CLAUDE.md, and an export procedure that yields a working arbiter", async () => {
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  assert.match(invariants(skill)[4], /When the Gauntlet itself is the candidate, the arbiter — harness, role text, protocol and runner — comes from an immutable installation outside the candidate checkout; the session that runs the review starts from a working directory outside it too, and reaches the candidate by explicit path\./);
  assert.match(skill.split("\n").find((line) => line.startsWith("## Evidence ")), /when the Gauntlet is the candidate, the arbiter baseline \(installation path and the commit it was exported from\)/);
  const claude = flat(await readFile(join(ROOT, "CLAUDE.md"), "utf8"));
  for (const rule of ["o árbitro (harness, textos de papel, protocolo, runner) vem de uma instalação imutável fora do checkout candidato", "a sessão de validação começa num diretório neutro fora do checkout e acessa o candidato por caminho explícito", "o relatório final identifica o baseline do árbitro", "Trocar os links instalados em `~/.claude` é decisão humana"]) {
    assert.ok(claude.includes(rule), `CLAUDE.md: ${rule}`);
  }
  const procedure = section(await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8"), "## Self-review: the arbiter outside the candidate");
  for (const step of ['chmod -R a-w "$ARBITER"', '"$ARBITER/install-gauntlet.sh" --check', "neutral session root", "GAUNTLET_ROOT=<candidate>", "needs the operator's explicit words", "The final report's Evidence line names the arbiter"]) {
    assert.ok(procedure.includes(step), `adapter self-review procedure: ${step}`);
  }
  // The documented export, run on this checkout's HEAD, is a complete arbiter
  // on its own: installer, agents, skill, runner, and a harness that answers.
  const paths = procedure.match(/git -C "\$REPO" archive "\$BASE" ([^|]+)\|/)?.[1].trim().split(/\s+/);
  assert.ok(paths?.length, "the procedure exports with git archive");
  const dir = await mkdtemp(join(tmpdir(), "gauntlet-arbiter-"));
  try {
    await exec("sh", ["-c", 'git archive HEAD "$@" | tar -x -C "$0"', dir, ...paths], { cwd: ROOT });
    for (const file of ["install-gauntlet.sh", "claude-agents/gauntlet-builder.md", "claude-agents/gauntlet-critic.md", "claude-agents/gauntlet-judge.md", "claude-skills/gauntlet/SKILL.md", "claude-skills/gauntlet/scripts/codex-critic.mjs", "claude-skills/gauntlet/scripts/critic-result.schema.json"]) {
      assert.ok(existsSync(join(dir, file)), `the arbiter export carries ${file}`);
    }
    const { stdout } = await exec(process.execPath, [join(dir, "claude-skills", "gauntlet", "scripts", "gauntlet.mjs"), "version"], { cwd: dir });
    assert.match(stdout, /^gauntlet-harness \d+\.\d+\.\d+/, "the exported harness answers outside any checkout");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent descriptions state the role, the caller and the read-only boundary without a keyword catalogue", async () => {
  for (const file of await agentFiles()) {
    const { fields } = frontmatter(await readFile(join(AGENTS, file), "utf8"));
    assert.match(fields.description, /Invoked only by the \/gauntlet orchestrator/, `${file}: description must bind the agent to the orchestrator`);
    assert.ok(fields.description.length <= 400, `${file}: description should be a boundary, not a catalogue (${fields.description.length} chars)`);
    if (file !== "gauntlet-builder.md") assert.match(fields.description, /read-only/i, `${file}: reviewers advertise the read-only boundary`);
  }
});

test("the adapter documents run-local model selection coherently with the Agent tool and its own review policy", async () => {
  const adapter = await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8");
  for (const token of ["models:economy", "builder:<alias>", "critic:<alias>", "judge:<alias>", "Nothing is written anywhere", "never inspects quota"]) {
    assert.ok(adapter.includes(token), `adapter must document: ${token}`);
  }
  // The economy profile row names only valid aliases.
  const economy = adapter.split("\n").find((line) => line.startsWith("| `models:economy`"));
  assert.ok(economy, "economy profile row");
  const economyAliases = [...economy.matchAll(/`([a-z]+)`/g)].map((match) => match[1]).filter((alias) => alias !== "models:economy");
  assert.ok(economyAliases.length >= 3);
  for (const alias of economyAliases) assert.ok(MODEL_ALIASES.has(alias), `economy profile uses unknown alias ${alias}`);
  // Parse the class table and check the profile against the policy it declares.
  const classOf = {};
  for (const line of adapter.split("\n")) {
    const row = line.match(/^\| (frontier|standard|small) \| (.*) \|$/);
    if (row) for (const alias of row[2].matchAll(/`([a-z]+)`/g)) if (alias[1] !== "inherit") classOf[alias[1]] = row[1];
  }
  assert.deepEqual(Object.keys(classOf).sort(), ["fable", "haiku", "opus", "sonnet"], "every Agent-tool alias has a class");
  const rank = { small: 0, standard: 1, frontier: 2 };
  const [builderAlias, criticAlias, judgeAlias] = economyAliases;
  assert.ok(rank[classOf[criticAlias]] >= rank[classOf[builderAlias]], "economy critic must not be weaker than its builder");
  assert.ok(rank[classOf[judgeAlias]] >= rank[classOf[criticAlias]], "economy judge must not be weaker than its critic");
  assert.equal(classOf.fable, classOf.opus, "fable and opus are peers: no artificial hierarchy");
  assert.match(adapter, /CRITICAL.*tier.*refused|refused.*CRITICAL/s, "CRITICAL tier refuses sub-frontier overrides");
  // Neither the harness nor the protocol knows about the tokens.
  const harness = await readFile(join(SKILL, "scripts", "gauntlet.mjs"), "utf8");
  assert.doesNotMatch(harness, /models:economy|\b(builder|critic|judge):(haiku|sonnet|opus|fable|inherit|<)/);
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  assert.ok(skill.includes("adapter-claude-code.md"), "SKILL.md routes model tokens to the adapter");
});

test("the skill-authoring standard exists and CLAUDE.md points to it", async () => {
  const standard = await readFile(join(ROOT, "docs", "skill-authoring.md"), "utf8");
  for (const principle of ["Invariante de protocolo", "Andaime", "progressive disclosure", "adaptador", "Semântica de conclusão"]) {
    assert.ok(standard.toLowerCase().includes(principle.toLowerCase()), `docs/skill-authoring.md must cover: ${principle}`);
  }
  assert.ok(standard.split("\n").length < 120, "the standard stays concise");
  assert.match(await readFile(join(ROOT, "CLAUDE.md"), "utf8"), /docs\/skill-authoring\.md/);
});

test("the harness is model-neutral and has no dependencies", async () => {
  const text = await readFile(join(SKILL, "scripts", "gauntlet.mjs"), "utf8");
  assert.deepEqual(text.split("\n").filter((line) => MODEL_WORDS.test(line)), []);
  const imports = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every((specifier) => specifier.startsWith("node:")), `only node: builtins allowed, got ${imports}`);
});

test("SKILL.md references every reference file and every agent; nothing is orphaned", async () => {
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const references = (await readdir(join(SKILL, "references"))).filter((name) => name.endsWith(".md")).sort();
  assert.ok(references.length >= 5);
  const allReferenceText = (await Promise.all(references.map((name) => readFile(join(SKILL, "references", name), "utf8")))).join("\n");
  for (const name of references) {
    assert.ok(skill.includes(`references/${name}`) || allReferenceText.includes(`](${name})`) || allReferenceText.includes(`references/${name}`), `${name} is not linked from SKILL.md or another reference`);
  }
  for (const link of skill.matchAll(/\]\(references\/([a-z0-9-]+\.md)\)/g)) {
    assert.ok(references.includes(link[1]), `SKILL.md links to missing reference ${link[1]}`);
  }
  const agents = (await agentFiles()).map((name) => name.replace(/\.md$/, ""));
  for (const agent of agents) assert.ok(skill.includes(`\`${agent}\``), `SKILL.md must name ${agent}`);
  for (const mention of skill.matchAll(/`(gauntlet-[a-z-]+)`/g)) {
    assert.ok(agents.includes(mention[1]), `SKILL.md mentions unknown agent ${mention[1]}`);
  }
  const adapter = await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8");
  for (const agent of agents) assert.ok(adapter.includes(agent), `adapter must map ${agent}`);
});

test("the adapter table matches the agent frontmatter", async () => {
  const adapter = await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8");
  for (const file of await agentFiles()) {
    const { fields } = frontmatter(await readFile(join(AGENTS, file), "utf8"));
    const row = adapter.split("\n").find((line) => line.startsWith(`| \`${fields.name}\``));
    assert.ok(row, `adapter has no policy row for ${fields.name}`);
    assert.ok(row.includes(`\`${fields.model}\``), `${fields.name}: adapter says a different model than the frontmatter (${fields.model})`);
    if (fields.effort) assert.ok(row.includes(`\`${fields.effort}\``), `${fields.name}: adapter effort differs from frontmatter`);
  }
});

test("the installer reads model/effort from frontmatter instead of hardcoding it", async () => {
  const installer = await readFile(join(ROOT, "install-gauntlet.sh"), "utf8");
  assert.doesNotMatch(installer, /Sonnet|Opus|Haiku|XHigh/i);
  assert.match(installer, /frontmatter_field/);
  assert.match(installer, /--uninstall/);
  assert.match(installer, /--check/);
  assert.match(installer, /verify_harness/, "the installer must prove the harness answers through the installed link");
});

test("references agree with the harness on the evidence identity and the git requirement", async () => {
  const harnessDoc = await readFile(join(SKILL, "references", "harness.md"), "utf8");
  const harness = await readFile(join(SKILL, "scripts", "gauntlet.mjs"), "utf8");
  for (const token of ["evidenceDigest", "specDigest", "contractDigest", "leftoverOutcome", "cleanupIncomplete", "GAUNTLET_LEFTOVER_GRACE_MS", "GAUNTLET_GATE_TIMEOUT_S", "GAUNTLET_MIN_FREE_BYTES", "GAUNTLET_RUNS_WARNING"]) {
    assert.ok(harness.includes(token), `harness implements ${token}`);
    assert.ok(harnessDoc.includes(token), `harness.md documents ${token}`);
  }
  assert.match(harnessDoc, /Git is required/);
  assert.match(harness, /needs a git work tree/);
  assert.doesNotMatch(harnessDoc, /Outside a git repository the harness still works/);
  const version = harness.match(/export const VERSION = "([^"]+)"/)[1];
  const skill = frontmatter(await readFile(join(SKILL, "SKILL.md"), "utf8"));
  assert.ok(skill.body.includes(`version: ${version}`) || (await readFile(join(SKILL, "SKILL.md"), "utf8")).includes(`version: ${version}`), "SKILL.md metadata version matches the harness version");
});

test("repository documentation refers to the current agents only", async () => {
  for (const doc of ["README.md", "SKILLS.md", "CLAUDE.md", "WORKFLOW.md"]) {
    const text = await readFile(join(ROOT, doc), "utf8");
    assert.equal(/gauntlet-critic-[ab]\b/.test(text), false, `${doc} still mentions the removed critic-a/critic-b agents`);
    assert.equal(/Sonnet XHigh|Opus Max/.test(text), false, `${doc} hardcodes a model/effort pairing that belongs to the agent frontmatter`);
  }
  // The catalogue names the release the harness reports.
  const { VERSION } = await import("../../claude-skills/gauntlet/scripts/gauntlet.mjs");
  const release = `v${VERSION.split(".").slice(0, 2).join(".")}`;
  for (const doc of ["README.md", "SKILLS.md"]) {
    const entry = (await readFile(join(ROOT, doc), "utf8")).split("\n").find((line) => /`gauntlet`|guiado por evidencia/.test(line) && /\bv\d+\.\d+\b/.test(line));
    assert.ok(entry?.includes(release), `${doc} names Gauntlet ${release} (harness ${VERSION}): ${entry}`);
  }
  const skills = await readFile(join(ROOT, "SKILLS.md"), "utf8");
  for (const agent of await agentFiles()) assert.ok(skills.includes(agent.replace(/\.md$/, "")), `SKILLS.md must list ${agent}`);
  assert.match(skills, /uninstall/i, "SKILLS.md must mention how to uninstall");
});

test("the external reviewer lives only in the adapter, and the adapter documents it coherently with its runner", async () => {
  const adapter = await readFile(join(SKILL, "references", "adapter-claude-code.md"), "utf8");
  for (const token of ["external:<lens>", "external-model:<slug>", "external-effort:<level>", "takes the slot", "gauntlet-critic:fallback", "never silent", "leaves the"]) {
    assert.ok(adapter.includes(token), `adapter must document: ${token}`);
  }
  // The default external model is classed, and frontier (usable on every tier).
  const defaults = adapter.split("\n").find((line) => line.startsWith("| `external-model:<slug>`"));
  const model = defaults?.match(/default `([^`]+)`/)?.[1];
  assert.ok(model, "the external-model row names its default");
  const effort = adapter.split("\n").find((line) => line.startsWith("| `external-effort:<level>`"))?.match(/default `([^`]+)`/)?.[1];
  assert.ok(effort, "the external-effort row names its default");
  const classRow = adapter.split("\n").find((line) => line.startsWith(`| \`${model}\` |`));
  assert.ok(classRow, `the default external model ${model} has a class row`);
  assert.match(classRow, /\| frontier \|$/);
  assert.ok(adapter.includes(`--model ${model} --effort ${effort}`), "the documented invocation uses the documented defaults");
  // Every isolation flag the runner passes is documented, and none that would weaken it exists in it.
  const { reviewerArgs } = await import("../../claude-skills/gauntlet/scripts/codex-critic.mjs");
  const args = reviewerArgs({ model, effort, workdir: "/w", schema: "/s" });
  assert.ok(adapter.includes("DISABLED_FEATURES") && adapter.includes("features.<name>=false"), "adapter documents the switched-off features");
  assert.match(adapter, /on CRITICAL, no class\s+below frontier/, "the class rule says what review-policy rule 3 says");
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "read-only", 'approval_policy="never"', 'web_search="disabled"', 'shell_environment_policy.inherit="core"', "--output-schema", "--skip-git-repo-check", "project_doc_max_bytes=0", "skills.include_instructions=false"]) {
    assert.ok(args.includes(flag), `runner passes ${flag}`);
    assert.ok(adapter.includes(flag), `adapter documents ${flag}`);
  }
  // The reviewer starts in the working directory it is given, which the adapter says is the transport directory, not the candidate.
  assert.equal(args[args.indexOf("-C") + 1], "/w", "-C is the runner's working directory for the reviewer");
  assert.match(adapter.replace(/\s+/g, " "), /process cwd and its `-C` are one fresh \*transport directory\*/, "adapter documents the neutral start");
  assert.match(adapter, /\$CODEX_HOME\/AGENTS\.md/, "adapter names the operator-level instruction file the flags do not cover");
  // The fallback label the adapter prescribes is one the harness accepts.
  const { REVIEWER } = await import("../../claude-skills/gauntlet/scripts/gauntlet.mjs");
  assert.match("gauntlet-critic:fallback", REVIEWER);
  assert.match(await readFile(join(SKILL, "SKILL.md"), "utf8"), /replaced at once by a native critic/, "the protocol states the automatic, visible fallback");
  // Neither the protocol nor the harness knows which external CLI exists.
  const skill = await readFile(join(SKILL, "SKILL.md"), "utf8");
  const harness = await readFile(join(SKILL, "scripts", "gauntlet.mjs"), "utf8");
  assert.doesNotMatch(skill, /codex/i, "SKILL.md names no external CLI");
  assert.doesNotMatch(harness, /codex/i, "the harness names no external CLI");
  assert.match(skill, /external reviewer/, "the protocol states the external-reviewer rule");
});
