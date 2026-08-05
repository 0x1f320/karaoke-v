import type { Rect } from "@voxpane/macos-helper"
import { Application, Container, Graphics, type Texture } from "pixi.js"
import { GlowFlash, type GlowParams } from "./glow"
import { ParticleField, type ParticleParams } from "./particles"
import { PitchTrail, type TrailParams } from "./trail"

// PixiJS scene for the overlay. Notes live in `content`, whose position carries
// the scroll delta — so a scroll frame moves one transform rather than touching
// note geometry, and geometry is only rebuilt when the AX read replaces the set.
//
// Layout:
//   stage
//   ├─ content        (mask = clip; shifted by the scroll delta)
//   │  ├─ notes       (one Graphics batching every note rect)
//   │  ├─ reaches     (one band per visible note: where its effect can travel)
//   │  ├─ playing     (debug: the note under the playhead)
//   │  └─ effects     (the playhead's glow, and the sparks it throws off)
//   └─ clip           (the piano-roll viewport rect, in window-local coords)

/** Non-premultiplied RGBA, components in 0..1. */
export type Rgba = readonly [number, number, number, number]

/** A frame gap longer than this means the loop stalled; do not catch up. */
const MAX_STEP_SEC = 0.1

export interface DrawParams {
  /** Drawing surface size in CSS px. */
  width: number
  height: number
  dpr: number
  /** Added to every note's origin — the scroll delta plus the window origin. */
  offsetX: number
  offsetY: number
  /** Horizontal zoom ratio between the current viewport and the AX read. */
  scaleX: number
  /** Nothing draws outside this rect (window-local CSS px). */
  clip: { x: number; y: number; w: number; h: number }
  fill: Rgba
  stroke: Rgba
  /** Border thickness in CSS px. */
  border: number
  /**
   * One band per visible note, in note-set coords: the vertical span its effect
   * can travel over. Empty unless the effect follows the pitch.
   */
  reaches: readonly Rect[]
  reachFill: Rgba
  reachStroke: Rgba
  /** Debug highlight of the note under the playhead, in note-set coords. */
  playing: Rect | null
  playingFill: Rgba
  /** Where the playhead crosses the sounding note; null when nothing sounds. */
  emit: { x: number; y: number; spread: number } | null
  /**
   * Where the trail is written. The same point as `emit` only when the effects
   * follow the pitch; otherwise the sung curve, which the trail draws either way.
   */
  trailEmit: { x: number; y: number; spread: number } | null
  particles: ParticleParams
  /** True on the frame a new note starts sounding — strikes the glow. */
  noteStarted: boolean
  glow: GlowParams
  trail: TrailParams
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
  private reaches: Graphics | null = null
  private playing: Graphics | null = null
  private clip: Graphics | null = null
  /** Effect layers (particles etc.) mount here — scrolls with the notes. */
  private effectsLayer: Container | null = null
  private particles: ParticleField | null = null
  private glow: GlowFlash | null = null
  private trail: PitchTrail | null = null
  private disposed = false

  // Emission is a rate, not a per-frame count, so it stays the same whether the
  // display runs at 60 or 120Hz. The remainder carries into the next frame.
  private emitDebt = 0
  private lastFrameMs = 0

  // Latest note set, kept CPU-side so init can pick up whatever the pump already
  // delivered, and so a style change can rebuild without waiting for a read.
  private rects: readonly Rect[] = []
  private geometryDirty = false
  private style: Style | null = null
  private clipRect = { x: 0, y: 0, w: 0, h: 0 }
  // The playing note changes at most a few times a second, so its geometry is
  // rebuilt only when it actually moves to another note.
  private playingRect: Rect | null = null
  private playingFill: Rgba | null = null
  private reachRects: readonly Rect[] = []
  private reachFill: Rgba | null = null
  private reachStroke: Rgba | null = null

  // The canvas belongs to the renderer, not to React. Tearing a WebGL renderer
  // down loses its context for good — the canvas can never be drawn on again —
  // so a canvas kept across renderers (a React-owned <canvas>, e.g. over an HMR
  // reload) would come back dead and draw nothing. Owning it means every
  // renderer starts on a fresh one and disposal takes it with it.
  constructor(host: HTMLElement) {
    const canvas = document.createElement("canvas")
    canvas.style.display = "block"
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    host.appendChild(canvas)
    this.canvas = canvas
    void this.init()
  }

  /** True once Pixi's async init has finished; draw() no-ops until then. */
  get ready(): boolean {
    return this.app !== null
  }

  /**
   * True while an effect still has something in flight. The draw loop keeps
   * feeding real viewport data until this goes false, so that stopping playback
   * lets the last sparks and the glow release instead of cutting them off.
   */
  get effectsActive(): boolean {
    return (
      (this.particles?.active ?? false) ||
      (this.glow?.active ?? false) ||
      (this.trail?.active ?? false)
    )
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
      app.destroy({ removeView: true }, { children: true })
      return
    }
    app.ticker.stop()

    const content = new Container()
    const notes = new Graphics()
    const reaches = new Graphics()
    const playing = new Graphics()
    const effects = new Container()
    const clip = new Graphics()

    content.addChild(notes, reaches, playing, effects)
    // An axis-aligned rect mask lets Pixi clip with scissor instead of stencil.
    content.mask = clip
    app.stage.addChild(content, clip)

    this.app = app
    this.content = content
    this.notes = notes
    this.reaches = reaches
    this.playing = playing
    this.effectsLayer = effects
    // Back to front: the trail is what the light has already passed over, so the
    // glow and then the sparks read as being in front of it.
    const spark = this.makeSparkTexture(app)
    this.trail = new PitchTrail(effects, spark)
    this.glow = new GlowFlash(effects)
    this.particles = new ParticleField(effects, spark)
    this.clip = clip
    this.geometryDirty = true
    this.clipRect = { x: 0, y: 0, w: 0, h: 0 }
  }

  /**
   * A soft dot, drawn once and tinted per particle. Concentric rings stand in
   * for a radial gradient — cheap, and under additive blending the difference
   * is invisible at this size.
   */
  private makeSparkTexture(app: Application): Texture {
    const g = new Graphics()
    for (const [radius, alpha] of [
      [8, 0.16],
      [5, 0.3],
      [3, 1],
    ] as const) {
      g.circle(0, 0, radius).fill({ color: 0xffffff, alpha })
    }
    const texture = app.renderer.generateTexture({ target: g, resolution: 2 })
    g.destroy()
    return texture
  }

  /** Move live effects into a new AX read's coordinate frame. */
  rebaseEffects(
    from: { contentX: number; contentW: number; refY: number },
    to: { contentX: number; contentW: number; refY: number },
  ): void {
    this.particles?.rebase(from, to)
    this.glow?.rebase(from, to)
    this.trail?.rebase(from, to)
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

  private sameRect(a: Rect | null, b: Rect | null): boolean {
    if (!a || !b) {
      return a === b
    }
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  }

  /** Every band in one path, so the whole set is a single batched draw. */
  private rebuildReaches(rects: readonly Rect[], fill: Rgba, stroke: Rgba, border: number): void {
    const g = this.reaches
    if (!g) {
      return
    }
    g.clear()
    if (rects.length === 0) {
      return
    }
    for (const r of rects) {
      g.rect(r.x, r.y, r.w, r.h)
    }
    g.fill({ color: rgb(fill), alpha: fill[3] })
    g.stroke({ width: border, color: rgb(stroke), alpha: stroke[3], alignment: 1 })
  }

  private sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    for (let i = 0; i < a.length; i++) {
      if (!this.sameRect(a[i], b[i])) {
        return false
      }
    }
    return true
  }

  private rebuildPlaying(rect: Rect | null, fill: Rgba): void {
    const g = this.playing
    if (!g) {
      return
    }
    g.clear()
    if (!rect) {
      return
    }
    g.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: rgb(fill), alpha: fill[3] })
  }

  draw(p: DrawParams): void {
    const app = this.app
    if (!app || !this.content || !this.notes || !this.reaches || !this.playing || !this.clip) {
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

    if (
      !this.sameRects(this.reachRects, p.reaches) ||
      !this.reachFill?.every((v, i) => v === p.reachFill[i]) ||
      !this.reachStroke?.every((v, i) => v === p.reachStroke[i])
    ) {
      this.rebuildReaches(p.reaches, p.reachFill, p.reachStroke, p.border)
      this.reachRects = p.reaches
      this.reachFill = p.reachFill
      this.reachStroke = p.reachStroke
    }

    if (
      !this.sameRect(this.playingRect, p.playing) ||
      !this.playingFill?.every((v, i) => v === p.playingFill[i])
    ) {
      this.rebuildPlaying(p.playing, p.playingFill)
      this.playingRect = p.playing
      this.playingFill = p.playingFill
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
    this.content.scale.set(p.scaleX, 1)
    this.content.position.set(p.offsetX, p.offsetY)

    this.stepEffects(p)
    app.render()
  }

  private stepEffects(p: DrawParams): void {
    const field = this.particles
    const glow = this.glow
    const trail = this.trail
    if (!field || !glow || !trail) {
      return
    }

    const now = performance.now()
    // A long gap means the window was hidden or the loop stalled; catching up
    // would fire off a burst, so treat it as a fresh start instead.
    const dt = this.lastFrameMs === 0 ? 0 : Math.min((now - this.lastFrameMs) / 1000, MAX_STEP_SEC)
    this.lastFrameMs = now

    // Each effect can be switched off on its own. Turning one off stops it
    // being fed, but both keep stepping so whatever is still in flight finishes
    // rather than vanishing mid-air.
    const glowAt = p.glow.enabled ? p.emit : null
    if (p.noteStarted && p.glow.enabled) {
      glow.flash()
    }
    glow.update(dt, glowAt, p.glow)

    trail.update(dt, p.trail.enabled ? p.trailEmit : null, p.trail)

    if (p.emit && p.particles.enabled) {
      this.emitDebt += dt * p.particles.rate
      const count = Math.floor(this.emitDebt)
      if (count > 0) {
        this.emitDebt -= count
        field.emit(p.emit.x, p.emit.y, p.emit.spread, count, p.particles)
      }
    } else {
      this.emitDebt = 0
    }

    // Runs even with nothing sounding — the last sparks still have to finish.
    field.update(dt)
  }

  dispose(): void {
    this.disposed = true
    this.particles?.dispose()
    this.particles = null
    this.glow?.dispose()
    this.glow = null
    this.trail?.dispose()
    this.trail = null
    this.app?.destroy({ removeView: true }, { children: true })
    this.app = null
    // Also covers disposal before init resolved, when there is no app to take
    // the canvas with it.
    this.canvas.remove()
    this.content = null
    this.notes = null
    this.reaches = null
    this.playing = null
    this.clip = null
    this.effectsLayer = null
  }
}
