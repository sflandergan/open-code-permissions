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
    "skills/opencode-permissions/**": allow
    "skills/opencode-permission-optimizer/**": allow
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
    "bash skills/opencode-permissions/scripts/inspect.sh list-agents*": allow
    "bash skills/opencode-permissions/scripts/inspect.sh show-effective*": allow
    "bash skills/opencode-permission-optimizer/scripts/list-agents.sh*": allow
    "bash skills/opencode-permission-optimizer/scripts/summarize.sh --agent *": allow
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
