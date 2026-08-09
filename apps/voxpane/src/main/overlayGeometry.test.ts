import { describe, expect, it } from "vitest"
import type { PianoRoll, Rect } from "../shared/geometry"
import type { DipTransform } from "../shared/native"
import { createOverlayCanvasReader, registerOverlayGeometryIpc } from "./overlayGeometry"

class Ipc {
  handlers = new Map<string, () => unknown>()

  handle(channel: string, handler: () => unknown): void {
    this.handlers.set(channel, handler)
  }
}

const SCALE_2X: DipTransform = {
  scale: 2,
  originPx: { x: 1000, y: 200 },
  originDip: { x: 500, y: 100 },
}

function pianoRoll(canvas: Rect): PianoRoll {
  return {
    canvas,
    contentX: canvas.x,
    contentW: canvas.w,
    refY: canvas.y,
    xStable: true,
    yStable: true,
    notes: [],
  }
}

describe("createOverlayCanvasReader", () => {
  it("seeds through the main process helper and converts the canvas to DIPs", async () => {
    const calls: string[] = []
    const canvas = { x: 1200, y: 500, w: 800, h: 400 }
    const reader = createOverlayCanvasReader(
      {
        getCanvasAsync: async () => {
          calls.push("canvas")
          return calls.length === 1 ? null : canvas
        },
        getPianoRollAsync: async (target) => {
          calls.push(`seed:${target}`)
          return pianoRoll(canvas)
        },
      },
      "synth",
      () => SCALE_2X,
    )

    await expect(reader()).resolves.toEqual({
      canvas: { x: 600, y: 250, w: 400, h: 200 },
      origin: { x: 0, y: 0 },
    })
    expect(calls).toEqual(["canvas", "seed:synth", "canvas"])
  })

  it("registers overlay canvas reads on IPC", async () => {
    const ipc = new Ipc()
    registerOverlayGeometryIpc(
      ipc,
      {
        getCanvasAsync: async () => ({ x: 1, y: 2, w: 3, h: 4 }),
      },
      "synth",
    )

    await expect(ipc.handlers.get("overlay:getCanvas")?.()).resolves.toEqual({
      canvas: { x: 1, y: 2, w: 3, h: 4 },
      origin: { x: 0, y: 0 },
    })
  })

  it("returns the seed canvas when the cached local read is not ready yet", async () => {
    const canvas = { x: 1200, y: 500, w: 800, h: 400 }
    const reader = createOverlayCanvasReader(
      {
        getCanvasAsync: async () => null,
        getPianoRollAsync: async () => pianoRoll(canvas),
      },
      "synth",
      () => SCALE_2X,
    )

    await expect(reader()).resolves.toEqual({
      canvas: { x: 600, y: 250, w: 400, h: 200 },
    })
  })
})
