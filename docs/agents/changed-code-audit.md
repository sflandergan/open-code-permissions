# Changed-code Audit

For changed TypeScript, audit compliance with [the coding guidelines](../CODING_GUIDELINES.md) using two evidence tables:

- For every changed exported declaration, record its file and line range, contract purpose, hidden invariants/lifecycle effects/error semantics/serialization rules, and the JSDoc location.
- For every changed function-like body over 40 physical lines, including functions, methods, callbacks, arrow functions, and tests, record the declaration and complete body bounds plus either the decomposition made or a specific declarative/intrinsically sequential readability reason extraction would harm.

If a table has no applicable declarations, state that explicitly. Use both tables as completion evidence; JSDoc states the contract without filler tags.

## Responsibilities

- `implement-task`: inspect the full changed declarations and include both tables in the worker report.
- `implement`: compare the worker's tables against the actual diff and full changed declarations before accepting the report as DONE. For inline implementation, produce and check the same evidence.
- `review-code`: independently inspect the actual diff and full changed declarations, include both tables in the review report, and map violations to the exact declaration, line, and coding rule. Require concrete evidence for each allowed exception.
