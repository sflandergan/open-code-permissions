import { describe, expect, it } from "bun:test"
import {
  createSmokeRouterState,
  DENIED_BODY,
  INTRO_BODY,
  parseTarballName,
  routeSmokeRequest,
  SETUP_BODY,
  smokeHits,
  smokeStats,
  type SmokeRequest,
} from "./local-web-server"

const TARBALL_NAME = "opencode-permissions-0.1.0.tgz"
const TARBALL_BYTES = new Uint8Array([1, 2, 3, 4, 5])

function makeState() {
  return createSmokeRouterState({ tarballName: TARBALL_NAME, tarballBytes: TARBALL_BYTES })
}

function get(state: ReturnType<typeof makeState>, path: string) {
  const request: SmokeRequest = { method: "GET", rawPath: path }
  return { response: routeSmokeRequest(state, request), request }
}

describe("smoke web server routing", () => {
  it("serves the packed tarball bytes", () => {
    const state = makeState()
    const { response } = get(state, `/${TARBALL_NAME}`)
    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toBe("application/octet-stream")
    expect(new Uint8Array(response.body as Uint8Array)).toEqual(TARBALL_BYTES)
  })

  it("serves the three fixture pages as text", () => {
    const state = makeState()
    expect(get(state, "/intro").response).toMatchObject({ status: 200, body: INTRO_BODY })
    expect(get(state, "/setup").response).toMatchObject({ status: 200, body: SETUP_BODY })
    expect(get(state, "/denied").response).toMatchObject({ status: 200, body: DENIED_BODY })
  })

  it("serves the two redirect endpoints", () => {
    const state = makeState()
    expect(get(state, "/redirect-ask").response).toMatchObject({ status: 302, headers: { location: "/intro" } })
    expect(get(state, "/redirect-denied").response).toMatchObject({ status: 302, headers: { location: "/denied" } })
  })

  it("counts a hit for every served path and strips the query string", () => {
    const state = makeState()
    get(state, "/intro?x=1")
    get(state, "/redirect-ask")
    get(state, `/${TARBALL_NAME}`)
    expect(smokeStats(state)).toEqual({
      "/intro": 1,
      "/redirect-ask": 1,
      ["/" + TARBALL_NAME]: 1,
    })
    expect(smokeHits(state)).toHaveLength(3)
    expect(smokeHits(state)[0]).toMatchObject({ path: "/intro", status: 200 })
  })

  it("answers unknown paths with a counted 404", () => {
    const state = makeState()
    const { response } = get(state, "/nope")
    expect(response.status).toBe(404)
    expect(smokeStats(state)).toEqual({ "/nope": 1 })
  })

  it("answers the stats endpoint without recording a hit", () => {
    const state = makeState()
    get(state, "/intro")
    get(state, "/intro")
    expect(get(state, "/__stats").response.status).toBe(200)
    expect(smokeStats(state)).toEqual({ "/intro": 2 })
  })

  it("answers non-GET methods with an uncounted 405", () => {
    const state = makeState()
    const response = routeSmokeRequest(state, { method: "POST", rawPath: "/intro" })
    expect(response.status).toBe(405)
    expect(smokeStats(state)).toEqual({})
  })

  it("parses the package identity from the tarball filename", () => {
    expect(parseTarballName("opencode-permissions-0.1.0.tgz")).toEqual({
      name: "opencode-permissions",
      version: "0.1.0",
    })
    expect(parseTarballName("weird-name-2-name-1.2.3-rc.1.tgz")).toEqual({
      name: "weird-name-2-name",
      version: "1.2.3-rc.1",
    })
    expect(parseTarballName("nogroup.tgz")).toEqual({ name: "nogroup", version: "" })
  })

  it("serves the registry packument without a served origin until one is set", () => {
    const state = makeState()
    const first = get(state, "/opencode-permissions").response
    expect(first.status).toBe(200)
    const packument = JSON.parse(String(first.body)) as { versions: Record<string, { dist: { tarball: string } }> }
    expect(packument.versions["0.1.0"].dist.tarball).toBe("http://127.0.0.1/opencode-permissions-0.1.0.tgz")
    state.config.servedOrigin = "http://127.0.0.1:62213"
    const updated = JSON.parse(String(get(state, "/opencode-permissions").response.body)) as {
      versions: Record<string, { dist: { tarball: string } }>
    }
    expect(updated.versions["0.1.0"].dist.tarball).toBe("http://127.0.0.1:62213/opencode-permissions-0.1.0.tgz")
  })
})
