import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"
import type { BridgeMessage } from "../shared/bridge"
import {
  type DipTransform,
  IDENTITY_DIP,
  isWindows,
  native,
  type PianoRoll,
  toDipPianoRoll,
  toDipViewport,
  type Viewport,
} from "../shared/native"
import type { PermissionKey, PermissionsStatus } from "../shared/permissions"
import type { Preferences, PreferencesPatch } from "../shared/preferences"

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

const NATIVE_TARGET = isWindows ? "synthv-studio" : "synth"

// The renderer reads geometry directly (requires sandbox: false): getViewport at
// rAF time for zero-lag positioning, and getPianoRollAsync in a background pump
// for always-fresh notes. No main-process hop in the per-frame path.
contextBridge.exposeInMainWorld("overlay", {
  getViewport: (): Viewport | null => {
    const viewport = native.getViewport()
    return viewport && toDipViewport(dip, viewport)
  },
  readNotes: (): Promise<PianoRoll | null> =>
    native.getPianoRollAsync(NATIVE_TARGET).then((read) => read && toDipPianoRoll(dip, read)),
})

// Transport data from the SynthV bridge script. Main owns the one receiver and
// fans payloads out; monotonicNow reads the same clock the payload was stamped
// with, so its age is measurable without comparing process clocks.
contextBridge.exposeInMainWorld("bridge", {
  last: (): Promise<BridgeMessage | null> => ipcRenderer.invoke("bridge:last"),
  monotonicNow: (): number => native.monotonicNow(),
  onPayload: (callback: (message: BridgeMessage) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, message: BridgeMessage) => callback(message)
    ipcRenderer.on("bridge:payload", handler)
    return () => {
      ipcRenderer.off("bridge:payload", handler)
    }
  },
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
