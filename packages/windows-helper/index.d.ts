export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type StickStatus =
  | { state: "attached"; mode: "event" }
  | { state: "waiting" }
  | { state: "hidden" }
  | { state: "unsupported" }

export interface TargetFrame extends Rect {
  visible: boolean
  foreground: boolean
}

export interface StartOptions {
  target: string
  onFrame(frame: Rect): void
  onStatus(status: StickStatus): void
}

/**
 * The piano-roll canvas rectangle, in physical pixels. It is identified by
 * agreeing with the bridge about its size, which the caller works out from the
 * script's view transform — Windows has no accessibility tree to find it in, and
 * the arithmetic lives in the app so it can be tested off-Windows.
 */
export function getCanvas(want: { width: number; height: number }, target?: string): Rect | null

/** The target window's origin, sampled with the canvas the last call returned. */
export function getCanvasOrigin(): { x: number; y: number } | undefined

/** Follow the target window. Must be called from the Electron main thread. */
export function start(options: StartOptions): void
export function stop(): void
/**
 * Glue a window to the target: it becomes an owned window, so Windows keeps it
 * directly above SynthV, moves and minimises it alongside, and lets anything
 * stacked above SynthV cover it. Repositioning then happens natively, inside the
 * same message batch as SynthV's own move. Pass getNativeWindowHandle().
 */
export function follow(handle: Buffer): void
/** Release the ownership and stop repositioning. */
export function unfollow(): void
/** One-shot read of the target window's frame, physical pixels. */
export function getTargetFrame(target?: string): TargetFrame | null
/** No-op; Windows has no equivalent of AppKit's implicit window animations. */
export function disableAnimations(view?: Buffer): void
/** QueryPerformanceCounter, in milliseconds. */
export function monotonicNow(): number
/** Origin of the target window, or null once the cached window handle is stale. */
export function getTargetOrigin(): Rect | null
/** Debug aid: every UI Automation child of the SynthV window with its rect. */
export function listElements(target?: string): (Rect & { controlType: number })[] | null
