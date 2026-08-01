import path from "node:path"
import * as macHelper from "@karaoke-v/macos-helper"
import { app, BrowserWindow } from "electron"

// The main process only manages the overlay window: it covers the whole SynthV
// window (tracked event-driven by the native stick observer) and is otherwise
// inert. All per-frame work — AX reads and drawing — happens in the renderer,
// which reads the addon directly through the preload bridge. This removes the
// AX → main → renderer hops (and per-frame setBounds) from the hot path.

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 800,
    height: 400,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    roundedCorners: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      // The preload requires the native AX addon.
      sandbox: false,
      // The overlay is never focused; without this Electron throttles its
      // rendering (rAF/timers) as a background window, causing scroll lag.
      backgroundThrottling: false,
    },
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, "floating")
  if (process.platform === "darwin") {
    try {
      macHelper.disableAnimations(win.getNativeWindowHandle())
    } catch {}
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide()
  }
  createWindow()
  if (process.platform !== "darwin") {
    return
  }
  macHelper.start({
    target: "synth",
    onFrame: (f) => {
      if (!win || win.isDestroyed()) {
        return
      }
      win.setBounds(
        { x: Math.round(f.x), y: Math.round(f.y), width: Math.round(f.w), height: Math.round(f.h) },
        false,
      )
      if (!win.isVisible()) {
        win.showInactive()
      }
    },
    onStatus: (s) => {
      if (!win || win.isDestroyed()) {
        return
      }
      if (s.state !== "attached" && win.isVisible()) {
        win.hide()
      }
    },
  })
})

app.on("before-quit", () => {
  macHelper.stop()
})

app.on("window-all-closed", () => app.quit())
