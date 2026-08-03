import path from "node:path"
import { app, BrowserWindow, ipcMain, screen, shell, systemPreferences } from "electron"
import type { PermissionKey, PermissionsStatus } from "../shared/permissions"

// The first-run gate: without Accessibility the AX reads fail and the overlay
// can never align, so nothing else starts until it is granted.

// The height is only a starting point: the window follows its own content,
// which grows and shrinks as the per-permission instructions are unfolded.
const SIZE = { width: 580, height: 390 }
const HEIGHT_LIMITS = { min: 200, max: 720 }

// macOS reports the trust state to a running process, but only when asked —
// there is no notification for it, so the window polls the whole time it is up.
// Both directions: the switch in System Settings can go back off just as easily.
const POLL_MS = 1000

// Each permission lands on its own System Settings pane. Keyed rather than
// taking the URL from the renderer: this ends in shell.openExternal, which will
// launch whatever scheme it is handed.
const PANES: Record<PermissionKey, string> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
}

let win: BrowserWindow | null = null
let poll: NodeJS.Timeout | null = null
let onGranted: (() => void) | null = null
let reported = false

export function isAccessibilityTrusted(): boolean {
  return process.platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false)
}

function status(): PermissionsStatus {
  return { accessibility: isAccessibilityTrusted() }
}

function stopPolling(): void {
  if (poll) {
    clearInterval(poll)
    poll = null
  }
}

function centeredBounds(): { x: number; y: number } {
  const { x, y, width, height } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea
  return {
    x: Math.round(x + (width - SIZE.width) / 2),
    y: Math.round(y + (height - SIZE.height) / 2),
  }
}

/**
 * Show the gate and call `granted` once the user has both granted Accessibility
 * and confirmed. Re-showing while it is already up only focuses it.
 */
export function openPermissionsWindow(granted: () => void): void {
  onGranted = granted

  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    ...centeredBounds(),
    width: SIZE.width,
    height: SIZE.height,
    title: "karaoke-v",
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

  // The overlay and toolbar float at "floating" level; the gate has to sit over
  // them for the case where it is re-shown after tracking already started.
  win.setAlwaysOnTop(true, "floating")

  // The renderer bundle is shared, so its <title> would otherwise overwrite the
  // window title on load.
  win.on("page-title-updated", (event) => {
    event.preventDefault()
  })

  win.on("closed", () => {
    win = null
    stopPolling()
  })

  win.once("ready-to-show", () => {
    win?.show()
    // The dock icon is hidden, so the app is an accessory — it needs an
    // explicit activation for the new window to take keyboard focus.
    app.focus({ steal: true })
  })

  stopPolling()
  reported = isAccessibilityTrusted()
  poll = setInterval(() => {
    if (!win || win.isDestroyed()) {
      stopPolling()
      return
    }
    const trusted = isAccessibilityTrusted()
    if (trusted !== reported) {
      reported = trusted
      win.webContents.send("permissions:changed", status())
    }
  }, POLL_MS)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#permissions`)
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { hash: "permissions" })
  }
}

export function registerPermissionsIpc(): void {
  ipcMain.handle("permissions:get", () => status())
  ipcMain.handle("permissions:openSettings", (_event, key: PermissionKey) => {
    const pane = PANES[key]
    return pane ? shell.openExternal(pane) : undefined
  })
  ipcMain.handle("permissions:resize", (_event, height: number) => {
    if (!win || win.isDestroyed() || !Number.isFinite(height)) {
      return
    }
    const next = Math.round(Math.min(Math.max(height, HEIGHT_LIMITS.min), HEIGHT_LIMITS.max))
    if (next !== win.getContentSize()[1]) {
      win.setContentSize(SIZE.width, next)
    }
  })
  ipcMain.handle("permissions:continue", () => {
    if (!isAccessibilityTrusted()) {
      // Switched back off between the last poll and the click. Correcting the
      // window is the answer; starting untrusted, or doing nothing visible at
      // all, both leave the user with an app that cannot work.
      reported = false
      win?.webContents.send("permissions:changed", status())
      return
    }
    // Start before the window goes: closing the last window with no tray yet
    // would quit the app.
    onGranted?.()
    onGranted = null
    win?.close()
  })
}
