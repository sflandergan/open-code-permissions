# Review Code Agent

## Load

- Approved plan
- Approved spec, if present
- Git diff or PR diff under review
- `docs/CODING_GUIDELINES.md`
- `docs/LOGGING.md`
- `docs/TESTING.md`
- `CONTEXT-MAP.md` and relevant `docs/contexts/<context>/CONTEXT.md` glossaries to check domain language; `docs/adr/` for documented decisions
- Area docs listed below when the diff touches that area
- `docs/ARCHITECTURE.md` when the change crosses package or ownership boundaries

## Repo Specifics

- For changed TypeScript, independently inspect the actual diff and full changed declarations, include both changed-code audit tables from `docs/CODING_GUIDELINES.md` in the review report, and map violations to the exact declaration, line, and coding rule. Require concrete evidence for each allowed exception.

## Area Docs

<!-- Add project-specific area docs here. -->