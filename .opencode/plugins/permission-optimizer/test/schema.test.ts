import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { readSchemaSql, SCHEMA_VERSION } from "../src/schema"

function openTestDb(): Database {
  const db = new Database(":memory:", { create: true })
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(readSchemaSql())
  return db
}

const VALID_UTC = "2026-08-05T10:00:00.000Z"
const VALID_UTC_2 = "2026-08-05T11:00:00.000Z"
const VALID_UTC_3 = "2026-08-05T12:00:00.000Z"

function insertMetadata(db: Database): void {
  db.run("INSERT INTO schema_metadata (id, version) VALUES (1, ?)", [SCHEMA_VERSION])
}

function insertAskedObservation(
  db: Database,
  overrides: Record<string, string | number | null> = {},
): number {
  const defaults: Record<string, string | number | null> = {
    request_id: "req_001",
    session_id: "sess_001",
    worktree: "/home/user/project",
    permission: "bash",
    asked_at: VALID_UTC,
  }
  const row = { ...defaults, ...overrides }
  const cols = Object.keys(row)
  const placeholders = cols.map(() => "?").join(", ")
  const result = db.run(
    `INSERT INTO observations (${cols.join(", ")}) VALUES (${placeholders})`,
    Object.values(row),
  )
  return Number(result.lastInsertRowid)
}

function insertInput(
  db: Database,
  observationId: number,
  inputIndex: number,
  exactInput: string,
): void {
  db.run(
    "INSERT INTO requested_patterns (observation_id, pattern_index, pattern) VALUES (?, ?, ?)",
    [observationId, inputIndex, exactInput],
  )
}

function getObservation(db: Database, requestId: string): Record<string, unknown> {
  return db.query("SELECT * FROM observations WHERE request_id = ?").get(requestId) as Record<string, unknown>
}

describe("schema_metadata", () => {
  let db: Database

  beforeEach(() => {
    db = openTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test("accepts a valid schema version row", () => {
    insertMetadata(db)
    const row = db.query("SELECT * FROM schema_metadata WHERE id = 1").get() as Record<string, unknown>
    expect(row.id).toBe(1)
    expect(row.version).toBe(SCHEMA_VERSION)
    expect(typeof row.created_at).toBe("string")
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  test("rejects id that is not 1", () => {
    expect(() => {
      db.run("INSERT INTO schema_metadata (id, version) VALUES (2, ?)", [SCHEMA_VERSION])
    }).toThrow()
  })

  test("rejects a second row", () => {
    insertMetadata(db)
    expect(() => {
      db.run("INSERT INTO schema_metadata (id, version) VALUES (1, ?)", [SCHEMA_VERSION])
    }).toThrow()
  })

  test("rejects a non-canonical creation timestamp", () => {
    expect(() => {
      db.run(
        "INSERT INTO schema_metadata (id, version, created_at) VALUES (1, ?, '2026-08-05 10:00:00')",
        [SCHEMA_VERSION],
      )
    }).toThrow()
  })
})

describe("observations", () => {
  let db: Database

  beforeEach(() => {
    db = openTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test("inserts a valid pending observation", () => {
    const id = insertAskedObservation(db)
    expect(id).toBeGreaterThan(0)
    const row = getObservation(db, "req_001")
    expect(row.request_id).toBe("req_001")
    expect(row.session_id).toBe("sess_001")
    expect(row.message_id).toBeNull()
    expect(row.call_id).toBeNull()
    expect(row.repository_identity).toBeNull()
    expect(row.worktree).toBe("/home/user/project")
    expect(row.agent).toBeNull()
    expect(row.permission).toBe("bash")
    expect(row.asked_at).toBe(VALID_UTC)
    expect(row.decision).toBeNull()
    expect(row.decided_at).toBeNull()
    expect(row.tool).toBeNull()
    expect(row.execution).toBeNull()
    expect(row.exit_code).toBeNull()
    expect(row.completed_at).toBeNull()
    expect(row.qualifying_approval).toBe(0)
  })

  test("inserts a once decision with every field populated", () => {
    insertAskedObservation(db, {
      request_id: "req_once",
      message_id: "msg_001",
      call_id: "call_001",
      repository_identity: "github.com/user/repo",
      agent: "implement",
      decision: "once",
      decided_at: VALID_UTC_2,
      tool: "bash",
      execution: "success",
      exit_code: 0,
      completed_at: VALID_UTC_3,
    })
    const row = getObservation(db, "req_once")
    expect(row.decision).toBe("once")
    expect(row.qualifying_approval).toBe(1)
    expect(row.execution).toBe("success")
    expect(row.exit_code).toBe(0)
  })

  test("inserts an always-derived observation", () => {
    insertAskedObservation(db, {
      request_id: "req_derived",
      decision: "always-derived",
      decided_at: VALID_UTC_2,
    })
    const row = getObservation(db, "req_derived")
    expect(row.decision).toBe("always-derived")
    expect(row.qualifying_approval).toBe(0)
  })

  test("inserts an unresolved observation with a decision time", () => {
    insertAskedObservation(db, {
      request_id: "req_unresolved",
      decision: "unresolved",
      decided_at: VALID_UTC_2,
    })
    const row = getObservation(db, "req_unresolved")
    expect(row.decision).toBe("unresolved")
  })

  test("inserts an unresolved observation without a decision time", () => {
    insertAskedObservation(db, {
      request_id: "req_unresolved_null",
      decision: "unresolved",
    })
    const row = getObservation(db, "req_unresolved_null")
    expect(row.decision).toBe("unresolved")
    expect(row.decided_at).toBeNull()
  })

  test("counts no qualifying approval for a rejected request", () => {
    insertAskedObservation(db, {
      request_id: "req_reject",
      repository_identity: "github.com/user/repo",
      agent: "implement",
      decision: "reject",
      decided_at: VALID_UTC_2,
      tool: "bash",
      execution: "success",
      exit_code: 0,
      completed_at: VALID_UTC_3,
    })
    expect(getObservation(db, "req_reject").qualifying_approval).toBe(0)
  })

  test("counts no qualifying approval when execution is not success", () => {
    insertAskedObservation(db, {
      request_id: "req_fail",
      repository_identity: "github.com/user/repo",
      agent: "implement",
      decision: "once",
      decided_at: VALID_UTC_2,
      tool: "bash",
      execution: "failure",
      exit_code: 1,
      completed_at: VALID_UTC_3,
    })
    expect(getObservation(db, "req_fail").qualifying_approval).toBe(0)
  })

  test("counts no qualifying approval when the agent is absent", () => {
    insertAskedObservation(db, {
      request_id: "req_noagent",
      repository_identity: "github.com/user/repo",
      decision: "once",
      decided_at: VALID_UTC_2,
      tool: "edit",
      execution: "success",
      completed_at: VALID_UTC_3,
    })
    expect(getObservation(db, "req_noagent").qualifying_approval).toBe(0)
  })

  test("rejects a duplicate request identifier", () => {
    insertAskedObservation(db)
    expect(() => {
      insertAskedObservation(db)
    }).toThrow()
  })

  test("rejects invalid decision enum", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bad_decision",
        decision: "maybe",
        decided_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects invalid execution enum", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bad_exec",
        tool: "bash",
        execution: "unknown",
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects a decision without a decision time", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_no_decided_at",
        decision: "once",
      })
    }).toThrow()
  })

  test("rejects a decision time without a decision unless unresolved", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_no_decision",
        decided_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects tool without execution", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_tool_no_exec",
        tool: "bash",
      })
    }).toThrow()
  })

  test("rejects execution without tool", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_exec_no_tool",
        execution: "success",
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects bash success with nonzero exit code", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bash_success_bad_exit",
        tool: "bash",
        execution: "success",
        exit_code: 1,
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects bash success with null exit code", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bash_success_null_exit",
        tool: "bash",
        execution: "success",
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects bash failure with zero exit code", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bash_fail_zero",
        tool: "bash",
        execution: "failure",
        exit_code: 0,
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects bash failure with null exit code", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bash_fail_null",
        tool: "bash",
        execution: "failure",
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects non-bash tool with exit code", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_edit_exit",
        tool: "edit",
        execution: "success",
        exit_code: 0,
        completed_at: VALID_UTC_2,
      })
    }).toThrow()
  })

  test("rejects an invalid asked time format", () => {
    expect(() => {
      insertAskedObservation(db, {
        request_id: "req_bad_ts",
        asked_at: "2026-08-05 10:00:00",
      })
    }).toThrow()
  })

  test("rejects an empty request identifier", () => {
    expect(() => {
      insertAskedObservation(db, { request_id: "" })
    }).toThrow()
  })

  test("rejects an empty session identifier", () => {
    expect(() => {
      insertAskedObservation(db, { request_id: "r2", session_id: "" })
    }).toThrow()
  })

  test("rejects empty worktree", () => {
    expect(() => {
      insertAskedObservation(db, { request_id: "r3", worktree: "" })
    }).toThrow()
  })

  test("rejects empty permission", () => {
    expect(() => {
      insertAskedObservation(db, { request_id: "r4", permission: "" })
    }).toThrow()
  })

  test("accepts bash incomplete with null exit code", () => {
    insertAskedObservation(db, {
      request_id: "req_bash_incomplete",
      tool: "bash",
      execution: "incomplete",
      completed_at: VALID_UTC_2,
    })
    const row = getObservation(db, "req_bash_incomplete")
    expect(row.execution).toBe("incomplete")
    expect(row.exit_code).toBeNull()
  })

  test("accepts non-bash success with null exit code", () => {
    insertAskedObservation(db, {
      request_id: "req_edit_success",
      tool: "edit",
      execution: "success",
      completed_at: VALID_UTC_2,
    })
    const row = getObservation(db, "req_edit_success")
    expect(row.execution).toBe("success")
    expect(row.exit_code).toBeNull()
  })
})

describe("requested_patterns", () => {
  let db: Database

  beforeEach(() => {
    db = openTestDb()
  })

  afterEach(() => {
    db.close()
  })

  test("inserts ordered inputs for one observation", () => {
    const id = insertAskedObservation(db)
    insertInput(db, id, 0, "git status")
    insertInput(db, id, 1, "git diff")

    const rows = db
      .query("SELECT * FROM requested_patterns WHERE observation_id = ? ORDER BY pattern_index")
      .all(id) as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0].pattern_index).toBe(0)
    expect(rows[0].pattern).toBe("git status")
    expect(rows[1].pattern_index).toBe(1)
    expect(rows[1].pattern).toBe("git diff")
  })

  test("rejects a negative input position", () => {
    const id = insertAskedObservation(db)
    expect(() => {
      insertInput(db, id, -1, "git status")
    }).toThrow()
  })

  test("rejects an empty input value", () => {
    const id = insertAskedObservation(db)
    expect(() => {
      insertInput(db, id, 0, "")
    }).toThrow()
  })

  test("rejects an input for an observation that does not exist", () => {
    expect(() => {
      insertInput(db, 999, 0, "git status")
    }).toThrow()
  })

  test("allows duplicate input values at different positions", () => {
    const id = insertAskedObservation(db)
    insertInput(db, id, 0, "git status")
    insertInput(db, id, 1, "git status")
    const rows = db
      .query("SELECT * FROM requested_patterns WHERE observation_id = ? ORDER BY pattern_index")
      .all(id) as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
  })

  test("deletes an observation's inputs when the observation is deleted", () => {
    const id = insertAskedObservation(db)
    insertInput(db, id, 0, "git status")
    db.run("DELETE FROM observations WHERE id = ?", [id])
    const rows = db
      .query("SELECT * FROM requested_patterns WHERE observation_id = ?")
      .all(id) as Record<string, unknown>[]
    expect(rows).toHaveLength(0)
  })
})

test("current schema has no review_checkpoints table", () => {
  const db = openTestDb()
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_checkpoints'").get()
  expect(row).toBeNull()
  db.close()
})
