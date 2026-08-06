import { describe, expect, it } from "vitest"
import type { PianoRoll } from "../../../shared/geometry"
import { settleNoteRead } from "./noteReadPump"

const READ: PianoRoll = {
  canvas: { x: 0, y: 0, w: 100, h: 50 },
  contentX: 0,
  contentW: 1000,
  refY: 20,
  xStable: true,
  yStable: true,
  notes: [{ x: 10, y: 10, w: 20, h: 10 }],
}

describe("settleNoteRead", () => {
  it("keeps the previous read when one poll misses transiently", () => {
    expect(settleNoteRead(READ, null).read).toBe(READ)
  })
})
