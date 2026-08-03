export interface Attachment {
  pid: number
  /** Base address of the bridge buffer, decimal, as a string — it does not fit a number. */
  address: string
  version: number
  /** `Date.now()` inside SynthV when the buffer was allocated. */
  epochMs: number
  /** The script's nominal tick interval. */
  tickMs: number
  /** Validated buffers found; more than one means older script runs are still ticking. */
  candidates: number
}

/** 0 stopped, 1 playing, 2 looping — matches the script's status encoding. */
export type TransportStatus = 0 | 1 | 2

export interface BridgeState {
  /** Sequence the seqlock accepted this read under. */
  seq: number
  /** Script tick counter; stops advancing when the bridge dies. */
  heartbeat: number
  status: TransportStatus
  /** `Date.now()` inside SynthV at the moment this snapshot was written. */
  tickTimeMs: number
  playheadSec: number
  playheadBlick: number
  /** Visible time range, in blicks. */
  viewT0: number
  viewT1: number
  viewV0: number
  viewV1: number
  pxPerBlick: number
  pxPerValue: number
  /** `t2x(0)` — editor-space x of blick 0. Editor space, not screen space. */
  x0: number
  /** `v2y(0)` — editor-space y of value 0. */
  y0: number
}

export interface ScheduledNote {
  /** Absolute onset, group time offset already applied. */
  onsetBlick: number
  endBlick: number
  onsetSec: number
  endSec: number
  pitch: number
  lyric: string
}

export interface Schedule {
  revision: number
  timeOffset: number
  pitchOffset: number
  notes: ScheduledNote[]
}

/**
 * Find the bridge script's buffer in the target process and hold on to it. Costs a
 * full address-space scan (~150ms); call on connect and reconnect, never per frame.
 * Null when the process, the script or a live buffer is missing.
 */
export function attach(target?: string): Attachment | null

/** Release the process handle and forget the buffer. */
export function detach(): void

/** Whether a buffer with an intact header is currently held. */
export function isAttached(): boolean

/**
 * Latest playhead and view transform, or null when the read caught the script
 * mid-write, when nothing is attached yet, or when the script died. Null means
 * "retry", not "stopped" — attaching is retried from here. Safe per frame.
 */
export function readState(target?: string): BridgeState | null

/** Cheap poll; read the schedule only when this differs from the one you hold. */
export function getScheduleRevision(): number | null

/** The published note schedule, or null if the script flipped buffers mid-read. */
export function readSchedule(): Schedule | null

/** Queue a command for the script; it acknowledges by echoing the sequence number. */
export function sendCommand(command: number, arg?: number): number | null

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Viewport {
  /** Visible piano-roll viewport, physical screen pixels. */
  canvas: Rect
  /**
   * Origin of the target window, sampled with the canvas. The overlay is
   * positioned to exactly this, so mapping to window-local coordinates against it
   * keeps both numbers from the same instant.
   */
  origin?: { x: number; y: number }
  /** Screen x of blick 0 — moves with horizontal scroll. */
  contentX: number
  /** Proportional to the zoom; only meaningful compared against itself. */
  contentW: number
  /** Screen y of value 0; the vertical scroll reference. */
  refY: number
}

export interface PianoRoll extends Viewport {
  /** Always true here — rects are computed, so a scroll cannot skew them. */
  yStable: boolean
  xStable: boolean
  /** Visible note rects, physical screen pixels. */
  notes: Rect[]
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

/** Viewport in physical pixels, or null when the bridge or canvas is missing. */
export function getViewport(target?: string): Viewport | null
/** Viewport plus computed note rects, physical pixels. */
export function getPianoRoll(target?: string): PianoRoll | null
/** Present for parity with the macOS helper; the work here is already cheap. */
export function getPianoRollAsync(target?: string): Promise<PianoRoll | null>

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
