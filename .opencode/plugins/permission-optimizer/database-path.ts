import { homedir } from "node:os"
import { join } from "node:path"
import { platform } from "node:process"

const DATABASE_FILENAME = "observations.sqlite"

/**
 * Resolves the database path from the `OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH`
 * environment variable when set, or returns the platform-specific default:
 * - macOS: `~/Library/Application Support/opencode/permission-optimizer/observations.sqlite`
 * - Linux: `${XDG_DATA_HOME:-~/.local/share}/opencode/permission-optimizer/observations.sqlite`
 * - Windows: `%LOCALAPPDATA%\opencode\permission-optimizer\observations.sqlite`
 */
export function resolveDatabasePath(): string {
  const envOverride = process.env.OPENCODE_PERMISSION_OPTIMIZER_DATABASE_PATH
  if (envOverride && envOverride.length > 0) return envOverride

  const base = getDefaultBaseDirectory()
  return join(base, "opencode", "permission-optimizer", DATABASE_FILENAME)
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
