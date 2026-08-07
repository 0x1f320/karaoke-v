import type {
  PianoRoll as MacPianoRoll,
  Viewport as MacViewport,
  Rect,
} from "@voxpane/macos-helper"
import type { BridgeViewMapping } from "./bridgeChannels"

// The geometry the renderer works in, kept apart from native.ts so the web build
// does not pull Node types in through it.

export type { Rect }

/**
 * The Windows helper also reports the target window's origin, sampled in the same
 * breath as the canvas rectangle. Mapping global coordinates to window-local ones
 * against that, rather than against `window.screenX`, keeps both numbers from the
 * same instant — otherwise the drawing slides while the window is being dragged.
 */
export interface CanvasSnapshot {
  canvas: Rect
  origin?: { x: number; y: number }
}

export interface Viewport extends MacViewport, CanvasSnapshot {
  origin?: { x: number; y: number }
  source?: {
    seq: number
    mapping: BridgeViewMapping
  }
}

export interface PianoRoll extends MacPianoRoll {
  origin?: { x: number; y: number }
}
