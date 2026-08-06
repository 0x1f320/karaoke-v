import type { BridgeNote, BridgeState } from "./bridgeChannels"
import type { PianoRoll, Rect, Viewport } from "./geometry"

// Where notes are on screen, computed from the bridge's musical coordinates and
// view transform. Native helpers answer only where the piano-roll canvas sits on
// screen; the script supplies the rest.

/** The canvas the script is looking through, in physical pixels. */
export function expectedCanvasSize(state: BridgeState): { width: number; height: number } {
  const { perBlick, perSemitone, viewLeft, viewRight, viewTop, viewBottom } = state.px
  return {
    width: (viewRight - viewLeft) * perBlick,
    height: (viewTop - viewBottom) * perSemitone,
  }
}

/** Screen x of blick 0, and screen y of value 0, relative to the canvas. */
function origin(state: BridgeState): { x: number; y: number } {
  return {
    x: -state.px.viewLeft * state.px.perBlick,
    y: state.px.viewTop * state.px.perSemitone,
  }
}

/**
 * contentW is only ever compared against itself to detect zoom changes, so it
 * has to be proportional to the zoom rather than an actual content width —
 * which the script never reports. Scaling one fixed span of blicks gives that.
 */
const ZOOM_REFERENCE_BLICKS = 1e9

export function viewportFrom(
  state: BridgeState,
  canvas: Rect,
  windowOrigin?: { x: number; y: number },
): Viewport & { refY: number } {
  const at = origin(state)
  return {
    canvas,
    source: { seq: state.seq, mapping: state.px },
    // The overlay window is positioned to exactly this rectangle, so the
    // renderer can map to window-local coordinates against a value sampled at
    // the same instant as the canvas — rather than against Chromium's own idea
    // of where the window is, which updates on its own schedule.
    origin: windowOrigin,
    // Screen y of value 0. Keeping this in the same transform as the notes means
    // vertical scroll cannot skew individual rectangles apart.
    refY: canvas.y + at.y,
    // Screen x of blick 0. This moves with horizontal scroll and is paired with
    // contentW so the renderer can rebase stale reads onto fresh viewports.
    contentX: canvas.x + at.x,
    contentW: state.px.perBlick * ZOOM_REFERENCE_BLICKS,
  }
}

/**
 * The viewport plus a rect per visible note. Rects come from one bridge view
 * transform rather than from a tree being read while it moves, so they cannot
 * be skewed by a scroll landing mid-read — the stability flags are always true.
 */
export function pianoRollFrom(
  state: BridgeState,
  notes: readonly BridgeNote[],
  canvas: Rect,
  windowOrigin?: { x: number; y: number },
): PianoRoll {
  const at = origin(state)
  const { perBlick, perSemitone } = state.px
  const rects: Rect[] = []

  for (const note of notes) {
    const x = canvas.x + at.x + note.onB * perBlick
    const w = (note.offB - note.onB) * perBlick
    if (x + w < canvas.x || x > canvas.x + canvas.w) {
      continue
    }
    // v2y answers where a pitch *value* sits, and a note's lane is centred on
    // that value rather than starting at it — so the top edge is half a
    // semitone above.
    const y = canvas.y + at.y - (note.pitch + 0.5) * perSemitone
    rects.push({ x, y, w, h: perSemitone })
  }

  return {
    ...viewportFrom(state, canvas, windowOrigin),
    yStable: true,
    xStable: true,
    notes: rects,
  }
}
