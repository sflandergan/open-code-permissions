---
name: opencode-permission-optimizer
description: Recommend OpenCode permission rules for one agent from its recorded permission decisions; recommendations are applied only through the opencode-permissions skill.
---

# Advisory Permission Optimizer

Turn one agent's recorded permission requests into recommended rules for the owner.
This skill edits nothing: not policy, not role guidance, not any other source.
Work through the steps in order; each step says when to stop.

## Terms

- **permission kind** — the identifier a request is filed under (`bash`, `read`, `edit`, `external_directory`, …). A runtime- or plugin-added tool files under its own name; recommend a rule for that exact name and never rename it.
- **semantic operation** — what a command does, not its executable: `git diff` and `git fetch` are different operations.
- **authority classification** — a capability an operation needs: `local read` (`git status`), `local write` (`git add`), `destructive` (`rm -rf build`), `code-executing` (`bun test`), `network read` (`git fetch`), `external mutation` (`git push`). One operation can carry several.

## Running the scripts

Replace `<skill-base-directory>` with the exact base directory reported when this skill is loaded, keep the whole path quoted, and run the scripts from inside the target repository.
Each script writes its full JSON to an ignored `.temp/` file and prints only `output file: <path>`.
Read that exact file completely, then delete only that exact path with `rm -- <path>`; never use a wildcard or directory-wide cleanup, and never commit command history or temporary output.
`--help`/`-h` prints usage and creates no file.

## Workflow

### 1. Select the agent

Run `bash "<skill-base-directory>/scripts/list-agents.sh"` and read its output file.
When the owner's request names exactly one listed agent, use it; otherwise ask the owner to choose one from the list. Never guess or broaden a name.

### 2. Load the evidence

Run `bash "<skill-base-directory>/scripts/agent-permission-report.sh" --agent "<agent>" [--days <n>]` (`--days` is capped at the 30-day retention window) and read the complete report.
Stop with no recommendation when:

- the database is missing (nothing has been recorded yet);
- the schema is incompatible or migration failed — leave observations untouched; the plugin and this skill must be updated together;
- policy inspection failed — coverage is unknown.

### 3. Load the role guidance

- Native agent: its section in `references/native-roles.md`.
- Custom agent: `.opencode/agents/<name>.md`, every skill it names (its `SKILL.md` and the files that `SKILL.md` references), and every applicable `AGENTS.md` (repository root and nested).

When no role guidance exists, recommend no new authority; you may still recommend `ask` or `deny`.

### 4. Group requests into semantic operations

Group the report's requested patterns by semantic operation, not by executable, argument, or file path.
Use counts, sessions, and timestamps only to see which operations the agent repeatedly needed and how recently; they never decide the action.

### 5. Classify authority and resolve targets

For each operation:

1. Assign every applicable authority classification.
2. Resolve every file it reads, writes, deletes, executes, or redirects to, through `cd`, substitutions, wrappers, pipelines, and every part of a compound statement. Classify each target as project-local, allowed by an `external_directory` rule in the effective policy, outside policy, or unresolved (variable, substitution, `cd`, symlink).
3. For a target outside the project, or for an `external_directory` request itself, read `references/opencode-permission-model.md`: it explains which tools the directory gate checks and that redirects bypass it.
4. When you do not know what a command does, record the question for the owner: what it does and why the agent runs it. Until it is answered, the operation's recommendation is `ask` with the open question stated. Never recommend `deny` only because a command is unfamiliar.

An allowed Bash command runs with the host user's full filesystem, process, and network authority; a pattern constrains command text, not effects.

### 6. Find the current winning rule

Evaluate each requested pattern against the complete ordered effective policy in the report:

- Rules are checked in order and the **last** matching rule wins; no match resolves to `ask`.
- `*` matches any run of characters (spaces included), `?` one character. A pattern ending in ` *` also matches the bare command: `git diff *` covers `git diff`.
- OpenCode evaluates each parsed command of a pipeline, substitution, or compound statement separately; every part needs its own winning rule.

Record the winning rule's position and action for each operation.

### 7. Decide the action

Decide for the same permission kind the request used (a `bash` request gets a `bash` rule):

- **`allow`** — normal for the job, predictably scoped, ordinarily reversible, and bypasses no owner-controlled step.
- **`ask`** — may serve the job but is destructive, externally visible, unusually broad, hard to recover from, or depends on context the policy cannot verify.
- **`deny`** — contradicts the role or bypasses an explicit responsibility or owner-control boundary.

A target that is outside policy or unresolved gets no new authority, and one such target denies the whole compound command: keep the current `ask`, or recommend `deny` when the role gives no reason to touch it.
An `external_directory` request asks whether to authorize that directory: decide it by role fit with the criteria above. An allowed directory inherits the agent's other rules, so an agent with `edit *` allowed could also write there; pair the allow with a later deny for any inherited authority the role does not need.
Where a path-checked built-in tool does the same job (`read` instead of `cat`/`sed -n`, `edit` instead of `sed -i` or an interpreter rewrite), offer it as an alternative for the owner to choose.

### 8. Choose the pattern for each `allow`

1. Choose the broadest wildcard that admits no command with an authority classification the operation lacks and crosses no unapproved path boundary. `git *` fails for `git status`: it admits `git push`'s external mutation. Never turn history into a per-argument or per-file allowlist.
2. List the materially different command forms and targets the pattern newly admits.
3. A new agent rule lands after shared rules, so it overrides shared guards such as a `*>*` redirect `ask`. When such a guard exists, follow the allow with a `<command> *>*` rule that keeps the guard's action.
4. Last, add a `deny` for every mutating form the pattern still admits. Last match wins, so these denies come after the allow and the guard and win for any command matching several.

Example: `sed -n '1,40p' file` prints without modifying the file.
Allow `sed -n *`, then deny `sed *-i*`, which catches `-i`, `-i.bak`, and `--in-place`, so `sed -n -i` stays denied.
`sed -n *` still admits sed's own `w` (write file) and `e` (execute) script commands; list them as newly admitted.
A `-i` deny may also catch harmless expression text containing `-i`; that fails safe.

### 9. Present the recommendations

Title the report `Policy recommendations (not yet applied)`. For each semantic operation give:

1. evidence: requested patterns, counts, sessions, first and last activity;
2. authority classifications and resolved targets;
3. current winning rule and action;
4. recommended rules in order, with permission kind, pattern, and action;
5. what each pattern newly admits;
6. rationale tied to the role guidance;
7. rejected alternatives and open questions.

Never fold a redirect or added authority into a broader read-oriented recommendation.
Ask the owner which recommendations to pursue and the open questions from step 5, then stop until they answer.

### 10. Hand off the owner's selection

Pass only the selected recommendations to the `opencode-permissions` skill's `prepare` step, each with:

- target agent, permission, pattern, and proposed action;
- the rationale and the report figures used;
- the winning-rule findings and the required placement relative to existing guards;
- the wildcard expansion;
- the path and redirect concerns.

That skill locates the editable source, shows the exact ordered diff, and applies it only after the owner confirms that diff.
If sources or policy change before then, the prepared diff is invalid and needs a fresh `prepare`.
