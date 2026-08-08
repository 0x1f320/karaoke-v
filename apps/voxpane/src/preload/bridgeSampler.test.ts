import { describe, expect, it } from "vitest"
import type { BridgeRecordRead } from "../shared/bridgeDiagnostics"
import { BridgeSampler } from "./bridgeSampler"

const MAGIC = 0x31425056
const STATE_RECORD_BYTES = 256
const SCROLL_RECORD_BYTES = 64

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
  const head = new Writer().u32(MAGIC).u16(5).u16(channel).u32(body.length).done()
  const size = padded
    ? channel === 1
      ? STATE_RECORD_BYTES
      : SCROLL_RECORD_BYTES
    : head.length + body.length
  const out = new Uint8Array(size)
  out.set(head)
  out.set(body, head.length)
  out.fill(0x20, head.length + body.length)
  return out
}

function state(notesSeq: number, rev: string, seq = 1, scrollSeq = 1): Uint8Array {
  const body = new Writer()
    .u32(seq)
    .u32(notesSeq)
    .u32(scrollSeq)
    .u8(1)
    .u8(0)
    .f64(0)
    .f64(0)
    .f64(0)
    .text(rev)
    .done()
  return record(1, body, true)
}

function scroll(scrollSeq: number): Uint8Array {
  return record(
    3,
    new Writer().u32(scrollSeq).f64(1).f64(12).f64(0).f64(100).f64(80).f64(40).done(),
    true,
  )
}

function notes(rev: string, notesSeq = 0): Uint8Array {
  return record(2, new Writer().u32(notesSeq).text(rev).u32(0).done())
}

function readable(bytes: Uint8Array | null | undefined): BridgeRecordRead | null {
  return bytes ? { bytes, diagnostics: null } : null
}

function harness(
  states: Array<Uint8Array | null>,
  schedules: Array<Uint8Array | null> = [],
  scrolls: Array<Uint8Array | null> = [scroll(1)],
) {
  const publishedStates: Uint8Array[] = []
  const publishedScrolls: Array<{ scrollSeq: number; bytes: Uint8Array }> = []
  const publishedSchedules: Array<{ notesSeq: number; bytes: Uint8Array }> = []
  const diagnostics: unknown[] = []
  const publishOrder: string[] = []
  let scrollReads = 0
  let scheduleReads = 0
  let now = 0
  const sampler = new BridgeSampler({
    now: () => now++,
    readState: () => readable(states.shift()),
    readScroll: () => {
      scrollReads += 1
      return readable(scrolls.shift())
    },
    readSchedule: () => {
      scheduleReads += 1
      return readable(schedules.shift())
    },
    publishState: (record) => {
      publishOrder.push("state")
      publishedStates.push(Uint8Array.from(record.bytes))
    },
    publishScroll: (scrollSeq, record) => {
      publishOrder.push(`scroll:${scrollSeq}`)
      publishedScrolls.push({ scrollSeq, bytes: Uint8Array.from(record.bytes) })
    },
    publishSchedule: (notesSeq, record) =>
      publishedSchedules.push({ notesSeq, bytes: Uint8Array.from(record.bytes) }),
    publishDiagnostics: (event) => diagnostics.push(event),
  })
  return {
    sampler,
    publishedStates,
    publishedScrolls,
    publishedSchedules,
    publishOrder,
    diagnostics,
    scrollReads: () => scrollReads,
    scheduleReads: () => scheduleReads,
  }
}

describe("BridgeSampler", () => {
  it("publishes only valid state records", () => {
    const valid = state(0, "r")
    const { sampler, publishedStates } = harness([new Uint8Array(STATE_RECORD_BYTES), valid])

    sampler.sample()
    sampler.sample()

    expect(publishedStates).toEqual([valid])
  })

  it("reads scroll only when its advertised generation changes", () => {
    const first = scroll(1)
    const second = scroll(2)
    const { sampler, publishedScrolls, scrollReads } = harness(
      [state(0, "r", 1, 1), state(0, "r", 2, 1), state(0, "r", 3, 2)],
      [],
      [first, second],
    )

    sampler.sample()
    sampler.sample()
    sampler.sample()

    expect(scrollReads()).toBe(2)
    expect(publishedScrolls).toEqual([
      { scrollSeq: 1, bytes: first },
      { scrollSeq: 2, bytes: second },
    ])
  })

  it("publishes a matching scroll before its state", () => {
    const { sampler, publishOrder } = harness([state(0, "r")])

    sampler.sample()

    expect(publishOrder).toEqual(["scroll:1", "state"])
  })

  it("retries a mismatched scroll without publishing the dependent state", () => {
    const matching = scroll(1)
    const { sampler, publishedStates, publishedScrolls, scrollReads } = harness(
      [state(0, "r", 1), state(0, "r", 2)],
      [],
      [scroll(2), matching],
    )

    sampler.sample()
    sampler.sample()

    expect(scrollReads()).toBe(2)
    expect(publishedStates).toEqual([state(0, "r", 2)])
    expect(publishedScrolls).toEqual([{ scrollSeq: 1, bytes: matching }])
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

  it("reports debug failure counters and recent read costs", () => {
    const { sampler, diagnostics } = harness(
      [
        null,
        new Uint8Array(STATE_RECORD_BYTES),
        state(0, "", 1, 1),
        state(0, "", 2, 1),
        state(0, "", 3, 2),
        state(1, "r1", 4, 1),
        state(2, "new", 5, 1),
      ],
      [new Uint8Array(4), notes("old")],
      [null, new Uint8Array(4), scroll(1), scroll(1)],
    )

    for (let sample = 0; sample < 7; sample += 1) {
      sampler.sample(true)
    }

    expect(diagnostics.at(-1)).toEqual({
      counters: {
        stateMissing: 1,
        stateInvalid: 1,
        scrollMissing: 1,
        scrollInvalid: 1,
        scrollSeqMismatch: 1,
        notesMissing: 0,
        notesInvalid: 1,
        revMismatch: 1,
      },
      costs: {
        stateReadMs: 1,
        scrollReadMs: null,
        notesReadMs: 1,
      },
    })
  })
})
