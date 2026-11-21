# Task 10 — Pinned v2.3.2 runtime smoke check

## Objective

Ship and run the human-assisted smoke check for the ported tooling on the explicit v2.3.2 runtime in an isolated project, configuration, and database: repository-local and packed-package plugin discovery, a real permission prompt with a successful tool completion visible in decision history, a confirmed URL-origin edit re-inspected for order and origin, and local-only fetch and redirect fixtures.

## Files

- Create: `scripts/smoke/local-web-server.ts`
- Create: `scripts/smoke/v2-runtime.sh` (executable; runbook driver)
- Create: `scripts/smoke/verify-database.ts`
- Modify: `.opencode/plugins/permission-optimizer/README.md` (add the `Pinned runtime smoke check` section pointing at `scripts/smoke/v2-runtime.sh` and prerequisites)

## Interfaces

- Consumes: tasks 01–03's plugin (directory entry, schema 5), tasks 05–07's inspector and report workflows.
- Produces: the smoke record — the executed runbook's output is appended to the task report (runtime version printed, each checklist item PASS, and any deviation noted); nothing else consumes these scripts (they are deliberately outside `bun test`).

## Verified environment facts

The pinned install command is `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.2`; it installs to `~/.opencode/bin/opencode` (this machine's default `opencode` on PATH is 1.19.6, so the smoke invokes the pinned binary by exact path and prepends `$HOME/.opencode/bin` to PATH for the inspector scripts). `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` isolates the database; the isolated project's own `opencode.json` plus its `.opencode/plugins/permission-optimizer/` directory isolate configuration and discovery; fetches and redirects hit only `127.0.0.1`. The interactive permission prompt needs the developer's real model credentials (global config), which the smoke never inspects or modifies.

- [ ] **Step 1: Write the smoke scripts**

(a) `scripts/smoke/local-web-server.ts` (complete new content):

```ts
#!/usr/bin/env bun
/**
 * Local-only HTTP fixtures for the pinned runtime smoke check. Serves a
 * documented page, a deny-target page, and redirects between them; never
 * binds beyond loopback.
 */
const port = Number(process.argv[2] ?? 4317)
let servedRedirects = 0
Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === "/documented") {
      return new Response("fixture document body\n", { headers: { "content-type": "text/plain" } })
    }
    if (pathname === "/redirect-to-documented") {
      servedRedirects++
      return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${port}/documented` } })
    }
    if (pathname === "/redirect-to-denied") {
      servedRedirects++
      return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${port}/denied-page` } })
    }
    if (pathname === "/denied-page") {
      return new Response("denied fixture body\n", { headers: { "content-type": "text/plain" } })
    }
    return new Response("not found\n", { status: 404 })
  },
})
process.stdout.write(`smoke web fixtures listening on http://127.0.0.1:${port}\n`)
setInterval(() => process.stdout.write(`redirects served: ${servedRedirects}\n`), 10_000)
```

(b) `scripts/smoke/verify-database.ts` (complete new content):

```ts
#!/usr/bin/env bun
/**
 * Asserts the smoke session's observable outcomes in the isolated
 * observation database. Exits nonzero on the first unmet expectation.
 */
import { Database } from "bun:sqlite"

const USAGE = "usage: verify-database.ts <database-path> <fixture-origin>"
const [databasePath, fixtureOrigin] = process.argv.slice(2)
if (databasePath === undefined || fixtureOrigin === undefined) {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 1
} else {
  const db = new Database(databasePath, { readonly: true })
  const fail = (message: string): never => {
    process.stderr.write(`FAIL: ${message}\n`)
    db.close()
    process.exit(1)
  }
  const schemaVersion = (db.query("SELECT version FROM schema_metadata WHERE id = 1").get() as { version: number }).version
  if (schemaVersion !== 5) fail(`expected schema 5, found ${schemaVersion}`)
  const approvedShell = db
    .query("SELECT COUNT(*) AS cnt FROM observations WHERE decision IN ('once','always') AND execution = 'success' AND tool = 'shell' AND history_source = '2.x'")
    .get() as { cnt: number }
  if (approvedShell.cnt === 0) fail("no qualifying 2.x shell approval was recorded")
  process.stdout.write(`PASS: ${approvedShell.cnt} qualifying 2.x shell approval(s) recorded\n`)
  const webfetch = db
    .query("SELECT COUNT(*) AS cnt FROM requested_resources WHERE resource = ?")
    .get(`${fixtureOrigin}/documented`) as { cnt: number }
  if (webfetch.cnt === 0) fail(`no requested URL recorded for ${fixtureOrigin}/documented`)
  process.stdout.write(`PASS: ${fixtureOrigin}/documented recorded as a requested resource\n`)
  db.close()
  process.stdout.write("PASS: all database expectations met\n")
}
```

(c) `scripts/smoke/v2-runtime.sh` (complete new content; `chmod +x`):

```bash
#!/usr/bin/env bash
# Pinned-runtime smoke check for the OpenCode 2.x port. Human-assisted:
# `setup` prints the interactive checklist after preparing the isolated
# world; `verify` asserts the recorded outcomes; `teardown` removes them.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
pinned_opencode="${HOME}/.opencode/bin/opencode"
smoke_root="${TMPDIR:-/tmp}/opencode-permissions/smoke"
project_dir="${smoke_root}/project"
database_path="${smoke_root}/observations.sqlite"
env_file="${smoke_root}/env"
fixture_port=4317
fixture_origin="http://127.0.0.1:${fixture_port}"

command_pinned_runtime() {
  if [ ! -x "${pinned_opencode}" ] || ! "${pinned_opencode}" --version | grep -q "2\.3\.2"; then
    printf 'error: pinned OpenCode 2.3.2 not found at %s\n' "${pinned_opencode}" >&2
    printf 'install it with: curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.2\n' >&2
    exit 1
  fi
  printf 'runtime: %s (%s)\n' "$("${pinned_opencode}" --version)" "${pinned_opencode}"
}

write_project_config() {
  mkdir -p "${project_dir}/.opencode"
  cat >"${project_dir}/opencode.json" <<EOF
{
  "permissions": [
    { "action": "shell", "resource": "echo *", "effect": "ask" },
    { "action": "webfetch", "resource": "${fixture_origin}/documented", "effect": "ask" },
    { "action": "webfetch", "resource": "${fixture_origin}/*", "effect": "ask" },
    { "action": "webfetch", "resource": "${fixture_origin}/denied-page", "effect": "deny" },
    { "action": "webfetch", "resource": "${fixture_origin}/redirect-to-denied", "effect": "allow" },
    { "action": "external_directory", "resource": "*", "effect": "ask" }
  ]
}
EOF
}

case "${1:-}" in
  setup)
    command_pinned_runtime
    rm -rf "${smoke_root}"
    mkdir -p "${project_dir}"
    cp -R "${repo_root}/.opencode/plugins/permission-optimizer" "${project_dir}/.opencode/"
    rm -rf "${project_dir}/.opencode/permission-optimizer/test"
    write_project_config
    git -C "${project_dir}" init -q
    git -C "${project_dir}" add opencode.json .opencode
    git -C "${project_dir}" -c user.email=smoke@example.com -c user.name=smoke commit -qm "smoke baseline"
    cat >"${env_file}" <<EOF
export OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH=${database_path}
export PATH=${HOME}/.opencode/bin:\$PATH
EOF
    printf 'isolated project ready: %s\n' "${project_dir}"
    printf 'isolated database:      %s\n' "${database_path}"
    printf 'web fixtures origin:   %s\n' "${fixture_origin}"
    printf '\nRun, from a second terminal:\n'
    printf '  bun %s %s   # start the local fixtures\n' "${script_dir}/local-web-server.ts" "${fixture_port}"
    printf '  source %s\n' "${env_file}"
    printf '  cd %s\n' "${project_dir}"
    printf '  %s   # pinned runtime, interactive session\n' "${pinned_opencode}"
    printf '\nInteractive checklist (answer prompts as the owner):\n'
    printf '  1. run the shell command: echo smoke-ok        -> approve the ask once\n'
    printf '  2. fetch %s/documented              -> approve once\n' "${fixture_origin}"
    printf '  3. fetch %s/redirect-to-documented   -> approved without a fresh ask, then fetched\n' "${fixture_origin}"
    printf '  4. fetch %s/redirect-to-denied       -> denied by the deny rule on the redirect target\n' "${fixture_origin}"
    printf '  5. confirm a URL-origin edit: change the %s/documented ask rule to the origin rule %s/* with effect ask via the opencode-permissions workflow, then re-inspect\n' "${fixture_origin}" "${fixture_origin}"
    printf '\nAfterwards run: %s verify\n' "${0}"
    ;;
  verify)
    command_pinned_runtime
    bun "${script_dir}/verify-database.ts" "${database_path}" "${fixture_origin}"
    (
      cd "${project_dir}"
      export PATH="${HOME}/.opencode/bin:${PATH}"
      bash "${repo_root}/skills/opencode-permissions/scripts/inspect.sh" show-effective build --json
    )
    printf '\nRe-inspection expectations: the webfetch rule order shows the origin rule %s/* with effect ask attributed to opencode.json (shared), and rule order is preserved.\n' "${fixture_origin}"
    printf 'PASS markers above are the recorded smoke outcome.\n'
    ;;
  teardown)
    rm -rf "${smoke_root}"
    printf 'removed %s\n' "${smoke_root}"
    ;;
  *)
    printf 'usage: v2-runtime.sh {setup|verify|teardown}\n' >&2
    exit 1
    ;;
esac
```

Note on the packed-package discovery item: run `npm pack` at the repository root, then repeat `setup` with the plugin **not** copied into the project and with the project's `package.json` declaring `{"dependencies": {"opencode-permissions": "file:./opencode-permissions-<version>.tgz"}}` (run `bun install`) and its `opencode.json` gaining `"plugins": ["opencode-permissions"]`; checklist item 1 recording a qualifying 2.x shell approval proves the package route. If the runtime's package resolution rejects the local tarball on first run, record the exact error in the smoke report, keep the repository-local route as the completed evidence, and file the blocker as a follow-up item in the completion report.

(d) Add to `.opencode/plugins/permission-optimizer/README.md` a `## Pinned runtime smoke check` section: prerequisites (explicit v2.3.2 installed with the pinned command, `bun`, `git`, nothing else), the three subcommands of `scripts/smoke/v2-runtime.sh` in order, the statement that fetches and redirects use only the loopback fixture server (never personal state or public websites), that the interactive prompts need the developer's model credentials, that the database is isolated by `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` and is disposable, and that the whole run lives outside `bun test`.

- [ ] **Step 2: Execute the smoke check (human-assisted)**

1. `bash scripts/smoke/v2-runtime.sh setup` — the script prints the pinned runtime version (`2.3.2`), the isolated paths, and the checklist. Expected: `runtime: 2.3.2 (...)` line present.
2. Start the fixture server, source the env file, and open the interactive pinned session in the isolated project.
3. Work through checklist items 1–5 (each permission prompt answered by you, the owner).
4. `bash scripts/smoke/v2-runtime.sh verify` — Expected: three `PASS` lines from `verify-database.ts`, the inspector re-inspection printing `output file: .temp/permission-inspect-output-*` whose JSON shows the `http://127.0.0.1:4317/*` `webfetch` rule with `effect: "ask"` attributed to `opencode.json (shared)` in preserved order.
5. Run the packed-package variant described in the note; record its outcome.
6. `bash scripts/smoke/v2-runtime.sh teardown` (also run it if a step fails) and clean the fixture server process.

Record in the task report: runtime version printed, each checklist item's outcome (PASS/deviation), the packed-package route's outcome, and any anomaly (e.g. redirect behavior differences). A deviation does not fail the task silently — it is either fixed in the ported code (return to tasks 01–07 as a follow-up commit) or prominently documented in the plan's completion report.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke .opencode/plugins/permission-optimizer/README.md
git commit -m "test: add the pinned OpenCode 2.3.2 runtime smoke check"
```

(`bun test ./.opencode ./skills ./scripts ./test` must stay green — the smoke scripts contain no `*.test.ts`; `bun run typecheck` must stay green for `scripts/smoke/*.ts` — they are inside the `scripts/**/*.ts` tsconfig include.)

## Changed-code audit

**Exported declarations:** none (process-local scripts); each script's header comment states its contract. **Long bodies:** `v2-runtime.sh` case arms — declarative runbook steps, shell case is the natural decomposition.
