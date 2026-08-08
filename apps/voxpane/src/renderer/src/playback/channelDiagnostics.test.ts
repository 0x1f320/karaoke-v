import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { BridgeDiagnostics } from "../../../shared/bridgeDiagnostics"
import type { Viewport } from "../../../shared/geometry"
import {
  BridgeDiagnosticsGraphHistory,
  type BridgeDiagnosticsLabels,
  BridgeDiagnosticsStats,
  BridgeScrollLatency,
  diagnosticsGraphSample,
  diagnosticsGraphScale,
  diagnosticsLegendLayout,
  diagnosticsPanelPosition,
  formatBridgeDiagnostics,
} from "./channelDiagnostics"

const LABELS: BridgeDiagnosticsLabels = {
  connection: (values) =>
    `Connection: ${values.status} | Session: ${values.session} | Pipe recoveries: ${values.recoveries} | Malformed frames: ${values.malformedFrames} | Endpoint failures: ${values.endpointFailures} | Disconnects: ${values.disconnects}`,
  status: (status) => status ?? "unavailable",
  state: "state",
  scroll: "scroll",
  notes: "notes",
  received: "received",
  size: "size",
  applied: "applied",
  average: "avg",
  current: "current",
  min: "min",
  seq: "seq",
  notesSeq: "notesSeq",
  scrollSeq: "scrollSeq",
  rev: "rev",
  failures: "fail",
  stateInvalid: "stateInvalid",
  scrollInvalid: "scrollInvalid",
  scrollSeqMismatch: "scrollSeqMismatch",
  notesInvalid: "notesInvalid",
  notesSeqMismatch: "notesSeqMismatch",
  revMismatch: "revMismatch",
  stateApplied: "state applied",
  notesApplied: "notes applied",
  scrollApplied: "scroll applied",
  max: "max",
  p95: "p95",
  p99: "p99",
  missing: "n/a",
}

function diagnostics(overrides: Partial<BridgeDiagnostics> = {}): BridgeDiagnostics {
  return {
    state: { receivedAtMs: 1_000, acceptedAtMs: 60, sizeBytes: 256 },
    scroll: { receivedAtMs: 1_500, acceptedAtMs: 70, sizeBytes: 64 },
    notes: { receivedAtMs: 1_800, acceptedAtMs: 90, sizeBytes: 4_096 },
    stateRecord: { seq: 12, notesSeq: 7, scrollSeq: 4, rev: "abcdef123456" },
    scrollRecord: { scrollSeq: 4 },
    notesRecord: { notesSeq: 7, rev: "abcdef123456" },
    counters: {
      stateInvalid: 2,
      scrollInvalid: 4,
      scrollSeqMismatch: 5,
      notesInvalid: 7,
      notesSeqMismatch: 6,
      revMismatch: 8,
    },
    transport: {
      status: "connected",
      session: "0123456789abcdef0123456789abcdef",
      recoveries: 2,
      malformedFrames: 1,
      endpointFailures: 3,
      disconnects: { state: 1, scroll: 2, notes: 3 },
    },
    ...overrides,
  }
}

const STATS = {
  state: { avg: 30, min: 10, max: 50, p95: 50, p99: 50 },
  notes: { avg: 12.5, min: 5, max: 20, p95: 20, p99: 20 },
  scroll: { avg: 70, min: 70, max: 70, p95: 70, p99: 70 },
}

describe("formatBridgeDiagnostics", () => {
  it("reports connection, received age, applied age, and stream observations", () => {
    expect(
      formatBridgeDiagnostics(diagnostics(), {
        nowEpochMs: 2_000,
        nowMonotonicMs: 100,
        scrollAppliedMs: 70,
        stats: STATS,
        labels: LABELS,
      }),
    ).toEqual([
      "Connection: connected | Session: 01234567 | Pipe recoveries: 2 | Malformed frames: 1 | Endpoint failures: 3 | Disconnects: 6",
      "state seq=12 notesSeq=7 scrollSeq=4 rev=abcdef received=1000.0ms size=256 B applied=40.0ms avg=30.0ms min=10.0ms max=50.0ms p95=50.0ms p99=50.0ms",
      "scroll scrollSeq=4 received=500.0ms size=64 B applied=30.0ms avg=n/a min=n/a max=n/a p95=n/a p99=n/a",
      "notes notesSeq=7 rev=abcdef received=200.0ms size=4.0 KiB applied=10.0ms avg=12.5ms min=5.0ms max=20.0ms p95=20.0ms p99=20.0ms",
      "fail stateInvalid=2 scrollInvalid=4 scrollSeqMismatch=5 notesInvalid=7 notesSeqMismatch=6 revMismatch=8",
      "scroll applied current=70.0ms avg=70.0ms min=70.0ms max=70.0ms p95=70.0ms p99=70.0ms",
    ])
  })

  it("keeps unavailable stream data explicit without file-read fields", () => {
    expect(
      formatBridgeDiagnostics(
        diagnostics({
          state: null,
          scroll: null,
          notes: null,
          stateRecord: null,
          scrollRecord: null,
          notesRecord: null,
          transport: null,
        }),
        {
          nowEpochMs: 2_000,
          nowMonotonicMs: 100,
          scrollAppliedMs: null,
          stats: { state: null, notes: null, scroll: null },
          labels: LABELS,
        },
      ),
    ).toContain(
      "state seq=n/a notesSeq=n/a scrollSeq=n/a rev=n/a received=n/a size=n/a applied=n/a avg=n/a min=n/a max=n/a p95=n/a p99=n/a",
    )
  })
})

describe("debug channel locales", () => {
  it("uses natural connection templates without repeating the status noun", () => {
    const channels = (language: string) =>
      JSON.parse(
        readFileSync(
          new URL(`../../../shared/i18n/locales/${language}.json`, import.meta.url),
          "utf8",
        ),
      ).debug.channels

    expect(channels("ko").connection).toBe(
      "연결 상태: {{status}} | 세션: {{session}} | 파이프 복구: {{recoveries}}회 | 잘못된 프레임: {{malformedFrames}}개 | 엔드포인트 실패: {{endpointFailures}}회 | 연결 해제: {{disconnects}}회",
    )
    expect(channels("en").connection).toBe(
      "Connection: {{status}} | Session: {{session}} | Pipe recoveries: {{recoveries}} | Malformed frames: {{malformedFrames}} | Endpoint failures: {{endpointFailures}} | Disconnects: {{disconnects}}",
    )
    expect(channels("ja").connection).toBe(
      "接続状態: {{status}} | セッション: {{session}} | パイプ復旧: {{recoveries}}回 | 不正フレーム: {{malformedFrames}}件 | エンドポイント失敗: {{endpointFailures}}回 | 切断: {{disconnects}}回",
    )
  })
})

describe("BridgeDiagnosticsStats", () => {
  it("collects channel stats once per monotonic accepted timestamp", () => {
    const stats = new BridgeDiagnosticsStats()
    const first = diagnostics()

    expect(stats.sample(first, 100, null).state).toEqual({
      avg: 40,
      min: 40,
      max: 40,
      p95: 40,
      p99: 40,
    })
    expect(stats.sample(first, 116, null).state).toEqual({
      avg: 40,
      min: 40,
      max: 40,
      p95: 40,
      p99: 40,
    })
    expect(
      stats.sample(
        diagnostics({ state: { receivedAtMs: 3_000, acceptedAtMs: 150, sizeBytes: 256 } }),
        170,
        null,
      ).state,
    ).toEqual({ avg: 30, min: 20, max: 40, p95: 40, p99: 40 })
  })
})

describe("diagnosticsGraphSample", () => {
  it("keeps applied-age and scroll-applied series without file-read series", () => {
    const sample = diagnosticsGraphSample(diagnostics(), 100, 22)

    expect(sample).toEqual({ stateAppliedMs: 40, notesAppliedMs: 10, scrollAppliedMs: 22 })
    expect(sample).not.toHaveProperty("stateReadMs")
    expect(sample).not.toHaveProperty("notesReadMs")
  })

  it("scales only the visible applied-age and scroll-applied series", () => {
    expect(
      diagnosticsGraphScale([
        { stateAppliedMs: 4, notesAppliedMs: 200, scrollAppliedMs: null },
        { stateAppliedMs: 12, notesAppliedMs: 80, scrollAppliedMs: 14 },
      ]),
    ).toBe(14)
  })

  it("keeps graph history bounded while retaining its maximum scale", () => {
    const history = new BridgeDiagnosticsGraphHistory(2)
    history.push({ stateAppliedMs: 80, notesAppliedMs: null, scrollAppliedMs: null })
    history.push({ stateAppliedMs: 4, notesAppliedMs: null, scrollAppliedMs: null })
    history.push({ stateAppliedMs: 5, notesAppliedMs: null, scrollAppliedMs: null })

    expect(history.samples()).toEqual([
      { stateAppliedMs: 4, notesAppliedMs: null, scrollAppliedMs: null },
      { stateAppliedMs: 5, notesAppliedMs: null, scrollAppliedMs: null },
    ])
    expect(history.scale()).toBe(80)
  })

  it("renders no obsolete read legend", () => {
    expect(diagnosticsLegendLayout(LABELS, 120).map((item) => item.label)).toEqual([
      LABELS.stateApplied,
      LABELS.scrollApplied,
    ])
  })
})

describe("BridgeScrollLatency", () => {
  it("uses the preload monotonic accepted clock when the viewport changes", () => {
    const viewport: Viewport = {
      canvas: { x: 10, y: 20, w: 800, h: 400 },
      contentX: 100,
      contentW: 2_000,
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
    const scrolled = {
      ...viewport,
      contentX: 80,
      source: viewport.source && {
        ...viewport.source,
        mapping: { ...viewport.source.mapping, viewLeft: 10, viewRight: 110 },
      },
    }
    const latency = new BridgeScrollLatency()

    expect(latency.sample(viewport, diagnostics(), 100)).toBeNull()
    expect(latency.sample(scrolled, diagnostics(), 130)).toBe(60)
    expect(latency.sample(scrolled, diagnostics(), 146)).toBe(0)
  })
})

describe("diagnosticsPanelPosition", () => {
  it("places the panel inside the piano roll's upper-right corner", () => {
    expect(
      diagnosticsPanelPosition({ x: 100, y: 40, w: 800, h: 360 }, { w: 220, h: 44 }, 8),
    ).toEqual({ x: 672, y: 48 })
  })
})
