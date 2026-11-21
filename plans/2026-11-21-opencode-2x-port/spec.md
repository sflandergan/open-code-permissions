# Port the permission tooling to OpenCode 2.x

Issue: [#4 — Port to OpenCode 2.x](https://github.com/sflandergan/open-code-permissions/issues/4)

## Goal and scope

On OpenCode **2.x**, users can install the `permission-optimizer` plugin, inspect an agent's effective policy with `opencode-permissions`, review permission decision history with `opencode-permission-optimizer`, and apply a confirmed repository-owned rule edit with the copy-in `opencode-permissions` agent. Verify the full workflow on the explicit [v2.3.2 release](https://github.com/anomalyco/opencode/releases/tag/v2.3.2). Use native 2.x `action`, `resource`, and `effect` fields in new reports, recommendations, and edits. Include URL-origin rules for `webfetch` and retain usable 1.x history.

**Non-goals:** running this tooling release on the OpenCode 1.x binary; converting consumers' full configuration; managing OpenCode's separate `policies` statements or saved approvals; porting the toolkit's Mistral adapter; changing release automation. The recommendation skill remains advisory, and the recorder never grants, rejects, or changes a permission.

## Components and data flow

### Permission observation recording

Use the 2.x `@opencode/plugin` SDK and its default-export plugin definition, with one stable plugin ID and one implementation for repository-local and package installation. Subscribe to the location-aware event stream for `permission.asked` and `permission.replied`, and use the 2.x tool completion hook. Unsubscribe and close storage when the plugin unloads.

- Validate the 2.x event payload at the boundary. Store one observation per permission request, retaining the action, the ordered requested resources, the reply or unresolved outcome, completion, and observation origin. Correlate replies by request ID and tool-origin facts by matching session, message, and call identifiers as available. Use the tool hook's agent and the actual event location for observation origin; leave unresolved fields unknown rather than assigning another session's agent or the plugin's startup directory. Duplicate facts are idempotent, and incoming facts fill unknown fields only when they can be correlated reliably.
- Record `once`, `always`, and `reject` outcomes. Distinguish a direct reply from an automatic follow-on where the runtime evidence establishes that distinction. A bare `always` event may be direct or automatic; a bare `reject` may also come from shutdown. Keep ambiguous outcomes visible but do not count them as independent choices. A confirmed direct `always` can qualify on the same terms as `once`. Qualifying approval also requires successful completion, known repository identity, and a known agent. A background acknowledgment, missing result, or unknown shell exit is not proof of success; for a final shell result, zero is success and nonzero is failure.
- Persist only the validated observation fields needed for history. Do not store tool arguments, response content, raw payloads, or arbitrary metadata. The subscription and hook must report failures without interrupting OpenCode. A database that cannot be opened or migrated disables recording with an actionable diagnostic.

### Effective-policy inspection and confirmed edits

Use v2.3.2 `opencode debug agents` JSON as the authority for agent IDs and their ordered effective rules. Use repository declarations and the runtime's configuration diagnostics to identify rule origins where verifiable. Preserve rule order and duplicate entries. Follow OpenCode's matching semantics for both action and resource (last match wins); retain custom action names. Report the configured per-agent rules, with a clear boundary: session rules, saved approvals, and separate managed or organization `policies` can change the actual result of a request.

Invalid or unsupported runtime output fails inspection clearly; valid rules with unverified origins remain visible as unknown. Supported 1.x declarations that 2.x normalizes can still be inspected through the runtime. Never infer an editable source from an unsupported or ambiguous declaration. Write only to a verified repository-owned native 2.x policy source; when an edit would require converting a legacy block, direct the owner to migrate that block separately. The copy-in agent must use the native configuration and retain its existing self-protection and confirmation behavior.

Prepare an exact ordered diff and show the proposed scope and effect. If source or effective policy changes between preparation and application, invalidate the diff and prepare again. Apply only the confirmed diff, re-inspect using OpenCode, and report success only if the intended effective rules and order are verified. Surface any verification failure and identify the file changed. Preserve the skills' output-file workflow and keep inspection independent of the recorder.

### Permission decision review and `webfetch`

Read SQLite read-only, call the sibling inspector for effective policy, and show the current winning rules alongside the selected agent's history. Keep counts and provenance for legacy and 2.x observations distinguishable. When evidence, role guidance, or coverage is insufficient, show what is known and do not recommend broader access. The review skill writes no policy; the editing workflow receives only owner-selected recommendations.

In v1.19.5, the tool passed a URL to the permission evaluator, but the config schema accepted only a single effect for `webfetch`. In v2.3.2, the native rules accept URL resource patterns. A rule such as `https://docs.example.com/*` is a URL-origin rule, not a special domain permission. The tool can still propose `*` for **Allow always**; that is a saved-approval candidate, not the requested URL or evidence that other destinations were approved independently.

For URL-origin recommendations:

- Require successful, independent, qualifying 2.x approvals for at least two distinct requested URLs belonging to the same exact HTTP(S) URL origin. The agent's role must justify access to the broader origin. Use only a literal scheme and authority plus a slash-delimited wildcard, scoped to the scheme, hostname, and port supported by the evidence. Do not infer sibling hosts, subdomains, alternate schemes or ports. Withhold a suggestion if the observed URLs cannot be covered by such a pattern under the runtime's string matcher.
- State that an origin rule admits unobserved paths and queries on that origin. Preserve existing denies and narrower `ask` guards, accounting for effective rule order; a broad default `ask` may gain the specific exception being proposed. If scope, placement, or preservation of a guard cannot be verified, the suggestion remains advisory and is not eligible for application.
- Show the limitation of redirects: the built-in 2.x tool checks redirect targets for denies, but does not require a fresh `ask` approval for each redirect. An origin rule is not a guarantee that redirected requests stay on that origin. Do not imply that it can override a separate managed deny.

## Migration and rollout

Keep the existing database location and path override. In accordance with [ADR 0001](../../docs/adr/0001-plugin-owned-observation-schema.md), the plugin owns a transactional migration from schema 4 to 5 that preserves stored observations, timestamps, and requested values, and tags migrated history as 1.x. New observations are tagged as 2.x. The read-only skill accepts exactly schema 5 and reports the found and expected versions on mismatch, including what to update or start first. Failed migrations leave the old data unchanged. The existing retention window applies to both history sources.

Re-evaluate legacy resources against the current effective rules wherever a safe mapping exists; distinguish present-day coverage from evidence of an equivalent 2.x approval. For v2.3.2, the initial equivalence set is `skill` on the exact same skill identifier, provided that identifier still resolves to the same skill for the agent and the old observation is a qualifying approval. Unknown or custom actions, legacy `bash` observations, and legacy `webfetch` URLs remain visible as context; they do not qualify as evidence for a new 2.x `allow`. In particular, legacy webfetch history does not qualify toward a URL-origin recommendation.

Ship the plugin and both skills at the same repository release version. Document installation of the explicit v2.3.2 runtime rather than assuming that the default OpenCode channel selects 2.x, how to refresh the copy-in agent, the changed `external_directory` default and how to retain the earlier `ask` behavior, and the database upgrade. Document backing up the observation database before upgrading; rollback to the previous tooling revision uses that backup rather than downgrading the schema in place.

## Testing and acceptance

- **Hermetic tests:** Use captured v2.3.2 event and CLI fixtures and isolated SQLite databases. Cover input validation, origin and completion correlation, duplicate and out-of-order facts, observable versus ambiguous replies (including cascades), failed or incomplete shell calls, non-disruptive plugin failures, schema migration and rollback on error, and distinct legacy and 2.x evidence counts. Exercise report assembly across the SQLite and sibling-inspector boundaries.
- **Policy and URL fixtures:** Prove native rule order, wildcard precedence, unknown origin handling, rejection of invalid runtime data, and invalidation of a stale diff. Cover that a proposed URL-origin rule matches the supported scheme, host, and port but does not match lookalike hosts, subdomains, other schemes or ports. Verify that narrow guards remain effective, saved `*` never counts as multiple independent approvals, and a denied redirect differs from an `ask` redirect.
- **Pinned runtime smoke check:** Outside the normal hermetic suite, use an isolated project, configuration, and database with the explicit v2.3.2 runtime. Verify repository-local and packed-package plugin discovery; produce a real permission prompt with a successful tool completion and see it in decision history. In that project, confirm a URL-origin edit and re-inspect its effective order and origin. Use controlled local fixtures for fetches and redirects, with no personal state or public websites. Verify plugin cleanup and report the runtime version used.

## Open questions

None for the agreed scope.

## Upstream references

- [v2.3.2 config migration](https://github.com/anomalyco/opencode/blob/v2.3.2/services/site/src/docs/content/migrate-v1.mdx) and [plugin migration](https://github.com/anomalyco/opencode/blob/v2.3.2/services/site/src/docs/content/build/plugins/migrate-v1.mdx)
- [v2.3.2 permissions](https://github.com/anomalyco/opencode/blob/v2.3.2/services/site/src/docs/content/permissions.mdx), [permission implementation](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/permission.ts), and [agent inspection command](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/cli/src/commands/handlers/debug/agents.ts)
- [v1.19.5 permission config schema](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/permission.ts) and [v2.3.2 webfetch implementation](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/tool/plugin/webfetch.ts)
