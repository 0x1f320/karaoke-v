import { homedir } from "node:os"
import { join } from "node:path"
import { RENDEZVOUS_FILE } from "./bridgeRendezvous"
import { isWindows } from "./native"

// Where the script and the app meet. It has to be reachable from both with no
// configuration, and **the app creates it**: the script runs inside SynthV's Lua
// host, which has no mkdir, and the only alternative there is spawning a shell.

const APP_DIRECTORY = "voxpane"

export function bridgeDirectory(): string {
  if (isWindows) {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(local, APP_DIRECTORY, "bridge")
  }
  return join(homedir(), "Library", "Application Support", APP_DIRECTORY, "bridge")
}

export function rendezvousPath(directory = bridgeDirectory()): string {
  return join(directory, RENDEZVOUS_FILE)
}

export const CHANNEL_STATE = "state"
export const CHANNEL_SCROLL = "scroll"
export const CHANNEL_NOTES = "notes"
