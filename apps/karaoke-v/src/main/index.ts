import { app, type BrowserWindow, ipcMain } from "electron"
import { native, type Rect } from "../shared/native"
import { registerBridgeIpc, startBridge, stopBridge } from "./bridge"
import { registerDipIpc, toDipFrame, updateDipTransform } from "./dip"
import { createOverlayWindow, positionOverlay } from "./overlay"
import { registerPreferencesIpc } from "./preferences"
import { openSettingsWindow, setSettingsAnchorWindow } from "./settings"
import { createToolbarWindow, positionToolbar } from "./toolbar"

// The main process wires two windows to the same native stick observer: the
// overlay (overlay.ts) covers the whole SynthV window, and the sticky toolbar
// (toolbar.ts) docks beside it. Each module owns its window's creation and
// positioning; this file only runs the follow loop.

// Electron reapplies its own idea of a window's bounds when the window is shown,
// so the overlay would snap back to its creation size after the helper moved it
// natively. Syncing that idea once the movement settles keeps both in step
// without setBounds arriving mid-drag with a frame-old position and dragging the
// window backwards — which is exactly what a chase looks like on screen.
const BOUNDS_SYNC_MS = 120
let boundsSync: NodeJS.Timeout | null = null

function syncOverlayBounds(win: BrowserWindow, frame: Rect): void {
  if (boundsSync) {
    clearTimeout(boundsSync)
  }
  boundsSync = setTimeout(() => {
    boundsSync = null
    if (!win.isDestroyed()) {
      positionOverlay(win, frame)
    }
  }, BOUNDS_SYNC_MS)
}

// macOS matches on the app's localized name, Windows on the executable's.
function nativeTarget(): string {
  return process.platform === "win32" ? "synthv-studio" : "synth"
}

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
  registerDipIpc()
  ipcMain.handle("settings:open", () => openSettingsWindow())

  overlayWin = createOverlayWindow()
  toolbarWin = createToolbarWindow()
  setSettingsAnchorWindow(toolbarWin)
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return
  }
  if (native.follow && overlayWin) {
    native.follow(overlayWin.getNativeWindowHandle())
  }
  native.start({
    target: nativeTarget(),
    onFrame: (raw) => {
      // The helper speaks in native units — points on macOS, physical pixels on
      // Windows — while window placement is in DIPs, so everything is converted
      // before anything is positioned. Renderers get the same transform pushed.
      updateDipTransform(raw)
      const bounds = toDipFrame(raw)
      const f = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }
      if (overlayWin && !overlayWin.isDestroyed()) {
        if (native.follow) {
          syncOverlayBounds(overlayWin, f)
        } else {
          positionOverlay(overlayWin, f)
        }
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
  native.stop()
})

app.on("window-all-closed", () => app.quit())
