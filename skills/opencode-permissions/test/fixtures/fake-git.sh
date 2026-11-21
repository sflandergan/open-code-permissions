#!/bin/sh
if [ -n "${FAKE_GIT_TOPLEVEL:-}" ]; then
  printf '%s\n' "$FAKE_GIT_TOPLEVEL"
  exit 0
fi
printf 'fatal: not a git repository\n' >&2
exit 128
