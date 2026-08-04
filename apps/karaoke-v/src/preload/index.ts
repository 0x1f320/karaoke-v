import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"
import type { BridgeSchedule, BridgeState } from "../shared/bridgeChannels"
import {
  type DipTransform,
  IDENTITY_DIP,
  isWindows,
  NATIVE_TARGET,
  native,
  type PianoRoll,
  type Rect,
  toDipPianoRoll,
  toDipViewport,
  type Viewport,
} from "../shared/native"
import type { PermissionKey, PermissionsStatus } from "../shared/permissions"
import type { Preferences, PreferencesPatch } from "../shared/preferences"
import { expectedCanvasSize, pianoRollFrom, viewportFrom } from "../shared/windowsGeometry"
import { readSchedule, readState } from "./bridgeReader"

// The helper reports in native units — points on macOS, physical pixels on
// Windows — and only main can ask Electron for the mapping to DIPs, so it pushes
// the transform here and the conversion happens locally. Doing it per read would
// mean an IPC hop in the per-frame path, which is exactly what this file exists
// to avoid.
let dip: DipTransform = IDENTITY_DIP
ipcRenderer.on("native:dip", (_event, transform: DipTransform) => {
  dip = transform
})
ipcRenderer.invoke("native:dip").then((transform: DipTransform) => {
  dip = transform
})

// The renderer reads geometry directly (requires sandbox: false): the viewport at
// rAF time for zero-lag positioning, and the notes in a background pump for
// always-fresh rects. No main-process hop in the per-frame path.
//
// Where those come from is the one place the platforms genuinely differ. macOS
// walks the Accessibility tree. Windows has no tree: the rects follow from the
// bridge's own view transform, and the helper is asked only where the canvas is —
// identified by the size that transform implies.

function windowsCanvas(state: BridgeState): Rect | null {
  return native.getCanvas?.(expectedCanvasSize(state), NATIVE_TARGET) ?? null
}

function nativeViewport(): Viewport | null {
  if (!isWindows) {
    return native.getViewport?.() ?? null
  }
  const state = readState()
  if (!state) {
    return null
  }
  const canvas = windowsCanvas(state)
  return canvas && viewportFrom(state, canvas, native.getCanvasOrigin?.())
}

function nativePianoRoll(): PianoRoll | null {
  if (!isWindows) {
    return null
  }
  const state = readState()
  if (!state) {
    return null
  }
  const canvas = windowsCanvas(state)
  if (!canvas) {
    return null
  }
  // The schedule only moves when the script publishes a new one, so the last
  // copy stays correct in between: a read that lost its race with the writer
  // must not blank the notes for a frame.
  const schedule = readSchedule() ?? lastSchedule
  if (!schedule) {
    return null
  }
  lastSchedule = schedule
  return pianoRollFrom(state, schedule.notes, canvas, native.getCanvasOrigin?.())
}

let lastSchedule: BridgeSchedule | null = null

contextBridge.exposeInMainWorld("overlay", {
  getViewport: (): Viewport | null => {
    const viewport = nativeViewport()
    return viewport && toDipViewport(dip, viewport)
  },
  readNotes: (): Promise<PianoRoll | null> =>
    (isWindows
      ? Promise.resolve(nativePianoRoll())
      : (native.getPianoRollAsync?.(NATIVE_TARGET) ?? Promise.resolve(null))
    ).then((read) => read && toDipPianoRoll(dip, read)),
})

// Transport data from the SynthV bridge script, read from its channels in this
// process for the same reason the geometry is: the renderer asks at rAF time and
// nothing crosses to main. readState is per-frame and allocation-free;
// readSchedule is only called when the state record says the schedule changed.
contextBridge.exposeInMainWorld("bridge", {
  readState: (): BridgeState | null => readState(),
  readSchedule: (): BridgeSchedule | null => readSchedule(),
  monotonicNow: (): number => native.monotonicNow(),
})

// Window management stays in main — the toolbar just asks for it. Not named
// "toolbar": that collides with the built-in Window.toolbar (BarProp).
contextBridge.exposeInMainWorld("settings", {
  open: (): Promise<void> => ipcRenderer.invoke("settings:open"),
  close: (): Promise<void> => ipcRenderer.invoke("settings:close"),
  // Windows is the platform whose caption the window hides, so it is the one
  // where the renderer owes it a title bar of its own.
  customTitleBar: isWindows,
})

// The permissions gate. Main owns the status because only it can ask macOS, and
// it is the one that starts the app once the grant lands.
contextBridge.exposeInMainWorld("permissions", {
  get: (): Promise<PermissionsStatus> => ipcRenderer.invoke("permissions:get"),
  openSettings: (key: PermissionKey): Promise<void> =>
    ipcRenderer.invoke("permissions:openSettings", key),
  proceed: (): Promise<void> => ipcRenderer.invoke("permissions:continue"),
  resize: (height: number): Promise<void> => ipcRenderer.invoke("permissions:resize", height),
  onChange: (callback: (status: PermissionsStatus) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: PermissionsStatus) => callback(status)
    ipcRenderer.on("permissions:changed", handler)
    return () => {
      ipcRenderer.off("permissions:changed", handler)
    }
  },
})

// Images for the effects. Main runs the file dialog and owns the copy under
// userData; what comes back is the stored name, which is all preferences carry.
contextBridge.exposeInMainWorld("assets", {
  import: (): Promise<string | null> => ipcRenderer.invoke("assets:import"),
})

// Chromium's navigator.languages is the browser's, not the OS's — it stays on
// en-US whatever the system is set to — so the renderer's idea of "system
// language" has to come from main.
contextBridge.exposeInMainWorld("i18n", {
  systemLanguages: (): Promise<string[]> => ipcRenderer.invoke("i18n:systemLanguages"),
})

// Preferences are owned and persisted by main. Every window sees the same state
// because each update is broadcast back to all of them.
contextBridge.exposeInMainWorld("preferences", {
  get: (): Promise<Preferences> => ipcRenderer.invoke("preferences:get"),
  update: (patch: PreferencesPatch): Promise<Preferences> =>
    ipcRenderer.invoke("preferences:update", patch),
  onChange: (callback: (prefs: Preferences) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, prefs: Preferences) => callback(prefs)
    ipcRenderer.on("preferences:changed", handler)
    return () => {
      ipcRenderer.off("preferences:changed", handler)
    }
  },
})
