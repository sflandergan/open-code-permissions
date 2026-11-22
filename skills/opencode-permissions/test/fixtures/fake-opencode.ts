#!/usr/bin/env bun
import { appendFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The inspector tests install this script as `opencode`. The child
// environment supplies the argv log path, fixture directory, and inspected
// worktree root so the copied script contains no test-specific absolute
// paths. The recorded v2 fixture files carry a literal $REPOSITORY_ROOT
// placeholder inside config entry paths, replaced here with the worktree
// root the wrapper resolved, so entry paths stay repository owned even when
// the inspector was invoked from a subdirectory.
const argvLogPath = process.env.FAKE_OPENCODE_ARGV_LOG
const fixtureDir = process.env.FAKE_OPENCODE_FIXTURE_DIR
const repositoryRoot = process.env.FAKE_OPENCODE_REPO_ROOT ?? process.cwd()
if (argvLogPath === undefined || fixtureDir === undefined) {
  process.stderr.write("FAKE_OPENCODE_ARGV_LOG and FAKE_OPENCODE_FIXTURE_DIR must be set\n")
  process.exit(1)
}

const argv = process.argv.slice(2)
appendFileSync(argvLogPath, JSON.stringify(argv) + "\n")

const key = argv.join(" ")
if (key === "debug agents") {
  process.stdout.write(readFileSync(join(fixtureDir, "debug-agents.json"), "utf8"))
} else if (key === "debug config") {
  const raw = readFileSync(join(fixtureDir, "debug-config.json"), "utf8")
  process.stdout.write(raw.replaceAll("$REPOSITORY_ROOT", repositoryRoot))
} else {
  process.stderr.write("no canned response for " + key + "\n")
  process.exit(1)
}
