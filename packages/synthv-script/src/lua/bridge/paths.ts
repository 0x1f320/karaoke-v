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

// Destructured on purpose: `string.find` returns two values, and comparing the
// call itself against undefined compiles to a table comparison that is never
// nil — which silently picks the wrong platform.
const [WINDOWS] = string.find(string.lower(SV.getHostInfo().osType), "win", 1, true)
const IS_WINDOWS = WINDOWS !== undefined

export function bridgeDirectory(): string | undefined {
  if (IS_WINDOWS) {
    const local = os.getenv("LOCALAPPDATA")
    return local !== undefined ? `${local}\\${DIRECTORY_NAME}\\${CHANNEL_DIRECTORY}` : undefined
  }
  const home = os.getenv("HOME")
  return home !== undefined
    ? `${home}/Library/Application Support/${DIRECTORY_NAME}/${CHANNEL_DIRECTORY}`
    : undefined
}

export function channelPath(directory: string, name: string): string {
  return IS_WINDOWS ? `${directory}\\${name}` : `${directory}/${name}`
}
