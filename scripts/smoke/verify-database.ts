#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { countHitPaths } from "./local-web-server"

export { countHitPaths }

/** One parsed line of the smoke server's hit journal. */
export type HitLine = {
  path: string
  status: number
  at: string
}

/** One observation row joined with its requested resources. */
export type ObservationRow = {
  request_id: string
  repository_identity: string | null
  agent: string | null
  history_source_version: number
  action: string
  decision: string | null
  execution: string | null
  exit_code: number | null
  tool: string | null
  qualifying_approval: number
  resources: string[]
}

/** The expected shape of one route's marker observation. */
export type MarkerExpectation = {
  routeName: string
  markerResource: string
  expectedIdentity: string
}

/** The expected evidence inside the optimizer report. */
export type ReportExpectation = {
  markerResource: string
}

/** One expected effective rule reported by the real inspector. */
export type RuleExpectation = {
  action: string
  resource: string
  effect: string
  position: number
  originSource: string
}

/** One recorded Task 09 winner case. */
export type WinnerCase = {
  label: string
  agentId: string
  action?: string
  resource?: string
  expect: string
}

/**
 * Parses the smoke server's hit journal, skipping empty and malformed
 * lines so a partially flushed final line never fails verification.
 */
export function readHitLines(text: string): HitLine[] {
  const records: HitLine[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed) as HitLine
      if (typeof parsed.path === "string" && typeof parsed.status === "number") records.push(parsed)
    } catch {
      // Skip malformed lines; verification only needs well-formed hits.
    }
  }
  return records
}

/**
 * The pinned runtime's own wildcard matcher, replicated read-only for the
 * smoke: backslashes normalize to slashes, `*` spans anything, `?` one
 * character, and a trailing ` *` also covers the bare prefix.
 */
export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$").test(normalized)
}

/**
 * Verifies one route's marker observation. Each violation names the route,
 * the observation's request id, and the incorrect field.
 */
export function checkMarkerRouteObservation(row: ObservationRow, expected: MarkerExpectation): string[] {
  const violations: string[] = []
  const prefix = `${expected.routeName}: marker observation ${row.request_id}`
  if (row.decision !== "once") violations.push(`${prefix} decision is ${row.decision}, expected once`)
  if (row.execution !== "success") violations.push(`${prefix} execution is ${row.execution}, expected success`)
  if (row.exit_code !== 0) violations.push(`${prefix} exit_code is ${row.exit_code}, expected 0`)
  if (row.agent !== "build") violations.push(`${prefix} agent is ${row.agent ?? "missing"}, expected build`)
  if (row.history_source_version !== 2) {
    violations.push(`${prefix} history_source_version is ${row.history_source_version}, expected 2`)
  }
  if (row.qualifying_approval !== 1) {
    violations.push(`${prefix} qualifying_approval is ${row.qualifying_approval}, expected 1`)
  }
  if (row.tool !== "shell") violations.push(`${prefix} tool is ${row.tool ?? "missing"}, expected shell`)
  if (row.repository_identity === null) {
    violations.push(`${prefix} repository_identity is missing`)
  } else if (row.repository_identity !== expected.expectedIdentity) {
    violations.push(`${prefix} repository_identity is ${row.repository_identity}, expected ${expected.expectedIdentity}`)
  }
  if (!row.resources.includes(expected.markerResource)) {
    violations.push(`${prefix} does not request the marker resource`)
  }
  return violations
}

/**
 * Verifies the optimizer report for one route: an available schema-5
 * database, summaryVersion 2, and marker evidence with once approvals and
 * successful once approvals recorded from history source 2.
 */
export function checkReportEvidence(report: Record<string, unknown>, expected: ReportExpectation): string[] {
  const violations: string[] = []
  if (report.databaseState !== "available") {
    violations.push(`report databaseState is ${String(report.databaseState)}, expected available`)
    return violations
  }
  if (report.summaryVersion !== 2) violations.push(`report summaryVersion is ${String(report.summaryVersion)}, expected 2`)
  if (report.schemaVersion !== 5) violations.push(`report schemaVersion is ${String(report.schemaVersion)}, expected 5`)
  if (!hasMarkerEvidence(report, expected.markerResource, "approvalsBySource")) {
    violations.push(`report has no shell resource matching the marker with once approvals from source 2`)
  }
  if (!hasMarkerEvidence(report, expected.markerResource, "successfulOnceApprovalsBySource")) {
    violations.push(`report has no shell resource matching the marker with successful once approvals from source 2`)
  }
  if (!hasMarkerAskRule(report, expected.markerResource)) {
    violations.push(`report effectivePolicy does not contain the marker ask rule`)
  }
  return violations
}

function hasMarkerEvidence(report: Record<string, unknown>, marker: string, field: string): boolean {
  const resources = Array.isArray(report.resources) ? (report.resources as Array<Record<string, unknown>>) : []
  return resources.some(
    (entry) =>
      entry.action === "shell" &&
      entry.resource === marker &&
      isRecord(entry[field]) &&
      Number(entry[field]["2"] ?? 0) >= 1,
  )
}

function hasMarkerAskRule(report: Record<string, unknown>, marker: string): boolean {
  const policy = isRecord(report.effectivePolicy) ? report.effectivePolicy : {}
  const rules = Array.isArray(policy.rules) ? (policy.rules as Array<Record<string, unknown>>) : []
  return rules.some((rule) => rule.action === "shell" && rule.resource === marker && rule.effect === "ask")
}

/**
 * Verifies the inspected effective policy of the build agent against the
 * expected rule effects, runtime positions, and repository origins.
 */
export function checkEffectivePolicyRules(policyJson: unknown, expectations: RuleExpectation[]): string[] {
  const violations: string[] = []
  const agent = findBuildAgent(policyJson)
  if (agent === null) {
    return [`agent build not found in the effective policy report`]
  }
  const rules = Array.isArray(agent.rules) ? (agent.rules as Array<Record<string, unknown>>) : []
  for (const expectation of expectations) {
    const rule = rules.find((entry) => entry.action === expectation.action && entry.resource === expectation.resource)
    if (rule === undefined) {
      violations.push(`rule ${expectation.action} ${expectation.resource} not found in agent build`)
      continue
    }
    const label = `rule ${expectation.action} ${expectation.resource}`
    if (rule.effect !== expectation.effect) {
      violations.push(`${label} effect is ${String(rule.effect)}, expected ${expectation.effect}`)
    }
    if (rule.position !== expectation.position) {
      violations.push(`${label} position is ${String(rule.position)}, expected ${expectation.position}`)
    }
    const origin = isRecord(rule.origin) ? rule.origin : {}
    if (origin.source !== expectation.originSource) {
      violations.push(`${label} origin source is ${String(origin.source)}, expected ${expectation.originSource}`)
    }
  }
  return violations
}

/**
 * Verifies the recorded Task 09 winner cases against a captured
 * `debug agents` inventory, including the expected absence of the disabled
 * plan agent.
 */
export function checkTask09Winners(agents: unknown, cases: WinnerCase[]): string[] {
  const violations: string[] = []
  const inventory = Array.isArray(agents) ? (agents as Array<Record<string, unknown>>) : []
  for (const oneCase of cases) {
    const agent = inventory.find((entry) => entry.id === oneCase.agentId)
    if (oneCase.expect === "absent") {
      if (agent !== undefined) {
        violations.push(`${oneCase.label}: agent ${oneCase.agentId} is present, expected absent`)
      }
      continue
    }
    if (agent === undefined) {
      violations.push(`${oneCase.label}: agent ${oneCase.agentId} is missing from the inventory`)
      continue
    }
    const rules = Array.isArray(agent.permissions) ? (agent.permissions as Array<Record<string, string>>) : []
    const winner = [...rules]
      .reverse()
      .find((rule) => wildcardMatch(oneCase.action ?? "*", rule.action) && wildcardMatch(oneCase.resource ?? "*", rule.resource))
    const effect = winner?.effect ?? "allow"
    if (effect !== oneCase.expect) {
      violations.push(`${oneCase.label}: winner is ${effect}, expected ${oneCase.expect}`)
    }
  }
  return violations
}

function findBuildAgent(policyJson: unknown): Record<string, unknown> | null {
  if (!isRecord(policyJson)) return null
  const agents = Array.isArray(policyJson.agents) ? (policyJson.agents as Array<unknown>) : []
  const agent = agents.find((entry) => isRecord(entry) && entry.id === "build")
  return isRecord(agent) ? agent : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** SHA-256 of a file's bytes, hex encoded. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** The full machine verification for one smoke run directory. */
async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2)
  if (command === "hash" || command === "default-db-path") {
    if (command === "hash") {
      if (argument === undefined) {
        process.stderr.write("usage: verify-database.ts hash <file>\n")
        process.exit(2)
      }
      process.stdout.write(`${sha256File(resolve(argument))}\n`)
      return
    }
    process.stdout.write(`${resolveBaselineDatabasePath(process.env)}\n`)
    return
  }
  if (command === undefined) {
    process.stderr.write("usage: verify-database.ts <run-dir> | hash <file> | default-db-path\n")
    process.exit(2)
  }
  const runDir = resolve(command)
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunManifest
  await verifyRun(runDir, run)
}

/**
 * The database path the plugin would resolve for the owner: the
 * `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` override when set, else the
 * platform application-data default. This identifies the profile's
 * observation database the run must not modify.
 */
function resolveBaselineDatabasePath(env: Record<string, string | undefined>): string {
  const override = env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
  if (override && override.length > 0) return resolve(override)
  const home = env.HOME ?? ""
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? env.LOCALAPPDATA ?? join(home, "AppData", "Local")
        : env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
          ? env.XDG_DATA_HOME
          : join(home, ".local", "share")
  return join(base, "opencode", "permission-optimizer", "observations.sqlite")
}

type RunManifest = {
  runId: string
  checkoutRoot: string
  opencodeV2Bin: string
  opencodeVersion: string
  tarballName: string
  markerCommand: string
  localDir: string
  packageDir: string
  localDb: string
  packageDb: string
  defaultDbPath: string
  port: number
  /**
   * When set, the package route is an open work item (the plugin is not
   * published to npm yet; see the referenced issue): the verifier records
   * the observed package-route state instead of asserting install evidence.
   */
  packageRouteOpenIssue?: number
}

async function verifyRun(runDir: string, run: RunManifest): Promise<void> {
  const violations: string[] = []
  ensureResultsDir(runDir)

  pushInto(violations, await checkQuiescence(run))
  pushInto(violations, checkDefaultDatabaseUnchanged(runDir, run))
  pushInto(violations, await checkRoute(runDir, run, "local", run.localDir, run.localDb))
  if (run.packageRouteOpenIssue !== undefined) {
    pushInto(violations, await recordOpenPackageRoute(runDir, run))
  } else {
    pushInto(violations, await checkRoute(runDir, run, "package", run.packageDir, run.packageDb))
    pushInto(violations, checkTarballRequested(runDir, run))
  }
  pushInto(violations, checkWebfetchHits(runDir, run))
  pushInto(violations, checkWebfetchObservations(run, run.localDb))
  pushInto(violations, await checkEditFreshness(runDir, run))
  pushInto(violations, checkTask09Inventory(runDir))
  pushInto(violations, checkOwnerConfirmations(runDir))

  const passed = violations.length === 0
  writeResults(runDir, run, violations, passed)
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}: ${violations.length} violation(s)\n` +
      (violations.length > 0 ? violations.map((line) => `- ${line}`).join("\n") + "\n" : ""),
  )
  process.exit(passed ? 0 : 1)
}

function pushInto(target: string[], violations: string[]): void {
  for (const violation of violations) target.push(violation)
}

/**
 * Hashes both route databases twice with a short delay: after the owner's
 * session has exited, the recorder must stay closed and no new write may
 * land. This runs before any process that could open the databases.
 */
async function checkQuiescence(run: RunManifest): Promise<string[]> {
  const before = hashRouteDatabases(run)
  await Bun.sleep(1500)
  const after = hashRouteDatabases(run)
  const violations: string[] = []
  for (const [route, hash] of Object.entries(before)) {
    if (after[route] !== hash) violations.push(`quiescence: ${route} observation database changed after shutdown`)
  }
  return violations
}

function hashRouteDatabases(run: RunManifest): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const [route, path] of [
    ["local", run.localDb],
    ["package", run.packageDb],
  ] as const) {
    hashes[route] = existsSync(path) ? sha256File(path) : "missing"
  }
  return hashes
}

/**
 * Confirms the owner's real observation database is untouched: the same
 * existence state and the same hash as the baseline setup recorded.
 */
function checkDefaultDatabaseUnchanged(runDir: string, run: RunManifest): string[] {
  const baselinePath = join(runDir, "baseline-default-db.json")
  if (!existsSync(baselinePath)) return ["default database baseline is missing"]
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { exists: boolean; sha256: string | null }
  const existsNow = existsSync(run.defaultDbPath)
  if (existsNow !== baseline.exists) return [`default observation database existence changed`]
  if (existsNow) {
    if (baseline.sha256 === null) return ["default observation database baseline hash is missing"]
    if (sha256File(run.defaultDbPath) !== baseline.sha256) {
      return ["default observation database changed during the smoke run"]
    }
  }
  return []
}

/** Reads all observation rows of a route database, opened strictly read-only. */
function readObservations(dbPath: string): ObservationRow[] {
  if (!existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query(
        `SELECT o.request_id, o.repository_identity, o.agent, o.history_source_version, o.action,
                o.decision, o.execution, o.exit_code, o.tool, o.qualifying_approval
         FROM observations o ORDER BY o.id`,
      )
      .all() as Array<Omit<ObservationRow, "resources">>
    return rows.map((row) => ({
      ...row,
      resources: readObservationResources(db, row.request_id),
    }))
  } finally {
    db.close()
  }
}

function readObservationResources(db: Database, requestId: string): string[] {
  const rows = db
    .query(
      `SELECT r.resource FROM requested_resources r
       JOIN observations o ON o.id = r.observation_id
       WHERE o.request_id = ? ORDER BY r.resource_index`,
    )
    .all(requestId) as Array<{ resource: string }>
  return rows.map((row) => row.resource)
}

/**
 * Records the package route's observed state when package installation is
 * an open work item: no install or recording criteria are asserted; the
 * results file captures what the run observed so the open item's outcome
 * stays visible instead of silently passing.
 */
async function recordOpenPackageRoute(runDir: string, run: RunManifest): Promise<string[]> {
  const counts = readHitCounts(runDir)
  writeResultsFile(runDir, "package-route-open-item.json", {
    issue: run.packageRouteOpenIssue ?? null,
    observed: {
      databaseExists: existsSync(run.packageDb),
      observationCount: readObservations(run.packageDb).length,
      servedTarballHits: counts[`/${run.tarballName}`] ?? 0,
    },
  })
  process.stdout.write(
    `package route recorded as open (issue #${run.packageRouteOpenIssue ?? "unknown"}); no install criteria asserted\n`,
  )
  return []
}

/**
 * Verifies one install route: exactly one qualifying marker observation
 * with the expected repository identity, and a matching optimizer report
 * generated from the route's project with the pinned binary on PATH.
 */
async function checkRoute(
  runDir: string,
  run: RunManifest,
  routeName: "local" | "package",
  projectDir: string,
  dbPath: string,
): Promise<string[]> {
  const violations: string[] = []
  const expectedIdentity = gitCommonDirectory(projectDir)
  if (expectedIdentity === null) return [`${routeName}: could not resolve the project's Git common directory`]
  const markerRows = readObservations(dbPath).filter(
    (row) => row.action === "shell" && row.resources.includes(run.markerCommand) && row.decision === "once",
  )
  if (markerRows.length === 0) {
    violations.push(`${routeName}: no marker observation recorded`)
  } else {
    if (markerRows.length > 1) {
      violations.push(`${routeName}: ${markerRows.length} marker observations recorded, expected exactly one`)
    }
    pushInto(violations, checkMarkerRouteObservation(markerRows[0], {
      routeName,
      markerResource: run.markerCommand,
      expectedIdentity,
    }))
  }
  const report = await runReport(run, projectDir, dbPath)
  if (report === null) {
    violations.push(`${routeName}: optimizer report could not be generated`)
    return violations
  }
  writeResultsFile(runDir, `report-${routeName}.json`, report)
  pushInto(violations, checkReportEvidence(report, { markerResource: run.markerCommand }).map((line) => `${routeName}: ${line}`))
  return violations
}

/**
 * Runs the real optimizer report wrapper from the route's project so its
 * repository identity, the inspector subprocess PATH (pinned `opencode`),
 * and the run's database all match the smoke environment.
 */
async function runReport(run: RunManifest, projectDir: string, dbPath: string): Promise<Record<string, unknown> | null> {
  const wrapper = join(run.checkoutRoot, "skills", "opencode-permission-optimizer", "scripts", "agent-permission-report.sh")
  try {
    const stdout = execFileSync("bash", [wrapper, "--agent", "build"], {
      cwd: projectDir,
      encoding: "utf8",
      env: reportEnv(run, dbPath),
    })
    const match = stdout.match(/^output file: \.temp\/(.+)$/m)
    if (match === null) return null
    const report = JSON.parse(readFileSync(join(projectDir, ".temp", match[1]), "utf8")) as Record<string, unknown>
    return report
  } catch {
    return null
  }
}

function reportEnv(run: RunManifest, dbPath: string): Record<string, string> {
  const separated = run.opencodeV2Bin.lastIndexOf("/")
  const binDir = separated === -1 ? process.env.PATH ?? "" : run.opencodeV2Bin.slice(0, separated)
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH: dbPath,
  }
}

function gitCommonDirectory(projectDir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trimEnd()
  } catch {
    return null
  }
}

/** Confirms the package install actually requested the served tarball. */
function checkTarballRequested(runDir: string, run: RunManifest): string[] {
  const counts = readHitCounts(runDir)
  const tarballPath = `/${run.tarballName}`
  return counts[tarballPath] === undefined
    ? [`package route never requested the served tarball`]
    : []
}

/** Verifies the expected webfetch hit counts, including the unreachable deny. */
function checkWebfetchHits(runDir: string, run: RunManifest): string[] {
  const counts = readHitCounts(runDir)
  const expected: Record<string, number> = {
    "/intro": 2,
    "/setup": 1,
    "/redirect-ask": 1,
    "/redirect-denied": 1,
    "/denied": 0,
  }
  const violations: string[] = []
  for (const [path, count] of Object.entries(expected)) {
    const actual = counts[path] ?? 0
    if (actual !== count) violations.push(`webfetch hits for ${path} are ${actual}, expected ${count}`)
  }
  return violations
}

function readHitCounts(runDir: string): Record<string, number> {
  const hitsPath = join(runDir, "hits.jsonl")
  if (!existsSync(hitsPath)) return {}
  return countHitPaths(readHitLines(readFileSync(hitsPath, "utf8")))
}

/**
 * Verifies the webfetch observation shape: the two direct pages qualify,
 * while redirect and denied paths never asked.
 */
function checkWebfetchObservations(run: RunManifest, dbPath: string): string[] {
  const violations: string[] = []
  const origin = `http://127.0.0.1:${run.port}`
  const expectedQualifying = [`${origin}/intro`, `${origin}/setup`]
  const observations = readObservations(dbPath).filter((row) => row.action === "webfetch")
  for (const url of expectedQualifying) {
    const rows = observations.filter((row) => row.resources.includes(url))
    if (rows.length !== 1) {
      violations.push(`webfetch observation count for ${url} is ${rows.length}, expected exactly one`)
      continue
    }
    if (rows[0].decision !== "once" || rows[0].execution !== "success" || rows[0].qualifying_approval !== 1) {
      violations.push(`webfetch observation for ${url} is not a qualifying once approval`)
    }
  }
  for (const url of [`${origin}/redirect-ask`, `${origin}/redirect-denied`, `${origin}/denied`]) {
    const rows = observations.filter((row) => row.resources.includes(url))
    if (rows.length !== 0) {
      violations.push(`webfetch recorded ${rows.length} observation(s) for ${url}, expected none`)
    }
  }
  return violations
}

/**
 * Verifies the editing-skill freshness evidence: the stale apply never
 * wrote, the applied hash matches the checked-in bytes, and the real
 * inspector reports the new effect and position with a repository origin
 * and the unchanged deny.
 */
async function checkEditFreshness(runDir: string, run: RunManifest): Promise<string[]> {
  const violations: string[] = []
  const freshnessPath = join(runDir, "results", "edit-freshness.json")
  if (!existsSync(freshnessPath)) return ["edit freshness results are missing"]
  const freshness = JSON.parse(readFileSync(freshnessPath, "utf8")) as {
    originRulePosition: number
    denyRulePosition: number
    whitespaceHash: string
    hashAfterStaleApply: string
    appliedHash: string
  }
  if (freshness.hashAfterStaleApply !== freshness.whitespaceHash) {
    violations.push(`edit freshness: the stale apply changed the config hash`)
  }
  const configPath = join(run.localDir, "opencode.json")
  const currentHash = sha256File(configPath)
  if (currentHash !== freshness.appliedHash) {
    violations.push(`edit freshness: the local config hash does not match the applied hash`)
  }
  const policyJson = JSON.parse(await runInspector(run, run.localDir, "show-effective", "build")) as unknown
  const origin = `http://127.0.0.1:${run.port}`
  pushInto(violations, checkEffectivePolicyRules(policyJson, [
    {
      action: "webfetch",
      resource: `${origin}/*`,
      effect: "allow",
      position: freshness.originRulePosition,
      originSource: "opencode.json",
    },
    {
      action: "webfetch",
      resource: `${origin}/denied`,
      effect: "deny",
      position: freshness.denyRulePosition,
      originSource: "opencode.json",
    },
  ]))
  return violations
}

/** Runs the real inspector wrapper from a project with the pinned `opencode` on PATH. */
async function runInspector(run: RunManifest, projectDir: string, command: string, agent: string): Promise<string> {
  const wrapper = join(run.checkoutRoot, "skills", "opencode-permissions", "scripts", "inspect.sh")
  const separated = run.opencodeV2Bin.lastIndexOf("/")
  const binDir = separated === -1 ? "" : run.opencodeV2Bin.slice(0, separated)
  return execFileSync("bash", [wrapper, command, agent, "--json"], {
    cwd: projectDir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  })
}

/**
 * Verifies the Task 09 inventory captures recorded alongside the run: the
 * pre-conversion compatibility view keeps the intended winners except the
 * documented external-directory broadening, and the native result keeps
 * every intended protection including the restored ask fallback.
 */
function checkTask09Inventory(runDir: string): string[] {
  const inventoryDir = join(runDir, "task-09-inventory")
  const prePath = join(inventoryDir, "pre-capture-debug-agents.json")
  const postPath = join(inventoryDir, "post-capture-debug-agents.json")
  if (!existsSync(prePath) || !existsSync(postPath)) {
    return ["task 09 inventory captures are missing"]
  }
  const pre = JSON.parse(readFileSync(prePath, "utf8")) as unknown
  const post = JSON.parse(readFileSync(postPath, "utf8")) as unknown
  const violations: string[] = []
  pushInto(violations, checkTask09Winners(pre, PRE_CAPTURE_CASES).map((line) => `task 09 pre-capture: ${line}`))
  pushInto(violations, checkTask09Winners(post, POST_CAPTURE_CASES).map((line) => `task 09 post-capture: ${line}`))
  return violations
}

/**
 * The Task 09 winner cases verified against the pre-conversion
 * compatibility view, including the broadened external-directory default
 * the native result restores to ask.
 */
const PRE_CAPTURE_CASES: WinnerCase[] = [
  { label: "worker dispatch explore", agentId: "build", action: "subagent", resource: "explore", expect: "allow" },
  { label: "worker dispatch implement-task", agentId: "build", action: "subagent", resource: "implement-task", expect: "allow" },
  { label: "worker dispatch other", agentId: "build", action: "subagent", resource: "someone-else", expect: "deny" },
  { label: "external tmp allow", agentId: "build", action: "external_directory", resource: "/tmp/opencode-permissions/x", expect: "allow" },
  { label: "external unmatched broadened to allow", agentId: "build", action: "external_directory", resource: "/Users/someone/secret", expect: "allow" },
  { label: "redirect guard", agentId: "build", action: "shell", resource: "bun test > log.txt", expect: "ask" },
  { label: "unconditional ban git push", agentId: "build", action: "shell", resource: "git push origin main", expect: "deny" },
  { label: "unconditional ban node -e", agentId: "build", action: "shell", resource: "node -e boom()", expect: "deny" },
  { label: "plan disabled", agentId: "plan", expect: "absent" },
]

/**
 * The same winners after the native conversion, with the shared
 * external-directory fallback restored and the protected agent's exact
 * permissions verified from the v1 map fold.
 */
const POST_CAPTURE_CASES: WinnerCase[] = [
  { label: "worker dispatch explore", agentId: "build", action: "subagent", resource: "explore", expect: "allow" },
  { label: "worker dispatch implement-task", agentId: "build", action: "subagent", resource: "implement-task", expect: "allow" },
  { label: "worker dispatch other", agentId: "build", action: "subagent", resource: "someone-else", expect: "deny" },
  {
    label: "inspector wrapper",
    agentId: "opencode-permissions",
    action: "shell",
    resource: 'bash "*/opencode-permissions/scripts/inspect.sh" list-agents --json',
    expect: "allow",
  },
  {
    label: "report wrapper",
    agentId: "opencode-permissions",
    action: "shell",
    resource: 'bash "*/opencode-permission-optimizer/scripts/agent-permission-report.sh" --agent build',
    expect: "allow",
  },
  { label: "wrapper denial", agentId: "opencode-permissions", action: "shell", resource: "rm -rf /", expect: "deny" },
  {
    label: "self-edit denial",
    agentId: "opencode-permissions",
    action: "edit",
    resource: ".opencode/agents/opencode-permissions.md",
    expect: "deny",
  },
  {
    label: "nested guidance edit denial",
    agentId: "opencode-permissions",
    action: "edit",
    resource: ".agents/skills/whatever/AGENTS.md",
    expect: "deny",
  },
  { label: "nested guidance read", agentId: "opencode-permissions", action: "read", resource: ".agents/skills/whatever/AGENTS.md", expect: "allow" },
  { label: "root AGENTS.md edit ask", agentId: "opencode-permissions", action: "edit", resource: "AGENTS.md", expect: "ask" },
  { label: "root AGENTS.md read", agentId: "opencode-permissions", action: "read", resource: "AGENTS.md", expect: "allow" },
  { label: "external tmp allow", agentId: "build", action: "external_directory", resource: "/tmp/opencode-permissions/x", expect: "allow" },
  { label: "external fallback restored", agentId: "build", action: "external_directory", resource: "/Users/someone/secret", expect: "ask" },
  { label: "redirect guard", agentId: "build", action: "shell", resource: "bun test > log.txt", expect: "ask" },
  { label: "unconditional ban git push", agentId: "build", action: "shell", resource: "git push origin main", expect: "deny" },
  { label: "unconditional ban node -e", agentId: "build", action: "shell", resource: "node -e boom()", expect: "deny" },
  { label: "plan disabled", agentId: "plan", expect: "absent" },
]

/** Confirms the owner's confirmation record covers every assisted outcome. */
function checkOwnerConfirmations(runDir: string): string[] {
  const confirmationsPath = join(runDir, "results", "owner-confirmations.json")
  if (!existsSync(confirmationsPath)) return ["owner confirmations are missing"]
  const confirmations = JSON.parse(readFileSync(confirmationsPath, "utf8")) as Record<string, unknown>
  const required = [
    "profileModelId",
    "localRouteApproval",
    "packageRouteObservation",
    "webfetchApprovals",
    "redirectObservations",
    "staleApplyRefusal",
    "cleanupObservation",
  ]
  return required
    .filter((key) => typeof confirmations[key] !== "string" || (confirmations[key] as string).trim().length === 0)
    .map((key) => `owner confirmation is missing or empty: ${key}`)
}

function ensureResultsDir(runDir: string): void {
  mkdirSync(join(runDir, "results"), { recursive: true })
}

function writeResultsFile(runDir: string, name: string, value: unknown): void {
  writeFileSync(join(runDir, "results", name), `${JSON.stringify(value, null, 2)}\n`)
}

function writeResults(runDir: string, run: RunManifest, violations: string[], passed: boolean): void {
  writeResultsFile(runDir, "verify-results.json", {
    runId: run.runId,
    opencodeVersion: run.opencodeVersion,
    markerCommand: run.markerCommand,
    passed,
    checkedAt: new Date().toISOString(),
    violations,
  })
}

if (import.meta.main) {
  await main()
}
