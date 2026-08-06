// Exposes a small typed API over the compiled native addon, shaped to match
// @voxpane/macos-helper so the app can treat the two platforms alike.
//
// The bridge script publishes the exact view transform, so note rectangles are
// computed rather than read. UI Automation is needed only for the one thing the
// script cannot know — where the canvas sits on screen. That last part is all
// this file does; the arithmetic lives in the app, where it can be tested on a
// machine that is not Windows.
//
// Everything is in physical pixels, because Win32 and UIA both are. The caller
// converts to the DIPs Electron wants, since only Electron knows the display
// scale for a given window.
//
// The napi-rs loader is required lazily rather than at module scope: importing
// this package has to stay safe on macOS, where the .node does not exist.

let native

function loadNative() {
  if (!native) {
    try {
      native = require("./binding.js")
    } catch (err) {
      throw new Error(
        `@voxpane/windows-helper: native addon not built for this runtime. ` +
          `Run pnpm build in the workspace. Original error: ${err.message}`,
      )
    }
  }
  return native
}

/** Canvas sizes agree this closely before the cached element is trusted. */
const CANVAS_TOLERANCE_PX = 2

let canvasRect = null
let canvasFor = null
let canvasOffset = null

/**
 * The canvas rectangle, in physical pixels, identified by agreeing with the
 * bridge about its size — the caller works that out from the script's view
 * transform. A cached element is re-resolved whenever the expected size moves: a
 * window resize or a panel drag changes it, and the old element may now be
 * something else entirely.
 *
 * The window origin sampled alongside it is returned too, so the caller can
 * place a window against a value from the same instant.
 * @param {{width: number, height: number}} want
 * @param {string} [target="synthv-studio"]
 */
function getCanvas(want, target = "synthv-studio") {
  if (!(want && want.width > 0 && want.height > 0)) {
    return null
  }

  const matches =
    canvasFor &&
    Math.abs(canvasFor.width - want.width) <= CANVAS_TOLERANCE_PX &&
    Math.abs(canvasFor.height - want.height) <= CANVAS_TOLERANCE_PX

  // While the layout holds, the canvas sits at a fixed offset inside the window,
  // so its screen rectangle follows from the window origin alone. Deriving it that
  // way costs a DWM read instead of a UI Automation round trip, and — this is the
  // point — the origin is read now rather than up to a refresh interval ago, so a
  // window being dragged does not drag the drawing out of place behind it.
  if (canvasRect && canvasOffset && matches) {
    const origin = loadNative().getTargetOrigin()
    if (origin) {
      canvasRect = {
        x: origin.x + canvasOffset.x,
        y: origin.y + canvasOffset.y,
        w: canvasOffset.w,
        h: canvasOffset.h,
      }
      return canvasRect
    }
  }

  const found = loadNative().findCanvas(want.width, want.height, target)
  if (!found) {
    // A failed search means UI Automation hiccuped, not that the canvas moved:
    // dropping the rect here would blank the overlay for a frame, so the last
    // known one stands until a search succeeds.
    return canvasRect
  }
  canvasRect = { x: found.x, y: found.y, w: found.w, h: found.h }
  canvasFor = want
  canvasOffset = found.origin
    ? { x: found.x - found.origin.x, y: found.y - found.origin.y, w: found.w, h: found.h }
    : null
  return canvasRect
}

/** Where the target window is, paired with the canvas the caller just read. */
function getCanvasOrigin() {
  if (!canvasRect || !canvasOffset) {
    return undefined
  }
  return { x: canvasRect.x - canvasOffset.x, y: canvasRect.y - canvasOffset.y }
}

function start(options) {
  const { target, onFrame, onStatus } = options
  loadNative().start(target, onFrame, ({ state }) => {
    onStatus(state === "attached" ? { state, mode: "event" } : { state })
  })
}

function stop() {
  if (native) {
    native.stop()
  }
}

/**
 * Glue a window to the target: Windows owns the z-order and the move from then
 * on, so it stays directly above SynthV (and under whatever covers SynthV)
 * without the app repositioning it. Pass BrowserWindow#getNativeWindowHandle().
 * @param {Buffer} handle
 */
function follow(handle) {
  loadNative().follow(handle)
}

function unfollow() {
  if (native) {
    native.unfollow()
  }
}

function getTargetFrame(target = "synthv-studio") {
  return loadNative().getTargetFrame(target)
}

function disableAnimations() {}

function monotonicNow() {
  return loadNative().monotonicNow()
}

function getTargetOrigin() {
  return loadNative().getTargetOrigin()
}

/** Debug aid: every UI Automation child of the SynthV window with its rect. */
function listElements(target = "synthv-studio") {
  return loadNative().listElements(target)
}

module.exports = {
  getCanvas,
  getCanvasOrigin,
  start,
  stop,
  follow,
  unfollow,
  getTargetFrame,
  getTargetOrigin,
  disableAnimations,
  monotonicNow,
  listElements,
}
