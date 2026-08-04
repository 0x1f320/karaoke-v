import type {
  GlowPreferences,
  ParticlePreferences,
  TrailPreferences,
} from "../../../shared/preferences"
import type { GlowParams } from "./glow"
import type { Rgba } from "./noteRenderer"
import type { ParticleParams } from "./particles"
import type { TrailParams } from "./trail"

// Shared by the overlay and the settings preview, so what the preview shows is
// what the overlay draws.

export const FILL: Rgba = [80 / 255, 180 / 255, 255 / 255, 0.25]
export const STROKE: Rgba = [120 / 255, 210 / 255, 255 / 255, 0.9]
export const BORDER_PX = 1
export const PLAYING_FILL: Rgba = [255 / 255, 235 / 255, 130 / 255, 0.55]
/**
 * The band the effect can reach inside its note. Much fainter than the debug
 * note box it borrows its colour from: that box is one lane, while this one
 * stands as tall as the reach — a whole octave of it at 0.55 would be a wall
 * across the piano roll rather than a hint about one note.
 */
export const REACH_FILL: Rgba = [255 / 255, 235 / 255, 130 / 255, 0.12]
/** Its edge, where the reach actually ends — the fill alone is too faint to find. */
export const REACH_STROKE: Rgba = [255 / 255, 235 / 255, 130 / 255, 0.38]
/**
 * Slack drawn around the reach, px. A lane's worth, so the band reads as a box
 * around the note rather than as a second edge sitting on top of the note's own.
 */
export const REACH_PAD_PX = 24

/** "#rrggbb" as the 0xRRGGBB int Pixi tints with. */
export function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16) || 0
}

export function particleParams(prefs: ParticlePreferences): ParticleParams {
  return {
    enabled: prefs.enabled,
    rate: prefs.rate,
    life: prefs.life,
    direction: prefs.direction,
    angle: prefs.angle,
    spreadX: prefs.spreadX,
    spreadY: prefs.spreadY,
    originX: prefs.originX,
    size: prefs.size,
    spin: prefs.spin,
    color: hexToInt(prefs.color),
    source: prefs.source,
    asset: prefs.asset,
    blend: prefs.blend,
  }
}

export function glowParams(prefs: GlowPreferences): GlowParams {
  return {
    enabled: prefs.enabled,
    shape: prefs.shape,
    level: prefs.level,
    flash: prefs.flash,
    size: prefs.size,
    jitter: prefs.jitter,
    jitterRate: prefs.jitterRate,
    color: hexToInt(prefs.color),
    source: prefs.source,
    asset: prefs.asset,
    blend: prefs.blend,
  }
}

export function trailParams(prefs: TrailPreferences): TrailParams {
  return {
    enabled: prefs.enabled,
    life: prefs.life,
    width: prefs.width,
    bloom: prefs.bloom,
    sparkle: prefs.sparkle,
    color: hexToInt(prefs.color),
  }
}
