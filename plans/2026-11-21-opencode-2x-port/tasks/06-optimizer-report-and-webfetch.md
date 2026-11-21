# Task 06 — Optimizer report v2 and webfetch requested-URL matches

## Objective

The `opencode-permission-optimizer` report speaks the inspector's native 2.x JSON (agent IDs, `action`/`resource`/`effect` rules), keeps legacy and 2.x evidence distinguishable, computes webfetch requested-URL matches for URL-origin recommendations, and turns a schema mismatch into an actionable error naming what to update or start first.

## Files

- Create: `skills/opencode-permission-optimizer/src/lib/requested-url-matches.ts`
- Modify: `skills/opencode-permission-optimizer/src/agent-permission-report.ts`
- Modify: `skills/opencode-permission-optimizer/README.md` (Report JSON + Package layout sections)
- Modify: `CONTEXT.md` (glossary addition)
- Delete (`git rm`, unreferenced stale fixtures of the retired report format): `skills/opencode-permission-optimizer/test/fixtures/scenarios/*.json` (8 files) and `skills/opencode-permission-optimizer/test/fixtures/cli/*` (the 1.x inspector CLI fixtures)
- Test: `skills/opencode-permission-optimizer/test/agent-permission-report.test.ts`, `skills/opencode-permission-optimizer/test/lib/requested-url-matches.test.ts` (new), `test/contract.test.ts`

## Interfaces

- Consumes: task 04's `PermissionDecisionHistory`/`ResourceDecisionHistory` (`approvalsBySource`, `resources`), task 05's inspector JSON: `AgentListReport = { agents: [{ id, name, mode, hidden }] }` and `EffectivePolicyReport = { agents: [{ id, name, mode, hidden, rules: [{ action, resource, effect, position, origin }] }] }`.
- Produces (task 08's SKILL documents this exact JSON):
  - `requested-url-matches.ts`:
    ```ts
    /** The smallest number of distinct requested URLs on one origin that supports a URL-origin recommendation. */
    export const MIN_DISTINCT_REQUESTED_URLS = 2
    /** Mirrors the OpenCode runtime's wildcard matcher (last match wins; `*` spans any run, `?` one character, trailing " *" optional). */
    export function matchesRuntimeWildcard(value: string, pattern: string): boolean
    export interface WebfetchRequestedUrlMatch {
      origin: string
      proposedPattern: string
      requestedUrls: string[]
      distinctRequestedUrlCount: number
      qualifyingApprovals: number
    }
    export function buildWebfetchRequestedUrlMatches(
      resources: ReadonlyArray<{ resource: string; approvalsBySource: ApprovalsBySource }>,
    ): WebfetchRequestedUrlMatch[]
    ```
    (`ApprovalsBySource` imported from `./read-observations`.)
  - Report v2 (`summaryVersion: 2`) — on an available database: `base` = `{ summaryVersion: 2, generatedAt, repository, agent: { id, name: null, mode: null, hidden: null }, retainedInterval }`; the resolved agent section reads `{ id, name, mode, hidden }`; `counts` passes the reader's totals through unchanged (including `approvalsBySource`); `effectivePolicy: { rules }`; `resources` replaces `inputs`; new `webfetchRequestedUrlMatches` array.
  - Incompatible-schema error (thrown by the report builder): `incompatible schema: expected 5, found <found|null → unknown> — start OpenCode with the updated opencode-permissions plugin so the database migrates on startup, or update this skill to the release that recorded the database`.

## Runtime matcher facts

The v2.3.2 matcher (`packages/core/src/util/wildcard.ts`) escapes `.+^${}()|[\]\\`, maps `*` → `.*` and `?` → `.`, normalizes backslashes to forward slashes, turns a trailing `" .*"` into an optional `( .*)?`, anchors both ends, and matches case-sensitively with dot-all on POSIX. The proposed URL-origin pattern is `<origin>/*` (e.g. `https://docs.example.com/*`), so `https://docs.example.com/latest` matches, while lookalike hosts, sibling subdomains, other ports, and other schemes do not.

- [ ] **Step 1: Write the failing tests**

(a) New file `skills/opencode-permission-optimizer/test/lib/requested-url-matches.test.ts` (complete new content):

```ts
import { describe, expect, it } from "bun:test"
import {
  buildWebfetchRequestedUrlMatches,
  matchesRuntimeWildcard,
  MIN_DISTINCT_REQUESTED_URLS,
} from "../../src/lib/requested-url-matches"

const bothSources = { "1.x": 0, "2.x": 1 } as const

describe("matchesRuntimeWildcard", () => {
  it("admits every path and query under a proposed origin pattern", () => {
    expect(matchesRuntimeWildcard("https://docs.example.com/a/b?x=1", "https://docs.example.com/*")).toBe(true)
    expect(matchesRuntimeWildcard("https://docs.example.com/", "https://docs.example.com/*")).toBe(true)
  })

  it("rejects lookalike hosts, sibling subdomains, other ports, and other schemes", () => {
    expect(matchesRuntimeWildcard("https://docs.example.com.evil.net/x", "https://docs.example.com/*")).toBe(false)
    expect(matchesRuntimeWildcard("https://api.docs.example.com/x", "https://docs.example.com/*")).toBe(false)
    expect(matchesRuntimeWildcard("https://docs.example.com:8443/x", "https://docs.example.com/*")).toBe(false)
    expect(matchesRuntimeWildcard("http://docs.example.com/x", "https://docs.example.com/*")).toBe(false)
  })

  it("honors the runtime's trailing-space optionality and single-character match", () => {
    expect(matchesRuntimeWildcard("git diff", "git diff *")).toBe(true)
    expect(matchesRuntimeWildcard("git diff --stat", "git diff *")).toBe(true)
    expect(matchesRuntimeWildcard("git difx", "git dif?")).toBe(true)
  })
})

describe("buildWebfetchRequestedUrlMatches", () => {
  it("requires two distinct qualifying 2.x URLs on one exact origin", () => {
    const matches = buildWebfetchRequestedUrlMatches([
      { resource: "https://docs.example.com/intro", approvalsBySource: bothSources },
      { resource: "https://docs.example.com/advanced", approvalsBySource: bothSources },
    ])
    expect(matches).toEqual([
      {
        origin: "https://docs.example.com",
        proposedPattern: "https://docs.example.com/*",
        requestedUrls: ["https://docs.example.com/advanced", "https://docs.example.com/intro"],
        distinctRequestedUrlCount: 2,
        qualifyingApprovals: 2,
      },
    ])
    expect(MIN_DISTINCT_REQUESTED_URLS).toBe(2)
  })

  it("keeps one URL alone below the evidence threshold", () => {
    const matches = buildWebfetchRequestedUrlMatches([
      { resource: "https://docs.example.com/only", approvalsBySource: bothSources },
    ])
    expect(matches).toEqual([])
  })

  it("ignores legacy webfetch history and unproven requests", () => {
    const matches = buildWebfetchRequestedUrlMatches([
      { resource: "https://docs.example.com/a", approvalsBySource: { "1.x": 3, "2.x": 0 } },
      { resource: "https://docs.example.com/b", approvalsBySource: { "1.x": 0, "2.x": 0 } },
      { resource: "not a url", approvalsBySource: bothSources },
      { resource: "ftp://docs.example.com/c", approvalsBySource: bothSources },
    ])
    expect(matches).toEqual([])
  })

  it("separates origins and keeps an explicit port in the pattern", () => {
    const matches = buildWebfetchRequestedUrlMatches([
      { resource: "https://docs.example.com:8443/a", approvalsBySource: bothSources },
      { resource: "https://docs.example.com:8443/b", approvalsBySource: bothSources },
      { resource: "https://api.example.org/x", approvalsBySource: bothSources },
      { resource: "https://api.example.org/y", approvalsBySource: bothSources },
    ])
    expect(matches.map((match) => match.proposedPattern)).toEqual([
      "https://api.example.org/*",
      "https://docs.example.com:8443/*",
    ])
    expect(matches[1]).toMatchObject({ origin: "https://docs.example.com:8443", distinctRequestedUrlCount: 2 })
  })

  it("sums qualifying approvals across the grouped URLs", () => {
    const matches = buildWebfetchRequestedUrlMatches([
      { resource: "https://docs.example.com/a", approvalsBySource: { "1.x": 0, "2.x": 2 } },
      { resource: "https://docs.example.com/b", approvalsBySource: { "1.x": 1, "2.x": 3 } },
    ])
    expect(matches[0].qualifyingApprovals).toBe(5)
  })
})
```

(b) In `test/agent-permission-report.test.ts`: update every fixture/construction that uses `permission`/`patterns`/`inputs` to the schema-5 reader names (`action`/`resources`/`resources`), and add:

```ts
test("emits webfetch requested-URL matches for two qualifying 2.x approvals on one origin", () => {
  const { dbPath, cleanup } = createDatabaseWithContext()
  try {
    insertObservation(dbPath, { requestId: "req_fetch_1", sessionId: "s1", action: "webfetch", resources: ["https://docs.example.com/intro"], worktree: "/w", decision: "once", askedAt: ASKED_AT, decidedAt: ASKED_AT, completedAt: ASKED_AT })
    insertObservation(dbPath, { requestId: "req_fetch_2", sessionId: "s2", action: "webfetch", resources: ["https://docs.example.com/advanced"], worktree: "/w", decision: "once", askedAt: ASKED_AT, decidedAt: ASKED_AT, completedAt: ASKED_AT })

    const report = buildAgentPermissionReport({
      agent: "build", workingDirectory: toAbsolutePath(WORKTREE, "working directory"),
      now: NOW, databasePath: dbPath, env: {},
      invokeInspector: () => inspectorFixtureForAgent("build"),
    }) as Record<string, unknown>

    expect(report.webfetchRequestedUrlMatches).toEqual([
      {
        origin: "https://docs.example.com",
        proposedPattern: "https://docs.example.com/*",
        requestedUrls: ["https://docs.example.com/advanced", "https://docs.example.com/intro"],
        distinctRequestedUrlCount: 2,
        qualifyingApprovals: 2,
      },
    ])
  } finally {
    cleanup()
  }
})

test("names what to update or start first when the recorded schema is older than the reader", () => {
  const { dbPath, cleanup } = createDatabaseWithContext()
  try {
    const writer = new Database(dbPath)
    writer.run("UPDATE schema_metadata SET version = 4")
    writer.close()
    expect(() =>
      buildAgentPermissionReport({
        agent: "build", workingDirectory: toAbsolutePath(WORKTREE, "working directory"),
        now: NOW, databasePath: dbPath, env: {},
        invokeInspector: () => inspectorFixtureForAgent("build"),
      }),
    ).toThrow(
      "incompatible schema: expected 5, found 4 — start OpenCode with the updated opencode-permissions plugin so the database migrates on startup, or update this skill to the release that recorded the database",
    )
  } finally {
    cleanup()
  }
})
```

(Reuse the file's existing scaffolding for temp databases and inspector fixtures. Define the inspector stub used above as a small helper in the test file:

```ts
function inspectorFixtureForAgent(agentId: string): Record<string, unknown> {
  return {
    agents: [
      {
        id: agentId,
        name: agentId,
        mode: "primary",
        hidden: false,
        rules: [{ action: "read", resource: "*", effect: "allow", position: 0, origin: { scope: "unknown", source: null } }],
      },
    ],
  }
}
```

called as `invokeInspector: (args) => args.form === "list-agents" ? listAgentsFixture : inspectorFixtureForAgent("build")` with `const listAgentsFixture = { agents: [{ id: "build", name: "build", mode: "primary", hidden: false }] }` defined once; also update the pre-existing report assertions to the native field names and `summaryVersion: 2`.)

(c) In `test/contract.test.ts`: replace the mirrored gate from task 04 with the real call — import `buildAgentPermissionReport` from the optimizer skill (as the file did at v4) and assert the full new error text (`...expected 5, found 999 — start OpenCode...`) plus the `{ state: "incompatible", schemaVersion: 5, foundSchemaVersion: 999 }` state, deleting the local `assertReaderSchema` helper.

- [ ] **Step 2: Run the optimizer tests to verify they fail**

Run: `bun test skills/opencode-permission-optimizer ./test`
Expected: FAIL — `requested-url-matches.ts` does not exist and the report still emits `summaryVersion: 1`.

- [ ] **Step 3: Write the implementation**

(a) Create `skills/opencode-permission-optimizer/src/lib/requested-url-matches.ts` (complete new content):

```ts
import type { ApprovalsBySource } from "./read-observations"

/** The smallest number of distinct requested URLs on one origin that supports a URL-origin recommendation. */
export const MIN_DISTINCT_REQUESTED_URLS = 2

/**
 * One webfetch requested-URL match: qualifying 2.x approvals whose requested
 * URLs share one exact http/https URL origin, paired with the origin-scoped
 * rule pattern that covers exactly those URLs under the runtime's string
 * matcher.
 */
export interface WebfetchRequestedUrlMatch {
  origin: string
  proposedPattern: string
  requestedUrls: string[]
  distinctRequestedUrlCount: number
  qualifyingApprovals: number
}

/**
 * Mirrors OpenCode's runtime string matcher: backslashes normalize to
 * forward slashes, `*` matches any run of characters, `?` one character,
 * a trailing ` *` is optional, matching is anchored, dot-all, and
 * case-sensitive on POSIX platforms.
 */
export function matchesRuntimeWildcard(value: string, pattern: string): boolean {
  const normalized = value.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}

/**
 * Groups a webfetch action's requested resources by exact URL origin. Only
 * an http or https URL with at least one qualifying 2.x approval joins a
 * group; legacy history, unproven requests, non-URLs, and URLs the proposed
 * pattern cannot cover under the runtime matcher are all withheld. A group
 * supports a recommendation only when it holds at least
 * `MIN_DISTINCT_REQUESTED_URLS` distinct URLs; results are ordered by origin
 * and carry the sorted distinct URLs and the summed qualifying 2.x approvals.
 * The pattern admits unobserved paths and queries on the origin — that
 * breadth is stated by the calling workflow, not narrowed here.
 */
export function buildWebfetchRequestedUrlMatches(
  resources: ReadonlyArray<{ resource: string; approvalsBySource: ApprovalsBySource }>,
): WebfetchRequestedUrlMatch[] {
  const groups = new Map<string, { urls: Map<string, number> }>()
  for (const { resource, approvalsBySource } of resources) {
    const approvals = approvalsBySource["2.x"]
    if (approvals <= 0) continue
    const parsed = parseHttpUrl(resource)
    if (parsed === null) continue
    const origin = parsed.origin
    const proposedPattern = `${origin}/*`
    if (!matchesRuntimeWildcard(parsed.href, proposedPattern)) continue
    const group = groups.get(origin) ?? { urls: new Map<string, number>() }
    group.urls.set(parsed.href, (group.urls.get(parsed.href) ?? 0) + approvals)
    groups.set(origin, group)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.urls.size >= MIN_DISTINCT_REQUESTED_URLS)
    .map(([origin, group]) => ({
      origin,
      proposedPattern: `${origin}/*`,
      requestedUrls: [...group.urls.keys()].sort(),
      distinctRequestedUrlCount: group.urls.size,
      qualifyingApprovals: [...group.urls.values()].reduce((total, count) => total + count, 0),
    }))
    .sort((a, b) => (a.origin < b.origin ? -1 : 1))
}

function parseHttpUrl(resource: string): URL | null {
  let url: URL
  try {
    url = new URL(resource)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  return url
}
```

(b) `src/agent-permission-report.ts`:
1. `base.summaryVersion = 1` → `2`; `base.agent` becomes `{ id: agent, name: null, mode: null, hidden: null }`.
2. `buildAvailableDatabaseReport`: the report body becomes
   ```ts
   const matchedAgent = findInspectorAgent(
     invokeInspector({ form: "list-agents" }),
     agent,
     "runtime agent inventory",
   )
   const policyEntry = findInspectorAgent(
     invokeInspector({ form: "show-effective", agent }),
     agent,
     "effective-policy report",
   )
   return {
     ...base,
     databaseState: "available",
     schemaVersion: opened.schemaVersion,
     agent: { id: matchedAgent.id, name: matchedAgent.name, mode: matchedAgent.mode, hidden: matchedAgent.hidden },
     counts: decisionHistory.counts,
     effectivePolicy: { rules: policyEntry.rules },
     resources: decisionHistory.resources,
     webfetchRequestedUrlMatches: buildWebfetchRequestedUrlMatches(
       decisionHistory.resources.filter((entry) => entry.action === "webfetch"),
     ),
   }
   ```
   `findInspectorAgent` matches by `entry.id === agent` (both invocations); the `InspectorAgent` internal type becomes `{ id: string; name: string | null; mode: string | null; hidden: boolean | null; rules: unknown }` with `readInspectorAgent` narrowing the new report shapes and throwing `inspector returned an agent entry without an id` otherwise. `buildMissingDatabaseReport` writes the same v2 base (fields `agent`, `databaseState: "missing"`, `schemaVersion: null`, `counts` with the zero-filled `approvalsBySource` breakdown `{ "1.x": 0, "2.x": 0 }`, `effectivePolicy: null`, `resources: []`, `webfetchRequestedUrlMatches: []`).
3. The incompatible branch throws the Produces message (`found` `?? "unknown"`).
4. `HELP` — append one line to the options block: `The report JSON follows summary version 2 (native 2.x action/resource/effect fields).` No CLI flag changes.
5. `InspectorRequest` stays `{ form: "list-agents" } | { form: "show-effective"; agent: string }`; `defaultInvokeInspector`'s delegation to `inspect.sh` and its output-file handling are unchanged.

(c) `skills/opencode-permission-optimizer/README.md`: update the Package layout entries (`src/lib/requested-url-matches.ts` added), the Report JSON section to the v2 shape (the Produces report above, with a short paragraph: `webfetchRequestedUrlMatches` groups qualifying 2.x webfetch approvals by exact URL origin and proposes `<origin>/*`; the pattern admits unobserved paths and queries, and the workflow — not the report — states its limits), and any remaining `inputs`/`pattern` mention to `resources`/`resource`.

(d) `CONTEXT.md` — append to the `Recorded history` section, below **History source**:

```markdown
**Webfetch requested-URL match**:
Qualifying 2.x webfetch approvals whose requested URLs share one exact http/https URL origin, paired with the `<origin>/*` rule pattern that covers them; the report groups them and the workflow makes the recommendation.
_Avoid_: domain evidence, origin rules
```

(e) Delete the stale fixtures: `git rm skills/opencode-permission-optimizer/test/fixtures/scenarios/*.json skills/opencode-permission-optimizer/test/fixtures/cli/*` (the scenario JSONs document the retired report version, and the cli fixtures capture removed 1.x inspector commands; neither is imported by any test).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test skills/opencode-permission-optimizer ./test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Changed-code audit and commit**

```bash
git add CONTEXT.md skills/opencode-permission-optimizer test/contract.test.ts
git commit -m "feat: report native 2.x evidence with webfetch requested-URL matches"
```

## Changed-code audit

**Exported declarations:**
- `MIN_DISTINCT_REQUESTED_URLS`, `matchesRuntimeWildcard`, `WebfetchRequestedUrlMatch`, `buildWebfetchRequestedUrlMatches` — requested-url-matches.ts — JSDoc states the mirror semantics, the grouping rules, and that the pattern's breadth is stated by the workflow.
- `buildAgentPermissionReport` — summary version 2; JSDoc states the id-based agent resolution, the native field pass-through, and the incompatible-schema guidance text.

**Long bodies:** `buildWebfetchRequestedUrlMatches` (~30 lines), `parseHttpUrl` (8) — below threshold. `buildAvailableDatabaseReport` stays declarative (~20 lines).
