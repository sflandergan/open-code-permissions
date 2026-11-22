#!/bin/sh
# Resolves the inspected worktree root through Git (the same discovery the
# wrapper performs), so config entry fixture paths point at the sandbox
# worktree even when the inspector was invoked from a subdirectory.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FAKE_OPENCODE_ARGV_LOG="$script_dir/opencode-argv.log" \
FAKE_OPENCODE_FIXTURE_DIR="$script_dir" \
FAKE_OPENCODE_REPO_ROOT="$repository_root" \
exec bun "$script_dir/fake-opencode.ts" "$@"
