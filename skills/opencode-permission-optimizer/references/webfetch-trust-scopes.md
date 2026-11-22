# Webfetch Trust Scopes

The optimizer groups successful `webfetch` evidence only into the scopes this page defines. Every match still passes to the advisory workflow, which checks role, intent, and ordered rules; a scope match alone is evidence, not a recommendation.

## Evidence that can qualify

- Only `action === "webfetch"` resources with a successful current-runtime `once` approval enter the requested URL set. An `allow always` save, a rejection, or an unresolved request never justifies a rule.
- A saved wildcard approval (`*`) never counts as a URL and never enters the set.
- A scope is proposed only when at least two distinct recorded URLs (after fragment removal) qualify inside it.

## What a proposed pattern must cover

The exact recorded URL text — not a normalized rewriting of it — must match the proposed pattern under OpenCode's own wildcard matcher (the `Wildcard.match` implementation pinned to the supported runtime in `packages/core/src/util/wildcard.ts`). Consequences:

- A record like `https://EXAMPLE.test/docs` does not support `https://example.test/*`, because the matcher compares case-sensitively outside Windows and the recorded spelling cannot match.
- A record like `https://example.test:443/docs` does not support `https://example.test/*`, because the pattern requires a `/` where the record carries `:443/`.
- A bare origin text like `https://example.test` does not support `https://example.test/*` for the same reason; only spellings the rule would actually cover count.

The literal scope portion of a proposed pattern never contains wildcard metacharacters (`*`, `?`) or backslashes.

## Ordinary hosts: exact origin

For every HTTP(S) host that is neither GitHub nor a suppressed multi-tenant host, evidence groups by the exact origin:

- Pattern: `scheme://host[:port]/*`, for example `https://example.test/*` or `http://localhost:8080/*`.
- Scheme and port are part of the scope: `http://` evidence never supports an `https://` rule, and a spelled-out default port (`https://example.test:443`) never matches the port-free spelling.
- Credentials in a recorded URL (any `user:password@` form) disqualify it entirely; only credential-free URLs qualify.

This is a full-path rule within one origin: it admits every new path and query on that host. The workflow must state that breadth and require the owner's justification.

## GitHub: exact owner namespace

On public GitHub the supported boundary is narrower than the host. Evidence qualifies only when the recorded URL text:

1. starts with the exact canonical prefix `https://github.com/` — lowercase, no port, no credentials; any other spelling (uppercase host, `www.`, subdomains such as `api.github.com`, explicit port) is treated as an ordinary origin instead, and single-segment or otherwise nonconforming `github.com` paths never fall back to a host-wide rule;
2. continues with a path that starts with two nonempty literal segments, for example `/octocat/Hello-World`;
3. names an owner slug as the first segment: a lowercase alphanumeric name of 1–39 characters where single hyphens separate the alphanumerics, with no leading or trailing hyphen;
4. carries no backslashes, no percent-encoded separators (`%2F`, `%5C`), and no dot segments (`.` or `..`) anywhere in the path; and
5. does not start with a reserved site-wide segment: `about`, `apps`, `collections`, `enterprise`, `events`, `explore`, `features`, `issues`, `login`, `marketplace`, `new`, `notifications`, `orgs`, `pricing`, `pulls`, `search`, `security`, `settings`, `signup`, `sponsors`, `topics`, `trending`.

The proposed pattern is `https://github.com/<owner>/*`, for example `https://github.com/octocat/*`.

An owner-shaped first segment is only a syntactic candidate. A reserved word is not an owner, and the workflow must positively establish that the matched segment identifies the owner the requests were aimed at before proposing the rule.

## Multi-tenant hosts without a supported boundary

Origin matches are suppressed for the following well-known multi-tenant hosts, because an origin-wide allow there admits every tenant and no narrower standard boundary is recognized:

- `gitlab.com`
- `bitbucket.org`
- `codeberg.org`

Two qualified URL approvals inside one of these hosts still produce no pattern. The workflow applies the same withholding whenever it recognizes another host whose tenants share one origin; extensible coverage for additional hosts is added here, not by proposing broader rules.

## Redirects

A URL rule does not confine HTTP redirects to its scope. The workflow checks a proposed rule against deny rules for redirect targets and states the redirect limitation to the owner; redirects do not trigger a fresh ask at each hop.
