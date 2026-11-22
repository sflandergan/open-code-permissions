# OpenCode 2.x port implementation plan

**Goal:** Run the checkout and published permission tools on OpenCode v2.3.2, preserving history and policy protections. See the [approved spec](spec.md).

**Architecture:** The recorder owns schema 5. The optimizer reads it read-only and invokes the inspector through its CLI. The inspector uses ordered runtime policy and verifies native rule origins against source declarations. Production code never imports across the plugin, skills, or `scripts/` boundaries.

**Stack:** Strict TypeScript, Bun, SQLite, `@opencode/plugin@2.3.2` pinned in development; the v2 host provides the SDK to installed plugins. Target the [v2.3.2 tag](https://github.com/anomalyco/opencode/tree/v2.3.2) for API and fixture evidence.

## Execution and verification

Read [testing](../../docs/TESTING.md), [coding guidelines](../../docs/CODING_GUIDELINES.md), [ADR 0001](../../docs/adr/0001-plugin-owned-observation-schema.md), [domain language](../../CONTEXT.md), and [workflow boundaries](../../docs/agents/agent-workflow-extension.md). Use the [upstream migration guide](https://github.com/anomalyco/opencode/blob/v2.3.2/services/site/src/docs/content/migrate-v1.mdx) for native config conversion. Work on a scoped branch. Use one commit per task in order; do not publish intermediate commits as a release. Each behavior change starts with the owning test and a focused failing run. After the final task change rerun its focused gate, `bun run typecheck`, and `bun run test` before committing. For changed TypeScript attach the exported-declaration and long-body audit tables to the task report. Stage only assigned paths; confirm staged scope with `git diff --cached --name-only`. Preserve the existing user-owned glossary changes; reconcile lasting terminology via `/finish`.

## Tasks

| # | Task | Objective | Primary files | Focused verification |
|---|---|---|---|---|
| 01 | [Storage and reader schema](tasks/01-plugin-storage-schema-5.md) | Ship one compatible schema transition | Plugin SQLite, optimizer reader, cross-area contract | `bun test ./.opencode ./skills/opencode-permission-optimizer ./test` |
| 02 | [Validate the v2 stream](tasks/02-plugin-adapter-2x-stream.md) | Add an independent v2 adapter before switching entry points | Plugin event adapter and fixtures | `bun test .opencode/plugins/permission-optimizer/test/event-adapter.test.ts` |
| 03 | [Record v2 lifecycles](tasks/03-plugin-correlator-and-entry.md) | Switch the recorder and package entry together | Plugin, root package and pack check | `bun test ./.opencode ./scripts && bun run check-package` |
| 04 | [Expose approval evidence](tasks/04-optimizer-reader-schema-5.md) | Separate shown outcomes from qualifying evidence by major version | Optimizer history, report, contract | `bun test ./skills/opencode-permission-optimizer ./test` |
| 05 | [Inspect native policy](tasks/05-inspector-2x-runtime-port.md) | Inspect ordered effective rules with verified source origins | Inspector runtime and sibling CLI consumer | `bun test ./skills/opencode-permissions ./skills/opencode-permission-optimizer` |
| 06 | [Match webfetch scopes](tasks/06-optimizer-report-and-webfetch.md) | Group successful `once` URLs by safe scope | URL matcher, report and tenant reference | `bun test ./skills/opencode-permission-optimizer ./test` |
| 07 | [Guard confirmed edits](tasks/07-permissions-skill-and-references.md) | Apply only a current confirmed native diff | Inspector skill and references | Workflow scenarios described in task |
| 08 | [Present policy recommendations](tasks/08-optimizer-skill-and-references.md) | Explain evidence, shell variants, and URL limits | Optimizer skill and references | Workflow scenarios described in task |
| 09 | [Cut over the checkout](tasks/09-agent-native-permissions-frontmatter.md) | Convert repository config and agents; remove Mistral adapter | `opencode.json`, `.opencode/`, toolkit state, package locks | `bun run test && bun run check-package`, pinned runtime inventory |
| 10 | [Run the pinned smoke](tasks/10-pinned-runtime-smoke-check.md) | Verify checkout and both install routes with the real runtime | `scripts/smoke/`, recorder README | Recorded acceptance on v2.3.2 |
| 11 | [Document rollout](tasks/11-rollout-and-install-docs.md) | Document install, refresh, backup and rollback | Root and area READMEs, feature maps | `bun run typecheck && bun run test && bun run check-package` |
