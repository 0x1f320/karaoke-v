// Persisted user preferences. The main process owns the values and the
// defaults; the renderer only ever imports the type.

/**
 * Which way sparks fly.
 *
 * - `directional` — all of them along `angle`, fanned out sideways by spreadX.
 * - `radial` — outwards in every direction, spreadX/spreadY as the radii.
 */
export type ParticleDirection = "directional" | "radial"

export const PARTICLE_DIRECTIONS: readonly ParticleDirection[] = ["directional", "radial"]

/** Sparks thrown off where the playhead crosses a note. */
export type ParticlePreferences = {
  enabled: boolean
  /** Sparks emitted per second while a note sounds. */
  rate: number
  /** How long one spark lasts, seconds. */
  life: number
  direction: ParticleDirection
  /** Where `directional` throws them, degrees clockwise from straight up. */
  angle: number
  /**
   * Sideways reach over a life, px — perpendicular to `angle` when directional,
   * the horizontal radius when radial.
   */
  spreadX: number
  /** Reach along `angle` over a life, px; the vertical radius when radial. */
  spreadY: number
  /** Width of the band sparks are born along, px. 0 emits from a bare line. */
  originX: number
  /** "#rrggbb". */
  color: string
}

/**
 * What the light throws off. Every shape sits on the same round bloom; the rays
 * are laid over it rather than replacing it.
 *
 * - `bloom` — the bed alone.
 * - `cross` — four rays, upright.
 * - `x` — four rays, diagonal.
 * - `star` — both, the diagonals shorter.
 */
export type GlowShape = "bloom" | "cross" | "x" | "star"

export const GLOW_SHAPES: readonly GlowShape[] = ["bloom", "cross", "x", "star"]

/** The bloom riding on the playhead, struck anew at every note onset. */
export type GlowPreferences = {
  enabled: boolean
  shape: GlowShape
  /** Brightness held while a note sounds, 0..1. Zero turns it off. */
  level: number
  /** How long the onset spike takes to fade, seconds. */
  flash: number
  /** Radius as a multiple of the note's height. */
  size: number
  /**
   * How hard the light trembles while a note sounds, 0..1 — the onset flash
   * carried on as a shiver instead of a single strike. Zero holds it steady.
   */
  jitter: number
  /** How often the tremble picks a new value, per second. */
  jitterRate: number
  /** "#rrggbb". */
  color: string
}

/** The pair of groups that make up one look. Everything a preset carries. */
export type EffectSettings = {
  particles: ParticlePreferences
  glow: GlowPreferences
}

/** A named copy of the effect settings, saved by the user. */
export type EffectPreset = EffectSettings & {
  /** Stable identity: the name is the user's to change, this is not. */
  id: string
  name: string
}

export type Preferences = {
  /** Draw note bounding boxes on the overlay. */
  debug: boolean
  particles: ParticlePreferences
  glow: GlowPreferences
  /** User-saved looks, in the order they appear in the picker. */
  presets: EffectPreset[]
  /**
   * Which preset the effect settings were last loaded from, or null for the
   * built-in defaults. Not the same question as "which preset do the values
   * equal": editing after loading one leaves the values matching nothing, and
   * this is what still says where they came from — so 저장 knows what to
   * overwrite and 되돌리기 knows what to go back to.
   */
  activePreset: string | null
}

export const DEFAULT_PREFERENCES: Preferences = {
  debug: false,
  particles: {
    enabled: true,
    rate: 90,
    life: 0.65,
    direction: "directional",
    angle: 0,
    spreadX: 30,
    spreadY: 70,
    originX: 8,
    color: "#ffd27a",
  },
  glow: {
    enabled: true,
    shape: "bloom",
    level: 0.5,
    flash: 0.11,
    size: 2.2,
    jitter: 0.35,
    jitterRate: 12,
    color: "#ff78c8",
  },
  presets: [],
  activePreset: null,
}

/** What the preset picker offers before any preset exists. */
export const DEFAULT_EFFECTS: EffectSettings = {
  particles: DEFAULT_PREFERENCES.particles,
  glow: DEFAULT_PREFERENCES.glow,
}

/** Ceilings on the preset list, so a corrupt file cannot grow unbounded. */
export const PRESET_LIMITS = { count: 100, nameLength: 60 } as const

/** Same look, field by field. Every preference in a group is a flat scalar. */
export function sameEffects(a: EffectSettings, b: EffectSettings): boolean {
  const same = <T extends object>(x: T, y: T) =>
    (Object.keys(x) as (keyof T)[]).every((key) => x[key] === y[key])
  return same(a.particles, b.particles) && same(a.glow, b.glow)
}

/** Ranges the settings UI offers, and the bounds sanitizing clamps to. */
export const PARTICLE_LIMITS = {
  rate: { min: 0, max: 300, step: 5 },
  life: { min: 0.1, max: 2, step: 0.05 },
  // 355 rather than 360, so the top of the range is not a second way to say 0.
  angle: { min: 0, max: 355, step: 5 },
  spreadX: { min: 0, max: 200, step: 5 },
  spreadY: { min: 0, max: 300, step: 5 },
  originX: { min: 0, max: 200, step: 2 },
} as const

export const GLOW_LIMITS = {
  level: { min: 0, max: 1, step: 0.05 },
  flash: { min: 0.02, max: 0.5, step: 0.01 },
  size: { min: 0.5, max: 5, step: 0.1 },
  jitter: { min: 0, max: 1, step: 0.05 },
  jitterRate: { min: 2, max: 30, step: 1 },
} as const

/** A partial update. Nested groups may be partial too — one slider at a time. */
export type PreferencesPatch = {
  debug?: boolean
  particles?: Partial<ParticlePreferences>
  glow?: Partial<GlowPreferences>
  /** The whole list, always: adding, renaming and deleting all rewrite it. */
  presets?: EffectPreset[]
  /** null is a value here, not an absence — it names the built-in defaults. */
  activePreset?: string | null
}

/**
 * Apply a patch. Groups merge into the base rather than replacing it, so
 * changing one slider cannot quietly reset the ones beside it. The preset list
 * is the exception — it is a list, and a partial one has no meaning.
 */
export function mergePreferences(base: Preferences, patch: PreferencesPatch): Preferences {
  const next: Preferences = {
    debug: patch.debug ?? base.debug,
    particles: { ...base.particles, ...patch.particles },
    glow: { ...base.glow, ...patch.glow },
    presets: patch.presets ?? base.presets,
    // Not ??: null is the defaults, and only an absent key means "leave it".
    activePreset: patch.activePreset !== undefined ? patch.activePreset : base.activePreset,
  }
  // Enforced here rather than at each call site, so deleting a preset cannot
  // leave the pointer dangling however the deletion was expressed: an id naming
  // nothing would give 저장 no target and 되돌리기 nowhere to go.
  if (next.activePreset !== null && !next.presets.some((p) => p.id === next.activePreset)) {
    next.activePreset = null
  }
  return next
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

function sanitizeParticles(input: unknown): Partial<ParticlePreferences> | undefined {
  const clean = sanitizeGroup(input, PARTICLE_LIMITS)
  if (!clean) {
    return undefined
  }
  const direction = (input as Record<string, unknown>).direction
  return PARTICLE_DIRECTIONS.includes(direction as ParticleDirection)
    ? { ...clean, direction: direction as ParticleDirection }
    : clean
}

function sanitizeGlow(input: unknown): Partial<GlowPreferences> | undefined {
  const clean = sanitizeGroup(input, GLOW_LIMITS)
  if (!clean) {
    return undefined
  }
  const shape = (input as Record<string, unknown>).shape
  return GLOW_SHAPES.includes(shape as GlowShape) ? { ...clean, shape: shape as GlowShape } : clean
}

/**
 * A preset must be whole — it is applied as a complete look, so anything the
 * stored entry is missing or got wrong falls back to the default rather than to
 * whatever happens to be in effect when it is picked.
 */
function sanitizePresets(input: unknown): EffectPreset[] | undefined {
  if (!Array.isArray(input)) {
    return undefined
  }
  const out: EffectPreset[] = []
  for (const entry of input.slice(0, PRESET_LIMITS.count)) {
    if (typeof entry !== "object" || entry === null) {
      continue
    }
    const { id, name, particles, glow } = entry as Record<string, unknown>
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) {
      continue
    }
    out.push({
      id,
      name: name.trim().slice(0, PRESET_LIMITS.nameLength),
      particles: { ...DEFAULT_EFFECTS.particles, ...sanitizeParticles(particles) },
      glow: { ...DEFAULT_EFFECTS.glow, ...sanitizeGlow(glow) },
    })
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
  const { debug, particles, glow, presets, activePreset } = input as Record<string, unknown>
  if (typeof debug === "boolean") {
    out.debug = debug
  }
  if (typeof activePreset === "string" || activePreset === null) {
    out.activePreset = activePreset
  }
  const cleanPresets = sanitizePresets(presets)
  if (cleanPresets) {
    out.presets = cleanPresets
  }
  const cleanParticles = sanitizeParticles(particles)
  if (cleanParticles) {
    out.particles = cleanParticles
  }
  const cleanGlow = sanitizeGlow(glow)
  if (cleanGlow) {
    out.glow = cleanGlow
  }
  return out
}
