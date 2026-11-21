# Permission Policy Management Feature Map

The `opencode-permissions` skill resolves an agent's effective permission policy: it asks the OpenCode runtime for the agent list and resolved configuration, merges the repository's own permission declarations, and reports each effective rule with its origin. Policy changes happen only through the copy-in `opencode-permissions` agent's confirmed edits, which the skill then re-inspects to verify. The [Permission Decision Review](permission-decision-review.md) capability invokes the skill as a sibling.

## Main Packages and Entry Points

- `skills/opencode-permissions/` — the skill workflow (`SKILL.md`), references, wrapper, and `src/`.
- `skills/opencode-permissions/src/inspect.ts` — resolves and renders the effective policy; open this first for resolution or report changes.
- `.opencode/agents/opencode-permissions.md` — the policy-editing agent definition, including its self-protection rules.
