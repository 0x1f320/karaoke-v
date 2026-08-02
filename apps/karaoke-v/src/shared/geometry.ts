import type {
  PianoRoll as MacPianoRoll,
  Viewport as MacViewport,
  Rect,
} from "@karaoke-v/macos-helper"

// The geometry the renderer works in, kept apart from native.ts so the web build
// does not pull Node types in through it.

export type { Rect }

/**
 * The Windows helper also reports the target window's origin, sampled in the same
 * breath as the canvas rectangle. Mapping global coordinates to window-local ones
 * against that, rather than against `window.screenX`, keeps both numbers from the
 * same instant — otherwise the drawing slides while the window is being dragged.
 */
export interface Viewport extends MacViewport {
  origin?: { x: number; y: number }
}

export interface PianoRoll extends MacPianoRoll {
  origin?: { x: number; y: number }
}
