# Task 09 — Copy-in agent moves to native 2.x permissions

## Objective

Convert the copy-in `opencode-permissions` agent definition to native 2.x `permissions` frontmatter — folding `write` into `edit` and renaming `bash` to `shell` and `task` to `subagent` per the runtime's action renames — while retaining its self-protection matrix and confirmation behavior exactly.

## Files

- Modify: `.opencode/agents/opencode-permissions.md`

## Interfaces

- Consumes: task 07's Access boundary and workflow vocabulary (`shell` action, agent id, native rule list).
- Produces: the agent definition consumers copy into their repositories; the runtime reads the native frontmatter directly. Its body behavior (which skills to invoke) is unchanged.

## Verified facts used

V2 agent-file frontmatter with `permissions` is read as native; `prompt`→`system`-style renames do not apply because this file has no such fields; the action renames are `bash` → `shell`, `task` → `subagent`, `write`/`patch` → `edit`; earlier `ask` on `external_directory` must become an explicit rule because 2.x allows external directories by default; the file's own read self-protection under the current 1.x runtime in this repository is intentionally traded for native configuration, per the approved spec ("The copy-in agent must use the native configuration") — consumers running the 2.x runtime get identical protection, and this repository's own dev runtime does not run the tooling release (non-goal).

- [ ] **Step 1: Rewrite the frontmatter**

Replace the frontmatter of `.opencode/agents/opencode-permissions.md` (body below the frontmatter stays byte-identical) with:

```yaml
---
description: Protected agent for managing OpenCode permission policy through confirmed direct edits with the read-only inspector.
permissions:
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: "opencode.json", effect: "allow" }
  - { action: "edit", resource: "opencode.jsonc", effect: "allow" }
  - { action: "edit", resource: ".opencode/agents/*.md", effect: "allow" }
  - { action: "edit", resource: ".opencode/agents/opencode-permissions.md", effect: "deny" }
  - { action: "edit", resource: "AGENTS.md", effect: "ask" }
  - { action: "question", resource: "*", effect: "allow" }
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "skill", resource: "*", effect: "deny" }
  - { action: "skill", resource: "opencode-permissions", effect: "allow" }
  - { action: "skill", resource: "opencode-permission-optimizer", effect: "allow" }
  - { action: "skill", resource: "git-publish", effect: "allow" }
  - { action: "read", resource: "*", effect: "deny" }
  - { action: "read", resource: "opencode.json", effect: "allow" }
  - { action: "read", resource: "opencode.jsonc", effect: "allow" }
  - { action: "read", resource: ".opencode/agents/*.md", effect: "allow" }
  - { action: "read", resource: "skills/opencode-permissions/**", effect: "allow" }
  - { action: "read", resource: "skills/opencode-permission-optimizer/**", effect: "allow" }
  - { action: "read", resource: ".agents/skills/**", effect: "allow" }
  - { action: "read", resource: "docs/agents/**", effect: "allow" }
  - { action: "read", resource: "AGENTS.md", effect: "allow" }
  - { action: "read", resource: "plans/**", effect: "allow" }
  - { action: "read", resource: ".temp/permission-inspect-output-*", effect: "allow" }
  - { action: "read", resource: ".temp/permission-optimizer-output-*", effect: "allow" }
  - { action: "shell", resource: "*", effect: "deny" }
  - { action: "shell", resource: "bash \"*/opencode-permissions/scripts/inspect.sh\" list-agents*", effect: "allow" }
  - { action: "shell", resource: "bash \"*/opencode-permissions/scripts/inspect.sh\" show-effective*", effect: "allow" }
  - { action: "shell", resource: "bash \"*/opencode-permission-optimizer/scripts/agent-permission-report.sh\" --agent *", effect: "allow" }
  - { action: "shell", resource: "bash \"*/opencode-permission-optimizer/scripts/list-agents.sh\"*", effect: "allow" }
  - { action: "shell", resource: "bash skills/opencode-permissions/scripts/inspect.sh list-agents*", effect: "allow" }
  - { action: "shell", resource: "bash skills/opencode-permissions/scripts/inspect.sh show-effective*", effect: "allow" }
  - { action: "shell", resource: "bash skills/opencode-permission-optimizer/scripts/list-agents.sh*", effect: "allow" }
  - { action: "shell", resource: "bash skills/opencode-permission-optimizer/scripts/agent-permission-report.sh --agent *", effect: "allow" }
  - { action: "shell", resource: "rm -- .temp/permission-inspect-output-*", effect: "allow" }
  - { action: "shell", resource: "rm -- .temp/permission-optimizer-output-*", effect: "allow" }
  - { action: "shell", resource: "git diff *", effect: "allow" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git ls-files *", effect: "allow" }
  - { action: "shell", resource: "git show *", effect: "allow" }
  - { action: "shell", resource: "git status *", effect: "allow" }
  - { action: "shell", resource: "git commit *", effect: "allow" }
  - { action: "shell", resource: "git add *", effect: "allow" }
  - { action: "shell", resource: "bash .agents/skills/git-publish/scripts/publish-branch.sh", effect: "allow" }
  - { action: "shell", resource: "bash .agents/skills/git-publish/scripts/publish-branch.sh *", effect: "allow" }
  - { action: "shell", resource: "*>*", effect: "ask" }
  - { action: "shell", resource: "*<*", effect: "ask" }
---
```

Mapping rules applied (verify each row against the old frontmatter before committing): every `edit:`/`write:` map entry folds into the `edit` block (the two 1.x maps were identical for this agent, so folding loses nothing); `task: { "*": "deny" }` becomes the one `subagent` rule; every `bash:` map entry becomes a `shell` rule with the same resource text and effect; ordering within each action group preserves the old map order; the old `question: allow` becomes the explicit `question` rule; there are deliberately **no** `external_directory` rules — the agent was never granted one before, and 2.x's allow-by-default is unchanged self-protection-wise because the agent's own `read`/`edit` trees remain allow-listed.

- [ ] **Step 2: Verify**

Docs-only change (a runtime-consumed definition, no code): confirm the body is untouched (`git diff` shows only the frontmatter), confirm the mapping row-by-row against the previous frontmatter, and confirm `bun run typecheck` stays green. Note in the task report the stated consequence: this native frontmatter applies under the 2.x runtime; this repository's own 1.x dev runtime no longer applies these guards to this agent (accepted by the approved spec and the port's non-goals).

- [ ] **Step 3: Commit**

```bash
git add .opencode/agents/opencode-permissions.md
git commit -m "feat: state the copy-in agent's policy in native 2.x permissions"
```

## Changed-code audit

Not applicable — no TypeScript change; the definition's self-protection matrix is verified row-by-row in the task report (each old entry and its new native rule listed).
