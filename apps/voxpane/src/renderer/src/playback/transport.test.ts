import { afterEach, describe, expect, it } from "vitest"
import type {
  BridgeNote,
  BridgeSchedule,
  BridgeState,
  BridgeViewMapping,
} from "../../../shared/bridgeChannels"
import type { Viewport } from "../../../shared/geometry"
import { Transport } from "./transport"

const MAPPING: BridgeViewMapping = {
  perBlick: 2,
  perSemitone: 12,
  viewLeft: 0,
  viewRight: 100,
  viewTop: 0,
  viewBottom: -12,
}

const VIEWPORT: Viewport = {
  canvas: { x: 100, y: 50, w: 800, h: 400 },
  contentX: 120,
  contentW: 2000,
  refY: 60,
}

function note(onS: number, offS: number): BridgeNote {
  return {
    onB: onS * 1000,
    offB: offS * 1000,
    onS,
    offS,
    pitch: 60,
    lyric: "a",
    bend: new Int16Array(0),
  }
}

/**
 * Transport reads its input off the window globals once a frame, so a test
 * drives it by standing in for the channels and calling poll — which is exactly
 * what the frame loop does.
 */
function harness(options: { viewport?: Viewport | null } = {}) {
  let state: BridgeState | null = null
  let schedule: BridgeSchedule | null = null
  let seq = 0
  let viewport = options.viewport === undefined ? VIEWPORT : options.viewport

  const win = {
    bridge: {
      readState: () => state,
      readSchedule: () => schedule,
    },
  }
  ;(globalThis as { window?: unknown }).window = win

  const transport = new Transport()
  return {
    transport,

    /** Publish a state record and read it, the way one frame would. */
    tick(fields: Partial<BridgeState> = {}, nowMs = 0) {
      seq += 1
      state = {
        seq,
        notesSeq: schedule === null ? 0 : 1,
        at: 0,
        status: "playing",
        loop: null,
        px: MAPPING,
        rev: "r",
        ...fields,
      }
      transport.poll(nowMs, viewport)
    },

    /** Poll again without the script having ticked. */
    idle(nowMs: number) {
      transport.poll(nowMs, viewport)
    },

    setViewport(next: Viewport | null) {
      viewport = next
    },

    publish(notes: BridgeNote[]) {
      schedule = { rev: "r", notes }
    },

    /** A schedule that cannot be decoded — a record caught mid-replacement. */
    tearSchedule() {
      schedule = null
    },

    vanish() {
      state = null
    },
  }
}

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = undefined
})

describe("Transport.playhead", () => {
  it("is null before the first read", () => {
    const { transport } = harness()
    expect(transport.playhead(1000)).toBeNull()
    expect(transport.playing).toBe(false)
  })

  it("holds the playhead while stopped", () => {
    const { transport, tick } = harness()
    tick({ status: "stopped", at: 4 }, 1000)
    expect(transport.playhead(9999)).toBe(4)
    expect(transport.playing).toBe(false)
  })

  it("runs linearly off the local clock between reads", () => {
    const { transport, tick } = harness()
    tick({ at: 2 }, 1000)
    expect(transport.playhead(1000)).toBeCloseTo(2)
    expect(transport.playhead(1500)).toBeCloseTo(2.5)
    expect(transport.playhead(3000)).toBeCloseTo(4)
    expect(transport.playing).toBe(true)
  })

  it("wraps locally inside a known loop", () => {
    const { transport, tick } = harness()
    tick({ at: 8, status: "looping", loop: { start: 8, end: 10 } }, 0)
    expect(transport.playhead(1000)).toBeCloseTo(9)
    expect(transport.playhead(2500)).toBeCloseTo(8.5)
    expect(transport.playhead(4000)).toBeCloseTo(8)
  })

  it("ignores loop bounds that are empty or inverted", () => {
    const { transport, tick } = harness()
    tick({ at: 0, status: "looping", loop: { start: 5, end: 5 } }, 0)
    expect(transport.playhead(10_000)).toBeCloseTo(10)
    tick({ at: 0, status: "looping", loop: { start: 9, end: 3 } }, 0)
    expect(transport.playhead(10_000)).toBeCloseTo(10)
  })

  it("re-anchors on every fresh record", () => {
    const { transport, tick } = harness()
    tick({ at: 0 }, 0)
    tick({ at: 30 }, 2000)
    expect(transport.playhead(2500)).toBeCloseTo(30.5)
  })

  it("keeps extrapolating while the script has not ticked yet", () => {
    const { transport, tick, idle } = harness()
    tick({ at: 2 }, 1000)
    idle(1200)
    expect(transport.playhead(1200)).toBeCloseTo(2.2)
  })

  it("stops extrapolating once the script has gone quiet", () => {
    const { transport, tick, idle } = harness()
    tick({ at: 2 }, 1000)
    idle(1600)
    expect(transport.playhead(1600)).toBeNull()
    expect(transport.playing).toBe(false)
    expect(transport.view).toBeNull()
  })

  it("keeps extrapolating through a transient state miss", () => {
    const { transport, tick, idle, vanish } = harness()
    tick({ at: 2 }, 1000)
    vanish()
    idle(1016)
    expect(transport.playhead(1016)).toBeCloseTo(2.016)
    expect(transport.playing).toBe(true)
    expect(transport.view).not.toBeNull()
  })

  it("stops extrapolating when the state channel stays missing", () => {
    const { transport, tick, idle, vanish } = harness()
    tick({ at: 2 }, 1000)
    vanish()
    idle(1601)
    expect(transport.playhead(1601)).toBeNull()
    expect(transport.playing).toBe(false)
    expect(transport.view).toBeNull()
  })

  it("picks up again after the script comes back", () => {
    const { transport, tick, idle } = harness()
    tick({ at: 2 }, 1000)
    idle(2000)
    tick({ at: 7 }, 2100)
    expect(transport.playhead(2100)).toBeCloseTo(7)
    expect(transport.playing).toBe(true)
  })
})

describe("Transport.noteAt", () => {
  const schedule = [note(0, 1), note(1, 2), note(4, 5), note(10, 10.25)]

  it("finds the note under the playhead", () => {
    const { transport, tick, publish } = harness()
    publish(schedule)
    tick()
    expect(transport.noteAt(0)).toBe(schedule[0])
    expect(transport.noteAt(1.5)).toBe(schedule[1])
    expect(transport.noteAt(4.999)).toBe(schedule[2])
    expect(transport.noteAt(10.2)).toBe(schedule[3])
  })

  it("returns null in a gap, before the first note and after the last", () => {
    const { transport, tick, publish } = harness()
    publish(schedule)
    tick()
    expect(transport.noteAt(-1)).toBeNull()
    expect(transport.noteAt(3)).toBeNull()
    expect(transport.noteAt(5)).toBeNull()
    expect(transport.noteAt(99)).toBeNull()
  })

  it("returns null with no schedule", () => {
    const { transport, tick } = harness()
    tick()
    expect(transport.noteAt(0)).toBeNull()
  })

  it("reads the schedule once and keeps it while its generation stands", () => {
    const { transport, tick, publish, tearSchedule } = harness()
    publish(schedule)
    tick()
    // The channel would fail to decode now, but nothing asks it to: the state
    // record still names the generation already held.
    tearSchedule()
    tick({ notesSeq: 1 })
    expect(transport.noteAt(1.5)).toBe(schedule[1])
  })

  it("replaces the schedule wholesale when its generation moves", () => {
    const { transport, tick, publish } = harness()
    publish(schedule)
    tick()
    publish([note(20, 21)])
    tick({ notesSeq: 2 })
    expect(transport.noteAt(1.5)).toBeNull()
    expect(transport.noteAt(20.5)).not.toBeNull()
  })

  it("tries again next frame when the schedule cannot be read", () => {
    const { transport, tick, publish, tearSchedule } = harness()
    tearSchedule()
    tick({ notesSeq: 1 })
    expect(transport.noteAt(0.5)).toBeNull()
    publish(schedule)
    tick({ notesSeq: 1 })
    expect(transport.noteAt(0.5)).toBe(schedule[0])
  })
})

describe("Transport.view", () => {
  it("builds the view from the newest state and the viewport canvas", () => {
    const { transport, tick } = harness()
    tick()
    expect(transport.view).toEqual({
      mapping: MAPPING,
      contentX: VIEWPORT.canvas.x,
      contentW: 2_000_000_000,
      canvasX: VIEWPORT.canvas.x,
    })
  })

  it("recomputes the viewport from the newest state instead of waiting for async scroll", () => {
    const { transport, tick } = harness({
      viewport: {
        ...VIEWPORT,
        contentX: -999,
        contentW: 123,
        refY: -50,
        source: {
          seq: 0,
          mapping: {
            ...MAPPING,
            perBlick: 1,
            viewLeft: -300,
            viewRight: -200,
          },
        },
      },
    })
    tick({
      px: {
        ...MAPPING,
        viewLeft: 20,
        viewRight: 120,
        viewTop: 10,
        viewBottom: -2,
      },
    })
    expect(transport.viewport).toMatchObject({
      canvas: VIEWPORT.canvas,
      contentX: 60,
      contentW: 2_000_000_000,
      refY: 170,
      source: {
        mapping: {
          ...MAPPING,
          viewLeft: 20,
          viewRight: 120,
          viewTop: 10,
          viewBottom: -2,
        },
      },
    })
    expect(transport.view).toEqual({
      mapping: {
        ...MAPPING,
        viewLeft: 20,
        viewRight: 120,
        viewTop: 10,
        viewBottom: -2,
      },
      contentX: 60,
      contentW: 2_000_000_000,
      canvasX: VIEWPORT.canvas.x,
    })
  })

  it("refreshes the view when the viewport snapshot catches up before the next state tick", () => {
    const staleMapping: BridgeViewMapping = {
      ...MAPPING,
      perBlick: 1,
      viewLeft: -100,
      viewRight: 0,
    }
    const caughtUp = {
      ...VIEWPORT,
      canvas: { ...VIEWPORT.canvas, x: 140 },
      contentX: 300,
      source: { seq: 1, mapping: MAPPING },
    } as Viewport
    const { transport, tick, idle, setViewport } = harness({
      viewport: {
        ...VIEWPORT,
        contentX: 50,
        source: { seq: 0, mapping: staleMapping },
      } as Viewport,
    })
    tick({ px: MAPPING }, 1000)
    setViewport(caughtUp)
    idle(1016)
    expect(transport.view).toEqual({
      mapping: MAPPING,
      contentX: 140,
      contentW: 2_000_000_000,
      canvasX: 140,
    })
  })

  it("is null when the viewport cannot be read", () => {
    const { transport, tick } = harness({ viewport: null })
    tick()
    expect(transport.view).toBeNull()
  })
})

describe("notesBetween", () => {
  function scheduled() {
    const h = harness()
    // onB is onS * 1000, so these sit at 0-1000, 1000-2000 and 4000-5000 blicks.
    h.publish([note(0, 1), note(1, 2), note(4, 5)])
    h.tick()
    return h.transport
  }

  it("takes every note overlapping the range, not only those starting in it", () => {
    expect(scheduled().notesBetween(500, 1500)).toHaveLength(2)
  })

  it("is inclusive at both edges", () => {
    expect(scheduled().notesBetween(1000, 1000)).toHaveLength(2)
  })

  it("is empty for a range with nothing in it", () => {
    expect(scheduled().notesBetween(2500, 3500)).toEqual([])
  })

  it("finds the note before one it holds, and nothing before the first", () => {
    const transport = scheduled()
    const notes = transport.notesBetween(0, 5000)
    expect(transport.before(notes[2])?.onS).toBe(1)
    expect(transport.before(notes[0])).toBeNull()
  })
})

describe("neighbours", () => {
  function scheduled() {
    const h = harness()
    h.publish([note(0, 1), note(2, 3)])
    h.tick()
    return h.transport
  }

  it("names the note just ended and the one still to come, in a gap", () => {
    const pair = scheduled().neighbours(1.5)
    expect(pair.before?.offS).toBe(1)
    expect(pair.after?.onS).toBe(2)
  })

  it("names the sounding note as the one before, not the next", () => {
    const pair = scheduled().neighbours(0.5)
    expect(pair.before?.onS).toBe(0)
    expect(pair.after?.onS).toBe(2)
  })

  it("has nothing before the first note, and nothing after the last", () => {
    expect(scheduled().neighbours(-1).before).toBeNull()
    expect(scheduled().neighbours(99).after).toBeNull()
  })
})
