import type { BridgeNote, BridgeState } from "./bridgeChannels"
import type { PianoRoll, Rect, Viewport } from "./geometry"

// Where notes are on screen, on Windows.
//
// The two platforms reach the same answer from opposite directions. macOS reads
// the Accessibility tree: the note rectangles are already there, and the bridge
// only says which of them is sounding. Windows has no such tree — JUCE draws the
// piano roll into a single HWND — so the rectangles are *computed* from the
// script's own view transform, and UI Automation is needed for the one thing the
// script cannot know: where the canvas sits on screen.
//
// This is the arithmetic half of that, kept pure and away from the addon so it
// can be tested on a machine that is not Windows.

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
    // The overlay window is positioned to exactly this rectangle, so the
    // renderer can map to window-local coordinates against a value sampled at
    // the same instant as the canvas — rather than against Chromium's own idea
    // of where the window is, which updates on its own schedule.
    origin: windowOrigin,
    // Screen y of value 0. macOS has to track a reference chip to get this; here
    // the transform states it outright.
    refY: canvas.y + at.y,
    // Screen x of blick 0: the same quantity macOS reads off the content group's
    // left edge, so it moves with horizontal scroll in the same way.
    contentX: canvas.x + at.x,
    contentW: state.px.perBlick * ZOOM_REFERENCE_BLICKS,
  }
}

/**
 * The viewport plus a rect per visible note. Unlike the macOS walk these rects
 * come from the transform rather than from a tree being read while it moves, so
 * they cannot be skewed by a scroll landing mid-read — the stability flags are
 * always true.
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
