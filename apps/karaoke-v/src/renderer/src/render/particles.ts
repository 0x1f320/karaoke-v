import { type Container, Sprite, type Texture } from "pixi.js"
import type { ParticleDirection } from "../../../shared/preferences"

// Sparks thrown off wherever the playhead is crossing a note.
//
// Particles live in the same coordinate space as the note rects, which is the
// space of whichever AX read is current — so when a read is replaced mid-flight,
// rebase() shifts the live ones by the same delta the notes moved. Without that
// they jump every time the pump lands during a scroll.

const MAX_PARTICLES = 600

/** Spread of individual lifetimes around the configured one. */
const LIFE_JITTER = 0.3
/** Slowest launch as a fraction of the fastest, so the front is not a solid wall. */
const LAUNCH_JITTER = 0.65
/**
 * Downward pull, as a multiple of spreadY / life². Tying it to the settings
 * rather than fixing it in px/s² keeps the arc the same shape when the sliders
 * move — otherwise a long lifetime turns the spray into a fountain.
 *
 * Directional only: a radial burst reads as a burst because it is symmetric, and
 * gravity would collapse it into a fountain.
 */
const ARC = 0.9
const SIZE_MIN = 2.5
const SIZE_MAX = 6

export interface ParticleParams {
  enabled: boolean
  /** Sparks per second. */
  rate: number
  /** Seconds one spark lasts. */
  life: number
  direction: ParticleDirection
  /** Degrees clockwise from straight up; directional only. */
  angle: number
  /** Sideways reach over a lifetime, px — across `angle`, or the x radius. */
  spreadX: number
  /** Reach along `angle` over a lifetime, px — or the y radius. */
  spreadY: number
  /** Width of the band sparks are born along, px. */
  originX: number
  /** 0xRRGGBB. */
  color: number
}

interface Particle {
  sprite: Sprite
  vx: number
  vy: number
  /** Per-particle, since it is derived from the settings at emit time. */
  gravity: number
  age: number
  life: number
  size: number
}

interface CoordinateFrame {
  contentX: number
  contentW: number
  refY: number
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * A spark's launch velocity, px/s.
 *
 * Directional builds it from two reaches — spreadY along the aim, spreadX across
 * it — so angle 0 (straight up) is exactly the old fixed behaviour. Radial spends
 * the same two numbers as the radii of the ellipse the burst fills.
 */
function launch(params: ParticleParams, life: number): { vx: number; vy: number } {
  if (params.direction === "radial") {
    const theta = between(0, Math.PI * 2)
    const reach = between(LAUNCH_JITTER, 1)
    return {
      vx: (Math.cos(theta) * params.spreadX * reach) / life,
      vy: (Math.sin(theta) * params.spreadY * reach) / life,
    }
  }
  const theta = (params.angle * Math.PI) / 180
  // Clockwise from up: (0, -1) at 0°, (1, 0) at 90°. Across is that turned 90°.
  const alongX = Math.sin(theta)
  const alongY = -Math.cos(theta)
  const along = (between(LAUNCH_JITTER, 1) * params.spreadY) / life
  const across = (between(-1, 1) * params.spreadX) / life
  return {
    vx: alongX * along - alongY * across,
    vy: alongY * along + alongX * across,
  }
}

export class ParticleField {
  private readonly live: Particle[] = []
  private readonly pool: Sprite[] = []

  constructor(layer: Container, texture: Texture) {
    // Sprites are allocated once. Emission is bursty and per-frame, so churning
    // display objects would be the expensive part, not the maths.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      sprite.blendMode = "add"
      layer.addChild(sprite)
      this.pool.push(sprite)
    }
  }

  /**
   * Throw `count` sparks from (x, y), scattered over `height` vertically.
   *
   * The settings are reaches in px, not speeds — that is what stays meaningful
   * to a person moving a slider. Speeds fall out of reach over lifetime, so
   * changing the lifetime restretches the same shape instead of also making
   * everything fly further.
   */
  emit(x: number, y: number, height: number, count: number, params: ParticleParams): void {
    const life = Math.max(params.life, 0.01)
    const gravity = params.direction === "radial" ? 0 : (ARC * params.spreadY) / (life * life)

    for (let i = 0; i < count; i++) {
      const sprite = this.pool.pop()
      if (!sprite) {
        return // saturated — dropping is better than stealing a live particle
      }
      sprite.visible = true
      sprite.tint = params.color
      sprite.position.set(
        x + between(-params.originX / 2, params.originX / 2),
        y + between(-height / 2, height / 2),
      )
      const { vx, vy } = launch(params, life)
      this.live.push({
        sprite,
        vx,
        vy,
        gravity,
        age: 0,
        life: life * between(1 - LIFE_JITTER, 1 + LIFE_JITTER),
        size: between(SIZE_MIN, SIZE_MAX),
      })
    }
  }

  /** True while sparks are still in flight. */
  get active(): boolean {
    return this.live.length > 0
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.age += dt
      if (p.age >= p.life) {
        p.sprite.visible = false
        this.pool.push(p.sprite)
        this.live.splice(i, 1)
        continue
      }
      p.vy += p.gravity * dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt

      const left = 1 - p.age / p.life
      p.sprite.alpha = left
      // Shrink as they fade, so they read as sparks rather than shrinking discs.
      p.sprite.scale.set((p.size * (0.35 + 0.65 * left)) / 8)
    }
  }

  /** Follow the note set into a new AX read's coordinate frame. */
  rebase(from: CoordinateFrame, to: CoordinateFrame): void {
    const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
    const dy = to.refY - from.refY
    if (scaleX === 1 && from.contentX === to.contentX && dy === 0) {
      return
    }
    for (const p of this.live) {
      p.sprite.x = to.contentX + (p.sprite.x - from.contentX) * scaleX
      p.sprite.y += dy
    }
  }

  clear(): void {
    for (const p of this.live) {
      p.sprite.visible = false
      this.pool.push(p.sprite)
    }
    this.live.length = 0
  }

  dispose(): void {
    // clear() returns every live sprite to the pool, so the pool owns them all.
    // Only our own sprites get destroyed — the layer is shared with the glow.
    this.clear()
    for (const sprite of this.pool) {
      sprite.destroy()
    }
    this.pool.length = 0
  }
}
