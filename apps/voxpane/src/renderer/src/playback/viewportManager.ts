import type { Viewport } from "../../../shared/geometry"
import type { ViewportReadProbeEvent } from "./latencyProbe"

type Timer = ReturnType<typeof setTimeout>

export interface ViewportManagerOptions {
  intervalMs?: number
  schedule?: (callback: () => void, delayMs: number) => Timer | number
  cancel?: (timer: Timer | number) => void
  now?: () => number
  onRead?: (event: ViewportReadProbeEvent) => void
}

export class ViewportManager {
  private readonly intervalMs: number
  private readonly schedule: (callback: () => void, delayMs: number) => Timer | number
  private readonly cancel: (timer: Timer | number) => void
  private readonly now: () => number
  private readonly onRead: ((event: ViewportReadProbeEvent) => void) | null
  private running = false
  private pending = false
  private timer: Timer | number | null = null
  private latest: Viewport | null = null
  private generation = 0

  constructor(
    private readonly read: () => Promise<Viewport | null>,
    options: ViewportManagerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 0
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

  current(): Viewport | null {
    return this.latest
  }

  adopt(viewport: Viewport): void {
    this.generation += 1
    this.latest = viewport
  }

  private async tick(): Promise<void> {
    if (!this.running || this.pending) {
      return
    }
    this.pending = true
    const generation = this.generation
    const startedAtMs = this.now()
    let viewport: Viewport | null = null
    let accepted = false
    try {
      viewport = await this.read()
      if (viewport && generation === this.generation) {
        this.latest = viewport
        accepted = true
      }
    } catch {
      // A failed viewport read is equivalent to no viewport for this tick.
    } finally {
      this.onRead?.({
        startedAtMs,
        finishedAtMs: this.now(),
        viewport,
        accepted,
      })
      this.pending = false
      if (this.running) {
        this.timer = this.schedule(() => void this.tick(), this.intervalMs)
      }
    }
  }
}
