import type { PianoRoll, Viewport } from "@karaoke-v/macos-helper"
import type { Preferences } from "../../shared/preferences"

declare global {
  interface Window {
    overlay: {
      /** Cheap atomic viewport read (canvas rect + scroll/zoom) — safe per-frame. */
      getViewport(): Viewport | null
      /** Full off-thread AX walk (~5-10ms) returning the visible notes. */
      readNotes(): Promise<PianoRoll | null>
    }
    settings: {
      /** Open the settings window, or focus it if it is already open. */
      open(): Promise<void>
    }
    preferences: {
      /** Current persisted preferences. */
      get(): Promise<Preferences>
      /** Merge a patch into the stored preferences and broadcast the result. */
      update(patch: Partial<Preferences>): Promise<Preferences>
      /** Subscribe to updates from any window. Returns an unsubscribe function. */
      onChange(callback: (prefs: Preferences) => void): () => void
    }
  }
}
