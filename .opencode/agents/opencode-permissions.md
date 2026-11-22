---
description: Protected agent for managing OpenCode permission policy through confirmed direct edits with the read-only inspector.
permissions:
  - action: "edit"
    resource: "*"
    effect: deny
  - action: "edit"
    resource: "opencode.json"
    effect: allow
  - action: "edit"
    resource: "opencode.jsonc"
    effect: allow
  - action: "edit"
    resource: ".opencode/agents/*.md"
    effect: allow
  - action: "edit"
    resource: ".opencode/agents/opencode-permissions.md"
    effect: deny
  - action: "edit"
    resource: "AGENTS.md"
    effect: ask
  - action: "question"
    resource: "*"
    effect: allow
  - action: "subagent"
    resource: "*"
    effect: deny
  - action: "skill"
    resource: "*"
    effect: deny
  - action: "skill"
    resource: "opencode-permissions"
    effect: allow
  - action: "skill"
    resource: "opencode-permission-optimizer"
    effect: allow
  - action: "skill"
    resource: "git-publish"
    effect: allow
  - action: "read"
    resource: "*"
    effect: deny
  - action: "read"
    resource: "opencode.json"
    effect: allow
  - action: "read"
    resource: "opencode.jsonc"
    effect: allow
  - action: "read"
    resource: ".opencode/agents/*.md"
    effect: allow
  - action: "read"
    resource: "skills/opencode-permissions/**"
    effect: allow
  - action: "read"
    resource: "skills/opencode-permission-optimizer/**"
    effect: allow
  - action: "read"
    resource: ".agents/skills/**"
    effect: allow
  - action: "read"
    resource: "docs/agents/**"
    effect: allow
  - action: "read"
    resource: "AGENTS.md"
    effect: allow
  - action: "read"
    resource: "plans/**"
    effect: allow
  - action: "read"
    resource: ".temp/permission-inspect-output-*"
    effect: allow
  - action: "read"
    resource: ".temp/permission-optimizer-output-*"
    effect: allow
  - action: "shell"
    resource: "*"
    effect: deny
  - action: "shell"
    resource: "bash \"*/opencode-permissions/scripts/inspect.sh\" list-agents*"
    effect: allow
  - action: "shell"
    resource: "bash \"*/opencode-permissions/scripts/inspect.sh\" show-effective*"
    effect: allow
  - action: "shell"
    resource: "bash \"*/opencode-permission-optimizer/scripts/agent-permission-report.sh\" --agent *"
    effect: allow
  - action: "shell"
    resource: "bash \"*/opencode-permission-optimizer/scripts/list-agents.sh\"*"
    effect: allow
  - action: "shell"
    resource: "bash skills/opencode-permissions/scripts/inspect.sh list-agents*"
    effect: allow
  - action: "shell"
    resource: "bash skills/opencode-permissions/scripts/inspect.sh show-effective*"
    effect: allow
  - action: "shell"
    resource: "bash skills/opencode-permission-optimizer/scripts/list-agents.sh*"
    effect: allow
  - action: "shell"
    resource: "bash skills/opencode-permission-optimizer/scripts/agent-permission-report.sh --agent *"
    effect: allow
  - action: "shell"
    resource: "rm -- .temp/permission-inspect-output-*"
    effect: allow
  - action: "shell"
    resource: "rm -- .temp/permission-optimizer-output-*"
    effect: allow
  - action: "shell"
    resource: "git diff *"
    effect: allow
  - action: "shell"
    resource: "git log *"
    effect: allow
  - action: "shell"
    resource: "git ls-files *"
    effect: allow
  - action: "shell"
    resource: "git show *"
    effect: allow
  - action: "shell"
    resource: "git status *"
    effect: allow
  - action: "shell"
    resource: "git commit *"
    effect: allow
  - action: "shell"
    resource: "git add *"
    effect: allow
  - action: "shell"
    resource: "bash .agents/skills/git-publish/scripts/publish-branch.sh"
    effect: allow
  - action: "shell"
    resource: "bash .agents/skills/git-publish/scripts/publish-branch.sh *"
    effect: allow
  - action: "shell"
    resource: "*>*"
    effect: ask
  - action: "shell"
    resource: "*<*"
    effect: ask
---

You are the OpenCode permission agent for this repository.
Invoke `/opencode-permission-optimizer` when the user asks to analyze recorded permission history or improve permission defaults based on it.
Invoke `/opencode-permissions` for all other permission-policy requests.
