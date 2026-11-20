# Task 06: Plugin repository identity, absolute paths and error handling

**Objective:** Type the plugin's repository identity as a discriminated union, introduce `AbsolutePath` for plugin paths, replace the open-ended `runGit(args)` with two fixed Git calls, stop swallowing errors silently, and catch adapter failures at the hook boundary.

**Resolves:** R24, R33 (plugin copy), U6 (findings F13, F18 plugin part, F24, F31 plugin part).

**Depends on:** Task 05.

**Persisted data must not change:** the `observations.repository_identity` column must receive exactly the same string as today (normalized `host/path` from `origin`, else the absolute Git common directory, else NULL). The optimizer reader computes the same string independently and queries by equality.

**Glossary:** *Repository identity* — either the normalized `host/path` of the `origin` remote, or the absolute path of the Git common directory, or unknown. *Absolute path* — a string proven absolute by `toAbsolutePath`, typed `AbsolutePath`.

**Files (plugin root `.opencode/plugins/permission-optimizer/`):**
- Create: `absolute-path.ts`, `test/absolute-path.test.ts`
- Modify: `repository-identity.ts`, `runtime-context.ts`, `database-path.ts`, `database.ts`, `store.ts`, `permission-event-correlator.ts`, `../permission-optimizer.ts`
- Modify tests: `test/repository-identity.test.ts`, `test/runtime-context.test.ts`, `test/permission-event-correlator.test.ts`, `test/permission-optimizer-plugin.test.ts`, `test/database.test.ts`, `test/store.test.ts`

## Design

`absolute-path.ts`:

```ts
import { isAbsolute } from "node:path"

/** A filesystem path proven absolute by `toAbsolutePath`; usable wherever a string path is accepted. */
export type AbsolutePath = string & { readonly brand: "AbsolutePath" }

/** Returns `value` as an `AbsolutePath`; throws `TypeError` naming `label` when it is empty or relative. */
export function toAbsolutePath(value: string, label: string): AbsolutePath {
  if (value.length === 0 || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`)
  }
  return value as AbsolutePath
}
```

`repository-identity.ts`:

```ts
export type RepositoryIdentity =
  | { source: "origin"; remote: string }                                // normalized host/path, no credentials
  | { source: "git-common-directory"; directoryPath: AbsolutePath }
  | { source: "unknown" }

/** The string persisted in `observations.repository_identity`, or null when unknown. */
export function formatRepositoryIdentity(identity: RepositoryIdentity): string | null
```

`resolveRepositoryIdentity(origin, commonDirectory: AbsolutePath | null)` returns the union; the worktree is no longer part of the identity type — callers that need it carry it separately as `AbsolutePath`. Remove the `worktree: ""` placeholder and the `commonDirectory` field.

`runtime-context.ts`: replace `runGit(args: string[], worktree)` with two private functions `readOriginRemote(worktree: AbsolutePath): string | null` and `readGitCommonDirectory(worktree: AbsolutePath): AbsolutePath | null`, each with its fixed argument vector. On failure they return null **and** report through a `onFailure(message: string)` callback the plugin passes in (operation, worktree, and `err.message`; never the raw remote URL). A missing `origin` remote (git exit status 2 for `remote get-url`) is an expected state and is not reported.

## Steps

- [ ] **Step 1: Failing tests**
  - `absolute-path.test.ts`: "accepts an absolute path unchanged"; "rejects a relative path naming the value" (`toThrow("worktree must be an absolute path")`); "rejects an empty path".
  - `repository-identity.test.ts`: "persists the normalized origin as the repository identity"; "persists the Git common directory when no origin is usable"; "persists no repository identity when neither is known" — each asserts `formatRepositoryIdentity(resolveRepositoryIdentity(...))` equals the exact string or null used before this task.
  - `runtime-context.test.ts`: "reports a failed Git common-directory lookup with the worktree" (use a temporary non-repository directory; assert one failure message containing the operation and directory) and "does not report a missing origin remote" (temporary `git init` repository without remote).

  Run `bun test ./.opencode/plugins/permission-optimizer/test/` → expected FAIL for the new tests.

- [ ] **Step 2: Implement** `absolute-path.ts`, the identity union, the fixed Git functions, and thread `AbsolutePath` through: plugin `input.worktree` / `directory` converted once in `../permission-optimizer.ts` with `toAbsolutePath`; `resolveDatabasePath(): AbsolutePath` (an environment override is resolved with `path.resolve` before `toAbsolutePath`, matching how SQLite would open it relative to the process directory); `openDatabase(path: AbsolutePath)`; `createObservationStore(dbPath: AbsolutePath, …)`; `ObservationRecord.worktree: AbsolutePath`.

- [ ] **Step 3: Logged failures (F13)** — replace every silent catch:
  - `runtime-context.ts` agent resolver `catch { return null }` → report "agent lookup failed for session <id>: <err.message>" through the warning sink, then return null.
  - `permission-event-correlator.ts` `resolveAgent` `catch { return null }` → same reporting.
  - Every `onWarning(...)` call in the correlator that drops `err` → append `: ${errorMessage(err)}` using one private `errorMessage(err: unknown): string` helper.
  - Keep `normalizeOrigin`'s `catch { return null }` (documented "unparseable input" result) and rollback catches that rethrow the original error.

- [ ] **Step 4: Hook boundary (F24)** — in `../permission-optimizer.ts`, wrap the bodies of the `event` and `tool.execute.after` hooks (including `adaptEvent` / `adaptCompletion`) in `try { … } catch (err) { warn("<hook name> failed: " + errorMessage(err)) }` so a malformed event never reaches OpenCode as an exception. Add a test in `permission-optimizer-plugin.test.ts`: "keeps OpenCode running when an event cannot be adapted" — pass an event whose adapter throws (for example a getter that throws on `properties`), assert the hook resolves and one warning names the hook.

- [ ] **Step 5: Verify**

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
bun test ./test/contract.test.ts
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
git grep -n "catch {" -- .opencode/plugins/permission-optimizer ':!*/test/*'
```

Expected: tests pass; remaining `catch {` lines are only `normalizeOrigin` and documented rollbacks.

- [ ] **Step 6: Audit tables** — record both changed-code audit tables.

- [ ] **Step 7: Commit** — `git add` new files; `git commit -am "refactor: type plugin repository identity and paths, and report lookup failures"`.
