# Permission Policy Management Feature Map

The `opencode-permissions` skill resolves an agent's effective permission policy: it reads the ordered `opencode debug agents` inventory and the ordered `opencode debug config` entries from the OpenCode 2.x runtime, merges the repository's own permission declarations, and reports each effective rule with its position and a verified origin. Policy changes happen only through the copy-in `opencode-permissions` agent's confirmed edits, which the skill then re-inspects to verify. The [Permission Decision Review](permission-decision-review.md) capability invokes the skill as a sibling.

## Main Packages and Entry Points

- `skills/opencode-permissions/` — the skill workflow (`SKILL.md`), references, wrapper, and `src/`.
- `skills/opencode-permissions/src/inspect.ts` — resolves and renders the effective policy; open this first for resolution or report changes.
- `.opencode/agents/opencode-permissions.md` — the policy-editing agent definition, including its self-protection rules.
