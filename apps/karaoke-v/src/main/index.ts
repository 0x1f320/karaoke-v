import * as macHelper from "@karaoke-v/macos-helper"
import { app, type BrowserWindow, ipcMain } from "electron"
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

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide()
  }
  registerPreferencesIpc()
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
})

app.on("before-quit", () => {
  macHelper.stop()
})

app.on("window-all-closed", () => app.quit())
