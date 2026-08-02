// Persisted user preferences. The main process owns the values and the
// defaults; the renderer only ever imports the type.

/** Sparks thrown off where the playhead crosses a note. */
export type ParticlePreferences = {
  enabled: boolean
  /** Sparks emitted per second while a note sounds. */
  rate: number
  /** How long one spark lasts, seconds. */
  life: number
  /** Roughly how far a spark travels sideways over its life, px. */
  spreadX: number
  /** Roughly how far a spark rises over its life, px. */
  spreadY: number
  /** Width of the band sparks are born along, px. 0 emits from a bare line. */
  originX: number
  /** "#rrggbb". */
  color: string
}

/** The bloom riding on the playhead, struck anew at every note onset. */
export type GlowPreferences = {
  enabled: boolean
  /** Brightness held while a note sounds, 0..1. Zero turns it off. */
  level: number
  /** How long the onset spike takes to fade, seconds. */
  flash: number
  /** Radius as a multiple of the note's height. */
  size: number
  /** "#rrggbb". */
  color: string
}

export type Preferences = {
  /** Draw note bounding boxes on the overlay. */
  debug: boolean
  particles: ParticlePreferences
  glow: GlowPreferences
}

export const DEFAULT_PREFERENCES: Preferences = {
  debug: false,
  particles: {
    enabled: true,
    rate: 90,
    life: 0.65,
    spreadX: 30,
    spreadY: 70,
    originX: 8,
    color: "#ffd27a",
  },
  glow: {
    enabled: true,
    level: 0.5,
    flash: 0.11,
    size: 2.2,
    color: "#ff78c8",
  },
}

/** Ranges the settings UI offers, and the bounds sanitizing clamps to. */
export const PARTICLE_LIMITS = {
  rate: { min: 0, max: 300, step: 5 },
  life: { min: 0.1, max: 2, step: 0.05 },
  spreadX: { min: 0, max: 200, step: 5 },
  spreadY: { min: 0, max: 300, step: 5 },
  originX: { min: 0, max: 200, step: 2 },
} as const

export const GLOW_LIMITS = {
  level: { min: 0, max: 1, step: 0.05 },
  flash: { min: 0.02, max: 0.5, step: 0.01 },
  size: { min: 0.5, max: 5, step: 0.1 },
} as const

/** A partial update. Nested groups may be partial too — one slider at a time. */
export type PreferencesPatch = {
  debug?: boolean
  particles?: Partial<ParticlePreferences>
  glow?: Partial<GlowPreferences>
}

/**
 * Apply a patch. Groups merge into the base rather than replacing it, so
 * changing one slider cannot quietly reset the ones beside it.
 */
export function mergePreferences(base: Preferences, patch: PreferencesPatch): Preferences {
  return {
    debug: patch.debug ?? base.debug,
    particles: { ...base.particles, ...patch.particles },
    glow: { ...base.glow, ...patch.glow },
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function clamp(value: unknown, limits: { min: number; max: number }): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(Math.max(value, limits.min), limits.max)
}

/** Keep the numbers named by `limits`, clamped; drop everything else. */
function clampAll<K extends string>(
  source: Record<string, unknown>,
  limits: Record<K, { min: number; max: number }>,
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {}
  for (const key of Object.keys(limits) as K[]) {
    const value = clamp(source[key], limits[key])
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

function sanitizeGroup<K extends string>(
  input: unknown,
  limits: Record<K, { min: number; max: number }>,
): (Partial<Record<K, number>> & { color?: string; enabled?: boolean }) | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined
  }
  const source = input as Record<string, unknown>
  const out: Partial<Record<K, number>> & { color?: string; enabled?: boolean } = clampAll(
    source,
    limits,
  )
  if (typeof source.color === "string" && HEX_COLOR.test(source.color)) {
    out.color = source.color
  }
  if (typeof source.enabled === "boolean") {
    out.enabled = source.enabled
  }
  return out
}

// Preferences come from a file on disk and from IPC, so neither shape is
// trusted: keep the known keys that carry the right type, drop the rest.
export function sanitizePreferences(input: unknown): PreferencesPatch {
  const out: PreferencesPatch = {}
  if (typeof input !== "object" || input === null) {
    return out
  }
  const { debug, particles, glow } = input as Record<string, unknown>
  if (typeof debug === "boolean") {
    out.debug = debug
  }
  const cleanParticles = sanitizeGroup(particles, PARTICLE_LIMITS)
  if (cleanParticles) {
    out.particles = cleanParticles
  }
  const cleanGlow = sanitizeGroup(glow, GLOW_LIMITS)
  if (cleanGlow) {
    out.glow = cleanGlow
  }
  return out
}
