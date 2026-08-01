import { contextBridge, ipcRenderer } from "electron"
import type { StickStatus } from "../shared/stick-status"

contextBridge.exposeInMainWorld("stick", {
  onStatus: (callback: (status: StickStatus) => void) => {
    ipcRenderer.on("stick-status", (_event, status: StickStatus) => callback(status))
  },
})
