import type { GlowPreferences, ParticlePreferences } from "../../../shared/preferences"
import type { GlowParams } from "./glow"
import type { Rgba } from "./noteRenderer"
import type { ParticleParams } from "./particles"

// Shared by the overlay and the settings preview, so what the preview shows is
// what the overlay draws.

export const FILL: Rgba = [80 / 255, 180 / 255, 255 / 255, 0.25]
export const STROKE: Rgba = [120 / 255, 210 / 255, 255 / 255, 0.9]
export const BORDER_PX = 1
export const PLAYING_FILL: Rgba = [255 / 255, 235 / 255, 130 / 255, 0.55]

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
    color: hexToInt(prefs.color),
  }
}

export function glowParams(prefs: GlowPreferences): GlowParams {
  return {
    enabled: prefs.enabled,
    level: prefs.level,
    flash: prefs.flash,
    size: prefs.size,
    jitter: prefs.jitter,
    jitterRate: prefs.jitterRate,
    color: hexToInt(prefs.color),
  }
}
