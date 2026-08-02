import { type Container, Sprite, Texture } from "pixi.js"

// The bloom sitting on the playhead where it crosses a note.
//
// Two envelopes drive one sprite: a burst that spikes at each note onset and
// decays fast, and a sustain that holds while the note sounds and releases when
// it stops. Their sum is the brightness — which is what makes an onset read as a
// strike rather than a light being switched on.

/** Time constant of the sustain rising and releasing, seconds. */
const SUSTAIN_TAU = 0.16
/** Below this the sprite is not worth drawing. */
const CUTOFF = 0.01

export interface GlowParams {
  enabled: boolean
  /** 0xRRGGBB. */
  color: number
  /** Brightness held while a note sounds, 0..1. */
  level: number
  /** Time constant of the onset spike, seconds. */
  flash: number
  /** Radius at unit brightness, as a multiple of the note's height. */
  size: number
}

interface CoordinateFrame {
  contentX: number
  contentW: number
  refY: number
}

/** A soft radial falloff. A gradient reads far better than stacked circles at this size. */
function makeGlowTexture(size = 256): Texture {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return Texture.WHITE
  }
  const r = size / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(0.2, "rgba(255,255,255,0.6)")
  gradient.addColorStop(0.5, "rgba(255,255,255,0.16)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
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

  constructor(layer: Container) {
    this.sprite = new Sprite(makeGlowTexture())
    this.sprite.anchor.set(0.5)
    this.sprite.blendMode = "add"
    this.sprite.visible = false
    layer.addChild(this.sprite)
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

    const intensity = this.sustain + this.burst
    if (intensity < CUTOFF) {
      this.sprite.visible = false
      return
    }

    this.sprite.visible = true
    this.sprite.tint = params.color
    this.sprite.position.set(this.lastX, this.lastY)
    this.sprite.alpha = Math.min(intensity, 1)
    // Swelling with brightness sells the strike more than brightness alone.
    const radius = this.lastHeight * params.size * (0.7 + 0.5 * Math.min(intensity, 1.5))
    this.sprite.scale.set((radius * 2) / this.sprite.texture.width)
  }

  /** Follow the note set into a new AX read's coordinate frame. */
  rebase(from: CoordinateFrame, to: CoordinateFrame): void {
    const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
    this.lastX = to.contentX + (this.lastX - from.contentX) * scaleX
    this.lastY += to.refY - from.refY
  }

  dispose(): void {
    this.sprite.destroy()
  }
}
