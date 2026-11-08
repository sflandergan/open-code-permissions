# Task 11: Mark internal skills

**Objective:** Add `mark-internal-skills.ts` (with `--check`), its unit tests and a repository guard, then mark every installed toolkit skill under `.agents/skills/` internal so the skills CLI offers consumers only the two published skills under `skills/`.

**Unit:** 5 (Guards). Depends on Task 01 (script name), Task 04 and Task 08 (the two published skills exist under `skills/` and are not internal).

**Files:**
- Create: `scripts/mark-internal-skills.ts`
- Create: `scripts/test/mark-internal-skills.test.ts`
- Create: `test/internal-skills.test.ts`
- Modify: `.agents/skills/*/SKILL.md` for every toolkit skill (add `metadata.internal: true`; 21 files at plan-authoring time).

**Interfaces:**
- Consumes: `package.json` `scripts["mark-internal-skills"]` = `bun scripts/mark-internal-skills.ts` (Task 01); the two published skills under `skills/` (Tasks 04, 08).
- Produces:
  - `export interface SkillDocument { name: string; content: string }`
  - `export function isSkillInternal(content: string): boolean`
  - `export function markSkillInternal(content: string): string`
  - `export function findSkillsNotInternal(files: SkillDocument[]): string[]`
  - `export function findSkillsMarkedInternal(files: SkillDocument[]): string[]`
  - `export function readSkillDocuments(skillsDirectory: string): SkillDocument[]`
  - CLI: `bun scripts/mark-internal-skills.ts` writes the marker into every `.agents/skills/*/SKILL.md`; `--check` reports toolkit skills without the marker and published skills with it, and exits non-zero without writing.

Published skills live in `skills/` and toolkit skills in `.agents/skills/`, so the script needs no list of skill names: it marks everything under `.agents/skills/` and never touches `skills/`. The skills CLI discovers skills in `skills/`, `.agents/skills/` and `.claude/skills/`; the only exclusion mechanism it documents is `metadata.internal: true` (`skills.sh.json` `paths` can only add locations). `.claude/skills/*` are symlinks into `skills/` or `.agents/skills/`, so marking `.agents/skills/` hides the toolkit skills from every discovery root while the published skills stay visible.

- [x] **Step 1: Write the failing unit test**

```bash
mkdir -p scripts/test
```

Create `scripts/test/mark-internal-skills.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import {
  findSkillsMarkedInternal,
  findSkillsNotInternal,
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
      { name: "setup", content: MARKED },
    ]
    expect(findSkillsNotInternal(files)).toEqual(["bugfix"])
  })

  it("names the skills that carry the internal marker", () => {
    const files: SkillDocument[] = [
      { name: "opencode-permissions", content: MARKED },
      { name: "opencode-permission-optimizer", content: PLAIN },
    ]
    expect(findSkillsMarkedInternal(files)).toEqual(["opencode-permissions"])
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./scripts/test/mark-internal-skills.test.ts`
Expected: FAIL — `Cannot find module '../mark-internal-skills'`.

- [x] **Step 3: Write the implementation**

Create `scripts/mark-internal-skills.ts`:

```ts
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TOOLKIT_SKILLS_DIRECTORY = ".agents/skills"
const PUBLISHED_SKILLS_DIRECTORY = "skills"

/** One skill's name and raw SKILL.md content. */
export interface SkillDocument {
  name: string
  content: string
}

function frontmatterBody(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  return match === null ? "" : match[1]
}

/** Whether a SKILL.md frontmatter block sets `metadata.internal: true`. */
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

/** Names of the skills whose SKILL.md lacks the internal marker. */
export function findSkillsNotInternal(files: SkillDocument[]): string[] {
  return files.filter((file) => !isSkillInternal(file.content)).map((file) => file.name)
}

/** Names of the skills whose SKILL.md carries the internal marker. */
export function findSkillsMarkedInternal(files: SkillDocument[]): string[] {
  return files.filter((file) => isSkillInternal(file.content)).map((file) => file.name)
}

/**
 * Read `<skillsDirectory>/<name>/SKILL.md` for every skill directory, sorted by
 * name. Throws when the directory does not exist, so a moved or renamed skills
 * directory fails loudly instead of yielding an empty scan.
 */
export function readSkillDocuments(skillsDirectory: string): SkillDocument[] {
  const docs: SkillDocument[] = []
  for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(skillsDirectory, entry.name, "SKILL.md")
    if (!existsSync(path)) continue
    docs.push({ name: entry.name, content: readFileSync(path, "utf8") })
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name))
}

function checkSkills(toolkitDocs: SkillDocument[], publishedDocs: SkillDocument[]): number {
  const unmarked = findSkillsNotInternal(toolkitDocs)
  const markedPublished = findSkillsMarkedInternal(publishedDocs)
  if (unmarked.length > 0) {
    process.stderr.write(`error: toolkit skills not marked internal: ${unmarked.join(", ")}\n`)
  }
  if (markedPublished.length > 0) {
    process.stderr.write(`error: published skills must not be internal: ${markedPublished.join(", ")}\n`)
  }
  return unmarked.length > 0 || markedPublished.length > 0 ? 1 : 0
}

function markToolkitSkills(root: string, toolkitDocs: SkillDocument[]): number {
  let changed = 0
  for (const doc of toolkitDocs) {
    const marked = markSkillInternal(doc.content)
    if (marked !== doc.content) {
      writeFileSync(join(root, TOOLKIT_SKILLS_DIRECTORY, doc.name, "SKILL.md"), marked)
      changed++
    }
  }
  return changed
}

function main(argv: string[]): number {
  const root = join(import.meta.dirname, "..")
  const toolkitDocs = readSkillDocuments(join(root, TOOLKIT_SKILLS_DIRECTORY))
  const publishedDocs = readSkillDocuments(join(root, PUBLISHED_SKILLS_DIRECTORY))
  if (argv.includes("--check")) {
    return checkSkills(toolkitDocs, publishedDocs)
  }
  const changed = markToolkitSkills(root, toolkitDocs)
  process.stdout.write(`marked ${changed} toolkit skills internal\n`)
  return findSkillsMarkedInternal(publishedDocs).length > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
```

- [x] **Step 4: Run the unit test to verify it passes**

Run: `bun test ./scripts/test/mark-internal-skills.test.ts`
Expected: PASS — 6 tests, 0 failures.

- [x] **Step 5: Write the repository guard**

Create `test/internal-skills.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import {
  findSkillsMarkedInternal,
  findSkillsNotInternal,
  readSkillDocuments,
} from "../scripts/mark-internal-skills"

describe("installed skills", () => {
  it("accepts the repository when every toolkit skill is marked internal and no published skill is", () => {
    const root = join(import.meta.dirname, "..")
    const toolkitDocs = readSkillDocuments(join(root, ".agents/skills"))
    const publishedDocs = readSkillDocuments(join(root, "skills"))

    expect(toolkitDocs.length).toBeGreaterThan(0)
    expect(publishedDocs.map((doc) => doc.name)).toEqual([
      "opencode-permission-optimizer",
      "opencode-permissions",
    ])
    expect(findSkillsNotInternal(toolkitDocs)).toEqual([])
    expect(findSkillsMarkedInternal(publishedDocs)).toEqual([])
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

Failure modes this layer adds beyond the unit tests (`docs/TESTING.md`): the guard reads the real `.agents/skills/` and `skills/` directories, so a toolkit upgrade that drops the marker, a published skill that gains it, or a published skill that moves out of `skills/` fails CI; it also runs `--check` to catch drift between the script and the guard.

- [x] **Step 6: Patch the toolkit skills and verify**

Run: `bun run mark-internal-skills`
Expected: prints `marked 21 toolkit skills internal` (the 21 installed toolkit skills). Verify with `grep -L "internal: true" .agents/skills/*/SKILL.md` that no file is listed, and with `grep -l "internal: true" skills/*/SKILL.md` that no file is listed.

Run: `bun run mark-internal-skills --check`
Expected: exit 0 with no output.

Run: `bun test ./scripts/test/mark-internal-skills.test.ts ./test/internal-skills.test.ts`
Expected: PASS — 7 tests, 0 failures.

Run: `bun run typecheck`
Expected: exit 0.

- [x] **Step 7: Record the changed-code audit tables (task acceptance)**

Exported declarations: `SkillDocument`, `isSkillInternal`, `markSkillInternal`, `findSkillsNotInternal`, `findSkillsMarkedInternal`, `readSkillDocuments` — record file, line range, contract, invariants (idempotent merge, `skills/` never written, `--check` never writes, a missing skills directory throws), and JSDoc location. Long bodies (over 40 physical lines): `markSkillInternal`, `checkSkills`, `markToolkitSkills` and `main` are each under 40 lines; state this explicitly with complete body bounds. The two test files have no exported declarations.

- [x] **Step 8: Commit**

```bash
git add scripts/mark-internal-skills.ts scripts/test/mark-internal-skills.test.ts test/internal-skills.test.ts .agents/skills
git commit -m "chore: hide toolkit skills from consumer installs"
```
