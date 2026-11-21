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

  it("replaces an explicit internal false with internal true instead of adding a second key", () => {
    const explicitlyNotInternal = [
      "---",
      "name: bugfix",
      "metadata:",
      "  internal: false",
      "---",
      "",
      "You are the agent.",
      "",
    ].join("\n")
    expect(markSkillInternal(explicitlyNotInternal)).toBe(
      [
        "---",
        "name: bugfix",
        "metadata:",
        "  internal: true",
        "---",
        "",
        "You are the agent.",
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
