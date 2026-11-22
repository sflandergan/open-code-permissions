import { describe, expect, it } from "bun:test"
import {
  checkEffectivePolicyRules,
  checkMarkerRouteObservation,
  checkReportEvidence,
  checkTask09Winners,
  countHitPaths,
  readHitLines,
  wildcardMatch,
  type HitLine,
  type ObservationRow,
} from "./verify-database"

describe("hit accounting", () => {
  const text = [
    JSON.stringify({ path: "/intro", status: 200, at: "t1" }),
    "",
    JSON.stringify({ path: "/intro", status: 200, at: "t2" }),
    JSON.stringify({ path: "/denied", status: 200, at: "t3" }),
    "not json",
  ].join("\n")

  it("skips malformed and empty lines", () => {
    expect(readHitLines(text)).toHaveLength(3)
  })

  it("counts hits per path", () => {
    const records: HitLine[] = readHitLines(text)
    expect(countHitPaths(records)).toEqual({ "/intro": 2, "/denied": 1 })
  })
})

describe("wildcard matching", () => {
  it("matches the pinned runtime semantics", () => {
    expect(wildcardMatch("echo smoke-run-42-ok", "echo smoke-*")).toBe(true)
    expect(wildcardMatch("http://127.0.0.1:1234/intro", "http://127.0.0.1:1234/*")).toBe(true)
    expect(wildcardMatch("/tmp/opencode-permissions/x", "/tmp/opencode-permissions/**")).toBe(true)
    expect(wildcardMatch("git status --verbose", "git status")).toBe(false)
    expect(wildcardMatch("anything", "*")).toBe(true)
  })
})

const MARKER = "echo smoke-run-42-ok"

function makeObservation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    request_id: "req-1",
    repository_identity: "/tmp/opencode-permissions/smoke/local/.git",
    agent: "build",
    history_source_version: 2,
    action: "shell",
    decision: "once",
    execution: "success",
    exit_code: 0,
    tool: "shell",
    qualifying_approval: 1,
    resources: [MARKER],
    ...overrides,
  }
}

describe("marker route observation checks", () => {
  it("accepts a complete qualifying observation", () => {
    const violations = checkMarkerRouteObservation(makeObservation(), {
      routeName: "local",
      markerResource: MARKER,
      expectedIdentity: "/tmp/opencode-permissions/smoke/local/.git",
    })
    expect(violations).toEqual([])
  })

  it("flags each incorrect field", () => {
    expect(
      checkMarkerRouteObservation(
        makeObservation({ decision: "always", exit_code: 1, execution: "failure", history_source_version: 1, agent: null }),
        { routeName: "local", markerResource: MARKER, expectedIdentity: "/tmp/opencode-permissions/smoke/local/.git" },
      ),
    ).toEqual([
      "local: marker observation req-1 decision is always, expected once",
      "local: marker observation req-1 execution is failure, expected success",
      "local: marker observation req-1 exit_code is 1, expected 0",
      "local: marker observation req-1 agent is missing, expected build",
      "local: marker observation req-1 history_source_version is 1, expected 2",
    ])
  })

  it("flags a missing resource and a wrong identity", () => {
    const violations = checkMarkerRouteObservation(
      makeObservation({ resources: ["echo other"], repository_identity: null }),
      { routeName: "local", markerResource: MARKER, expectedIdentity: "/tmp/opencode-permissions/smoke/local/.git" },
    )
    expect(violations).toEqual([
      "local: marker observation req-1 repository_identity is missing",
      "local: marker observation req-1 does not request the marker resource",
    ])
  })
})

describe("report evidence checks", () => {
  const report = {
    summaryVersion: 2,
    databaseState: "available",
    schemaVersion: 5,
    resources: [
      {
        action: "shell",
        resource: MARKER,
        requests: 1,
        approvalsBySource: { "1": 0, "2": 1 },
        successfulOnceApprovalsBySource: { "1": 0, "2": 1 },
      },
    ],
    webfetchRequestedUrlMatches: [],
    effectivePolicy: {
      rules: [{ action: "shell", resource: MARKER, effect: "ask" }],
    },
  }

  it("accepts a report with a successful once approval from source 2", () => {
    expect(checkReportEvidence(report, { markerResource: MARKER })).toEqual([])
  })

  it("flags missing marker evidence, schema, and version", () => {
    const broken = {
      summaryVersion: 2,
      databaseState: "available",
      schemaVersion: 4,
      resources: [
        {
          action: "shell",
          resource: "echo other",
          approvalsBySource: { "1": 1, "2": 0 },
          successfulOnceApprovalsBySource: { "1": 0, "2": 0 },
        },
      ],
      effectivePolicy: {
        rules: [{ action: "shell", resource: MARKER, effect: "ask" }],
      },
    }
    expect(checkReportEvidence(broken, { markerResource: MARKER })).toEqual([
      "report schemaVersion is 4, expected 5",
      "report has no shell resource matching the marker with once approvals from source 2",
      "report has no shell resource matching the marker with successful once approvals from source 2",
    ])
  })

  it("flags a missing database in the report", () => {
    expect(checkReportEvidence({ summaryVersion: 2, databaseState: "missing" }, { markerResource: MARKER })).toEqual([
      "report databaseState is missing, expected available",
    ])
  })
})

describe("effective policy checks", () => {
  const policyJson = {
    agents: [
      {
        id: "build",
        name: "build",
        mode: "primary",
        hidden: false,
        rules: [
          { position: 1, action: "webfetch", resource: "http://127.0.0.1:1234/*", effect: "allow", origin: { scope: "shared", source: "opencode.json" } },
          { position: 2, action: "webfetch", resource: "http://127.0.0.1:1234/denied", effect: "deny", origin: { scope: "shared", source: "opencode.json" } },
        ],
      },
    ],
  }

  it("accepts the expected rule effects, positions, and origins", () => {
    expect(
      checkEffectivePolicyRules(policyJson, [
        { action: "webfetch", resource: "http://127.0.0.1:1234/*", effect: "allow", position: 1, originSource: "opencode.json" },
        { action: "webfetch", resource: "http://127.0.0.1:1234/denied", effect: "deny", position: 2, originSource: "opencode.json" },
      ]),
    ).toEqual([])
  })

  it("flags a wrong effect and a wrong position", () => {
    expect(
      checkEffectivePolicyRules(policyJson, [
        { action: "webfetch", resource: "http://127.0.0.1:1234/*", effect: "ask", position: 1, originSource: "opencode.json" },
        { action: "webfetch", resource: "http://127.0.0.1:1234/denied", effect: "deny", position: 5, originSource: "opencode.json" },
      ]),
    ).toEqual([
      "rule webfetch http://127.0.0.1:1234/* effect is allow, expected ask",
      "rule webfetch http://127.0.0.1:1234/denied position is 2, expected 5",
    ])
  })

  it("flags a missing rule and an unknown origin", () => {
    expect(
      checkEffectivePolicyRules(policyJson, [
        { action: "webfetch", resource: "http://127.0.0.1:1234/*", effect: "allow", position: 1, originSource: "managed.json" },
        { action: "shell", resource: "echo missing", effect: "ask", position: 3, originSource: "opencode.json" },
      ]),
    ).toEqual([
      "rule webfetch http://127.0.0.1:1234/* origin source is opencode.json, expected managed.json",
      "rule shell echo missing not found in agent build",
    ])
  })
})

describe("task 09 inventory checks", () => {
  const agents = [
    {
      id: "build",
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "subagent", resource: "*", effect: "deny" },
        { action: "subagent", resource: "explore", effect: "allow" },
        { action: "external_directory", resource: "*", effect: "ask" },
        { action: "external_directory", resource: "/tmp/opencode-permissions/**", effect: "allow" },
        { action: "shell", resource: "git push*", effect: "deny" },
      ],
    },
  ]

  it("accepts winners without the disabled plan agent", () => {
    const cases = [
      { label: "worker dispatch explore", agentId: "build", action: "subagent", resource: "explore", expect: "allow" },
      { label: "worker dispatch other", agentId: "build", action: "subagent", resource: "other", expect: "deny" },
      { label: "external fallback", agentId: "build", action: "external_directory", resource: "/Users/x/secret", expect: "ask" },
      { label: "external exception", agentId: "build", action: "external_directory", resource: "/tmp/opencode-permissions/y", expect: "allow" },
      { label: "unconditional ban", agentId: "build", action: "shell", resource: "git push origin main", expect: "deny" },
      { label: "plan disabled", agentId: "plan", expect: "absent" },
    ]
    expect(checkTask09Winners(agents, cases)).toEqual([])
  })

  it("flags a wrong winner, a matched rule without the expected effect, and a present plan", () => {
    const withPlan = [...agents, { id: "plan", permissions: [] }]
    const cases = [
      { label: "worker dispatch other", agentId: "build", action: "subagent", resource: "other", expect: "allow" },
      { label: "present agent", agentId: "plan", expect: "absent" },
      { label: "missing agent rule", agentId: "build", action: "shell", resource: "never asked", expect: "deny" },
    ]
    expect(checkTask09Winners(withPlan, cases)).toEqual([
      "worker dispatch other: winner is deny, expected allow",
      "present agent: agent plan is present, expected absent",
      "missing agent rule: winner is allow, expected deny",
    ])
  })
})
