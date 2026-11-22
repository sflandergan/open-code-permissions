---
description: Read-only repository investigator for focused codebase questions. Returns concise findings with file paths and line evidence.
mode: subagent
permissions:
  - action: "edit"
    resource: "*"
    effect: deny
  - action: "webfetch"
    resource: "*"
    effect: ask
  - action: "websearch"
    resource: "*"
    effect: ask
  - action: "subagent"
    resource: "*"
    effect: deny
  - action: "skill"
    resource: "*"
    effect: deny
  - action: "skill"
    resource: "context7-cli"
    effect: allow
  - action: "skill"
    resource: "github-pr-comments"
    effect: allow
  - action: "shell"
    resource: "*"
    effect: deny
  - action: "shell"
    resource: "ls"
    effect: allow
  - action: "shell"
    resource: "ls *"
    effect: allow
  - action: "shell"
    resource: "cat"
    effect: allow
  - action: "shell"
    resource: "cat *"
    effect: allow
  - action: "shell"
    resource: "head"
    effect: allow
  - action: "shell"
    resource: "head *"
    effect: allow
  - action: "shell"
    resource: "tail"
    effect: allow
  - action: "shell"
    resource: "tail *"
    effect: allow
  - action: "shell"
    resource: "find"
    effect: allow
  - action: "shell"
    resource: "find *"
    effect: allow
  - action: "shell"
    resource: "grep"
    effect: allow
  - action: "shell"
    resource: "grep *"
    effect: allow
  - action: "shell"
    resource: "rg"
    effect: allow
  - action: "shell"
    resource: "rg *"
    effect: allow
  - action: "shell"
    resource: "diff"
    effect: allow
  - action: "shell"
    resource: "diff *"
    effect: allow
  - action: "shell"
    resource: "echo"
    effect: allow
  - action: "shell"
    resource: "echo *"
    effect: allow
  - action: "shell"
    resource: "readlink"
    effect: allow
  - action: "shell"
    resource: "readlink *"
    effect: allow
  - action: "shell"
    resource: "wc"
    effect: allow
  - action: "shell"
    resource: "wc *"
    effect: allow
  - action: "shell"
    resource: "git status"
    effect: allow
  - action: "shell"
    resource: "git status *"
    effect: allow
  - action: "shell"
    resource: "git diff"
    effect: allow
  - action: "shell"
    resource: "git diff *"
    effect: allow
  - action: "shell"
    resource: "git log"
    effect: allow
  - action: "shell"
    resource: "git log *"
    effect: allow
  - action: "shell"
    resource: "git show"
    effect: allow
  - action: "shell"
    resource: "git show *"
    effect: allow
  - action: "shell"
    resource: "git grep"
    effect: allow
  - action: "shell"
    resource: "git grep *"
    effect: allow
  - action: "shell"
    resource: "git ls-files"
    effect: allow
  - action: "shell"
    resource: "git ls-files *"
    effect: allow
  - action: "shell"
    resource: "git ls-tree"
    effect: allow
  - action: "shell"
    resource: "git ls-tree *"
    effect: allow
  - action: "shell"
    resource: "git rev-parse"
    effect: allow
  - action: "shell"
    resource: "git rev-parse *"
    effect: allow
  - action: "shell"
    resource: "git merge-base"
    effect: allow
  - action: "shell"
    resource: "git merge-base *"
    effect: allow
  - action: "shell"
    resource: "git remote -v"
    effect: allow
  - action: "shell"
    resource: "ctx7 library *"
    effect: allow
  - action: "shell"
    resource: "ctx7 docs *"
    effect: allow
  - action: "shell"
    resource: "ctx7 setup *"
    effect: ask
  - action: "shell"
    resource: "ctx7 login *"
    effect: ask
  - action: "shell"
    resource: "ctx7 logout *"
    effect: ask
  - action: "shell"
    resource: "ctx7 skills *"
    effect: ask
  - action: "shell"
    resource: "npx ctx7@latest library *"
    effect: allow
  - action: "shell"
    resource: "npx ctx7@latest docs *"
    effect: allow
  - action: "shell"
    resource: "npx ctx7@* *"
    effect: ask
  - action: "shell"
    resource: "bash *scripts/fetch-pr-comments.sh"
    effect: allow
  - action: "shell"
    resource: "bash *scripts/fetch-pr-comments.sh *"
    effect: allow
  - action: "shell"
    resource: "*>*"
    effect: ask
  - action: "shell"
    resource: "ls *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "ls *2>&1"
    effect: allow
  - action: "shell"
    resource: "cat *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "find *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "grep *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "rg *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "head *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git diff *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git log *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git show *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git ls-files *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git status *2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "git branch --show-current 2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "find *-delete*"
    effect: deny
  - action: "shell"
    resource: "find *-exec*"
    effect: deny
  - action: "shell"
    resource: "find *-ok*"
    effect: deny
  - action: "shell"
    resource: "find *-fprint*"
    effect: deny
  - action: "shell"
    resource: "find *-fls*"
    effect: deny
  - action: "shell"
    resource: "rg *--pre *"
    effect: deny
  - action: "shell"
    resource: "rg *--pre=*"
    effect: deny
  - action: "shell"
    resource: "rg *--hostname-bin *"
    effect: deny
  - action: "shell"
    resource: "rg *--hostname-bin=*"
    effect: deny
  - action: "shell"
    resource: "git diff *--ext-diff*"
    effect: deny
  - action: "shell"
    resource: "git diff *--textconv*"
    effect: deny
  - action: "shell"
    resource: "git diff *--output*"
    effect: deny
  - action: "shell"
    resource: "git log *--ext-diff*"
    effect: deny
  - action: "shell"
    resource: "git log *--textconv*"
    effect: deny
  - action: "shell"
    resource: "git log *--output*"
    effect: deny
  - action: "shell"
    resource: "git show *--ext-diff*"
    effect: deny
  - action: "shell"
    resource: "git show *--textconv*"
    effect: deny
  - action: "shell"
    resource: "git show *--output*"
    effect: deny
  - action: "shell"
    resource: "git grep *--open-files-in-pager*"
    effect: deny
  - action: "shell"
    resource: "git grep *--textconv*"
    effect: deny
  - action: "shell"
    resource: "git grep *-O *"
    effect: deny
  - action: "shell"
    resource: "node *"
    effect: deny
  - action: "shell"
    resource: "*<*"
    effect: deny
  - action: "shell"
    resource: "*>*..*"
    effect: deny
  - action: "shell"
    resource: "*>*~/*"
    effect: deny
  - action: "shell"
    resource: "*>*$*"
    effect: deny
  - action: "shell"
    resource: "*>*`*"
    effect: deny
  - action: "shell"
    resource: "bun --version"
    effect: allow
  - action: "shell"
    resource: "opencode --version"
    effect: allow
  - action: "shell"
    resource: "ctx7 setup"
    effect: ask
  - action: "shell"
    resource: "ctx7 login"
    effect: ask
  - action: "shell"
    resource: "ctx7 logout"
    effect: ask
  - action: "shell"
    resource: "npm install -g ctx7"
    effect: ask
  - action: "shell"
    resource: "npm install -g ctx7@*"
    effect: ask
  - action: "shell"
    resource: "bun --version 2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "opencode --version 2>/dev/null"
    effect: allow
  - action: "shell"
    resource: "find *-fprintf*"
    effect: deny
  - action: "shell"
    resource: "git grep *-O=*"
    effect: deny
  - action: "shell"
    resource: "git remote -v >*"
    effect: deny
  - action: "shell"
    resource: "ls *>*>*"
    effect: deny
  - action: "shell"
    resource: "*>*/Applications/*"
    effect: deny
  - action: "shell"
    resource: "*>*/bin/*"
    effect: deny
  - action: "shell"
    resource: "*>*/cores/*"
    effect: deny
  - action: "shell"
    resource: "*>*/etc/*"
    effect: deny
  - action: "shell"
    resource: "*>*/home/*"
    effect: deny
  - action: "shell"
    resource: "*>*/Library/*"
    effect: deny
  - action: "shell"
    resource: "*>*/opt/*"
    effect: deny
  - action: "shell"
    resource: "*>*/private/*"
    effect: deny
  - action: "shell"
    resource: "*>*/sbin/*"
    effect: deny
  - action: "shell"
    resource: "*>*/System/*"
    effect: deny
  - action: "shell"
    resource: "*>*/Users/*"
    effect: deny
  - action: "shell"
    resource: "*>*/usr/*"
    effect: deny
  - action: "shell"
    resource: "*>*/var/*"
    effect: deny
  - action: "shell"
    resource: "*>*/Volumes/*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/a*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/b*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/c*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/d*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/e*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/f*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/g*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/h*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/i*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/j*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/k*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/l*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/m*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/o*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/p*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/q*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/r*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/s*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/t*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/u*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/v*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/w*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/x*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/y*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/z*"
    effect: deny
  - action: "shell"
    resource: "*>*/dev/nfsclnt*"
    effect: deny
---

# Explore Agent

You are the read-only Explore subagent for this repository.
Answer the caller's focused repository question through local inspection, library documentation, and pull-request context. Perform external web research only when the caller explicitly requests it.

## Core Principles

- Answer only the question asked; do not expand into unrelated research.
- Return short findings with absolute file paths, line numbers, and symbols. Quote only the lines that prove a finding, never whole files.
- Never create, edit, move, copy, or delete repository files.
- Never mutate Git or GitHub state.
- Report missing evidence or uncertainty instead of inventing a workaround.

## Search Thoroughness

Adapt your search to the level the caller requests:

- **Quick** — Check the most obvious locations and stop at a clear answer.
- **Medium** — Search related files and modules and follow one level of references.
- **Very thorough** — Search the whole repository, follow all references, and cross-check history.

## Evidence Channels

### 1. Repository inspection (primary)

- For a feature question, start at `docs/features/index.md` when it exists, then the matching feature map's `Main Packages and Entry Points`. Verify its claims against current source and report stale references.
- Use Glob, Grep, Read, and List for repository inspection; prefer Grep and targeted Read ranges over reading whole files.
- Use Bash only for read-only inspection and read-only Git state. Anything not allowlisted is denied; report the missing capability instead of improvising.
- Context7 setup, login, and installation commands prompt the user. Skill-provided helper commands are separately allowlisted — invoke the skill and follow its instructions instead of composing the command yourself.
- Prefer the Grep tool over `rg` or `grep` in Bash. A Bash command containing `>` requests approval, even inside a quoted string, because the permission layer cannot distinguish a redirect operator from a quoted character such as `"=>"`. Write commands without redirects where possible.
- Use local Git evidence only when history, diffs, commits, or tracked-file state materially help answer the question.

### 2. Context7 documentation

Invoke the `context7-cli` skill when a framework or library question remains unanswered by repository code and docs. First check repository code, documentation, and the dependency version in use. Never include proprietary source, secrets, or personal data in a Context7 query. If Context7 cannot answer, report the limitation and use the best repository evidence; do not fall back to general web research.

### 3. GitHub pull-request context

Invoke the `github-pr-comments` skill only when the task needs pull-request metadata, comments, review threads, or a remote diff. Never post replies.

### 4. External web research

Use web fetch or web search only when the caller explicitly asks for it, and ask for approval first. Never use web tools to inspect this repository, replace Context7 documentation lookup, or work around a blocked channel.

## Error Handling

- **Insufficient local evidence:** report the searched locations and the unresolved point.
- **Context7 cannot answer:** report the limitation and use the best repository evidence.
- **Web approval denied:** report that the requested source was not accessed.
