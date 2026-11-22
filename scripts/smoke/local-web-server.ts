#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The `/__stats` endpoint is the only uncounted path. */
export const STATS_PATH = "/__stats"

/** Fixture page bodies; the owner approves each direct page once. */
export const INTRO_BODY = "smoke intro page"
export const SETUP_BODY = "smoke setup page"
export const DENIED_BODY = "smoke denied page"

/** One served request recorded in the run's `hits.jsonl`. */
export type SmokeHitRecord = {
  path: string
  status: number
  at: string
}

/** The tarball served for package-route plugin discovery. */
export type SmokeRouteConfig = {
  tarballName: string
  tarballBytes: Uint8Array
  /**
   * Absolute origin npm resolves packument tarball URLs against; the server
   * sets it once the ephemeral port is known. The packument route serves the
   * registry-style package metadata the pinned runtime's installer needs.
   */
  servedOrigin?: string
}

/** Package name and version parsed from the packed tarball filename. */
export type SmokePackageIdentity = {
  name: string
  version: string
}

/**
 * Parses `name-version.tgz` from an npm pack filename. The version block
 * starts at the last dash-separated group beginning with a digit; smoke
 * tarballs always end in a semver-style group.
 */
export function parseTarballName(tarballName: string): SmokePackageIdentity {
  const stem = tarballName.replace(/\.tgz$/, "")
  const groups = stem.split("-")
  let versionAt = -1
  for (let index = groups.length - 1; index > 0; index--) {
    if (/^[0-9]/.test(groups[index])) {
      versionAt = index
      break
    }
  }
  if (versionAt === -1) {
    return { name: stem, version: "" }
  }
  return { name: groups.slice(0, versionAt).join("-"), version: groups.slice(versionAt).join("-") }
}

/** Mutable router state: the tarball plus the in-memory hit journal. */
export type SmokeRouterState = {
  config: SmokeRouteConfig
  hits: SmokeHitRecord[]
}

/** A routed response; `body` is text or raw bytes. */
export type SmokeResponse = {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
}

/** A request as the router sees it: method plus path with query string. */
export type SmokeRequest = {
  method: string
  rawPath: string
}

/**
 * Creates the mutable router state for one smoke run. The tarball is read
 * once; every served request appends one hit record.
 */
export function createSmokeRouterState(config: SmokeRouteConfig): SmokeRouterState {
  return { config, hits: [] }
}

/**
 * Routes one request, recording a hit for every `GET` path other than the
 * stats endpoint. The returned response never includes redirect or page
 * content beyond the fixed smoke fixtures.
 */
export function routeSmokeRequest(state: SmokeRouterState, request: SmokeRequest): SmokeResponse {
  const path = stripQuery(request.rawPath)
  if (request.method !== "GET") {
    return text(405, "method not allowed")
  }
  if (path === STATS_PATH) {
    return json(200, countHitPaths(state.hits))
  }
  const response = routePath(state.config, path)
  state.hits.push({ path, status: response.status, at: new Date().toISOString() })
  return response
}

/** Hit counts per served path, excluding the stats endpoint itself. */
export function smokeStats(state: SmokeRouterState): Record<string, number> {
  return countHitPaths(state.hits)
}

/** The full hit journal in served order. */
export function smokeHits(state: SmokeRouterState): SmokeHitRecord[] {
  return state.hits
}

function routePath(config: SmokeRouteConfig, path: string): SmokeResponse {
  if (path === `/${config.tarballName}`) {
    return { status: 200, headers: { "content-type": "application/octet-stream" }, body: config.tarballBytes }
  }
  const identity = parseTarballName(config.tarballName)
  if (identity.version !== "" && path === `/${identity.name}`) {
    return json(200, buildPackument(config, identity))
  }
  if (path === "/intro") return text(200, INTRO_BODY)
  if (path === "/setup") return text(200, SETUP_BODY)
  if (path === "/denied") return text(200, DENIED_BODY)
  if (path === "/redirect-ask") return redirect("/intro")
  if (path === "/redirect-denied") return redirect("/denied")
  return text(404, "not found")
}

/**
 * The minimal npm packument npm's installer needs: one version whose dist
 * tarball points back at this server's served tarball.
 */
function buildPackument(config: SmokeRouteConfig, identity: SmokePackageIdentity): Record<string, unknown> {
  const origin = config.servedOrigin ?? "http://127.0.0.1"
  const manifest = {
    name: identity.name,
    version: identity.version,
    dist: { tarball: `${origin}/${config.tarballName}` },
  }
  return {
    name: identity.name,
    "dist-tags": { latest: identity.version },
    versions: { [identity.version]: manifest },
  }
}

/** Counts hits per path, preserving first-seen order. */
export function countHitPaths(records: Array<{ path: string }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) counts[record.path] = (counts[record.path] ?? 0) + 1
  return counts
}

function stripQuery(rawPath: string): string {
  const queryAt = rawPath.indexOf("?")
  return queryAt === -1 ? rawPath : rawPath.slice(0, queryAt)
}

function text(status: number, body: string): SmokeResponse {
  return { status, headers: { "content-type": "text/plain" }, body }
}

function json(status: number, value: unknown): SmokeResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) }
}

function redirect(location: string): SmokeResponse {
  return { status: 302, headers: { location }, body: "" }
}

/**
 * Runs the smoke web server for one disposable run directory. Binds only
 * `127.0.0.1` on an ephemeral port, writes `web-server.json` (port, pid,
 * tarball) once listening, and appends the same hit records the router
 * keeps in memory to `hits.jsonl` in the run directory.
 */
async function main(): Promise<void> {
  const runDir = requireArgument("--run-dir")
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as { tarballName: string; serverToken: string }
  const tarballBytes = new Uint8Array(readFileSync(join(runDir, run.tarballName)))
  const state = createSmokeRouterState({ tarballName: run.tarballName, tarballBytes })

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url)
      const response = routeSmokeRequest(state, { method: request.method, rawPath: url.pathname + url.search })
      const hit = [...state.hits].at(-1)
      if (hit) appendFileSync(join(runDir, "hits.jsonl"), `${JSON.stringify(hit)}\n`)
      if (typeof response.body === "string") {
        return new Response(response.body, { status: response.status, headers: response.headers })
      }
      return new Response(new Uint8Array(response.body), { status: response.status, headers: response.headers })
    },
  })

  writeFileSync(
    join(runDir, "web-server.json"),
    `${JSON.stringify({ port: server.port, pid: process.pid, token: run.serverToken })}\n`,
  )
  state.config.servedOrigin = `http://127.0.0.1:${server.port}`
  process.on("SIGTERM", () => {
    server.stop(true)
    process.exit(0)
  })
}

function requireArgument(flag: string): string {
  const at = process.argv.indexOf(flag)
  if (at === -1 || process.argv[at + 1] === undefined) {
    process.stderr.write(`usage: bun local-web-server.ts --run-dir <path>\n`)
    process.exit(2)
  }
  return process.argv[at + 1]
}

if (import.meta.main) {
  await main()
}
