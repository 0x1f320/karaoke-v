import path from "node:path"
import { native } from "../shared/native"
import { BrowserWindow } from "electron"

// The overlay window: transparent, click-through, always-on-top, covering the
// whole SynthV window. It is otherwise inert — all per-frame work (AX reads,
// drawing) happens in its renderer, which reads the addon directly through the
// preload bridge. This removes the AX → main → renderer hops (and per-frame
// setBounds) from the hot path.

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
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
  // Windows keeps the overlay above SynthV through window ownership instead —
  // topmost would also put it above every unrelated app, which is wrong.
  if (process.platform !== "win32") {
    win.setAlwaysOnTop(true, "floating")
  }
  if (process.platform === "darwin") {
    try {
      native.disableAnimations(win.getNativeWindowHandle())
    } catch {}
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  }

  return win
}

// Cover the target's frame exactly. animate:false — an animated move would lag
// behind the target.
export function positionOverlay(
  win: BrowserWindow,
  target: { x: number; y: number; w: number; h: number },
): void {
  win.setBounds(
    {
      x: Math.round(target.x),
      y: Math.round(target.y),
      width: Math.round(target.w),
      height: Math.round(target.h),
    },
    false,
  )
}
