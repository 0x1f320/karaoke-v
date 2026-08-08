import { join } from "node:path"
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"
import type { BridgeSchedule, BridgeState } from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeFileDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"
import {
  type CanvasSnapshot,
  type DipTransform,
  IDENTITY_DIP,
  isWindows,
  NATIVE_TARGET,
  native,
  type Rect,
  toDipCanvasSnapshot,
  toDipState,
} from "../shared/native"
import type { PermissionKey, PermissionsStatus } from "../shared/permissions"
import { expectedCanvasSize } from "../shared/pianoRollGeometry"
import type { Preferences, PreferencesPatch } from "../shared/preferences"
import { BridgeRuntime } from "./bridgeRuntime"

interface StateMessage {
  type: "state"
  bytes: ArrayBuffer
  diagnostics: BridgeFileDiagnostics | null
}

interface ScheduleMessage {
  type: "schedule"
  notesSeq: number
  bytes: ArrayBuffer
  diagnostics: BridgeFileDiagnostics | null
}

interface ScrollMessage {
  type: "scroll"
  scrollSeq: number
  bytes: ArrayBuffer
  diagnostics: BridgeFileDiagnostics | null
}

interface DiagnosticsMessage {
  type: "diagnostics"
  diagnostics: BridgeSamplerDiagnostics
}

type BridgeWorkerMessage = StateMessage | ScrollMessage | ScheduleMessage | DiagnosticsMessage

interface BrowserWorker {
  onmessage: ((event: { data: BridgeWorkerMessage }) => void) | null
  postMessage(message: unknown): void
}

interface BrowserWorkerConstructor {
  new (scriptUrl: string): BrowserWorker
}

let bridgeRuntime: BridgeRuntime | null = null
let bridgeWorker: BrowserWorker | null = null

function cachedBridge(): BridgeRuntime {
  if (bridgeRuntime && bridgeWorker) {
    return bridgeRuntime
  }
  const runtime = new BridgeRuntime()
  const workerPath = join(__dirname, "bridgeWorker.js")
  const workerUrl = URL.createObjectURL(
    new Blob([`require(${JSON.stringify(workerPath)})`], { type: "text/javascript" }),
  )
  const Worker = (globalThis as unknown as { Worker: BrowserWorkerConstructor }).Worker
  const worker = new Worker(workerUrl)
  worker.onmessage = ({ data }) => {
    if (data.type === "state") {
      runtime.acceptState(new Uint8Array(data.bytes), acceptDiagnostics(data.diagnostics))
    } else if (data.type === "scroll") {
      runtime.acceptScroll(
        data.scrollSeq,
        new Uint8Array(data.bytes),
        acceptDiagnostics(data.diagnostics),
      )
    } else if (data.type === "schedule") {
      runtime.acceptSchedule(
        data.notesSeq,
        new Uint8Array(data.bytes),
        acceptDiagnostics(data.diagnostics),
      )
    } else {
      runtime.acceptSamplerDiagnostics(data.diagnostics)
    }
  }
  bridgeWorker = worker
  bridgeRuntime = runtime
  return runtime
}

function acceptDiagnostics(
  diagnostics: BridgeFileDiagnostics | null,
): BridgeChannelDiagnostics | null {
  return diagnostics ? { ...diagnostics, acceptedAtMs: native.monotonicNow() } : null
}

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

let macCanvasSeeded = false
let macCanvasFailures = 0

async function macCanvas(): Promise<Rect | null> {
  const cached = (await native.getCanvasAsync?.()) ?? null
  if (cached) {
    macCanvasSeeded = true
    macCanvasFailures = 0
    return cached
  }
  macCanvasFailures += 1
  if (macCanvasSeeded && macCanvasFailures < 4) {
    return null
  }
  const seeded = (await native.getPianoRollAsync?.(NATIVE_TARGET)) ?? null
  if (!seeded) {
    return null
  }
  macCanvasSeeded = true
  macCanvasFailures = 0
  return (await native.getCanvasAsync?.()) ?? null
}

async function nativeCanvasAsync(): Promise<CanvasSnapshot | null> {
  const state = isWindows ? cachedBridge().readState() : null
  const canvas = isWindows ? state && windowsCanvas(state) : await macCanvas()
  if (!canvas) {
    return null
  }
  return {
    canvas,
    origin: isWindows ? native.getCanvasOrigin?.() : { x: 0, y: 0 },
  }
}

contextBridge.exposeInMainWorld("overlay", {
  getCanvasAsync: (): Promise<CanvasSnapshot | null> =>
    nativeCanvasAsync().then((snapshot) => snapshot && toDipCanvasSnapshot(dip, snapshot)),
})

// A Node-enabled Web Worker reads the bridge independently of rAF and transfers
// the newest records into this preload's cache. The renderer only asks for the
// latest decoded object; neither file I/O nor Electron IPC occurs while drawing.
contextBridge.exposeInMainWorld("bridge", {
  readState: (): BridgeState | null => {
    const state = cachedBridge().readState()
    return state && toDipState(dip, state)
  },
  readSchedule: (notesSeq: number): BridgeSchedule | null => cachedBridge().readSchedule(notesSeq),
  readDiagnostics: () => cachedBridge().readDiagnostics(),
  setDiagnosticsEnabled: (enabled: boolean): void => {
    cachedBridge()
    bridgeWorker?.postMessage({ type: "diagnostics", enabled })
  },
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
