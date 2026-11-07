# OpenCode Permission Optimizer — Repository Guide

## Load

- For the selected custom agent: `.opencode/agents/<name>.md`, every skill it references with its `SKILL.md`, every file each `SKILL.md` references, and every applicable `AGENTS.md` (repository root and nested).
- Record the sources found and any required source that is missing; stop recommendations for new authority when required role guidance is missing.

## Policy sources

- Repository-shared permissions: the `permission` section of `opencode.json` and `opencode.jsonc`.
- Root-config agent permissions: `agent.<name>.permission` in `opencode.json` / `opencode.jsonc`.
- Agent-file permissions: the `permission:` frontmatter of `.opencode/agents/<name>.md`.
- All sources are read-only during advisory review; only the `opencode-permissions` management workflow edits them after exact-diff confirmation.
