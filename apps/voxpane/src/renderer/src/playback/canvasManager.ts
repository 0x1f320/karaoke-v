import type { CanvasSnapshot } from "../../../shared/geometry"
import type { CanvasReadProbeEvent } from "./latencyProbe"

type Timer = ReturnType<typeof setTimeout>

export interface CanvasManagerOptions {
  intervalMs?: number
  schedule?: (callback: () => void, delayMs: number) => Timer | number
  cancel?: (timer: Timer | number) => void
  now?: () => number
  onRead?: (event: CanvasReadProbeEvent) => void
}

export class CanvasManager {
  private readonly intervalMs: number
  private readonly schedule: (callback: () => void, delayMs: number) => Timer | number
  private readonly cancel: (timer: Timer | number) => void
  private readonly now: () => number
  private readonly onRead: ((event: CanvasReadProbeEvent) => void) | null
  private running = false
  private pending = false
  private timer: Timer | number | null = null
  private latest: CanvasSnapshot | null = null

  constructor(
    private readonly read: () => Promise<CanvasSnapshot | null>,
    options: CanvasManagerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 250
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer as Timer))
    this.now = options.now ?? (() => performance.now())
    this.onRead = options.onRead ?? null
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      this.cancel(this.timer)
      this.timer = null
    }
  }

  current(): CanvasSnapshot | null {
    return this.latest
  }

  private async tick(): Promise<void> {
    if (!this.running || this.pending) {
      return
    }
    this.pending = true
    const startedAtMs = this.now()
    let snapshot: CanvasSnapshot | null = null
    let accepted = false
    try {
      snapshot = await this.read()
      if (snapshot) {
        this.latest = snapshot
        accepted = true
      }
    } catch {}
    this.onRead?.({
      startedAtMs,
      finishedAtMs: this.now(),
      snapshot,
      accepted,
    })
    this.pending = false
    if (this.running) {
      this.timer = this.schedule(() => void this.tick(), this.intervalMs)
    }
  }
}
