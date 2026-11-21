#!/bin/sh
script_dir="$(cd "$(dirname "$0")" && pwd)"
FAKE_OPENCODE_ARGV_LOG="$script_dir/opencode-argv.log" \
FAKE_OPENCODE_FIXTURE_DIR="$script_dir" \
exec bun "$script_dir/fake-opencode.ts" "$@"
