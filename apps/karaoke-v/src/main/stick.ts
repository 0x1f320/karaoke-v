import * as macHelper from "@karaoke-v/macos-helper"
import { type BrowserWindow, screen } from "electron"
import type { StickStatus } from "../shared/stick-status"

export type { StickStatus }

// Gap between the target window's edge and our panel, in points.
const GAP = 0

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

// Stick `win` to the target app's window. The native addon runs the AXObserver
// follow loop in-process and reports the target's frame; we position with
// setBounds so Electron maps global coordinates onto the correct monitor.
// Returns a disposer.
export function startStick(
  win: BrowserWindow,
  size: { width: number; height: number },
  onStatus: (status: StickStatus) => void,
): () => void {
  if (process.platform !== "darwin") {
    onStatus({ state: "unsupported" })
    return () => {}
  }

  let side: Side = "right"

  try {
    macHelper.start({
      target: "synthesizer",
      onFrame: ({ x, y, w, h }) => {
        if (win.isDestroyed()) {
          return
        }
        const dock = computeDock({ x, y, w, h }, size, side)
        side = dock.side
        // animate:false — an animated move would lag behind the target.
        win.setBounds({ x: dock.x, y: dock.y, width: size.width, height: size.height }, false)
      },
      onStatus: (status) => {
        if (win.isDestroyed()) {
          return
        }
        if (status.state === "hidden") {
          if (win.isVisible()) {
            win.hide()
          }
        } else if (status.state === "attached") {
          if (!win.isVisible()) {
            win.showInactive()
          }
        }
        onStatus(status)
      },
    })
  } catch {
    onStatus({ state: "unsupported" })
    return () => {}
  }

  return () => {
    try {
      macHelper.stop()
    } catch {}
  }
}
