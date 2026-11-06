# Implement Agent

## Load

- Approved plan
- Approved spec, if present
- `docs/CODING_GUIDELINES.md` for coding rules
- `docs/TESTING.md` for verification rules
- Docs explicitly named by the plan

## Verify

```bash
bun run typecheck
bun test
```

## Repo Specifics

- For changed TypeScript, compare the worker's changed-code audit tables (see `docs/CODING_GUIDELINES.md`) against the actual diff and full changed declarations before accepting the report as DONE. For inline implementation, produce and check the same evidence.

<!-- TODO: Replace with repository-specific implementation configuration, such as:
     directories the worker may write to during implementation. -->