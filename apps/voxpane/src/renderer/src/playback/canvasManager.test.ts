import { describe, expect, it } from "vitest"
import type { CanvasSnapshot } from "../../../shared/geometry"
import { CanvasManager } from "./canvasManager"

const SNAPSHOT: CanvasSnapshot = {
  canvas: { x: 10, y: 20, w: 800, h: 400 },
  origin: { x: 0, y: 0 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("CanvasManager", () => {
  it("waits 250 ms between steady-state canvas reads", async () => {
    const delays: number[] = []
    const manager = new CanvasManager(() => Promise.resolve(SNAPSHOT), {
      schedule: (_callback, delay) => {
        delays.push(delay)
        return 0
      },
      cancel: () => {},
    })

    manager.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(delays).toEqual([250])
    manager.stop()
  })

  it("keeps the latest canvas available without another read", async () => {
    const first = deferred<CanvasSnapshot | null>()
    const reads = [first]
    const manager = new CanvasManager(() => reads.shift()?.promise ?? Promise.resolve(null), {
      schedule: () => 0,
      cancel: () => {},
    })

    manager.start()
    expect(manager.current()).toBeNull()
    first.resolve(SNAPSHOT)
    await first.promise
    await Promise.resolve()

    expect(manager.current()).toEqual(SNAPSHOT)
    manager.stop()
  })

  it("does not overlap reads when start is called while one is pending", () => {
    const first = deferred<CanvasSnapshot | null>()
    let calls = 0
    const manager = new CanvasManager(
      () => {
        calls += 1
        return first.promise
      },
      {
        schedule: () => 0,
        cancel: () => {},
      },
    )

    manager.start()
    manager.start()

    expect(calls).toBe(1)
    manager.stop()
  })

  it("reports async read duration and whether the read became current", async () => {
    const first = deferred<CanvasSnapshot | null>()
    const events: unknown[] = []
    const times = [10, 24]
    const manager = new CanvasManager(() => first.promise, {
      schedule: () => 0,
      cancel: () => {},
      now: () => times.shift() ?? 24,
      onRead: (event) => events.push(event),
    })

    manager.start()
    first.resolve(SNAPSHOT)
    await first.promise
    await Promise.resolve()

    expect(events).toEqual([
      {
        startedAtMs: 10,
        finishedAtMs: 24,
        snapshot: SNAPSHOT,
        accepted: true,
      },
    ])
    manager.stop()
  })
})
