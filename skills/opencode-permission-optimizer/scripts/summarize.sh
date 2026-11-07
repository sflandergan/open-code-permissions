#!/usr/bin/env bash
# Portable wrapper for the OpenCode permission evidence-summary exporter.
# Resolves its own installed location and runs the internal Bun exporter,
# so the skill works from repository-local and global installations alike.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  printf 'error: summarize.sh requires bun on PATH\n' >&2
  exit 1
fi

worktree_root="$(git -C "${PWD}" rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'error: summarize.sh requires a Git worktree at "%s"\n' "${PWD}" >&2
  exit 1
}

# Help goes to the terminal, not into an allocated output file.
for arg in "$@"; do
  if [ "${arg}" = "--help" ] || [ "${arg}" = "-h" ]; then
    exec bun "${script_dir}/summarize.ts" "$@"
  fi
done

temp_dir="${worktree_root}/.temp"
mkdir -p "${temp_dir}"
output_file="$(mktemp "${temp_dir}/permission-optimizer-output-XXXXXX")" || {
  printf 'error: summarize.sh could not create a temporary output file in "%s"\n' "${temp_dir}" >&2
  exit 1
}

if bun "${script_dir}/summarize.ts" "$@" >"${output_file}"; then
  :
else
  status=$?
  rm -f -- "${output_file}"
  exit "${status}"
fi

printf 'output file: .temp/%s\n' "${output_file##*/}"
