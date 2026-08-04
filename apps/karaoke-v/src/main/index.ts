import path from "node:path"
import { app, type BrowserWindow, ipcMain } from "electron"
import { APP_NAME } from "../shared/i18n"
import { native, type Rect } from "../shared/native"
import { registerAssetIpc, registerAssetScheme } from "./assets"
import { prepareBridgeDirectory } from "./bridge"
import { installBridgeScript } from "./bridgeScript"
import { registerDipIpc, toDipFrame, updateDipTransform } from "./dip"
import { initI18n } from "./i18n"
import { createOverlayWindow, positionOverlay } from "./overlay"
import {
  isAccessibilityTrusted,
  openPermissionsWindow,
  registerPermissionsIpc,
} from "./permissions"
import { registerPreferencesIpc } from "./preferences"
import { closeSettingsWindow, openSettingsWindow, setSettingsAnchorWindow } from "./settings"
import { createToolbarWindow, positionToolbar } from "./toolbar"
import { createTray, destroyTray, hasTray, setTrayStatus } from "./tray"

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

// Names the macOS app menu, the About panel and notification attribution, which
// would otherwise read the package name.
app.setName(APP_NAME)

// setName would otherwise move userData to ".../KaraokeV" and orphan every
// existing install's preferences, so the path stays on the package name it was
// created under. It has to be pinned after setName — which recomputes the
// default — and before anything reads userData, including the single instance
// lock below, whose socket lives there.
app.setPath("userData", path.join(app.getPath("appData"), "@karaoke-v", "app"))

// A second copy would attach its own stick observer and clipboard bridge to the
// same SynthV window, so the two would fight over the overlay and the pasteboard.
// Only the first instance survives; app.exit rather than app.quit because the
// loser must be gone before "ready" fires and starts the observer.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

// Windows attributes tray icons and toast notifications by AppUserModelID, and
// falls back to "electron.app.Electron" without one. It has to match the ID the
// installer writes into the shortcut, or shipped toasts go missing.
app.setAppUserModelId("io.github.0x1f320.karaoke-v")

// Schemes can only be given their privileges before the app is ready.
registerAssetScheme()

// The dock icon is hidden and the overlay only appears while SynthV is attached,
// so a relaunch has nothing to raise — show settings as the visible ack instead,
// or the gate the first copy is still waiting on.
app.on("second-instance", () => {
  if (started) {
    openSettingsWindow()
  } else {
    openPermissionsWindow(start)
  }
})

// Everything below the permissions gate. On macOS the app only gets here once
// Accessibility is granted: without it every AX read fails, so an overlay would
// exist but never align with anything.
let started = false

function start(): void {
  if (started) {
    // The gate came back up mid-run — the grant was revoked and restored — so
    // the windows are already there and only the observer has to be rebuilt: it
    // chose poll mode when it started untrusted.
    native.stop()
    startTracking()
    return
  }
  started = true

  overlayWin = createOverlayWindow()
  toolbarWin = createToolbarWindow()
  setSettingsAnchorWindow(toolbarWin)
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return
  }
  createTray()
  if (native.follow && overlayWin) {
    native.follow(overlayWin.getNativeWindowHandle())
  }
  startTracking()

  // Last: window tracking is the core of the app, so a bridge directory that
  // cannot be created must not take it down with it. The renderer simply finds
  // no channels and draws nothing.
  try {
    prepareBridgeDirectory()
  } catch (error) {
    console.error("failed to prepare the SynthV bridge directory:", error)
  }
}

function startTracking(): void {
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
      setTrayStatus(s.state)
      // Trust was revoked while running: nothing can be read any more, so ask
      // for it back rather than leaving an overlay that silently never draws.
      if (s.state === "permission") {
        openPermissionsWindow(start)
      }
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
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide()
  }
  registerPreferencesIpc()
  // After the preferences IPC, whose store it reads the language from, and
  // before anything that spells a user-facing string.
  initI18n()
  // After i18n: the import dialog spells its file-type filter.
  registerAssetIpc()
  registerDipIpc()
  registerPermissionsIpc()
  ipcMain.handle("settings:open", () => openSettingsWindow())
  ipcMain.handle("settings:close", () => closeSettingsWindow())

  // Before anything is shown: an app update ships a newer bridge script, and
  // SynthV only rereads its scripts directory when it starts — so the sooner the
  // copy lands, the more likely it is the one SynthV comes up with.
  installBridgeScript()

  if (isAccessibilityTrusted()) {
    start()
  } else {
    openPermissionsWindow(start)
  }
})

app.on("before-quit", () => {
  native.stop()
  destroyTray()
})

// Closing the settings window leaves an app with no windows at all, which is the
// normal resting state once the tray is the handle back in.
app.on("window-all-closed", () => {
  if (!hasTray()) {
    app.quit()
  }
})
