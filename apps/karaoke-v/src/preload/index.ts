import type { PianoRoll } from "@karaoke-v/macos-helper"
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("overlay", {
  onPianoRoll: (callback: (frame: PianoRoll) => void) => {
    ipcRenderer.on("piano-roll", (_event, frame: PianoRoll) => callback(frame))
  },
})
