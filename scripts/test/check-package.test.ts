import { describe, it, expect } from "bun:test"
import { assertPackageContents, type PackageContents } from "../check-package"

const VALID: PackageContents = {
  declaredFiles: [
    ".opencode/plugins/permission-optimizer",
    "!.opencode/plugins/permission-optimizer/test/",
    "README.md",
    "LICENSE",
  ],
  packedPaths: [
    ".opencode/plugins/permission-optimizer/index.ts",
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

  it("rejects a package whose files list omits the license", () => {
    const declaredFiles = VALID.declaredFiles.filter((entry) => entry !== "LICENSE")
    expect(() => assertPackageContents({ ...VALID, declaredFiles })).toThrow(
      "package files list is missing LICENSE",
    )
  })

  it("rejects a package that ships a file outside the plugin directory", () => {
    const packedPaths = [...VALID.packedPaths, "skills/opencode-permissions/SKILL.md"]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes files outside the allowed folders and extensions: skills/opencode-permissions/SKILL.md",
    )
  })

  it("rejects a package that ships a test file from the plugin directory", () => {
    const packedPaths = [
      ...VALID.packedPaths,
      ".opencode/plugins/permission-optimizer/test/store.test.ts",
    ]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes files outside the allowed folders and extensions: .opencode/plugins/permission-optimizer/test/store.test.ts",
    )
  })

  it("rejects a package that ships a helper from the repository test directory", () => {
    const packedPaths = [...VALID.packedPaths, "test/helpers/source-import-specifiers.ts"]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes files outside the allowed folders and extensions: test/helpers/source-import-specifiers.ts",
    )
  })

  it("rejects a package that ships a plugin directory file that is neither source, SQL nor documentation", () => {
    const packedPaths = [...VALID.packedPaths, ".opencode/plugins/permission-optimizer/notes.txt"]
    expect(() => assertPackageContents({ ...VALID, packedPaths })).toThrow(
      "npm pack includes files outside the allowed folders and extensions: .opencode/plugins/permission-optimizer/notes.txt",
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
