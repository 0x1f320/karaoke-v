import path from "node:path"
import * as macHelper from "@karaoke-v/macos-helper"
import { app, BrowserWindow } from "electron"

let win: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

// P1: poll the piano-roll geometry and mirror it. A full AX read is ~50ms so we
// poll modestly for now; the efficient cached reader comes in P2.
const POLL_MS = 250

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
    },
  })

  // Transparent, click-through overlay that floats over the piano roll.
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

function poll(): void {
  if (!win || win.isDestroyed()) {
    return
  }
  let pr: macHelper.PianoRoll | null = null
  if (process.platform === "darwin") {
    try {
      pr = macHelper.getPianoRoll("synth")
    } catch {}
  }
  if (!pr) {
    if (win.isVisible()) {
      win.hide()
    }
    return
  }
  const { canvas } = pr
  win.setBounds(
    {
      x: Math.round(canvas.x),
      y: Math.round(canvas.y),
      width: Math.round(canvas.w),
      height: Math.round(canvas.h),
    },
    false,
  )
  if (!win.isVisible()) {
    win.showInactive()
  }
  win.webContents.send("piano-roll", pr)
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide()
  }
  createWindow()
  pollTimer = setInterval(poll, POLL_MS)
})

app.on("before-quit", () => {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})

app.on("window-all-closed", () => app.quit())
