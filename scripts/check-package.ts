import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ENTRY_PATH = ".opencode/plugins/permission-optimizer/index.ts"
const SCHEMA_PATH = ".opencode/plugins/permission-optimizer/schema.sql"
const MIGRATIONS_PREFIX = ".opencode/plugins/permission-optimizer/migrations/"
const REQUIRED_DECLARATIONS: readonly string[] = [
  ".opencode/plugins/permission-optimizer",
  "!.opencode/plugins/permission-optimizer/test/",
  "README.md",
  "LICENSE",
]
const PLUGIN_DIRECTORY = ".opencode/plugins/permission-optimizer/"
const ROOT_FILES: readonly string[] = ["package.json", "README.md", "LICENSE"]
const PLUGIN_FILE_EXTENSIONS: readonly string[] = [".ts", ".sql", ".md"]
const TEST_DIRECTORY_NAME = "test"

/** The paths npm would pack and the `files` list declared in package.json. */
export interface PackageContents {
  packedPaths: string[]
  declaredFiles: string[]
}

function isAllowed(path: string): boolean {
  if (path === ENTRY_PATH || ROOT_FILES.includes(path)) {
    return true
  }
  if (!path.startsWith(PLUGIN_DIRECTORY)) {
    return false
  }
  const relativePath = path.slice(PLUGIN_DIRECTORY.length)
  const directoryNames = relativePath.split("/").slice(0, -1)
  if (directoryNames.includes(TEST_DIRECTORY_NAME)) {
    return false
  }
  return PLUGIN_FILE_EXTENSIONS.some((extension) => relativePath.endsWith(extension))
}

/**
 * Assert that a package's files list declares the plugin entry, plugin
 * directory, README and LICENSE, and that `npm pack --dry-run --json` would
 * ship only `package.json`, `README.md`, `LICENSE`, the plugin entry, and
 * `.ts`, `.sql` and `.md` files in the plugin directory outside its `test/`
 * directories. When the plugin entry is packed, the schema and at least one
 * migration must be packed with it. Throws an Error naming the first
 * offending declaration or all disallowed paths.
 */
export function assertPackageContents(contents: PackageContents): void {
  const { packedPaths, declaredFiles } = contents
  for (const required of REQUIRED_DECLARATIONS) {
    if (!declaredFiles.includes(required)) {
      throw new Error(`package files list is missing ${required}`)
    }
  }
  if (!packedPaths.includes("package.json")) {
    throw new Error("npm pack did not include package.json")
  }
  const offenders = packedPaths.filter((path) => !isAllowed(path))
  if (offenders.length > 0) {
    throw new Error(`npm pack includes files outside the allowed folders and extensions: ${offenders.join(", ")}`)
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
