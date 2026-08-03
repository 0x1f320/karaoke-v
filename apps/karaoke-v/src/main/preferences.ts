import fs from "node:fs"
import path from "node:path"
import { app, BrowserWindow, ipcMain } from "electron"
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  type Preferences,
  sanitizePreferences,
} from "../shared/preferences"

// Preferences live in a JSON file under userData, so they survive restarts.
// The file is read once into memory; each update pushes the new state to every
// window at once and rewrites the file shortly after.

const FILE_NAME = "preferences.json"

/**
 * How long a write may lag the value. Effect settings are live now — a slider
 * drag is an update per frame, and each one is a synchronous write on the main
 * thread. Trailing-edge only, and the timer is not restarted by later updates,
 * so a continuous drag still lands every WRITE_DELAY_MS rather than only once
 * the user lets go.
 */
const WRITE_DELAY_MS = 400

let cache: Preferences | null = null
let writeTimer: NodeJS.Timeout | null = null
const listeners = new Set<(preferences: Preferences) => void>()

/** For main-process consumers, which do not receive the renderer broadcast. */
export function onPreferencesChanged(listener: (preferences: Preferences) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function filePath(): string {
  return path.join(app.getPath("userData"), FILE_NAME)
}

function load(): Preferences {
  if (cache) {
    return cache
  }
  let stored: unknown
  try {
    stored = JSON.parse(fs.readFileSync(filePath(), "utf8"))
  } catch {
    // No file yet, or it is unreadable/corrupt — fall back to the defaults.
  }
  cache = mergePreferences(DEFAULT_PREFERENCES, sanitizePreferences(stored))
  return cache
}

export function getPreferences(): Preferences {
  return load()
}

/** Write now, if anything is owed. Safe to call with nothing pending. */
export function flushPreferences(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!cache) {
    return
  }
  try {
    fs.writeFileSync(filePath(), `${JSON.stringify(cache, null, 2)}\n`)
  } catch (error) {
    // Keep the in-memory value; it just will not survive a restart.
    console.error("failed to persist preferences:", error)
  }
}

export function updatePreferences(patch: unknown): Preferences {
  const next = mergePreferences(load(), sanitizePreferences(patch))
  cache = next

  if (!writeTimer) {
    writeTimer = setTimeout(flushPreferences, WRITE_DELAY_MS)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("preferences:changed", next)
    }
  }
  for (const listener of listeners) {
    listener(next)
  }
  return next
}

export function registerPreferencesIpc(): void {
  ipcMain.handle("preferences:get", () => getPreferences())
  ipcMain.handle("preferences:update", (_event, patch: unknown) => updatePreferences(patch))
  // Quitting mid-delay must not lose the last few hundred ms of tuning.
  app.on("will-quit", flushPreferences)
}
