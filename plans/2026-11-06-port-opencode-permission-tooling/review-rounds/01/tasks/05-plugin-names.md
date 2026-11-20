# Task 05: Plugin names, warn-once placement and test names

**Objective:** Apply the agreed plugin renames, move the one-time warning into the plugin entry, remove the OpenCode version pin from code comments, and fix the unclear plugin test names.

**Resolves:** R07, R08, R09, R10, R11, R19, R20, R21, R25 (findings F7 plugin part, F20, F21 plugin part, F28).

**Depends on:** Task 04.

**Behavior-preserving:** renames and moves only, except F28 (dead branch). Run the plugin tests before and after.

**Glossary:** *Observation origin* — repository identity, agent, message ID and tool call ID that tie an observation to where it came from; filled later when the asked event lacked them.

**Files (plugin root `.opencode/plugins/permission-optimizer/`):**
- Rename: `lifecycle.ts` → `permission-event-correlator.ts` (`git mv`)
- Rename: `test/lifecycle.test.ts` → `test/permission-event-correlator.test.ts`
- Rename: `test/entry.test.ts` → `test/permission-optimizer-plugin.test.ts`
- Modify: `event-adapter.ts`, `store.ts`, `../permission-optimizer.ts`, `README.md`, `test/event-adapter.test.ts`, any importer found by `git grep -n "lifecycle\|createOnceWarner\|AttributionFields\|enrichAttribution\|DrivableHooks" -- .opencode test`

## Renames

| Current | New |
|---|---|
| `createLifecycleProcessor` | `createPermissionEventCorrelator` |
| `LifecycleProcessor` (type) | `PermissionEventCorrelator` |
| `CorrelatingLifecycleProcessor` (class) | `SqlitePermissionEventCorrelator` |
| `AttributionFields` | `ObservationOrigin` |
| `enrichAttribution` | `fillObservationOrigin` |
| `DrivableHooks` (test) | `PluginHooks` |
| `createOnceWarner` in `event-adapter.ts` | private `createWarnOnce` in `.opencode/plugins/permission-optimizer.ts` |

JSDoc for `ObservationOrigin`: "Repository identity, agent, message ID and tool call ID that tie an observation to where it came from. Only non-null values fill fields that are still null; known values are never overwritten." Update local variable names and messages that say "attribution" or "lifecycle processor".

## Steps

- [ ] **Step 1: Baseline** — `bun test ./.opencode/plugins/permission-optimizer/test/`; record counts.

- [ ] **Step 2: Renames** — apply the table with `git mv` for files and edits for identifiers; update the plugin README module list.

- [ ] **Step 3: Warn-once** — delete `createOnceWarner` from `event-adapter.ts`; the adapter keeps reporting the unsupported event type through its `onUnsupported` callback. In the entry, add a private `createWarnOnce(warn: (message: string) => void): (type: string) => void` with the same behavior and use it where `createOnceWarner` was used. Move its unit test from `event-adapter.test.ts` into `permission-optimizer-plugin.test.ts`, driving it through the plugin: two unsupported `permission.v2*` events produce exactly one warning (spy on `console.warn` or the entry's warning sink).

- [ ] **Step 4: Version pin (R21)** — in `permission-event-correlator.ts`, replace the JSDoc of the reply-classification method ("…based on the pinned OpenCode 1.18.11 cascade evidence…") with a behavior-only contract: "Classifies a reply as direct, derived, or unresolved. A reply is direct only when no earlier direct reply's `always` hints cover this request's patterns." The OpenCode version provenance stays only in the plugin `README.md`; add one line there if it is not yet present: "Reply cascade classification was verified against OpenCode 1.18.11."

- [ ] **Step 5: Dead branch (F28)** — the else branch in the classify-and-store method (formerly `lifecycle.ts:331-333`) is reached only when no pending request exists, but the method's callers check pending state first. Confirm with a coverage run (`bun test --coverage ./.opencode/plugins/permission-optimizer/test/`). If the branch is uncovered and no caller can reach it, delete it; otherwise add a test that reaches it and keep it. Record which.

- [ ] **Step 6: Test names**
  - `event-adapter.test.ts` "adapts a valid asked event with exact normalized values" → "normalizes a valid asked event" (R09).
  - `event-adapter.test.ts` "accepts a payload delivered under the event's data field with exact values" → "reads the asked payload from the legacy data envelope when properties is absent" (R10).
  - `permission-event-correlator.test.ts` "records a mismatched automatic reply as unresolved" → "records an unexpected reply to a request covered by an earlier always reply as unresolved". Keep the classification branch it covers (owner decision: defensive handling). Add one comment above the test: "// OpenCode answers requests covered by an earlier always reply itself; any other reply on such a request is unexpected and is recorded as unresolved rather than counted as a decision." Add the same constraint as one sentence in the JSDoc of the cascade-classification function. (R11)

- [ ] **Step 7: Verify**

```bash
bun test ./.opencode/plugins/permission-optimizer/test/
bun run typecheck
bun test ./.opencode ./skills ./scripts ./test
git grep -n -e createLifecycleProcessor -e LifecycleProcessor -e AttributionFields -e enrichAttribution -e createOnceWarner -e DrivableHooks -e "1\.18\.11" -- .opencode test ':!*/README.md'
```

Expected: tests pass; grep prints nothing.

- [ ] **Step 8: Audit tables** — record both changed-code audit tables.

- [ ] **Step 9: Commit** — `git commit -am "refactor: name plugin modules after permission events and observation origin"` (after `git add` for moved files).
