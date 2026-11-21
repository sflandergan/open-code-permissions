# Output Format

The inspector writes these report bodies to the generated output file printed by `inspect.sh`.

## list-agents

One line per enabled agent; the native/custom status is omitted when the runtime does not expose it:

```text
compaction (primary, native)
explore (subagent, native)
opencode-permissions (all, custom)
```

## list-agents --json

The same data as a JSON object with one `agents` entry per agent:

```json
{
  "agents": [
    {
      "name": "explore",
      "mode": "subagent",
      "status": "native"
    },
    {
      "name": "opencode-permissions",
      "mode": "all",
      "status": "custom"
    }
  ]
}
```

## show-effective

One block per agent, one line per rule in resolved order; each rule line ends with its effective origin or `(external)`, followed by the known overridden declaration files in application order when any exist:

```text
opencode-permissions (all, custom)
  #0 * * allow (external)
  #73 read * allow opencode.json (shared)
  #83 edit opencode.json allow .opencode/agents/opencode-permissions.md (agent)
  #84 edit opencode.jsonc allow .opencode/agents/opencode-permissions.md (agent)
  #86 edit .opencode/agents/opencode-permissions.md deny .opencode/agents/opencode-permissions.md (agent)
```

## show-effective --json

The same data as a JSON object with one `agents` entry per agent; each rule carries exactly one `origin` and an `overrides` array:

```json
{
  "agents": [
    {
      "name": "opencode-permissions",
      "mode": "all",
      "status": "custom",
      "rules": [
        {
          "permission": "*",
          "pattern": "*",
          "action": "allow",
          "position": 0,
          "origin": {
            "scope": "external",
            "source": null
          },
          "overrides": []
        },
        {
          "permission": "read",
          "pattern": "*",
          "action": "allow",
          "position": 73,
          "origin": {
            "scope": "shared",
            "source": "opencode.json"
          },
          "overrides": []
        },
        {
          "permission": "edit",
          "pattern": "opencode.json",
          "action": "allow",
          "position": 83,
          "origin": {
            "scope": "agent",
            "source": ".opencode/agents/opencode-permissions.md"
          },
          "overrides": []
        }
      ]
    }
  ]
}
```

## Field Meanings

Agent fields (`list-agents`, and the agent header of `show-effective`):

- `name` — the enabled agent's name from the runtime inventory.
- `mode` — how the agent is invoked: `primary`, `subagent`, or `all`.
- `status` — `native` for OpenCode's built-in agents, `custom` for configured agents, or omitted / `null` when the runtime does not expose it.

Rule fields (`show-effective`):

- `position` — the rule's zero-based index in the complete resolved order.
- `permission` — the permission name, e.g. `read`, `edit`, `write`, `bash`, `skill`, `task`, `webfetch`.
- `pattern` — the input pattern the rule applies to.
- `action` — `allow`, `ask`, or `deny`.
- `origin` — the rule's single effective source declaration.
- `origin.scope` — `shared` when the rule comes from the `permission` section of the repository-root `opencode.json` or `opencode.jsonc`; `agent` when it comes from `agent.<name>.permission` in the repository-root config or the `permission:` frontmatter of `.opencode/agents/<name>.md`; `external` when no repository declaration is attributable.
- `origin.source` — the exact repository-relative declaration file for `shared` and `agent` origins; `null` for `external` origins, and the report never guesses a more specific source.
- `overrides` — known repository declarations superseded before the effective rule, in application order and excluding the effective origin; they are not additional origins.

`opencode.json` loads before `opencode.jsonc`; a later declaration of the same permission and input pattern replaces the earlier declaration and becomes the rule's `origin`.
