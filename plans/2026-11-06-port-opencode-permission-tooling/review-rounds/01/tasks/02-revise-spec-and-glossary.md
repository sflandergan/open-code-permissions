# Task 02: Revise the spec and plan, add the glossary and the path rule

**Objective:** Record the owner's review decisions in the spec and plan, create the root `CONTEXT.md` glossary, and add the `AbsolutePath` rule to the coding guide.

**Resolves:** U1, U4, U5, U6, F3 (spec part), F27, F30, F31 (rule part).

**Docs-only:** no workspace verification required (`AGENTS.md`).

**Files:**
- Modify: `plans/2026-11-06-port-opencode-permission-tooling/spec.md`
- Modify: `plans/2026-11-06-port-opencode-permission-tooling/plan.md`
- Create: `CONTEXT.md`
- Modify: `docs/CODING_GUIDELINES.md`

## Steps

- [ ] **Step 1: Spec — sibling dependency (U1, F3)**

In `spec.md`, replace the rule that each skill directory is self-contained (Separation rules section) with:

> Each published skill directory holds its own code; skills hold no plugin code and the plugin holds no skill code. Exception: `opencode-permission-optimizer` invokes the sibling `opencode-permissions` skill's `scripts/inspect.sh` at `../../opencode-permissions/`, so both skills must be installed side by side. The optimizer's wrappers exit non-zero with `error: opencode-permission-optimizer requires the opencode-permissions skill installed beside it (expected <path>)` when that script is missing. The repository-identity logic stays intentionally duplicated between the plugin and the optimizer skill.

Add the same exception sentence to the Global Constraints bullet in `plan.md` that says each skill directory is self-contained.

- [ ] **Step 2: Spec — schema version 4 (U5, F30)**

In `spec.md`:
- Non-goals: change "Changing what the plugin records, how the skills analyze permissions, or the database schema (version 3)." to "Changing what the plugin records or how the skills analyze permissions."
- Every "schema (version 3)" / "version 3" contract statement becomes version 4, and add: "Version 4 renames `observation_inputs` → `requested_patterns`, `exact_input` → `pattern`, `input_index` → `pattern_index`. The plugin migrates v1, v2 and v3 databases to v4 in one transaction, preserving every observation and requested pattern. The optimizer reader accepts only version 4."

Apply the same version and wording change to the matching Global Constraints and Non-goals bullets in `plan.md`.

- [ ] **Step 3: Plan — published-skill discovery (F27)**

In `plan.md`, replace "the published skills are named in a single file-level constant" with "published skills are discovered by scanning the top-level `skills/` directory (`PUBLISHED_SKILLS_DIRECTORY` in `scripts/mark-internal-skills.ts`)".

- [ ] **Step 4: Spec terminology pointer**

Replace the body of the spec's **Terminology** section with one sentence: "Domain terms are defined in the root `CONTEXT.md`."

- [ ] **Step 5: Create `CONTEXT.md` with the `domain-modeling` skill**

Invoke the `domain-modeling` skill and use it to write a root `CONTEXT.md` glossary containing exactly these terms and meanings (one entry each, plus OpenCode's own terms permission, rule, pattern, action, agent, session referenced as used by OpenCode):

| Term | Meaning |
|---|---|
| Observation | One persisted lifecycle of a permission request (asked, decision, completion), keyed by OpenCode's `request_id`. |
| Requested pattern | One pattern of a permission request, for example the Bash command `git status`. Stored in table `requested_patterns`, column `pattern`. |
| Observation origin | Repository identity, agent, message ID and tool call ID that tie an observation to where it came from; filled later when the asked event lacked them. |
| Permission decision history | Every requested pattern of an agent history with approvals, rejections, unresolved outcomes, distinct sessions, worktrees, first and last activity. |
| Agent history query | Repository identity, agent and closed UTC activity window that select observations. |
| Agent history aggregate | Everything counted for one agent history query: distinct observation, session, approval, rejection and unresolved IDs plus the pattern aggregates. |
| Pattern aggregate | Everything counted for one requested pattern inside one agent history aggregate. |
| Effective policy | The whole per-agent permission report resolved by the OpenCode runtime. |
| Effective rule | One resolved rule in runtime order with its origin. |
| Effective permission | A repository-declared permission rule that survives config-layer merging, with its override chain; matched to effective rules to find their origin. |
| Repository identity | Either the normalized `host/path` of the `origin` remote, or the absolute path of the Git common directory, or unknown. |
| Absolute path | A string proven absolute by `toAbsolutePath`, typed `AbsolutePath`. |
| Published skill | One of the two skills this repository ships from `skills/`. |
| Toolkit skill | Any skill under `.agents/skills/`, installed by `setup` and recorded in `skills-lock.json`. |
| Internal skill | A skill whose `SKILL.md` frontmatter sets `metadata.internal: true`. |

Add an "Avoid" note per term where an old word was replaced: Requested pattern (avoid "input", "exact input", "input evidence"); Observation origin (avoid "attribution"); Permission decision history (avoid "evidence report").

- [ ] **Step 6: Coding-guide rule (U6, F31)**

In `docs/CODING_GUIDELINES.md` → "Types and values", add:

> - Type path-valued strings as `AbsolutePath` (each area — plugin, each published skill — owns a small `absolute-path.ts` because areas share no code). Convert raw strings once at the boundary (CLI arguments, environment, Git or OpenCode output, plugin input) with `toAbsolutePath`, which throws for relative paths.

- [ ] **Step 7: Commit**

```bash
git add CONTEXT.md docs/CODING_GUIDELINES.md plans/2026-11-06-port-opencode-permission-tooling/spec.md plans/2026-11-06-port-opencode-permission-tooling/plan.md
git commit -m "docs: record review decisions, add the domain glossary and path rule"
```
