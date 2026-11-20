# OpenCode Permission Tooling

This context covers how OpenCode permission requests are recorded, summarized and inspected by this repository's plugin, skills and agent.

## Language

### Recorded history

**Observation**:
One persisted lifecycle of a permission request (asked, decision, completion), keyed by OpenCode's `request_id`.

**Requested pattern**:
One pattern of a permission request, for example the Bash command `git status`. Stored in table `requested_patterns`, column `pattern`.
_Avoid_: input, exact input, input evidence

**Observation origin**:
Repository identity, agent, message ID and tool call ID that tie an observation to where it came from; filled later when the asked event lacked them.
_Avoid_: attribution

**Permission decision history**:
Every requested pattern of an agent history with approvals, rejections, unresolved outcomes, distinct sessions, worktrees, first and last activity.
_Avoid_: evidence report

**Agent history query**:
Repository identity, agent and closed UTC activity window that select observations.

**Agent history aggregate**:
Everything counted for one agent history query: distinct observation, session, approval, rejection and unresolved IDs plus the pattern aggregates.

**Pattern aggregate**:
Everything counted for one requested pattern inside one agent history aggregate.

### Effective policy

**Effective policy**:
The whole per-agent permission report resolved by the OpenCode runtime.

**Effective rule**:
One resolved rule in runtime order with its origin.

**Effective permission**:
A repository-declared permission rule that survives config-layer merging, with its override chain; matched to effective rules to find their origin.

### Identity and paths

**Repository identity**:
Either the normalized `host/path` of the `origin` remote, or the absolute path of the Git common directory, or unknown.

**Absolute path**:
A string proven absolute by `toAbsolutePath`, typed `AbsolutePath`.

### Skills

**Published skill**:
One of the two skills this repository ships from `skills/`.

**Toolkit skill**:
Any skill under `.agents/skills/`, installed by `setup` and recorded in `skills-lock.json`.

**Internal skill**:
A skill whose `SKILL.md` frontmatter sets `metadata.internal: true`.

### OpenCode terms

Permission, rule, pattern, action, agent and session are OpenCode's own terms, used as OpenCode defines them.
