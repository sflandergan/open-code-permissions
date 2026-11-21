# Upgrading the agentic coding toolkit

The skills CLI discovers skills in `skills/`, `.agents/skills/` and `.claude/skills/`. The two published skills (`opencode-permissions` and `opencode-permission-optimizer`) live in `skills/`. Every toolkit skill lives in `.agents/skills/` and is marked `metadata.internal: true`, so consumers are not offered the toolkit's own workflow skills. `scripts/mark-internal-skills.ts` applies that marker; the internal-skills guard test fails CI if it is missing.

Patching the `SKILL.md` files makes `setup` see modified content and ask, on each upgrade, whether to replace or retain the local content.

## During an upgrade

1. For every replace-or-retain prompt, choose **replace** so toolkit skill content stays current with its source. `setup` then installs the upstream content, which drops the `metadata.internal` marker.
2. After `setup` finishes, run `bun run mark-internal-skills` from the repository root to re-apply the marker to every skill under `.agents/skills/`. It is idempotent and never touches `skills/`.
3. Run `bun test ./.opencode ./skills ./scripts ./test` (or `bun run test`) to confirm the internal-skills guard and the rest of the suite still pass.
4. Commit the upgraded skill files together with the re-applied markers.

Do not choose retain: keeping a stale local copy pins the toolkit skill to an older release while its `skills-lock.json` entry advances. Do not add `metadata.internal: true` to any skill under `skills/`; the published skills must stay discoverable.

Upstream support in `agentic-coding-next` for marking installed skills internal would retire `mark-internal-skills`; that follow-up is tracked separately.
