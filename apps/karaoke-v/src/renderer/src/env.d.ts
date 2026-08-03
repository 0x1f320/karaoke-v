import type { BridgeMessage } from "../../shared/bridge"
import type { PianoRoll, Viewport } from "../../shared/geometry"
import type { PermissionsStatus } from "../../shared/permissions"
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
      /** Most recent payload, so a window opening mid-playback can catch up. */
      last(): Promise<BridgeMessage | null>
      /** The clock payloads are stamped with — subtract to get a payload's age. */
      monotonicNow(): number
      /** Subscribe to payloads. Returns an unsubscribe function. */
      onPayload(callback: (message: BridgeMessage) => void): () => void
    }
    settings: {
      /** Open the settings window, or focus it if it is already open. */
      open(): Promise<void>
    }
    permissions: {
      /** Current grant status. */
      get(): Promise<PermissionsStatus>
      /** Open the Accessibility pane of System Settings. */
      openSettings(): Promise<void>
      /** Leave the gate and start the app. Ignored while still untrusted. */
      proceed(): Promise<void>
      /** Subscribe to grant changes. Returns an unsubscribe function. */
      onChange(callback: (status: PermissionsStatus) => void): () => void
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
