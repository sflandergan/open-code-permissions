#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// The inspector tests install this script as `opencode`. The child
// environment supplies the argv log path and fixture directory so the copied
// script contains no test-specific absolute paths.
const argvLogPath = process.env.FAKE_OPENCODE_ARGV_LOG
const fixtureDir = process.env.FAKE_OPENCODE_FIXTURE_DIR
if (argvLogPath === undefined || fixtureDir === undefined) {
  process.stderr.write("FAKE_OPENCODE_ARGV_LOG and FAKE_OPENCODE_FIXTURE_DIR must be set\n")
  process.exit(1)
}

const argv = process.argv.slice(2)
writeFileSync(argvLogPath, JSON.stringify(argv) + "\n")

const key = argv.join(" ")
if (key === "agent list") {
  process.stdout.write(readFileSync(join(fixtureDir, "agent-list.txt"), "utf8"))
} else if (key === "debug config") {
  process.stdout.write(readFileSync(join(fixtureDir, "debug-config.json"), "utf8"))
} else if (argv[0] === "debug" && argv[1] === "agent") {
  const record = JSON.parse(readFileSync(join(fixtureDir, "debug-agent.json"), "utf8")) as { name: string }
  record.name = argv[2]
  process.stdout.write(JSON.stringify(record))
} else {
  process.stderr.write("no canned response for " + key + "\n")
  process.exit(1)
}
