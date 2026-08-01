import type { PianoRoll, Viewport } from "@karaoke-v/macos-helper"
import * as macHelper from "@karaoke-v/macos-helper"
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"
import type { Preferences } from "../shared/preferences"

// The renderer reads AX directly (requires sandbox: false): getViewport at rAF
// time for zero-lag positioning, and getPianoRollAsync in a background pump for
// always-fresh notes. No main-process hop in the per-frame path.
contextBridge.exposeInMainWorld("overlay", {
  getViewport: (): Viewport | null => macHelper.getViewport(),
  readNotes: (): Promise<PianoRoll | null> => macHelper.getPianoRollAsync("synth"),
})

// Window management stays in main — the toolbar just asks for it. Not named
// "toolbar": that collides with the built-in Window.toolbar (BarProp).
contextBridge.exposeInMainWorld("settings", {
  open: (): Promise<void> => ipcRenderer.invoke("settings:open"),
})

// Preferences are owned and persisted by main. Every window sees the same state
// because each update is broadcast back to all of them.
contextBridge.exposeInMainWorld("preferences", {
  get: (): Promise<Preferences> => ipcRenderer.invoke("preferences:get"),
  update: (patch: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke("preferences:update", patch),
  onChange: (callback: (prefs: Preferences) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, prefs: Preferences) => callback(prefs)
    ipcRenderer.on("preferences:changed", handler)
    return () => {
      ipcRenderer.off("preferences:changed", handler)
    }
  },
})
