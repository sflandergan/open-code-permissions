# Task 11: Mark internal skills

**Objective:** Add `mark-internal-skills.ts` (with `--check`), its unit tests and a repository guard, then patch the installed toolkit skills so the skills CLI offers consumers only the two published skills.

**Unit:** 5 (Guards). Depends on Task 01 (script name), Task 04 and Task 08 (the two published skills exist and are not internal).

**Files:**
- Create: `scripts/mark-internal-skills.ts`
- Create: `scripts/test/mark-internal-skills.test.ts`
- Create: `test/internal-skills.test.ts`
- Modify: `.agents/skills/*/SKILL.md` for every non-published toolkit skill (add `metadata.internal: true`; 21 files at plan-authoring time).

**Interfaces:**
- Consumes: `package.json` `scripts["mark-internal-skills"]` = `bun scripts/mark-internal-skills.ts` (Task 01); the two published skills (Tasks 04, 08).
- Produces:
  - `export interface SkillDocument { name: string; content: string }`
  - `export function isPublishedSkill(name: string): boolean`
  - `export function isSkillInternal(content: string): boolean`
  - `export function markSkillInternal(content: string): string`
  - `export function findOffenders(files: SkillDocument[]): string[]`
  - `export function findPublishedMarkedInternal(files: SkillDocument[]): string[]`
  - `export function collectSkillDocuments(root: string): SkillDocument[]`
  - CLI: `bun scripts/mark-internal-skills.ts` writes the marker; `--check` reports offenders and exits non-zero without writing.

`PUBLISHED_SKILLS` is the single file-level constant naming the two published skills. The only exclusion mechanism the skills CLI documents is `metadata.internal: true`; `skills.sh.json` `paths` can only add locations. `.claude/skills/*` are symlinks into `.agents/skills/`, so patching `.agents/skills/` covers both discovery roots.

- [ ] **Step 1: Write the failing unit test**

```bash
mkdir -p scripts/test
```

Create `scripts/test/mark-internal-skills.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import {
  findOffenders,
  findPublishedMarkedInternal,
  isSkillInternal,
  markSkillInternal,
  type SkillDocument,
} from "../mark-internal-skills"

const PLAIN = [
  "---",
  "name: bugfix",
  "description: Use when x",
  "argument-hint: [x]",
  "disable-model-invocation: true",
  "---",
  "",
  "You are the agent.",
  "",
].join("\n")

const MARKED = [
  "---",
  "name: bugfix",
  "description: Use when x",
  "argument-hint: [x]",
  "disable-model-invocation: true",
  "metadata:",
  "  internal: true",
  "---",
  "",
  "You are the agent.",
  "",
].join("\n")

describe("internal skill marking", () => {
  it("adds internal metadata to a skill whose frontmatter has no metadata block", () => {
    expect(markSkillInternal(PLAIN)).toBe(MARKED)
  })

  it("adds internal metadata to a skill whose frontmatter already has a metadata block", () => {
    const withMetadata = [
      "---",
      "name: foo",
      "metadata:",
      "  owner: team",
      "description: y",
      "---",
      "",
      "Body.",
      "",
    ].join("\n")
    expect(markSkillInternal(withMetadata)).toBe(
      [
        "---",
        "name: foo",
        "metadata:",
        "  owner: team",
        "  internal: true",
        "description: y",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    )
  })

  it("returns the original document when a skill is already internal", () => {
    expect(markSkillInternal(MARKED)).toBe(MARKED)
    expect(isSkillInternal(MARKED)).toBe(true)
  })

  it("throws for a skill document with no frontmatter", () => {
    expect(() => markSkillInternal("# Title\n\nBody.\n")).toThrow("SKILL.md has no frontmatter block")
  })

  it("names the toolkit skills that lack the internal marker", () => {
    const files: SkillDocument[] = [
      { name: "bugfix", content: PLAIN },
      { name: "opencode-permissions", content: PLAIN },
    ]
    expect(findOffenders(files)).toEqual(["bugfix"])
  })

  it("names the published skills that carry the internal marker", () => {
    const files: SkillDocument[] = [
      { name: "opencode-permissions", content: MARKED },
      { name: "bugfix", content: MARKED },
    ]
    expect(findPublishedMarkedInternal(files)).toEqual(["opencode-permissions"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test ./scripts/test/mark-internal-skills.test.ts`
Expected: FAIL — `Cannot find module '../mark-internal-skills'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/mark-internal-skills.ts`:

```ts
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PUBLISHED_SKILLS: readonly string[] = ["opencode-permissions", "opencode-permission-optimizer"]
const SKILLS_ROOT = ".agents/skills"

/** One skill's name and raw SKILL.md content. */
export interface SkillDocument {
  name: string
  content: string
}

export function isPublishedSkill(name: string): boolean {
  return PUBLISHED_SKILLS.includes(name)
}

function frontmatterBody(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  return match === null ? "" : match[1]
}

export function isSkillInternal(content: string): boolean {
  const lines = frontmatterBody(content).split(/\r?\n/)
  const metadataIndex = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (metadataIndex === -1) {
    return lines.some((line) => /^metadata\.internal:\s*true\s*$/.test(line))
  }
  let end = metadataIndex + 1
  while (end < lines.length && /^\s+/.test(lines[end])) end++
  return lines.slice(metadataIndex + 1, end).some((line) => /^\s+internal:\s*true\s*$/.test(line))
}

/**
 * Add `metadata.internal: true` to a skill's frontmatter, merging into an
 * existing `metadata` block and leaving every other key untouched. Returns
 * the content unchanged when the marker is already present. Throws when the
 * document has no `---` frontmatter block.
 */
export function markSkillInternal(content: string): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/.exec(content)
  if (match === null) throw new Error("SKILL.md has no frontmatter block")
  if (isSkillInternal(content)) return content
  const [, open, body, close, rest] = match
  const lines = body.split(/\r?\n/)
  const metadataIndex = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  if (metadataIndex === -1) {
    const updated = [...lines, "metadata:", "  internal: true"]
    return `${open}${updated.join("\n")}${close}${rest}`
  }
  let end = metadataIndex + 1
  while (end < lines.length && /^\s+/.test(lines[end])) end++
  const updated = [...lines.slice(0, end), "  internal: true", ...lines.slice(end)]
  return `${open}${updated.join("\n")}${close}${rest}`
}

/** Names of non-published skills that are not marked internal. */
export function findOffenders(files: SkillDocument[]): string[] {
  return files.filter((file) => !isPublishedSkill(file.name) && !isSkillInternal(file.content)).map((file) => file.name)
}

/** Names of published skills that were incorrectly marked internal. */
export function findPublishedMarkedInternal(files: SkillDocument[]): string[] {
  return files.filter((file) => isPublishedSkill(file.name) && isSkillInternal(file.content)).map((file) => file.name)
}

export function collectSkillDocuments(root: string): SkillDocument[] {
  const dir = join(root, SKILLS_ROOT)
  const docs: SkillDocument[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name, "SKILL.md")
    if (!existsSync(path)) continue
    docs.push({ name: entry.name, content: readFileSync(path, "utf8") })
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name))
}

function main(argv: string[]): number {
  const root = join(import.meta.dirname, "..")
  const docs = collectSkillDocuments(root)
  const offenders = findOffenders(docs)
  const publishedOffenders = findPublishedMarkedInternal(docs)
  if (argv.includes("--check")) {
    if (offenders.length > 0) {
      process.stderr.write(`error: toolkit skills not marked internal: ${offenders.join(", ")}\n`)
    }
    if (publishedOffenders.length > 0) {
      process.stderr.write(`error: published skills must not be internal: ${publishedOffenders.join(", ")}\n`)
    }
    return offenders.length > 0 || publishedOffenders.length > 0 ? 1 : 0
  }
  let changed = 0
  for (const doc of docs) {
    if (isPublishedSkill(doc.name)) continue
    const marked = markSkillInternal(doc.content)
    if (marked !== doc.content) {
      writeFileSync(join(root, SKILLS_ROOT, doc.name, "SKILL.md"), marked)
      changed++
    }
  }
  process.stdout.write(`marked ${changed} toolkit skills internal\n`)
  return publishedOffenders.length > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `bun test ./scripts/test/mark-internal-skills.test.ts`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Write the repository guard**

Create `test/internal-skills.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import {
  collectSkillDocuments,
  findOffenders,
  findPublishedMarkedInternal,
} from "../scripts/mark-internal-skills"

describe("installed skills", () => {
  it("confirms every toolkit skill is internal and both published skills are discoverable", () => {
    const root = join(import.meta.dirname, "..")
    const docs = collectSkillDocuments(root)

    expect(docs.length).toBeGreaterThan(0)
    expect(findOffenders(docs)).toEqual([])
    expect(findPublishedMarkedInternal(docs)).toEqual([])
    expect(() =>
      execFileSync("bun", ["run", "mark-internal-skills", "--check"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).not.toThrow()
  })
})
```

The guard uses the same pure functions as `--check` and also invokes `--check` itself, so a toolkit upgrade that undoes the patch fails CI.

- [ ] **Step 6: Patch the toolkit skills and verify**

Run: `bun run mark-internal-skills`
Expected: prints `marked 21 toolkit skills internal` (the 21 installed toolkit skills; the two published skills are skipped). Verify with `grep -L "internal: true" .agents/skills/*/SKILL.md` that only the two published skills lack the marker.

Run: `bun run mark-internal-skills --check`
Expected: exit 0 with no output.

Run: `bun test ./scripts/test/mark-internal-skills.test.ts ./test/internal-skills.test.ts`
Expected: PASS — 7 tests, 0 failures.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 7: Record the changed-code audit tables (task acceptance)**

Exported declarations: `SkillDocument`, `isPublishedSkill`, `isSkillInternal`, `markSkillInternal`, `findOffenders`, `findPublishedMarkedInternal`, `collectSkillDocuments` — record file, line range, contract, invariants (idempotent merge, published skills never written, `--check` never writes), and JSDoc location. Long bodies (over 40 physical lines): `markSkillInternal` and `main` are each under 40 lines; state this explicitly with complete body bounds. The two test files have no exported declarations.

- [ ] **Step 8: Commit**

```bash
git add scripts/mark-internal-skills.ts scripts/test/mark-internal-skills.test.ts test/internal-skills.test.ts .agents/skills
git commit -m "chore: hide toolkit skills from consumer installs"
```
