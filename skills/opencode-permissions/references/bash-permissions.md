# Bash Permissions

Rule ordering and wildcard matching apply to every permission; `bash` additionally governs shell evaluation and redirects.

## Rule Ordering and Wildcards

- Configuration sources are deep-merged before rules are ordered; a later value for the same permission and input pattern replaces the earlier merged value.
- Rules are not sorted by specificity; evaluation searches backward and the last match wins, and no matching rule means `ask`.
- Custom-agent rule order is runtime defaults, repository-shared permissions, agent permissions, then runtime-generated rules; native-agent defaults sit between runtime defaults and repository-shared permissions.
- `*` matches any character sequence, `?` matches exactly one character, and matching covers the complete input.
- `**` is not a separate globstar operator; adjacent `*` characters add no capability and should not be used.
- Backslashes in patterns are normalized to forward slashes.
- OpenCode special-cases a pattern ending in ` *`: `git status *` is matched as `git status( .*)?`, so it matches both `git status` and `git status --short`.

## Shell Evaluation and Redirects

`bash` is the security boundary for shell commands and is not a filesystem sandbox.
An allowed command runs with the host user's filesystem, process, and network authority.
It governs the complete textual shell statement, including redirects, while `read`, `edit`, `write`, and `external_directory` do not authorize or constrain redirect targets.
OpenCode evaluates each parsed command node independently, including commands inside `$()` and backticks, pipelines, and compound statements.
The permission input for a redirected command is its complete redirected statement.

`2>&1` duplicates standard error onto standard output and does not name a file.
`2>/dev/null` discards standard error to a fixed device.
Allow either form only as part of a complete reviewed command, because a pattern such as `*2>&1*` or `*2>/dev/null*` can also match the same statement with an additional unsafe file redirect.
The same restriction applies to `>`, `>>`, `<`, here-documents, here-strings, process substitution, and descriptor-specific redirects.
