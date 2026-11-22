---
name: opencode-permission-optimizer
description: Recommend OpenCode permission rules for one agent from its recorded permission decisions; recommendations are applied only through the opencode-permissions skill.
---

# Advisory Permission Optimizer

Turn one agent's recorded permission requests into recommended rules for the owner.
This skill edits nothing: not policy, not role guidance, not any other source.
Work through the steps in order; each step says when to stop.

## Terms

- **action** — the identifier a request is filed under (`shell`, `read`, `edit`, `external_directory`, …). A runtime- or plugin-added tool files under its own name; recommend a rule for that exact name and never rename it.
- **resource** — what a rule matches: the command text for `shell`, the path for `read`/`edit`, the URL for `webfetch`, the directory glob for `external_directory`.
- **semantic operation** — what a command does, not its executable: `git diff` and `git fetch` are different operations.
- **authority classification** — a capability an operation needs: `local read` (`git status`), `local write` (`git add`), `destructive` (`rm -rf build`), `code-executing` (`bun test`), `network read` (`git fetch`), `external mutation` (`git push`). One operation can carry several.
- **history source** — the OpenCode major version that recorded an observation, reported as the numeric label `1` (legacy history) or `2` (current runtime history).

## Running the scripts

Replace `<skill-base-directory>` with the exact base directory reported when this skill is loaded, keep the whole path quoted, and run the scripts from inside the target repository.
Each script writes its full JSON to an ignored `.temp/` file and prints only `output file: <path>`.
Read that exact file completely, then delete only that exact path with `rm -- <path>`; never use a wildcard or directory-wide cleanup, and never commit command history or temporary output.
`--help`/`-h` prints usage and creates no file.

## Workflow

### 1. Select the agent

Run `bash "<skill-base-directory>/scripts/list-agents.sh"` and read its output file.
When the owner's request names exactly one listed agent id, use it; otherwise ask the owner to choose one from the list. Never guess or broaden an id.

### 2. Load the evidence

Run `bash "<skill-base-directory>/scripts/agent-permission-report.sh" --agent "<agent>" [--days <n>]` (`--days` is capped at the 30-day retention window) and read the complete report.
Stop with no recommendation when:

- the database is missing (nothing has been recorded yet);
- the schema is incompatible or migration failed — leave observations untouched; the plugin and this skill must be updated together;
- policy inspection failed — coverage is unknown.

Read the evidence with the numeric version labels it carries. The report counts **requests** — what the agent asked for — not the owner's choices: an approval is an observed outcome the runtime reported, and the report deliberately keeps all observed outcomes (approvals, rejections, unresolved requests, and legacy derived decisions) so the owner sees everything that happened, including requests no rule settled.
Qualifying evidence — the `qualifyingApprovalsBySource` and `successfulOnceApprovalsBySource` counts — additionally requires a successful completion, a known repository identity, and a known agent.

Legacy history (label `1`) is context, not authority. A legacy observation can justify a current rule only where a qualifying legacy `skill` request resolves to the same skill under the same identifier for the selected agent; a legacy `shell`, `webfetch`, or unknown action never justifies a new current allow.
A successful `always` reply may justify a rule only for a resource actually observed in that history, and never for `webfetch`; request counts alone never justify anything.

### 3. Load the agent instructions

- Native agent: its section in `references/native-roles.md`.
- Custom agent: `.opencode/agents/<name>.md`, every skill it names (its `SKILL.md` and the files that `SKILL.md` references), and every applicable `AGENTS.md` (repository root and nested).

When no role guidance exists, recommend no new authority; you may still recommend `ask` or `deny`.

### 4. Group requests into semantic operations

Group the report's requested resources by semantic operation, not by executable, argument, or file path.
Use counts, sessions, and timestamps only to see which operations the agent repeatedly needed and how recently; they never decide the action.

### 5. Classify authority and resolve targets

For each operation:

1. Assign every applicable authority classification.
2. Resolve every file it reads, writes, deletes, executes, or redirects to, through `cd`, substitutions, wrappers, pipelines, and every part of a compound statement. Classify each target as project-local, allowed by an `external_directory` rule in the effective policy, outside policy, or unresolved (variable, substitution, `cd`, symlink).
3. For a target outside the project, or for an `external_directory` request itself, read `references/opencode-permission-model.md`: it explains which tools the directory gate checks, that the directory gate now defaults to allow, and that redirects bypass it.
4. When you do not know what a command does, record the question for the owner: what it does and why the agent runs it. Until it is answered, the operation's recommendation is `ask` with the open question stated. Never recommend `deny` only because a command is unfamiliar.

An allowed shell command runs with the host user's full filesystem, process, and network authority; a resource pattern constrains command text, not effects.

### 6. Find the current winning rule

Evaluate each requested resource against the complete ordered effective policy in the report:

- Rules carry an action, a resource, and an effect; evaluation finds the last rule whose action and resource both match, that last match wins, and no match resolves to `ask`.
- `*` matches any run of characters (spaces included), `?` one character. A pattern ending in ` *` also matches the bare command: `git diff *` covers `git diff`.
- OpenCode evaluates each parsed command of a pipeline, substitution, or compound statement separately; every part needs its own winning rule.
- A configured `deny` rule ends a request even against a saved approval, and session rules plus project-saved approvals apply after the agent's configured rules; the report shows only the configured rules.

Record the winning rule's position, effect, and origin for each operation.

### 7. Decide the effect

Decide for the same action the request used (a `shell` request gets a `shell` rule):

- **`allow`** — normal for the job, predictably scoped, ordinarily reversible, and bypasses no owner-controlled step.
- **`ask`** — may serve the job but is destructive, externally visible, unusually broad, hard to recover from, or depends on context the policy cannot verify.
- **`deny`** — contradicts the role or bypasses an explicit responsibility or owner-control boundary.

A target that is outside policy or unresolved gets no new authority, and one such target denies the whole compound command: keep the current `ask`, or recommend `deny` when the role gives no reason to touch it.
An `external_directory` request asks whether to authorize that directory: decide it by role fit with the criteria above. An allowed directory inherits the agent's other rules, so an agent with `edit *` allowed could also write there; pair the allow with a later deny for any inherited authority the role does not need.
Where a path-checked built-in tool does the same job (`read` instead of `cat`/`sed -n`, `edit` instead of `sed -i` or an interpreter rewrite), offer it as an alternative for the owner to choose.

If preservation or scope is uncertain, withhold the allow from application and recommend `ask` instead.

### 8. Choose the resource for each `allow`, and its redirect variant

For a proposed `shell` allow, present **two variants side by side against the actual ordered rules**, never a single blended proposal:

1. **Keep the current redirect handling.** The allow also admits every redirected form of that command unless a later rule returns it to the owner. State which redirected forms the allow would admit, and preserve every existing deny-only path exclusion unchanged.
2. **Add an explicit change for that command.** Either a command-scoped guard that returns that one command's redirects to `ask` (`<command> >*` and `<command> *<*`), or one narrow reviewed redirect exception (a complete reviewed command such as `bun test > .opencode/test-output.txt 2>&1`) after the guard.

Explain the effect of each variant: what the owner keeps having to approve, and what would run without asking. The owner picks one; only the picked variant goes forward.

For non-shell actions the resource is already scoped by the operation itself (path, URL, glob, skill name), and no variant applies.

Then place the rule set the same way in either variant:

1. Choose the broadest resource that admits no command with an authority classification the operation lacks and crosses no unapproved path boundary. `git *` fails for `git status`: it admits `git push`'s external mutation. Never turn history into a per-argument or per-file allowlist.
2. List the materially different command forms and targets the resource newly admits.
3. Unrelated `deny` rules stay untouched. Unconditional command bans land after overlapping path and allow rules, so they stay terminal; an allow after a broad deny exists only as a deliberately narrow exception the owner saw and chose.
4. Last, add a `deny` for every mutating form the resource still admits. Last match wins, so these denies come after the allow and the guard and win for any command matching several.

Example: `sed -n '1,40p' file` prints without modifying the file.
Allow `sed -n *`, then deny `sed *-i*`, which catches `-i`, `-i.bak`, and `--in-place`, so `sed -n -i` stays denied.
`sed -n *` still admits sed's own `w` (write file) and `e` (execute) script commands; list them as newly admitted.
A `-i` deny may also catch harmless expression text containing `-i`; that fails safe.

### 8a. Webfetch URL patterns

Before proposing any webfetch rule, read `references/webfetch-trust-scopes.md` — it defines which evidence qualifies and the exact scopes.

Webfetch evidence must be successful current-runtime `once` approvals: no `always` reply and no legacy label qualifies, and a saved `*` approval never counts.
The report's `webfetchRequestedUrlMatches` entries are the only URL rules this skill may forward; each carries the scope, the exact proposed pattern, and the recorded URLs.

Recommend a match's pattern only when the role and the ordered rules justify its breadth:

1. Say what the pattern newly admits — every path and query under the origin or the GitHub owner namespace.
2. Check the pattern against existing rules: an applicable `deny` later in the sequence keeps working, and a narrower existing `ask` the owner wanted must survive the placement; never widen past a deny the role relies on.
3. State the separate HTTP redirect limitation: the rule does not confine redirects; a followed redirect can leave the scope, and only a `deny` for the redirect target stops that.
4. If the preservation or the scope is uncertain — including any host whose tenant boundary is unknown — withhold the allow and recommend `deny` or `ask` on the observed URLs instead. Never propose an origin pattern for a multi-tenant host; the example origin pattern in the trust reference is not a general recommendation.

### 9. Present the recommendations

Title the report `Policy recommendations (not yet applied)`. For each semantic operation give:

1. evidence: requested resources, counts, sessions, first and last activity, with their numeric history-source labels;
2. authority classifications and resolved targets;
3. current winning rule and effect;
4. recommended rules in order, with action, resource, and effect — and for shell allows, both redirect variants;
5. what each resource newly admits;
6. rationale tied to the agent instructions;
7. rejected alternatives and open questions.

Never fold a redirect or added authority into a broader read-oriented recommendation.
Ask the owner which recommendations to pursue and the open questions from step 5, then stop until they answer.

### 10. Hand off the owner's selection

Pass only the selected recommendations to the `opencode-permissions` skill's `prepare` step, each with:

- target agent, action, resource, and proposed effect;
- for a shell allow, the redirect variant the owner picked;
- the rationale and the report figures used;
- the winning-rule findings and the required placement relative to existing guards;
- the wildcard expansion;
- the path, redirect, and webfetch-scope concerns.

Selection is not confirmation. That skill locates the editable source, shows the exact ordered diff, and applies it only after the owner confirms that diff.
If sources or policy change before then, the prepared diff is invalid and needs a fresh `prepare`.
