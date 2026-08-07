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
  toDipState,
  toDipViewport,
  type Viewport,
} from "../shared/native"
import type { PermissionKey, PermissionsStatus } from "../shared/permissions"
import { expectedCanvasSize, pianoRollFrom, viewportFrom } from "../shared/pianoRollGeometry"
import type { Preferences, PreferencesPatch } from "../shared/preferences"
import { readSchedule, readState } from "./bridgeReader"
import { ScheduleCache } from "./scheduleCache"

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

// The renderer reads geometry directly (requires sandbox: false). Native only
// answers where the piano-roll canvas is; note rectangles are computed from the
// bridge's schedule and view transform, so scrolling does not depend on walking
// a moving Accessibility tree.

function windowsCanvas(state: BridgeState): Rect | null {
  return native.getCanvas?.(expectedCanvasSize(state), NATIVE_TARGET) ?? null
}

function nativeCanvasFromViewport(viewport: Viewport | null): Rect | null {
  return viewport?.canvas ?? null
}

async function macViewport(): Promise<Viewport | null> {
  const cached = native.getViewport?.() ?? null
  if (cached) {
    return cached
  }
  return native.getPianoRollAsync?.(NATIVE_TARGET) ?? Promise.resolve(null)
}

function computedViewport(state: BridgeState, canvas: Rect): Viewport {
  return viewportFrom(state, canvas, native.getCanvasOrigin?.())
}

function nativeViewport(): Viewport | null {
  const state = readState()
  if (!state) {
    return null
  }
  const canvas = isWindows
    ? windowsCanvas(state)
    : nativeCanvasFromViewport(native.getViewport?.() ?? null)
  return canvas && computedViewport(state, canvas)
}

async function nativeViewportAsync(): Promise<Viewport | null> {
  const state = readState()
  if (!state) {
    return null
  }
  const viewport = isWindows ? null : await macViewport()
  const canvas = isWindows ? windowsCanvas(state) : nativeCanvasFromViewport(viewport)
  if (!canvas) {
    return null
  }
  return computedViewport(state, canvas)
}

async function nativePianoRoll(): Promise<PianoRoll | null> {
  const state = readState()
  if (!state) {
    return null
  }
  const viewport = isWindows ? null : await macViewport()
  const canvas = isWindows ? windowsCanvas(state) : nativeCanvasFromViewport(viewport)
  if (!canvas) {
    return null
  }
  const currentSchedule = scheduleCache.read(state.notesSeq) ?? scheduleCache.latest
  if (!currentSchedule) {
    return null
  }
  return pianoRollFrom(state, currentSchedule.notes, canvas, native.getCanvasOrigin?.())
}

const scheduleCache = new ScheduleCache(readSchedule)

contextBridge.exposeInMainWorld("overlay", {
  getViewport: (): Viewport | null => {
    const viewport = nativeViewport()
    return viewport && toDipViewport(dip, viewport)
  },
  getViewportAsync: (): Promise<Viewport | null> =>
    nativeViewportAsync().then((viewport) => viewport && toDipViewport(dip, viewport)),
  readNotes: (): Promise<PianoRoll | null> =>
    nativePianoRoll().then((read) => read && toDipPianoRoll(dip, read)),
})

// Transport data from the SynthV bridge script, read from its channels in this
// process for the same reason the geometry is: the renderer asks at rAF time and
// nothing crosses to main. readState is per-frame and allocation-free;
// readSchedule is only called when the state record says the schedule changed.
contextBridge.exposeInMainWorld("bridge", {
  readState: (): BridgeState | null => {
    const state = readState()
    return state && toDipState(dip, state)
  },
  readSchedule: (notesSeq: number): BridgeSchedule | null => scheduleCache.read(notesSeq),
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

// The toolbar window is sized to what the toolbar renderer actually draws, so
// the renderer is the one that measures it. Named "panel" rather than "toolbar":
// that collides with the built-in Window.toolbar (BarProp).
contextBridge.exposeInMainWorld("panel", {
  resize: (height: number): Promise<void> => ipcRenderer.invoke("toolbar:resize", height),
})

contextBridge.exposeInMainWorld("app", {
  quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),
})

contextBridge.exposeInMainWorld("debug", {
  latency: (line: string): void => {
    console.info(line)
    ipcRenderer.send("debug:latency", line)
  },
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
