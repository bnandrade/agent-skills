#!/usr/bin/env node
// Gauntlet v2 — lightweight, repo-agnostic harness.
//
// Persists the evidence and the state of one Gauntlet run under
// <repo>/.gauntlet/runs/<run-id>/ and enforces the protocol invariants that
// must not depend on an LLM's discipline:
//
//   - hard gates run in order and stop at the first failure;
//   - a critic result is only accepted for a tree whose gates all passed;
//   - review evidence (critic, judge) is bound to an evidence identity —
//     candidate tree + contract + the concrete gate execution on record — and
//     a verdict only counts evidence recorded for the current identity;
//   - a run blocked on a human decision stays blocked until that decision is recorded;
//   - correction rounds require a material gap and respect the budget;
//   - convergence (IMPROVING / STAGNATING / REGRESSING) is derived, not narrated.
//
// Zero dependencies. Node >= 20. Model- and provider-neutral. Requires a git
// work tree: without one there is no candidate identity to bind evidence to.

import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { copyFile, link, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, stat, statfs, writeFile, appendFile } from "node:fs/promises";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "2.5.0";
export const SCHEMA_VERSION = 3;
// Semantics of the evidence records (what the tree digest covers, what the
// patch shows, how failures carry within a round). A record of another format
// is never reused and never current: the same VERSION string can span several
// builds, so the records say which rules produced them.
export const EVIDENCE_FORMAT = 1;


export const STATUSES = ["PLANNED", "BUILDING", "VERIFYING", "CRITIQUE", "GAP", "REGRESSION", "STAGNATING", "BLOCKED", "PASS"];
export const MANUAL_STATUSES = ["PLANNED", "BUILDING", "VERIFYING"];
export const SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "POLISH"];
export const MATERIAL = new Set(["BLOCKER", "CRITICAL", "MAJOR"]);
export const CLASSIFICATIONS = ["CONFIRMED", "REFUTED", "UNPROVEN"];
export const TIERS = {
  LIGHT: { criticsRequired: 0, judgeRequired: false, budget: 1 },
  STANDARD: { criticsRequired: 1, judgeRequired: false, budget: 2 },
  ELEVATED: { criticsRequired: 2, judgeRequired: false, budget: 2 },
  CRITICAL: { criticsRequired: 2, judgeRequired: true, budget: 2 }
};
const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const MAX_GATE_LOG_BYTES = 8 * 1024 * 1024;
const LEFTOVER_KILL_WAIT_MS = 1000;
// setTimeout cannot represent more than this; a larger delay would fire at once.
const MAX_TIMER_MS = 2 ** 31 - 1;

// ---------------------------------------------------------------- utilities

export class UsageError extends Error {}

// Numeric knobs from the environment. An unset or empty variable takes the
// default; anything else must be a finite number within range, otherwise the
// command refuses before touching any state ("Infinity", "abc" or "-1" would
// silently disable a governor or a timeout).
export function envNumber(name, fallback, { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  const kind = integer ? "an integer" : "a finite number";
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new UsageError(`${name}=${JSON.stringify(raw)} is invalid: expected ${kind} between ${min} and ${max}`);
  }
  return value;
}

// Test-only seam (see haltIfRequested): anything but its two stages is refused
// before any state is touched, like every other GAUNTLET_* knob.
function testHaltStage(env) {
  const raw = env.GAUNTLET_TEST_HALT;
  if (raw === undefined || raw === "") return null;
  if (raw !== "after-evidence" && raw !== "after-record") throw new UsageError(`GAUNTLET_TEST_HALT=${JSON.stringify(raw)} is invalid: a test-only seam that accepts after-evidence or after-record`);
  return raw;
}

// Test-only seam: behave as a host whose /proc cannot be enumerated (macOS,
// BSD), so the fallback paths can be exercised on Linux. "1" or unset.
function testNoProc(env) {
  const raw = env.GAUNTLET_TEST_NO_PROC;
  if (raw === undefined || raw === "") return false;
  if (raw !== "1") throw new UsageError(`GAUNTLET_TEST_NO_PROC=${JSON.stringify(raw)} is invalid: a test-only seam that accepts 1`);
  return true;
}

export function readConfig(env = process.env) {
  return {
    minFreeBytes: envNumber("GAUNTLET_MIN_FREE_BYTES", 512 * 1024 * 1024, { integer: true }, env),
    runsWarning: envNumber("GAUNTLET_RUNS_WARNING", 5, { integer: true }, env),
    gateTimeoutS: envNumber("GAUNTLET_GATE_TIMEOUT_S", 1800, { max: Math.floor(MAX_TIMER_MS / 1000) }, env),
    leftoverGraceMs: envNumber("GAUNTLET_LEFTOVER_GRACE_MS", 2000, { integer: true, max: MAX_TIMER_MS }, env),
    gitTimeoutS: envNumber("GAUNTLET_GIT_TIMEOUT_S", 600, { max: Math.floor(MAX_TIMER_MS / 1000) }, env),
    testHalt: testHaltStage(env),
    testNoProc: testNoProc(env)
  };
}

let CONFIG = null;
function config() {
  if (!CONFIG) CONFIG = readConfig();
  return CONFIG;
}

// A numeric CLI flag: the value must be present, non-blank and a finite number
// in range. Number("") is 0 and would silently disable a timeout or a budget.
function numberFlag(name, raw, { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new UsageError(`--${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function assertId(value, label = "run id") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value ?? "")) {
    throw new UsageError(`${label} must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}`);
  }
  return value;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

// Atomic and durable: the content is fsynced before the rename, and the
// directory after it, so neither a crash nor a power loss can leave a
// truncated file or a rename that was never persisted. Every evidence
// artifact goes through here — JSON records, gate logs and diff.patch — so
// that when gates.json is committed the bytes its digests describe are
// already on durable storage (a log reaching the disk after the record that
// names it would let a committed record point at stale or missing evidence).
export async function writeDurable(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, "w");
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  try { const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); } } catch {}
}

async function writeJson(path, value) {
  await writeDurable(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Test seam for the persistence boundary of `gates`: when GAUNTLET_TEST_HALT
// names a stage, the process is SIGKILLed there — no handler, no flush, the
// closest deterministic stand-in for a power loss. Unset in production.
function haltIfRequested(stage) {
  if (config().testHalt === stage) process.kill(process.pid, "SIGKILL");
}

async function readInput(source) {
  if (source === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(source, "utf8");
}

// Every harness git call runs in a controlled environment. Inherited GIT_*
// variables are dropped (GIT_DIR/GIT_WORK_TREE exported to hooks,
// GIT_INDEX_FILE, GIT_CONFIG_* injected configuration), fsmonitor and the
// untracked cache are off (a hook or a cache must not decide what changed,
// and a hanging fsmonitor hook would block every command), and replace refs
// are ignored. Configuration from GIT_CONFIG_COUNT has command-line priority.
const GIT_ENV = Object.freeze({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "core.untrackedCache", GIT_CONFIG_VALUE_1: "false"
});

function gitName(args) {
  return args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "-c") ?? args[0];
}

function gitTimeout(args) {
  return new UsageError(`git ${gitName(args)} did not finish within ${config().gitTimeoutS} s — a clean/process filter, a hook or a lock is blocking it (GAUNTLET_GIT_TIMEOUT_S)`);
}

// Process groups of the git commands in flight: an interrupt of the harness
// kills them too (they run detached, so a Ctrl-C does not reach them).
const activeGitGroups = new Set();

// Small git queries, bounded by GAUNTLET_GIT_TIMEOUT_S. Throws on failure — a
// git error must never be mistaken for "no changes" — as a refusal (exit 2)
// with git's own message, not as a crash.
async function git(root, args, env = GIT_ENV) {
  const chunks = [];
  let size = 0;
  await streamGit(root, args, (chunk) => {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new UsageError(`git ${gitName(args)} produced more than 64 MiB`);
    chunks.push(chunk);
  }, [0], env);
  return Buffer.concat(chunks).toString("utf8");
}

// Streams a git command's stdout into `sink(chunk)`, bounded by
// GAUNTLET_GIT_TIMEOUT_S. git runs in its own process group: a clean filter or
// a hook it starts inherits the pipes, so killing git alone would leave them
// open and the harness waiting — on timeout the whole group is killed and the
// command is refused at once. Resolves with the exit code and stderr; never
// buffers the whole output.
function streamGit(root, args, sink, okCodes = [0], env = GIT_ENV) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    if (child.pid) activeGitGroups.add(child.pid);
    let stderr = "";
    let done = false;
    const finish = (settle) => { if (done) return; done = true; clearTimeout(timer); activeGitGroups.delete(child.pid); settle(); };
    const limitMs = config().gitTimeoutS * 1000;
    const timer = limitMs > 0 ? setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
      child.stdout.destroy();
      child.stderr.destroy();
      finish(() => reject(gitTimeout(args)));
    }, limitMs) : null;
    child.stderr.on("data", (chunk) => { if (stderr.length < 4096) stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      try { sink(chunk); } catch (error) { try { process.kill(-child.pid, "SIGKILL"); } catch {} finish(() => reject(error)); }
    });
    child.on("error", (error) => finish(() => reject(new UsageError(`git could not be started: ${error.message}`))));
    child.on("close", (code) => finish(() => {
      if (okCodes.includes(code)) resolvePromise({ code, stderr });
      else reject(new UsageError(`git ${gitName(args)} exited ${code}: ${stderr.trim()}`));
    }));
  });
}

// The repository root: the git work-tree top level of the current directory,
// or GAUNTLET_ROOT. A git work tree is required — the candidate identity is
// derived from it — and GAUNTLET_ROOT must be that top level, not a
// subdirectory, otherwise changes outside it would escape the digest.
export async function repoRoot(cwd = process.cwd()) {
  const requested = process.env.GAUNTLET_ROOT ? resolve(process.env.GAUNTLET_ROOT) : resolve(cwd);
  let top;
  try { top = (await git(requested, ["rev-parse", "--show-toplevel"])).trim(); } catch { top = ""; }
  if (!top) {
    const inherited = ["GIT_DIR", "GIT_WORK_TREE"].filter((name) => process.env[name]);
    throw new UsageError(`Gauntlet needs a git work tree: ${requested} is not inside one. Evidence is bound to the candidate tree, so there is no supported mode without git — run "git init" first.${inherited.length ? ` (${inherited.join("/")} is set and ignored: the harness only works in an ordinary work tree with its own .git, not a repository reached through those variables)` : ""}`);
  }
  if (process.env.GAUNTLET_ROOT && (await realpath(requested)) !== (await realpath(top))) {
    throw new UsageError(`GAUNTLET_ROOT must be the git work-tree top level (${top}), not a subdirectory: changes outside it would escape the candidate digest`);
  }
  return process.env.GAUNTLET_ROOT ? requested : top;
}

// The empty tree of the repository's own object format (SHA-1 or SHA-256):
// the base of the diff while HEAD is unborn.
async function emptyTree(root) {
  return (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).trim();
}

async function headRevision(root) {
  try { return (await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).trim(); } catch { return null; }
}

function runsDir(root) { return join(root, ".gauntlet", "runs"); }
function runDir(root, id) { return join(runsDir(root), assertId(id)); }

const DIFF_PATHSPEC = ["--", ".", ":(exclude).gauntlet"];

// Paths come from git and readdir as raw bytes. One that is not valid UTF-8
// cannot be held losslessly in a string — it would decode to U+FFFD and name
// another, nonexistent path, so its bytes would silently leave the digest — so
// it is refused instead.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
function pathFromBytes(bytes) {
  try { return STRICT_UTF8.decode(bytes); } catch {
    const shown = Array.from(bytes, (byte) => (byte < 0x20 || byte > 0x7e ? `\\x${byte.toString(16).padStart(2, "0")}` : String.fromCharCode(byte))).join("");
    throw new UsageError(`Path is not valid UTF-8 and cannot be read losslessly: "${shown}" — rename it; the digest must see every candidate byte`);
  }
}

// NUL-terminated git output as raw byte records, streamed; `onRecord` keeps
// what it needs (copying it) and decodes nothing, so no error is thrown from
// inside the stream.
function nulRecords(onRecord) {
  let pending = Buffer.alloc(0);
  return {
    sink(chunk) {
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      for (let end = data.indexOf(0); end !== -1; end = data.indexOf(0, start)) { onRecord(data.subarray(start, end)); start = end + 1; }
      pending = Buffer.from(data.subarray(start));
    },
    end() { if (pending.length) onRecord(pending); }
  };
}

const STATE_PREFIX = Buffer.from(".gauntlet/");

async function untrackedFiles(root, excludeState = true) {
  const raw = [];
  const records = nulRecords((record) => { if (record.length && !(excludeState && record.subarray(0, STATE_PREFIX.length).equals(STATE_PREFIX))) raw.push(Buffer.from(record)); });
  const { stderr } = await streamGit(root, ["ls-files", "--others", "--exclude-standard", "-z"], records.sink);
  records.end();
  // git skips a directory it cannot open with only a warning: its contents
  // would silently leave the digest and the patch.
  const blocked = stderr.match(/could not open directory '([^']*)'/);
  if (blocked) throw new UsageError(`Cannot read ${blocked[1]} (git: could not open directory): the digest must cover every candidate byte — fix its permissions, ignore it (.gitignore) or remove it`);
  return raw.map(pathFromBytes);
}

// Directory entries by raw name, strictly decoded. A `.git` entry that makes
// the directory a nested work tree is left out (its HEAD is bound instead, see
// hashEntry); any other `.git` — a stray file or a broken directory — is an
// ordinary entry.
async function walkNames(path) {
  const names = (await readdir(path, { encoding: "buffer" })).map(pathFromBytes).sort();
  const nested = names.includes(".git") && (await isWorkTreeTop(path));
  return { names: nested ? names.filter((name) => name !== ".git") : names, nested };
}

// A candidate entry the harness cannot read (permissions) would otherwise be
// hashed as a fixed placeholder whose bytes could change unseen: refused.
function unreadable(relPath, error) {
  return new UsageError(`Cannot read ${relPath} (${error.code ?? error.message}): the digest must cover every candidate byte — fix its permissions, ignore it (.gitignore) or remove it`);
}

// Digest of the candidate. Nothing is taken from `git diff` or from git's
// change detection: textconv, filters, EOL normalization, core.fileMode,
// index flags, fsmonitor, the stat cache and presentation settings can all
// make different bytes look alike. See hashWorkTree.
export async function treeDigest(root) {
  await assertStateUntracked(root);
  const hash = createHash("sha256");
  await hashWorkTree(hash, root, DIFF_PATHSPEC, true);
  return hash.digest("hex");
}

// `.gauntlet/` is the harness's namespace and is excluded from the digest, so
// a project file tracked there would change without changing the candidate
// identity. Checked on every digest, so a later `git add -f` is caught too.
async function assertStateUntracked(root) {
  const tracked = (await git(root, ["ls-files", "-z", "--", ".gauntlet"])).split("\0").filter(Boolean);
  if (tracked.length) {
    throw new UsageError(`The repository tracks ${tracked.length} path(s) under .gauntlet/ (e.g. ${tracked[0]}). .gauntlet/ is reserved for harness state and excluded from the candidate digest, so edits there would be invisible to the evidence — move them out of .gauntlet/ or untrack them (git rm --cached -r .gauntlet) first`);
  }
}

// One work tree into the digest: the HEAD revision, then every tracked path
// (the index's path set, content from the working tree) and every untracked,
// non-ignored entry, each as a fixed-size sub-digest of its raw bytes and
// full mode — fixed-size records cannot be forged by one file's content
// carrying the next record's framing — computed with bounded concurrency and
// folded in order. Every gitlink is visited: a checked-out submodule is hashed
// recursively the same way; anything else at that path (an ordinary directory
// git no longer looks into, a file) is walked like an untracked entry.
async function hashWorkTree(hash, dir, pathspec, excludeState) {
  const head = await headRevision(dir);
  hash.update(`head:${head ?? "unborn"}\0`);
  const { files, gitlinks } = await trackedEntries(dir, pathspec);
  const entries = [...files.map((path) => ["tracked", path]), ...(await untrackedFiles(dir, excludeState)).sort().map((path) => ["untracked", path])];
  // A tracked path beneath a directory that is now a symlink is absent, as it
  // is for git (the link itself is an untracked entry): never read through it.
  const linkedParents = new Map();
  for (const digest of await mapLimit(entries, 16, async ([kind, path]) => (kind === "tracked" && (await beyondSymlink(dir, path, linkedParents)) ? missingDigest(kind, path) : entryDigest(dir, path, kind)))) hash.update(digest);
  for (const path of gitlinks) {
    hash.update(`\0submodule:${path}\0`);
    const subdir = join(dir, path);
    if (await isCheckedOutSubmodule(subdir)) await hashWorkTree(hash, subdir, ["--", "."], false);
    else hash.update(await entryDigest(dir, path, "gitlink"));
  }
}

// The commit a parent records for the gitlink at `path` in `tree`, or null
// when the tree has no such gitlink (a submodule added since).
async function recordedGitlink(dir, tree, path) {
  const out = await git(dir, ["ls-tree", "-z", tree, "--", path]).catch(() => "");
  const match = out.match(/^160000 commit ([0-9a-f]+)\t/);
  return match ? match[1] : null;
}

// A checked-out submodule is a real directory (lstat: a symlink to some
// checkout is a different entry, hashed as a link) that is its own work tree.
async function isCheckedOutSubmodule(path) {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isDirectory()) && (await isWorkTreeTop(path));
}

async function beyondSymlink(root, relPath, cache) {
  const parts = relPath.split("/");
  let prefix = "";
  for (const part of parts.slice(0, -1)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (!cache.has(prefix)) cache.set(prefix, lstat(join(root, prefix)).then((info) => info.isSymbolicLink(), () => false));
    if (await cache.get(prefix)) return true;
  }
  return false;
}

function missingDigest(kind, relPath) {
  return createHash("sha256").update(`${kind}\0${relPath}\0missing`).digest();
}

// `fn` over `items` with at most `limit` in flight; results in input order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await fn(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Every index entry by raw path, regular entries and gitlinks (mode 160000)
// apart; an unmerged path (one entry per stage) is kept once. Streamed.
async function trackedEntries(dir, pathspec) {
  const files = new Map();
  const gitlinks = new Map();
  const records = nulRecords((record) => {
    const tab = record.indexOf(0x09);
    if (tab < 0) return;
    const path = record.subarray(tab + 1);
    (record.subarray(0, 6).toString("latin1") === "160000" ? gitlinks : files).set(path.toString("latin1"), Buffer.from(path));
  });
  await streamGit(dir, ["ls-files", "-s", "-z", ...pathspec], records.sink);
  records.end();
  const decode = (entries) => [...entries.values()].map(pathFromBytes).sort();
  return { files: decode(files), gitlinks: decode(gitlinks) };
}

// Tracked paths whose working-tree changes `git diff` does not report:
// assume-unchanged (lowercase tag in `ls-files -v`) and skip-worktree ("S").
// Their working-tree bytes are hashed directly. Streamed: the listing covers
// every tracked path.
async function indexFlaggedPaths(dir, pathspec) {
  const entries = [];
  const records = nulRecords((record) => {
    const tag = record[0];
    if (tag === 0x53 || (tag >= 0x61 && tag <= 0x7a)) entries.push({ bytes: Buffer.from(record.subarray(2)), skipWorktree: tag === 0x53 || tag === 0x73 }); // "S" or lowercase ("s": both flags)
  });
  await streamGit(dir, ["ls-files", "-v", "-z", ...pathspec], records.sink);
  records.end();
  return entries.map(({ bytes, skipWorktree }) => ({ path: pathFromBytes(bytes), skipWorktree })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// A throwaway copy of the index with those flags cleared on the flagged paths
// that belong to the candidate — every assume-unchanged path, and skip-worktree
// paths present in the work tree (an absent one is the normal sparse-checkout
// state). `git diff` against it reports them like any other change, so
// diff.patch and changedFiles carry the bytes the digest hashes. null when
// nothing applies; the real index is never touched.
async function candidateIndex(root, pathspec = DIFF_PATHSPEC) {
  const paths = [];
  for (const entry of await indexFlaggedPaths(root, pathspec)) {
    if (!entry.skipWorktree || (await lstat(join(root, entry.path)).then(() => true, () => false))) paths.push(entry.path);
  }
  if (!paths.length) return null;
  const scratch = await mkdtemp(join(tmpdir(), "gauntlet-index-"));
  try {
    const copy = join(scratch, "index");
    await copyFile(resolve(root, (await git(root, ["rev-parse", "--git-path", "index"])).trim()), copy);
    const env = { ...GIT_ENV, GIT_INDEX_FILE: copy };
    // One invocation per flag: update-index applies only the first flag
    // operation it is given to each path.
    for (const flag of ["--no-assume-unchanged", "--no-skip-worktree"]) {
      const args = ["update-index", flag, "-z", "--stdin"];
      await new Promise((resolvePromise, reject) => {
        const child = execFile("git", args, { cwd: root, env, detached: true }, (error, _stdout, stderr) => {
          clearTimeout(timer);
          activeGitGroups.delete(child.pid);
          if (!error) resolvePromise();
          else reject(timedOut ? gitTimeout(args) : new UsageError(`git update-index failed: ${String(stderr || error.message).trim()}`));
        });
        if (child.pid) activeGitGroups.add(child.pid);
        let timedOut = false;
        const limitMs = config().gitTimeoutS * 1000;
        const timer = limitMs > 0 ? setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, limitMs) : null;
        child.stdin.end(Buffer.from(`${paths.join("\0")}\0`));
      });
    }
    return { env, dispose: () => rm(scratch, { recursive: true, force: true }) };
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

async function isWorkTreeTop(dir) {
  try { return (await realpath((await git(dir, ["rev-parse", "--show-toplevel"])).trim())) === (await realpath(dir)); } catch { return false; }
}

async function entryDigest(root, relPath, kind) {
  const hash = createHash("sha256");
  hash.update(`${kind}\0${relPath}\0`);
  await hashEntry(hash, root, relPath);
  return hash.digest();
}

// One entry's bytes, by what lstat says it is (never by git's index mode):
// regular files by full mode (setuid/setgid/sticky included) and content,
// symlinks by target, FIFOs/sockets/devices by type, mode and device number
// (never opened: a FIFO without a writer blocks the open outside any timeout),
// directories by mode and each child's own sub-digest; a nested work tree
// binds its HEAD instead of its .git. Content and targets come last in their
// record, so nothing can follow them. A path that no longer exists is hashed
// as missing; anything unreadable is refused.
async function hashEntry(hash, root, relPath) {
  const path = join(root, relPath);
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") { hash.update("missing"); return; }
    throw unreadable(relPath, error);
  }
  const mode = (info.mode & 0o7777).toString(8);
  if (info.isSymbolicLink()) {
    let target;
    try { target = await readlink(path, { encoding: "buffer" }); } catch (error) { throw unreadable(relPath, error); }
    hash.update("symlink\0");
    hash.update(target);
    return;
  }
  if (info.isDirectory()) {
    let walk;
    try { walk = await walkNames(path); } catch (error) { throw error instanceof UsageError ? error : unreadable(relPath, error); }
    hash.update(`dir\0${mode}\0`);
    if (walk.nested) hash.update(`nested-head\0${(await headRevision(path)) ?? "unborn"}\0`);
    for (const name of walk.names) hash.update(await entryDigest(root, join(relPath, name), "child"));
    return;
  }
  if (!info.isFile()) {
    const type = info.isFIFO() ? "fifo" : info.isSocket() ? "socket" : info.isCharacterDevice() ? "char" : info.isBlockDevice() ? "block" : "other";
    hash.update(`special\0${type}\0${mode}\0${info.rdev}`);
    return;
  }
  hash.update(`file\0${mode}\0`);
  // O_NONBLOCK + O_NOFOLLOW and an fstat re-check: an entry swapped for a FIFO
  // or a link after the lstat above can neither block the open nor be read.
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile()) { hash.update("<not a regular file>"); return; }
    if (opened.size <= 1 << 20) hash.update(await handle.readFile()); // small: one read, no stream machinery
    else for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") { hash.update("<vanished>"); return; }
    throw unreadable(relPath, error);
  } finally { await handle?.close().catch(() => {}); }
}

// The paths diff.patch shows at the top level: tracked changes (mode-only
// included, raw names), untracked entries, and files at a gitlink path that is
// not a checked-out submodule.
async function changedFiles(root, env) {
  const head = await headRevision(root);
  const raw = [];
  const records = nulRecords((record) => { if (record.length) raw.push(Buffer.from(record)); });
  await streamGit(root, ["-c", "core.fileMode=true", "diff", head ?? (await emptyTree(root)), "--name-only", "-z", "--no-renames", "--no-textconv", "--no-ext-diff", "--ignore-submodules=none", ...DIFF_PATHSPEC], records.sink, [0], env);
  records.end();
  const atGitlinks = [];
  for (const path of (await trackedEntries(root, DIFF_PATHSPEC)).gitlinks) {
    const subdir = join(root, path);
    if (!(await lstat(subdir).then(() => true, () => false)) || (await isCheckedOutSubmodule(subdir))) continue;
    for (const entry of await patchEntries(root, path)) atGitlinks.push(entry.path);
  }
  return [...new Set([...raw.map(pathFromBytes), ...(await untrackedFiles(root)), ...atGitlinks])].sort();
}

// Untracked entries as `git diff --no-index` can take them: git lists a nested
// repository as one "dir/" entry, which --no-index cannot diff against
// /dev/null, so it is walked (skipping .git) like the digest walks it; FIFOs,
// sockets and devices are named, never read (a FIFO would block the diff).
async function patchEntries(root, relPath, out = []) {
  let info;
  try { info = await lstat(join(root, relPath)); } catch { out.push({ path: relPath, special: false }); return out; }
  if (info.isDirectory()) {
    for (const name of (await walkNames(join(root, relPath))).names) await patchEntries(root, join(relPath, name), out);
  } else {
    out.push({ path: relPath, special: !info.isFile() && !info.isSymbolicLink() });
  }
  return out;
}

// One work tree into the patch, with the digest's coverage: tracked changes
// (submodule ignore settings overridden; index-flagged files through a
// throwaway index — `env` for the top level, built here for a submodule),
// untracked entries, and every changed submodule recursively. `prefix` puts a
// submodule's paths under its location so the patch reads as one tree.
async function patchWorkTree(dir, prefix, pathspec, excludeState, sink, full, env, recorded) {
  const head = await headRevision(dir);
  let base = head ?? (await emptyTree(dir));
  // A submodule is diffed against the commit its parent records, not its own
  // HEAD: a clean checkout at another commit is still a change of source. A
  // new submodule (nothing recorded) is shown whole, and so is one whose
  // recorded commit the checkout does not have (a shallow clone): diffing
  // against its own HEAD would omit every committed byte. The patch says so.
  if (recorded === null) base = await emptyTree(dir);
  else if (recorded !== undefined && recorded !== base) {
    if (await git(dir, ["cat-file", "-e", `${recorded}^{commit}`]).then(() => true, () => false)) base = recorded;
    else {
      base = await emptyTree(dir);
      sink(Buffer.from(`# submodule ${prefix.replace(/\/$/, "")}: the recorded commit ${recorded} is not in its checkout; its whole tree is shown as new\n`));
    }
  }
  const prefixes = [`--src-prefix=a/${prefix}`, `--dst-prefix=b/${prefix}`];
  const index = prefix ? await candidateIndex(dir, pathspec) : null;
  try {
    await streamGit(dir, ["-c", "core.fileMode=true", "diff", base, "--binary", "--no-color", "--no-textconv", "--no-ext-diff", "--ignore-submodules=none", ...prefixes, ...pathspec], sink, [0], index?.env ?? env);
  } finally {
    await index?.dispose();
  }
  for (const file of await untrackedFiles(dir, excludeState)) {
    for (const entry of await patchEntries(dir, file)) {
      if (full()) return;
      if (entry.special) { sink(Buffer.from(`# untracked ${prefix}${entry.path}: not a regular file or symlink, not read\n`)); continue; }
      // --no-index reports an unreadable path with exit 1, like a difference:
      // its stderr goes into the patch instead of vanishing.
      const { stderr } = await streamGit(dir, ["diff", "--no-index", "--binary", ...prefixes, "--", "/dev/null", entry.path], sink, [0, 1]);
      if (stderr.trim()) sink(Buffer.from(`# git diff --no-index ${prefix}${entry.path}: ${stderr.trim()}\n`));
    }
  }
  for (const path of (await trackedEntries(dir, pathspec)).gitlinks) {
    if (full()) return;
    const subdir = join(dir, path);
    if (!(await lstat(subdir).then(() => true, () => false))) continue; // removed: the diff above shows it
    if (await isCheckedOutSubmodule(subdir)) { await patchWorkTree(subdir, `${prefix}${path}/`, ["--", "."], false, sink, full, undefined, await recordedGitlink(dir, base, path)); continue; }
    // Not a work tree: git no longer looks inside, so its files are shown as new.
    for (const entry of await patchEntries(dir, path)) {
      if (full()) return;
      if (entry.special) { sink(Buffer.from(`# ${prefix}${entry.path} (at a gitlink path, not a work tree): not a regular file or symlink, not read\n`)); continue; }
      sink(Buffer.from(`# ${prefix}${entry.path}: at a gitlink path that is not a checked-out submodule\n`));
      await streamGit(dir, ["diff", "--no-index", "--binary", ...prefixes, "--", "/dev/null", entry.path], sink, [0, 1]);
    }
  }
}

async function writePatch(root, path, env) {
  // Bounded in memory by MAX_PATCH_BYTES; git output itself is streamed.
  const chunks = [];
  let written = 0;
  let truncated = false;
  const sink = (chunk) => {
    if (truncated) return;
    if (written + chunk.length > MAX_PATCH_BYTES) {
      chunks.push(chunk.subarray(0, MAX_PATCH_BYTES - written));
      written = MAX_PATCH_BYTES;
      truncated = true;
      return;
    }
    chunks.push(chunk);
    written += chunk.length;
  };
  await patchWorkTree(root, "", DIFF_PATHSPEC, true, sink, () => truncated, env);
  // Kept as bytes: a text diff may carry bytes that are not valid UTF-8, and
  // decoding would replace them, so the patch would stop showing the
  // candidate bytes the digest verified.
  const patch = [Buffer.concat(chunks)];
  if (truncated) patch.push(Buffer.from(`\n# patch truncated at ${MAX_PATCH_BYTES} bytes\n`));
  await writeDurable(path, Buffer.concat(patch));
}

async function excludeFromGit(root) {
  const gitDir = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  const excludePath = resolve(root, gitDir, "info", "exclude");
  await mkdir(dirname(excludePath), { recursive: true });
  const current = (await exists(excludePath)) ? await readFile(excludePath, "utf8") : "";
  if (current.split("\n").some((line) => line.trim() === ".gauntlet/" || line.trim() === ".gauntlet")) return true;
  await appendFile(excludePath, `${current.endsWith("\n") || current === "" ? "" : "\n"}.gauntlet/\n`);
  return true;
}

// ------------------------------------------------------- evidence identity
//
// Review evidence (critic, judge) is only meaningful for one exact context:
// the candidate tree that was reviewed, the contract it was reviewed against
// and the concrete gate execution (record + logs) the reviewer relied on.
// `.gauntlet/` is outside the tree digest, so a contract edit or a gate
// re-execution would otherwise leave old reviews looking current. The
// evidence digest binds the three; any change to any of them makes every
// critic/judge file recorded for the previous digest stale.

// The verification package: the ordered gates AND the effective timeout they
// ran under (explicit --timeout, or GAUNTLET_GATE_TIMEOUT_S / the default when
// absent). A stricter timeout is a different verification — the same command
// may pass under 30 s and be killed under 1 s — so it must never reuse the
// earlier result nor keep the reviews that relied on it current. Only
// harness-controlled semantics are bound; arbitrary environment is not.
export function gateSpecDigest(gates, timeoutS) {
  if (!Number.isFinite(timeoutS) || timeoutS < 0) throw new Error("gateSpecDigest needs the effective timeout in seconds");
  return sha256(JSON.stringify({ gates: gates.map((gate) => [gate.name, gate.command]), timeoutS }));
}

async function contractDigest(directory) {
  const path = join(directory, "contract.md");
  return (await exists(path)) ? sha256(await readFile(path)) : null;
}

// Identity of one concrete gate execution — the deterministic evidence
// instance the reviewers actually read. The spec says what SHOULD run; this
// says what DID run: a random execution id persisted in gates.json, the spec,
// the tree after the gates and every gate's outcome and log digest. Reuse
// keeps the record and therefore this identity; any execution — including
// `--force` on an unchanged spec, even with the same outcome — is a new
// instance that nobody has reviewed yet.
export function gateEvidenceDigest({ executionId, specDigest, tree, gates, unresolvedFailures = [] }) {
  if (!executionId || !specDigest || !tree) throw new Error("gateEvidenceDigest needs executionId, specDigest and tree");
  return sha256(JSON.stringify({ executionId, specDigest, tree, gates: gates.map((gate) => [gate.name, gate.passed, gate.skipped, gate.exitCode, gate.signal, gate.timedOut, gate.logDigest ?? null]), unresolvedFailures: uniqueSpecs(unresolvedFailures.map((entry) => failureSpec(entry, gates))) }));
}

// Review evidence identity: the candidate now, the contract now, and the gate
// execution on record. Null until all three exist.
export function evidenceDigest({ tree, contract, gateEvidence }) {
  if (!tree || !contract || !gateEvidence) return null;
  return sha256(`format:${EVIDENCE_FORMAT}\0tree:${tree}\0contract:${contract}\0gates:${gateEvidence}\0`);
}

// In-flight marker. Written atomically BEFORE the first gate of a real
// execution runs (never on reuse) and removed only after the new gates.json
// has been committed atomically. While it exists — the harness died mid-run,
// SIGKILL, power loss — no gates record is current: the logs on disk may
// belong partly to the interrupted execution, so the record that still names
// the previous execution no longer identifies the persisted package.
const IN_PROGRESS = "gates.in-progress.json";

// Current identity of the run. `spec` is reported for inspection; freshness
// is decided by `gateEvidence` (which embeds the spec) through `evidence`.
// A record is current only when it is complete: no in-flight marker, or a
// marker left behind by the very execution the record describes (the crash
// happened after the commit, before the marker was removed).
async function currentIdentity(directory, root) {
  const evidence = join(directory, "evidence");
  const stored = (await exists(join(evidence, "gates.json"))) ? await readJson(join(evidence, "gates.json")) : null;
  // An unreadable marker (truncated by a crash) still means an execution
  // started and never committed: an interruption with an unknown id, which
  // the next `gates` replaces.
  let marker = null;
  if (await exists(join(evidence, IN_PROGRESS))) {
    try { marker = await readJson(join(evidence, IN_PROGRESS)); } catch { marker = { executionId: "unknown (unreadable marker)", startedAt: "unknown", corrupt: true }; }
    if (!marker || typeof marker !== "object" || !marker.executionId) marker = { executionId: "unknown (unreadable marker)", startedAt: "unknown", corrupt: true };
  }
  const interrupted = marker && (!stored || stored.executionId !== marker.executionId) ? marker : null;
  const record = interrupted ? null : stored;
  const identity = { tree: await treeDigest(root), contract: await contractDigest(directory), spec: record?.specDigest ?? null, gateEvidence: record?.gateEvidenceDigest ?? null };
  identity.evidence = evidenceDigest(identity);
  return { record, identity, interrupted };
}

function noGatesMessage(role, interrupted) {
  if (interrupted) {
    return `${role} rejected: a gate execution (${interrupted.executionId}, started ${interrupted.startedAt}) was interrupted before its record was committed, so the persisted gate evidence is not coherent — rerun gates`;
  }
  return null;
}

function assertNoContractGap(identity, role) {
  if (!identity.contract) throw new UsageError(`${role} rejected: no contract recorded — the contract is the source of truth; record it with "contract <run-id> <file|->" first`);
}

// A gates record without a gate-evidence identity was written by an older
// harness. It cannot be reviewed, judged or adjudicated: null would equal
// null and every freshness check would pass vacuously. Rerun the gates.
function assertGateEvidence(record, role) {
  if (record && !record.gateEvidenceDigest) {
    throw new UsageError(`${role} rejected: the gates record has no gate-evidence identity (recorded by an older harness) — rerun gates so the evidence can be bound to this execution`);
  }
  if (record && record.evidenceFormat !== EVIDENCE_FORMAT) {
    throw new UsageError(`${role} rejected: the gates record was produced under evidence format ${record.evidenceFormat ?? "none"} (an older harness), not the current ${EVIDENCE_FORMAT} — rerun gates so the evidence is produced under the current rules`);
  }
}

async function resources(root) {
  const disk = await statfs(root);
  let runs = 0;
  if (await exists(runsDir(root))) {
    runs = (await readdir(runsDir(root), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
  }
  return { observedAt: new Date().toISOString(), diskAvailableBytes: disk.bavail * disk.bsize, runs };
}

export async function assertHeadroom(root) {
  const snapshot = await resources(root);
  const { minFreeBytes } = config();
  if (snapshot.diskAvailableBytes < minFreeBytes) {
    throw new UsageError(`Resource governor stopped: ${snapshot.diskAvailableBytes} bytes free at ${root}, minimum ${minFreeBytes} (GAUNTLET_MIN_FREE_BYTES)`);
  }
  return snapshot;
}

async function checkpoint(directory, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new UsageError(`Unknown status ${status}; expected one of ${STATUSES.join(", ")}`);
  const path = join(directory, "state.json");
  const previous = (await exists(path)) ? await readJson(path) : { history: [] };
  const event = { status, at: new Date().toISOString(), ...extra };
  const next = { ...previous, ...event, history: [...previous.history, event] };
  await writeJson(path, next);
  return next;
}

async function loadRun(root, id) {
  const directory = runDir(root, id);
  if (!(await exists(join(directory, "run.json")))) throw new UsageError(`Run not found: ${id}`);
  await assertPhysicalState(root, directory, "use");
  const run = await readJson(join(directory, "run.json"));
  validateRun(run, id);
  return { directory, run, state: await readJson(join(directory, "state.json")) };
}

// The fields every guard reads. A missing or mistyped one would otherwise
// fail open (a NaN critic count is never "pending").
function validateRun(run, id) {
  const problems = [];
  if (!run || typeof run !== "object" || !TIERS[run.tier]) problems.push("tier");
  for (const field of ["criticsRequired", "budget", "round"]) if (!Number.isInteger(run?.[field]) || run[field] < 0) problems.push(field);
  if (run?.lenses !== undefined && (!Array.isArray(run.lenses) || run.lenses.some((lens) => typeof lens !== "string"))) problems.push("lenses");
  if (typeof run?.judgeRequired !== "boolean") problems.push("judgeRequired");
  if (!Array.isArray(run?.humanApprovals)) problems.push("humanApprovals");
  if (problems.length) throw new UsageError(`Run ${id}: run.json is malformed (${problems.join(", ")}) — edited by hand or written by an incompatible harness; start a new run`);
}

// correction archives a round by moving files into rounds/<n>/, verdict.json
// first. While that directory is populated for the current round, a correction
// was interrupted mid-move: whatever is left in evidence/ is a partial round,
// and a verdict over it could pass on a subset of the critics.
async function assertNoPendingArchive(directory, run, id) {
  const archive = join(directory, "evidence", "rounds", String(run.round));
  if ((await exists(archive)) && (await readdir(archive)).length) {
    throw new UsageError(`Run ${id}: a correction was interrupted while archiving round ${run.round} — run "correction ${id}" to complete it before anything else`);
  }
}

function assertNotBlocked(run, id) {
  if (run.blocked) {
    throw new UsageError(`Run is BLOCKED pending a human decision: "${run.blocked.reason}". Record the decision with: unblock ${id} --approved "<who/why>"`);
  }
}

function parseFlags(args, spec) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) { rest.push(arg); continue; }
    const name = arg.slice(2);
    if (!(name in spec)) throw new UsageError(`Unknown flag --${name}`);
    if (spec[name] === "boolean") { flags[name] = true; continue; }
    const value = args[index + 1];
    if (value === undefined) throw new UsageError(`--${name} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return { flags, rest };
}

// Runs a gate command as the leader of its own session so a timeout — or an
// interrupt of the harness itself — kills the whole tree. The session, not the
// process group, is the unit: coreutils `timeout` and job-control shells move
// the gate's command into a new process group of the same session. Only a
// process that calls setsid() itself leaves it. Output is capped and the cut
// is marked.
let activeGate = null;
let heldGateLock = null; // { path, token } while this process holds gates.lock
function killActiveGate(signal) {
  if (activeGate) sweepSession(activeGate.pid, signal, activeGate);
  for (const pgid of activeGitGroups) { try { process.kill(-pgid, "SIGKILL"); } catch {} }
}
// Any signal that would end the harness first ends the running gate and
// releases the lock; SIGKILL cannot be caught, which is what the recorded gate
// session (gates.session) is for. A module that imports the harness gets
// these handlers too, and must clean up its own children on the same list.
export const INTERRUPT_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGUSR2", "SIGALRM", "SIGVTALRM", "SIGPROF", "SIGXCPU", "SIGXFSZ"].filter((signal) => signal in osConstants.signals));
for (const signal of INTERRUPT_SIGNALS) {
  process.on(signal, () => {
    killActiveGate("SIGKILL");
    if (heldGateLock) { try { if (readFileSync(heldGateLock.path, "utf8").trim() === heldGateLock.token) unlinkSync(heldGateLock.path); } catch {} }
    process.exit(128 + osConstants.signals[signal]);
  });
}

// Live (non-zombie) members of session `sid`, read from /proc (Linux) as
// [{ pid, pgrp }]; `null` when /proc cannot be enumerated.
export function liveSessionMembers(sid, procRoot = "/proc") {
  if (procRoot === "/proc" && (process.platform !== "linux" || config().testNoProc)) return null;
  let entries;
  try { entries = readdirSync(procRoot); } catch { return null; }
  const members = [];
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry)) continue;
    let stat;
    try { stat = readFileSync(join(procRoot, entry, "stat"), "latin1"); } catch { continue; }
    const close = stat.lastIndexOf(")");
    if (close < 0) continue;
    const [state, , pgrp, session] = stat.slice(close + 2).split(" ");
    if (Number(session) !== sid || state === "Z" || state === "X") continue;
    members.push({ pid: Number(entry), pgrp: Number(pgrp) });
  }
  return members;
}

// Signals every process of the session: each process group found in it and
// each member, plus the leader's own group where /proc is unavailable.
function killSession(sid, signal, leader = null, members = liveSessionMembers(sid)) {
  const list = members ?? [];
  for (const pgrp of new Set([sid, ...list.map((member) => member.pgrp)])) { try { process.kill(-pgrp, signal); } catch {} }
  for (const member of list) { try { process.kill(member.pid, signal); } catch {} }
  if (!list.length && leader) { try { leader.kill(signal); } catch {} }
}

// A single pass can miss a process forked into a new group while /proc was
// read: sweep until the session is empty (bounded; synchronous so a signal
// handler can use it before exiting). Without /proc one pass is all there is.
export function sweepSession(sid, signal, leader = null, passes = 20) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let pass = 0; pass < passes; pass += 1) {
    const members = liveSessionMembers(sid);
    killSession(sid, signal, leader, members);
    if (members === null || members.length === 0) return;
    Atomics.wait(pause, 0, 0, 10);
  }
}

function sessionAlive(sid) {
  const members = liveSessionMembers(sid);
  if (members !== null && members.length > 0) return true;
  try { process.kill(-sid, 0); return members === null; } catch (error) { return error.code !== "ESRCH"; }
}

// Number of members of process group `pgid` that are not zombies, read from
// /proc (Linux); `null` when /proc cannot be enumerated (other platforms, or
// a /proc that is not mounted), so the caller falls back to kill(-pgid, 0).
// A zombie (state Z, or X while being torn down) is a dead process whose
// parent has not reaped it yet: it holds no executable state, so it does not
// count as a survivor of the cleanup. A member that exits between readdir
// and the read of its stat file is simply gone.
export function liveProcessesInGroup(pgid, procRoot = "/proc") {
  if (process.platform !== "linux" && procRoot === "/proc") return null;
  let entries;
  try { entries = readdirSync(procRoot); } catch { return null; }
  let live = 0;
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry)) continue;
    let stat;
    try { stat = readFileSync(join(procRoot, entry, "stat"), "latin1"); } catch { continue; }
    // "<pid> (<comm>) <state> <ppid> <pgrp> ..." — comm may contain spaces or
    // parentheses, so the fields are taken after the last ")".
    const close = stat.lastIndexOf(")");
    if (close < 0) continue;
    const [state, , pgrp] = stat.slice(close + 2).split(" ");
    if (Number(pgrp) !== pgid) continue;
    if (state === "Z" || state === "X") continue;
    live += 1;
  }
  return live;
}

// Bounded cleanup of whatever a gate left in its process group, with a
// truthful outcome: "TERMINATED" (gone after SIGTERM within the grace),
// "KILLED" (gone after SIGKILL within the final wait) or "SURVIVED" (still
// observed after the final bounded wait — e.g. uninterruptible sleep, or a
// process the harness may not signal). Never waits longer than
// graceMs + killWaitMs. `alive` and `kill` are injectable for tests.
export async function reapProcessGroup({ alive, kill, graceMs, killWaitMs = LEFTOVER_KILL_WAIT_MS, pollMs = 25 }) {
  const pause = (ms) => new Promise((wake) => setTimeout(wake, ms));
  const waitGone = async (budget) => {
    const deadline = Date.now() + budget;
    while (alive()) {
      if (Date.now() >= deadline) return false;
      await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
    return true;
  };
  if (!alive()) return { leaked: false, signal: null, outcome: null };
  kill("SIGTERM");
  if (await waitGone(graceMs)) return { leaked: true, signal: "SIGTERM", outcome: "TERMINATED" };
  kill("SIGKILL");
  if (await waitGone(killWaitMs)) return { leaked: true, signal: "SIGKILL", outcome: "KILLED" };
  return { leaked: true, signal: "SIGKILL", outcome: "SURVIVED" };
}

function runShell(command, cwd, timeoutMs, leftoverGraceMs, onSpawn = () => {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn("sh", ["-c", command], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    activeGate = child;
    if (child.pid) onSpawn(child.pid);
    const chunks = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let exited = false;
    let exitCode = null;
    let signal = null;
    let leftovers = { leaked: false, signal: null, outcome: null };
    let settled = false;
    let extra = "";
    let grace = null;
    const collect = (chunk) => {
      if (truncated) return;
      if (size + chunk.length > MAX_GATE_LOG_BYTES) { chunks.push(chunk.subarray(0, MAX_GATE_LOG_BYTES - size)); size = MAX_GATE_LOG_BYTES; truncated = true; return; }
      chunks.push(chunk); size += chunk.length;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const killGroup = (signal) => sweepSession(child.pid, signal, child, signal === "SIGKILL" ? 20 : 1);
    const timer = timeoutMs > 0 ? setTimeout(() => { if (exited) return; timedOut = true; killGroup("SIGKILL"); }, timeoutMs) : null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      activeGate = null;
      let output = Buffer.concat(chunks).toString();
      if (truncated) output += `\n# output truncated at ${MAX_GATE_LOG_BYTES} bytes\n`;
      if (timedOut) output += `\n# gate killed after ${timeoutMs} ms timeout\n`;
      if (signal && !timedOut) output += `\n# gate shell died from ${signal}\n`;
      if (leftovers.leaked && timedOut) {
        output += `\n# after the timeout SIGKILL the gate's session was STILL OBSERVED at the end of the final ${LEFTOVER_KILL_WAIT_MS} ms wait — cleanup is not complete\n`;
      } else if (leftovers.leaked) {
        const fate = leftovers.outcome === "TERMINATED" ? "they were sent SIGTERM and left"
          : leftovers.outcome === "KILLED" ? `they were sent SIGTERM, were still alive after ${leftoverGraceMs} ms, and were SIGKILLed`
          : `they were sent SIGTERM, then SIGKILL, and were STILL OBSERVED after the final ${LEFTOVER_KILL_WAIT_MS} ms wait — cleanup is not complete`;
        output += `\n# the gate exited while processes it started were still in its session; ${fate} (a process that called setsid() itself is not tracked)\n`;
      }
      resolvePromise({
        passed: !timedOut && exitCode === 0, exitCode: timedOut ? null : (exitCode ?? (signal ? null : 1)), signal: timedOut ? "SIGKILL" : signal,
        output: output + extra, durationMs: Date.now() - started, timedOut,
        leaked: leftovers.leaked, leftoverSignal: leftovers.signal, leftoverOutcome: leftovers.outcome
      });
    };
    // Whatever the pipes say, the shell's process group must be empty before
    // the next gate starts: probe it, SIGTERM leftovers (redirected servers,
    // watchers), wait a bounded grace for them to go, then SIGKILL what is
    // still there, then record what actually happened. kill(-pgid, 0) fails
    // with ESRCH when nothing is left; any other failure (EPERM: a process the
    // harness may not signal) means something is still there.
    // A zombie keeps kill(-pgid, 0) succeeding until its parent reaps it, so
    // on Linux the group is read from /proc and only non-zombie members count
    // as alive. The signal probe is still consulted afterwards: EPERM (a
    // member the harness may not signal — possibly invisible under a hidepid
    // /proc) keeps counting as present, and where /proc is unavailable the
    // probe's success alone is what decides.
    const groupAlive = () => sessionAlive(child.pid);
    let reaping = null;
    const reapLeftovers = () => {
      if (!reaping) {
        // Timeout: the group was already SIGKILLed; only the bounded final
        // wait and the probe remain, so the record is observed, not assumed.
        reaping = (timedOut
          ? reapProcessGroup({ alive: groupAlive, kill: () => killGroup("SIGKILL"), graceMs: 0, killWaitMs: LEFTOVER_KILL_WAIT_MS })
          : reapProcessGroup({ alive: groupAlive, kill: killGroup, graceMs: leftoverGraceMs })
        ).then((result) => {
          // On timeout only "still there after the final wait" is a leftover; a group that vanished during the wait was cleaned by the timeout kill.
          leftovers = timedOut ? (result.outcome === "SURVIVED" ? { leaked: true, signal: "SIGKILL", outcome: "SURVIVED" } : { leaked: false, signal: null, outcome: null }) : result;
        });
      }
      return reaping;
    };
    child.on("error", (error) => { exitCode = 127; extra = `${error.message}\n`; finish(); });
    // The gate is settled by its own exit, not by the pipes closing: a child
    // that outlived the shell (background job, daemon, re-parented process)
    // must not pin the harness. After a short drain the leftovers are killed
    // and the streams are released.
    child.on("exit", (code, exitSignal) => {
      exited = true;
      exitCode = code;
      signal = exitSignal ?? null;
      grace = setTimeout(async () => {
        await reapLeftovers();
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, 500);
    });
    child.on("close", async () => { if (exited) await reapLeftovers(); finish(); });
  });
}

// --------------------------------------------------------------- validation

// Review results arrive as text written by a model. Malformed JSON is a
// refusal (exit 2, like any other invalid input), and so is a key repeated in
// one object: JSON.parse keeps the last one, so {"severity":"MAJOR", …,
// "severity":"MINOR"} would silently downgrade a finding.
export function parseReviewJson(text, role) {
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new UsageError(`${role} rejected: malformed JSON (${error.message})`); }
  const duplicate = duplicateKey(text);
  if (duplicate !== null) throw new UsageError(`${role} rejected: key ${JSON.stringify(duplicate)} appears twice in one object — JSON would keep only the last`);
  return value;
}

// The first key repeated within one object of `text` (valid JSON), or null.
function duplicateKey(text) {
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      let next = end + 1;
      while (/\s/.test(text[next] ?? "")) next += 1;
      const keys = stack.at(-1);
      if (text[next] === ":" && keys) {
        const key = JSON.parse(text.slice(i, end + 1));
        if (keys.has(key)) return key;
        keys.add(key);
      }
      i = end;
    } else if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
  }
  return null;
}

export function validateCriticResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new UsageError("Critic result must be a JSON object");
  const allowed = new Set(["gaps", "summary", "verified"]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) throw new UsageError(`Unexpected field in critic result: ${key}`);
  if (typeof result.summary !== "string" || !result.summary.trim()) throw new UsageError("Critic result needs a non-empty summary");
  if (!Array.isArray(result.gaps)) throw new UsageError("Critic result needs a gaps array (use [] for no gap)");
  result.gaps.forEach((gap, index) => validateGap(gap, `gaps[${index}]`));
  if (result.verified !== undefined && (!Array.isArray(result.verified) || result.verified.some((item) => typeof item !== "string"))) throw new UsageError("verified must be an array of strings");
  return result;
}

function validateGap(gap, label) {
  if (!gap || typeof gap !== "object") throw new UsageError(`${label} must be an object`);
  const required = ["severity", "contract", "evidence", "description"];
  for (const field of required) {
    if (typeof gap[field] !== "string" || !gap[field].trim()) throw new UsageError(`${label}.${field} must be a non-empty string`);
  }
  if (!SEVERITIES.includes(gap.severity)) throw new UsageError(`${label}.severity must be one of ${SEVERITIES.join(", ")}`);
  if (gap.reproduction !== undefined && typeof gap.reproduction !== "string") throw new UsageError(`${label}.reproduction must be a string`);
  for (const key of Object.keys(gap)) {
    if (![...required, "reproduction"].includes(key)) throw new UsageError(`Unexpected field ${label}.${key}`);
  }
}

export function validateJudgeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new UsageError("Judge result must be a JSON object");
  const allowed = new Set(["findings", "summary"]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) throw new UsageError(`Unexpected field in judge result: ${key}`);
  if (typeof result.summary !== "string" || !result.summary.trim()) throw new UsageError("Judge result needs a non-empty summary");
  if (!Array.isArray(result.findings)) throw new UsageError("Judge result needs a findings array");
  // Each critic finding may be adjudicated at most once: two findings with
  // the same ref (even with the same classification) are malformed input,
  // otherwise the outcome would depend on the order of the JSON array.
  const adjudicated = new Set();
  result.findings.forEach((finding, index) => {
    const label = `findings[${index}]`;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) throw new UsageError(`${label} must be an object`);
    for (const key of Object.keys(finding)) {
      if (!["ref", "classification", "severity", "contract", "evidence", "description", "reproduction"].includes(key)) throw new UsageError(`Unexpected field ${label}.${key}`);
    }
    if (!CLASSIFICATIONS.includes(finding.classification)) throw new UsageError(`${label}.classification must be one of ${CLASSIFICATIONS.join(", ")}`);
    if (typeof finding.evidence !== "string" || !finding.evidence.trim()) throw new UsageError(`${label}.evidence must be a non-empty string`);
    if (finding.ref !== null && finding.ref !== undefined && !/^[A-Za-z0-9_.-]+#\d+$/.test(finding.ref)) {
      throw new UsageError(`${label}.ref must be "<lens>#<index>" or null`);
    }
    if (finding.ref != null) {
      if (adjudicated.has(finding.ref)) throw new UsageError(`${label}.ref ${finding.ref} is adjudicated more than once in this judge result — each critic finding may be referenced at most once`);
      adjudicated.add(finding.ref);
    }
    if (finding.ref == null) {
      if (finding.classification !== "CONFIRMED") throw new UsageError(`${label}: a new finding (ref null) must be CONFIRMED`);
      validateGap({ severity: finding.severity, contract: finding.contract, evidence: finding.evidence, description: finding.description }, label);
    } else if (finding.severity !== undefined && !SEVERITIES.includes(finding.severity)) {
      throw new UsageError(`${label}.severity must be one of ${SEVERITIES.join(", ")}`);
    }
  });
  return result;
}

// ------------------------------------------------------------- verdict logic

export function applyJudge(criticGaps, judge) {
  if (!judge) return { gaps: criticGaps, dismissed: [] };
  const byRef = new Map(judge.findings.filter((finding) => finding.ref).map((finding) => [finding.ref, finding]));
  const gaps = [];
  const dismissed = [];
  for (const gap of criticGaps) {
    const finding = byRef.get(gap.ref);
    if (!finding) { gaps.push(gap); continue; }
    if (finding.classification === "CONFIRMED") {
      gaps.push({ ...gap, severity: finding.severity ?? gap.severity, judged: "CONFIRMED", judgeEvidence: finding.evidence });
    } else {
      dismissed.push({ ...gap, judged: finding.classification, judgeEvidence: finding.evidence });
    }
  }
  for (const finding of judge.findings.filter((item) => item.ref == null)) {
    gaps.push({
      ref: "judge", severity: finding.severity, contract: finding.contract, evidence: finding.evidence,
      description: finding.description, judged: "CONFIRMED"
    });
  }
  return { gaps, dismissed };
}

// Convergence between two rounds. Gate failures and critic findings are two
// stages, not one scale: a round whose gates failed never reached critique,
// so "gates broken" -> "gates pass, N critic findings" is progress (the
// findings are new information, not a regression). Within a stage, fewer
// material gaps is progress; the same or more is stagnation. A gate that
// passed before and fails now is a regression regardless of counts — only a
// gate that actually passed: gates stop at the first failure, so a gate that
// was skipped last round and fails now is new information, not a regression.
export function convergence({ round, previous, currentFailedGates, currentPassedGates = [], currentMaterialCount }) {
  if (round === 0 || !previous) return null;
  const previousFailed = new Set(previous.failedGates ?? []);
  // Regression: a gate that passed in the previous round fails now. A verdict
  // recorded before passedGates existed falls back to the older, stricter
  // reading (any current failure that was not failing before).
  const regressed = Array.isArray(previous.passedGates)
    ? currentFailedGates.some((name) => previous.passedGates.includes(name))
    : currentFailedGates.some((name) => !previousFailed.has(name));
  if (regressed) return "REGRESSING";
  if (previousFailed.size > 0) {
    // Gate stage: progress means every gate that failed before is observed
    // passing now — whether the run reached critique or a later, previously
    // skipped gate. A gate merely absent from the current failures (skipped
    // behind a new or reordered gate, or dropped from the spec) proves
    // nothing: fail safe.
    const passedNow = new Set(currentPassedGates);
    return [...previousFailed].every((name) => passedNow.has(name)) ? "IMPROVING" : "STAGNATING";
  }
  // Critique stage last round, a gate failing now that never passed (a gate
  // added this round): not a regression, but not progress either — fail safe.
  if (currentFailedGates.length > 0) return "STAGNATING";
  const previousMaterial = previous.materialCount ?? 0;
  if (currentMaterialCount === 0 || currentMaterialCount < previousMaterial) return "IMPROVING";
  return "STAGNATING";
}

// A failed gate is identified by its name AND its command: running a
// different command under the same name proves nothing about the one that
// failed (changing a failed gate's command is a change of the verification
// package, i.e. of the contract). Older records carried names only; their
// command, when unknown, matches by name.
export function failureSpec(entry, gates = []) {
  if (entry && typeof entry === "object") return { name: entry.name, command: entry.command ?? null };
  return { name: entry, command: gates.find((gate) => gate.name === entry)?.command ?? null };
}

function sameGate(spec, gate) {
  return gate.name === spec.name && (spec.command === null || gate.command === spec.command);
}

function uniqueSpecs(specs) {
  const seen = new Set();
  return specs.filter((spec) => { const key = `${spec.name}\0${spec.command}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : String(a.command) < String(b.command) ? -1 : 1));
}

// A gate passes only when its command succeeded AND its process group was
// observed empty afterwards. Processes that survived SIGKILL keep acting on the
// candidate (ports, files, locks), so the gate fails and nothing after it runs.
// A record written by an older harness (passed: true, SURVIVED) reads the same.
export function gatePassed(gate) {
  return gate.passed === true && gate.leftoverOutcome !== "SURVIVED";
}

function allGatesPassed(record) {
  return record.allPassed === true && record.gates.every(gatePassed) && !(record.unresolvedFailures ?? []).length;
}

export function decideStatus({ failedGates, pendingCritics, pendingJudge, materialCount, trend }) {
  if (failedGates.length) return trend === "REGRESSING" ? "REGRESSION" : trend === "STAGNATING" ? "STAGNATING" : "GAP";
  if (pendingCritics > 0 || pendingJudge) return "CRITIQUE";
  if (materialCount > 0) return trend === "STAGNATING" ? "STAGNATING" : "GAP";
  // No gap left, yet a gate that failed last round was never observed passing
  // (dropped, renamed or skipped): not evidence of a fix, so never PASS.
  if (trend === "STAGNATING") return "STAGNATING";
  return "PASS";
}

// Which critics are still missing: named lenses when the run declares them,
// otherwise a count. Only critics recorded for the current evidence digest count.
export function pendingCriticsFor(run, critics) {
  const recorded = new Set(critics.map((entry) => entry.lens));
  if (Array.isArray(run.lenses) && run.lenses.length) {
    const missing = run.lenses.filter((lens) => !recorded.has(lens));
    return { pending: Math.max(missing.length, run.criticsRequired - critics.length, 0), missingLenses: missing };
  }
  return { pending: Math.max(0, run.criticsRequired - critics.length), missingLenses: [] };
}

// ------------------------------------------------------------------ commands

async function init(root, args) {
  const { flags, rest } = parseFlags(args, { tier: "value", budget: "value", critics: "value", lenses: "value", judge: "boolean", "no-judge": "boolean" });
  const [id] = rest;
  const tierName = (flags.tier ?? "STANDARD").toUpperCase();
  if (!TIERS[tierName]) throw new UsageError(`Unknown tier ${tierName}; expected ${Object.keys(TIERS).join(", ")}`);
  const directory = runDir(root, id);
  await assertPhysicalState(root, directory, "init", { allowMissing: true });
  if (await exists(directory)) throw new UsageError(`Run already exists: ${id} (use "status ${id}" to resume or "clean ${id}")`);
  await assertStateUntracked(root);
  const snapshot = await assertHeadroom(root);
  if (snapshot.runs >= config().runsWarning) console.error(`warning: ${snapshot.runs} runs already exist under .gauntlet/runs — consider "clean" on finished runs`);
  const tier = TIERS[tierName];
  const lenses = flags.lenses ? flags.lenses.split(",").map((lens) => lens.trim()).filter(Boolean) : [];
  for (const lens of lenses) if (!/^[A-Za-z0-9_.-]{1,32}$/.test(lens)) throw new UsageError(`Invalid lens name: ${lens}`);
  // One critic file per lens: a repeated lens would require a critic that can never be recorded.
  const duplicate = lenses.find((lens, index) => lenses.indexOf(lens) !== index);
  if (duplicate) throw new UsageError(`Duplicate lens: ${duplicate} — each declared lens is one critic`);
  const criticsRequired = flags.critics !== undefined ? numberFlag("critics", flags.critics, { integer: true }) : Math.max(tier.criticsRequired, lenses.length);
  if (criticsRequired < tier.criticsRequired) {
    throw new UsageError(`--critics ${criticsRequired} is below the ${tierName} floor of ${tier.criticsRequired}; pick a lower tier explicitly instead`);
  }
  if (flags["no-judge"] && tier.judgeRequired) throw new UsageError(`--no-judge is not allowed on the ${tierName} tier; the judge is mandatory there`);
  // Everything that can refuse runs before the first write (excludeFromGit
  // below writes .git/info/exclude): a refusal leaves nothing behind.
  const digest = await treeDigest(root);
  const run = {
    schemaVersion: SCHEMA_VERSION,
    runId: id,
    tier: tierName,
    criticsRequired,
    lenses,
    judgeRequired: flags.judge ? true : flags["no-judge"] ? false : tier.judgeRequired,
    budget: flags.budget !== undefined ? numberFlag("budget", flags.budget, { integer: true }) : tier.budget,
    round: 0,
    blocked: null,
    humanApprovals: [],
    createdAt: new Date().toISOString(),
    root,
    git: { revision: await headRevision(root), branch: (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim() || null },
    excludedFromGit: await excludeFromGit(root),
    resourcesAtInit: snapshot
  };
  await mkdir(join(directory, "evidence"), { recursive: true });
  await writeJson(join(directory, "run.json"), run);
  await checkpoint(directory, "PLANNED", { checkpoint: "initialized", digest });
  console.log(JSON.stringify({ runId: id, tier: tierName, criticsRequired: run.criticsRequired, lenses, judgeRequired: run.judgeRequired, budget: run.budget, directory: relative(root, directory) }, null, 2));
}

async function contract(root, args) {
  const { flags, rest } = parseFlags(args, { approved: "value" });
  const [id, source] = rest;
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  if (!source) throw new UsageError("Usage: contract <run-id> <file|-> [--approved \"<who/why>\"]");
  const text = await readInput(source);
  if (!text.trim()) throw new UsageError("Contract is empty");
  const previous = await contractDigest(directory);
  const next = sha256(text.endsWith("\n") ? text : `${text}\n`);
  const approved = flags.approved?.trim() || null;
  if (flags.approved !== undefined && !approved) throw new UsageError("--approved needs the recorded human decision, not an empty string");
  // After a material verdict the contract is the scope the round is judged
  // against: replacing it reopens the round to another candidate, so it is a
  // scope decision (invariant 8) and needs the user's recorded words —
  // otherwise a contract edit would bypass the budget and convergence guards.
  const scopeChange = previous !== null && previous !== next && run.roundGap?.round === run.round;
  if (scopeChange && !approved) {
    throw new UsageError(`Contract replacement refused: round ${run.round} has a ${run.roundGap.status} verdict, and a new contract reopens the round — a scope decision that needs the user's own words: contract ${id} <file|-> --approved "<who/why>"`);
  }
  const digest = await treeDigest(root); // may refuse: before any write
  // Atomic: a crash can never leave a truncated or empty contract that every
  // later command would read as the recorded one.
  await writeDurable(join(directory, "contract.md"), text.endsWith("\n") ? text : `${text}\n`);
  const current = await contractDigest(directory);
  const { current: reviews } = await loadCritics(directory, undefined);
  const changed = previous !== null && previous !== current;
  if (changed && reviews.length) console.error(`  note: the contract changed — ${reviews.length} recorded critic result(s) are now stale and will not count`);
  if (scopeChange) await writeJson(join(directory, "run.json"), { ...run, humanApprovals: [...run.humanApprovals, { at: new Date().toISOString(), round: run.round, reason: approved, contractReplaced: true }] });
  await checkpoint(directory, "PLANNED", { checkpoint: changed ? "contract replaced" : "contract recorded", digest, contractDigest: current });
  console.log(`Contract ${changed ? "replaced" : "recorded"} for ${id}`);
}

async function manualCheckpoint(root, [id, status, ...note]) {
  const { directory, run } = await loadRun(root, id);
  if (!status) throw new UsageError("Usage: checkpoint <run-id> <STATUS> [note]");
  const upper = status.toUpperCase();
  if (!MANUAL_STATUSES.includes(upper)) {
    throw new UsageError(`Manual checkpoints are limited to ${MANUAL_STATUSES.join(", ")}; ${upper} is derived from evidence (use gates/verdict/block)`);
  }
  assertNotBlocked(run, id);
  const next = await checkpoint(directory, upper, { checkpoint: note.join(" ") || "manual", digest: await treeDigest(root) });
  console.log(`${id}: ${next.status} (${next.checkpoint})`);
}

// One gate execution per run at a time: the in-progress marker, the logs and
// gates.json have a single writer. Overlapping executions would remove each
// other's marker on commit and could leave a current record whose logs were
// overwritten. The lock is a hard link to a file already holding the owner's
// pid and a token, so it never exists half-written. A lock whose process is
// gone (SIGKILL, crash) is stale and taken over — removed only if it is still
// the lock that was inspected.
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

async function gateLockHolder(directory) {
  const held = (await readFile(join(directory, "gates.lock"), "utf8").catch(() => "")).trim();
  const pid = Number(held.split(" ")[0]);
  return { held, pid: Number.isInteger(pid) && pid > 0 && processAlive(pid) ? pid : null };
}

// The session of the gate being run, so that a harness killed without
// cleanup (SIGKILL, OOM) leaves a trace of the processes it could not stop.
// The leader's start time (Linux /proc) tells a reused pid from the gate's own
// session: while any member of a session lives, the kernel does not reuse its
// id, but once the session is gone a new, unrelated leader may get it.
function procStartTime(pid) {
  if (process.platform !== "linux" || config().testNoProc) return null;
  try { const stat = readFileSync(`/proc/${pid}/stat`, "latin1"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null; } catch { return null; }
}

function recordGateSession(directory, sid) {
  try { writeFileSync(join(directory, "gates.session"), `${sid} ${procStartTime(sid) ?? "-"}\n`); } catch {}
}

async function orphanedGateProcesses(directory) {
  const [sidText, started] = (await readFile(join(directory, "gates.session"), "utf8").catch(() => "")).trim().split(" ");
  const sid = Number(sidText);
  if (!Number.isInteger(sid) || sid <= 0) return null;
  const leaderStarted = procStartTime(sid);
  if (leaderStarted !== null && started && started !== "-" && leaderStarted !== started) return null; // the id now leads an unrelated session
  const members = liveSessionMembers(sid);
  if (members !== null) return members.length ? { sid, pids: members.map((member) => member.pid) } : null;
  // No /proc to enumerate the session (macOS, BSD): probe the gate shell's
  // own process group (its id is the session's). Alive, or present but not
  // signalable (EPERM), is an orphan; a member moved to another group is not
  // visible this way (an unverified platform, see Platform in harness.md).
  try { process.kill(-sid, 0); return { sid, pids: [] }; } catch (error) { return error.code === "EPERM" ? { sid, pids: [] } : null; }
}

function describeOrphan(orphan) {
  return orphan.pids.length
    ? { where: `session ${orphan.sid}, pids ${orphan.pids.join(" ")}`, stop: `kill ${orphan.pids.join(" ")}` }
    : { where: `process group ${orphan.sid}`, stop: `kill -- -${orphan.sid}` };
}

async function acquireGateLock(root, directory, id) {
  const path = join(directory, "gates.lock");
  const token = `${process.pid} ${randomBytes(8).toString("hex")}`;
  const staging = join(directory, `gates.lock.${randomBytes(8).toString("hex")}`);
  const release = async () => {
    heldGateLock = null;
    if ((await readFile(path, "utf8").catch(() => "")).trim() === token) {
      // The session record goes once nothing of it is left; a gate whose
      // leftovers SURVIVED keeps it, so the next execution sees them.
      if (!(await orphanedGateProcesses(directory))) await rm(join(directory, "gates.session"), { force: true });
      await rm(path, { force: true });
    }
  };
  const running = (pid) => new UsageError(`Gates for ${id} are already running (pid ${pid}): one execution per run at a time — wait for it; if pid ${pid} is not a Gauntlet harness, remove ${relative(root, path)}`);
  await writeFile(staging, `${token}\n`);
  try {
    try {
      await link(staging, path);
      heldGateLock = { path, token };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (heldGateLock?.token === token) {
      // The lock was free, but an earlier execution's gate may still run (it
      // survived its cleanup): never start alongside it.
      const survivors = await orphanedGateProcesses(directory);
      if (survivors) {
        await release();
        const { where, stop } = describeOrphan(survivors);
        throw new UsageError(`Gates for ${id}: processes of an earlier gate are still running (${where}) — they would act on the tree alongside a new execution; stop them (${stop}) and rerun`);
      }
      return release;
    }
    const { held, pid } = await gateLockHolder(directory);
    if (pid) throw running(pid);
    // The holder is gone. Its gate may not be: a harness killed without
    // cleanup leaves the gate's session running, unbounded.
    const orphan = await orphanedGateProcesses(directory);
    if (orphan) {
      const { where, stop } = describeOrphan(orphan);
      throw new UsageError(`Gates for ${id}: a previous execution died without cleanup and its gate processes are still running (${where}) — they would act on the tree alongside a new execution; stop them (${stop}) and rerun`);
    }
    // Take the stale lock over under an exclusive mutex, so that two processes
    // can never both remove it and relink: the lock is re-checked, removed
    // only if unchanged, and relinked while the mutex is held.
    const mutex = join(directory, "gates.lock.takeover");
    let handle;
    try { handle = await open(mutex, "wx"); } catch (error) {
      if (error.code === "EEXIST") throw new UsageError(`Gates for ${id}: another process is taking over the stale gates lock — retry; if none is, remove ${relative(root, mutex)}`);
      throw error;
    }
    try {
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      const again = await gateLockHolder(directory);
      if (again.pid) throw running(again.pid);
      if (again.held !== held) throw new UsageError(`Gates for ${id}: the gates lock changed while it was being taken over — retry`);
      await rm(path, { force: true });
      try { await link(staging, path); } catch (error) {
        if (error.code === "EEXIST") throw running((await gateLockHolder(directory)).pid ?? "unknown");
        throw error;
      }
      heldGateLock = { path, token };
      return release;
    } finally {
      await rm(mutex, { force: true });
    }
  } finally {
    await rm(staging, { force: true });
  }
}

async function gates(root, args) {
  const { flags, rest } = parseFlags(args, { force: "boolean", timeout: "value" });
  const [id, ...specs] = rest;
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  if (!specs.length) throw new UsageError("Usage: gates <run-id> [--force] [--timeout <seconds>] <name>=<command> ...");
  const timeoutS = flags.timeout !== undefined ? numberFlag("timeout", flags.timeout, { max: Math.floor(MAX_TIMER_MS / 1000) }) : config().gateTimeoutS;
  const seen = new Set();
  const parsed = specs.map((spec) => {
    const separator = spec.indexOf("=");
    if (separator <= 0) throw new UsageError(`Gate must be <name>=<command>: ${spec}`);
    const name = spec.slice(0, separator);
    const command = spec.slice(separator + 1);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(name)) throw new UsageError(`Invalid gate name: ${name}`);
    if (seen.has(name)) throw new UsageError(`Duplicate gate name: ${name}`);
    if (!command.trim()) throw new UsageError(`Gate ${name} has an empty command — a gate must run something`);
    seen.add(name);
    return { name, command };
  });
  const evidence = join(directory, "evidence");
  const gatesPath = join(evidence, "gates.json");
  await assertNoPendingArchive(directory, run, id);
  const { record: previous, identity: before, interrupted } = await currentIdentity(directory, root);
  const digest = before.tree;
  // A material verdict closes its round to other candidates: a fix is a
  // correction round, where the budget and convergence guards apply. Without
  // this, editing and re-verifying inside the round would reach PASS past an
  // exhausted budget or a STAGNATING verdict.
  if (run.roundGap && run.roundGap.round === run.round && run.roundGap.tree !== digest && (run.roundGap.contract ?? before.contract) === before.contract) {
    throw new UsageError(`Gates refused: round ${run.round} already has a ${run.roundGap.status} verdict for another candidate, and changing the candidate is a correction round — run "correction ${id}" first (it opens the round on that verdict even though the candidate was already edited), then rerun gates`);
  }
  const specDigest = gateSpecDigest(parsed, timeoutS);
  if (!flags.force && previous) {
    if (previous.gateEvidenceDigest && previous.evidenceFormat === EVIDENCE_FORMAT && previous.digest === digest && previous.specDigest === specDigest && allGatesPassed(previous) && !previous.treeChangedByGates) {
      console.log(`Reused gates for ${id}: tree digest and gate specification (commands and ${timeoutS} s timeout) unchanged, all ${previous.gates.length} gates passed`);
      return;
    }
  }
  await assertHeadroom(root);
  const release = await acquireGateLock(root, directory, id);
  try {
    await executeGates({ root, id, run, directory, evidence, gatesPath, parsed, specDigest, timeoutS, previous, interrupted, digest });
  } finally {
    await release();
  }
}

async function executeGates({ root, id, run, directory, evidence, gatesPath, parsed, specDigest, timeoutS, previous, interrupted, digest }) {
  // A real execution starts here. Before any log is touched, supersede the
  // record on disk: from this point until the new record is committed, no
  // gate evidence is current — whatever happens to this process.
  const executionId = randomBytes(16).toString("hex");
  await writeJson(join(evidence, IN_PROGRESS), {
    runId: id, round: run.round, executionId, specDigest, timeoutS, startedAt: new Date().toISOString(),
    supersedes: previous ? { executionId: previous.executionId ?? null, gateEvidenceDigest: previous.gateEvidenceDigest ?? null } : (interrupted ? { interruptedExecutionId: interrupted.executionId } : null)
  });
  if (interrupted) console.error(`  note: the previous execution ${interrupted.executionId} was interrupted before its record was committed; this run replaces it`);
  await checkpoint(directory, "VERIFYING", { checkpoint: "gates started", digest, executionId });
  // Logs of the superseded execution go: a dropped or skipped gate must not
  // leave a log the new record does not name.
  await rm(join(evidence, "gates"), { recursive: true, force: true });
  await mkdir(join(evidence, "gates"), { recursive: true });
  // Failures carry within a round: a gate that failed in an earlier execution
  // of this round stays failed until it is observed passing — dropping,
  // renaming or skipping it proves nothing (across rounds, convergence applies
  // the same rule).
  // A replaced contract is a recorded scope decision that may redefine the
  // gates: failures carry only under the contract they were recorded for.
  const stored = (await exists(gatesPath)) ? await readJson(gatesPath).catch(() => null) : null;
  const carried = stored && stored.round === run.round && stored.contractDigest === (await contractDigest(directory))
    ? uniqueSpecs([...(stored.unresolvedFailures ?? []).map((entry) => failureSpec(entry, stored.gates)), ...(stored.gates ?? []).filter((gate) => !gatePassed(gate) && !gate.skipped).map((gate) => ({ name: gate.name, command: gate.command }))])
    : [];
  const results = [];
  let stopped = false;
  for (const gate of parsed) {
    if (stopped) { results.push({ ...gate, passed: false, skipped: true, exitCode: null, signal: null, timedOut: false, leakedProcesses: false, leftoverSignal: null, leftoverOutcome: null, durationMs: 0, log: null, logDigest: null }); continue; }
    const result = await runShell(gate.command, root, timeoutS * 1000, config().leftoverGraceMs, (sid) => recordGateSession(directory, sid));
    const log = join("gates", `${gate.name}.log`);
    await writeDurable(join(evidence, log), result.output);
    const passed = gatePassed({ passed: result.passed, leftoverOutcome: result.leftoverOutcome });
    results.push({ name: gate.name, command: gate.command, passed, skipped: false, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, leakedProcesses: result.leaked, leftoverSignal: result.leftoverSignal, leftoverOutcome: result.leftoverOutcome, durationMs: result.durationMs, log, logDigest: sha256(result.output) });
    console.error(`  [${passed ? "pass" : "FAIL"}] ${gate.name} (${result.durationMs} ms${result.timedOut ? ", timeout" : ""}${result.leaked ? `, leftovers ${result.leftoverOutcome}` : ""})`);
    if (result.leftoverOutcome === "SURVIVED") console.error(`  warning: processes started by gate ${gate.name} survived SIGKILL within the bounded wait; the process group may still exist — the gate fails until they are gone and gates are rerun`);
    if (!passed) stopped = true;
  }
  // Gates may leave artifacts in the tree (build output, lockfiles): the
  // evidence is bound to the tree as it is after they ran.
  const digestAfter = await treeDigest(root);
  if (run.roundGap?.round === run.round && run.roundGap.tree === digest && digestAfter !== digest) {
    // The gates themselves changed the tree (artifacts): still the round's candidate.
    await writeJson(join(directory, "run.json"), { ...run, roundGap: { ...run.roundGap, tree: digestAfter } });
  }
  const index = await candidateIndex(root);
  let files;
  try {
    await writePatch(root, join(evidence, "diff.patch"), index?.env);
    files = await changedFiles(root, index?.env);
  } finally {
    await index?.dispose();
  }
  // Ordering: marker (above) -> every log and diff.patch durable (above) ->
  // gates.json durable (below) -> marker removed. A stop before the record
  // is committed leaves the marker naming an execution without a record
  // (interrupted); a stop after it leaves a record whose artifacts are all
  // already on disk with the digested bytes.
  // Resolved only by the same command passing; a same-command failure now is reported as such.
  const unresolvedFailures = carried.filter((spec) => !results.some((gate) => sameGate(spec, gate) && (gatePassed(gate) || !gate.skipped)));
  haltIfRequested("after-evidence");
  await writeJson(gatesPath, {
    runId: id, round: run.round, digest: digestAfter, digestBefore: digest, treeChangedByGates: digestAfter !== digest,
    evidenceFormat: EVIDENCE_FORMAT, harness: VERSION,
    specDigest, timeoutS, executionId, gateEvidenceDigest: gateEvidenceDigest({ executionId, specDigest, tree: digestAfter, gates: results, unresolvedFailures }),
    contractDigest: await contractDigest(directory),
    at: new Date().toISOString(), allPassed: results.every((gate) => gate.passed) && unresolvedFailures.length === 0, unresolvedFailures,
    cleanupIncomplete: results.some((gate) => gate.leftoverOutcome === "SURVIVED"),
    changedFiles: files, gates: results, resources: await resources(root)
  });
  // The record is committed (atomic rename); only now is the execution no
  // longer in flight. A crash between the two leaves a marker whose
  // executionId matches the record, which currentIdentity treats as complete.
  haltIfRequested("after-record");
  await rm(join(evidence, IN_PROGRESS), { force: true });
  const failed = [...new Set([...results.filter((gate) => !gate.passed && !gate.skipped).map((gate) => gate.name), ...unresolvedFailures.map((spec) => spec.name)])];
  if (unresolvedFailures.length) console.error(`  still failed from earlier in round ${run.round}, not observed passing since (same name and command): ${unresolvedFailures.map((spec) => spec.name).join(", ")}`);
  await checkpoint(directory, "VERIFYING", { checkpoint: failed.length ? `gates failed: ${failed.join(", ")}` : "gates passed", digest: digestAfter, executionId });
  console.log(JSON.stringify({ runId: id, allPassed: failed.length === 0, failed, changedFiles: files.length, executionId, evidence: relative(root, gatesPath) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

// Who produced a review: an opaque label the orchestrator passes (`--by`),
// kept with the record and shown by status and verdict. The harness never
// branches on it; it cannot verify it either.
export const REVIEWER = /^[A-Za-z0-9][A-Za-z0-9_.:@+\/-]{0,63}$/;

async function critic(root, args) {
  const { flags, rest: [id, lens, source] } = parseFlags(args, { by: "value", evidence: "value" });
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  if (!lens || !source) throw new UsageError("Usage: critic <run-id> <lens> <file|-> [--by <reviewer>] [--evidence <digest>]");
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(lens)) throw new UsageError("Lens must match [A-Za-z0-9_.-]{1,32}");
  if (flags.by !== undefined && !REVIEWER.test(flags.by)) throw new UsageError(`--by must match ${REVIEWER.source}`);
  if (flags.evidence !== undefined && !/^[0-9a-f]{64}$/.test(flags.evidence)) throw new UsageError("--evidence must be an evidence digest (64 hex characters, as status prints it)");
  await assertNoPendingArchive(directory, run, id);
  const { record, identity, interrupted } = await currentIdentity(directory, root);
  if (!record) throw new UsageError(noGatesMessage("Critic result", interrupted) ?? "Critic result rejected: no gates recorded — hard gates come before critique");
  if (!allGatesPassed(record)) throw new UsageError("Critic result rejected: objective gates failed — fix the gates before spending critique");
  if (record.digest !== identity.tree) throw new UsageError("Critic result rejected: the tree changed after the gates ran — rerun gates first");
  assertGateEvidence(record, "Critic result");
  assertNoContractGap(identity, "Critic result");
  // A review that ran for a while may have read another candidate: pinned to
  // the identity it was handed, it is refused once that identity moved.
  if (flags.evidence !== undefined && flags.evidence !== identity.evidence) {
    throw new UsageError(`Critic result rejected: it was produced against evidence ${flags.evidence.slice(0, 12)}…, the current evidence is ${String(identity.evidence).slice(0, 12)}… — the tree, the contract or the gate execution changed while it was reviewing; run that critic again`);
  }
  const result = validateCriticResult(parseReviewJson(await readInput(source), "Critic result"));
  const stored = { lens, ...(flags.by !== undefined ? { reviewer: flags.by } : {}), recordedAt: new Date().toISOString(), evidenceDigest: identity.evidence, treeDigest: identity.tree, contractDigest: identity.contract, specDigest: identity.spec, gateEvidenceDigest: identity.gateEvidence, ...result };
  await invalidateVerdict(directory, `critic ${lens}`);
  const criticPath = join(directory, "evidence", `critic-${lens}.json`);
  if (await exists(criticPath)) {
    // The replaced result stays on record with its round (moved by correction).
    await mkdir(join(directory, "evidence", "replaced"), { recursive: true });
    await rename(criticPath, join(directory, "evidence", "replaced", `critic-${lens}-${Date.now()}-${randomBytes(3).toString("hex")}.json`));
  }
  const judgePath = join(directory, "evidence", "judge.json");
  if (await exists(judgePath)) {
    // The judge adjudicated critic findings by reference; a re-recorded critic
    // changes those references, so the adjudication no longer applies.
    await rename(judgePath, join(directory, "evidence", `judge.invalidated-${Date.now()}.json`));
    console.error(`  judge.json invalidated: critic ${lens} recorded after the judge`);
  }
  await writeJson(join(directory, "evidence", `critic-${lens}.json`), stored);
  const material = result.gaps.filter((gap) => MATERIAL.has(gap.severity)).length;
  await checkpoint(directory, "CRITIQUE", { checkpoint: `critic ${lens} recorded (${result.gaps.length} gaps, ${material} material)`, digest: identity.tree, evidenceDigest: identity.evidence });
  console.log(JSON.stringify({ runId: id, lens, gaps: result.gaps.length, material, evidenceDigest: identity.evidence }, null, 2));
}

async function judge(root, [id, source]) {
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  if (!source) throw new UsageError("Usage: judge <run-id> <file|->");
  await assertNoPendingArchive(directory, run, id);
  const { record, identity, interrupted } = await currentIdentity(directory, root);
  if (!record) throw new UsageError(noGatesMessage("Judge result", interrupted) ?? "Judge result rejected: no gates recorded");
  if (!allGatesPassed(record)) throw new UsageError("Judge result rejected: objective gates failed — fix the gates before spending adjudication");
  if (record.digest !== identity.tree) throw new UsageError("Judge result rejected: the tree changed after the gates ran — rerun gates first");
  assertGateEvidence(record, "Judge result");
  assertNoContractGap(identity, "Judge result");
  const criticsBefore = await criticRecordsDigest(directory);
  const { current: critics } = await loadCritics(directory, identity.evidence);
  assertValidCriticRecords(critics, "Judge result");
  if (!critics.length) throw new UsageError("Judge result rejected: no critic result recorded for this evidence identity (tree + contract + gate execution) — the judge adjudicates current critic findings");
  const result = validateJudgeResult(parseReviewJson(await readInput(source), "Judge result"));
  const refs = new Set(critics.flatMap((entry) => entry.gaps.map((_, index) => `${entry.lens}#${index}`)));
  for (const finding of result.findings) {
    if (finding.ref && !refs.has(finding.ref)) throw new UsageError(`Judge finding references unknown critic gap: ${finding.ref}`);
  }
  if ((await criticRecordsDigest(directory)) !== criticsBefore) throw new UsageError("Judge result rejected: a critic was recorded while the judge result was being checked — rerun the judge against the current critics");
  await invalidateVerdict(directory, "judge");
  await writeJson(join(directory, "evidence", "judge.json"), { recordedAt: new Date().toISOString(), evidenceDigest: identity.evidence, criticsDigest: criticsBefore, treeDigest: identity.tree, contractDigest: identity.contract, specDigest: identity.spec, gateEvidenceDigest: identity.gateEvidence, ...result });
  await checkpoint(directory, "CRITIQUE", { checkpoint: `judge recorded (${result.findings.length} findings)`, digest: identity.tree, evidenceDigest: identity.evidence });
  console.log(JSON.stringify({ runId: id, findings: result.findings.length }, null, 2));
}

// A critic or judge recorded after the verdict changes what the verdict was
// derived from — a replaced critic may drop or add gaps, a judge re-grades
// them — while the evidence identity (tree + contract + gate execution) stays
// the same, so the identity check alone would keep the old verdict current.
// Invalidated before the new record is written: a crash in between leaves no
// verdict, never a verdict that no longer matches the reviews.
async function invalidateVerdict(directory, cause) {
  const path = join(directory, "evidence", "verdict.json");
  if (!(await exists(path))) return;
  await rename(path, join(directory, "evidence", `verdict.invalidated-${Date.now()}.json`));
  console.error(`  verdict.json invalidated: ${cause} recorded after the verdict — rerun verdict`);
}

// A persisted critic record is re-validated before it is used: a corrupted,
// hand-edited or older record (an unknown severity would otherwise fall into
// the backlog) is refused rather than read as fewer material gaps.
function criticRecordProblem(entry) {
  if (entry.reviewer !== undefined && (typeof entry.reviewer !== "string" || !REVIEWER.test(entry.reviewer))) return "has a malformed reviewer label";
  try { validateCriticResult({ gaps: entry.gaps, summary: entry.summary, ...(entry.verified !== undefined ? { verified: entry.verified } : {}) }); } catch (error) {
    return `is malformed (${error.message})`;
  }
  return null;
}

function assertValidCriticRecords(critics, role) {
  for (const entry of critics) {
    const problem = criticRecordProblem(entry);
    if (problem) throw new UsageError(`${role} rejected: the persisted critic-${entry.lens}.json ${problem} — re-record that critic`);
  }
}

// Critic files split into those recorded for the evidence digest and stale
// ones. `undefined` lists every file as current (inventory only); `null`
// (no current identity) makes every file stale.
async function loadCritics(directory, evidenceDigest) {
  const evidence = join(directory, "evidence");
  if (!(await exists(evidence))) return { current: [], stale: [] };
  const entries = (await readdir(evidence)).filter((name) => /^critic-.+\.json$/.test(name)).sort();
  const current = [];
  const stale = [];
  for (const name of entries) {
    const entry = await readJson(join(evidence, name));
    const fresh = evidenceDigest === undefined || (typeof evidenceDigest === "string" && entry.evidenceDigest === evidenceDigest);
    (fresh ? current : stale).push(entry);
  }
  return { current, stale };
}

// The exact review records a verdict is derived from: every critic file and
// the judge file in evidence/, by content. A verdict counts only while they
// are unchanged — a critic or judge recorded concurrently with `verdict`
// (after it read the reviews) shares the evidence identity, so the identity
// alone would keep a verdict derived from the replaced records current.
async function reviewsDigest(directory, { judge = true } = {}) {
  const evidence = join(directory, "evidence");
  const names = (await readdir(evidence).catch(() => [])).filter((name) => /^critic-.+\.json$/.test(name) || (judge && name === "judge.json")).sort();
  const hash = createHash("sha256");
  for (const name of names) {
    const bytes = await readFile(join(evidence, name)).catch(() => null);
    hash.update(`${name}\0`);
    hash.update(bytes === null ? "gone" : createHash("sha256").update(bytes).digest("hex"));
  }
  return hash.digest("hex");
}

// A judge adjudicates critic findings by reference ("general#0"), so it is
// bound to the exact critic records it read: a critic replaced concurrently
// shares the evidence identity, and an old decision must never land on a new
// finding at the same index.
const criticRecordsDigest = (directory) => reviewsDigest(directory, { judge: false });

// The reviewer label of each current critic that was recorded with one. A
// label the harness would not have written is never echoed: `status` lists
// that record under `malformedCritics` instead, and `verdict` refuses it.
function reviewersOf(critics) {
  return Object.fromEntries(critics.filter((entry) => typeof entry.reviewer === "string" && REVIEWER.test(entry.reviewer)).map((entry) => [entry.lens, entry.reviewer]));
}

// A recorded verdict is current only for the evidence identity it was computed
// under and the review records it read.
async function verdictCurrent(directory, verdict, identity) {
  return Boolean(verdict?.identity?.evidence) && verdict.identity.evidence === identity.evidence
    && typeof verdict.reviewsDigest === "string" && verdict.reviewsDigest === (await reviewsDigest(directory));
}

async function previousVerdict(directory, round) {
  if (round === 0) return null;
  const path = join(directory, "evidence", "rounds", String(round - 1), "verdict.json");
  return (await exists(path)) ? await readJson(path) : null;
}

async function verdict(root, [id]) {
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  const evidence = join(directory, "evidence");
  await assertNoPendingArchive(directory, run, id);
  const { record: gatesRecord, identity, interrupted } = await currentIdentity(directory, root);
  if (!gatesRecord) throw new UsageError(noGatesMessage("Verdict", interrupted) ?? "No gates recorded — run gates before asking for a verdict");
  if (gatesRecord.digest !== identity.tree) throw new UsageError("Evidence is stale: the tree changed after the gates ran — rerun gates first");
  assertGateEvidence(gatesRecord, "Verdict");
  assertNoContractGap(identity, "Verdict");
  const digest = identity.tree;
  const previousRecorded = await previousVerdict(directory, run.round);
  // A gate that failed in the previous round must be observed passing now —
  // unless the contract was replaced since and the gate is no longer in the
  // package (a recorded scope decision). An unobserved one is an explicit gap,
  // so the verdict says why it is not PASS and --approved can act on it.
  const contractChanged = Boolean(previousRecorded?.identity?.contract) && previousRecorded.identity.contract !== identity.contract;
  const inSpec = new Set(gatesRecord.gates.map((gate) => gate.name));
  // The previous round's failures, by name and command (an older verdict
  // recorded names only). Under a replaced contract the package may redefine
  // a gate, so they match by name and those no longer in it are dropped.
  const previousSpecs = previousRecorded ? (previousRecorded.failedGateSpecs ?? (previousRecorded.failedGates ?? []).map((name) => ({ name, command: null }))) : [];
  const previousFailures = contractChanged ? previousSpecs.filter((spec) => inSpec.has(spec.name)).map((spec) => ({ name: spec.name, command: null })) : previousSpecs;
  const previous = previousRecorded ? { ...previousRecorded, failedGates: [...new Set(previousFailures.map((spec) => spec.name))] } : previousRecorded;
  const roundCarried = (gatesRecord.unresolvedFailures ?? []).map((entry) => failureSpec(entry, gatesRecord.gates));
  const executed = gatesRecord.gates.filter((gate) => !gate.skipped);
  const carried = [
    ...roundCarried.map((spec) => ({ ...spec, carried: "round" })),
    ...previousFailures.filter((spec) => !executed.some((gate) => sameGate(spec, gate) && gatePassed(gate)) && !executed.some((gate) => sameGate(spec, gate)) && !roundCarried.some((other) => other.name === spec.name)).map((spec) => ({ ...spec, carried: "previous" }))
  ];
  const failing = gatesRecord.gates.filter((gate) => !gatePassed(gate) && !gate.skipped);
  const failed = [...failing, ...carried];
  const failedGates = [...new Set(failed.map((gate) => gate.name))];
  const carriedNames = new Set(carried.map((spec) => spec.name));
  // A same-name pass of another command is not the failed gate passing: it does not count for convergence either.
  const passedGates = gatesRecord.gates.filter(gatePassed).map((gate) => gate.name).filter((name) => !carriedNames.has(name));
  const failedGateSpecs = uniqueSpecs(failed.map((gate) => ({ name: gate.name, command: gate.command ?? null })));

  let gaps = failed.filter((gate, index) => failed.findIndex((other) => other.name === gate.name) === index).map((gate) => ({
    ref: `gate:${gate.name}`, severity: "CRITICAL", contract: "objective gate", evidence: `evidence/gates/${gate.name}.log`,
    description: gate.carried === "round" ? `Objective gate failed: ${gate.name} — failed earlier in this round and not observed passing since (dropped, renamed or skipped proves nothing); rerun it, or replace the contract if the gate no longer belongs to it`
      : gate.carried === "previous" ? `Objective gate failed: ${gate.name} — failed in round ${run.round - 1} and not observed passing since (dropped, renamed or skipped proves nothing); rerun it, or replace the contract if the gate no longer belongs to it`
      : gate.leftoverOutcome === "SURVIVED" ? `Objective gate failed: ${gate.name} — processes it started survived SIGKILL (cleanup incomplete); end them and rerun gates` : `Objective gate failed: ${gate.name}`
  }));
  let backlog = [];
  let dismissed = [];
  let critics = { current: [], stale: [] };
  let judgeRecord = null;
  let judgeStale = false;
  let pending = { pending: 0, missingLenses: [] };
  let pendingJudge = false;
  const reviewsBefore = await reviewsDigest(directory);
  if (!failedGates.length) {
    critics = await loadCritics(directory, identity.evidence);
    assertValidCriticRecords(critics.current, "Verdict");
    pending = pendingCriticsFor(run, critics.current);
    const judgePath = join(evidence, "judge.json");
    const storedJudge = (await exists(judgePath)) ? await readJson(judgePath) : null;
    judgeStale = Boolean(storedJudge && (storedJudge.evidenceDigest !== identity.evidence || storedJudge.criticsDigest !== (await criticRecordsDigest(directory))));
    judgeRecord = storedJudge && !judgeStale ? storedJudge : null;
    // A persisted judge record is re-validated before adjudication: a file
    // with duplicate refs (older harness, hand edit) would otherwise be
    // applied order-dependently. Ambiguous input never reaches applyJudge.
    if (judgeRecord) {
      try { validateJudgeResult({ findings: judgeRecord.findings, summary: judgeRecord.summary }); } catch (error) { throw new UsageError(`verdict rejected: the persisted judge.json is malformed (${error.message}) — re-record the judge`); }
    }
    pendingJudge = run.judgeRequired && !judgeRecord;
    const criticGaps = critics.current.flatMap((entry) => entry.gaps.map((gap, index) => ({ ref: `${entry.lens}#${index}`, ...gap })));
    const judged = applyJudge(criticGaps, judgeRecord);
    gaps = judged.gaps.filter((gap) => MATERIAL.has(gap.severity));
    backlog = judged.gaps.filter((gap) => !MATERIAL.has(gap.severity));
    dismissed = judged.dismissed;
  }
  // The reviews read above must be the ones on disk now: a critic or judge
  // recorded while this verdict was being derived would otherwise leave a
  // verdict that looks current but reflects the replaced records.
  if ((await reviewsDigest(directory)) !== reviewsBefore) throw new UsageError("Verdict refused: a critic or judge was recorded while the verdict was being derived — rerun verdict");
  const trend = convergence({ round: run.round, previous, currentFailedGates: failedGates, currentPassedGates: passedGates, currentMaterialCount: gaps.length });
  const status = decideStatus({ failedGates, pendingCritics: pending.pending, pendingJudge, materialCount: gaps.length, trend });
  const record = {
    runId: id, tier: run.tier, round: run.round, at: new Date().toISOString(), digest,
    identity: { tree: identity.tree, contract: identity.contract, spec: identity.spec, gateEvidence: identity.gateEvidence, evidence: identity.evidence },
    status, result: status === "PASS" ? "FIT_FOR_PURPOSE" : null, perfect: false,
    failedGates, failedGateSpecs, passedGates, materialCount: gaps.length, gaps, backlog, dismissed,
    critics: {
      required: run.criticsRequired, lenses: run.lenses ?? [], recorded: critics.current.map((entry) => entry.lens), reviewers: reviewersOf(critics.current),
      stale: critics.stale.map((entry) => entry.lens), pending: pending.pending, missingLenses: pending.missingLenses
    },
    judge: { required: run.judgeRequired, recorded: Boolean(judgeRecord), stale: judgeStale, pending: pendingJudge },
    convergence: trend, budget: run.budget, roundsRemaining: Math.max(0, run.budget - run.round), evidenceFormat: EVIDENCE_FORMAT,
    reviewsDigest: reviewsBefore
  };
  // A material verdict closes the round to other candidates (see gates) —
  // recorded before the verdict, so a crash in between leaves the round
  // closed, never a material verdict with an open round. A PASS (only
  // reachable on the round's own candidate) reopens it.
  const material = ["GAP", "STAGNATING", "REGRESSION"].includes(status);
  if (material) await writeJson(join(directory, "run.json"), { ...run, roundGap: { round: run.round, tree: digest, contract: identity.contract, status } });
  await writeJson(join(evidence, "verdict.json"), record);
  if (status === "PASS" && run.roundGap) await writeJson(join(directory, "run.json"), { ...run, roundGap: null });
  await checkpoint(directory, status, { checkpoint: "verdict", digest, evidenceDigest: identity.evidence });
  console.log(JSON.stringify(record, null, 2));
}

async function correction(root, args) {
  const { flags, rest } = parseFlags(args, { approved: "value" });
  const [id] = rest;
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  const evidence = join(directory, "evidence");
  const archive = join(evidence, "rounds", String(run.round));
  const archived = (await exists(archive)) ? await readdir(archive) : [];
  const verdictPath = join(evidence, "verdict.json");
  // Recovery: a previous attempt moved the files but crashed before run.json was written.
  const recovering = archived.includes("verdict.json") && !(await exists(verdictPath));
  if (archived.length && !recovering) {
    throw new UsageError(`Correction rejected: evidence/rounds/${run.round} already holds files while the current round still has a verdict — inspect and resolve by hand`);
  }
  const current = recovering ? await readJson(join(archive, "verdict.json")) : (await exists(verdictPath)) ? await readJson(verdictPath) : null;
  if (!current) throw new UsageError("No verdict recorded — compute a verdict before opening a correction round");
  // A round may only open on a verdict that belongs to the current evidence
  // identity: gaps found for another contract, tree or verification package
  // are not this candidate's gaps. Recovery resumes a transition that was
  // already legitimately started (its evidence is mid-move to rounds/<n>/),
  // so the check is skipped there.
  if (recovering) {
    // Recovery may only complete a transition that a current verdict started:
    // an archived verdict with no evidence identity (older harness, or a
    // stray file) proves nothing about this round and must not open one.
    if (!current.identity?.evidence || current.runId !== id) {
      throw new UsageError(`Correction rejected: evidence/rounds/${run.round}/verdict.json ${current.runId !== id ? `belongs to run ${current.runId ?? "?"}` : "has no evidence identity"}, so this is not a resumable transition — inspect and resolve by hand: remove or move that stray archive, then rerun gates and verdict for the current round`);
    }
  } else {
    const { identity } = await currentIdentity(directory, root);
    const sameReviews = typeof current.reviewsDigest === "string" && current.reviewsDigest === (await reviewsDigest(directory));
    const exact = sameReviews && Boolean(current.identity?.evidence) && current.identity.evidence === identity.evidence;
    // The fix made before the round was opened: the round's material verdict
    // closed it (gates refuse another candidate), so nothing was re-verified
    // and the round's evidence is still that verdict's own — the same
    // contract and the same gate execution. It may open the round; a
    // different contract or gate execution makes its gaps someone else's.
    const fixedAhead = !exact && sameReviews && Boolean(current.identity?.evidence) && current.evidenceFormat === EVIDENCE_FORMAT
      && current.identity.contract === identity.contract && Boolean(identity.gateEvidence) && current.identity.gateEvidence === identity.gateEvidence
      && run.roundGap?.round === run.round && run.roundGap.tree === current.identity.tree;
    if (!exact && !fixedAhead) {
      throw new UsageError("Correction rejected: the verdict is stale — the contract, the gate evidence (specification, timeout, or a re-execution) or the review records it read changed since it was computed, or the tree changed without the round being closed by it. Rerun gates and verdict first; a round only opens on a current verdict");
    }
  }
  if (current.status === "PASS") throw new UsageError("Correction rejected: the verdict is PASS");
  if (current.status === "CRITIQUE") throw new UsageError("Correction rejected: independent review is still pending");
  if (!current.gaps.some((gap) => MATERIAL.has(gap.severity))) throw new UsageError("Correction rejected: no material gap (MINOR and POLISH go to backlog)");
  const approved = flags.approved?.trim() || null;
  if (flags.approved !== undefined && !approved) throw new UsageError("--approved needs the recorded human decision, not an empty string");
  const overBudget = run.round >= run.budget;
  const stagnating = current.status === "STAGNATING" || current.status === "REGRESSION" || current.convergence === "STAGNATING" || current.convergence === "REGRESSING";
  if ((overBudget || stagnating) && !approved) {
    const reason = overBudget ? `budget of ${run.budget} correction round(s) exhausted` : `convergence is ${current.status}`;
    throw new UsageError(`Correction rejected: ${reason}. Only an explicit human decision may continue: correction ${id} --approved "<who/why>"`);
  }
  const digest = await treeDigest(root); // may refuse: before anything moves
  // Archive everything that belongs to the closing round, verdict.json first:
  // once it has moved, any interruption is recognisable (and refused by every
  // evidence command) until a rerun of correction completes the move. In
  // recovery mode this finishes what the crashed attempt left behind.
  await mkdir(archive, { recursive: true });
  if (await exists(verdictPath)) await rename(verdictPath, join(archive, "verdict.json"));
  for (const name of await readdir(evidence)) {
    const roundEvidence = /^critic-.+\.json$/.test(name) || /^(judge|verdict)(\.invalidated-\d+)?\.json$/.test(name)
      || name === "gates.json" || name === IN_PROGRESS || name === "gates" || name === "diff.patch" || name === "replaced";
    if (roundEvidence) await rename(join(evidence, name), join(archive, name));
  }
  const nextRun = {
    ...run, round: run.round + 1, roundGap: null,
    humanApprovals: approved ? [...run.humanApprovals, { at: new Date().toISOString(), round: run.round + 1, reason: approved }] : run.humanApprovals
  };
  await writeJson(join(directory, "run.json"), nextRun);
  await checkpoint(directory, "BUILDING", { checkpoint: `correction round ${nextRun.round} opened${recovering ? " (recovered)" : ""}`, digest });
  console.log(JSON.stringify({ runId: id, round: nextRun.round, materialGaps: current.gaps.filter((gap) => MATERIAL.has(gap.severity)), approved }, null, 2));
}

// The block lives in run.json only; verdict.json keeps the evidence-derived
// status so that stagnation/budget guards survive an unblock.
async function block(root, [id, ...reason]) {
  const { directory, run } = await loadRun(root, id);
  assertNotBlocked(run, id);
  const text = reason.join(" ").trim();
  if (!text) throw new UsageError("A concrete blocking reason is required");
  const digest = await treeDigest(root); // may refuse: before any write
  await writeJson(join(directory, "run.json"), { ...run, blocked: { reason: text, at: new Date().toISOString(), round: run.round } });
  await checkpoint(directory, "BLOCKED", { checkpoint: "human decision required", reason: text, digest });
  console.log(`Blocked ${id}: ${text}`);
}

async function unblock(root, args) {
  const { flags, rest } = parseFlags(args, { approved: "value" });
  const [id] = rest;
  const { directory, run } = await loadRun(root, id);
  if (!run.blocked) throw new UsageError(`Run ${id} is not blocked`);
  if (!flags.approved || !flags.approved.trim()) throw new UsageError(`unblock requires the recorded human decision: unblock ${id} --approved "<who/why>"`);
  const decision = { at: new Date().toISOString(), round: run.round, reason: flags.approved, resolves: run.blocked.reason };
  const digest = await treeDigest(root); // may refuse: before any write
  await writeJson(join(directory, "run.json"), { ...run, blocked: null, humanApprovals: [...run.humanApprovals, decision] });
  await checkpoint(directory, "VERIFYING", { checkpoint: "unblocked by human decision", decision: flags.approved, digest });
  console.log(`Unblocked ${id}; rerun gates and verdict to derive the current status`);
}

async function status(root, [id]) {
  const { directory, run, state } = await loadRun(root, id);
  const verdictPath = join(directory, "evidence", "verdict.json");
  const current = (await exists(verdictPath)) ? await readJson(verdictPath) : null;
  const { record: gatesRecord, identity, interrupted } = await currentIdentity(directory, root);
  const runningPid = (await gateLockHolder(directory)).pid;
  const digest = identity.tree;
  const critics = await loadCritics(directory, identity.evidence);
  const judgePath = join(directory, "evidence", "judge.json");
  const storedJudge = (await exists(judgePath)) ? await readJson(judgePath) : null;
  const summary = {
    runId: id, tier: run.tier, round: run.round, budget: run.budget, status: run.blocked ? "BLOCKED" : state.status, checkpoint: state.checkpoint, at: state.at,
    blocked: run.blocked,
    treeChangedSinceCheckpoint: state.digest !== undefined && state.digest !== digest,
    gatesStale: Boolean(gatesRecord && gatesRecord.digest !== digest),
    contract: Boolean(identity.contract),
    contractChangedSinceGates: Boolean(gatesRecord && gatesRecord.contractDigest && gatesRecord.contractDigest !== identity.contract),
    gates: Boolean(gatesRecord),
    gatesPassed: Boolean(gatesRecord && allGatesPassed(gatesRecord)),
    identity: { tree: identity.tree, contract: identity.contract, spec: identity.spec, gateEvidence: identity.gateEvidence, evidence: identity.evidence },
    critics: critics.current.map((entry) => entry.lens),
    reviewers: reviewersOf(critics.current),
    malformedCritics: critics.current.filter((entry) => criticRecordProblem(entry) !== null).map((entry) => typeof entry.lens === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(entry.lens) ? entry.lens : "?"),
    staleCritics: critics.stale.map((entry) => entry.lens),
    lenses: run.lenses ?? [],
    judge: Boolean(storedJudge),
    judgeStale: Boolean(storedJudge && (storedJudge.evidenceDigest !== identity.evidence || storedJudge.criticsDigest !== (await criticRecordsDigest(directory)))),
    verdict: current ? { status: current.status, result: current.result, materialCount: current.materialCount, convergence: current.convergence, stale: !(await verdictCurrent(directory, current, identity)) } : null,
    // A record critic/judge/verdict would refuse as produced under older rules (assertGateEvidence).
    gatesLegacy: Boolean(gatesRecord && (!gatesRecord.gateEvidenceDigest || gatesRecord.evidenceFormat !== EVIDENCE_FORMAT)),
    // A marker without a committed record is an interruption only when no
    // live process holds the gates lock; otherwise the execution is running.
    gatesRunning: runningPid ? { pid: runningPid } : null,
    gatesInterrupted: interrupted && !runningPid ? { executionId: interrupted.executionId, startedAt: interrupted.startedAt, supersedes: interrupted.supersedes } : null,
    orphanedGateProcesses: runningPid ? null : await orphanedGateProcesses(directory),
    unresolvedFailures: gatesRecord?.unresolvedFailures ?? [],
    pendingArchive: (await exists(join(directory, "evidence", "rounds", String(run.round)))) && (await readdir(join(directory, "evidence", "rounds", String(run.round)))).length > 0,
    humanApprovals: run.humanApprovals,
    harness: VERSION,
    history: state.history.map((event) => `${event.at} ${event.status} — ${event.checkpoint ?? ""}`)
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function list(root) {
  const directory = runsDir(root);
  await assertPhysicalState(root, null, "list", { allowMissing: true });
  if (!(await exists(directory))) { console.log("[]"); return; }
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = join(directory, entry.name, "state.json");
    const runPath = join(directory, entry.name, "run.json");
    const state = (await exists(statePath)) ? await readJson(statePath) : {};
    const run = (await exists(runPath)) ? await readJson(runPath) : {};
    rows.push({ runId: entry.name, status: run.blocked ? "BLOCKED" : state.status ?? null, round: run.round ?? null, at: state.at ?? null });
  }
  console.log(JSON.stringify(rows.sort((a, b) => String(b.at).localeCompare(String(a.at))), null, 2));
}

// The only recursive deletion in the harness. A lexical check of the path is
// not enough: if .gauntlet, runs or the run directory itself is a symlink, the
// normalised path still looks like <root>/.gauntlet/runs/<id> while rm would
// recurse into wherever the link points. So every state ancestor must be a
// real directory (lstat, no symlink) and the physical location of the run
// directory must be exactly <physical root>/.gauntlet/runs/<id>. Symlinked
// state is refused rather than followed; correctness over exotic layouts.
// The same boundary applies before state is created (init), loaded (every
// run command) or listed: a symlinked .gauntlet would otherwise put a run
// outside the work tree that `clean` then refuses to dispose of. With
// `allowMissing` (init, list), a missing link in the chain is fine — init
// creates real directories below it.
async function assertPhysicalState(root, directory, action, { allowMissing = false } = {}) {
  const subject = directory ? basename(directory) : ".gauntlet/runs";
  for (const ancestor of [join(root, ".gauntlet"), runsDir(root), ...(directory ? [directory] : [])]) {
    let info;
    try { info = await lstat(ancestor); } catch (error) {
      if (allowMissing && error.code === "ENOENT") return;
      throw new UsageError(`Refusing to ${action} ${subject}: ${relative(root, ancestor)} is not readable`);
    }
    if (info.isSymbolicLink()) throw new UsageError(`Refusing to ${action} ${subject}: ${relative(root, ancestor)} is a symlink; Gauntlet state must be a real directory inside the work tree and is never created, read or deleted through a link`);
    if (!info.isDirectory()) throw new UsageError(`Refusing to ${action} ${subject}: ${relative(root, ancestor)} is not a directory`);
  }
  // Below the run directory, the directories state is written into may be
  // absent, but never links.
  for (const inner of directory ? ["evidence", "evidence/gates", "evidence/rounds", "evidence/replaced"] : []) {
    const info = await lstat(join(directory, inner)).catch(() => null);
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new UsageError(`Refusing to ${action} ${subject}: ${relative(root, join(directory, inner))} is ${info.isSymbolicLink() ? "a symlink" : "not a directory"}; Gauntlet state is never written through a link`);
  }
  const physical = await realpath(directory ?? runsDir(root));
  const expected = join(await realpath(root), ".gauntlet", "runs", ...(directory ? [basename(directory)] : []));
  if (physical !== expected) throw new UsageError(`Refusing to ${action} ${subject}: its physical location (${physical}) is not inside this work tree's .gauntlet/runs`);
}

async function clean(root, args) {
  const { flags, rest } = parseFlags(args, { force: "boolean" });
  const [id] = rest;
  const directory = runDir(root, id);
  if (!(await exists(directory))) throw new UsageError(`Run not found: ${id}`);
  await assertPhysicalState(root, directory, "clean");
  const runPath = join(directory, "run.json");
  const holder = await gateLockHolder(directory);
  if (holder.pid) throw new UsageError(`Refusing to clean ${id}: gates are running for it (pid ${holder.pid})`);
  const run = (await exists(runPath)) ? await readJson(runPath) : null;
  if (run?.blocked && !flags.force) {
    throw new UsageError(`Run ${id} is BLOCKED pending a human decision ("${run.blocked.reason}"); resolve it with unblock, or pass --force to discard the record deliberately`);
  }
  // Take the gates lock first: no execution can start while the run is being
  // removed, and the lock refuses while processes of a gate still live —
  // gates.session is the only record of them, so it must outlive them.
  try { await acquireGateLock(root, directory, id); } catch (error) {
    throw error instanceof UsageError ? new UsageError(`Refusing to clean ${id}: ${error.message}`) : error;
  }
  await rm(directory, { recursive: true, force: true });
  heldGateLock = null;
  console.log(`Removed run ${id}`);
}

const USAGE = `Usage: gauntlet.mjs <command> [...]
  init <run-id> [--tier LIGHT|STANDARD|ELEVATED|CRITICAL] [--lenses a,b] [--budget N] [--critics N] [--judge|--no-judge]
  contract <run-id> <file|->
  checkpoint <run-id> <PLANNED|BUILDING|VERIFYING> [note]
  gates <run-id> [--force] [--timeout <seconds>] <name>=<command> ...
  critic <run-id> <lens> <result.json|-> [--by <reviewer>] [--evidence <digest>]
  judge <run-id> <result.json|->
  verdict <run-id>
  correction <run-id> [--approved "<who/why>"]
  block <run-id> <reason>
  unblock <run-id> --approved "<who/why>"
  status <run-id> | list | clean <run-id> [--force] | digest | version`;

export async function main(argv) {
  const [command, ...args] = argv;
  config();                                   // refuse invalid environment knobs before touching any state
  if (command === "version") { console.log(`gauntlet-harness ${VERSION} node ${process.version}`); return; }
  if (command === undefined || command === "help" || command === "--help") throw new UsageError(USAGE);
  const root = await repoRoot();
  switch (command) {
    case "init": return init(root, args);
    case "contract": return contract(root, args);
    case "checkpoint": return manualCheckpoint(root, args);
    case "gates": return gates(root, args);
    case "critic": return critic(root, args);
    case "judge": return judge(root, args);
    case "verdict": return verdict(root, args);
    case "correction": return correction(root, args);
    case "block": return block(root, args);
    case "unblock": return unblock(root, args);
    case "status": return status(root, args);
    case "list": return list(root);
    case "clean": return clean(root, args);
    case "digest": console.log(await treeDigest(root)); return;
    default: throw new UsageError(USAGE);
  }
}

// Main-module detection must survive being invoked through a symlink (the
// installer links ~/.claude/skills/gauntlet into the repository): Node
// realpaths import.meta.url but leaves argv[1] as typed.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof UsageError ? error.message : (error.stack ?? error.message));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
