import type { BridgeSchedule, BridgeState } from "../../shared/bridgeChannels"
import type { PianoRoll, Viewport } from "../../shared/geometry"
import type { PermissionKey, PermissionsStatus } from "../../shared/permissions"
import type { Preferences, PreferencesPatch } from "../../shared/preferences"

declare global {
  interface Window {
    overlay: {
      /** Cheap atomic viewport read (canvas rect + scroll/zoom) — safe per-frame. */
      getViewport(): Viewport | null
      /** Full off-thread AX walk (~5-10ms) returning the visible notes. */
      readNotes(): Promise<PianoRoll | null>
    }
    bridge: {
      /** The hot channel: playhead, transport and view transform. Safe per-frame. */
      readState(): BridgeState | null
      /** The note schedule. Only worth reading when readState's notesSeq changes. */
      readSchedule(): BridgeSchedule | null
      /** Monotonic clock shared with the AX reads, for measuring a read's age. */
      monotonicNow(): number
    }
    settings: {
      /** Open the settings window, or focus it if it is already open. */
      open(): Promise<void>
      /** Close the settings window. */
      close(): Promise<void>
      /** Whether the settings window hides the system caption and expects its own. */
      customTitleBar: boolean
    }
    panel: {
      /**
       * Fit the toolbar window to this content height. The window stays hidden
       * until the first call, so the placeholder size is never shown.
       */
      resize(height: number): Promise<void>
    }
    app: {
      /** Quit the whole app — the toolbar, the overlay and the tray go with it. */
      quit(): Promise<void>
    }
    permissions: {
      /** Current grant status. */
      get(): Promise<PermissionsStatus>
      /** Open the System Settings pane this permission is granted from. */
      openSettings(key: PermissionKey): Promise<void>
      /** Leave the gate and start the app. Ignored while still untrusted. */
      proceed(): Promise<void>
      /** Fit the window to this content height, within the gate's own limits. */
      resize(height: number): Promise<void>
      /** Subscribe to grant changes. Returns an unsubscribe function. */
      onChange(callback: (status: PermissionsStatus) => void): () => void
    }
    assets: {
      /**
       * Ask for an image, and keep a copy of the chosen one. Resolves to its
       * stored name, or null if the dialog was dismissed.
       */
      import(): Promise<string | null>
    }
    i18n: {
      /**
       * The OS's preferred languages, most wanted first. Chromium's own
       * navigator.languages does not follow them, so main is asked instead.
       */
      systemLanguages(): Promise<string[]>
    }
    preferences: {
      /** Current persisted preferences. */
      get(): Promise<Preferences>
      /** Merge a patch into the stored preferences and broadcast the result. */
      update(patch: PreferencesPatch): Promise<Preferences>
      /** Subscribe to updates from any window. Returns an unsubscribe function. */
      onChange(callback: (prefs: Preferences) => void): () => void
    }
  }
}
