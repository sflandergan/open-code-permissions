# Coding Guidelines

Read this guide when planning, implementing, or reviewing TypeScript changes. Testing rules live in [TESTING.md](./TESTING.md).

## Language and tooling

- All code is TypeScript with `strict` enabled; do not weaken compiler options to make a change pass.
- Bun is the runtime, package manager, and test runner.
- Skill scripts are `.ts` files; shell wrappers only start them with `bun <script>.ts`.

## Types and values

- Use `unknown` rather than `any` for untrusted values (parsed JSON, config files, CLI output, plugin events) and narrow it at the boundary.
- Prefer named exports and `as const` objects over TypeScript enums.

## Names and files

- All files and directories use `kebab-case`. Types use `PascalCase`; values and functions use `camelCase`; database identifiers use `snake_case`.
- Keep one class per file and keep public barrel exports limited to stable module APIs.
- Name things for what they represent, not how they are implemented; use domain names instead of generic names such as `Data`, `Item`, `Result`, or `Row`.
- Use OpenCode's own terms for its concepts (permission, rule, pattern, action, agent, session) and keep them consistent between code, tests, and docs.
- Name technical mechanics by their effect in the platform's own vocabulary (SQL, filesystem, process), for example `readObservations` rather than `loadPermissionStateForSummary`.
- Use `close*` for releasing handles; reserve `destroy*` for destructive cleanup.
- Keep file-level constants at the top of the file, before the exports and types that use them — never next to the function that happens to use them.

## Function shape

- Keep a function-like body at one abstraction level; orchestration delegates implementation steps to named helpers.
- Prefer small, composable functions and straightforward abstractions that are easy to follow and debug.
- Prefer functions that return data over functions that mutate their inputs; use `find*` and `build*` names when a helper computes a value.
- More than 40 physical lines triggers mandatory decomposition review for functions, methods, callbacks, and arrow functions.
- A body may remain over 40 lines only when a concrete declarative or intrinsically sequential readability reason makes extraction worse.
- Do not compress formatting or remove useful whitespace to evade the review.
- When touching a file, fix small nearby code-shape problems proportionally; separate substantial cleanup from the task change.

## Errors

- Never swallow errors silently; propagate or log failures with enough context to identify the operation, target, and relevant identifiers.
- A plugin hook must not break the host: catch at the hook boundary, report the failure with context, and let OpenCode continue.

## Comments and JSDoc

- Inline comments document non-obvious constraints, invariants, compatibility, security, privacy, or trade-offs that the code cannot express.
- Do not use separator banners, section labels, code restatements, numbered-step narration, attribution, or date stamps.
- Never cite a plan task, plan phase, or `plans/` path in a comment or JSDoc; state the constraint itself.
- Treat a comment summarizing the following block as a prompt to extract a named helper unless the block is already short and self-evident.
- Every exported declaration has JSDoc that states its contract: what it represents or does and, where they exist, hidden invariants, lifecycle effects, error semantics, serialization rules, and security constraints. The rule applies to declarations a change adds or modifies.
- Do not add filler `@param` text, restate types, or expose implementation details.

## Changed-code audit

For changed TypeScript, audit compliance with this guide using two evidence tables:

- **Exported declarations:** for every changed exported declaration, record its file and line range, contract purpose, hidden invariants/lifecycle effects/error semantics/serialization rules, and the JSDoc location.
- **Long bodies:** for every changed function-like body over 40 physical lines, including functions, methods, callbacks, arrow functions, and tests, record the declaration and complete body bounds plus either the decomposition made or a specific declarative/intrinsically sequential readability reason extraction would harm.

If a table has no applicable declarations, state that explicitly. Use both tables as completion evidence; JSDoc states the contract without filler tags.
