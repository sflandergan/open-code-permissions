#!/usr/bin/env bash
# Portable wrapper for the OpenCode agent permission report exporter.
# Resolves its own installed location and runs the internal Bun exporter,
# so the skill works from repository-local and global installations alike.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

permissions_skill_dir="$(cd "${script_dir}/../.." && pwd)/opencode-permissions"
expected_inspector="${permissions_skill_dir}/scripts/inspect.sh"
if [ ! -x "${expected_inspector}" ]; then
  printf 'error: opencode-permission-optimizer requires the opencode-permissions skill installed beside it (expected %s)\n' "${expected_inspector}" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  printf 'error: agent-permission-report.sh requires bun on PATH\n' >&2
  exit 1
fi

worktree_root="$(git -C "${PWD}" rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'error: agent-permission-report.sh requires a Git worktree at "%s"\n' "${PWD}" >&2
  exit 1
}

# Help goes to the terminal, not into an allocated output file.
for arg in "$@"; do
  if [ "${arg}" = "--help" ] || [ "${arg}" = "-h" ]; then
    exec bun "${script_dir}/agent-permission-report.ts" "$@"
  fi
done

temp_dir="${worktree_root}/.temp"
mkdir -p "${temp_dir}"
output_file="$(mktemp "${temp_dir}/permission-optimizer-output-XXXXXX")" || {
  printf 'error: agent-permission-report.sh could not create a temporary output file in "%s"\n' "${temp_dir}" >&2
  exit 1
}

completed=0
trap 'rm -f -- "${output_file}"; exit 130' INT
trap 'rm -f -- "${output_file}"; exit 143' TERM
trap 'rm -f -- "${output_file}"; exit 129' HUP
trap 'if [ "${completed}" -ne 1 ]; then rm -f -- "${output_file}"; fi' EXIT

if bun "${script_dir}/agent-permission-report.ts" "$@" >"${output_file}"; then
  :
else
  status=$?
  rm -f -- "${output_file}"
  exit "${status}"
fi

printf 'output file: .temp/%s\n' "${output_file##*/}"
completed=1
