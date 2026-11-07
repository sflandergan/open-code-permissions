# Task 03: Port the inspector library

**Objective:** Port the `opencode-permissions` skill's JSONC parser, OpenCode runtime adapter, and 809-line inspection monolith into strict, decomposed TypeScript modules, guarded by the ported unit tests.

**Unit:** 2 (`opencode-permissions` skill). Depends on Task 01 (`tsconfig.json`, `bun:test`).

**Files:**
- Create: `.agents/skills/opencode-permissions/scripts/lib/jsonc.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/opencode-runtime.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/inspection.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/declarations.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/rule-attribution.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/repository-configs.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/frontmatter.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/types.ts`
- Create: `.agents/skills/opencode-permissions/scripts/lib/errors.ts`
- Create: `.agents/skills/opencode-permissions/scripts/inspect.ts`
- Create: `.agents/skills/opencode-permissions/scripts/test/inspection.test.ts`
- Create: `.agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.ts`
- Create: `.agents/skills/opencode-permissions/scripts/test/fixtures/{agent.md,debug-agent.json,agent-list.txt,debug-config.json,opencode.json}`

**Interfaces:**
- Consumes: root `tsconfig.json` (Task 01); `bun:test` (Bun).
- Produces (exact signatures; these are the only exports later tasks or tests rely on):
  - `lib/jsonc.ts`: `export function parseJsonc(text: string, source: string): unknown`
  - `lib/opencode-runtime.ts`: `export function createOpenCodeRuntime(deps: OpenCodeRuntimeDeps): OpenCodeRuntime`
  - `lib/inspection.ts`: `export function createAgentListReport(deps: { repositoryRoot: string; runtime: OpenCodeRuntime }): Promise<AgentListReport>`; `export function createEffectivePolicyReport(deps: { repositoryRoot: string; runtime: OpenCodeRuntime; agentName?: string | null }): Promise<EffectivePolicyReport>`
  - `lib/frontmatter.ts`: `export function parseFrontmatterPermission(text: string, agentFile: string): PermissionDeclarations`
  - `inspect.ts`: `export function parseArgs(argv: string[]): InspectArgs`; `export function renderListAgents(report: AgentListReport): string`; `export function renderEffective(report: EffectivePolicyReport): string`; `export function resolveWrapperRepositoryRoot(env: Record<string, string | undefined>): string`
  - All shared types are defined in `lib/types.ts` (complete code in Step 3): `AgentStatus`, `Scope`, `PermissionRule`, `AgentListEntry`, `ResolvedConfig`, `ResolvedAgentConfig`, `OpenCodeRuntime`, `AgentListReport`, `RuleOrigin`, `RuleOverride`, `EffectiveRule`, `EffectiveAgent`, `EffectivePolicyReport`, `InspectArgs`, `RepositoryConfig`, `DeclarationTuple`, `EffectiveDeclaration`, `PermissionDeclarations`.
  - `OpenCodeRuntimeDeps` is declared locally in `lib/opencode-runtime.ts` as `{ execFile: typeof import("node:child_process").execFile; spawn?: typeof import("node:child_process").spawn; env?: Record<string, string | undefined>; timeoutMs?: number }`.

**Ported-source convention** (applies to every copied file): source root `/Users/sflandergan/dev/repositories/bikes-local` at commit `29ee8718f4ab4a50297f30ceb5ee40e4ad02035a` (fallback: clone `https://github.com/Bike-Finder/bikes-local.git` at that commit). For each file: `cp <source> <dest>`, then apply all applicable transforms:

1. Rename `.mjs` → `.ts`; remove `#!/usr/bin/env node` from library modules; entry scripts use `#!/usr/bin/env bun`.
2. Drop the `.mjs` extension from every relative import specifier (`./lib/jsonc.mjs` → `./lib/jsonc`); Bun and `moduleResolution: Bundler` resolve extensionless imports to `.ts`.
3. Turn JSDoc `@param`/`@returns` into TypeScript annotations; type every parameter, return and variable; use `unknown` (never `any`) for untrusted values and narrow at boundaries; use `import type` for type-only imports; add JSDoc contracts to every exported declaration; keep file-level constants at the top of each file.
4. Decompose any function-like body over 40 physical lines; record both `docs/CODING_GUIDELINES.md` changed-code audit tables.
5. Convert `node:test` → `bun:test` (`describe`, `it`, `test`, `beforeEach`, `afterEach`, `expect`). `bun:test` passes **no** `t` context, so replace each `t.after(cleanup)` with `try { … } finally { cleanup() }` or a shared `withTempDirectory` helper. Convert `node:assert/strict` to `expect`: `equal`/`strictEqual`/`deepEqual`/`deepStrictEqual` → `toEqual`; `notEqual` → `.not.toEqual`; `ok(v)` → `toBeTruthy()`; `match`/`doesNotMatch` → `toMatch`/`.not.toMatch`; `throws(fn, /re/)` → `toThrow(/re/)` (for `err.code`, try/catch then `expect((caught as { code: string }).code).toEqual("CODE")`); `rejects(p, /re/)` → `await expect(p).rejects.toThrow(/re/)` (for `err.code`, `await expect(p).rejects.toMatchObject({ code: "CODE" })`); `fail(msg)` → `throw new Error(msg)`. Rewrite every test name per `docs/TESTING.md`: state situation and expected outcome in domain terms with concrete values, no code identifiers, internal working terms, or technique words.
6. Neutralize: `github.com/example/bikes-local` → `github.com/example/portfolio-app`; `/worktrees/bikes-local` → `/worktrees/portfolio-app`; `/tmp/bikes-local` → `/tmp/portfolio-app`; `/tmp/paseo-fake-home` → `/tmp/example-home`; `join(tmpdir(), "bikes-local")` → `join(tmpdir(), "opencode-permissions")`; `pnpm` examples/fixtures → `bun`; `internal Node inspector` → `internal Bun inspector`.
7. Behavior is preserved and guarded by the ported tests; no live OpenCode and no network.

- [ ] **Step 1: Write the failing tests**

```bash
mkdir -p .agents/skills/opencode-permissions/scripts/lib \
         .agents/skills/opencode-permissions/scripts/test/fixtures
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/inspection.test.mjs \
   .agents/skills/opencode-permissions/scripts/test/inspection.test.ts
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.mjs \
   .agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.ts
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/fixtures/agent.md \
   /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/fixtures/debug-agent.json \
   /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/fixtures/agent-list.txt \
   /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/fixtures/debug-config.json \
   /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/test/fixtures/opencode.json \
   .agents/skills/opencode-permissions/scripts/test/fixtures/
```

Apply transforms 2, 5, 6 to both test files and transform 6 to the fixtures. In `inspection.test.ts` specifically: change `../lib/inspection.mjs` → `../lib/inspection`, add `import { parseFrontmatterPermission } from "../lib/frontmatter"`, change `../lib/jsonc.mjs` → `../lib/jsonc`, and change `../inspect.mjs` → `../inspect`. In `opencode-runtime.test.ts`, change `../lib/opencode-runtime.mjs` → `../lib/opencode-runtime`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test ./.agents/skills/opencode-permissions/scripts/test/inspection.test.ts`
Expected: FAIL — `Cannot find module '../lib/inspection'`.

Run: `bun test ./.agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.ts`
Expected: FAIL — `Cannot find module '../lib/opencode-runtime'`.

- [ ] **Step 3: Create the two new shared modules (complete code)**

Create `.agents/skills/opencode-permissions/scripts/lib/types.ts`:

```ts
/** Shared report and policy types for the inspector. */

export type AgentStatus = "native" | "custom" | null
export type Scope = "shared" | "agent" | "external"

export interface PermissionRule {
  permission: string
  pattern: string
  action: string
}

export interface AgentListEntry {
  name: string
  mode: string
  rules: PermissionRule[]
}

export interface ResolvedConfig {
  permission?: Record<string, unknown>
  agent?: Record<string, unknown>
}

export interface ResolvedAgentConfig {
  name: string
  mode: string
  native?: boolean
  permission: PermissionRule[]
}

/** Read-only adapter over the installed OpenCode CLI. */
export interface OpenCodeRuntime {
  listAgents(cwd: string): Promise<AgentListEntry[]>
  readResolvedConfig(cwd: string): Promise<ResolvedConfig>
  readResolvedAgentConfig(name: string, cwd: string): Promise<ResolvedAgentConfig>
}

export interface AgentListReport {
  agents: Array<{ name: string; mode: string; status: AgentStatus }>
}

export interface RuleOrigin {
  scope: Scope
  source: string | null
}

export interface RuleOverride {
  scope: "shared" | "agent"
  source: string
}

export interface EffectiveRule extends PermissionRule {
  position: number
  origin: RuleOrigin
  overrides: RuleOverride[]
}

export interface EffectiveAgent {
  name: string
  mode: string
  status: AgentStatus
  rules: EffectiveRule[]
}

export interface EffectivePolicyReport {
  agents: EffectiveAgent[]
}

export interface InspectArgs {
  command: "list-agents" | "show-effective"
  agent: string | null
  json: boolean
}

export interface RepositoryConfig {
  path: string
  value: Record<string, unknown>
}

export interface DeclarationTuple {
  permission: string
  pattern: string
  action: string
}

export interface EffectiveDeclaration extends DeclarationTuple {
  origin: { scope: "shared" | "agent"; source: string }
  overrides: RuleOverride[]
}

export type PermissionDeclarations = Record<string, string | Record<string, string>>
```

Create `.agents/skills/opencode-permissions/scripts/lib/errors.ts`:

```ts
/**
 * Build an inspection error carrying a machine-readable `code` alongside its
 * message. Callers and tests branch on `code` without parsing message text.
 */
export function inspectionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
```

- [ ] **Step 4: Port the two leaf modules**

```bash
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/lib/jsonc.mjs \
   .agents/skills/opencode-permissions/scripts/lib/jsonc.ts
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/lib/opencode-runtime.mjs \
   .agents/skills/opencode-permissions/scripts/lib/opencode-runtime.ts
```

Apply transforms 1, 2, 3, 4, 6. In `opencode-runtime.ts`: declare and export `OpenCodeRuntimeDeps` as `{ execFile: typeof import("node:child_process").execFile; spawn?: typeof import("node:child_process").spawn; env?: Record<string, string | undefined>; timeoutMs?: number }`; import `OpenCodeRuntime`, `AgentListEntry`, `PermissionRule` from `./types` with `import type`; replace `join(tmpdir(), "bikes-local")` with `join(tmpdir(), "opencode-permissions")`. Keep `createOpenCodeRuntime`, `DEFAULT_TIMEOUT_MS`, `MINIMAL_PLATFORM_VARS`, `VALID_ACTIONS`, `VALID_MODES`, `AGENT_BLOCK_HEADER`, `ARRAY_OPEN_LINE`, `ARRAY_CLOSE_LINE` as file-level constants at the top.

- [ ] **Step 5: Port and decompose `inspection.mjs`**

Source: `/Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/lib/inspection.mjs`. Split its named functions into these files exactly; do not change any function body's behavior:

| Target module | Functions moved from `inspection.mjs` | Exports |
|---|---|---|
| `lib/inspection.ts` | `createAgentListReport`, `createEffectivePolicyReport`, `resolveRequestedAgents`, `buildEffectiveAgent` | `createAgentListReport`, `createEffectivePolicyReport` |
| `lib/declarations.ts` | `mergeSharedDeclarations`, `mergeAgentDeclarations`, `mergeLayerDeclarations`, `convertPermissionDeclarations`, `validateAction`, `nativeStatus` | `mergeSharedDeclarations`, `mergeAgentDeclarations`, `convertPermissionDeclarations`, `nativeStatus` |
| `lib/rule-attribution.ts` | `buildRuleRecords`, `findAttributableDeclaration`, `ruleWithOrigin`, `ruleWithExternalOrigin`, `tupleEquals`, `containsTuple` | `buildRuleRecords` |
| `lib/repository-configs.ts` | `loadRepositoryConfigs`, `loadRepositoryConfigFile`, `validateRepositoryConfigShape`, `agentSourceFile`, `realDirectoryOrNull`, `safeAgentName`, `readRegularTextFile`, `missingSourcePath`, `loadAgentPermission` | `loadRepositoryConfigs`, `loadAgentPermission`, `agentSourceFile`, `safeAgentName` |
| `lib/frontmatter.ts` | `parseFrontmatterPermission`, `extractFrontmatter`, `parsePermissionSection`, `topLevelPermissionLines`, `firstNonEmptyLine`, `parseIndentedMapping`, `parseKeyLine`, `findYamlSeparator`, `stripComment`, `unquote`, `decodeDoubleQuoted`, `decodeSingleQuoted`, `parseActionValue`, `countIndent` | `parseFrontmatterPermission` |

Wire the cross-module imports exactly as follows; this graph is acyclic:

- `lib/errors.ts`: no imports.
- `lib/jsonc.ts`: no imports.
- `lib/types.ts`: no imports.
- `lib/frontmatter.ts`: imports `inspectionError` from `./errors` and shared types from `./types`. Keep its own file-level `VALID_ACTIONS = new Set(["allow", "ask", "deny"])` and `FRONTMATTER_DELIMITER = "---"` at the top.
- `lib/repository-configs.ts`: imports `parseJsonc` from `./jsonc`, `parseFrontmatterPermission` from `./frontmatter`, `inspectionError` from `./errors`, and shared types from `./types`. Keep `REPOSITORY_CONFIG_PATH`, `REPOSITORY_JSONC_PATH`, `AGENTS_DIRECTORY` as file-level constants at the top.
- `lib/declarations.ts`: imports `loadAgentPermission` and `agentSourceFile` from `./repository-configs`, `inspectionError` from `./errors`, and shared types from `./types`. Keep its own file-level `VALID_ACTIONS` at the top (duplicate the three-element set rather than importing it from `frontmatter.ts`, which would create a cycle through `repository-configs.ts`).
- `lib/rule-attribution.ts`: imports `convertPermissionDeclarations` from `./declarations`, `inspectionError` from `./errors`, and shared types from `./types`.
- `lib/inspection.ts`: imports `mergeSharedDeclarations`, `mergeAgentDeclarations`, `convertPermissionDeclarations`, `nativeStatus` from `./declarations`, `buildRuleRecords` from `./rule-attribution`, `loadRepositoryConfigs`, `safeAgentName` from `./repository-configs`, `inspectionError` from `./errors`, and shared types from `./types`.

Use `import type` for type-only imports. Apply transforms 1, 2, 3, 4 to every resulting file. No resulting function-like body may exceed 40 physical lines; extract a named helper where one does.

- [ ] **Step 6: Port `inspect.mjs` → `inspect.ts`**

```bash
cp /Users/sflandergan/dev/repositories/bikes-local/.agents/skills/opencode-permissions/scripts/inspect.mjs \
   .agents/skills/opencode-permissions/scripts/inspect.ts
```

Apply transforms 1, 2, 3, 4, 6. Keep `USAGE` and `WRAPPER_REPOSITORY_ROOT_VAR` as file-level constants at the top. Change imports to `./lib/opencode-runtime` and `./lib/inspection`. Keep the `isMain` guard (`fileURLToPath(import.meta.url) === realpathSync(process.argv[1])`) so importing `inspect.ts` from a test does not run `main`. Add `import type { InspectArgs, AgentListReport, EffectivePolicyReport } from "./lib/types"`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test ./.agents/skills/opencode-permissions/scripts/test/inspection.test.ts`
Expected: PASS — all cases green.

Run: `bun test ./.agents/skills/opencode-permissions/scripts/test/opencode-runtime.test.ts`
Expected: PASS — all cases green.

If a test fails, fix the ported module (not the test's asserted behavior): the source is behavior-preserving, so a failure means a transform introduced a type or logic error. Record the before/after results for any test-name or assertion consolidation.

- [ ] **Step 8: Typecheck and record the changed-code audit tables**

Run: `bun run typecheck`
Expected: exit 0.

Exported declarations (record file, line range, contract, hidden invariants / error semantics, JSDoc location for every exported declaration in the nine new `.ts` library files and `inspect.ts`):

| Declaration | Contract | Invariants / errors | JSDoc |
|---|---|---|---|
| `parseJsonc` | Parses JSONC to `unknown` | Throws `JSONC_PARSE_ERROR` with source path and context | above function |
| `createOpenCodeRuntime` | Builds the read-only CLI adapter | Sanitized env, finite timeout, single truncation retry, coded errors | above function |
| `createAgentListReport` / `createEffectivePolicyReport` | Build the two inspector reports | Reject on unavailable/malformed runtime or unsafe agent name | above functions |
| `parseFrontmatterPermission` | Reads agent frontmatter `permission:` | Rejects unsupported syntax with file context | above function |
| `parseArgs` / `renderListAgents` / `renderEffective` / `resolveWrapperRepositoryRoot` | CLI argument and rendering helpers | `USAGE` / `REPOSITORY_ROOT_*` coded errors | above functions |
| `inspectionError` | Coded inspection error | Preserves `code` | above function |
| every type in `lib/types.ts` | Shared report/policy shapes | none | above each |

Long bodies (over 40 physical lines): none after decomposition; state this explicitly with the complete body bounds of `parseIndentedMapping`, `findYamlSeparator`, `stripComment`, `createEffectivePolicyReport`, and `buildRuleRecords` as the closest-to-limit cases, recording the named helpers extracted from each.

- [ ] **Step 9: Commit**

```bash
git add .agents/skills/opencode-permissions/scripts
git commit -m "feat: port the permission inspector to strict decomposed TypeScript"
```
