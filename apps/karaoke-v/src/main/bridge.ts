import * as macHelper from "@karaoke-v/macos-helper"
import { BrowserWindow, ipcMain } from "electron"
import { BRIDGE_MARKER, type BridgeMessage, parseBridgePayload } from "../shared/bridge"

// One clipboard watcher for the whole app. Unlike the AX reads — which are
// per-frame and therefore live in the renderer — payloads arrive a handful of
// times per playback, so the IPC hop costs nothing and main stays the single
// owner of the transport state.
//
// The last message is kept so a window that opens mid-playback can catch up
// instead of waiting for the next transport event, which may never come.

let last: BridgeMessage | null = null

export function startBridge(): void {
  macHelper.startBridge({
    marker: BRIDGE_MARKER,
    onPayload: (text, monotonicMs) => {
      const payload = parseBridgePayload(text)
      if (!payload) {
        return // a marked string we cannot read is not worth acting on
      }
      const message: BridgeMessage = { payload, monotonicMs }
      last = message
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("bridge:payload", message)
        }
      }
    },
  })
}

export function stopBridge(): void {
  macHelper.stopBridge()
}

export function registerBridgeIpc(): void {
  ipcMain.handle("bridge:last", () => last)
}
