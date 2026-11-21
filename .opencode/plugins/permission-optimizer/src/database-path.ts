import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { platform } from "node:process"
import { toAbsolutePath } from "./absolute-path"
import type { AbsolutePath } from "./absolute-path"

const DATABASE_FILENAME = "observations.sqlite"

/**
 * Resolves the observation database path as an absolute path from the
 * `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH` environment variable when set,
 * or the platform-specific default:
 * - macOS: `~/Library/Application Support/opencode/permission-optimizer/observations.sqlite`
 * - Linux: `${XDG_DATA_HOME:-~/.local/share}/opencode/permission-optimizer/observations.sqlite`
 * - Windows: `%LOCALAPPDATA%\opencode\permission-optimizer\observations.sqlite`
 *
 * A relative environment override is resolved against the process directory,
 * matching how SQLite would open it; the resulting path must be absolute.
 */
export function resolveDatabasePath(): AbsolutePath {
  const envOverride = process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
  if (envOverride && envOverride.length > 0) {
    return toAbsolutePath(resolve(envOverride), "database path")
  }

  const base = getDefaultBaseDirectory()
  return toAbsolutePath(join(base, "opencode", "permission-optimizer", DATABASE_FILENAME), "database path")
}

function getDefaultBaseDirectory(): string {
  switch (platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support")
    case "win32":
      return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    default: {
      const xdg = process.env.XDG_DATA_HOME
      if (xdg && xdg.length > 0) return xdg
      return join(homedir(), ".local", "share")
    }
  }
}
