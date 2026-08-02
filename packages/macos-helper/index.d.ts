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
  /** The vertical reference chip's y at read time. Compare with Viewport.refY
   *  to get the vertical scroll delta in pixels. */
  refY: number
  /** False when vertical scroll moved during the read — note y values are then
   *  mutually skewed and the read should be discarded. */
  yStable: boolean
  /** Visible note rects, global screen points. */
  notes: Rect[]
}

export interface Viewport {
  /** Visible piano-roll viewport, global screen points. */
  canvas: Rect
  /** Content group's left edge = horizontal scroll offset (px). */
  contentX: number
  /** Total content width (zoom scale). */
  contentW: number
  /** Current y of the cached vertical-reference chip (from the last stable full
   *  read); (refY - PianoRoll.refY) = vertical scroll delta in px. Absent when
   *  the reference element is gone (edit/track switch) — a full read restores it. */
  refY?: number
}

/**
 * One-shot read of the target's piano-roll geometry. A full AX walk is ~50ms —
 * poll modestly, not per-frame. Returns null if the target/piano-roll isn't found.
 * Also caches the geometry elements so getViewport can read cheaply afterward.
 */
export function getPianoRoll(target?: string): PianoRoll | null

/**
 * Like getPianoRoll but runs the AX walk off the main thread, so notes can be
 * refreshed without hitching the event loop. Resolves to null if not found.
 */
export function getPianoRollAsync(target?: string): Promise<PianoRoll | null>

/**
 * Cheap read of the viewport (canvas rect + scroll/zoom) from the cached elements
 * — safe per-frame. Null until getPianoRoll has run, or if the cache went stale.
 */
export function getViewport(): Viewport | null

export interface BridgeOptions {
  /** Prefix identifying our payloads; anything else on the clipboard is the user's. */
  marker: string
  /** Raw payload text, plus the addon-clock time (ms) at which it was detected. */
  onPayload(text: string, monotonicMs: number): void
}

/**
 * Watch the clipboard for payloads from the SynthV bridge script. The script
 * writes on transport events and takes the payload back shortly after, so this
 * catches blips rather than reading a stream.
 */
export function startBridge(options: BridgeOptions): void

/** Stop watching the clipboard. */
export function stopBridge(): void

/**
 * Reading of the same monotonic clock used to stamp payloads, so their age can
 * be measured without assuming anything about process clocks.
 */
export function monotonicNow(): number
