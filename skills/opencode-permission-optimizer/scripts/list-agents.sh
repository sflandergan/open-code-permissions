#!/usr/bin/env bash
# List the enabled agents for owner selection.
# Delegates to the opencode-permissions inspector so callers use this skill's
# own script; the inspector writes the report to .temp/ and prints its path.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

permissions_skill_dir="$(cd "${script_dir}/../.." && pwd)/opencode-permissions"
expected_inspector="${permissions_skill_dir}/scripts/inspect.sh"
if [ ! -x "${expected_inspector}" ]; then
  printf 'error: opencode-permission-optimizer requires the opencode-permissions skill installed beside it (expected %s)\n' "${expected_inspector}" >&2
  exit 1
fi

exec bash "${expected_inspector}" list-agents --json "$@"
