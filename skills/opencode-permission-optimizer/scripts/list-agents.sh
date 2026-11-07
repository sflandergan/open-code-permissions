#!/usr/bin/env bash
# List the enabled agents for owner selection.
# Delegates to the opencode-permissions inspector so callers use this skill's
# own script; the inspector writes the report to .temp/ and prints its path.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "${script_dir}/../../opencode-permissions/scripts/inspect.sh" list-agents --json "$@"
