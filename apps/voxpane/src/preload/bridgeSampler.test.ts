import { describe, expect, it } from "vitest"
import { STATE_BYTES } from "../shared/bridgeChannels"
import { BridgeSampler } from "./bridgeSampler"

const MAGIC = 0x31425056

class Writer {
  private readonly bytes: number[] = []

  u8(value: number): this {
    this.bytes.push(value & 0xff)
    return this
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8)
  }

  u32(value: number): this {
    return this.u16(value).u16(value >>> 16)
  }

  f64(value: number): this {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, true)
    for (let index = 0; index < 8; index += 1) {
      this.u8(view.getUint8(index))
    }
    return this
  }

  text(value: string): this {
    const encoded = new TextEncoder().encode(value)
    this.u16(encoded.length)
    for (const byte of encoded) {
      this.u8(byte)
    }
    return this
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function record(channel: number, body: Uint8Array, padded = false): Uint8Array {
  const head = new Writer().u32(MAGIC).u16(3).u16(channel).u32(body.length).done()
  const size = padded ? STATE_BYTES : head.length + body.length
  const out = new Uint8Array(size)
  out.set(head)
  out.set(body, head.length)
  out.fill(0x20, head.length + body.length)
  return out
}

function state(notesSeq: number, rev: string, seq = 1): Uint8Array {
  const body = new Writer()
    .u32(seq)
    .u32(notesSeq)
    .u8(1)
    .u8(0)
    .f64(0)
    .f64(0)
    .f64(0)
    .f64(1)
    .f64(12)
    .f64(0)
    .f64(100)
    .f64(80)
    .f64(40)
    .text(rev)
    .done()
  return record(1, body, true)
}

function notes(rev: string): Uint8Array {
  return record(2, new Writer().text(rev).u32(0).done())
}

function harness(states: Array<Uint8Array | null>, schedules: Array<Uint8Array | null> = []) {
  const publishedStates: Uint8Array[] = []
  const publishedSchedules: Array<{ notesSeq: number; bytes: Uint8Array }> = []
  let scheduleReads = 0
  const sampler = new BridgeSampler({
    readState: () => states.shift() ?? null,
    readSchedule: () => {
      scheduleReads += 1
      return schedules.shift() ?? null
    },
    publishState: (bytes) => publishedStates.push(Uint8Array.from(bytes)),
    publishSchedule: (notesSeq, bytes) =>
      publishedSchedules.push({ notesSeq, bytes: Uint8Array.from(bytes) }),
  })
  return { sampler, publishedStates, publishedSchedules, scheduleReads: () => scheduleReads }
}

describe("BridgeSampler", () => {
  it("publishes only valid state records", () => {
    const valid = state(0, "r")
    const { sampler, publishedStates } = harness([new Uint8Array(STATE_BYTES), valid])

    sampler.sample()
    sampler.sample()

    expect(publishedStates).toEqual([valid])
  })

  it("does not read notes before a schedule generation exists", () => {
    const { sampler, scheduleReads } = harness([state(0, "")])

    sampler.sample()

    expect(scheduleReads()).toBe(0)
  })

  it("reads and publishes one schedule per accepted generation", () => {
    const schedule = notes("r1")
    const { sampler, publishedSchedules, scheduleReads } = harness(
      [state(1, "r1", 1), state(1, "r1", 2)],
      [schedule],
    )

    sampler.sample()
    sampler.sample()

    expect(scheduleReads()).toBe(1)
    expect(publishedSchedules).toEqual([{ notesSeq: 1, bytes: schedule }])
  })

  it("retries a torn schedule without accepting its generation", () => {
    const schedule = notes("r1")
    const { sampler, publishedSchedules, scheduleReads } = harness(
      [state(1, "r1", 1), state(1, "r1", 2)],
      [new Uint8Array(4), schedule],
    )

    sampler.sample()
    sampler.sample()

    expect(scheduleReads()).toBe(2)
    expect(publishedSchedules).toEqual([{ notesSeq: 1, bytes: schedule }])
  })

  it("rejects a schedule whose revision does not match state", () => {
    const matching = notes("new")
    const { sampler, publishedSchedules } = harness(
      [state(2, "new", 1), state(2, "new", 2)],
      [notes("old"), matching],
    )

    sampler.sample()
    sampler.sample()

    expect(publishedSchedules).toEqual([{ notesSeq: 2, bytes: matching }])
  })
})
