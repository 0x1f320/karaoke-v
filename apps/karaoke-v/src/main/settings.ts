import path from "node:path"
import { app, BrowserWindow, screen } from "electron"

// The settings window: an ordinary framed window, opened from the toolbar. It
// is a singleton — reopening focuses the existing one instead of stacking.

const SIZE = { width: 800, height: 800 }

let win: BrowserWindow | null = null
let anchorWin: BrowserWindow | null = null

// The toolbar follows SynthV across monitors, so the settings window belongs on
// whichever display the toolbar currently sits on.
export function setSettingsAnchorWindow(anchor: BrowserWindow): void {
  anchorWin = anchor
}

function centeredBounds(): { x: number; y: number } {
  const display =
    anchorWin && !anchorWin.isDestroyed()
      ? screen.getDisplayMatching(anchorWin.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  return {
    x: Math.round(x + (width - SIZE.width) / 2),
    y: Math.round(y + (height - SIZE.height) / 2),
  }
}

export function openSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    const { x, y } = centeredBounds()
    win.setPosition(x, y)
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    ...centeredBounds(),
    width: SIZE.width,
    height: SIZE.height,
    title: "설정",
    backgroundColor: "#2D2B2E",
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      // The preload requires the native AX addon.
      sandbox: false,
    },
  })

  // The overlay and toolbar float at "floating" level; a normal-level settings
  // window would be drawn under them wherever it overlaps SynthV.
  win.setAlwaysOnTop(true, "floating")

  // The renderer bundle is shared, so its <title> would otherwise overwrite the
  // window title on load.
  win.on("page-title-updated", (event) => {
    event.preventDefault()
  })

  win.on("closed", () => {
    win = null
  })

  win.once("ready-to-show", () => {
    win?.show()
    // The dock icon is hidden, so the app is an accessory — it needs an
    // explicit activation for the new window to take keyboard focus.
    app.focus({ steal: true })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#settings`)
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { hash: "settings" })
  }
}
