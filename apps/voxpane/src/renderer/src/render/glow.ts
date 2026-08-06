import { type Container, Sprite, Texture } from "pixi.js"
import type { EffectBlend, EffectSource, GlowShape } from "../../../shared/preferences"
import { assetTexture } from "./assets"

// The bloom sitting on the playhead where it crosses a note.
//
// Two envelopes drive one sprite: a burst that spikes at each note onset and
// decays fast, and a sustain that holds while the note sounds and releases when
// it stops. Their sum is the brightness — which is what makes an onset read as a
// strike rather than a light being switched on. Jitter then shivers that sum,
// so the strike can be carried on for as long as the note lasts.

/** Time constant of the sustain rising and releasing, seconds. */
const SUSTAIN_TAU = 0.16
/** Below this the sprite is not worth drawing. */
const CUTOFF = 0.01
/** How much of the brightness full jitter may swallow, and give back. */
const JITTER_DEPTH = 0.9
/** Full jitter's sideways shake, as a fraction of the note's height. */
const JITTER_SHAKE = 0.14

export interface GlowParams {
  enabled: boolean
  shape: GlowShape
  source: EffectSource
  /** Stored name of the imported image, or null. */
  asset: string | null
  blend: EffectBlend
  /** 0xRRGGBB. Painted onto the shape; an image is drawn in its own colors. */
  color: number
  /** Brightness held while a note sounds, 0..1. */
  level: number
  /** Time constant of the onset spike, seconds. */
  flash: number
  /** Radius at unit brightness, as a multiple of the note's height. */
  size: number
  /** How hard the light trembles while a note sounds, 0..1. */
  jitter: number
  /** New tremble values per second. */
  jitterRate: number
}

interface CoordinateFrame {
  contentX: number
  contentW: number
  refY: number
}

/** Where a shape throws its rays: degrees clockwise from up, and how far out. */
const RAYS: Record<GlowShape, readonly { angle: number; reach: number }[]> = {
  bloom: [],
  cross: [0, 90, 180, 270].map((angle) => ({ angle, reach: 1 })),
  x: [45, 135, 225, 315].map((angle) => ({ angle, reach: 1 })),
  star: [0, 90, 180, 270]
    .map((angle) => ({ angle, reach: 1 }))
    .concat([45, 135, 225, 315].map((angle) => ({ angle, reach: 0.55 }))),
}

/** A shaped glow's bright core, as a fraction of the sprite's radius. */
const CORE_RADIUS = 0.44
/** Half-width of a ray where it leaves the core, same units. */
const RAY_WIDTH = 0.13
/** How bright the round bed under a shape is, against the plain bloom. */
const HALO_LEVEL = 0.45

const TEXTURE_SIZE = 256

/** Alpha down the radius. The falloff every round part of the glow shares. */
const FALLOFF: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.2, 0.6],
  [0.5, 0.16],
  [1, 0],
]

function paintDisc(ctx: CanvasRenderingContext2D, r: number, radius: number, level: number): void {
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, radius)
  for (const [stop, alpha] of FALLOFF) {
    gradient.addColorStop(stop, `rgba(255,255,255,${alpha * level})`)
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, r * 2, r * 2)
}

/** One streak along +x, pinched to a point at both ends and fading outwards. */
function paintRay(ctx: CanvasRenderingContext2D, length: number, width: number): void {
  const gradient = ctx.createLinearGradient(0, 0, length, 0)
  gradient.addColorStop(0, "rgba(255,255,255,0.9)")
  gradient.addColorStop(0.3, "rgba(255,255,255,0.32)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(0, -width)
  ctx.quadraticCurveTo(length * 0.45, -width * 0.18, length, 0)
  ctx.quadraticCurveTo(length * 0.45, width * 0.18, 0, width)
  ctx.closePath()
  ctx.fill()
}

/**
 * Every shape is the same round bloom with its rays laid over it — a shape
 * changes what the light throws off, never whether there is light there. A
 * gradient reads far better than stacked circles at this size, and everything
 * above the bed adds rather than painting over it, so the centre where the rays
 * cross stays the brightest point.
 */
function makeGlowTexture(shape: GlowShape): Texture {
  const canvas = document.createElement("canvas")
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return Texture.WHITE
  }
  const r = TEXTURE_SIZE / 2
  const rays = RAYS[shape]
  // Dimmed under a shape: at full strength the bed would swallow the rays, and
  // all four shapes would come out looking like the plain bloom.
  paintDisc(ctx, r, r, rays.length === 0 ? 1 : HALO_LEVEL)

  ctx.globalCompositeOperation = "lighter"
  if (rays.length > 0) {
    paintDisc(ctx, r, r * CORE_RADIUS, 1)
  }
  for (const ray of rays) {
    ctx.save()
    ctx.translate(r, r)
    // The table is degrees clockwise from up; canvas rotation starts from +x.
    ctx.rotate(((ray.angle - 90) * Math.PI) / 180)
    paintRay(ctx, r * ray.reach, r * RAY_WIDTH)
    ctx.restore()
  }
  return Texture.from(canvas)
}

// Built once per shape and shared: switching shapes mid-drag would otherwise
// rasterise a 256px canvas on the frame the setting changes.
const textures = new Map<GlowShape, Texture>()

function glowTexture(shape: GlowShape): Texture {
  const cached = textures.get(shape)
  if (cached) {
    return cached
  }
  const texture = makeGlowTexture(shape)
  textures.set(shape, texture)
  return texture
}

/**
 * A random walk in -1..1. A fresh target is drawn `rate` times a second and
 * eased into, so what comes out shivers rather than flickering at random —
 * white noise at these amplitudes just reads as a blur.
 */
class Tremble {
  private from = 0
  private to = Math.random() * 2 - 1
  private phase = 0

  next(dt: number, rate: number): number {
    this.phase += dt * Math.max(rate, 0)
    while (this.phase >= 1) {
      this.phase -= 1
      this.from = this.to
      this.to = Math.random() * 2 - 1
    }
    const t = this.phase * this.phase * (3 - 2 * this.phase)
    return this.from + (this.to - this.from) * t
  }
}

export class GlowFlash {
  private readonly sprite: Sprite
  private burst = 0
  private sustain = 0
  // Kept so the release still has somewhere to fade out, after the note that
  // was driving it has already ended.
  private lastX = 0
  private lastY = 0
  private lastHeight = 24
  // One walk each, so the shake does not simply track the brightness.
  private readonly flicker = new Tremble()
  private readonly shakeX = new Tremble()
  private readonly shakeY = new Tremble()

  constructor(layer: Container) {
    this.sprite = new Sprite(glowTexture("bloom"))
    this.sprite.anchor.set(0.5)
    this.sprite.blendMode = "add"
    this.sprite.visible = false
    layer.addChild(this.sprite)
  }

  /** True while there is still brightness left to release. */
  get active(): boolean {
    return this.sustain + this.burst >= CUTOFF
  }

  /** Strike — call when a new note starts sounding. */
  flash(): void {
    this.burst = 1
  }

  update(
    dt: number,
    at: { x: number; y: number; spread: number } | null,
    params: GlowParams,
  ): void {
    this.burst *= Math.exp(-dt / Math.max(params.flash, 0.001))
    this.sustain += ((at ? params.level : 0) - this.sustain) * (1 - Math.exp(-dt / SUSTAIN_TAU))

    if (at) {
      this.lastX = at.x
      this.lastY = at.y
      this.lastHeight = at.spread
    }

    // The walks are stepped whether or not they are used, so turning jitter up
    // mid-note starts from wherever the shiver would have been by now.
    const tremor = Math.max(params.jitter, 0)
    const flicker = 1 + tremor * JITTER_DEPTH * this.flicker.next(dt, params.jitterRate)
    const shakeX = tremor * JITTER_SHAKE * this.shakeX.next(dt, params.jitterRate)
    const shakeY = tremor * JITTER_SHAKE * this.shakeY.next(dt, params.jitterRate)

    // Jitter rides on the envelopes rather than adding to them, so the release
    // still takes the shiver down with it.
    const intensity = (this.sustain + this.burst) * flicker
    if (intensity < CUTOFF) {
      this.sprite.visible = false
      return
    }

    this.sprite.visible = true
    // The image is what the light is made of, so it replaces the shape rather
    // than being tinted by it — until it has loaded, or if it never does.
    const image = params.source === "image" ? assetTexture(params.asset) : null
    const texture = image ?? glowTexture(params.shape)
    if (this.sprite.texture !== texture) {
      this.sprite.texture = texture
    }
    this.sprite.blendMode = image ? params.blend : "add"
    this.sprite.tint = image ? 0xffffff : params.color
    this.sprite.position.set(
      this.lastX + shakeX * this.lastHeight,
      this.lastY + shakeY * this.lastHeight,
    )
    this.sprite.alpha = Math.min(intensity, 1)
    // Swelling with brightness sells the strike more than brightness alone.
    const radius = this.lastHeight * params.size * (0.7 + 0.5 * Math.min(intensity, 1.5))
    this.sprite.scale.set((radius * 2) / this.sprite.texture.width)
  }

  /** Follow the note set into a new note read's coordinate frame. */
  rebase(from: CoordinateFrame, to: CoordinateFrame): void {
    const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
    this.lastX = to.contentX + (this.lastX - from.contentX) * scaleX
    this.lastY += to.refY - from.refY
  }

  dispose(): void {
    this.sprite.destroy()
  }
}
