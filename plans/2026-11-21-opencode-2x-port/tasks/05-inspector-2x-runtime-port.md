# Task 05 — Inspector takes the v2.3.2 runtime authority

## Objective

The `opencode-permissions` skill inspects an agent's effective policy from `opencode debug agents` JSON (the authority for agent IDs and ordered effective rules, in `action`/`resource`/`effect` form), attributes rule origins from repository-owned documents surfaced by `opencode debug config` plus native agent-file frontmatter, keeps rule order and duplicates, fails clearly on unsupported runtime output, and leaves unverifiable origins visible as unknown.

## Files

- Modify: `skills/opencode-permissions/src/lib/opencode-runtime.ts` (rewrite)
- Modify: `skills/opencode-permissions/src/lib/types.ts` (runtime + report types)
- Modify: `skills/opencode-permissions/src/lib/inspection.ts` (rewrite)
- Modify: `skills/opencode-permissions/src/lib/effective-rules.ts` (rewrite)
- Delete (superseded 1.x merge machinery, `git rm`): `skills/opencode-permissions/src/lib/effective-permissions.ts`, `src/lib/repository-configs.ts`, `src/lib/jsonc.ts`, `src/lib/agent-frontmatter.ts` is **kept** but rewritten to read only native `permissions` arrays (agent files are repository declarations; they do not surface as config documents)
- Modify: `skills/opencode-permissions/src/inspect.ts` (render native fields)
- Modify: `skills/opencode-permissions/references/output-format.md` (native report shapes)
- Delete fixtures: `test/fixtures/agent-list.txt`, `test/fixtures/debug-agent.json`, `test/fixtures/opencode.json` (the JSON-merge world) — keep `fixtures/agent.md`, `fake-git.sh`, `fake-opencode-launcher.sh`
- Create fixtures: `skills/opencode-permissions/test/fixtures/debug-agents.json`, `skills/opencode-permissions/test/fixtures/debug-config.json`
- Modify: `skills/opencode-permissions/test/fixtures/fake-opencode.ts`, `skills/opencode-permissions/test/helpers/inspection-fixtures.ts`
- Test: `skills/opencode-permissions/test/lib/opencode-runtime.test.ts` (rewrite), `test/inspect.test.ts`, `test/inspect.integration.test.ts`, `test/lib/inspection.test.ts` (rewrite), `test/lib/agent-frontmatter.test.ts` (rewrite), delete `test/lib/jsonc.test.ts`, `test/lib/repository-configs.test.ts`; `skills/opencode-permissions/README.md` (architecture + tested baseline)

## Interfaces

- Consumes: none from other tasks (the inspector stays independent of the recorder).
- Produces (task 06's report builder consumes the inspector JSON exactly):
  - Runtime types (`types.ts`):
    ```ts
    export const PERMISSION_EFFECTS = ["allow", "ask", "deny"] as const
    export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number]
    export function isPermissionEffect(value: unknown): value is PermissionEffect
    export interface RuntimeRule { action: string; resource: string; effect: PermissionEffect }
    export interface RuntimeAgentEntry { id: string; name: string; mode: "primary" | "subagent" | "all"; hidden: boolean; permissions: RuntimeRule[] }
    export interface RuntimeConfigDocument {
      type: "document"
      path: string | null
      permissions: RuntimeRule[]
      agents: Record<string, { permissions: RuntimeRule[] }>
    }
    export interface RuntimeConfigDirectory { type: "directory"; path: string }
    export type RuntimeConfigEntry = RuntimeConfigDocument | RuntimeConfigDirectory
    export interface OpenCodeRuntime {
      listAgents(cwd: string): Promise<RuntimeAgentEntry[]>
      readConfigEntries(cwd: string): Promise<RuntimeConfigEntry[]>
    }
    ```
  - Report types (`types.ts`):
    ```ts
    export type RuleScope = "shared" | "agent" | "unknown"
    export interface RuleOrigin { scope: RuleScope; source: string | null }
    export interface EffectiveRule extends RuntimeRule {
      position: number
      origin: RuleOrigin
    }
    export interface EffectiveAgent { id: string; name: string; mode: string; hidden: boolean; rules: EffectiveRule[] }
    export interface AgentListReport { agents: Array<{ id: string; name: string; mode: string; hidden: boolean }> }
    export interface EffectivePolicyReport { agents: EffectiveAgent[] }
    ```
    The 1.x `overrides` chain is dropped: the 2.x runtime concatenates every declaration into the effective order (duplicates included), so supersession is visible directly in rule order — the last matching rule wins — instead of carrying merge metadata.
  - `inspect.sh show-effective [agent] [--json]` JSON = `EffectivePolicyReport` (above), printed via the existing output-file workflow; agent selection is by runtime **agent id**.
  - Human render: `  #<position> <action> <resource> <effect> <origin>` where origin is `<source> (<scope>)` or `(unknown)`.

## Verified 2.x CLI facts

`opencode debug agents` prints one JSON array of the runtime's `Agent.Info` sorted by id: `{ id, name, model?, request, system?, description?, mode: "primary"|"subagent"|"all", hidden, color?, steps?, permissions: [{action, resource, effect}] }` — effective rules in resolved order, duplicates included. `opencode debug config` prints an array of entries, lowest- to highest-priority: `{ type: "document", path, info }` (parsed config documents; `info.permissions` and `info.agents.<id>.permissions` carry native rules) or `{ type: "directory", path }` (discovery directories). Agent Markdown files do **not** surface there; the runtime pushes top-level permissions first (in document order) and then per-agent permissions for each document, so origin attribution walks documents in the printed order. Rule evaluation is last-match-wins with no-match → `ask`. There is no v2 `opencode agent list` / `debug agent` / `debug config`-with-`permission`-map output to fall back on.

- [ ] **Step 1: Write the failing inspector tests**

(a) Create `test/fixtures/debug-agents.json` (the captured v2.3.2 world this feature tests against; three agents exercise shared/agent/unknown origins and duplicates):

```json
[
  {
    "id": "build",
    "name": "build",
    "request": { "settings": {}, "headers": {}, "body": {} },
    "mode": "primary",
    "hidden": false,
    "permissions": [
      { "action": "read", "resource": "*", "effect": "allow" },
      { "action": "webfetch", "resource": "https://docs.example.com/*", "effect": "allow" },
      { "action": "edit", "resource": "opencode.json", "effect": "allow" },
      { "action": "edit", "resource": "opencode.json", "effect": "allow" },
      { "action": "shell", "resource": "git push *", "effect": "ask" }
    ]
  },
  {
    "id": "explore",
    "name": "Explore",
    "request": { "settings": {}, "headers": {}, "body": {} },
    "mode": "subagent",
    "hidden": false,
    "permissions": [
      { "action": "read", "resource": "*", "effect": "allow" },
      { "action": "edit", "resource": "*", "effect": "deny" },
      { "action": "*", "resource": "*", "effect": "deny" }
    ]
  },
  {
    "id": "ghost",
    "name": "ghost",
    "request": { "settings": {}, "headers": {}, "body": {} },
    "mode": "all",
    "hidden": true,
    "permissions": [
      { "action": "read", "resource": "opencode.json", "effect": "allow" },
      { "action": "edit", "resource": "plans/*", "effect": "allow" }
    ]
  }
]
```

(`build` exercises the runtime's push order — the repository document's top-level rules first, then its agent-level rules — plus a duplicate declaration; `explore` carries a rule no repository source declares; `ghost` is the agent-file case.)

(b) Create `test/fixtures/debug-config.json` — the caller's repository root is `${root}`; tests substitute the real temporary root path at setup time via the same replacement mechanism `fake-opencode.ts` uses (`FAKE_OPENCODE_FIXTURE_DIR` + a `FAKE_OPENCODE_REPOSITORY_ROOT` value; the fake reads the fixture and rewrites `${root}` in `path` fields before printing):

```json
[
  {
    "type": "document",
    "path": "${root}/opencode.json",
    "info": {
      "permissions": [
        { "action": "read", "resource": "*", "effect": "allow" },
        { "action": "webfetch", "resource": "https://docs.example.com/*", "effect": "allow" }
      ],
      "agents": {
        "build": {
          "permissions": [
            { "action": "edit", "resource": "opencode.json", "effect": "allow" },
            { "action": "edit", "resource": "opencode.json", "effect": "allow" },
            { "action": "shell", "resource": "git push *", "effect": "ask" }
          ]
        }
      }
    }
  },
  { "type": "directory", "path": "${root}/.opencode" }
```

(c) Replace `test/fixtures/fake-opencode.ts`:

```ts
#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// The inspector tests install this script as `opencode`. The child
// environment supplies the argv log path, fixture directory, and the
// repository root used to expand the captured entry paths.
const argvLogPath = process.env.FAKE_OPENCODE_ARGV_LOG
const fixtureDir = process.env.FAKE_OPENCODE_FIXTURE_DIR
const repositoryRoot = process.env.FAKE_OPENCODE_REPOSITORY_ROOT
if (argvLogPath === undefined || fixtureDir === undefined || repositoryRoot === undefined) {
  process.stderr.write("FAKE_OPENCODE_ARGV_LOG, FAKE_OPENCODE_FIXTURE_DIR, and FAKE_OPENCODE_REPOSITORY_ROOT must be set\n")
  process.exit(1)
}

const argv = process.argv.slice(2)
writeFileSync(argvLogPath, JSON.stringify(argv) + "\n")

const key = argv.join(" ")
if (key === "debug agents") {
  process.stdout.write(readFileSync(join(fixtureDir, "debug-agents.json"), "utf8"))
} else if (key === "debug config") {
  const expanded = readFileSync(join(fixtureDir, "debug-config.json"), "utf8").replaceAll("${root}", repositoryRoot)
  process.stdout.write(expanded)
} else {
  process.stderr.write("no canned response for " + key + "\n")
  process.exit(1)
}
```

(d) Rewrite `test/helpers/inspection-fixtures.ts` around the new runtime and reports: `createFakeRuntime()` serves `listAgents()` from `debug-agents.json` parsed as `RuntimeAgentEntry[]` and `readConfigEntries()` from `debug-config.json` with `${root}` replaced by the shared fixture repository root; `createFixtureRepository()` keeps creating a temporary git-initialized repository (`.git`, `opencode.json` — keep the *native* fixture file below) and writes `.opencode/agents/ghost.md` from `fixtures/agent.md`; the inventory/named-status constants and the old `FixtureConfig` type are deleted. New module-level fixture document (write to the fixture repository root as its `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "read", "resource": "*", "effect": "allow" },
    { "action": "webfetch", "resource": "https://docs.example.com/*", "effect": "allow" }
  ],
  "agents": {
    "build": {
      "permissions": [
        { "action": "edit", "resource": "opencode.json", "effect": "allow" },
        { "action": "shell", "resource": "git push *", "effect": "ask" }
      ]
    }
  }
}
```

(e) New `fixtures/agent.md` (native frontmatter for the fixture's repository-declared agent; the runtime already echoes `ghost`'s merged rules in `debug-agents.json`, so the frontmatter is the origin source):

```markdown
---
description: Fixture agent declared by an agent file.
permissions:
  - { action: "read", "resource": "opencode.json", "effect": "allow" }
  - { action: "edit", "resource": "plans/*", "effect": "allow" }
---
You are the fixture agent. This definition exists only so tests can attribute agent-file origins.
```

(f) Rewrite `test/lib/inspection.test.ts` core cases (complete minimum set; keep the file's describe conventions):

```ts
it("lists the agents the runtime reports, with ids and modes, in the runtime's id order", async () => {
  const report = await createAgentListReport({ repositoryRoot, runtime })
  expect(report.agents).toEqual([
    { id: "build", name: "build", mode: "primary", hidden: false },
    { id: "explore", name: "Explore", mode: "subagent", hidden: false },
    { id: "ghost", name: "ghost", mode: "all", hidden: true },
  ])
})

it("reports the effective rules in runtime order with repository origins attributed and duplicates preserved", async () => {
  const report = await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: "build" })
  const rules = report.agents[0].rules
  expect(rules.map((rule) => [rule.position, rule.action, rule.resource, rule.effect])).toEqual([
    [0, "read", "*", "allow"],
    [1, "webfetch", "https://docs.example.com/*", "allow"],
    [2, "edit", "opencode.json", "allow"],
    [3, "edit", "opencode.json", "allow"],
    [4, "shell", "git push *", "ask"],
  ])
  expect(rules[0].origin).toEqual({ scope: "shared", source: "opencode.json" })
  expect(rules[1].origin).toEqual({ scope: "shared", source: "opencode.json" })
  expect(rules[2].origin).toEqual({ scope: "agent", source: "opencode.json" })
  expect(rules[4].origin).toEqual({ scope: "agent", source: "opencode.json" })
})

it("marks rules it cannot attribute to a repository source as unknown without hiding them", async () => {
  const report = await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: "explore" })
  const wildcard = report.agents[0].rules.find((rule) => rule.action === "*")
  expect(wildcard?.origin).toEqual({ scope: "unknown", source: null })
})

it("attributes agent-file rules to the agent definition file", async () => {
  const report = await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: "ghost" })
  const rule = report.agents[0].rules.find((rule) => rule.action === "edit" && rule.resource === "plans/*")
  expect(rule?.origin).toEqual({ scope: "agent", source: ".opencode/agents/ghost.md" })
})

it("attributes each repeated repository declaration to its own position", async () => {
  const report = await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: "build" })
  const duplicated = report.agents[0].rules.filter((rule) => rule.action === "edit" && rule.resource === "opencode.json")
  expect(duplicated.map((rule) => rule.position)).toEqual([2, 3])
  expect(duplicated.map((rule) => rule.origin)).toEqual([
    { scope: "agent", source: "opencode.json" },
    { scope: "agent", source: "opencode.json" },
  ])
})

it("keeps an undeclared same-action rule unknown even when a shared rule for another resource exists", async () => {
  const report = await createEffectivePolicyReport({ repositoryRoot, runtime, agentName: "explore" })
  const denied = report.agents[0].rules.find((rule) => rule.action === "edit" && rule.resource === "*")
  expect(denied?.origin).toEqual({ scope: "unknown", source: null })
})

it("fails clearly when the runtime reports an unsupported agent mode", async () => {
  const broken = createFakeRuntimeWithAgentOverride({ mode: "sideways" })
  await captureRejection(createAgentListReport({ repositoryRoot, runtime: broken }))
})
```

(Also keep: an agent-not-in-inventory case asserting the existing `AGENT_NOT_IN_INVENTORY` code path with the new id-based message, and a case where one config document's `path` lies outside the repository root — serve an extra entry with `path` under a second temporary directory whose `info.permissions` declare one of the effective rules — leaving that rule's origin unknown, because only repository-owned documents may claim an origin.)

(g) Rewrite `test/lib/opencode-runtime.test.ts` around the two commands. Keep the file's existing fake-execFile/fake-spawn helpers, its environment-sanitization assertions, its stdout-to-file assertions, and its `OPENCODE_UNAVAILABLE` (ENOENT) case, update the recorded command arrays to the new exact args, and replace the parser cases with complete new tests:

```ts
const AGENTS_JSON = readFileSync(join(fixturesDir, "debug-agents.json"), "utf8")
const CONFIG_JSON = readFileSync(join(fixturesDir, "debug-config.json"), "utf8")

it("lists agents and their ordered rules from the debug agents command", async () => {
  const fake = createFakeExecFile({ "debug agents": AGENTS_JSON })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const agents = await runtime.listAgents("/worktrees/portfolio-app")
  expect(agents.map((agent) => [agent.id, agent.hidden, agent.permissions.length])).toEqual([
    ["build", false, 5],
    ["explore", false, 3],
    ["ghost", true, 2],
  ])
  expect(fake.calls[0].args).toEqual(["debug", "agents"])
})

it("reads config documents and directories from the debug config command", async () => {
  const fake = createFakeExecFile({ "debug config": CONFIG_JSON.replaceAll("${root}", "/worktrees/portfolio-app") })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const entries = await runtime.readConfigEntries("/worktrees/portfolio-app")
  expect(entries).toEqual([
    {
      type: "document",
      path: "/worktrees/portfolio-app/opencode.json",
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "webfetch", resource: "https://docs.example.com/*", effect: "allow" },
      ],
      agents: {
        build: {
          permissions: [
            { action: "edit", resource: "opencode.json", effect: "allow" },
            { action: "edit", resource: "opencode.json", effect: "allow" },
            { action: "shell", resource: "git push *", effect: "ask" },
          ],
        },
      },
    },
    { type: "directory", path: "/worktrees/portfolio-app/.opencode" },
  ])
  expect(fake.calls[0].args).toEqual(["debug", "config"])
})

it("rejects runtime output that is not one JSON array of agents", async () => {
  const fake = createFakeExecFile({ "debug agents": `{"agents": []}` })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const error = await captureRejection(runtime.listAgents("/w"))
  expect(error.message).toContain("expected a JSON array")
})

it("rejects an agent entry with an unsupported mode", async () => {
  const broken = JSON.parse(AGENTS_JSON) as Array<Record<string, unknown>>
  broken[0].mode = "sideways"
  const fake = createFakeExecFile({ "debug agents": JSON.stringify(broken) })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const error = await captureRejection(runtime.listAgents("/w"))
  expect(error.message).toContain("unsupported mode")
})

it("rejects an entry whose permission has an effect outside allow, ask, and deny", async () => {
  const broken = JSON.parse(AGENTS_JSON) as Array<Record<string, unknown>>
  const permissions = broken[0].permissions as Array<Record<string, unknown>>
  permissions[0].effect = "maybe"
  const fake = createFakeExecFile({ "debug agents": JSON.stringify(broken) })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const error = await captureRejection(runtime.listAgents("/w"))
  expect(error.message).toContain("expected one of allow|ask|deny")
})

it("rejects a config entry whose permissions are not an array", async () => {
  const broken = JSON.parse(CONFIG_JSON) as Array<Record<string, unknown>>
  ;(broken[0].info as Record<string, unknown>).permissions = "allow everything"
  const fake = createFakeExecFile({ "debug config": JSON.stringify(broken) })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const error = await captureRejection(runtime.readConfigEntries("/w"))
  expect(error.message).toContain("must be an array")
})

it("preserves duplicate rules and runtime order exactly", async () => {
  const fake = createFakeExecFile({ "debug agents": AGENTS_JSON })
  const runtime = createOpenCodeRuntime({ execFile: fake.execFile })
  const [build] = await runtime.listAgents("/w")
  expect(build.permissions.filter((rule) => rule.action === "edit")).toEqual([
    { action: "edit", resource: "opencode.json", effect: "allow" },
    { action: "edit", resource: "opencode.json", effect: "allow" },
  ])
})
```

(Reuse the file's `captureRejection` helper or add it from `test/helpers/inspection-fixtures.ts`.) Cases exercising pipe truncation and the two-attempt retry are deleted — `debug agents` prints one JSON document, so the block-parser and truncation machinery is gone; the stdout-to-file capture stays.

(h) Update `test/inspect.test.ts` and `test/inspect.integration.test.ts` to the new report shapes:
- `inspect.test.ts`: `parseArgs`/`resolveWrapperRepositoryRoot` cases are unchanged; replace every `renderListAgents`/`renderEffectivePolicy` expectation with the fixture world's new lines (list: `build (primary)` with explore's `explore (subagent, Explore)` and `ghost (all, hidden)`; show-effective for build: `  #0 read * allow opencode.json (shared)`, `  #2 edit opencode.json allow opencode.json (agent)`; for explore: `  #2 * * deny (unknown)` at the wildcard's own position; for ghost: `  #0 read opencode.json allow .opencode/agents/ghost.md (agent)`), and update the `--json` shape assertions to the Produces reports (id/mode/hidden agents; rules with position/origin, no overrides).
- `inspect.integration.test.ts`: keep the wrapper mechanics and the fake-CLI installation, add `FAKE_OPENCODE_REPOSITORY_ROOT` to the child environment the launcher exports (the fake CLI rewrites `${root}` in the config fixture with it), and assert end to end: `inspect.sh list-agents` prints `output file: .temp/permission-inspect-output-*` whose human body lists the three fixture agents in id order, and `inspect.sh show-effective build --json` whose JSON equals the attribution outcome from step 1(f) (positions 0–4 with the origins asserted there). Any case asserting the legacy `status` field is deleted (the runtime no longer exposes native/custom).

- [ ] **Step 2: Run the inspector tests to verify they fail**

Run: `bun test skills/opencode-permissions`
Expected: FAIL (`opencode-runtime.ts` still runs the 1.x commands).

- [ ] **Step 3: Write the implementation**

(a) `src/lib/types.ts` — apply both Produces type sets. Delete `PERMISSION_ACTIONS`/`PermissionAction` (replaced by `PERMISSION_EFFECTS`/`PermissionEffect`), `AgentListEntry`, `ResolvedConfig`, `ResolvedAgentConfig`, `PermissionRule`, `AgentStatus`, `Scope`, `RuleOrigin` old shape, `DeclarationTuple`, `EffectivePermission`, `PermissionDeclarations`, `RepositoryConfig`, `InspectArgs` keeps. (`AgentListReport`/`EffectivePolicyReport`/`AgentListReport` field shapes change as specified.)

(b) `src/lib/opencode-runtime.ts` — rewrite (complete new content):

```ts
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import { env as processEnv } from "node:process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChildProcess } from "node:child_process"
import { toAbsolutePath } from "./absolute-path"
import { isPermissionEffect } from "./types"
import type { OpenCodeRuntime, RuntimeAgentEntry, RuntimeConfigEntry, RuntimeRule } from "./types"

const DEFAULT_TIMEOUT_MS = 15_000
const OPENCODE_UNAVAILABLE_MESSAGE = "opencode is not installed or not on PATH; install OpenCode and retry"
const SUPPORTED_MODES = new Set(["primary", "subagent", "all"])

/** Injected child-process and environment settings for the CLI adapter. */
export type OpenCodeRuntimeDeps = {
  execFile: typeof import("node:child_process").execFile
  spawn?: typeof import("node:child_process").spawn
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

type UnknownRecord = Record<string, unknown>
type ExecFileRunner = OpenCodeRuntimeDeps["execFile"]
type SpawnRunner = NonNullable<OpenCodeRuntimeDeps["spawn"]>
type RunCommand = (operation: string, args: string[], cwd: string) => Promise<string>

const MINIMAL_PLATFORM_VARS = new Set(["PATH", "HOME", "USER", "TMPDIR", "TMP", "TEMP", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME"])

/**
 * Create a read-only adapter over the installed OpenCode 2.x CLI. Every
 * method runs `opencode` through an injected child-process runner in the
 * requested working directory with a sanitized environment and a finite
 * timeout, and validates every external value before returning it. Production
 * calls capture stdout in a regular file because the CLI can truncate large
 * responses sent through a pipe. The adapter only ever constructs the two
 * approved command arrays: `debug agents` for the agent inventory and their
 * ordered effective rules, and `debug config` for the configuration documents
 * and discovery sources, lowest to highest priority. A missing `opencode`
 * executable raises `OPENCODE_UNAVAILABLE`; invalid or unsupported runtime
 * output raises `OPENCODE_OUTPUT_INVALID_JSON` or
 * `OPENCODE_CONTRACT_UNSUPPORTED` naming the offending field.
 */
export function createOpenCodeRuntime({ execFile, spawn, env, timeoutMs = DEFAULT_TIMEOUT_MS }: OpenCodeRuntimeDeps): OpenCodeRuntime {
  validateTimeout(timeoutMs)
  const sanitizedEnv = sanitizeEnvironment(env === undefined ? processEnv : env)
  const runCommand = createCommandRunner(execFile, spawn, sanitizedEnv, timeoutMs)
  return {
    async listAgents(cwd) {
      const stdout = await runCommand("listAgents", ["debug", "agents"], cwd)
      return parseAgentArray(stdout, "listAgents")
    },
    async readConfigEntries(cwd) {
      const stdout = await runCommand("readConfigEntries", ["debug", "config"], cwd)
      return parseConfigEntries(stdout, "readConfigEntries")
    },
  }
}

function validateTimeout(timeoutMs: number): void {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`createOpenCodeRuntime: timeoutMs must be a positive finite number, got ${timeoutMs}`)
  }
}

function createCommandRunner(execFile: ExecFileRunner, spawn: SpawnRunner | undefined, env: Record<string, string>, timeoutMs: number): RunCommand {
  return async (operation, args, cwd) => {
    try {
      return spawn === undefined
        ? await runExecFile(execFile, args, cwd, env, timeoutMs)
        : await runSpawnWithFileOutput(spawn, args, cwd, env, timeoutMs)
    } catch (cause) {
      throw executionError(operation, args, cause)
    }
  }
}

async function runSpawnWithFileOutput(spawn: SpawnRunner, args: string[], cwd: string, env: Record<string, string>, timeout: number): Promise<string> {
  const tempRoot = join(tmpdir(), "opencode-permissions")
  await mkdir(tempRoot, { recursive: true })
  const tempDirectory = await mkdtemp(join(tempRoot, "opencode-permissions-"))
  const outputPath = toAbsolutePath(join(tempDirectory, "stdout"), "stdout capture path")
  const outputFile = await open(outputPath, "w")
  try {
    await waitForSpawn(spawn, args, cwd, env, timeout, outputFile.fd)
    await outputFile.sync()
    return await readFile(outputPath, "utf8")
  } finally {
    await outputFile.close()
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

function waitForSpawn(spawn: SpawnRunner, args: string[], cwd: string, env: Record<string, string>, timeout: number, outputFd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn("opencode", args, { cwd, env, timeout, stdio: ["ignore", outputFd, "pipe"] })
    } catch (cause) {
      reject(cause)
      return
    }
    watchChild(child, args, resolve, reject)
  })
}

function watchChild(child: ChildProcess, args: string[], resolve: () => void, reject: (reason?: unknown) => void): void {
  let stderr = ""
  if (child.stderr !== undefined && child.stderr !== null) {
    if (typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string | Buffer) => { stderr += String(chunk) })
  }
  child.once("error", (cause: Error & { stderr?: string }) => {
    if (cause && typeof cause === "object") cause.stderr = stderr
    reject(cause)
  })
  child.once("close", (code: number | null, signal: string | null) => {
    if (code === 0) {
      resolve()
      return
    }
    const detail = signal === null ? `exit code ${code}` : `signal ${signal}`
    reject(Object.assign(new Error(`opencode ${args.join(" ")} failed: ${detail}`), { code, stderr }))
  })
}

function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const key of MINIMAL_PLATFORM_VARS) {
    const value = env[key]
    if (value !== undefined) sanitized[key] = value
  }
  return sanitized
}

function runExecFile(execFile: ExecFileRunner, args: string[], cwd: string, env: Record<string, string>, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("opencode", args, { cwd, env, timeout, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function executionError(operation: string, args: string[], cause: unknown): Error & { code: string } {
  const rawCode = errorCode(cause)
  if (rawCode === "ENOENT") return runtimeError("OPENCODE_UNAVAILABLE", OPENCODE_UNAVAILABLE_MESSAGE)
  const command = `opencode ${args.join(" ")}`
  const detail =
    typeof rawCode === "number" ? String(stderrOf(cause) ?? messageOf(cause) ?? "") : String(messageOf(cause) ?? cause)
  return runtimeError("OPENCODE_EXECUTION_FAILED", `${operation} failed (${command}): ${detail}`)
}

function parseAgentArray(stdout: string, operation: string): RuntimeAgentEntry[] {
  const value = parseJson(stdout, operation, "opencode debug agents")
  if (!Array.isArray(value)) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents (opencode debug agents): expected a JSON array, got ${describeValue(value)}`)
  }
  return value.map((entry, index) => validateAgentEntry(entry, index, operation))
}

function validateAgentEntry(value: unknown, index: number, operation: string): RuntimeAgentEntry {
  const record = asRecord(value)
  if (!record) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents: agent ${index} is ${describeValue(value)}, expected an object`)
  }
  const id = readNonEmptyString(record, "id")
  const name = readNonEmptyString(record, "name")
  if (!id || !name) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents: agent ${index} is missing string "id" or "name" fields`)
  }
  const mode = record["mode"]
  if (typeof mode !== "string" || !SUPPORTED_MODES.has(mode)) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents: agent "${id}" has unsupported mode ${JSON.stringify(mode)}`)
  }
  if (typeof record["hidden"] !== "boolean") {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents: agent "${id}" is missing boolean "hidden"`)
  }
  if (!Array.isArray(record["permissions"])) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `listAgents: agent "${id}" is missing the "permissions" array`)
  }
  return {
    id,
    name,
    mode,
    hidden: record["hidden"],
    permissions: record["permissions"].map((rule, ruleIndex) => validateRule(rule, ruleIndex, `agent ${id}`, operation)),
  }
}

function parseConfigEntries(stdout: string, operation: string): RuntimeConfigEntry[] {
  const value = parseJson(stdout, operation, "opencode debug config")
  if (!Array.isArray(value)) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries (opencode debug config): expected a JSON array, got ${describeValue(value)}`)
  }
  return value.map((entry, index) => validateConfigEntry(entry, index, operation))
}

function validateConfigEntry(value: unknown, index: number, operation: string): RuntimeConfigEntry {
  const record = asRecord(value)
  if (!record) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: entry ${index} is ${describeValue(value)}, expected an object`)
  }
  if (record["type"] === "directory") {
    const path = readNonEmptyString(record, "path")
    if (!path) {
      throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: directory entry ${index} is missing string "path"`)
    }
    return { type: "directory", path }
  }
  if (record["type"] !== "document") {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: entry ${index} has unsupported type ${JSON.stringify(record["type"])}`)
  }
  const info = asRecord(record["info"])
  if (!info) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: document entry ${index} is missing the "info" object`)
  }
  const path = readNonEmptyString(record, "path")
  const permissions = validateOptionalRuleList(info["permissions"], `document ${index} permissions`, operation)
  const agentsRecord = asRecord(info["agents"])
  if (info["agents"] !== undefined && !agentsRecord) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: document ${index} "agents" must be an object`)
  }
  const agents: Record<string, { permissions: RuntimeRule[] }> = {}
  if (agentsRecord) {
    for (const [name, definition] of Object.entries(agentsRecord)) {
      const definitionRecord = asRecord(definition)
      if (!definitionRecord) {
        throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: agent "${name}" in document ${index} must be an object`)
      }
      agents[name] = {
        permissions: validateOptionalRuleList(definitionRecord["permissions"], `agent ${name} in document ${index}`, operation),
      }
    }
  }
  return { type: "document", path, permissions, agents }
}

function validateOptionalRuleList(value: unknown, label: string, operation: string): RuntimeRule[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `readConfigEntries: ${label} must be an array`)
  }
  return value.map((rule, index) => validateRule(rule, index, label, operation))
}

function validateRule(value: unknown, index: number, label: string, operation: string): RuntimeRule {
  const record = asRecord(value)
  if (!record) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `${operation}: rule ${index} for ${label} is ${describeValue(value)}, expected an object`)
  }
  const action = readNonEmptyString(record, "action")
  if (!action) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `${operation}: rule ${index} for ${label} is missing a string "action" field`)
  }
  if (typeof record["resource"] !== "string") {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `${operation}: rule ${index} for ${label} is missing a string "resource" field`)
  }
  if (!isPermissionEffect(record["effect"])) {
    throw runtimeError("OPENCODE_CONTRACT_UNSUPPORTED", `${operation}: rule ${index} for ${label} has effect ${JSON.stringify(record["effect"])}; expected one of allow|ask|deny`)
  }
  return { action, resource: record["resource"], effect: record["effect"] }
}

function parseJson(stdout: string, operation: string, command: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch (cause) {
    throw runtimeError("OPENCODE_OUTPUT_INVALID_JSON", `${operation} (${command}): runtime output is not valid JSON: ${messageOf(cause) ?? ""}`)
  }
}

function runtimeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as UnknownRecord
}

function readNonEmptyString(record: UnknownRecord, key: string): string | null {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) return null
  return value
}

function describeValue(value: unknown): string {
  return Array.isArray(value) ? "an array" : value === null ? "null" : typeof value
}

function errorCode(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return undefined
  return (cause as { code?: unknown }).code
}

function messageOf(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return cause === undefined ? undefined : String(cause)
}

function stderrOf(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return undefined
  return (cause as { stderr?: unknown }).stderr
}
```

(c) `src/lib/agent-frontmatter.ts` — rewrite to read only **native** declarations: given the agent id and the repository root, read `.opencode/agents/<id>.md` (falling back to `.opencode/agent/<id>.md` for the singular directory the runtime still discovers), parse the frontmatter block (existing parser mechanics), and return the `permissions` array when it is an array of valid rule objects (`action`/`resource`/`effect` validated like `validateRule` above — import nothing from `opencode-runtime.ts`; duplicate the small validator in this module because areas/modules share no code beyond `types.ts`) and otherwise return no declarations (a legacy `permission:` map or anything ambiguous yields **none**). Export:

```ts
export interface AgentFileDeclaration { scope: "agent"; source: string; rules: RuntimeRule[] }
export function readRepositoryAgentFileDeclarations(repositoryRoot: AbsolutePath, agentId: string): AgentFileDeclaration | null
```

where `source` is the repository-relative path (`.opencode/agents/ghost.md`).

(d) `src/lib/effective-rules.ts` — rewrite as the attribution engine:

```ts
/**
 * Attributes the runtime's ordered effective rules to repository-owned
  * declarations, walking both sequences backward and pairing exact
  * (action, resource, effect) triples one-to-one so a repeated declaration
  * claims its own position. The declaration sequence is, in order: top-level
  * permissions of each repository-owned config document (in the runtime's
  * lowest-to-highest document order), then per-agent permissions of those
  * documents, then the repository agent file's native frontmatter rules.
  * Every unmatched effective rule keeps an unknown origin.
  */
export function buildEffectiveRules(
  rules: readonly RuntimeRule[],
  documents: readonly RuntimeConfigDocument[],
  repositoryRoot: AbsolutePath,
  agentId: string,
  agentFileDeclarations: AgentFileDeclaration | null,
): EffectiveRule[]
```

Implementation shape: build `candidates: Array<{ scope: "shared" | "agent"; source: string; rule: RuntimeRule }>` where `source` is the repository-relative path (documents whose `path` is not inside `repositoryRoot` are excluded — including `path === null` — so global and managed configuration never claims an origin). Compute `source` as the document path relative to `repositoryRoot` when it is a prefix (keep `.opencode/opencode.json` spelled exactly as found). Walk the effective rules from last to first and the candidates from last to first, consuming the first unused candidate whose triple equals the rule's triple; each consumed candidate becomes that position's origin. Agent-file declarations are appended to the candidate sequence after the documents' per-agent rules. Because the runtime pushes each document's top-level rules before agent-scoped ones and the effective order preserves pushes, backward pairing reproduces the true application order; anything the pairing cannot verify stays `{ scope: "unknown", source: null }`. Supersession itself is not metadata in the 2.x report: every declaration stays present in the effective order, so the last matching rule winning is visible in the report's positions.

(e) `src/lib/inspection.ts` — rewrite:

```ts
export async function createAgentListReport(deps: { repositoryRoot: AbsolutePath; runtime: OpenCodeRuntime }): Promise<AgentListReport> {
  const inventory = await deps.runtime.listAgents(deps.repositoryRoot)
  return { agents: inventory.map(({ id, name, mode, hidden }) => ({ id, name, mode, hidden })) }
}

export async function createEffectivePolicyReport(deps: {
  repositoryRoot: AbsolutePath
  runtime: OpenCodeRuntime
  agentName?: string | null
}): Promise<EffectivePolicyReport> {
  const [inventory, entries] = await Promise.all([
    deps.runtime.listAgents(deps.repositoryRoot),
    deps.runtime.readConfigEntries(deps.repositoryRoot),
  ])
  const requested = resolveRequestedAgents(inventory, deps.agentName ?? null)
  const documents = entries.filter((entry): entry is RuntimeConfigDocument => entry.type === "document")
  const agents: EffectiveAgent[] = requested.map((entry) => ({
    id: entry.id,
    name: entry.name,
    mode: entry.mode,
    hidden: entry.hidden,
    rules: buildEffectiveRules(
      entry.permissions,
      documents,
      deps.repositoryRoot,
      entry.id,
      readRepositoryAgentFileDeclarations(deps.repositoryRoot, entry.id),
    ),
  }))
  return { agents }
}
```

`resolveRequestedAgents` keeps its current missing-agent error shape with the id-based message (`show-effective: agent "x" is not in the runtime inventory`). Preserve JSDoc: mirror the runtime inventory exactly, never invent agents, attribute origins only where verifiable, keep unknown origins visible, and keep rule order/duplicates exact.

(f) `src/inspect.ts`: `renderListAgents` prints one line per agent as `` `${id} (${mode}${agent.hidden ? ", hidden" : ""})` ``, appending ` — ${agent.name}` exactly when the runtime name differs from the id (so the fixture world prints `build (primary)`, `explore (subagent, Explore)`, `ghost (all, hidden)`); `renderEffectivePolicy` prints `  #${rule.position} ${rule.action} ${rule.resource} ${rule.effect} ${renderOrigin(rule)}` with `(unknown)` for null origins — the local `renderOrigin` helper drops the 1.x overrides clause because the report no longer carries `overrides`; `USAGE`/`--json`/output-file behavior unchanged; the `--agent` selector is now the runtime agent id (update USAGE/help text and the `InspectArgs` doc). `parseArgs` source stays unchanged otherwise.

(g) Delete with `git rm`: `src/lib/effective-permissions.ts`, `src/lib/repository-configs.ts`, `src/lib/jsonc.ts` and their tests `test/lib/jsonc.test.ts`, `test/lib/repository-configs.test.ts` — production modules never import them anymore (areas keep no dead code).

(h) Update `references/output-format.md` to the native report shapes: `list-agents` / `list-agents --json` / `show-effective` / `show-effective --json` examples spelled exactly like the Produces types (use the fixture world: `build (primary)`, `#0 read * allow opencode.json (shared)`, the duplicated edit rule as two positions with the same source, an unknown-origin line `#2 edit * deny (unknown)`), plus the Field Meanings section rewritten: `position` (zero-based index in the resolved order), `action`/`resource`/`effect`, `origin.scope` `shared` (repository document's top-level permissions), `agent` (repository document's agent permissions or the agent file's native frontmatter), `unknown` (no repository source verifiable — including session rules, saved approvals, built-in defaults, global or managed configuration), `origin.source` (repository-relative declaration file or `null`), and one sentence: the runtime merges layers lowest to highest and the last matching rule wins with no match resolving to `ask`; duplicates and supersession are visible directly in rule order. The 1.x `overrides` field is gone. Also state: the inspector reports, but never edits, and a legacy 1.x block is never treated as an editable source (the editing workflow handles that in the skill's tasks).

(i) Update `skills/opencode-permissions/README.md`: Architecture section now describes `opencode debug agents` as the authority and `opencode debug config` plus agent-file frontmatter for origins; Portability unchanged; Supported Frontmatter Subset → the native `permissions` rule array (legacy maps are not supported for attribution); Tested Baseline → the v2.3.2 captured fixtures (rename the fixture mentions `agent-list.txt`/`debug-agent.json` → `debug-agents.json`/`debug-config.json`).

- [ ] **Step 4: Run the inspector tests to verify they pass**

Run: `bun test skills/opencode-permissions && bun run typecheck`
Expected: PASS. Then the task-06 report work consumes these shapes unchanged.

- [ ] **Step 5: Changed-code audit and commit**

Complete the audit tables below, then:

```bash
git add skills/opencode-permissions
git commit -m "feat: inspect effective policy from the OpenCode 2.3.2 runtime"
```

## Changed-code audit

**Exported declarations:**
- `PERMISSION_EFFECTS`/`isPermissionEffect` (types.ts) — the three effects, error-message order.
- `RuntimeRule`, `RuntimeAgentEntry`, `RuntimeConfigDocument`, `RuntimeConfigDirectory`, `RuntimeConfigEntry`, `OpenCodeRuntime` — types.ts/opencode-runtime.ts — the validated runtime contract (JSDoc on `createOpenCodeRuntime` covers failure codes).
- `AgentListReport`, `EffectivePolicyReport`, `EffectiveAgent`, `EffectiveRule`, `RuleOrigin`, `RuleOverride`, `RuleScope` — types.ts — JSDoc: order preserved, duplicates preserved, unknown origins visible.
- `createOpenCodeRuntime`, `createAgentListReport`, `createEffectivePolicyReport`, `readRepositoryAgentFileDeclarations`, `buildEffectiveRules` — files as above.
- Deleted declarations: note the removed files in the commit's audit summary; no stubs remain.

**Long bodies:** `validateConfigEntry` (~45 lines) — sequential field validation of one external record; extraction would pass label strings through three helpers without clarifying it. `buildEffectiveRules` — split the backward pairing into a named helper if it exceeds 40 lines when written; the candidate-sequence builder should be its own exported-less helper.
