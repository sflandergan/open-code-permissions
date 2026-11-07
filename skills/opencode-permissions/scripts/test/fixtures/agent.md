---
description: hidden fixture agent
mode: all
hidden: true
permission:
  edit:
    "*": deny
  write:
    "*": deny
  question: allow
  task:
    "*": deny
  skill:
    "*": deny
    "legacy-skill": allow
    "opencode-permission-optimizer": allow
  read:
    "*": deny
    "opencode.json": allow
    ".opencode/agents/*.md": allow
    ".agents/skills/opencode-permission-optimizer/**": allow
  bash:
    "*": deny
    "*>*": deny
    "*<*": deny
    "bash \"*/opencode-permission-optimizer/scripts/summarize.sh\" --agent *": allow
    "ls": allow
    "echo *": allow
---
# ghost
