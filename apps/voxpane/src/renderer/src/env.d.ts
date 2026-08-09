import type { AudioMeterSnapshot } from "../../shared/audioMeter"
import type { BridgeSchedule, BridgeState } from "../../shared/bridgeChannels"
import type { BridgeDiagnostics } from "../../shared/bridgeDiagnostics"
import type { CanvasSnapshot } from "../../shared/geometry"
import type { PermissionKey, PermissionsStatus } from "../../shared/permissions"
import type { Preferences, PreferencesPatch } from "../../shared/preferences"

declare global {
  interface Window {
    overlay: {
      getCanvasAsync(): Promise<CanvasSnapshot | null>
    }
    audioMeter: {
      start(): Promise<AudioMeterSnapshot>
      stop(): Promise<AudioMeterSnapshot>
      read(): Promise<AudioMeterSnapshot>
    }
    bridge: {
      /** The hot channel: playhead, transport and view transform. Safe per-frame. */
      readState(): BridgeState | null
      /** The note schedule. Only worth reading when readState's notesSeq changes. */
      readSchedule(notesSeq: number): BridgeSchedule | null
      readDiagnostics(): BridgeDiagnostics
      setDiagnosticsEnabled(enabled: boolean): void
      /** Monotonic clock shared with native geometry reads, for measuring age. */
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
    debug: {
      /** Report a debug-only latency summary outside the renderer console. */
      latency(line: string): void
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
