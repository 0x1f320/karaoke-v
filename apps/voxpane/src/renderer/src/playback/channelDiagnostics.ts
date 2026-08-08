import type { BridgeChannelDiagnostics, BridgeDiagnostics } from "../../../shared/bridgeDiagnostics"
import type { Rect, Viewport } from "../../../shared/geometry"

export interface BridgeDiagnosticsLabels {
  state: string
  notes: string
  age: string
  size: string
  applied: string
  average: string
  current: string
  min: string
  read: string
  seq: string
  notesSeq: string
  rev: string
  failures: string
  stateMissing: string
  stateInvalid: string
  notesMissing: string
  notesInvalid: string
  revMismatch: string
  stateApplied: string
  notesApplied: string
  stateRead: string
  notesRead: string
  scrollApplied: string
  max: string
  p95: string
  p99: string
  missing: string
}

export interface BridgeDiagnosticsStatValues {
  avg: number
  min: number
  max: number
  p95: number
  p99: number
}

export interface BridgeDiagnosticsStatsSnapshot {
  state: BridgeDiagnosticsStatValues | null
  notes: BridgeDiagnosticsStatValues | null
  scroll: BridgeDiagnosticsStatValues | null
}

export interface BridgeDiagnosticsGraphSample {
  stateAppliedMs: number | null
  notesAppliedMs: number | null
  stateReadMs: number | null
  notesReadMs: number | null
  scrollAppliedMs: number | null
}

interface LegendItem {
  color: string
  label: string
}

const GRAPH_SERIES = [
  {
    key: "stateAppliedMs",
    color: "rgba(96, 165, 250, 0.75)",
    label: (labels: BridgeDiagnosticsLabels) => labels.stateApplied,
  },
  {
    key: "stateReadMs",
    color: "rgba(245, 158, 11, 0.75)",
    label: (labels: BridgeDiagnosticsLabels) => labels.stateRead,
  },
  {
    key: "scrollAppliedMs",
    color: "rgba(192, 132, 252, 0.75)",
    label: (labels: BridgeDiagnosticsLabels) => labels.scrollApplied,
  },
] as const

export interface DiagnosticsLegendItem extends LegendItem {
  x: number
  y: number
  w: number
}

export interface DiagnosticsYAxisLabel {
  text: string
  y: number
}

export function formatBridgeDiagnostics(
  diagnostics: BridgeDiagnostics,
  options: {
    nowEpochMs: number
    nowMonotonicMs: number
    scrollAppliedMs: number | null
    stats: BridgeDiagnosticsStatsSnapshot
    labels: BridgeDiagnosticsLabels
  },
): string[] {
  const { labels } = options
  return [
    formatChannel("state", labels.state, diagnostics, options),
    formatChannel("notes", labels.notes, diagnostics, options),
    formatFailures(diagnostics, labels),
    `${labels.scrollApplied} ${labels.current}=${formatCost(options.scrollAppliedMs, labels.missing)} ${formatStats(options.stats.scroll, labels)}`,
  ]
}

export function diagnosticsPanelPosition(
  clip: Rect,
  panel: { w: number; h: number },
  padding: number,
): { x: number; y: number } {
  const minY = clip.y + padding
  const maxY = clip.y + clip.h - panel.h - padding
  return {
    x: Math.max(clip.x + padding, clip.x + clip.w - panel.w - padding),
    y: maxY < minY ? minY : Math.min(minY, maxY),
  }
}

export function diagnosticsGraphPosition(clip: Rect, padding: number): { x: number; y: number } {
  return {
    x: clip.x + padding,
    y: clip.y + padding,
  }
}

export function diagnosticsGraphSample(
  diagnostics: BridgeDiagnostics,
  nowMonotonicMs: number,
  scrollAppliedMs: number | null = null,
): BridgeDiagnosticsGraphSample {
  return {
    stateAppliedMs: diagnostics.state
      ? Math.max(0, nowMonotonicMs - diagnostics.state.acceptedAtMs)
      : null,
    notesAppliedMs: diagnostics.notes
      ? Math.max(0, nowMonotonicMs - diagnostics.notes.acceptedAtMs)
      : null,
    stateReadMs: diagnostics.costs.stateReadMs,
    notesReadMs: diagnostics.costs.notesReadMs,
    scrollAppliedMs,
  }
}

export class BridgeScrollLatency {
  private signature: string | null = null

  sample(
    viewport: Viewport | null,
    diagnostics: BridgeDiagnostics,
    nowMonotonicMs: number,
  ): number | null {
    const signature = viewportSignature(viewport)
    if (!signature) {
      this.signature = null
      return null
    }
    if (this.signature === null) {
      this.signature = signature
      return null
    }
    if (this.signature === signature) {
      return 0
    }
    this.signature = signature
    if (!diagnostics.state) {
      return null
    }
    return Math.max(0, nowMonotonicMs - diagnostics.state.acceptedAtMs)
  }

  reset(): void {
    this.signature = null
  }
}

export class BridgeDiagnosticsGraphHistory {
  private readonly values: BridgeDiagnosticsGraphSample[] = []
  private max = 1

  constructor(private readonly capacity: number) {}

  push(sample: BridgeDiagnosticsGraphSample): void {
    this.values.push(sample)
    this.max = Math.max(this.max, diagnosticsGraphScale([sample]))
    while (this.values.length > this.capacity) {
      this.values.shift()
    }
  }

  samples(): readonly BridgeDiagnosticsGraphSample[] {
    return this.values
  }

  scale(): number {
    return this.max
  }

  reset(): void {
    this.values.length = 0
    this.max = 1
  }
}

export function diagnosticsGraphScale(samples: readonly BridgeDiagnosticsGraphSample[]): number {
  let max = 0
  for (const sample of samples) {
    for (const value of [sample.stateAppliedMs, sample.stateReadMs, sample.scrollAppliedMs]) {
      if (value !== null) {
        max = Math.max(max, value)
      }
    }
  }
  return max > 0 ? max : 1
}

export function drawDiagnosticsGraph(
  canvas: HTMLCanvasElement,
  options: {
    clip: Rect
    dpr: number
    history: readonly BridgeDiagnosticsGraphSample[]
    labels: BridgeDiagnosticsLabels
    max?: number
    padding: number
    width: number
    height: number
  },
): void {
  const width = Math.min(options.width, Math.max(96, options.clip.w - options.padding * 2))
  const height = Math.min(options.height, Math.max(64, options.clip.h - options.padding * 2))
  const pixelWidth = Math.max(1, Math.round(width * options.dpr))
  const pixelHeight = Math.max(1, Math.round(height * options.dpr))
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const position = diagnosticsGraphPosition(options.clip, options.padding)
  canvas.style.transform = `translate(${position.x}px, ${position.y}px)`

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return
  }
  ctx.setTransform(options.dpr, 0, 0, options.dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)"
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  const top = 36
  const right = width - 8
  const legend = diagnosticsLegendLayout(options.labels, width)
  const legendRows = Math.max(1, ...legend.map((item) => item.y / 14 + 1))
  const bottom = height - (legendRows * 14 + 10)
  const max = options.max ?? diagnosticsGraphScale(options.history)
  const yAxisLabels = diagnosticsYAxisLabels(max, top, bottom)
  const left = Math.max(44, Math.min(64, formatMs(max).length * 6 + 12))
  const plotW = Math.max(1, right - left)
  const plotH = Math.max(1, bottom - top)

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
  for (const fraction of [0.25, 0.5, 0.75]) {
    const y = bottom - plotH * fraction
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }

  for (const series of GRAPH_SERIES) {
    drawSeries(ctx, options.history, series.key, series.color, left, bottom, plotW, plotH, max)
  }

  ctx.font = "10px monospace"
  ctx.textBaseline = "top"
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)"
  ctx.fillText(`${options.labels.max} ${formatMs(max)}`, 8, 6)
  drawYAxisLabels(ctx, yAxisLabels, left - 6)
  drawLegend(ctx, legend, height - legendRows * 14)
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  samples: readonly BridgeDiagnosticsGraphSample[],
  key: keyof BridgeDiagnosticsGraphSample,
  color: string,
  left: number,
  bottom: number,
  width: number,
  height: number,
  max: number,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  let drawing = false
  samples.forEach((sample, index) => {
    const value = sample[key]
    if (value === null) {
      drawing = false
      return
    }
    const x = left + (samples.length <= 1 ? width : (index / (samples.length - 1)) * width)
    const y = bottom - (Math.max(0, value) / max) * height
    if (!drawing) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      drawing = true
    } else {
      ctx.lineTo(x, y)
    }
    if (index === samples.length - 1) {
      ctx.stroke()
    }
  })
  if (drawing) {
    ctx.stroke()
  }
}

export function diagnosticsLegendLayout(
  labels: BridgeDiagnosticsLabels,
  width: number,
): DiagnosticsLegendItem[] {
  const items: LegendItem[] = GRAPH_SERIES.map((series) => ({
    color: series.color,
    label: series.label(labels),
  }))
  const out: DiagnosticsLegendItem[] = []
  let x = 8
  let y = 0
  for (const item of items) {
    const itemWidth = 22 + item.label.length * 6
    if (x > 8 && x + itemWidth > width - 8) {
      x = 8
      y += 14
    }
    out.push({ ...item, x, y, w: itemWidth })
    x += itemWidth + 10
  }
  return out
}

export function diagnosticsYAxisLabels(
  max: number,
  top: number,
  bottom: number,
): DiagnosticsYAxisLabel[] {
  const safeMax = Math.max(1, max)
  const mid = top + (bottom - top) / 2
  return [
    { text: formatMs(safeMax), y: top },
    { text: formatMs(safeMax / 2), y: mid },
    { text: formatMs(0), y: bottom },
  ]
}

function drawYAxisLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly DiagnosticsYAxisLabel[],
  right: number,
): void {
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "rgba(255, 255, 255, 0.68)"
  for (const label of labels) {
    ctx.fillText(label.text, right, label.y)
  }
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  items: readonly DiagnosticsLegendItem[],
  top: number,
): void {
  for (const item of items) {
    const y = top + item.y
    ctx.fillStyle = item.color
    ctx.fillRect(item.x, y + 3, 8, 2)
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)"
    ctx.fillText(item.label, item.x + 12, y)
  }
}

function formatChannel(
  channel: "state" | "notes",
  name: string,
  diagnostics: BridgeDiagnostics,
  options: {
    nowEpochMs: number
    nowMonotonicMs: number
    stats: BridgeDiagnosticsStatsSnapshot
    labels: BridgeDiagnosticsLabels
  },
): string {
  const { labels } = options
  const channelDiagnostics = diagnostics[channel]
  const stats = options.stats[channel]
  const record = channel === "state" ? diagnostics.stateRecord : diagnostics.notesRecord
  const cost = channel === "state" ? diagnostics.costs.stateReadMs : diagnostics.costs.notesReadMs
  const prefix =
    channel === "state"
      ? `${labels.seq}=${record && "seq" in record ? record.seq : labels.missing} ${labels.notesSeq}=${record?.notesSeq ?? labels.missing} ${labels.rev}=${formatRev(record?.rev ?? null, labels.missing)}`
      : `${labels.notesSeq}=${record?.notesSeq ?? labels.missing} ${labels.rev}=${formatRev(record?.rev ?? null, labels.missing)}`
  if (!channelDiagnostics) {
    return `${name} ${prefix} ${labels.age}=${labels.missing} ${labels.size}=${labels.missing} ${labels.read}=${formatCost(cost, labels.missing)} ${labels.applied}=${labels.missing} ${formatStats(stats, labels)}`
  }
  return `${name} ${prefix} ${labels.age}=${formatMs(options.nowEpochMs - channelDiagnostics.modifiedAtMs)} ${labels.size}=${formatBytes(channelDiagnostics.sizeBytes)} ${labels.read}=${formatCost(cost, labels.missing)} ${labels.applied}=${formatMs(options.nowMonotonicMs - channelDiagnostics.acceptedAtMs)} ${formatStats(stats, labels)}`
}

function formatFailures(diagnostics: BridgeDiagnostics, labels: BridgeDiagnosticsLabels): string {
  const { counters } = diagnostics
  return `${labels.failures} ${labels.stateMissing}=${counters.stateMissing} ${labels.stateInvalid}=${counters.stateInvalid} ${labels.notesMissing}=${counters.notesMissing} ${labels.notesInvalid}=${counters.notesInvalid} ${labels.revMismatch}=${counters.revMismatch}`
}

export class BridgeDiagnosticsStats {
  private readonly state = new ChannelStats()
  private readonly notes = new ChannelStats()
  private readonly scroll = new LatencyStats()

  sample(
    diagnostics: BridgeDiagnostics,
    nowMonotonicMs: number,
    scrollAppliedMs: number | null,
  ): BridgeDiagnosticsStatsSnapshot {
    if (scrollAppliedMs !== null && scrollAppliedMs > 0) {
      this.scroll.push(scrollAppliedMs)
    }
    return {
      state: this.state.sample(diagnostics.state, nowMonotonicMs),
      notes: this.notes.sample(diagnostics.notes, nowMonotonicMs),
      scroll: this.scroll.value(),
    }
  }

  reset(): void {
    this.state.reset()
    this.notes.reset()
    this.scroll.reset()
  }
}

class ChannelStats {
  private lastAcceptedAtMs: number | null = null
  private readonly stats = new LatencyStats()

  sample(
    diagnostics: BridgeChannelDiagnostics | null,
    nowMonotonicMs: number,
  ): BridgeDiagnosticsStatValues | null {
    if (!diagnostics) {
      return this.stats.value()
    }
    if (diagnostics.acceptedAtMs !== this.lastAcceptedAtMs) {
      this.lastAcceptedAtMs = diagnostics.acceptedAtMs
      this.stats.push(Math.max(0, nowMonotonicMs - diagnostics.acceptedAtMs))
    }
    return this.stats.value()
  }

  reset(): void {
    this.lastAcceptedAtMs = null
    this.stats.reset()
  }
}

class LatencyStats {
  private readonly values: number[] = []

  push(value: number): void {
    this.values.push(Math.max(0, value))
  }

  value(): BridgeDiagnosticsStatValues | null {
    if (this.values.length === 0) {
      return null
    }
    const sorted = [...this.values].sort((a, b) => a - b)
    const total = this.values.reduce((sum, value) => sum + value, 0)
    return {
      avg: total / this.values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    }
  }

  reset(): void {
    this.values.length = 0
  }
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  )
  return sorted[index]
}

function formatStats(
  stats: BridgeDiagnosticsStatValues | null,
  labels: BridgeDiagnosticsLabels,
): string {
  if (!stats) {
    return `${labels.average}=${labels.missing} ${labels.min}=${labels.missing} ${labels.max}=${labels.missing} ${labels.p95}=${labels.missing} ${labels.p99}=${labels.missing}`
  }
  return `${labels.average}=${formatMs(stats.avg)} ${labels.min}=${formatMs(stats.min)} ${labels.max}=${formatMs(stats.max)} ${labels.p95}=${formatMs(stats.p95)} ${labels.p99}=${formatMs(stats.p99)}`
}

function formatMs(value: number): string {
  return `${Math.max(0, value).toFixed(1)}ms`
}

function formatCost(value: number | null, missing: string): string {
  return value === null ? missing : formatMs(value)
}

function formatRev(value: string | null, missing: string): string {
  return value ? value.slice(0, 6) : missing
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }
  return `${(value / 1024).toFixed(1)} KiB`
}

function viewportSignature(viewport: Viewport | null): string | null {
  const mapping = viewport?.source?.mapping
  if (!viewport || !mapping) {
    return null
  }
  return [
    viewport.contentX,
    viewport.contentW,
    viewport.refY ?? "",
    mapping.viewLeft,
    mapping.viewRight,
    mapping.viewTop,
    mapping.viewBottom,
    mapping.perBlick,
    mapping.perSemitone,
  ].join(":")
}
