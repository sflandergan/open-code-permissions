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
