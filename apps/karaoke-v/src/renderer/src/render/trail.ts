import { type Container, Graphics, Sprite, type Texture } from "pixi.js"

// The line the voice leaves behind it — the sung curve, which the caller feeds
// in whether or not the other effects follow the pitch.
//
// Like the sparks, everything here lives in the note set's coordinate space, so
// rebase() moves it when a new AX read replaces the frame it was written in.

/** Ceiling on the ribbon, so a long life cannot grow the redraw without bound. */
const MAX_POINTS = 512
const MAX_SPARKLES = 240
/** Shortest move that earns a new point: a parked playhead extends nothing. */
const MIN_STEP_PX = 3
/**
 * Longest sideways move that is still one line, in note lanes.
 *
 * Sideways only. The voice can dive an octave between two frames and drawing
 * that is the whole point of the line, but the playhead cannot leap along the
 * roll — a jump like that is the sounding note having been matched to the rect
 * of another one, which would otherwise stand as a streak until it faded.
 */
const MAX_JOIN_LANES = 6
/** Steps the fade is quantized to — see redraw(). */
const FADE_LEVELS = 16
/** How bright the soft bed under the line is, against its core. */
const HALO_ALPHA = 0.22
/** Sparkle size as a multiple of the line's width. */
const SPARKLE_SIZE = { min: 0.5, max: 1.4 }
/** How far a sparkle is scattered off the line, as a multiple of its width. */
const SPARKLE_SCATTER = 1.6
/** Twinkles per second, per sparkle. */
const TWINKLE_HZ = { min: 1.5, max: 5 }
/** How much of a sparkle's brightness the twinkle may swallow. */
const TWINKLE_DEPTH = 0.45

export interface TrailParams {
  enabled: boolean
  /** How long a stretch of the line takes to fade out, seconds. */
  life: number
  /** Thickness of the bright core, px. */
  width: number
  /** How far the halo spreads past the core, as a multiple of the width. */
  bloom: number
  /** Sparkles left along the line per second. */
  sparkle: number
  /** 0xRRGGBB. */
  color: number
}

interface TrailPoint {
  x: number
  y: number
  age: number
  /** False on the first point after a silence — nothing is drawn across a gap. */
  joined: boolean
}

interface Sparkle {
  sprite: Sprite
  x: number
  y: number
  age: number
  life: number
  size: number
  phase: number
  rate: number
}

interface CoordinateFrame {
  contentX: number
  contentW: number
  refY: number
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class PitchTrail {
  private readonly halo = new Graphics()
  private readonly core = new Graphics()
  private readonly points: TrailPoint[] = []
  private readonly live: Sparkle[] = []
  private readonly pool: Sprite[] = []
  private readonly spark: Texture
  private sparkleDebt = 0
  private silent = true

  constructor(layer: Container, texture: Texture) {
    this.spark = texture
    this.halo.blendMode = "add"
    this.core.blendMode = "add"
    layer.addChild(this.halo, this.core)
    for (let i = 0; i < MAX_SPARKLES; i++) {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      sprite.blendMode = "add"
      layer.addChild(sprite)
      this.pool.push(sprite)
    }
  }

  /** True while any of the line or its sparkles is still fading. */
  get active(): boolean {
    return this.points.length > 0 || this.live.length > 0
  }

  update(
    dt: number,
    at: { x: number; y: number; spread: number } | null,
    params: TrailParams,
  ): void {
    const life = Math.max(params.life, 0.05)
    this.expire(dt, life)

    if (at) {
      this.extend(at)
      this.scatter(dt, at, params, life)
    } else {
      this.silent = true
      this.sparkleDebt = 0
    }

    this.redraw(params, life)
    this.drawSparkles()
  }

  private expire(dt: number, life: number): void {
    // Every point ages at the same rate, so the oldest are always at the front.
    let expired = 0
    for (const point of this.points) {
      point.age += dt
      if (point.age >= life) {
        expired++
      }
    }
    if (expired > 0) {
      this.points.splice(0, expired)
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const sparkle = this.live[i]
      sparkle.age += dt
      if (sparkle.age >= sparkle.life) {
        sparkle.sprite.visible = false
        this.pool.push(sparkle.sprite)
        this.live.splice(i, 1)
      }
    }
  }

  private extend(at: { x: number; y: number; spread: number }): void {
    const last = this.points[this.points.length - 1]
    if (last && !this.silent) {
      const dx = at.x - last.x
      const dy = at.y - last.y
      if (Math.hypot(dx, dy) < MIN_STEP_PX) {
        return
      }
      if (Math.abs(dx) > MAX_JOIN_LANES * at.spread) {
        this.silent = true
      }
    }
    this.points.push({ x: at.x, y: at.y, age: 0, joined: !this.silent && last !== undefined })
    this.silent = false
    if (this.points.length > MAX_POINTS) {
      this.points.shift()
    }
  }

  private scatter(
    dt: number,
    at: { x: number; y: number; spread: number },
    params: TrailParams,
    life: number,
  ): void {
    this.sparkleDebt += dt * Math.max(params.sparkle, 0)
    const count = Math.floor(this.sparkleDebt)
    if (count <= 0) {
      return
    }
    this.sparkleDebt -= count
    const scatter = params.width * params.bloom * SPARKLE_SCATTER
    for (let i = 0; i < count; i++) {
      const sprite = this.pool.pop()
      if (!sprite) {
        return
      }
      sprite.visible = true
      sprite.tint = params.color
      this.live.push({
        sprite,
        x: at.x + between(-scatter, scatter),
        y: at.y + between(-scatter, scatter),
        age: 0,
        // Outliving the line they were left on, so the last thing to go is a
        // handful of points rather than the whole ribbon at once.
        life: life * between(1, 1.6),
        size: params.width * between(SPARKLE_SIZE.min, SPARKLE_SIZE.max),
        phase: between(0, Math.PI * 2),
        rate: between(TWINKLE_HZ.min, TWINKLE_HZ.max),
      })
    }
  }

  /**
   * The ribbon, as few strokes as its fade allows.
   *
   * Alpha falls off along the line, and Pixi strokes one path at one alpha, so
   * the honest drawing is a stroke per segment — hundreds of them rebuilt every
   * frame. Quantizing the fade instead lets consecutive segments share a stroke:
   * the alpha only ever decreases towards the tail, so a level is always a
   * contiguous run, and the whole line comes out in at most FADE_LEVELS strokes.
   */
  private redraw(params: TrailParams, life: number): void {
    this.halo.clear()
    this.core.clear()
    if (params.width <= 0 || this.points.length < 2) {
      return
    }
    const haloWidth = params.width * Math.max(params.bloom, 1)
    let start = 0
    let level = this.fadeLevel(this.points[0], life)
    for (let i = 1; i < this.points.length; i++) {
      const point = this.points[i]
      const next = this.fadeLevel(point, life)
      if (!point.joined) {
        this.strokeRun(start, i - 1, level, params, haloWidth)
        start = i
      } else if (next !== level) {
        // Ending on this point rather than before it, so the run that takes
        // over starts where this one stopped and no segment goes undrawn.
        this.strokeRun(start, i, next, params, haloWidth)
        start = i
      }
      level = next
    }
    this.strokeRun(start, this.points.length - 1, level, params, haloWidth)
  }

  /** Where a point sits in the fade, quantized. Zero is nothing left to draw. */
  private fadeLevel(point: TrailPoint, life: number): number {
    const left = Math.max(1 - point.age / life, 0)
    // Squared, so the line stays readable behind the playhead and then gives
    // way quickly rather than ending on a hard edge.
    return Math.ceil(left * left * FADE_LEVELS)
  }

  private strokeRun(
    from: number,
    to: number,
    level: number,
    params: TrailParams,
    haloWidth: number,
  ): void {
    if (to <= from || level <= 0) {
      return
    }
    const alpha = level / FADE_LEVELS
    const first = this.points[from]
    this.halo.moveTo(first.x, first.y)
    this.core.moveTo(first.x, first.y)
    for (let i = from + 1; i <= to; i++) {
      const point = this.points[i]
      this.halo.lineTo(point.x, point.y)
      this.core.lineTo(point.x, point.y)
    }
    const color = params.color
    this.halo.stroke({
      width: haloWidth,
      color,
      alpha: alpha * HALO_ALPHA,
      cap: "round",
      join: "round",
    })
    this.core.stroke({ width: params.width, color, alpha, cap: "round", join: "round" })
  }

  private drawSparkles(): void {
    for (const sparkle of this.live) {
      const left = 1 - sparkle.age / sparkle.life
      const turn = sparkle.phase + sparkle.age * sparkle.rate * 2 * Math.PI
      const twinkle = 1 - TWINKLE_DEPTH * (0.5 - 0.5 * Math.cos(turn))
      sparkle.sprite.position.set(sparkle.x, sparkle.y)
      sparkle.sprite.alpha = left * twinkle
      sparkle.sprite.scale.set((sparkle.size * 2) / this.spark.width)
    }
  }

  /** Follow the note set into a new AX read's coordinate frame. */
  rebase(from: CoordinateFrame, to: CoordinateFrame): void {
    const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
    const dy = to.refY - from.refY
    if (scaleX === 1 && from.contentX === to.contentX && dy === 0) {
      return
    }
    for (const point of this.points) {
      point.x = to.contentX + (point.x - from.contentX) * scaleX
      point.y += dy
    }
    for (const sparkle of this.live) {
      sparkle.x = to.contentX + (sparkle.x - from.contentX) * scaleX
      sparkle.y += dy
    }
  }

  clear(): void {
    this.points.length = 0
    for (const sparkle of this.live) {
      sparkle.sprite.visible = false
      this.pool.push(sparkle.sprite)
    }
    this.live.length = 0
    this.halo.clear()
    this.core.clear()
  }

  dispose(): void {
    this.clear()
    for (const sprite of this.pool) {
      sprite.destroy()
    }
    this.pool.length = 0
    this.halo.destroy()
    this.core.destroy()
  }
}
