import { BrowserWindow, ipcMain, screen } from "electron"
import { type DipTransform, IDENTITY_DIP, isWindows, type Rect } from "../shared/native"

// The Windows helper reports physical pixels — Win32 and UI Automation both do —
// while Electron places windows and lays out renderers in DIPs. Only the main
// process can ask Electron for the mapping, so it is derived here from whichever
// display the target window is on and pushed out; the renderers then convert
// per-frame geometry themselves instead of paying an IPC hop for every read.

let current: DipTransform = IDENTITY_DIP

export function getDipTransform(): DipTransform {
  return current
}

export function toDipFrame(frame: Rect): Electron.Rectangle {
  const rect = { x: frame.x, y: frame.y, width: frame.w, height: frame.h }
  return isWindows ? screen.screenToDipRect(null, rect) : rect
}

function sameTransform(a: DipTransform, b: DipTransform): boolean {
  return (
    a.scale === b.scale &&
    a.originPx.x === b.originPx.x &&
    a.originPx.y === b.originPx.y &&
    a.originDip.x === b.originDip.x &&
    a.originDip.y === b.originDip.y
  )
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("native:dip", current)
    }
  }
}

/**
 * Recompute from a target frame in native units. On macOS this stays the
 * identity, so the whole path collapses to a no-op there.
 */
export function updateDipTransform(frame: Rect): void {
  if (!isWindows) {
    return
  }
  const dipRect = screen.screenToDipRect(null, {
    x: frame.x,
    y: frame.y,
    width: frame.w,
    height: frame.h,
  })
  const display = screen.getDisplayMatching(dipRect)
  const originPx = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
  const next: DipTransform = {
    scale: display.scaleFactor || 1,
    originPx,
    originDip: { x: display.bounds.x, y: display.bounds.y },
  }
  if (sameTransform(current, next)) {
    return
  }
  current = next
  broadcast()
}

export function registerDipIpc(): void {
  ipcMain.handle("native:dip", () => current)
  screen.on("display-metrics-changed", () => broadcast())
}
