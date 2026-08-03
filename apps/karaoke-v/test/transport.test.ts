import { afterEach, describe, expect, it } from "vitest"
import { Transport } from "../src/renderer/src/playback/transport"
import type {
  BridgeMessage,
  BridgeNote,
  BridgePayload,
  BridgeStatus,
  BridgeViewMapping,
} from "../src/shared/bridge"
import type { Viewport } from "../src/shared/geometry"

const MAPPING: BridgeViewMapping = { perBlick: 2, perSemitone: 12, viewLeft: 0, viewTop: 0 }

const VIEWPORT: Viewport = {
  canvas: { x: 100, y: 50, w: 800, h: 400 },
  contentX: 120,
  contentW: 2000,
  refY: 60,
}

function note(onS: number, offS: number): BridgeNote {
  return { onB: onS * 1000, offB: offS * 1000, onS, offS, pitch: 60, lyric: "a" }
}

function message(payload: Partial<BridgePayload>, monotonicMs = 0): BridgeMessage {
  return {
    payload: {
      v: 1,
      kind: "start",
      at: 0,
      status: "playing" as BridgeStatus,
      px: null,
      loop: null,
      rev: "r",
      ...payload,
    },
    monotonicMs,
  }
}

/**
 * Transport reads its input off the window globals, so a test drives it by
 * standing in for them and pushing payloads through the subscription.
 */
function harness(options: { viewport?: Viewport | null; last?: BridgeMessage | null } = {}) {
  let listener: ((message: BridgeMessage) => void) | null = null
  const win = {
    bridge: {
      onPayload(fn: (message: BridgeMessage) => void) {
        listener = fn
        return () => {
          listener = null
        }
      },
      last: async () => options.last ?? null,
    },
    overlay: {
      getViewport: () => (options.viewport === undefined ? VIEWPORT : options.viewport),
    },
  }
  ;(globalThis as { window?: unknown }).window = win

  const transport = new Transport()
  transport.start()
  return {
    transport,
    push: (payload: Partial<BridgePayload>, monotonicMs = 0) =>
      listener?.(message(payload, monotonicMs)),
    get subscribed() {
      return listener !== null
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = undefined
})

describe("Transport.playhead", () => {
  it("is null before the first anchor", () => {
    const { transport } = harness()
    expect(transport.playhead(1000)).toBeNull()
    expect(transport.playing).toBe(false)
  })

  it("holds the anchor while stopped", () => {
    const { transport, push } = harness()
    push({ kind: "stop", status: "stopped", at: 4 }, 1000)
    expect(transport.playhead(9999)).toBe(4)
    expect(transport.playing).toBe(false)
  })

  it("runs linearly off the local clock while playing", () => {
    const { transport, push } = harness()
    push({ at: 2, status: "playing" }, 1000)
    expect(transport.playhead(1000)).toBeCloseTo(2)
    expect(transport.playhead(1500)).toBeCloseTo(2.5)
    expect(transport.playhead(4000)).toBeCloseTo(5)
    expect(transport.playing).toBe(true)
  })

  it("wraps locally inside a known loop", () => {
    const { transport, push } = harness()
    push({ at: 8, status: "looping", loop: { start: 8, end: 10 } }, 0)
    expect(transport.playhead(1000)).toBeCloseTo(9)
    expect(transport.playhead(2500)).toBeCloseTo(8.5)
    expect(transport.playhead(4000)).toBeCloseTo(8)
  })

  it("ignores loop bounds that are empty or inverted", () => {
    const { transport, push } = harness()
    push({ at: 0, status: "looping", loop: { start: 5, end: 5 } }, 0)
    expect(transport.playhead(10_000)).toBeCloseTo(10)
    push({ at: 0, status: "looping", loop: { start: 9, end: 3 } }, 0)
    expect(transport.playhead(10_000)).toBeCloseTo(10)
  })

  it("re-anchors on every payload", () => {
    const { transport, push } = harness()
    push({ at: 0 }, 0)
    push({ kind: "anchor", at: 30 }, 2000)
    expect(transport.playhead(2500)).toBeCloseTo(30.5)
  })
})

describe("Transport.noteAt", () => {
  const schedule = [note(0, 1), note(1, 2), note(4, 5), note(10, 10.25)]

  it("finds the note under the playhead", () => {
    const { transport, push } = harness()
    push({ notes: schedule })
    expect(transport.noteAt(0)).toBe(schedule[0])
    expect(transport.noteAt(1.5)).toBe(schedule[1])
    expect(transport.noteAt(4.999)).toBe(schedule[2])
    expect(transport.noteAt(10.2)).toBe(schedule[3])
  })

  it("returns null in a gap, before the first note and after the last", () => {
    const { transport, push } = harness()
    push({ notes: schedule })
    expect(transport.noteAt(-1)).toBeNull()
    expect(transport.noteAt(3)).toBeNull()
    expect(transport.noteAt(5)).toBeNull()
    expect(transport.noteAt(99)).toBeNull()
  })

  it("returns null with no schedule", () => {
    const { transport } = harness()
    expect(transport.noteAt(0)).toBeNull()
  })

  it("keeps the schedule across payloads that carry no notes", () => {
    const { transport, push } = harness()
    push({ notes: schedule })
    push({ kind: "anchor", at: 1.5 })
    expect(transport.noteAt(1.5)).toBe(schedule[1])
  })

  it("replaces the schedule wholesale on an edit", () => {
    const { transport, push } = harness()
    push({ notes: schedule })
    push({ kind: "edit", notes: [note(20, 21)] })
    expect(transport.noteAt(1.5)).toBeNull()
    expect(transport.noteAt(20.5)).not.toBeNull()
  })
})

describe("Transport.view", () => {
  it("pairs the mapping with the viewport of the live payload", () => {
    const { transport, push } = harness()
    push({ px: MAPPING })
    expect(transport.view).toEqual({
      mapping: MAPPING,
      contentX: VIEWPORT.contentX,
      contentW: VIEWPORT.contentW,
      canvasX: VIEWPORT.canvas.x,
    })
  })

  it("is null when the payload carries no mapping", () => {
    const { transport, push } = harness()
    push({ px: null })
    expect(transport.view).toBeNull()
  })

  it("is null when the viewport cannot be read", () => {
    const { transport, push } = harness({ viewport: null })
    push({ px: MAPPING })
    expect(transport.view).toBeNull()
  })

  it("keeps no view from a replayed payload — its scroll is long gone", async () => {
    const { transport } = harness({ last: message({ px: MAPPING, at: 3 }, 500) })
    await flush()
    expect(transport.view).toBeNull()
    expect(transport.playhead(500)).toBeCloseTo(3)
  })

  it("does not let a replayed payload overwrite a live anchor", async () => {
    const { transport, push } = harness({ last: message({ at: 99 }, 0) })
    push({ at: 3 }, 0)
    await flush()
    expect(transport.playhead(0)).toBeCloseTo(3)
  })
})

describe("Transport.stop", () => {
  it("unsubscribes", () => {
    const h = harness()
    expect(h.subscribed).toBe(true)
    h.transport.stop()
    expect(h.subscribed).toBe(false)
  })
})
