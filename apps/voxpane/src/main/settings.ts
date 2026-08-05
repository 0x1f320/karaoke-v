import path from "node:path"
import { app, BrowserWindow, screen } from "electron"
import { onLanguageChanged, t } from "./i18n"

// The settings window, opened from the toolbar. It is a singleton — reopening
// focuses the existing one instead of stacking.

const SIZE = { width: 800, height: 800 }

// Windows' own caption is a light strip over a dark panel, so it is hidden and
// the renderer paints one (see ui/TitleBar). "hidden" rather than frame:false
// keeps the native frame, and with it the shadow and the snap behaviour; macOS
// keeps its system title bar, which already matches.
const TITLE_BAR: Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle"> =
  process.platform === "win32" ? { titleBarStyle: "hidden" } : {}

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
    title: t("settings.title"),
    backgroundColor: "#2D2B2E",
    ...TITLE_BAR,
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

  // The window this titles is the one the language is changed from, so it has to
  // relabel itself while it is up.
  const unsubscribeLanguage = onLanguageChanged(() => win?.setTitle(t("settings.title")))

  win.on("closed", () => {
    unsubscribeLanguage()
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

export function closeSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.close()
  }
}
