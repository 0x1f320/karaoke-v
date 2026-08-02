// Exposes a small typed API over the compiled native addon, shaped to match
// @karaoke-v/macos-helper so the app can treat the two platforms alike.
//
// The two helpers reach the same answers from opposite directions. On macOS the
// Accessibility API is the truth about geometry and the bridge script supplies
// musical identity. Here the bridge script supplies both: it publishes the exact
// view transform, so note rectangles are computed rather than read, and UI
// Automation is needed only for the one thing the script cannot know — where the
// canvas sits on screen.
//
// Everything is in physical pixels, because Win32 and UIA both are. The caller
// converts to the DIPs Electron wants, since only Electron knows the display
// scale for a given window.

let native

function loadNative() {
  if (!native) {
    try {
      native = require("./build/Release/winhelper.node")
    } catch (err) {
      throw new Error(
        `@karaoke-v/windows-helper: native addon not built for this runtime. ` +
          `apps/karaoke-v dev/start runs the Electron rebuild automatically. ` +
          `Original error: ${err.message}`,
      )
    }
  }
  return native
}

/** Canvas sizes agree this closely before the cached element is trusted. */
const CANVAS_TOLERANCE_PX = 2

/**
 * contentW only ever gets compared against itself to detect zoom changes, so it
 * needs to be proportional to the zoom rather than an actual content width —
 * which the script never reports. Scaling one fixed span of blicks gives that.
 */
const ZOOM_REFERENCE_BLICKS = 1e9

/** A scan costs ~150ms, so a missing bridge is retried at human speed, not per frame. */
const ATTACH_RETRY_MS = 1000

/**
 * No heartbeat movement for this long means the script died holding the buffer.
 * Generous on purpose: `SV.setTimeout` runs on SynthV's UI thread, so a busy
 * moment stalls the tick without anything being wrong, and treating that as
 * death costs a full ~150ms address-space rescan.
 */
const STALE_MS = 3000

let canvasRect = null
let canvasFor = null
let canvasOffset = null
let lastSchedule = null
let lastAttemptMs = 0
let lastState = null
let lastHeartbeat = -1
let lastHeartbeatMs = 0

function attach(target = "synthv-studio") {
  canvasRect = null
  canvasFor = null
  canvasOffset = null
  lastSchedule = null
  lastState = null
  lastHeartbeat = -1
  return loadNative().attach(target)
}

// Every process that reads the bridge has to find it for itself: the addon's
// handle and base address are per-process statics, and main and the renderers
// each load their own copy. Attaching lazily here is what lets the renderer call
// getViewport() without knowing any of that.
function ensureAttached(target) {
  if (loadNative().isAttached()) {
    return true
  }
  const now = Date.now()
  if (now - lastAttemptMs < ATTACH_RETRY_MS) {
    return false
  }
  lastAttemptMs = now
  return attach(target) !== null
}

// A buffer whose magic is intact but whose heartbeat has stopped belongs to a
// script that is gone — rescanning the scripts menu tears the context down and
// leaves exactly that. Reattaching is the only way back.
function checkLiveness(state) {
  const now = Date.now()
  if (state.heartbeat !== lastHeartbeat) {
    lastHeartbeat = state.heartbeat
    lastHeartbeatMs = now
    return true
  }
  if (now - lastHeartbeatMs < STALE_MS) {
    return true
  }
  detach()
  return false
}

function detach() {
  if (native) {
    native.detach()
  }
  canvasRect = null
  canvasFor = null
  canvasOffset = null
  lastSchedule = null
  lastState = null
}

function isAttached() {
  return loadNative().isAttached()
}

function readState(target = "synthv-studio") {
  // Attempt first, verify only on failure: the happy path is one cross-process
  // read, and this runs per frame in the renderer.
  let state = loadNative().readState()
  if (!state) {
    if (!ensureAttached(target)) {
      return null
    }
    state = loadNative().readState()
  }
  if (!state) {
    // One tick of staleness is invisible; a frame with no geometry is not. The
    // heartbeat check below still reports a genuinely dead bridge as null, so
    // this only smooths over a read that lost its race with the writer.
    return lastState && Date.now() - lastHeartbeatMs < STALE_MS ? lastState : null
  }
  if (!checkLiveness(state)) {
    return null
  }
  lastState = state
  return state
}

function getScheduleRevision() {
  return loadNative().getScheduleRevision()
}

function readSchedule() {
  return loadNative().readSchedule()
}

function sendCommand(command, arg = 0) {
  return loadNative().sendCommand(command, arg)
}

function expectedCanvasSize(state) {
  return {
    width: (state.viewT1 - state.viewT0) * state.pxPerBlick,
    height: (state.viewV1 - state.viewV0) * state.pxPerValue,
  }
}

// The canvas is identified by agreeing with the bridge about its size, so a
// cached element has to be re-resolved whenever the expected size moves — a
// window resize or a panel drag changes it, and the old element may now be
// something else entirely.
function ensureCanvas(state, target) {
  const want = expectedCanvasSize(state)
  if (!(want.width > 0 && want.height > 0)) {
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

  const found = loadNative().findCanvas({ ...want, target })
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

function viewportFrom(state, canvas) {
  return {
    canvas,
    // The overlay window is positioned to exactly this rectangle, so the renderer
    // can map to window-local coordinates against a value sampled at the same
    // instant as the canvas — rather than against Chromium's own idea of where
    // the window is, which updates on its own schedule.
    origin: canvasOffset
      ? { x: canvas.x - canvasOffset.x, y: canvas.y - canvasOffset.y }
      : undefined,
    // Screen y of value 0. macOS has to track a reference chip to get this;
    // here the transform states it outright.
    refY: canvas.y + state.y0,
    // Screen x of blick 0: the same quantity macOS reads off the content group's
    // left edge, so it moves with horizontal scroll in the same way.
    contentX: canvas.x + state.x0,
    contentW: state.pxPerBlick * ZOOM_REFERENCE_BLICKS,
  }
}

/**
 * Viewport (canvas rect + scroll/zoom) in physical pixels. Cheap enough to call
 * per frame: one memory read plus one cached UI Automation property read.
 * @param {string} [target="synthv-studio"]
 */
function getViewport(target = "synthv-studio") {
  const state = readState(target)
  if (!state) {
    return null
  }
  const canvas = ensureCanvas(state, target)
  if (!canvas) {
    return null
  }
  return viewportFrom(state, canvas)
}

/**
 * Piano-roll geometry: the viewport plus a rect per note. Unlike the macOS walk
 * these rects are derived from the bridge's own transform, so they cannot be
 * skewed by a scroll landing mid-read — the stability flags are always true.
 * @param {string} [target="synthv-studio"]
 */
function getPianoRoll(target = "synthv-studio") {
  const state = readState(target)
  if (!state) {
    return null
  }
  const canvas = ensureCanvas(state, target)
  if (!canvas) {
    return null
  }
  // The schedule only changes when the script publishes a new revision, so the
  // last copy stays correct between publishes. Holding it means a read that lost
  // a race cannot blank the notes for a frame.
  const schedule = readSchedule() ?? lastSchedule
  if (!schedule) {
    return null
  }
  lastSchedule = schedule

  const notes = []
  for (const note of schedule.notes) {
    const x = canvas.x + state.x0 + note.onsetBlick * state.pxPerBlick
    const w = (note.endBlick - note.onsetBlick) * state.pxPerBlick
    // v2y answers where a pitch *value* sits, and a note's lane is centred on that
    // value rather than starting at it — so the top edge is half a semitone above.
    const y = canvas.y + state.y0 - (note.pitch + 0.5) * state.pxPerValue
    if (x + w < canvas.x || x > canvas.x + canvas.w) {
      continue
    }
    notes.push({ x, y, w, h: state.pxPerValue })
  }

  return {
    ...viewportFrom(state, canvas),
    yStable: true,
    xStable: true,
    notes,
  }
}

function getPianoRollAsync(target = "synthv-studio") {
  return Promise.resolve(getPianoRoll(target))
}

function start(options) {
  const { target, onFrame, onStatus } = options
  loadNative().start({
    target,
    onFrame: (x, y, w, h) => onFrame({ x, y, w, h }),
    onStatus: (state) => {
      onStatus(state === "attached" ? { state, mode: "event" } : { state })
    },
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
  attach,
  detach,
  isAttached,
  readState,
  getScheduleRevision,
  readSchedule,
  sendCommand,
  getViewport,
  getPianoRoll,
  getPianoRollAsync,
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
