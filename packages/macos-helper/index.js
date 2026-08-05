// Exposes a small typed API over the compiled native addon. The addon runs the
// AXObserver follow loop in-process and emits the target window's frame (top-left
// origin, global points — ready for Electron's setBounds); the JS side does the
// actual positioning so multi-monitor display mapping stays correct.
//
// The napi-rs loader is required lazily rather than at module scope: importing
// this package has to stay safe on Windows, where the .node does not exist.

let native

function loadNative() {
  if (!native) {
    try {
      native = require("./binding.js")
    } catch (err) {
      throw new Error(
        `@voxpane/macos-helper: native addon not built for this runtime. ` +
          `Run pnpm build in the workspace. Original error: ${err.message}`,
      )
    }
  }
  return native
}

/**
 * Start tracking the target app's window.
 * @param {object} options
 * @param {string} options.target case-insensitive substring of the target app's name
 * @param {(frame: { x: number, y: number, w: number, h: number }) => void} options.onFrame
 *   target window frame (top-left origin, global points)
 * @param {(status: { state: string, mode?: string }) => void} options.onStatus
 */
function start(options) {
  const { target, onFrame, onStatus } = options
  loadNative().start(target, onFrame, (status) => {
    onStatus(status.state === "attached" ? status : { state: status.state })
  })
}

function stop() {
  if (native) {
    native.stop()
  }
}

/**
 * One-shot read of the target's piano-roll geometry (global screen points).
 * A full AX walk is ~50ms — poll modestly, not per-frame.
 * @param {string} [target="synthesizer"] case-insensitive substring of the app name
 * @returns {null | { canvas: {x,y,w,h}, contentX: number, contentW: number, notes: {x,y,w,h}[] }}
 */
function getPianoRoll(target = "synthesizer") {
  return loadNative().getPianoRoll(target)
}

/**
 * Like getPianoRoll but runs the AX walk off the main thread — refresh notes
 * without hitching. Resolves to the geometry or null.
 * @param {string} [target="synthesizer"]
 * @returns {Promise<null | { canvas: {x,y,w,h}, contentX: number, contentW: number, notes: {x,y,w,h}[] }>}
 */
function getPianoRollAsync(target = "synthesizer") {
  return loadNative().getPianoRollAsync(target)
}

/**
 * Cheap read of the viewport (canvas rect + scroll/zoom) from cached elements —
 * safe to call per-frame. Returns null until getPianoRoll has run, or if the
 * cached elements went stale (call getPianoRoll again to re-resolve).
 * @returns {null | { canvas: {x,y,w,h}, contentX: number, contentW: number }}
 */
function getViewport() {
  return loadNative().getViewport()
}

/**
 * Disable AppKit's automatic show/hide/order animations for a window.
 * @param {Buffer} view result of BrowserWindow.getNativeWindowHandle()
 */
function disableAnimations(view) {
  loadNative().disableAnimations(view)
}

/**
 * Press Scripts > Rescan in the target app, so a script file that has just been
 * written is loaded by a SynthV that is already running. False when the app is
 * not running or the menu could not be found.
 * @param {string} [target="synthesizer"]
 * @returns {boolean}
 */
function rescanScripts(target = "synthesizer") {
  return loadNative().rescanScripts(target)
}

/**
 * Reading of the same monotonic clock the addon stamps its reads with, so a
 * read's age can be measured without assuming anything about process clocks.
 * @returns {number} milliseconds
 */
function monotonicNow() {
  return loadNative().monotonicNow()
}

module.exports = {
  start,
  stop,
  disableAnimations,
  getPianoRoll,
  getPianoRollAsync,
  getViewport,
  rescanScripts,
  monotonicNow,
}
