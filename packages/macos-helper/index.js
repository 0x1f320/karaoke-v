// Exposes a small typed API over the compiled native addon. The addon runs the
// AXObserver follow loop in-process and emits the target window's frame (top-left
// origin, global points — ready for Electron's setBounds); the JS side does the
// actual positioning so multi-monitor display mapping stays correct. The native
// binding is loaded lazily so importing this package is safe on any platform.

let native

function loadNative() {
  if (!native) {
    try {
      native = require("./build/Release/stick.node")
    } catch (err) {
      throw new Error(
        `@karaoke-v/macos-helper: native addon not built for this runtime. ` +
          `apps/karaoke-v dev/start runs the Electron rebuild automatically. ` +
          `Original error: ${err.message}`,
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
  loadNative().start({
    target,
    onFrame: (x, y, w, h) => onFrame({ x, y, w, h }),
    onStatus: (state, mode) => {
      onStatus(state === "attached" ? { state, mode } : { state })
    },
  })
}

function stop() {
  if (native) {
    native.stop()
  }
}

module.exports = { start, stop }
