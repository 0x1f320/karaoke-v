import path from "node:path"
import { app, BrowserWindow } from "electron"
import { disableWindowAnimations, type StickStatus, startStick } from "./stick"

let win: BrowserWindow | null = null
let stopStick: (() => void) | null = null
let lastStatus: StickStatus = { state: "waiting" }

const BACKGROUND = "#2D2B2E"
const WINDOW = { width: 72, height: 600 }

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    backgroundColor: BACKGROUND,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Fully frameless: no system title bar and no window controls (macOS traffic
    // lights included). The panel is a narrow strip stuck to the target window.
    frame: false,
    // Square corners — macOS rounds frameless windows by default.
    roundedCorners: false,
    // Float above normal windows so a focused window (and its shadow) can't
    // cover the panel; showInactive keeps it from stealing focus.
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
    },
  })

  // "floating" level sits just above ordinary windows — enough to clear a
  // focused window's shadow without jumping over system UI.
  win.setAlwaysOnTop(true, "floating")

  // No fade when the panel is shown/hidden on occlusion.
  disableWindowAnimations(win)

  const sendStatus = (): void => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("stick-status", lastStatus)
    }
  }
  win.webContents.on("did-finish-load", sendStatus)

  stopStick = startStick(win, WINDOW, (status) => {
    lastStatus = status
    sendStatus()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("before-quit", () => {
  stopStick?.()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
