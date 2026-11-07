# Task 12: Agent and role doc

**Objective:** Add the tidy copy-in `opencode-permissions` agent and the trimmed `docs/agents/opencode-permission-optimizer.md` role doc.

**Unit:** 5 (Agent and docs). Depends on Task 04 and Task 08 (the skills the agent invokes) and Task 13 (README documents the copy-in file).

**Files:**
- Create: `.opencode/agents/opencode-permissions.md`
- Create: `docs/agents/opencode-permission-optimizer.md`

**Interfaces:**
- Consumes: the two published skills (Tasks 04, 08); `docs/agents/agent-workflow-extension.md` (existing).
- Produces: no code API. Both files are Markdown consumed by OpenCode/agents at runtime.

These are Markdown docs/config files. Per `AGENTS.md`, docs-only changes need no workspace verification. The content below is complete.

- [ ] **Step 1: Create the agent file**

Create `.opencode/agents/opencode-permissions.md` with this exact content:

```markdown
---
description: Protected agent for managing OpenCode permission policy through confirmed direct edits with the read-only inspector.
permission:
  edit:
    "*": deny
    "opencode.json": allow
    "opencode.jsonc": allow
    ".opencode/agents/*.md": allow
    ".opencode/agents/opencode-permissions.md": deny
    "AGENTS.md": ask
  write:
    "*": deny
    "opencode.json": allow
    "opencode.jsonc": allow
    ".opencode/agents/*.md": allow
    ".opencode/agents/opencode-permissions.md": deny
    "AGENTS.md": ask
  question: allow
  task:
    "*": deny
  skill:
    "*": deny
    "opencode-permissions": allow
    "opencode-permission-optimizer": allow
    "git-publish": allow
  read:
    "*": deny
    "opencode.json": allow
    "opencode.jsonc": allow
    ".opencode/agents/*.md": allow
    ".agents/skills/opencode-permissions/**": allow
    ".agents/skills/opencode-permission-optimizer/**": allow
    ".agents/skills/**": allow
    "docs/agents/**": allow
    "AGENTS.md": allow
    "plans/**": allow
    ".temp/permission-inspect-output-*": allow
    ".temp/permission-optimizer-output-*": allow
  bash:
    "*": deny
    "bash \"*/opencode-permissions/scripts/inspect.sh\" list-agents*": allow
    "bash \"*/opencode-permissions/scripts/inspect.sh\" show-effective*": allow
    "bash \"*/opencode-permission-optimizer/scripts/summarize.sh\" --agent *": allow
    "bash \"*/opencode-permission-optimizer/scripts/list-agents.sh\"*": allow
    "bash .agents/skills/opencode-permissions/scripts/inspect.sh list-agents*": allow
    "bash .agents/skills/opencode-permissions/scripts/inspect.sh show-effective*": allow
    "bash .agents/skills/opencode-permission-optimizer/scripts/list-agents.sh*": allow
    "bash .agents/skills/opencode-permission-optimizer/scripts/summarize.sh --agent *": allow
    "rm -- .temp/permission-inspect-output-*": allow
    "rm -- .temp/permission-optimizer-output-*": allow
    "git diff *": allow
    "git log *": allow
    "git ls-files *": allow
    "git show *": allow
    "git status *": allow
    "git commit *": allow
    "git add *": allow
    "bash .agents/skills/git-publish/scripts/publish-branch.sh": allow
    "bash .agents/skills/git-publish/scripts/publish-branch.sh *": allow
    "*>*": ask
    "*<*": ask
---

You are the OpenCode permission agent for this repository.
Invoke `/opencode-permission-optimizer` when the user asks to analyze recorded permission history or improve permission defaults based on it.
Invoke `/opencode-permissions` for all other permission-policy requests.
```

Tidy rules applied to the bikes-local source (`.opencode/agents/opencode-permissions.md`): self-protection is kept (`edit`/`write` deny the agent's own definition and `AGENTS.md` edits resolve to `ask`); the confirmed-edit model is kept (the body delegates to the two skills, which require exact-diff confirmation). Duplicated rules are removed — the glob-absolute and repo-local invocation forms are each kept once per command, the redundant `2>/dev/null` variants are dropped, and the near-identical `list-agents`/`list-agents --json` and `show-effective`/`show-effective *` pairs collapse to single `list-agents*` and `show-effective*` patterns. Every reference to the non-existent `opencode-permissions.sh` script is removed. All temporary-report paths use `.temp/`. The agent is a copy-in file: having the plugin register it through a `config` hook was rejected because it would hide a policy-editing agent's permissions from the consumer's own review.

- [ ] **Step 2: Create the role doc**

Create `docs/agents/opencode-permission-optimizer.md` with this exact content:

```markdown
# OpenCode Permission Optimizer — Repository Guide

## Load

- For the selected custom agent: `.opencode/agents/<name>.md`, every skill it references and each referenced skill's definition, `docs/agents/<name>.md` when present, and every applicable `AGENTS.md` (repository root and nested).
- `docs/agents/agent-workflow-extension.md` only when changing workflow, agent, skill, or permission wiring.
- Record the sources found and any required source that is missing; stop recommendations for new authority when required role guidance is missing.

## Policy sources

- Repository-shared permissions: the `permission` section of `opencode.json` and `opencode.jsonc`.
- Root-config agent permissions: `agent.<name>.permission` in `opencode.json` / `opencode.jsonc`.
- Agent-file permissions: the `permission:` frontmatter of `.opencode/agents/<name>.md`.
- All sources are read-only during advisory review; only the `opencode-permissions` management workflow edits them after exact-diff confirmation.
```

The bikes-local role doc's "Current repository policy values" and "Native-role overrides" sections are dropped: the inspector reports effective policy and copied values would go stale, and the sister repository's provider config / Mistral compatibility plugin / policy values are non-goals.

- [ ] **Step 3: Verify (docs-only)**

Run: `git diff --check`
Expected: exit 0 (no whitespace errors). No build, typecheck or test run is required for Markdown-only changes.

- [ ] **Step 4: Commit**

```bash
git add .opencode/agents/opencode-permissions.md docs/agents/opencode-permission-optimizer.md
git commit -m "docs: add the permission management agent and optimizer role guide"
```
