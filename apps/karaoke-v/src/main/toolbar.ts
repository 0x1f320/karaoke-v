import path from "node:path"
import { native } from "../shared/native"
import { BrowserWindow, screen } from "electron"

// The sticky toolbar: a narrow frameless strip docked beside the SynthV window.
// The follow loop lives in main/index.ts (shared with the overlay window) —
// this module owns the toolbar window itself and the docking geometry.

const BACKGROUND = "#2D2B2E"
const SIZE = { width: 72, height: 600 }

// Gap between the target window's edge and our panel, in points.
const GAP = 8

type Side = "right" | "left"

// Choose where to dock our panel relative to the target, with hysteresis: we
// stay on the current side and only flip when that side no longer fits on the
// target's monitor. So docking left persists even after room reopens on the
// right — it flips back only when the left edge itself runs out of room.
function computeDock(
  target: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
  side: Side,
): { x: number; y: number; side: Side } {
  const bounds = screen.getDisplayMatching({
    x: target.x,
    y: target.y,
    width: target.w,
    height: target.h,
  }).bounds
  const displayRight = bounds.x + bounds.width
  const displayBottom = bounds.y + bounds.height

  const rightX = target.x + target.w + GAP
  const leftX = target.x - GAP - size.width
  const rightFits = rightX + size.width <= displayRight
  const leftFits = leftX >= bounds.x

  // Switch only when the current side stops fitting.
  let next = side
  if (side === "right" && !rightFits && leftFits) {
    next = "left"
  } else if (side === "left" && !leftFits && rightFits) {
    next = "right"
  }

  const rawX = next === "right" ? rightX : leftX
  // Clamp in case neither side fully fits (target as wide as the display).
  const x = Math.max(bounds.x, Math.min(rawX, displayRight - size.width))
  const y = Math.max(bounds.y, Math.min(target.y, displayBottom - size.height))
  return { x: Math.round(x), y: Math.round(y), side: next }
}

let side: Side = "right"

// Dock the toolbar next to the target's frame. animate:false — an animated
// move would lag behind the target.
export function positionToolbar(
  win: BrowserWindow,
  target: { x: number; y: number; w: number; h: number },
): void {
  const dock = computeDock(target, SIZE, side)
  side = dock.side
  win.setBounds({ x: dock.x, y: dock.y, width: SIZE.width, height: SIZE.height }, false)
}

export function createToolbarWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    backgroundColor: BACKGROUND,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
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
      // The preload requires the native AX addon.
      sandbox: false,
    },
  })

  // "floating" level sits just above ordinary windows — enough to clear a
  // focused window's shadow without jumping over system UI.
  win.setAlwaysOnTop(true, "floating")

  // No fade when the panel is shown/hidden on occlusion.
  if (process.platform === "darwin") {
    try {
      native.disableAnimations(win.getNativeWindowHandle())
    } catch {}
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#toolbar`)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { hash: "toolbar" })
  }

  return win
}
