# Implement Agent

## Load

- Approved plan
- Approved spec, if present
- `docs/CODING_GUIDELINES.md` for coding rules
- `docs/TESTING.md` for verification rules
- `docs/agents/changed-code-audit.md`
- Docs explicitly named by the plan

## Verify

```bash
bun run typecheck
bun test
```

## Repo Specifics

- For changed TypeScript, apply the controller responsibilities in [Changed-code Audit](./changed-code-audit.md#responsibilities).

<!-- TODO: Replace with repository-specific implementation configuration, such as:
     directories the worker may write to during implementation. -->