import { describe, expect, it } from "vitest"
import type { Viewport } from "../../../shared/geometry"
import { ViewportManager } from "./viewportManager"

const VP: Viewport = {
  canvas: { x: 10, y: 20, w: 800, h: 400 },
  contentX: 100,
  contentW: 2000,
  refY: 50,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("ViewportManager", () => {
  it("keeps the latest viewport available without another read", async () => {
    const first = deferred<Viewport | null>()
    const reads = [first]
    const manager = new ViewportManager(() => reads.shift()?.promise ?? Promise.resolve(null), {
      schedule: () => 0,
      cancel: () => {},
    })

    manager.start()
    expect(manager.current()).toBeNull()
    first.resolve(VP)
    await first.promise
    await Promise.resolve()

    expect(manager.current()).toEqual(VP)
    manager.stop()
  })

  it("does not overlap reads when start is called while one is pending", () => {
    const first = deferred<Viewport | null>()
    let calls = 0
    const manager = new ViewportManager(
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

  it("keeps an adopted viewport ahead of an older async result", async () => {
    const old = deferred<Viewport | null>()
    const adopted: Viewport = { ...VP, contentX: 240, refY: 80 }
    const manager = new ViewportManager(() => old.promise, {
      schedule: () => 0,
      cancel: () => {},
    })

    manager.start()
    manager.adopt(adopted)
    old.resolve(VP)
    await old.promise
    await Promise.resolve()

    expect(manager.current()).toEqual(adopted)
    manager.stop()
  })

  it("reports async read duration and whether the read became current", async () => {
    const first = deferred<Viewport | null>()
    const events: unknown[] = []
    const times = [10, 24]
    const manager = new ViewportManager(() => first.promise, {
      schedule: () => 0,
      cancel: () => {},
      now: () => times.shift() ?? 24,
      onRead: (event) => events.push(event),
    })

    manager.start()
    first.resolve(VP)
    await first.promise
    await Promise.resolve()

    expect(events).toEqual([
      {
        startedAtMs: 10,
        finishedAtMs: 24,
        viewport: VP,
        accepted: true,
      },
    ])
    manager.stop()
  })
})
