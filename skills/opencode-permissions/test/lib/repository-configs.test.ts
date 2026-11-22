import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  confirmConfigDocument,
  discoverAgentFiles,
  isCanonicallyContained,
  readAgentFileRules,
} from "../../src/lib/repository-configs"
import { toAbsolutePath } from "../../src/lib/absolute-path"
import type { AbsolutePath } from "../../src/lib/absolute-path"
import type { ConfigDocumentEntry, RuntimeRule } from "../../src/lib/types"
import { captureThrown } from "../helpers/inspection-fixtures"

function rule(action: string, resource: string, effect: RuntimeRule["effect"]): RuntimeRule {
  return { action, resource, effect }
}

interface Scratch {
  root: AbsolutePath
  cleanup: () => void
}

function createScratch(): Scratch {
  const root = toAbsolutePath(mkdtempSync(join(tmpdir(), "opencode-permissions-configs-")), "scratch root")
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function write(root: AbsolutePath, relative: string, content: string): void {
  const path = join(root, relative)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

describe("discoverAgentFiles", () => {
  test("discovers agent and agents group files before mode and modes files, each sorted by path", () => {
    const scratch = createScratch()
    try {
      const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")
      write(directory, "agents/b.md", "b")
      write(directory, "agents/a.md", "a")
      write(directory, "agent/c.md", "c")
      write(directory, "modes/m.md", "m")
      write(directory, "mode/n.md", "n")

      const discovered = discoverAgentFiles(directory, scratch.root)

      expect(discovered.map((file) => file.agentId)).toEqual(["c", "a", "b", "n", "m"])
      expect(discovered.every((file) => file.editable)).toBeTruthy()
    } finally {
      scratch.cleanup()
    }
  })

  test("derives nested agent ids and includes dotfiles while skipping ignored directories", () => {
    const scratch = createScratch()
    try {
      const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")
      write(directory, "agents/nested/deep.md", "deep")
      write(directory, "agents/.hidden/secret.md", "secret")
      write(directory, "agents/.dot.md", "dot")
      write(directory, "agents/node_modules/installed.md", "installed")
      write(directory, "agents/nested/.git/tracked.md", "tracked")
      write(directory, "agents/.venv/packed.md", "packed")
      write(directory, "agents/venv/also-packed.md", "also-packed")
      write(directory, "agents/__pycache__/bytecode.md", "bytecode")

      const discovered = discoverAgentFiles(directory, scratch.root)

      expect(discovered.map((file) => file.agentId)).toEqual([".dot", ".hidden/secret", "nested/deep"])
    } finally {
      scratch.cleanup()
    }
  })

  test("marks symlinked and escaping agent files as not editable but still discovers them", () => {
    const sandboxRoot = toAbsolutePath(mkdtempSync(join(tmpdir(), "opencode-permissions-outside-")), "outside root")
    const scratch = createScratch()
    try {
      write(sandboxRoot, "target.md", "---\npermissions:\n  - action: read\n    resource: \"x\"\n    effect: allow\n---\n")
      write(scratch.root, ".opencode/agents/inside.md", "---\ndescription: x\n---\nbody\n")
      mkdirSync(join(scratch.root, ".opencode", "agents"), { recursive: true })
      symlinkSync(join(sandboxRoot, "target.md"), join(scratch.root, ".opencode", "agents", "linked.md"))
      const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")

      const discovered = discoverAgentFiles(directory, scratch.root)
      const editable = Object.fromEntries(discovered.map((file) => [file.agentId, file.editable]))

      expect(editable).toEqual({ inside: true, linked: false })
      expect(readAgentFileRules(discovered.find((file) => file.agentId === "linked") ?? null)).toEqual([
        rule("read", "x", "allow"),
      ])
    } finally {
      scratch.cleanup()
      rmSync(sandboxRoot, { recursive: true, force: true })
    }
  })

  test("returns no files for a directory without agent definitions", () => {
    const scratch = createScratch()
    try {
      expect(discoverAgentFiles(scratch.root, scratch.root)).toEqual([])
      const missing = toAbsolutePath(join(scratch.root, "absent"), "missing directory")
      expect(discoverAgentFiles(missing, scratch.root)).toEqual([])
    } finally {
      scratch.cleanup()
    }
  })

  test("derives multiline agent ids from the directory position without the plugin", () => {
    const scratch = createScratch()
    try {
      const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")
      write(directory, "agents/sub/one.md", "1")
      write(directory, "agents/sub/sub/two.md", "2")
      expect(discoverAgentFiles(directory, scratch.root).map((file) => file.agentId)).toEqual(["sub/one", "sub/sub/two"])
    } finally {
      scratch.cleanup()
    }
  })
})

describe("isCanonicallyContained", () => {
  test("accepts paths inside the root and rejects outside or symlink-escaping paths", () => {
    const outsideRoot = toAbsolutePath(mkdtempSync(join(tmpdir(), "opencode-permissions-outside-")), "outside root")
    const scratch = createScratch()
    try {
      write(scratch.root, "opencode.json", "{}")
      write(outsideRoot, "target.json", "{}")
      symlinkSync(join(outsideRoot, "target.json"), join(scratch.root, "escape.json"))

      expect(isCanonicallyContained(join(scratch.root, "opencode.json"), scratch.root)).toBeTruthy()
      expect(isCanonicallyContained(join(outsideRoot, "target.json"), scratch.root)).toBeFalsy()
      expect(isCanonicallyContained(join(scratch.root, "escape.json"), scratch.root)).toBeFalsy()
      expect(isCanonicallyContained(join(scratch.root, "missing.json"), scratch.root)).toBeFalsy()
    } finally {
      scratch.cleanup()
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })
})

describe("confirmConfigDocument", () => {
  /**
   * Build a document entry factory whose relative paths resolve inside the
   * given root, the way the runtime reports config document paths.
   */
  function documentFor(root: AbsolutePath): (relativePath: string, info: Record<string, unknown>) => ConfigDocumentEntry {
    return (relativePath, info) => ({
      type: "document",
      path: relativePath === "" ? null : join(root, relativePath),
      permissions: [],
      agents: {},
      ...info,
    }) as ConfigDocumentEntry
  }

  test("confirms the combined legacy and native shared blocks only in the runtime order", () => {
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(
        scratch.root,
        "opencode.json",
        JSON.stringify({
          permission: { bash: { "git status": "allow" } },
          permissions: [{ action: "read", resource: "*", effect: "allow" }],
        }),
      )
      const entry = document("opencode.json", {
        permissions: [rule("shell", "git status", "allow"), rule("read", "*", "allow")],
      })
      const reversed = document("opencode.json", {
        permissions: [rule("read", "*", "allow"), rule("shell", "git status", "allow")],
      })

      expect(confirmConfigDocument(entry, scratch.root)).toBeTruthy()
      expect(confirmConfigDocument(reversed, scratch.root)).toBeFalsy()
    } finally {
      scratch.cleanup()
    }
  })

  test("confirms a JSONC document with comments and trailing commas against its normalized report", () => {
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(scratch.root, "opencode.jsonc", "// legacy shared policy\n{\n  \"permission\": {\n    \"bash\": { \"*\": \"ask\", },\n  },\n}\n")
      const entry = document("opencode.jsonc", {
        permissions: [rule("shell", "*", "ask")],
      })

      expect(confirmConfigDocument(entry, scratch.root)).toBeTruthy()
    } finally {
      scratch.cleanup()
    }
  })

  test("compares agent declarations from legacy agent and mode blocks with mode records replacing agent records", () => {
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(
        scratch.root,
        "opencode.json",
        JSON.stringify({
          agent: { x: { permission: { read: { "q": "allow" } } } },
          mode: { x: { permission: { edit: { "w": "deny" } } } },
          agents: {},
        }),
      )

      const modeReported = document("opencode.json", {
        agents: { x: { permissions: [rule("edit", "w", "deny")] } },
      })
      expect(confirmConfigDocument(modeReported, scratch.root)).toBeTruthy()

      const agentReported = document("opencode.json", {
        agents: { x: { permissions: [rule("read", "q", "allow")] } },
      })
      expect(confirmConfigDocument(agentReported, scratch.root)).toBeFalsy()
    } finally {
      scratch.cleanup()
    }
  })

  test("compares native agent records after the legacy merge", () => {
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(
        scratch.root,
        "opencode.json",
        JSON.stringify({
          agent: { x: { permission: { read: { "q": "allow" } } } },
          agents: { x: { permissions: [{ action: "edit", resource: "w", effect: "deny" }] } },
        }),
      )

      const nativeReported = document("opencode.json", {
        agents: { x: { permissions: [rule("edit", "w", "deny")] } },
      })
      expect(confirmConfigDocument(nativeReported, scratch.root)).toBeTruthy()

      const legacyReported = document("opencode.json", {
        agents: { x: { permissions: [rule("read", "q", "allow")] } },
      })
      expect(confirmConfigDocument(legacyReported, scratch.root)).toBeFalsy()
    } finally {
      scratch.cleanup()
    }
  })

  test("rejects confirmation when the bytes disagree with the reported rules", () => {
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(scratch.root, "opencode.json", JSON.stringify({ permissions: [{ action: "read", resource: "*", effect: "allow" }] }))
      const entry = document("opencode.json", {
        permissions: [rule("read", "*", "deny")],
      })

      expect(confirmConfigDocument(entry, scratch.root)).toBeFalsy()
    } finally {
      scratch.cleanup()
    }
  })

  test("rejects documents outside the repository, behind symlinks, with no path, or with unreadable bytes", () => {
    const outsideRoot = toAbsolutePath(mkdtempSync(join(tmpdir(), "opencode-permissions-outside-")), "outside root")
    const scratch = createScratch()
    const document = documentFor(scratch.root)
    try {
      write(outsideRoot, "opencode.json", JSON.stringify({ permissions: [] }))
      symlinkSync(join(outsideRoot, "opencode.json"), join(scratch.root, "linked.json"))

      const outside = { type: "document", path: join(outsideRoot, "opencode.json"), permissions: [], agents: {} } as ConfigDocumentEntry
      expect(confirmConfigDocument(outside, scratch.root)).toBeFalsy()
      expect(confirmConfigDocument(document("linked.json", { permissions: [] }), scratch.root)).toBeFalsy()
      expect(confirmConfigDocument(document("", { permissions: [] }), scratch.root)).toBeFalsy()
      const malformed = document("opencode.json", {})
      write(scratch.root, "opencode.json", "{ not json")
      expect(() => confirmConfigDocument(malformed, scratch.root)).toThrow()
    } finally {
      scratch.cleanup()
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })
})

test("readAgentFileRules returns null for a file that disappeared after discovery", () => {
  const scratch = createScratch()
  try {
    const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")
    write(directory, "agents/ghost.md", "---\ndescription: gone\n---\nbody\n")
    const discovered = discoverAgentFiles(directory, scratch.root)
    expect(discovered.length).toEqual(1)
    rmSync(join(directory, "agents", "ghost.md"))
    expect(readAgentFileRules(discovered[0] ?? null)).toEqual(null)
  } finally {
    scratch.cleanup()
  }
})

test("readAgentFileRules reports malformed agent frontmatter with the source path", () => {
  const scratch = createScratch()
  try {
    const directory = toAbsolutePath(join(scratch.root, ".opencode"), "fixture directory")
    write(directory, "agents/ghost.md", "---\npermission:\n  edit:\n    \"*\": true\n---\n")
    const discovered = discoverAgentFiles(directory, scratch.root)
    const error = captureThrown(() => readAgentFileRules(discovered[0] ?? null))
    expect(error.code).toEqual("INSPECTION_SOURCE_MALFORMED")
    expect(error.message).toContain("ghost.md")
  } finally {
    scratch.cleanup()
  }
})
