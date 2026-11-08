# Task 10: Boundary test

**Objective:** Enforce with a static import scan that no non-test file in the plugin, in a published skill, or in `scripts/` imports from another of those areas.

**Unit:** 5 (Guards). Depends on Task 02 (`scripts/check-package.ts`), Task 03/04 (`opencode-permissions` skill), Task 05 (plugin), Task 07/08 (`opencode-permission-optimizer` skill).

**Files:**
- Create: `test/helpers/source-import-specifiers.ts`
- Create: `test/cross-area-imports.test.ts`

**Interfaces:**
- Consumes: the repository layout from Tasks 02–08.
- Produces (helper API used only by `test/cross-area-imports.test.ts`):
  - `export type SourceArea = "permission-optimizer-plugin" | "opencode-permissions-skill" | "opencode-permission-optimizer-skill" | "repository-scripts"`
  - `export interface SourceFile { path: string; area: SourceArea | null; importSpecifiers: string[] }`
  - `export function findSourceArea(path: string): SourceArea | null`
  - `export function readSourceFiles(root: string): SourceFile[]`
  - `export function findCrossAreaImports(files: SourceFile[]): string[]` — one message per offending import, naming the file, specifier and target area.

This is a test-only addition. Per `docs/TESTING.md` no new failing test is required; the deliverable is a passing guard that also proves its own scan covered real files. The code below is complete.

- [x] **Step 1: Write the helper**

```bash
mkdir -p test/helpers
```

Create `test/helpers/source-import-specifiers.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"

export type SourceArea = "permission-optimizer-plugin" | "opencode-permissions-skill" | "opencode-permission-optimizer-skill" | "repository-scripts"

export interface SourceFile {
  path: string
  area: SourceArea | null
  importSpecifiers: string[]
}

const AREA_ROOTS: readonly string[] = [
  ".opencode/plugins/permission-optimizer.ts",
  ".opencode/plugins/permission-optimizer",
  "skills/opencode-permissions",
  "skills/opencode-permission-optimizer",
  "scripts",
]

/** Return the source area that owns a repository-relative path, or null when no area owns it. */
export function findSourceArea(path: string): SourceArea | null {
  const p = path.replace(/\\/g, "/")
  if (
    p.startsWith(".opencode/plugins/permission-optimizer/") ||
    p.startsWith(".opencode/plugins/permission-optimizer.ts")
  ) {
    return "permission-optimizer-plugin"
  }
  if (p.startsWith("skills/opencode-permissions/")) return "opencode-permissions-skill"
  if (p.startsWith("skills/opencode-permission-optimizer/")) return "opencode-permission-optimizer-skill"
  if (p.startsWith("scripts/")) return "repository-scripts"
  return null
}

function readImportSpecifiers(source: string): string[] {
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

function listTypeScriptPaths(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".temp" || entry.name === "test") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      listTypeScriptPaths(full, root, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue
    out.push(relative(root, full).replace(/\\/g, "/"))
  }
}

/** Read every non-test TypeScript file in the four source areas with its import specifiers. */
export function readSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = []
  for (const areaRoot of AREA_ROOTS) {
    const abs = join(root, areaRoot)
    if (!existsSync(abs)) continue
    const paths: string[] = []
    if (statSync(abs).isFile()) paths.push(areaRoot)
    else listTypeScriptPaths(abs, root, paths)
    for (const path of paths) {
      const source = readFileSync(join(root, path), "utf8")
      files.push({ path, area: findSourceArea(path), importSpecifiers: readImportSpecifiers(source) })
    }
  }
  return files
}

/** Return one message per relative import whose resolved target is in a different source area. */
export function findCrossAreaImports(files: SourceFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    if (file.area === null) continue
    for (const specifier of file.importSpecifiers) {
      if (!specifier.startsWith(".")) continue
      const target = normalize(join(dirname(file.path), specifier)).replace(/\\/g, "/")
      const targetArea = findSourceArea(target)
      if (targetArea !== null && targetArea !== file.area) {
        violations.push(`${file.path} imports ${specifier} from ${targetArea}`)
      }
    }
  }
  return violations
}
```

Only relative import specifiers are checked; bare specifiers (`bun:sqlite`, `node:fs`, `@opencode-ai/plugin`) are external by definition. Test files (`*.test.ts`), `test/` directories, `node_modules`, and `.temp/` are excluded, so the contract test and the seed fixture do not count as cross-area imports.

- [x] **Step 2: Write the test**

Create `test/cross-area-imports.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { join } from "node:path"
import {
  findCrossAreaImports,
  findSourceArea,
  readSourceFiles,
  type SourceArea,
  type SourceFile,
} from "./helpers/source-import-specifiers"

function sourceFile(path: string, importSpecifiers: string[]): SourceFile {
  return { path, area: findSourceArea(path), importSpecifiers }
}

describe("cross-area imports", () => {
  it("rejects a plugin module that imports a published skill", () => {
    const files = [
      sourceFile(".opencode/plugins/permission-optimizer/store.ts", [
        "../../../skills/opencode-permissions/scripts/lib/jsonc",
      ]),
    ]
    expect(findCrossAreaImports(files)).toEqual([
      ".opencode/plugins/permission-optimizer/store.ts imports ../../../skills/opencode-permissions/scripts/lib/jsonc from opencode-permissions-skill",
    ])
  })

  it("accepts a plugin module that imports another plugin module", () => {
    const files = [
      sourceFile(".opencode/plugins/permission-optimizer/store.ts", ["./database", "./schema"]),
    ]
    expect(findCrossAreaImports(files)).toEqual([])
  })

  it("finds no import crossing between source areas in this repository", () => {
    const repoRoot = join(import.meta.dirname, "..")
    const files = readSourceFiles(repoRoot)

    expect(files.length).toBeGreaterThan(0)
    const areas: SourceArea[] = [
      "permission-optimizer-plugin",
      "opencode-permissions-skill",
      "opencode-permission-optimizer-skill",
      "repository-scripts",
    ]
    for (const area of areas) {
      expect(files.filter((file) => file.area === area).length).toBeGreaterThan(0)
    }
    expect(findCrossAreaImports(files)).toEqual([])
  })
})
```

The per-area count assertions are the main proof that the scan actually covered real source files in all four areas; the empty-violations assertion is the secondary guard.

- [x] **Step 3: Run the test**

Run: `bun test ./test/cross-area-imports.test.ts`
Expected: PASS — 3 tests, 0 failures, with source files found in all four areas.

Run: `bun run typecheck`
Expected: exit 0.

- [x] **Step 4: Record the changed-code audit tables (task acceptance)**

Exported declarations: `SourceArea`, `SourceFile`, `findSourceArea`, `readSourceFiles`, `findCrossAreaImports` — record file, line range, contract, invariants (only relative specifiers; test and `node_modules` directories excluded), and JSDoc location for each. Long bodies (over 40 physical lines): `findSourceArea`, `readImportSpecifiers`, `listTypeScriptPaths`, `readSourceFiles`, and `findCrossAreaImports` are each under 40 lines; state this explicitly with their complete body bounds. `test/cross-area-imports.test.ts` has no exported declarations.

- [x] **Step 5: Commit**

```bash
git add test/helpers/source-import-specifiers.ts test/cross-area-imports.test.ts
git commit -m "test: forbid imports across source areas"
```
