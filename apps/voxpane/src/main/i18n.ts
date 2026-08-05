import { app, ipcMain } from "electron"
import { createI18n } from "../shared/i18n"
import { FALLBACK_LANGUAGE, type Language, resolveLanguage } from "../shared/language"
import { getPreferences, onPreferencesChanged } from "./preferences"

// The main process's own i18next instance: the tray menu, its notification and
// the settings window title are all built here, outside React.

let instance = createI18n(FALLBACK_LANGUAGE)
const listeners = new Set<() => void>()

/**
 * Menus and window titles are built once and then live on, so anything that
 * spelled a string has to be told to spell it again.
 */
export function onLanguageChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function language(): Language {
  return resolveLanguage(getPreferences().language, app.getPreferredSystemLanguages())
}

/** Call once "ready" has fired: app.getPreferredSystemLanguages needs it. */
export function initI18n(): void {
  instance = createI18n(language())
  // Every renderer resolves its own language, and only main can say what the OS
  // asked for.
  ipcMain.handle("i18n:systemLanguages", () => app.getPreferredSystemLanguages())
  onPreferencesChanged(() => {
    const next = language()
    if (next !== instance.language) {
      instance.changeLanguage(next)
      for (const listener of listeners) {
        listener()
      }
    }
  })
}

export function t(key: string, options?: Record<string, unknown>): string {
  return instance.t(key, options)
}
