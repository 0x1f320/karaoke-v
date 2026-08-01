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
