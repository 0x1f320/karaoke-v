import { describe, expect, it } from "vitest"
import type { BridgeSchedule } from "../shared/bridgeChannels"
import { ScheduleCache } from "./scheduleCache"

function schedule(rev: string): BridgeSchedule {
  return { rev, notes: [] }
}

describe("ScheduleCache", () => {
  it("reads a schedule once for the same notes generation", () => {
    const loaded = schedule("a")
    let reads = 0
    const cache = new ScheduleCache(() => {
      reads += 1
      return loaded
    })

    expect(cache.read(1)).toBe(loaded)
    expect(cache.read(1)).toBe(loaded)
    expect(reads).toBe(1)
  })

  it("replaces the schedule when the notes generation changes", () => {
    const first = schedule("a")
    const second = schedule("b")
    const schedules = [first, second]
    const cache = new ScheduleCache(() => schedules.shift() ?? null)

    expect(cache.read(1)).toBe(first)
    expect(cache.read(2)).toBe(second)
    expect(cache.latest).toBe(second)
  })

  it("retries a failed new-generation read without losing the last successful schedule", () => {
    const first = schedule("a")
    const second = schedule("b")
    const schedules: Array<BridgeSchedule | null> = [first, null, second]
    const cache = new ScheduleCache(() => schedules.shift() ?? null)

    expect(cache.read(1)).toBe(first)
    expect(cache.read(2)).toBeNull()
    expect(cache.latest).toBe(first)
    expect(cache.read(2)).toBe(second)
    expect(cache.latest).toBe(second)
  })
})
