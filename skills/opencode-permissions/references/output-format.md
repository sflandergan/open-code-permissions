# Output Format

The inspector writes these report bodies to the generated output file printed by `inspect.sh`.

## list-agents

One line per enabled agent; `hidden` is appended for hidden agents, and the display name is appended with ` — ` only when it differs from the id:

```text
build (primary) — Build
compaction (primary, hidden) — Compaction
ghost (all, hidden)
title (primary, hidden) — Title
```

## list-agents --json

The same data as a JSON object with one `agents` entry per agent:

```json
{
  "agents": [
    {
      "id": "build",
      "name": "Build",
      "mode": "primary",
      "hidden": false
    },
    {
      "id": "ghost",
      "name": "ghost",
      "mode": "all",
      "hidden": true
    }
  ]
}
```

## show-effective

One block per agent, one line per rule in runtime order; each rule line ends with its effective origin - the repository-relative source with its scope in parentheses, or `(unknown)` when no editable source is attributable:

```text
build (primary) — Build
  #0 * * allow (unknown)
  #5 read * allow opencode.json (shared)
  #8 shell * ask opencode.jsonc (shared)
  #10 shell git status allow .opencode/modes/build.md (agent)
```

## show-effective --json

The same data as a JSON object with one `agents` entry per agent; each rule carries exactly one `origin`:

```json
{
  "agents": [
    {
      "id": "ghost",
      "name": "ghost",
      "mode": "all",
      "hidden": true,
      "rules": [
        {
          "action": "read",
          "resource": "*",
          "effect": "allow",
          "position": 5,
          "origin": {
            "scope": "shared",
            "source": "opencode.json"
          }
        },
        {
          "action": "shell",
          "resource": "git status",
          "effect": "allow",
          "position": 25,
          "origin": {
            "scope": "agent",
            "source": ".opencode/agents/ghost.md"
          }
        }
      ]
    }
  ]
}
```

## Field Meanings

Agent fields (`list-agents`, and the agent header of `show-effective`):

- `id` — the agent's id from the runtime inventory; the value `show-effective [agent]` selects.
- `name` — the runtime's display name; equals the id unless the agent declares another name.
- `mode` — how the agent is invoked: `primary`, `subagent`, or `all`.
- `hidden` — whether the runtime hides the agent from selection.

Rule fields (`show-effective`):

- `position` — the rule's zero-based index in the agent's complete runtime order. The runtime provides positions; the inspector never reorders, drops, or duplicates rules, including rules it cannot attribute.
- `action` — the permission action the rule matches, exactly as the runtime reports it.
- `resource` — the resource pattern the rule applies to, exactly as the runtime reports it.
- `effect` — `allow`, `deny`, or `ask`.
- `origin` — the rule's verified source declaration.
- `origin.scope` — `shared` for a config document's document-level `permissions`; `agent` for a config document's agent record or an agent definition file discovered inside a config directory entry; `unknown` when no editable repository source is attributable.
- `origin.source` — the exact repository-relative source file for `shared` and `agent` origins; `null` for `unknown` origins, and the report never guesses a more specific source.

## How origins are verified

The inspector aligns the runtime's ordered rules with the candidate sequence the runtime builds rules from: the runtime's default template and builtin additions, then every `debug config` entry's document-level rules in entry order, then the agent's own declarations in the same expanded entry order - config agent records and agent definition files discovered at directory entries.

A position keeps an origin only when every complete alignment attributes the same source to it. Positions that different alignments attribute differently, positions an unmatched rule occupies between identical declarations, and whole agents whose known rules cannot be fully aligned report `unknown`. A source is named only when it lies canonically inside the repository, is no symbolic link, and its actual bytes normalize to the rules the runtime reports: legacy `permission` and `tools` declarations migrate with the runtime's renames (`bash`→`shell`, `task`→`subagent`, `write`/`patch`/`apply_patch`→`edit`), and home-prefixed filesystem resources expand with the runtime's home directory before comparison.
