#!/usr/bin/env bash
# Owner-assisted pinned-runtime smoke for the OpenCode 2.x port.
#
#   bash scripts/smoke/v2-runtime.sh setup
#   bash scripts/smoke/v2-runtime.sh verify <run-dir>
#   bash scripts/smoke/v2-runtime.sh teardown <run-dir> [--keep]
#
# Setup prepares a disposable run: two throwaway Git projects (local plugin
# discovery and tarball package discovery), independent observation
# databases, a loopback web server, and the Task 09 inventory captures.
# The interactive approvals remain the owner's: run the printed launchers,
# approve each ask once, and record the confirmations the verifier expects.
# The pinned binary must report exactly 2.3.2 and is exposed as `opencode`
# on every inspector subprocess PATH. The owner's regular credential and
# profile environment is inherited untouched; global configuration stays
# active, and any conflict it causes is reported, never bypassed with
# broader rules.

set -euo pipefail

smoke_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checkout_root="$(git -C "${smoke_dir}" rev-parse --show-toplevel)"
smoke_root="/tmp/opencode-permissions"

fail() {
  printf 'v2-runtime: %s\n' "$1" >&2
  exit 1
}

require_pinned_binary() {
  if [ -z "${OPENCODE_V2_BIN:-}" ]; then
    fail "OPENCODE_V2_BIN must point to the pinned OpenCode 2.3.2 binary"
  fi
  if [ ! -x "${OPENCODE_V2_BIN}" ]; then
    fail "OPENCODE_V2_BIN is not executable: ${OPENCODE_V2_BIN}"
  fi
  local version
  version="$("${OPENCODE_V2_BIN}" --version 2>/dev/null || true)"
  case "${version}" in
    *"2.3.2"*) ;;
    *) fail "OPENCODE_V2_BIN reports '${version:-nothing}', expected exactly 2.3.2" ;;
  esac
  printf '%s\n' "${version}"
}

new_run_dir() {
  local stamp slug
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  slug="$(uuidgen | tr 'A-Z' 'a-z' | cut -c1-8)"
  printf '%s/smoke-%s-%s\n' "${smoke_root}" "${stamp}" "${slug}"
}

wait_for_server() {
  local run_dir="$1"
  local attempts=0
  while [ ! -f "${run_dir}/web-server.json" ]; do
    attempts=$((attempts + 1))
    if [ "${attempts}" -gt 100 ]; then
      cat "${run_dir}/web-server.log" >&2 || true
      fail "smoke web server did not become ready"
    fi
    sleep 0.1
  done
}

write_launcher() {
  local path="$1" project="$2" database="$3" fresh_cache="$4"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -euo pipefail\n'
    if [ "${fresh_cache}" = "yes" ]; then
      printf 'export XDG_CACHE_HOME=%q\n' "${run_dir}/xdg-cache"
      printf 'export NPM_CONFIG_CACHE=%q\n' "${run_dir}/npm-cache"
    fi
    printf 'export OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH=%q\n' "${database}"
    printf 'cd %q\n' "${project}"
    printf 'exec %q --standalone\n' "${OPENCODE_V2_BIN}"
  } > "${path}"
  chmod +x "${path}"
}

setup() {
  require_pinned_binary >/dev/null
  mkdir -p "${smoke_root}"
  run_dir="$(new_run_dir)"
  mkdir -p "${run_dir}/local/.opencode/plugins" "${run_dir}/package" "${run_dir}/results" \
    "${run_dir}/task-09-inventory" "${run_dir}/xdg-cache" "${run_dir}/npm-cache"

  local tarball marker
  tarball="$(cd "${checkout_root}" && npm pack --pack-destination "${run_dir}" 2>/dev/null | tail -n 1)"
  tarball="${tarball##*/}"
  [ -f "${run_dir}/${tarball}" ] || fail "npm pack did not produce the tarball"
  marker="echo smoke-${run_dir##*smoke-}-ok"

  cp -R "${checkout_root}/.opencode/plugins/permission-optimizer" "${run_dir}/local/.opencode/plugins/"
  for capture in pre-capture-debug-agents.json post-capture-debug-agents.json post-capture-debug-config.json; do
    if [ -f "${smoke_root}/${capture}" ]; then
      cp "${smoke_root}/${capture}" "${run_dir}/task-09-inventory/"
    fi
  done

  git -C "${run_dir}/local" init -q
  git -C "${run_dir}/package" init -q

  local server_token server_port
  server_token="$(uuidgen | tr 'A-Z' 'a-z')"
  jq -n \
    --arg runId "${run_dir##*/}" \
    --arg tarballName "${tarball}" \
    --arg serverToken "${server_token}" \
    '{runId: $runId, tarballName: $tarballName, serverToken: $serverToken}' \
    > "${run_dir}/run.json"

  nohup bun "${smoke_dir}/local-web-server.ts" --run-dir "${run_dir}" >"${run_dir}/web-server.log" 2>&1 &
  wait_for_server "${run_dir}"
  server_port="$(jq -r '.port' "${run_dir}/web-server.json")"

  local origin
  origin="http://127.0.0.1:${server_port}"
  jq -n \
    --arg origin "${origin}" \
    --arg marker "${marker}" \
    '{
      "$schema": "https://opencode.ai/config.json",
      model: { providerID: "opencode-go", model: "deepseek-v4.1-flash" },
      permissions: [
        { action: "shell", resource: $marker, effect: "ask" },
        { action: "webfetch", resource: ($origin + "/*"), effect: "ask" },
        { action: "webfetch", resource: ($origin + "/denied"), effect: "deny" },
        { action: "webfetch", resource: ($origin + "/redirect-ask"), effect: "allow" },
        { action: "webfetch", resource: ($origin + "/redirect-denied"), effect: "allow" }
      ]
    }' > "${run_dir}/local/opencode.json"

  jq -n \
    --arg origin "${origin}" \
    --arg tarball "${tarball}" \
    --arg marker "${marker}" \
    '{
      "$schema": "https://opencode.ai/config.json",
      model: { providerID: "opencode-go", model: "deepseek-v4.1-flash" },
      plugins: [ { package: ($origin + "/" + $tarball) } ],
      permissions: [
        { action: "shell", resource: $marker, effect: "ask" }
      ]
    }' > "${run_dir}/package/opencode.json"

  local baseline_db baseline_json
  baseline_db="$(bun "${smoke_dir}/verify-database.ts" default-db-path)"
  if [ -f "${baseline_db}" ]; then
    baseline_json="$(jq -n --arg path "${baseline_db}" \
      --arg hash "$(bun "${smoke_dir}/verify-database.ts" hash "${baseline_db}")" \
      '{path: $path, exists: true, sha256: $hash}')"
  else
    baseline_json="$(jq -n --arg path "${baseline_db}" '{path: $path, exists: false, sha256: null}')"
  fi
  printf '%s\n' "${baseline_json}" > "${run_dir}/baseline-default-db.json"

  jq -n \
    --arg runId "${run_dir##*/}" \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg checkoutRoot "${checkout_root}" \
    --arg opencodeV2Bin "${OPENCODE_V2_BIN}" \
    --arg opencodeVersion "$("${OPENCODE_V2_BIN}" --version 2>/dev/null)" \
    --arg tarballName "${tarball}" \
    --arg markerCommand "${marker}" \
    --arg localDir "${run_dir}/local" \
    --arg packageDir "${run_dir}/package" \
    --arg localDb "${run_dir}/local.sqlite" \
    --arg packageDb "${run_dir}/package.sqlite" \
    --arg defaultDbPath "${baseline_db}" \
    --argjson port "${server_port}" \
    --argjson packageRouteOpenIssue 2 \
    '{
      runId: $runId, createdAt: $createdAt, checkoutRoot: $checkoutRoot,
      opencodeV2Bin: $opencodeV2Bin, opencodeVersion: $opencodeVersion,
      tarballName: $tarballName, markerCommand: $markerCommand,
      localDir: $localDir, packageDir: $packageDir,
      localDb: $localDb, packageDb: $packageDb, defaultDbPath: $defaultDbPath, port: $port,
      packageRouteOpenIssue: $packageRouteOpenIssue
    }' > "${run_dir}/run.json"

  write_launcher "${run_dir}/launch-local.sh" "${run_dir}/local" "${run_dir}/local.sqlite" no
  write_launcher "${run_dir}/launch-package.sh" "${run_dir}/package" "${run_dir}/package.sqlite" yes

  git -C "${run_dir}/local" add -A >/dev/null
  git -C "${run_dir}/package" add -A >/dev/null

  printf '# Pinned runtime smoke: %s\n\n' "${run_dir##*/}" > "${run_dir}/INSTRUCTIONS.md"
  cat >> "${run_dir}/INSTRUCTIONS.md" <<'INSTRUCTIONS'
## Owner-assisted sequence

Run each launcher in your own terminal. Your regular credential and profile
environment stays inherited; global configuration remains active. If any
step does not prompt as described, stop and report the conflict instead of
broadening rules.

1. Local route: run ./launch-local.sh. Ask the agent to run exactly the
   marker command from run.json (`markerCommand`). Approve the ask once.
   Confirm the command output, then exit the session.
2. Package route (open item, issue #2): run ./launch-package.sh and the
   marker approval as above. Until the plugin is published to npm (issue
   #2), the pinned runtime does not install the config-declared package
   plugin, so nothing records; the verifier records that observed state
   instead of asserting install evidence.
3. Webfetch flow: run ./launch-local.sh again. Ask the agent to webfetch,
   in order: /intro, /setup, /redirect-ask, /redirect-denied. Approve each
   prompt once. Only /intro and /setup prompt. Record what the two redirect
   fetches returned, then exit.
4. Editing flow (with the optimizer report as evidence): prepare changing
   the shared webfetch origin rule from ask to allow without moving the
   /denied deny. After confirming the exact diff, add one JSON whitespace
   change to local/opencode.json, record the hash (hash subcommand), let
   the confirmed apply be attempted, and record the unchanged hash. Then
   prepare, confirm, and apply the revised diff.
5. Record outcomes in results/owner-confirmations.json (all keys from the
   verifier's checklist), record results/edit-freshness.json, then run
   verify.

Nothing outside this run directory is modified. teardown stops the web
server and deletes only this run directory.
INSTRUCTIONS

  printf 'run directory: %s\n' "${run_dir}"
  printf 'marker command: %s\n' "${marker}"
  printf 'web server: %s\n' "${origin}"
  printf 'next: follow the sequence in %s\n' "${run_dir}/INSTRUCTIONS.md"
}

verify_run() {
  local run_dir="$1"
  [ -f "${run_dir}/run.json" ] || fail "no run.json under ${run_dir}"
  require_pinned_binary >/dev/null
  exec bun "${smoke_dir}/verify-database.ts" "${run_dir}"
}

teardown_run() {
  local run_dir="$1"
  case "${run_dir}" in
    "${smoke_root}"/smoke-*) ;;
    *) fail "refusing to delete outside ${smoke_root}/smoke-*: ${run_dir}" ;;
  esac
  if [ -f "${run_dir}/web-server.json" ]; then
    local pid
    pid="$(jq -r '.pid' "${run_dir}/web-server.json")"
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      local waited=0
      while kill -0 "${pid}" 2>/dev/null; do
        waited=$((waited + 1))
        [ "${waited}" -gt 50 ] && break
        sleep 0.1
      done
    fi
  fi
  if [ "${2:-}" = "--keep" ]; then
    printf 'web server stopped; run directory retained: %s\n' "${run_dir}"
    return
  fi
  rm -rf "${run_dir}"
  printf 'web server stopped; run directory deleted: %s\n' "${run_dir}"
}

main() {
  case "${1:-}" in
    setup) setup ;;
    verify)
      [ "${2:-}" != "" ] || fail "verify requires a run directory"
      verify_run "${2}"
      ;;
    teardown)
      [ "${2:-}" != "" ] || fail "teardown requires a run directory"
      teardown_run "${2}" "${3:-}"
      ;;
    *)
      printf 'usage: bash scripts/smoke/v2-runtime.sh setup | verify <run-dir> | teardown <run-dir> [--keep]\n' >&2
      exit 2
      ;;
  esac
}

main "$@"
