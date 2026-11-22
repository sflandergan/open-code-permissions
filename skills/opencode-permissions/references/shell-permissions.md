# Shell Permissions

Rule ordering and wildcard matching apply to every permission; `shell` additionally governs shell evaluation and redirects.

## Rule Ordering and Wildcards

- Rules are an ordered list, not a keyed map: every declaration lands in the agent's sequence in the order the runtime assigns it, and duplicates stay.
- Rules are not sorted by specificity; evaluation finds the last rule whose action and resource both match, that last match wins, and no matching rule means `ask`.
- An agent's sequence is: the runtime's default-template rules, the builtin agent's additions, the shared document rules of every config entry in entry order, then the agent's own declarations - config agent records and agent definition files - in the same expanded entry order.
- A request also carries rules outside this report's scope, in this precedence: a configured `deny` rule ends the request immediately, even against a saved approval; session rules and project-saved approvals are appended after the agent's configured rules and win ties only when nothing configured denies.
- `*` matches any character sequence, `?` matches exactly one character, and matching covers the complete text. The action and the resource are both matched this way.
- `**` is not a separate globstar operator; adjacent `*` characters add no capability and should not be used.
- Backslashes in patterns and in the matched text are normalized to forward slashes.
- OpenCode special-cases a pattern ending in ` *`: `git status *` is matched as `git status( .*)?`, so it matches both `git status` and `git status --short`.
- Outside Windows, matching is case-sensitive: `Read` does not match a `read` action.

## Shell Evaluation and Redirects

`shell` is the security boundary for shell commands and is not a filesystem sandbox.
An allowed command runs with the host user's filesystem, process, and network authority.
It governs the complete textual shell statement, including redirects, while `read`, `edit`, and `external_directory` do not authorize or constrain shell redirect targets.
OpenCode evaluates each parsed command node independently, including commands inside `$()` and backticks, pipelines, and compound statements.
The permission resource for a redirected command is its complete redirected statement.

`2>&1` duplicates standard error onto standard output and does not name a file.
`2>/dev/null` discards standard error to a fixed device.
Allow either form only as part of a complete reviewed command, because a pattern such as `*2>&1*` or `*2>/dev/null*` can also match the same statement with an additional unsafe file redirect.
The same restriction applies to `>`, `>>`, `<`, here-documents, here-strings, process substitution, and descriptor-specific redirects.

## Redirect Guarantees and Their Limits

A textual shell rule never resolves a target path and never provides a sandbox: it constrains only the literal command text, and `~`, variables, substitution, and symlinked components can all name a target the text does not show.
When a command writes files, choose between two variants before preparing the rule:

1. Keep the current redirect handling: an `allow` for that command also admits its redirected forms unless a later rule returns them to `ask` or `deny`. Say explicitly which redirected forms the allow would admit.
2. Add command-scoped redirect guards for that one command: later rules such as `<command> >*` and `<command> *<*` with effect `ask` (or `deny`) return every textual redirect to the owner, and only reviewed complete-command exceptions after them are allowed.

Deny-only path restrictions work the same way: later rules with effect `deny` for selected target spellings (for example `*..*` or an absolute prefix) never enable anything by themselves; they only block spellings an earlier allow would have admitted.

Order the rules so the winner is deliberate:

1. broad command allows first;
2. then redirect and path guards for the commands above them;
3. then reviewed narrow exceptions - and only intentional ones - after a broad deny;
4. unconditional command bans (`deny` with resource `*` for one action family) last, so a later narrow allow can never be placed after them, and any exception must land in the gap between the overlapping rules the ban terminates.

Because the last match wins, an unconditional ban placed before an overlapping allow would let the allow win; keep the ban terminal.
Allow after a broad deny only as a deliberately narrow exception, and re-inspect the complete ordered result after applying.

## Legacy Names

Legacy declarations keep their old action names in the source (`bash`, `task`, `write`, `patch`, `apply_patch`); the runtime migrates them to `shell`, `subagent`, and `edit` when it builds the rule sequence, and the inspector reports the migrated names. Recognized legacy blocks may be inspected but not edited; edit the native form instead.
