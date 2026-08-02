import * as macHelper from "@karaoke-v/macos-helper"
import { app, type BrowserWindow, ipcMain } from "electron"
import { registerBridgeIpc, startBridge, stopBridge } from "./bridge"
import { createOverlayWindow, positionOverlay } from "./overlay"
import { registerPreferencesIpc } from "./preferences"
import { openSettingsWindow } from "./settings"
import { createToolbarWindow, positionToolbar } from "./toolbar"

// The main process wires two windows to the same native stick observer: the
// overlay (overlay.ts) covers the whole SynthV window, and the sticky toolbar
// (toolbar.ts) docks beside it. Each module owns its window's creation and
// positioning; this file only runs the follow loop.

let overlayWin: BrowserWindow | null = null
let toolbarWin: BrowserWindow | null = null

// A second copy would attach its own stick observer and clipboard bridge to the
// same SynthV window, so the two would fight over the overlay and the pasteboard.
// Only the first instance survives; app.exit rather than app.quit because the
// loser must be gone before "ready" fires and starts the observer.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

// The dock icon is hidden and the overlay only appears while SynthV is attached,
// so a relaunch has nothing to raise — show settings as the visible ack instead.
app.on("second-instance", () => openSettingsWindow())

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide()
  }
  registerPreferencesIpc()
  registerBridgeIpc()
  ipcMain.handle("settings:open", () => openSettingsWindow())

  overlayWin = createOverlayWindow()
  toolbarWin = createToolbarWindow()
  if (process.platform !== "darwin") {
    return
  }
  macHelper.start({
    target: "synth",
    onFrame: (f) => {
      if (overlayWin && !overlayWin.isDestroyed()) {
        positionOverlay(overlayWin, f)
        if (!overlayWin.isVisible()) {
          overlayWin.showInactive()
        }
      }
      if (toolbarWin && !toolbarWin.isDestroyed()) {
        positionToolbar(toolbarWin, f)
        if (!toolbarWin.isVisible()) {
          toolbarWin.showInactive()
        }
      }
    },
    onStatus: (s) => {
      if (s.state === "attached") {
        return
      }
      for (const w of [overlayWin, toolbarWin]) {
        if (w && !w.isDestroyed() && w.isVisible()) {
          w.hide()
        }
      }
    },
  })

  // Last: window tracking is the core of the app, so a bridge that fails to
  // start (a stale native build, say) must not take it down with it.
  try {
    startBridge()
  } catch (error) {
    console.error("failed to start the SynthV bridge receiver:", error)
  }
})

app.on("before-quit", () => {
  stopBridge()
  macHelper.stop()
})

app.on("window-all-closed", () => app.quit())
