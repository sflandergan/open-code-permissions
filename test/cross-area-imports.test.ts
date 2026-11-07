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
