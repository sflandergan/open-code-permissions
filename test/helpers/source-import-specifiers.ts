import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"

/** The plugin, published-skill, and repository-script areas that must not import from one another. */
export type SourceArea = "permission-optimizer-plugin" | "opencode-permissions-skill" | "opencode-permission-optimizer-skill" | "repository-scripts"

/** A scanned TypeScript source file: its repository-relative path, owning area (`null` when outside all four), and import specifiers. */
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
