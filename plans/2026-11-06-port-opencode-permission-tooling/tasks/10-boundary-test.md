# Task 10: Boundary test

**Objective:** Enforce with a static import scan that no production file in the plugin, in a published skill, or in `scripts/` imports from another of those areas.

**Unit:** 5 (Guards). Depends on Task 02 (`scripts/check-package.ts`), Task 03/04 (`opencode-permissions` skill), Task 05 (plugin), Task 07/08 (`opencode-permission-optimizer` skill).

**Files:**
- Create: `test/helpers/production-imports.ts`
- Create: `test/boundary.test.ts`

**Interfaces:**
- Consumes: the repository layout from Tasks 02–08.
- Produces (helper API used only by `test/boundary.test.ts`):
  - `export type Area = "plugin" | "opencode-permissions" | "opencode-permission-optimizer" | "scripts"`
  - `export interface ProductionFile { path: string; area: Area | null; imports: string[] }`
  - `export function areaOf(path: string): Area | null`
  - `export function collectProductionFiles(root: string): ProductionFile[]`
  - `export function findAreaViolations(files: ProductionFile[]): string[]` — one message per offending import, naming the file, specifier and target area.

This is a test-only addition. Per `docs/TESTING.md` no new failing test is required; the deliverable is a passing guard that also proves its own scan covered real files. The code below is complete.

- [ ] **Step 1: Write the helper**

```bash
mkdir -p test/helpers
```

Create `test/helpers/production-imports.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"

export type Area = "plugin" | "opencode-permissions" | "opencode-permission-optimizer" | "scripts"

export interface ProductionFile {
  path: string
  area: Area | null
  imports: string[]
}

const AREA_ROOTS: readonly string[] = [
  ".opencode/plugins/permission-optimizer.ts",
  ".opencode/plugins/permission-optimizer",
  ".agents/skills/opencode-permissions",
  ".agents/skills/opencode-permission-optimizer",
  "scripts",
]

/** Classify a repository-relative path into the product area that owns it. */
export function areaOf(path: string): Area | null {
  const p = path.replace(/\\/g, "/")
  if (
    p.startsWith(".opencode/plugins/permission-optimizer/") ||
    p.startsWith(".opencode/plugins/permission-optimizer.ts")
  ) {
    return "plugin"
  }
  if (p.startsWith(".agents/skills/opencode-permissions/")) return "opencode-permissions"
  if (p.startsWith(".agents/skills/opencode-permission-optimizer/")) return "opencode-permission-optimizer"
  if (p.startsWith("scripts/")) return "scripts"
  return null
}

function extractImports(source: string): string[] {
  const found = new Set<string>()
  const patterns = [
    "\\bfrom\\s*[\"']([^\"']+)[\"']",
    "\\bimport\\s*[\"']([^\"']+)[\"']",
    "\\bimport\\s*\\(\\s*[\"']([^\"']+)[\"']\\s*\\)",
  ]
  for (const pattern of patterns) {
    const re = new RegExp(pattern, "g")
    for (const match of source.matchAll(re)) {
      if (match[1] !== undefined) found.add(match[1])
    }
  }
  return [...found]
}

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".temp" || entry.name === "test") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, root, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue
    out.push(relative(root, full).replace(/\\/g, "/"))
  }
}

/** Collect every non-test TypeScript production file in the four product areas. */
export function collectProductionFiles(root: string): ProductionFile[] {
  const files: ProductionFile[] = []
  for (const areaRoot of AREA_ROOTS) {
    const abs = join(root, areaRoot)
    if (!existsSync(abs)) continue
    const paths: string[] = []
    if (statSync(abs).isFile()) paths.push(areaRoot)
    else walk(abs, root, paths)
    for (const path of paths) {
      const source = readFileSync(join(root, path), "utf8")
      files.push({ path, area: areaOf(path), imports: extractImports(source) })
    }
  }
  return files
}

/** Return one message per production import whose resolved target is in a different area. */
export function findAreaViolations(files: ProductionFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    if (file.area === null) continue
    for (const specifier of file.imports) {
      if (!specifier.startsWith(".")) continue
      const target = normalize(join(dirname(file.path), specifier)).replace(/\\/g, "/")
      const targetArea = areaOf(target)
      if (targetArea !== null && targetArea !== file.area) {
        violations.push(`${file.path} imports ${specifier} from ${targetArea}`)
      }
    }
  }
  return violations
}
```

Only relative import specifiers are checked; bare specifiers (`bun:sqlite`, `node:fs`, `@opencode-ai/plugin`) are external by definition. Test files (`*.test.ts`), `test/` directories, `node_modules`, and `.temp/` are excluded, so the contract test and the seed fixture do not count as cross-area production imports.

- [ ] **Step 2: Write the test**

Create `test/boundary.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { join } from "node:path"
import {
  areaOf,
  collectProductionFiles,
  findAreaViolations,
  type ProductionFile,
} from "./helpers/production-imports"

function productionFile(path: string, imports: string[]): ProductionFile {
  return { path, area: areaOf(path), imports }
}

describe("production import areas", () => {
  it("rejects a plugin module that imports a published skill", () => {
    const files = [
      productionFile(".opencode/plugins/permission-optimizer/store.ts", [
        "../../../.agents/skills/opencode-permissions/scripts/lib/jsonc",
      ]),
    ]
    expect(findAreaViolations(files)).toEqual([
      ".opencode/plugins/permission-optimizer/store.ts imports ../../../.agents/skills/opencode-permissions/scripts/lib/jsonc from opencode-permissions",
    ])
  })

  it("accepts a plugin module that imports another plugin module", () => {
    const files = [
      productionFile(".opencode/plugins/permission-optimizer/store.ts", ["./database", "./schema"]),
    ]
    expect(findAreaViolations(files)).toEqual([])
  })

  it("finds no production imports crossing between product areas in this repository", () => {
    const repoRoot = join(import.meta.dirname, "..")
    const files = collectProductionFiles(repoRoot)

    expect(files.length).toBeGreaterThan(0)
    for (const area of [
      "plugin",
      "opencode-permissions",
      "opencode-permission-optimizer",
      "scripts",
    ] as const) {
      expect(files.filter((file) => file.area === area).length).toBeGreaterThan(0)
    }
    expect(findAreaViolations(files)).toEqual([])
  })
})
```

The per-area count assertions are the main proof that the scan actually covered real production files in all four areas; the empty-violations assertion is the secondary guard.

- [ ] **Step 3: Run the test**

Run: `bun test ./test/boundary.test.ts`
Expected: PASS — 3 tests, 0 failures, with production files found in all four areas.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 4: Record the changed-code audit tables (task acceptance)**

Exported declarations: `Area`, `ProductionFile`, `areaOf`, `collectProductionFiles`, `findAreaViolations` — record file, line range, contract, invariants (only relative specifiers; test and `node_modules` directories excluded), and JSDoc location for each. Long bodies (over 40 physical lines): `areaOf`, `extractImports`, `walk`, `collectProductionFiles`, and `findAreaViolations` are each under 40 lines; state this explicitly with their complete body bounds. `test/boundary.test.ts` has no exported declarations.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/production-imports.ts test/boundary.test.ts
git commit -m "test: forbid production imports across product areas"
```
