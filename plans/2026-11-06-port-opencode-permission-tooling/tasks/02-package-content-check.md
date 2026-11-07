# Task 02: Package-content check

**Objective:** Add the pure `npm pack` assertion with its unit test so CI can prove the package whitelist ships the plugin entry, schema and migrations while excluding skills, tests, fixtures and plans.

**Unit:** 1 (Scaffold). Depends on Task 01 for `package.json`, `tsconfig.json`, and the `check-package` script name.

**Files:**
- Create: `scripts/check-package.ts`
- Test: `scripts/test/check-package.test.ts`

**Interfaces:**
- Consumes: `package.json`'s `files` array (declared whitelist) and `bun run check-package` (script from Task 01).
- Produces:
  - `export interface PackageContents { packedPaths: string[]; declaredFiles: string[] }`
  - `export function assertPackageContents(contents: PackageContents): void` — throws an `Error` naming the offending declaration or packed path; returns `void` when the contents are valid. Used by the CLI and by the unit test.

This is a behavior-changing task, so it follows the write-failing-test → verify-fail → implement → verify-pass → commit cycle.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/check-package.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { assertPackageContents, type PackageContents } from "../check-package"

const VALID: PackageContents = {
  declaredFiles: [
    ".opencode/plugins/permission-optimizer.ts",
    ".opencode/plugins/permission-optimizer",
    "!.opencode/plugins/permission-optimizer/test/",
    "README.md",
    "LICENSE",
  ],
  packedPaths: [
    ".opencode/plugins/permission-optimizer.ts",
    ".opencode/plugins/permission-optimizer/schema.sql",
    ".opencode/plugins/permission-optimizer/migrations/001-v1-to-v3.sql",
    "LICENSE",
    "README.md",
    "package.json",
  ],
}

describe("package contents", () => {
  it("accepts a package that ships the plugin entry, schema, and a migration", () => {
    expect(() => assertPackageContents(VALID)).not.toThrow()
  })

  it("rejects a package whose whitelist omits the license", () => {
    const declaredFiles = VALID.declaredFiles.filter((entry) => entry !== "LICENSE")
    expect(() => assertPackageContents({ ...VALID, declaredFiles })).toThrow(
      "package files whitelist is missing LICENSE",
    )
  })

  it("rejects a package that ships a toolkit skill", () => {
    const packedPaths = [...VALID.packedPaths, ".agents/skills/opencode-permissions/SKILL.md"]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes excluded files: .agents/skills/opencode-permissions/SKILL.md",
    )
  })

  it("rejects a package that ships a test file", () => {
    const packedPaths = [
      ...VALID.packedPaths,
      ".opencode/plugins/permission-optimizer/test/store.test.ts",
    ]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes excluded files: .opencode/plugins/permission-optimizer/test/store.test.ts",
    )
  })

  it("rejects a package that ships plan documents", () => {
    const packedPaths = [...VALID.packedPaths, "plans/2026-11-06-port-opencode-permission-tooling/spec.md"]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes excluded files: plans/2026-11-06-port-opencode-permission-tooling/spec.md",
    )
  })

  it("rejects a package that ships the plugin entry without its schema", () => {
    const packedPaths = VALID.packedPaths.filter(
      (entry) => entry !== ".opencode/plugins/permission-optimizer/schema.sql",
    )
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes the plugin entry but not schema.sql",
    )
  })

  it("rejects a package that omits the package manifest", () => {
    const packedPaths = VALID.packedPaths.filter((entry) => entry !== "package.json")
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack did not include package.json",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test ./scripts/test/check-package.test.ts`
Expected: FAIL — `error: Cannot find module '../check-package'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/check-package.ts`:

```ts
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ENTRY_PATH = ".opencode/plugins/permission-optimizer.ts"
const SCHEMA_PATH = ".opencode/plugins/permission-optimizer/schema.sql"
const MIGRATIONS_PREFIX = ".opencode/plugins/permission-optimizer/migrations/"
const REQUIRED_DECLARATIONS: readonly string[] = [
  ENTRY_PATH,
  ".opencode/plugins/permission-optimizer",
  "!.opencode/plugins/permission-optimizer/test/",
  "README.md",
  "LICENSE",
]
const FORBIDDEN_PREFIXES: readonly string[] = [
  ".agents/",
  ".claude/",
  ".opencode/agents/",
  "plans/",
  ".temp/",
  "scripts/",
  "docs/",
  ".github/",
]

/** The paths npm would pack and the `files` whitelist declared in package.json. */
export interface PackageContents {
  packedPaths: string[]
  declaredFiles: string[]
}

function isForbidden(path: string): boolean {
  if (
    path.endsWith(".test.ts") ||
    path.endsWith(".test.mjs") ||
    path.endsWith(".test.js") ||
    path.endsWith("spec.md")
  ) {
    return true
  }
  if (path.includes("/test/") || path.includes("/fixtures/") || path.includes("/plans/")) {
    return true
  }
  return FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * Assert that a package's files whitelist declares the plugin entry, plugin
 * directory, README and LICENSE, and that `npm pack --dry-run --json` would
 * ship no skills, tests, fixtures, plan documents, scripts, or docs. When the
 * plugin entry is packed, the schema and at least one migration must be packed
 * with it. Throws an Error naming the first offending declaration or path.
 */
export function assertPackageContents(contents: PackageContents): void {
  const { packedPaths, declaredFiles } = contents
  for (const required of REQUIRED_DECLARATIONS) {
    if (!declaredFiles.includes(required)) {
      throw new Error(`package files whitelist is missing ${required}`)
    }
  }
  if (!packedPaths.includes("package.json")) {
    throw new Error("npm pack did not include package.json")
  }
  const offenders = packedPaths.filter(isForbidden)
  if (offenders.length > 0) {
    throw new Error(`npm pack includes excluded files: ${offenders.join(", ")}`)
  }
  if (packedPaths.includes(ENTRY_PATH)) {
    if (!packedPaths.includes(SCHEMA_PATH)) {
      throw new Error("npm pack includes the plugin entry but not schema.sql")
    }
    if (!packedPaths.some((path) => path.startsWith(MIGRATIONS_PREFIX) && path.endsWith(".sql"))) {
      throw new Error("npm pack includes the plugin entry but no migration SQL")
    }
  }
}

interface PackResult {
  files: Array<{ path: string }>
}

function main(): void {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" })
  const parsed = JSON.parse(stdout) as PackResult[]
  const packedPaths = parsed[0].files.map((entry) => entry.path)
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as { files: string[] }
  assertPackageContents({ packedPaths, declaredFiles: manifest.files })
  process.stdout.write("package contents: ok\n")
}

if (import.meta.main) {
  try {
    main()
  } catch (err) {
    process.stderr.write(`error: check-package: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test ./scripts/test/check-package.test.ts`
Expected: PASS — 7 tests, 0 failures.

Run: `bun run check-package`
Expected: PASS — prints `package contents: ok`. The whitelist declarations exist from Task 01; the packed list contains only `package.json` (and `LICENSE`, which already exists at the root), and no excluded files. The schema-completeness invariant is inactive until Task 05 ships the entry, so the command is green from this task onward.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Record the changed-code audit tables (task acceptance)**

Exported declarations:

| Declaration | File / lines | Contract | Invariants / errors | JSDoc |
|---|---|---|---|---|
| `PackageContents` | `scripts/check-package.ts` interface | Packed paths plus declared whitelist | none | above the interface |
| `assertPackageContents` | `scripts/check-package.ts` function | Validates whitelist declarations, packed exclusions, manifest presence, schema completeness | Throws `Error` naming the first offender; returns `void` on success | above the function |

Long bodies (over 40 physical lines): none. `assertPackageContents` and `main` are each under 40 lines; state this explicitly in the worker report.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-package.ts scripts/test/check-package.test.ts
git commit -m "feat: assert the npm pack file list with a pure check"
```
