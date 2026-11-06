# Testing

## Commands

- `bun test` runs the whole suite; `bun test <file>` runs one file. Prefer a focused file or directory while iterating.
- `bun run typecheck` (`tsc --noEmit`) is part of the completion gate alongside `bun test`.
- Tests import from `bun:test` (`describe`, `it`, `expect`, `mock`).

## Layout

- Tests live in a `test/` directory beside the code they cover (for example `.opencode/plugins/<plugin>/test/` or `.agents/skills/<skill>/scripts/test/`), mirror the source structure, and are named `*.test.ts`.
- Shared fixtures and helpers live under that `test/` directory (`test/fixtures/`, `test/helpers/`) and stay out of production exports.

## Rules

- Use TDD for behavior changes.
  For behavior-preserving test consolidation, run the affected tests before and after the change and record the results and retained coverage; no new failing test is required.
- Test each behavior at its lowest suitable owning layer.
  Higher-layer tests must add distinct composition, storage, process, or runtime protection; use representative cases rather than replaying lower-layer permutations.
  Repeated expected values are not duplication when they prove different boundary behavior.
- Plans and reviews apply that rule to both missing protection and redundant coverage.
  For a higher-layer addition, name the additional failure mode; for a deletion, identify the retained protection.
- Each test creates and seeds its own state; no test depends on another test or on execution order.
- Never depend on the developer's real OpenCode configuration, state directory, or database.
  Use temporary directories, in-memory or temporary SQLite databases, and fixtures; clean them up in the test.
- Unit-test pure parsing, matching, normalization, policy evaluation, and summarization with inline or captured fixture data.
- Cover storage behavior (queries, constraints, migrations, transactions) against a real SQLite database with independent migrated state per test; do not mock the database in those tests.
- Mock only what the test cannot control: the OpenCode runtime or CLI, the clock, and the network. Captured CLI output belongs in fixtures. Never depend on a live OpenCode installation or the network in the normal suite.
- Assert concrete values, shapes, and counts when the input is known.
  Existence-only and negative-only assertions are secondary guards, not the main proof.
- Test externally visible behavior rather than logger calls, configuration branches, or implementation details.
- Do not add tests that restate a single edit to tracked data such as a fixture value or copy text; tracked data is reviewed in its source file, and tests protect the rules and invariants every entry must satisfy.

## Test names

- Name tests for the current observable behavior and expected outcome, stating the triggering situation and the result (for example, “reports an allow rule as unused when no observation matches it”).
- Do not describe the history of a change or compare with an earlier implementation (“now”, “still”, “unchanged”, “replaces the old”).
- Prefer concrete domain language over vague verbs such as “keeps” or “handles” when the event and expected state are not stated.
- Keep fixture values, paths, and arbitrary numbers in the arrange and assert code, not in the name; a value belongs in a name only when it is itself the rule.
- Do not put code identifiers (function, field, or type names), internal working terms, or technique words (“round-trips”, “serializes”, “derives”) in test names unless the identifier is itself the externally visible contract under test.
- A `describe` block may name the unit under test.
