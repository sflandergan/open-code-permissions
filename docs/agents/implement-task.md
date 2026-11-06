# Implement Task Agent

## Load

- Spec and plan excerpts provided by the implement controller
- `docs/CODING_GUIDELINES.md` for coding rules
- `docs/TESTING.md` for verification rules
- `docs/agents/changed-code-audit.md`
- Docs explicitly named by the task

## Verify

Run the focused commands named by the task, normally:

```bash
bun test <file>
bun test
```

## Repo Specifics

- For changed TypeScript, apply the worker responsibilities in [Changed-code Audit](./changed-code-audit.md#responsibilities).
- Before committing, run `bun run typecheck` and `bun test` for the touched code.

