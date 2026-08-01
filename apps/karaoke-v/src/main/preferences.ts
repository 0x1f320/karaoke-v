import fs from "node:fs"
import path from "node:path"
import { app, BrowserWindow, ipcMain } from "electron"
import { DEFAULT_PREFERENCES, type Preferences, sanitizePreferences } from "../shared/preferences"

// Preferences live in a JSON file under userData, so they survive restarts.
// The file is read once into memory; each update rewrites it and pushes the new
// state to every window.

const FILE_NAME = "preferences.json"

let cache: Preferences | null = null

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
  cache = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(stored) }
  return cache
}

export function getPreferences(): Preferences {
  return load()
}

export function updatePreferences(patch: unknown): Preferences {
  const next = { ...load(), ...sanitizePreferences(patch) }
  cache = next

  try {
    fs.writeFileSync(filePath(), `${JSON.stringify(next, null, 2)}\n`)
  } catch (error) {
    // Keep the in-memory value; it just will not survive a restart.
    console.error("failed to persist preferences:", error)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("preferences:changed", next)
    }
  }
  return next
}

export function registerPreferencesIpc(): void {
  ipcMain.handle("preferences:get", () => getPreferences())
  ipcMain.handle("preferences:update", (_event, patch: unknown) => updatePreferences(patch))
}
