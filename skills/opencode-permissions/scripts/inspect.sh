#!/usr/bin/env bash
# Portable read-only wrapper for the opencode-permissions inspector.
# Resolves its own installed location, discovers the repository from the
# command working directory, and runs the internal Bun inspector, so the
# skill works from repository-local and global installations alike.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

output_file=""
explicit_output_file=false
inspect_args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-file)
      if [ "$#" -lt 2 ]; then
        printf 'error: inspect.sh --output-file requires a path\n' >&2
        exit 1
      fi
      if [ "${explicit_output_file}" = true ]; then
        printf 'error: inspect.sh received duplicate --output-file options\n' >&2
        exit 1
      fi
      output_file="$2"
      explicit_output_file=true
      shift 2
      ;;
    *)
      inspect_args+=("$1")
      shift
      ;;
  esac
done

if ! command -v bun >/dev/null 2>&1; then
  printf 'error: inspect.sh requires bun on PATH\n' >&2
  exit 1
fi

worktree_root="$(git -C "${PWD}" rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'error: inspect.sh requires a Git worktree at "%s"\n' "${PWD}" >&2
  exit 1
}

export OPENCODE_PERMISSIONS_REPOSITORY_ROOT="${worktree_root}"

temp_dir="${worktree_root}/.temp"
if [ "${explicit_output_file}" = true ]; then
  output_basename="${output_file##*/}"
  if [ "${output_file%/*}" != "${temp_dir}" ] || [[ ! "${output_basename}" =~ ^permission-inspect-output-[A-Za-z0-9-]+$ ]]; then
    printf 'error: inspect.sh output path must be a direct child of "%s" with the permission-inspect-output- prefix\n' "${temp_dir}" >&2
    exit 1
  fi
fi

mkdir -p "${temp_dir}"

if [ "${explicit_output_file}" = true ] && { [ -e "${output_file}" ] || [ -L "${output_file}" ]; }; then
  printf 'error: inspect.sh output file already exists: "%s"\n' "${output_file}" >&2
  exit 1
fi

if output="$(bun "${script_dir}/inspect.ts" "${inspect_args[@]}")"; then
  :
else
  status=$?
  exit "${status}"
fi

if [ "${explicit_output_file}" = false ]; then
  output_file="$(mktemp "${temp_dir}/permission-inspect-output-XXXXXX")" || {
    printf 'error: inspect.sh could not create a temporary output file in "%s"\n' "${temp_dir}" >&2
    exit 1
  }
fi

# Protect explicit reports at redirection time, before another process can observe them.
if [ "${explicit_output_file}" = true ]; then
  umask 077
fi

if ! printf '%s\n' "${output}" >"${output_file}"; then
  rm -f -- "${output_file}"
  printf 'error: inspect.sh could not write the temporary output file\n' >&2
  exit 1
fi

if [ "${explicit_output_file}" = true ] && ! chmod 600 "${output_file}"; then
  rm -f -- "${output_file}"
  printf 'error: inspect.sh could not protect the output file\n' >&2
  exit 1
fi

if [ "${explicit_output_file}" = false ]; then
  printf 'output file: .temp/%s\n' "${output_file##*/}"
fi
