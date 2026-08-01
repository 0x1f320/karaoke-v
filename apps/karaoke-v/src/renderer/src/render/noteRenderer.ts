import type { Rect } from "@karaoke-v/macos-helper"
import { Application, Container, Graphics } from "pixi.js"

// PixiJS scene for the overlay. Notes live in `content`, whose position carries
// the scroll delta — so a scroll frame moves one transform rather than touching
// note geometry, and geometry is only rebuilt when the AX read replaces the set.
//
// Layout:
//   stage
//   ├─ content        (mask = clip; shifted by the scroll delta)
//   │  ├─ notes       (one Graphics batching every note rect)
//   │  └─ effects     (empty — for particle systems / effect layers)
//   └─ clip           (the piano-roll viewport rect, in window-local coords)

/** Non-premultiplied RGBA, components in 0..1. */
export type Rgba = readonly [number, number, number, number]

export interface DrawParams {
  /** Drawing surface size in CSS px. */
  width: number
  height: number
  dpr: number
  /** Added to every note's origin — the scroll delta plus the window origin. */
  offsetX: number
  offsetY: number
  /** Nothing draws outside this rect (window-local CSS px). */
  clip: { x: number; y: number; w: number; h: number }
  fill: Rgba
  stroke: Rgba
  /** Border thickness in CSS px. */
  border: number
}

interface Style {
  fill: Rgba
  stroke: Rgba
  border: number
}

/** Pixi wants a 0xRRGGBB int plus a separate alpha. */
function rgb(c: Rgba): number {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.border === b.border &&
    a.fill.every((v, i) => v === b.fill[i]) &&
    a.stroke.every((v, i) => v === b.stroke[i])
  )
}

export class NoteRenderer {
  private readonly canvas: HTMLCanvasElement
  private app: Application | null = null
  private content: Container | null = null
  private notes: Graphics | null = null
  private clip: Graphics | null = null
  /** Effect layers (particles etc.) mount here — scrolls with the notes. */
  private effectsLayer: Container | null = null
  private disposed = false

  // Latest note set, kept CPU-side so init can pick up whatever the pump already
  // delivered, and so a style change can rebuild without waiting for a read.
  private rects: readonly Rect[] = []
  private geometryDirty = false
  private style: Style | null = null
  private clipRect = { x: 0, y: 0, w: 0, h: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    void this.init()
  }

  /** True once Pixi's async init has finished; draw() no-ops until then. */
  get ready(): boolean {
    return this.app !== null
  }

  /** Container for future effect layers. Null until init resolves. */
  get effects(): Container | null {
    return this.effectsLayer
  }

  private async init(): Promise<void> {
    const app = new Application()
    await app.init({
      canvas: this.canvas,
      // We drive rendering from our own rAF (which reads the viewport atomically
      // at paint time), so Pixi's ticker must not render behind our back.
      autoStart: false,
      sharedTicker: false,
      preference: "webgl",
      backgroundAlpha: 0,
      antialias: false,
      // The canvas is sized by CSS; we hand Pixi the resolution explicitly.
      autoDensity: false,
      powerPreference: "low-power",
    })
    if (this.disposed) {
      app.destroy(true)
      return
    }
    app.ticker.stop()

    const content = new Container()
    const notes = new Graphics()
    const effects = new Container()
    const clip = new Graphics()

    content.addChild(notes, effects)
    // An axis-aligned rect mask lets Pixi clip with scissor instead of stencil.
    content.mask = clip
    app.stage.addChild(content, clip)

    this.app = app
    this.content = content
    this.notes = notes
    this.effectsLayer = effects
    this.clip = clip
    this.geometryDirty = true
    this.clipRect = { x: 0, y: 0, w: 0, h: 0 }
  }

  /** Replace the note set. Geometry is rebuilt on the next draw, not here. */
  setNotes(notes: readonly Rect[]): void {
    this.rects = notes
    this.geometryDirty = true
  }

  clear(): void {
    this.rects = []
    this.geometryDirty = true
  }

  private rebuild(style: Style): void {
    const g = this.notes
    if (!g) {
      return
    }
    g.clear()
    if (this.rects.length === 0) {
      return
    }
    // Every rect goes into one path, so the whole set fills and strokes as a
    // single batched draw.
    for (const n of this.rects) {
      g.rect(n.x, n.y, n.w, n.h)
    }
    g.fill({ color: rgb(style.fill), alpha: style.fill[3] })
    // alignment 1 = inside, matching the inset border the 2D canvas drew.
    g.stroke({
      width: style.border,
      color: rgb(style.stroke),
      alpha: style.stroke[3],
      alignment: 1,
    })
  }

  draw(p: DrawParams): void {
    const app = this.app
    if (!app || !this.content || !this.notes || !this.clip) {
      return
    }

    const screen = app.renderer.screen
    if (
      screen.width !== p.width ||
      screen.height !== p.height ||
      app.renderer.resolution !== p.dpr
    ) {
      app.renderer.resize(p.width, p.height, p.dpr)
    }

    const style: Style = { fill: p.fill, stroke: p.stroke, border: p.border }
    if (this.geometryDirty || !this.style || !sameStyle(this.style, style)) {
      this.rebuild(style)
      this.style = style
      this.geometryDirty = false
    }

    const c = p.clip
    if (
      c.x !== this.clipRect.x ||
      c.y !== this.clipRect.y ||
      c.w !== this.clipRect.w ||
      c.h !== this.clipRect.h
    ) {
      this.clip.clear().rect(c.x, c.y, c.w, c.h).fill(0xffffff)
      this.clipRect = { ...c }
    }

    // The only per-frame work on a plain scroll: one transform.
    this.content.position.set(p.offsetX, p.offsetY)

    app.render()
  }

  dispose(): void {
    this.disposed = true
    this.app?.destroy(true, { children: true })
    this.app = null
    this.content = null
    this.notes = null
    this.clip = null
    this.effectsLayer = null
  }
}
