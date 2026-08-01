export type StickStatus =
  | { state: "attached"; mode: "ax" | "poll" }
  | { state: "waiting" }
  | { state: "hidden" }
  | { state: "permission" }
  | { state: "unsupported" }

export interface TargetFrame {
  /** Top-left origin in global points — ready to pass to Electron's setBounds. */
  x: number
  y: number
  w: number
  h: number
}

export interface StartOptions {
  /** Case-insensitive substring of the target app's localized name. */
  target: string
  /** Called as the target window moves/resizes, with its screen frame. */
  onFrame(frame: TargetFrame): void
  onStatus(status: StickStatus): void
}

/** Start tracking the target app's window. */
export function start(options: StartOptions): void
/** Stop tracking and release resources. */
export function stop(): void
/** Disable AppKit's automatic show/hide/order animations for a window. */
export function disableAnimations(view: Buffer): void

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PianoRoll {
  /** Visible piano-roll viewport, global screen points. */
  canvas: Rect
  /** Content group's left edge (screen x) = horizontal scroll offset. */
  contentX: number
  /** Total content width in px (the zoom scale). */
  contentW: number
  /** Visible note rects, global screen points. */
  notes: Rect[]
}

/**
 * One-shot read of the target's piano-roll geometry. A full AX walk is ~50ms —
 * poll modestly, not per-frame. Returns null if the target/piano-roll isn't found.
 */
export function getPianoRoll(target?: string): PianoRoll | null
