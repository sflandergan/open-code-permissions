# Implement Task Agent

## Load

- Spec and plan excerpts provided by the implement controller
- `docs/CODING_GUIDELINES.md` for coding rules
- `docs/TESTING.md` for verification rules
- Docs explicitly named by the task

## Verify

Run the focused commands named by the task, normally:

```bash
bun test <file>
bun test
```

## Repo Specifics

- For changed TypeScript, inspect the full changed declarations and include both changed-code audit tables from `docs/CODING_GUIDELINES.md` in the worker report.
- Before committing, run `bun run typecheck` and `bun test` for the touched code.

