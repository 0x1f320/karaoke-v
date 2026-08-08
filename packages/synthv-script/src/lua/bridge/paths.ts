/**
 * Where the channels live. Both sides have to reach the same directory with no
 * configuration, so it is the app's own data directory — and **the app creates
 * it**, not the script: Lua has no mkdir, and the alternative is `os.execute`,
 * which spawns a shell from inside a DAW for the privilege of making one
 * folder. A failed open here simply means the app is not installed or has never
 * run, which the panel reports and the next tick retries.
 */

const DIRECTORY_NAME = "voxpane"
const CHANNEL_DIRECTORY = "bridge"

function isWindows(osType: string): boolean {
  // Destructured on purpose: `string.find` returns two values, and comparing the
  // call itself against undefined compiles to a table comparison that is never
  // nil — which silently picks the wrong platform.
  const [windows] = string.find(string.lower(osType), "win", 1, true)
  return windows !== undefined
}

export function bridgeDirectory(): string | undefined {
  if (isWindows(SV.getHostInfo().osType)) {
    const local = os.getenv("LOCALAPPDATA")
    return local !== undefined ? `${local}\\${DIRECTORY_NAME}\\${CHANNEL_DIRECTORY}` : undefined
  }
  const home = os.getenv("HOME")
  return home !== undefined
    ? `${home}/Library/Application Support/${DIRECTORY_NAME}/${CHANNEL_DIRECTORY}`
    : undefined
}

export function channelPath(directory: string, name: string): string {
  return isWindows(SV.getHostInfo().osType) ? `${directory}\\${name}` : `${directory}/${name}`
}

export interface PipeEndpoints {
  session: string
  state: string
  scroll: string
  notes: string
}

export function endpointPaths(osType: string, directory: string, session: string): PipeEndpoints {
  if (isWindows(osType)) {
    const prefix = `\\\\.\\pipe\\voxpane-${session}`
    return {
      session,
      state: `${prefix}-state`,
      scroll: `${prefix}-scroll`,
      notes: `${prefix}-notes`,
    }
  }

  const prefix = `${directory}/pipe-${session}`
  return {
    session,
    state: `${prefix}-state`,
    scroll: `${prefix}-scroll`,
    notes: `${prefix}-notes`,
  }
}
