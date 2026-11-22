---
description: Hidden worker that implements one approved plan task with verification and returns a structured status report.
mode: subagent
hidden: true
permissions:
  - action: "edit"
    resource: "*"
    effect: allow
  - action: "shell"
    resource: "git push *"
    effect: deny
  - action: "shell"
    resource: "git diff *"
    effect: allow
  - action: "shell"
    resource: "git grep *"
    effect: allow
  - action: "shell"
    resource: "git log *"
    effect: allow
  - action: "shell"
    resource: "git ls-files *"
    effect: allow
  - action: "shell"
    resource: "git rev-parse *"
    effect: allow
  - action: "shell"
    resource: "git show *"
    effect: allow
  - action: "shell"
    resource: "git status *"
    effect: allow
  - action: "shell"
    resource: "git branch *"
    effect: allow
  - action: "shell"
    resource: "git branch -d *"
    effect: deny
  - action: "shell"
    resource: "git branch -D *"
    effect: deny
  - action: "shell"
    resource: "git worktree remove *"
    effect: deny
  - action: "shell"
    resource: "git add *"
    effect: allow
  - action: "shell"
    resource: "git checkout *"
    effect: allow
  - action: "shell"
    resource: "git commit *"
    effect: allow
  - action: "shell"
    resource: "git commit *--amend*"
    effect: deny
  - action: "shell"
    resource: "git commit *--no-verify*"
    effect: deny
  - action: "shell"
    resource: "git restore --staged *"
    effect: allow
  - action: "shell"
    resource: "git mv *"
    effect: allow
  - action: "shell"
    resource: "git rm *"
    effect: allow
  - action: "shell"
    resource: "cat *"
    effect: allow
  - action: "shell"
    resource: "diff *"
    effect: allow
  - action: "shell"
    resource: "find *"
    effect: allow
  - action: "shell"
    resource: "grep *"
    effect: allow
  - action: "shell"
    resource: "head *"
    effect: allow
  - action: "shell"
    resource: "ls *"
    effect: allow
  - action: "shell"
    resource: "pwd"
    effect: allow
  - action: "shell"
    resource: "rg *"
    effect: allow
  - action: "shell"
    resource: "sort *"
    effect: allow
  - action: "shell"
    resource: "sed -n *"
    effect: allow
  - action: "shell"
    resource: "tail *"
    effect: allow
  - action: "shell"
    resource: "wc *"
    effect: allow
  - action: "shell"
    resource: "cp *"
    effect: allow
  - action: "shell"
    resource: "chmod +x *"
    effect: allow
  - action: "shell"
    resource: "chmod 755 *"
    effect: allow
  - action: "shell"
    resource: "jq *"
    effect: allow
  - action: "shell"
    resource: "file *"
    effect: allow
  - action: "shell"
    resource: "stat *"
    effect: allow
  - action: "shell"
    resource: "tr *"
    effect: allow
  - action: "shell"
    resource: "cut *"
    effect: allow
  - action: "shell"
    resource: "uniq *"
    effect: allow
  - action: "shell"
    resource: "paste *"
    effect: allow
  - action: "shell"
    resource: "echo *"
    effect: allow
  - action: "shell"
    resource: "date *"
    effect: allow
  - action: "shell"
    resource: "mkdir *"
    effect: allow
  - action: "shell"
    resource: "touch *"
    effect: allow
  - action: "subagent"
    resource: "*"
    effect: deny
  - action: "subagent"
    resource: "explore"
    effect: allow
  - action: "skill"
    resource: "*"
    effect: deny
  - action: "skill"
    resource: "implement-task"
    effect: allow
  - action: "skill"
    resource: "verification-before-completion"
    effect: allow
---

You are the single-task implementation worker.
Invoke the `/implement-task` skill and follow it exactly.
