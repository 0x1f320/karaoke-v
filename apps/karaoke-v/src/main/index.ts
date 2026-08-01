import path from "node:path"
import { app, BrowserWindow } from "electron"
import { type StickStatus, startStick } from "./stick"

let win: BrowserWindow | null = null
let stopStick: (() => void) | null = null
let lastStatus: StickStatus = { state: "waiting" }

const BACKGROUND = "#2D2B2E"
const TITLE_BAR_HEIGHT = 40
const WINDOW = { width: 300, height: 600 }

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    backgroundColor: BACKGROUND,
    resizable: false,
    // Drop the minimize/maximize (zoom) buttons — only close remains. On macOS the
    // native traffic lights can't be removed individually, so these grey them out.
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Frameless look, but keep the native window controls:
    // macOS shows the traffic lights; Windows/Linux draw controls via titleBarOverlay.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: BACKGROUND,
      symbolColor: "#e6e6e6",
      height: TITLE_BAR_HEIGHT,
    },
    trafficLightPosition: { x: 14, y: (TITLE_BAR_HEIGHT - 16) / 2 },
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
    },
  })

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
