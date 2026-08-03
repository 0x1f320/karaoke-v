import * as macHelper from "@karaoke-v/macos-helper"
import { BrowserWindow, ipcMain } from "electron"
import { BRIDGE_MARKER, type BridgeMessage, parseBridgePayload } from "../shared/bridge"
import { isWindows } from "../shared/native"
import { startShmBridge } from "./shmBridge"

// One bridge receiver for the whole app. Unlike the AX reads — which are
// per-frame and therefore live in the renderer — payloads arrive a handful of
// times per playback, so the IPC hop costs nothing and main stays the single
// owner of the transport state.
//
// The two platforms get there differently: macOS catches marked payloads on the
// clipboard, Windows watches the script's shared buffer and derives the same
// events. Both end up calling publish, so nothing downstream can tell.
//
// The last message is kept so a window that opens mid-playback can catch up
// instead of waiting for the next transport event, which may never come.

let last: BridgeMessage | null = null
let shm: { stop(): void } | null = null

function publish(message: BridgeMessage): void {
  last = message
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("bridge:payload", message)
    }
  }
}

export function startBridge(): void {
  if (isWindows) {
    shm = startShmBridge(publish)
    return
  }
  macHelper.startBridge({
    marker: BRIDGE_MARKER,
    onPayload: (text, monotonicMs) => {
      const payload = parseBridgePayload(text)
      if (!payload) {
        return // a marked string we cannot read is not worth acting on
      }
      publish({ payload, monotonicMs })
    },
  })
}

export function stopBridge(): void {
  if (isWindows) {
    shm?.stop()
    shm = null
    return
  }
  macHelper.stopBridge()
}

export function registerBridgeIpc(): void {
  ipcMain.handle("bridge:last", () => last)
}
