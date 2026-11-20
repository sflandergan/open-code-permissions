# Task 09: Optimizer skill documentation

**Objective:** Make the optimizer workflow steps precise, split recommending from applying, and move the generic policy-source guidance from the repository guide into the skill's own reference.

**Resolves:** R27, R28, R37, R38, R39, R40, R41, R42, U3 (findings F11, F12).

**Depends on:** Task 08 (script is named `agent-permission-report.sh`).

**Docs-only:** no workspace verification required. Before committing, read the complete final content of every changed file and apply the documentation quality gate: every sentence imposes a necessary rule, explains a necessary constraint, or gives executable information; no duplication, contradiction or stale instruction; no vague qualifier without actor, trigger, action and evidence.

**Files:**
- Modify: `skills/opencode-permission-optimizer/SKILL.md`
- Modify: `skills/opencode-permission-optimizer/references/opencode-permission-model.md`
- Modify: `skills/opencode-permission-optimizer/README.md` (drop any mention of the repository guide; use "agent permission report")
- Delete (`git rm`): `docs/agents/opencode-permission-optimizer.md`
- Check: `.opencode/agents/opencode-permissions.md` and `README.md` for references to the deleted guide (`git grep -n "opencode-permission-optimizer.md"`); remove them.

**Glossary:** *Requested pattern*, *Permission decision history* — see `CONTEXT.md` (created in Task 02).

## Steps

- [ ] **Step 1: Frontmatter and intro** — description becomes: "Recommend OpenCode permission rules for one agent from its recorded permission decisions; recommendations are applied only through the opencode-permissions skill." Remove `SKILL.md:30` (the "Read `docs/agents/opencode-permission-optimizer.md` when present" sentence). Rename "evidence summary" to "agent permission report" in the Commands section and use `scripts/agent-permission-report.sh`.

- [ ] **Step 2: Reference file (R27, R28, U3)** — in `references/opencode-permission-model.md`, replace line 4 ("Repository-specific policy values are not kept here; …") with: "Policy values differ per repository; read the selected agent's rules from the exported effective policy rather than assuming them." Add a section `## Policy sources` containing the three source bullets from the deleted guide (shared `permission` in `opencode.json`/`opencode.jsonc`; `agent.<name>.permission`; `permission:` frontmatter of `.opencode/agents/<name>.md`) and its role-guidance Load bullet (custom agent file, referenced skills and their referenced files, applicable `AGENTS.md`). Drop the sentence about the management workflow editing sources (SKILL.md already states it).

- [ ] **Step 3: Split the workflow (R40)** into two headings.

  `## Recommend`
  1. (R37) "Run `list-agents.sh` and read its output file. When the owner's request names exactly one agent that appears in the list, use it; otherwise ask the owner to choose one agent from the list. Never guess or broaden a name."
  2. "Run `agent-permission-report.sh --agent <agent>`, read the complete report, and read the agent's role guidance (`references/native-roles.md` for a native agent; the policy sources and role guidance listed in `references/opencode-permission-model.md` for a custom agent)."
  3. (R38) "Use the report's requested patterns, counts, timestamps, sessions and worktrees only to find which operations the agent repeatedly needed and how recently. Never derive a recommendation's action from counts alone; the action comes from role fit, authority classification and path analysis in steps 5–8."
  4. Keep "Group requested patterns by semantic operation …" (old step 4, with "inputs" → "requested patterns").
  5. Keep old step 5.
  6. Keep old step 6 with "input" → "requested pattern".
  7. (R39) "When you do not know what a command does, ask the owner what it does and why the agent runs it before recommending. If the answer leaves the effect uncertain, recommend `ask` and state the open question; do not recommend `deny` for an ordinary command only because it is unfamiliar."
  8. Keep old step 8.
  9. "Present the report labelled `Policy recommendations (not yet applied)` and ask the owner which recommendations to pursue."

  `## Apply through opencode-permissions`
  1. "Pass only the owner-selected recommendations to the `opencode-permissions` skill's `prepare` step, with target agent, permission, pattern, proposed action, rationale, the report figures used, winning-rule findings, wildcard expansion, and path or redirect concerns."
  2. "That skill locates the editable source, shows the exact ordered diff, and applies it only after the owner confirms that diff; this skill edits nothing."
  3. (R41) Delete old step 12; its meaning ("selecting a recommendation is not approval to edit") is covered by item 2.

- [ ] **Step 4: Authority classification (R42)** — in the Definitions bullet, give one example per class: `local read` (`git status`), `local write` (`git add`), `destructive` (`rm -rf build`), `code-executing` (`bun test`, `npm run …`), `network read` (`git fetch`), `external mutation` (`git push`, `gh pr create`). In the Wildcards section, change the first sentence to: "For every proposed `allow`, choose the broadest wildcard that admits no command with an authority classification the observed operation lacks (for example, `git *` would add `git push`'s external mutation to `git status`'s local read) and crosses no unapproved path boundary; then list the materially different command forms and targets it newly admits."

- [ ] **Step 5: Failures section** — replace "exporter" with "the optimizer reader"; keep the rest.

- [ ] **Step 6: Quality gate and commit** — read the full final `SKILL.md`, reference and README; fix any duplication with the reference. Then `git commit -am "docs: make optimizer workflow steps precise and move policy sources into the skill"` (after `git rm` of the guide).
