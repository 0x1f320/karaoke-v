import type { CanvasSnapshot, Viewport } from "../../../shared/geometry"

const EPS = 0.5
const IDLE_MS = 120
const RENDERER_MS = 8
const SOURCE_GAP_MS = 8

export interface LatencyProbeFrame {
  atMs: number
  frame: number
  native: CanvasSnapshot | null
  applied: Viewport | null
  drawStartedAtMs: number
  drawEndedAtMs: number
}

export interface CanvasReadProbeEvent {
  startedAtMs: number
  finishedAtMs: number
  snapshot: CanvasSnapshot | null
  accepted: boolean
}

type Signature = {
  x: number
  y: number
  w: number
  h: number
  contentX: number
  contentW: number
  refY: number | null
  viewLeft: number | null
  viewRight: number | null
  viewTop: number | null
  viewBottom: number | null
  perBlick: number | null
  perSemitone: number | null
}

interface Burst {
  startMs: number
  lastMovementMs: number
  frames: number
  firstNativeMs: number | null
  firstBridgeMs: number | null
  firstAppliedMs: number | null
  maxAppliedToDrawMs: number
  maxViewportReadMs: number
  viewportReads: number
}

export interface ScrollLatencyProbeOptions {
  log?: (line: string) => void
}

export class ScrollLatencyProbe {
  private enabled = true
  private lastNative: Signature | null = null
  private lastApplied: Signature | null = null
  private lastBridge: string | null = null
  private burst: Burst | null = null
  private readonly log: (line: string) => void

  constructor(options: ScrollLatencyProbeOptions = {}) {
    this.log = options.log ?? ((line) => console.info(line))
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return
    }
    this.enabled = enabled
    if (!enabled) {
      this.reset()
    }
  }

  sample(frame: LatencyProbeFrame): void {
    if (!this.enabled) {
      return
    }

    this.flushIfIdle(frame.atMs)

    const native = signature(frame.native)
    const applied = signature(frame.applied)
    const bridge = bridgeSignature(frame.applied)
    if (this.lastNative === null && this.lastApplied === null && this.lastBridge === null) {
      this.lastNative = native
      this.lastApplied = applied
      this.lastBridge = bridge
      return
    }
    const nativeMoved = moved(this.lastNative, native)
    const appliedMoved = moved(this.lastApplied, applied)
    const bridgeMoved = this.lastBridge !== null && bridge !== null && this.lastBridge !== bridge

    this.lastNative = native
    this.lastApplied = applied
    this.lastBridge = bridge

    if (!nativeMoved && !appliedMoved && !bridgeMoved) {
      return
    }

    const burst = this.currentBurst(frame.atMs)
    burst.lastMovementMs = frame.atMs
    burst.frames += 1
    if (nativeMoved && burst.firstNativeMs === null) {
      burst.firstNativeMs = frame.atMs
    }
    if (bridgeMoved && burst.firstBridgeMs === null) {
      burst.firstBridgeMs = frame.atMs
    }
    if (appliedMoved && burst.firstAppliedMs === null) {
      burst.firstAppliedMs = frame.atMs
    }
    if (appliedMoved) {
      burst.maxAppliedToDrawMs = Math.max(
        burst.maxAppliedToDrawMs,
        frame.drawEndedAtMs - frame.drawStartedAtMs,
      )
    }
  }

  recordCanvasRead(event: CanvasReadProbeEvent): void {
    if (!this.enabled || !this.burst) {
      return
    }
    this.burst.viewportReads += 1
    this.burst.maxViewportReadMs = Math.max(
      this.burst.maxViewportReadMs,
      event.finishedAtMs - event.startedAtMs,
    )
  }

  private currentBurst(atMs: number): Burst {
    if (!this.burst) {
      this.burst = {
        startMs: atMs,
        lastMovementMs: atMs,
        frames: 0,
        firstNativeMs: null,
        firstBridgeMs: null,
        firstAppliedMs: null,
        maxAppliedToDrawMs: 0,
        maxViewportReadMs: 0,
        viewportReads: 0,
      }
    }
    return this.burst
  }

  private flushIfIdle(atMs: number): void {
    if (!this.burst || atMs - this.burst.lastMovementMs < IDLE_MS) {
      return
    }
    this.log(formatReport(this.burst))
    this.burst = null
  }

  private reset(): void {
    this.lastNative = null
    this.lastApplied = null
    this.lastBridge = null
    this.burst = null
  }
}

function signature(viewport: CanvasSnapshot | Viewport | null): Signature | null {
  if (!viewport) {
    return null
  }
  const detailed = "contentX" in viewport ? viewport : null
  const mapping = detailed?.source?.mapping
  return {
    x: viewport.canvas.x,
    y: viewport.canvas.y,
    w: viewport.canvas.w,
    h: viewport.canvas.h,
    contentX: detailed?.contentX ?? 0,
    contentW: detailed?.contentW ?? 0,
    refY: detailed?.refY ?? null,
    viewLeft: mapping?.viewLeft ?? null,
    viewRight: mapping?.viewRight ?? null,
    viewTop: mapping?.viewTop ?? null,
    viewBottom: mapping?.viewBottom ?? null,
    perBlick: mapping?.perBlick ?? null,
    perSemitone: mapping?.perSemitone ?? null,
  }
}

function bridgeSignature(viewport: Viewport | null): string | null {
  const source = viewport?.source
  if (!source) {
    return null
  }
  const { mapping } = source
  return [
    mapping.viewLeft,
    mapping.viewRight,
    mapping.viewTop,
    mapping.viewBottom,
    mapping.perBlick,
    mapping.perSemitone,
  ].join(":")
}

function moved(before: Signature | null, after: Signature | null): boolean {
  if (!before || !after) {
    return before !== after
  }
  return (
    Math.abs(before.x - after.x) > EPS ||
    Math.abs(before.y - after.y) > EPS ||
    Math.abs(before.w - after.w) > EPS ||
    Math.abs(before.h - after.h) > EPS ||
    Math.abs(before.contentX - after.contentX) > EPS ||
    Math.abs(before.contentW - after.contentW) > EPS ||
    absDiff(before.refY, after.refY) > EPS ||
    absDiff(before.viewLeft, after.viewLeft) > EPS ||
    absDiff(before.viewRight, after.viewRight) > EPS ||
    absDiff(before.viewTop, after.viewTop) > EPS ||
    absDiff(before.viewBottom, after.viewBottom) > EPS ||
    absDiff(before.perBlick, after.perBlick) > EPS ||
    absDiff(before.perSemitone, after.perSemitone) > EPS
  )
}

function absDiff(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : Number.POSITIVE_INFINITY
  }
  return Math.abs(a - b)
}

function formatReport(burst: Burst): string {
  const nativeToApplied = delta(burst.firstNativeMs, burst.firstAppliedMs)
  const bridgeToApplied = delta(burst.firstBridgeMs, burst.firstAppliedMs)
  const bottleneck = diagnose(burst, nativeToApplied)
  return [
    "[voxpane latency]",
    `bottleneck=${bottleneck}`,
    `frames=${burst.frames}`,
    `native->applied=${fmt(nativeToApplied)}`,
    `bridge->applied=${fmt(bridgeToApplied)}`,
    `applied->draw=${fmt(burst.maxAppliedToDrawMs)}`,
    `viewportReadMax=${fmt(burst.maxViewportReadMs)}`,
    `viewportReads=${burst.viewportReads}`,
  ].join(" ")
}

function diagnose(burst: Burst, nativeToApplied: number | null): string {
  if (burst.maxAppliedToDrawMs >= RENDERER_MS) {
    return "renderer"
  }
  if (nativeToApplied !== null && nativeToApplied >= SOURCE_GAP_MS) {
    return "bridge"
  }
  if (burst.maxViewportReadMs >= SOURCE_GAP_MS) {
    return "native"
  }
  return "undetermined"
}

function delta(from: number | null, to: number | null): number | null {
  if (from === null || to === null) {
    return null
  }
  return to - from
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}ms`
}
