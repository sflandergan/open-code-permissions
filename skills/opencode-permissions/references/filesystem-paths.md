# Filesystem Permission Paths

`external_directory` is checked only for a resolved path outside the current
project directory or Git worktree. Its resource is an absolute glob expression for
the selected directory, e.g. `/tmp/my-application/*`. A directory target selects
itself; a file-like target selects its immediate parent.

OpenCode 1.x asked before touching any external path. The current runtime does
not: `external_directory` is allowed by default, and only an explicit repository
rule returns external access to the owner. To retain the 1.x caution, a
repository declares a broad shared fallback first - `{ "action": "external_directory", "resource": "*", "effect": "ask" }` - before any narrower exceptions, so
that every external path asks unless a reviewed rule deliberately admits it, and
an agent-local catch-all cannot wipe out the owner's shared exceptions.

## Built-in file and search tools

Native file and search tools emit their own operation resource, separate from
`external_directory`:

| Tool | `external_directory` check when external | Tool permission check |
| --- | --- | --- |
| `read` | directory glob for a directory; parent-directory glob for a file | `read` worktree-relative path |
| `edit` | parent-directory glob | `edit` worktree-relative path |
| `glob` | directory glob | caller glob expression |
| `grep` | directory glob or file-parent-directory glob | caller regex |

The external_directory and tool paths are separate checks that both must permit a successful execution.
The file tool resources are always relative from the workspace directory.
For example, with an active worktree at `/workspace/repo` and a native read targeting `/tmp/my-application/result.txt`
the following glob and wildcards are resolved:

```text
external_directory: /tmp/my-application/*
read:              ../../tmp/my-application/result.txt
```

## Shell commands

`shell` authorizes the parsed command text and remains the shell security
boundary.

- Recognized file commands additionally scan path arguments and request
  `external_directory` for external paths; this limited scan does not sandbox
  `shell`.
- `mkdir` checks the target when it is currently a directory and otherwise its
  immediate parent, and still has a normal shell request.
- An external `cd` destination is checked by `external_directory`, but `cd`
  itself creates no shell request.
- Redirects are skipped by the external-directory scan and remain governed by
  the complete shell command.
