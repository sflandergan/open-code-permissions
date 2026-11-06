# AGENTS.md

This file is the minimal entry point for AI agents working in this repository. Keep it short because AI agents load it for every session.

## Project Context

This repository provides TypeScript tooling for managing OpenCode permissions: agent skills that inspect and edit permission policy, and an OpenCode plugin that records permission observations. Maintainers and agents use it to keep OpenCode permission rules reviewed and minimal. Skills live under `.agents/skills/`; OpenCode plugins and agents live under `.opencode/`.

## Always Follow

- Work on a scoped branch, never directly on `main`.
- Do not revert, overwrite, or clean up changes you did not make unless the user explicitly asks.
- Prefer the smallest correct change over broad refactors.
- Prefer `git rm` over raw `rm` for tracked files.
- Workers edit only the files their task or role assigns; controllers own dispatch and acceptance.
- When a skill or role document tells you to dispatch the Explore subagent, treat that as the user's explicit request to use it.
- Write all code in TypeScript with `strict` enabled.
- Bun is the runtime, package manager, and test runner: `bun install`, `bun run <script>`, `bun test`.
- Skill scripts are `.ts` files that shell wrappers start with `bun <script>.ts`.
- Throwaway work goes in `.temp/` at the repository root (gitignored); clean up after use.

## Git Conventions

- Branches use `feature/`, `fix/`, or `chore/` prefixes with short kebab-case descriptions.
- Commits are concise, imperative, and focused on why.
- Keep commits scoped to one logical change.
- Do not add `Co-Authored-By` lines.

## Issue Tracking

Issues live in GitHub at `sflandergan/open-code-permissions`. Read them with `gh issue view <number>` and `gh issue list`.

## Verification Baseline

- Docs-only or comment-only changes need no workspace verification.
- Code changes run `bun run typecheck` (`tsc --noEmit`) and `bun test` before handoff.
- Define both as scripts in the root `package.json`.
- If the user requests narrower verification, follow that request and state what was not run.

## Permissions

- Do not delete branches or remove worktrees.
- Use the `git-publish` skill for branch publication instead of invoking `git push` directly.

## Extending the Toolkit

To add a new stack overlay (e.g. Gradle, Go, Cargo):

1. Create `stacks/<name>/` with `AGENTS.md`, `opencode.json`, `claude/settings.json`, and `docs/agents/<role>.md` additions for the affected roles.
2. Update `scripts/init.sh` and `scripts/copy.sh` to include the new stack in their stack selection prompt.
3. Document the stack in the top-level `README.md`.
