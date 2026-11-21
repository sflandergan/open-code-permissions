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
  const end = metadataBlockEnd(lines, metadataIndex)
  return lines.slice(metadataIndex + 1, end).some((line) => /^\s+internal:\s*true\s*$/.test(line))
}

function metadataBlockEnd(lines: string[], metadataIndex: number): number {
  let end = metadataIndex + 1
  while (end < lines.length && /^\s+/.test(lines[end])) end++
  return end
}

function markMetadataInternal(lines: string[], metadataIndex: number): string[] {
  const end = metadataBlockEnd(lines, metadataIndex)
  const internalIndex = lines.findIndex(
    (line, index) => index > metadataIndex && index < end && /^\s+internal:/.test(line),
  )
  if (internalIndex === -1) return [...lines.slice(0, end), "  internal: true", ...lines.slice(end)]
  const indent = /^\s*/.exec(lines[internalIndex])?.[0] ?? "  "
  return lines.map((line, index) => (index === internalIndex ? `${indent}internal: true` : line))
}

/**
 * Add `metadata.internal: true` to a skill's frontmatter, merging into an
 * existing `metadata` block and leaving every other key untouched. An existing
 * `internal` entry is replaced so the block keeps a single key. Returns the
 * content unchanged when the marker is already present. Throws when the
 * document has no `---` frontmatter block.
 */
export function markSkillInternal(content: string): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/.exec(content)
  if (match === null) throw new Error("SKILL.md has no frontmatter block")
  if (isSkillInternal(content)) return content
  const [, open, body, close, rest] = match
  const lines = body.split(/\r?\n/)
  const metadataIndex = lines.findIndex((line) => /^metadata:\s*$/.test(line))
  const updated =
    metadataIndex === -1 ? [...lines, "metadata:", "  internal: true"] : markMetadataInternal(lines, metadataIndex)
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
