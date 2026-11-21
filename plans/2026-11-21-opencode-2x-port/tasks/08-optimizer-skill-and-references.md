# Task 08 — Optimizer skill and references for 2.x evidence

## Objective

Rewrite the advisory optimizer workflow for the 2.x report: native action/resource/effect vocabulary, webfetch requested-URL-match recommendations with the spec's exact gate and caveats, legacy versus 2.x evidence rules with the initial equivalence set, and counts that keep the two history sources distinguishable.

## Files

- Modify: `skills/opencode-permission-optimizer/SKILL.md` (rewrite)
- Modify: `skills/opencode-permission-optimizer/references/opencode-permission-model.md` (rewrite)
- Modify: `skills/opencode-permission-optimizer/references/native-roles.md` (terms only, if it names 1.x fields)

## Interfaces

- Consumes: task 06's report v2 (`counts.approvalsBySource`, `resources` entries with `action`/`resource`, `webfetchRequestedUrlMatches`, native `effectivePolicy.rules`), task 04's history-source vocabulary, task 05's inspector output.
- Produces: the advisory contract — the skill recommends, presents, and hands off; it never edits policy itself (`apply` goes to the `opencode-permissions` skill exactly as before).

## Verified facts used

Qualifying approval requires (per observation) a direct `once`/`always` decision plus successful completion, known repository identity, and a known agent — a background acknowledgment, missing result, or unknown shell exit is not proof of success, and a final shell result succeeds only on exit code zero. The saved-approval candidate `*` for webfetch is not evidence for any specific destination. The built-in 2.x webfetch tool checks redirect targets against denies but does not require a fresh ask per redirect, so an origin rule does not confine redirected requests to the origin. URL-origin rule proposals come only from the report's `webfetchRequestedUrlMatches` (≥2 distinct requested URLs on one exact http/https origin, role-justified).

- [ ] **Step 1: Rewrite `references/opencode-permission-model.md`** (complete new content):

```markdown
# OpenCode Permission Model (2.x)

Rules are one of: `{ "action": <name>, "resource": <pattern>, "effect": "allow" | "ask" | "deny" }`.
Evaluation checks rules in order, the last matching rule wins, and no matching rule resolves to `ask`.

- The **action** names what is checked (`read`, `edit`, `shell`, `subagent`, `external_directory`, `webfetch`, `websearch`, `skill`, `question`, …). A runtime- or plugin-added tool files under its own name; recommend a rule for that exact action.
- The **resource** is the value checked: the worktree-relative path for file tools, the evaluated command text for `shell`, the agent name for `subagent`, the skill name for `skill`, the URL (fragment stripped) for `webfetch`, and an absolute directory glob for `external_directory`.
- The **effect** is `allow`, `ask`, or `deny`.

`external_directory` is allowed by default in 2.x; an `allow` for it inherits the agent's other rules, so pair it with a later deny for any inherited authority the role does not need.

Session rules, the runtime's saved approvals, and separately managed or organization policies can change a request's actual result without appearing in the report's configured baseline.

## Recorded evidence

Qualifying approval requires a direct `once` or `always` decision, successful completion (a final shell result succeeds only on exit code zero), a known repository identity, and a known agent. Background acknowledgments, missing results, and unknown exits never prove success. Automatic follow-ons and shutdown rejects are kept visible as derived decisions and are never independent choices.

`approvalsBySource` splits approvals by history source (`1.x` / `2.x`). Only 2.x approvals are evidence for a new allow. Legacy observations stay visible as context: except for the equivalence set below, they never qualify.

**Initial equivalence set (v2.3.2):** a 1.x observation of the `skill` action on one skill identifier counts as evidence for a 2.x allow only when that exact identifier still resolves to the same skill for the agent and the legacy observation is itself a qualifying approval. Legacy `bash`, legacy `webfetch` URLs, unknown or custom actions, and everything else do not qualify.

## Webfetch

`webfetch` checks the URL as its resource. The tool proposes `*` only as the saved-approval candidate when the owner answers Allow-always — that is not a request for any specific destination and never counts as approval of other URLs. The report's `webfetchRequestedUrlMatches` groups qualifying 2.x approvals by exact http/https URL origin and proposes `<origin>/*`. The runtime checks redirect targets against deny rules but never requires a fresh ask per redirect, so an origin rule does not guarantee redirected requests stay on the origin, and no rule overrides a separate managed deny.
```

- [ ] **Step 2: Rewrite SKILL.md**

Replace `skills/opencode-permission-optimizer/SKILL.md` (complete new content; frontmatter `name`/`description` stay verbatim):

```markdown
---
name: opencode-permission-optimizer
description: Recommend OpenCode permission rules for one agent from its recorded permission decisions; recommendations are applied only through the opencode-permissions skill.
---

# Advisory Permission Optimizer

Turn one agent's recorded permission decisions into recommended rules for the owner.
This skill edits nothing: not policy, not role guidance, not any other source.
Work through the steps in order; each step says when to stop.

## Terms

- **action** — what a request is checked under (`shell`, `read`, `edit`, `external_directory`, `webfetch`, …). A runtime- or plugin-added tool files under its own name; recommend a rule for that exact action and never rename it.
- **resource** — the value checked: the evaluated command text for `shell`, a path for file tools, a URL for `webfetch`, a skill or agent name otherwise.
- **effect** — `allow`, `ask`, or `deny`.
- **history source** — whether an observation was recorded by the 1.x or the 2.x runtime; the report splits approvals by it, and only 2.x approvals are evidence.
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
When the owner's request names exactly one listed agent id, use it; otherwise ask the owner to choose one from the list. Never guess or broaden an id.

### 2. Load the evidence

Run `bash "<skill-base-directory>/scripts/agent-permission-report.sh" --agent "<agent>" [--days <n>]` (`--days` is capped at the 30-day retention window) and read the complete report.
Stop with no recommendation when:

- the database is missing (nothing has been recorded yet);
- the schema is incompatible or migration failed — leave observations untouched; the error says which side to update: start OpenCode with the updated opencode-permissions plugin so the database migrates on startup, or update this skill to the release that recorded the database;
- policy inspection failed — coverage is unknown.

### 3. Load the role guidance

- Native agent: its section in `references/native-roles.md`.
- Custom agent: `.opencode/agents/<id>.md`, every skill it names (its `SKILL.md` and the files that `SKILL.md` references), and every applicable `AGENTS.md` (repository root and nested).

When no role guidance exists, recommend no new authority; you may still recommend `ask` or `deny`.

Before judging evidence, read `references/opencode-permission-model.md` for the rule shape, the qualifying-approval requirements, the history-source split, and the initial equivalence set.

### 4. Group requests into semantic operations

Group the report's requested resources by semantic operation, not by executable, argument, or file path.
Use counts, sessions, and timestamps only to see which operations the agent repeatedly needed and how recently; they never decide the effect.

Treat the two history sources separately: `approvalsBySource` shows which approvals are 2.x evidence and which are 1.x context. Re-check a legacy `skill` request against the equivalence set (same skill identifier, still resolving to the same skill for the agent, itself a qualifying approval legacy observation); every other legacy observation — `bash` commands, `webfetch` URLs, unknown or custom actions — stays visible as context and never qualifies.

### 5. Classify authority and resolve targets

For each operation:

1. Assign every applicable authority classification.
2. Resolve every file it reads, writes, deletes, executes, or redirects to, through `cd`, substitutions, wrappers, pipelines, and every part of a compound statement. Classify each target as project-local, allowed by an `external_directory` rule in the effective policy, outside policy, or unresolved (variable, substitution, `cd`, symlink).
3. When you do not know what a command does, record the question for the owner: what it does and why the agent runs it. Until it is answered, the operation's recommendation is `ask` with the open question stated. Never recommend `deny` only because a command is unfamiliar.

An allowed shell command runs with the host user's full filesystem, process, and network authority; a rule's resource constrains command text, not effects.

### 6. Find the current winning rule

Evaluate each requested resource against the complete ordered effective policy in the report:

- Rules are checked in order; the **last** matching rule wins; no match resolves to `ask`.
- `*` matches any run of characters (spaces included), `?` one character, and a resource ending in ` *` also matches the bare command: `git diff *` covers `git diff`.
- OpenCode evaluates each parsed command of a pipeline, substitution, or compound statement separately; every part needs its own winning rule.

Record the winning rule's position and effect for each operation.

### 7. Decide the effect

Decide for the same action the request used (a `shell` request gets a `shell` rule):

- **`allow`** — normal for the job, predictably scoped, ordinarily reversible, and bypasses no owner-controlled step.
- **`ask`** — may serve the job but is destructive, externally visible, unusually broad, hard to recover from, or depends on context the policy cannot verify.
- **`deny`** — contradicts the role or bypasses an explicit responsibility or owner-control boundary.

A target that is outside policy or unresolved gets no new authority, and one such target denies the whole compound statement: keep the current `ask`, or recommend `deny` when the role gives no reason to touch it.
An `external_directory` request asks whether to authorize that directory: decide it by role fit with the criteria above; `external_directory` is allowed by default in 2.x, so recommending `ask` restores the earlier per-request caution, and an allowed directory inherits the agent's other rules — pair the allow with a later deny for any inherited authority the role does not need.
Where a path-checked built-in tool does the same job (`read` instead of `cat`/`sed -n`, `edit` instead of `sed -i` or an interpreter rewrite), offer it as an alternative for the owner to choose.

### 8. Choose the resource for each `allow`

1. Choose the broadest wildcard that admits no command with an authority classification the operation lacks and crosses no unapproved path boundary. `git *` fails for `git status`: it admits `git push`'s external mutation. Never turn history into a per-argument or per-file allowlist.
2. List the materially different command forms and targets the resource newly admits.
3. A new agent rule lands after every shared rule, so it overrides shared guards such as a `*>` redirect `ask`. When such a guard exists, follow the allow with a `<command> *>*` rule that keeps the guard's effect.
4. Last, add a `deny` for every mutating form the resource still admits. Last match wins, so these denies come after the allow and the guard and win for any command matching several.

Example: `sed -n '1,40p' file` prints without modifying the file.
Allow `sed -n *`, then deny `sed *-i*`, which catches `-i`, `-i.bak`, and `--in-place`, so `sed -n -i` stays denied.
`sed -n *` still admits sed's own `w` and `e` script commands; list them as newly admitted.
A `-i` deny may also catch harmless expression text containing `-i`; that fails safe.

### 9. Recommend webfetch URL-origin rules only from requested-URL matches

For `webfetch`, recommend a URL-origin rule ‑ of the form `<origin>/*` ‑ only from the report's `webfetchRequestedUrlMatches`:

- The match must carry at least two distinct requested URLs on one exact http/https origin, each with qualifying **2.x** approvals. Legacy webfetch history never contributes.
- The agent's role must justify access to the broader origin, not just the fetched pages.
- State out loud: the pattern admits every unobserved path and query on that origin.
- Show existing denies and narrower `ask` guards the recommendation coexists with, and place it so those guards remain effective (last match wins — a broad default `ask` may gain the specific exception being proposed). If the guard's scope, placement, or preservation cannot be verified from the effective policy, keep the suggestion advisory: it is not eligible for application.
- State the redirect limitation: the built-in tool checks redirect targets against denies but never requires a fresh ask per redirect, so this rule does not guarantee redirected requests stay on the origin and cannot override a separate managed deny.
- Never infer sibling hosts, subdomains, alternate schemes, or ports; a bare `*` for `webfetch` is only the saved-approval candidate the tool proposed, and never evidence for any destination.

A single fetched URL, URLs across different origins, unknown hosts, or non-HTTP(S) requests yield no origin recommendation — the report already withholds them; do not reconstruct one.

### 10. Present the recommendations

Title the report `Policy recommendations (not yet applied)`. For each semantic operation give:

1. evidence: requested resources, counts, sessions, first and last activity — separated by history source;
2. authority classifications and resolved targets;
3. current winning rule and effect;
4. recommended rules in order, with action, resource, and effect;
5. what each resource newly admits;
6. rationale tied to the role guidance;
7. rejected alternatives and open questions.

Never fold a redirect or added authority into a broader read-oriented recommendation.
Ask the owner which recommendations to pursue and the open questions from step 5, then stop until they answer.

### 11. Hand off the owner's selection

Pass only the selected recommendations to the `opencode-permissions` skill's `prepare` step, each with:

- target agent id, action, resource, and proposed effect;
- the rationale and the report figures used;
- the winning-rule findings and the required placement relative to existing guards;
- the wildcard expansion;
- the path and redirect concerns.

That skill locates the editable native source, shows the exact ordered diff, and applies it only after the owner confirms that diff.
If sources or policy change before then, the prepared diff is invalid and needs a fresh `prepare`.
```

- [ ] **Step 3: Verify**

Docs-only change: `bun run typecheck` stays green; check `references/native-roles.md` for 1.x vocabulary (`permission kind`, `pattern`) and update those terms to `action`/`resource` without changing the role summaries. Review both rewritten files against the spec's review section: evidence insufficiency → no broader access; equivalence set limited to `skill`; `*` never counted as multiple independent approvals; the redirect caveat present verbatim.

- [ ] **Step 4: Commit**

```bash
git add skills/opencode-permission-optimizer
git commit -m "docs: recommend 2.x rules from history-split evidence"
```

## Changed-code audit

Not applicable — documentation-only change; state that explicitly. The documents name only glossary terms (action, resource, effect, history source, requested resource, URL-origin rule, webfetch requested-URL match).
