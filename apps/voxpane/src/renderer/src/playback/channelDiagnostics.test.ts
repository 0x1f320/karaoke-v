import { describe, expect, it } from "vitest"
import type { BridgeDiagnostics } from "../../../shared/bridgeDiagnostics"
import type { Viewport } from "../../../shared/geometry"
import {
  BridgeDiagnosticsGraphHistory,
  BridgeDiagnosticsStats,
  BridgeScrollLatency,
  diagnosticsGraphPosition,
  diagnosticsGraphSample,
  diagnosticsGraphScale,
  diagnosticsLegendLayout,
  diagnosticsPanelPosition,
  diagnosticsYAxisLabels,
  formatBridgeDiagnostics,
} from "./channelDiagnostics"

const LABELS = {
  state: "state",
  notes: "notes",
  age: "age",
  size: "size",
  applied: "applied",
  average: "avg",
  current: "current",
  min: "min",
  read: "read",
  seq: "seq",
  notesSeq: "notesSeq",
  rev: "rev",
  failures: "fail",
  stateMissing: "stateMissing",
  stateInvalid: "stateInvalid",
  notesMissing: "notesMissing",
  notesInvalid: "notesInvalid",
  revMismatch: "revMismatch",
  stateApplied: "state applied",
  notesApplied: "notes applied",
  stateRead: "state read",
  notesRead: "notes read",
  scrollApplied: "scroll applied",
  max: "max",
  p95: "p95",
  p99: "p99",
  missing: "n/a",
}

const STATS_30 = {
  avg: 30,
  min: 10,
  max: 50,
  p95: 50,
  p99: 50,
}

const STATS_12_5 = {
  avg: 12.5,
  min: 5,
  max: 20,
  p95: 20,
  p99: 20,
}

const STATS_70 = {
  avg: 70,
  min: 70,
  max: 70,
  p95: 70,
  p99: 70,
}

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
      viewTop: 80,
      viewBottom: 40,
    },
  },
}

describe("formatBridgeDiagnostics", () => {
  it("reports file age, file size, and accepted-to-draw latency for each channel", () => {
    const diagnostics: BridgeDiagnostics = {
      state: {
        modifiedAtMs: 1_000,
        sizeBytes: 256,
        acceptedAtMs: 60,
      },
      notes: {
        modifiedAtMs: 1_800,
        sizeBytes: 4_096,
        acceptedAtMs: 90,
      },
      stateRecord: {
        seq: 12,
        notesSeq: 7,
        rev: "abcdef123456",
      },
      notesRecord: {
        notesSeq: 7,
        rev: "abcdef123456",
      },
      counters: {
        stateMissing: 1,
        stateInvalid: 2,
        notesMissing: 3,
        notesInvalid: 4,
        revMismatch: 5,
      },
      costs: {
        stateReadMs: 0.75,
        notesReadMs: 8.25,
      },
    }

    expect(
      formatBridgeDiagnostics(diagnostics, {
        nowEpochMs: 2_000,
        nowMonotonicMs: 100,
        scrollAppliedMs: 70,
        stats: {
          state: STATS_30,
          notes: STATS_12_5,
          scroll: STATS_70,
        },
        labels: LABELS,
      }),
    ).toEqual([
      "state seq=12 notesSeq=7 rev=abcdef age=1000.0ms size=256 B read=0.8ms applied=40.0ms avg=30.0ms min=10.0ms max=50.0ms p95=50.0ms p99=50.0ms",
      "notes notesSeq=7 rev=abcdef age=200.0ms size=4.0 KiB read=8.3ms applied=10.0ms avg=12.5ms min=5.0ms max=20.0ms p95=20.0ms p99=20.0ms",
      "fail stateMissing=1 stateInvalid=2 notesMissing=3 notesInvalid=4 revMismatch=5",
      "scroll applied current=70.0ms avg=70.0ms min=70.0ms max=70.0ms p95=70.0ms p99=70.0ms",
    ])
  })

  it("keeps missing channel data explicit", () => {
    expect(
      formatBridgeDiagnostics(
        {
          state: null,
          notes: null,
          stateRecord: null,
          notesRecord: null,
          counters: {
            stateMissing: 0,
            stateInvalid: 0,
            notesMissing: 0,
            notesInvalid: 0,
            revMismatch: 0,
          },
          costs: {
            stateReadMs: null,
            notesReadMs: null,
          },
        },
        {
          nowEpochMs: 2_000,
          nowMonotonicMs: 100,
          scrollAppliedMs: null,
          stats: { state: null, notes: null, scroll: null },
          labels: LABELS,
        },
      ),
    ).toEqual([
      "state seq=n/a notesSeq=n/a rev=n/a age=n/a size=n/a read=n/a applied=n/a avg=n/a min=n/a max=n/a p95=n/a p99=n/a",
      "notes notesSeq=n/a rev=n/a age=n/a size=n/a read=n/a applied=n/a avg=n/a min=n/a max=n/a p95=n/a p99=n/a",
      "fail stateMissing=0 stateInvalid=0 notesMissing=0 notesInvalid=0 revMismatch=0",
      "scroll applied current=n/a avg=n/a min=n/a max=n/a p95=n/a p99=n/a",
    ])
  })
})

describe("BridgeDiagnosticsStats", () => {
  it("collects channel stats once per accepted record", () => {
    const stats = new BridgeDiagnosticsStats()
    const first: BridgeDiagnostics = {
      state: { modifiedAtMs: 1_000, sizeBytes: 256, acceptedAtMs: 60 },
      notes: { modifiedAtMs: 1_000, sizeBytes: 512, acceptedAtMs: 90 },
      stateRecord: null,
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        notesReadMs: null,
      },
    }

    expect(stats.sample(first, 100, null)).toEqual({
      state: { avg: 40, min: 40, max: 40, p95: 40, p99: 40 },
      notes: { avg: 10, min: 10, max: 10, p95: 10, p99: 10 },
      scroll: null,
    })
    expect(stats.sample(first, 116, null)).toEqual({
      state: { avg: 40, min: 40, max: 40, p95: 40, p99: 40 },
      notes: { avg: 10, min: 10, max: 10, p95: 10, p99: 10 },
      scroll: null,
    })
    expect(
      stats.sample(
        {
          ...first,
          state: { modifiedAtMs: 1_000, sizeBytes: 256, acceptedAtMs: 150 },
        },
        170,
        null,
      ),
    ).toEqual({
      state: { avg: 30, min: 20, max: 40, p95: 40, p99: 40 },
      notes: { avg: 10, min: 10, max: 10, p95: 10, p99: 10 },
      scroll: null,
    })
  })

  it("collects scroll stats from scroll spikes without counting zero baselines", () => {
    const stats = new BridgeDiagnosticsStats()
    const empty: BridgeDiagnostics = {
      state: null,
      notes: null,
      stateRecord: null,
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        notesReadMs: null,
      },
    }

    expect(stats.sample(empty, 100, 0).scroll).toBeNull()
    expect(stats.sample(empty, 116, 12).scroll).toEqual({
      avg: 12,
      min: 12,
      max: 12,
      p95: 12,
      p99: 12,
    })
    expect(stats.sample(empty, 132, 0).scroll).toEqual({
      avg: 12,
      min: 12,
      max: 12,
      p95: 12,
      p99: 12,
    })
    expect(stats.sample(empty, 148, 24).scroll).toEqual({
      avg: 18,
      min: 12,
      max: 24,
      p95: 24,
      p99: 24,
    })
  })
})

describe("diagnosticsGraphSample", () => {
  it("extracts applied and read timings while preserving missing values", () => {
    const diagnostics: BridgeDiagnostics = {
      state: { modifiedAtMs: 1_000, sizeBytes: 256, acceptedAtMs: 60 },
      notes: null,
      stateRecord: null,
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: 0.75,
        notesReadMs: null,
      },
    }

    expect(diagnosticsGraphSample(diagnostics, 100)).toEqual({
      stateAppliedMs: 40,
      notesAppliedMs: null,
      stateReadMs: 0.75,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
  })
})

describe("BridgeScrollLatency", () => {
  it("samples accepted-to-draw latency when the viewport mapping changes", () => {
    const latency = new BridgeScrollLatency()
    const diagnostics: BridgeDiagnostics = {
      state: { modifiedAtMs: 1_000, sizeBytes: 256, acceptedAtMs: 60 },
      notes: null,
      stateRecord: null,
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        notesReadMs: null,
      },
    }
    const seqOnly = {
      ...VIEWPORT,
      source: VIEWPORT.source ? { ...VIEWPORT.source, seq: 2 } : undefined,
    }
    const scrolled = {
      ...VIEWPORT,
      contentX: 80,
      source: VIEWPORT.source
        ? {
            ...VIEWPORT.source,
            seq: 3,
            mapping: {
              ...VIEWPORT.source.mapping,
              viewLeft: 10,
              viewRight: 110,
            },
          }
        : undefined,
    }

    expect(latency.sample(VIEWPORT, diagnostics, 100)).toBeNull()
    expect(latency.sample(seqOnly, diagnostics, 116)).toBe(0)
    expect(latency.sample(scrolled, diagnostics, 130)).toBe(70)
    expect(latency.sample(scrolled, diagnostics, 146)).toBe(0)
  })

  it("returns zero for unchanged viewport after a scroll latency sample", () => {
    const latency = new BridgeScrollLatency()
    const diagnostics: BridgeDiagnostics = {
      state: { modifiedAtMs: 1_000, sizeBytes: 256, acceptedAtMs: 60 },
      notes: null,
      stateRecord: null,
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        notesReadMs: null,
      },
    }
    const scrolled = {
      ...VIEWPORT,
      contentX: 80,
      source: VIEWPORT.source
        ? {
            ...VIEWPORT.source,
            mapping: {
              ...VIEWPORT.source.mapping,
              viewLeft: 10,
              viewRight: 110,
            },
          }
        : undefined,
    }

    expect(latency.sample(VIEWPORT, diagnostics, 100)).toBeNull()
    expect(latency.sample(scrolled, diagnostics, 130)).toBe(70)
    expect(latency.sample(scrolled, diagnostics, 146)).toBe(0)
    expect(latency.sample(scrolled, diagnostics, 1_181)).toBe(0)
    expect(latency.sample(null, diagnostics, 1_200)).toBeNull()
    expect(latency.sample(scrolled, diagnostics, 1_216)).toBeNull()
  })
})

describe("BridgeDiagnosticsGraphHistory", () => {
  it("keeps the newest samples up to its capacity", () => {
    const history = new BridgeDiagnosticsGraphHistory(3)
    history.push({
      stateAppliedMs: 1,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
    history.push({
      stateAppliedMs: 2,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
    history.push({
      stateAppliedMs: 3,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
    history.push({
      stateAppliedMs: 4,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })

    expect(history.samples()).toEqual([
      {
        stateAppliedMs: 2,
        notesAppliedMs: null,
        stateReadMs: null,
        notesReadMs: null,
        scrollAppliedMs: null,
      },
      {
        stateAppliedMs: 3,
        notesAppliedMs: null,
        stateReadMs: null,
        notesReadMs: null,
        scrollAppliedMs: null,
      },
      {
        stateAppliedMs: 4,
        notesAppliedMs: null,
        stateReadMs: null,
        notesReadMs: null,
        scrollAppliedMs: null,
      },
    ])
  })

  it("keeps the largest graph scale after the sample leaves history", () => {
    const history = new BridgeDiagnosticsGraphHistory(2)
    history.push({
      stateAppliedMs: 80,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
    history.push({
      stateAppliedMs: 4,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })
    history.push({
      stateAppliedMs: 5,
      notesAppliedMs: null,
      stateReadMs: null,
      notesReadMs: null,
      scrollAppliedMs: null,
    })

    expect(history.samples()).toEqual([
      {
        stateAppliedMs: 4,
        notesAppliedMs: null,
        stateReadMs: null,
        notesReadMs: null,
        scrollAppliedMs: null,
      },
      {
        stateAppliedMs: 5,
        notesAppliedMs: null,
        stateReadMs: null,
        notesReadMs: null,
        scrollAppliedMs: null,
      },
    ])
    expect(history.scale()).toBe(80)
    history.reset()
    expect(history.scale()).toBe(1)
  })
})

describe("diagnosticsGraphScale", () => {
  it("uses graph-visible timings and ignores notes timings", () => {
    expect(
      diagnosticsGraphScale([
        {
          stateAppliedMs: 4,
          notesAppliedMs: 200,
          stateReadMs: 0.5,
          notesReadMs: 100,
          scrollAppliedMs: null,
        },
        {
          stateAppliedMs: 12,
          notesAppliedMs: 80,
          stateReadMs: 1,
          notesReadMs: 90,
          scrollAppliedMs: 14,
        },
      ]),
    ).toBe(14)
    expect(diagnosticsGraphScale([])).toBe(1)
  })
})

describe("diagnosticsYAxisLabels", () => {
  it("places max, midpoint, and zero labels on the y axis", () => {
    expect(diagnosticsYAxisLabels(80, 20, 80)).toEqual([
      { text: "80.0ms", y: 20 },
      { text: "40.0ms", y: 50 },
      { text: "0.0ms", y: 80 },
    ])
  })
})

describe("diagnosticsLegendLayout", () => {
  it("shows only graph-visible series and wraps them inside the graph width", () => {
    const items = diagnosticsLegendLayout(LABELS, 120)

    expect(items.map((item) => item.label)).toEqual([
      LABELS.stateApplied,
      LABELS.stateRead,
      LABELS.scrollApplied,
    ])
    expect(items.map((item) => item.color)).toEqual([
      "rgba(96, 165, 250, 0.75)",
      "rgba(245, 158, 11, 0.75)",
      "rgba(192, 132, 252, 0.75)",
    ])
    expect(items.every((item) => item.x + item.w <= 120)).toBe(true)
  })
})

describe("diagnosticsPanelPosition", () => {
  it("places the panel inside the piano roll's upper-right corner", () => {
    expect(
      diagnosticsPanelPosition({ x: 100, y: 40, w: 800, h: 360 }, { w: 220, h: 44 }, 8),
    ).toEqual({ x: 672, y: 48 })
  })

  it("keeps the panel inside a narrow piano roll", () => {
    expect(
      diagnosticsPanelPosition({ x: 100, y: 40, w: 140, h: 360 }, { w: 220, h: 44 }, 8),
    ).toEqual({ x: 108, y: 48 })
  })
})

describe("diagnosticsGraphPosition", () => {
  it("places the graph inside the piano roll's upper-left corner", () => {
    expect(diagnosticsGraphPosition({ x: 100, y: 40, w: 800, h: 360 }, 8)).toEqual({
      x: 108,
      y: 48,
    })
  })
})
