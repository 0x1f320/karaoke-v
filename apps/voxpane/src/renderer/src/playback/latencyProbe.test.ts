import { describe, expect, it } from "vitest"
import type { Viewport } from "../../../shared/geometry"
import { ScrollLatencyProbe } from "./latencyProbe"

const VIEWPORT: Viewport = {
  canvas: { x: 10, y: 20, w: 800, h: 400 },
  contentX: 100,
  contentW: 2000,
  refY: 50,
  source: {
    seq: 1,
    mapping: {
      perBlick: 2,
      perSemitone: 12,
      viewLeft: 0,
      viewRight: 100,
      viewTop: 0,
      viewBottom: -12,
    },
  },
}

function shifted(viewport: Viewport, shift: number, seq: number): Viewport {
  return {
    ...viewport,
    contentX: viewport.contentX - shift,
    source: viewport.source
      ? {
          ...viewport.source,
          seq,
          mapping: {
            ...viewport.source.mapping,
            viewLeft: viewport.source.mapping.viewLeft + shift,
            viewRight: viewport.source.mapping.viewRight + shift,
          },
        }
      : undefined,
  }
}

describe("ScrollLatencyProbe", () => {
  it("reports bridge delay when native movement is visible first", () => {
    const reports: string[] = []
    const probe = new ScrollLatencyProbe({ log: (line) => reports.push(line) })

    probe.sample({
      atMs: 0,
      frame: 1,
      native: VIEWPORT,
      applied: VIEWPORT,
      drawStartedAtMs: 0,
      drawEndedAtMs: 1,
    })
    probe.sample({
      atMs: 16,
      frame: 2,
      native: { ...VIEWPORT, canvas: { ...VIEWPORT.canvas, x: 12 } },
      applied: VIEWPORT,
      drawStartedAtMs: 16,
      drawEndedAtMs: 17,
    })
    probe.sample({
      atMs: 32,
      frame: 3,
      native: { ...VIEWPORT, canvas: { ...VIEWPORT.canvas, x: 12 } },
      applied: shifted(VIEWPORT, 10, 2),
      drawStartedAtMs: 32,
      drawEndedAtMs: 34,
    })
    probe.sample({
      atMs: 220,
      frame: 4,
      native: { ...VIEWPORT, canvas: { ...VIEWPORT.canvas, x: 12 } },
      applied: shifted(VIEWPORT, 10, 2),
      drawStartedAtMs: 220,
      drawEndedAtMs: 221,
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("bottleneck=bridge")
    expect(reports[0]).toContain("native->applied=16.0ms")
    expect(reports[0]).toContain("applied->draw=2.0ms")
  })

  it("reports renderer delay when applied movement waits before drawing", () => {
    const reports: string[] = []
    const probe = new ScrollLatencyProbe({ log: (line) => reports.push(line) })

    probe.sample({
      atMs: 0,
      frame: 1,
      native: VIEWPORT,
      applied: VIEWPORT,
      drawStartedAtMs: 0,
      drawEndedAtMs: 1,
    })
    probe.sample({
      atMs: 16,
      frame: 2,
      native: shifted(VIEWPORT, 10, 2),
      applied: shifted(VIEWPORT, 10, 2),
      drawStartedAtMs: 16,
      drawEndedAtMs: 29,
    })
    probe.sample({
      atMs: 200,
      frame: 3,
      native: shifted(VIEWPORT, 10, 2),
      applied: shifted(VIEWPORT, 10, 2),
      drawStartedAtMs: 200,
      drawEndedAtMs: 201,
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("bottleneck=renderer")
    expect(reports[0]).toContain("applied->draw=13.0ms")
  })
})
