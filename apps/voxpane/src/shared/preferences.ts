import { isAssetName } from "./assets"
import { isLanguagePreference, type LanguagePreference } from "./language"

// Persisted user preferences. The main process owns the values and the
// defaults; the renderer only ever imports the type.

/**
 * What an effect draws.
 *
 * - `color` — the built-in shape or spark, painted in `color`.
 * - `image` — a picture the user imported, drawn as it is.
 */
export type EffectSource = "color" | "image"

export const EFFECT_SOURCES: readonly EffectSource[] = ["color", "image"]

/**
 * How an effect's sprite meets what is behind it. Additive is what reads as
 * light, and what every built-in shape is drawn for; an opaque picture washes
 * out under it, so an imported one usually wants `normal`.
 */
export type EffectBlend = "add" | "normal"

export const EFFECT_BLENDS: readonly EffectBlend[] = ["add", "normal"]

/** What either effect carries about the picture it may be drawing. */
export type EffectImage = {
  source: EffectSource
  /**
   * The imported file's stored name, or null when nothing has been picked. An
   * `image` source whose asset is missing falls back to the built-in look —
   * a preset shared between machines names a file this one may not have.
   */
  asset: string | null
  blend: EffectBlend
}

/**
 * Which way sparks fly.
 *
 * - `directional` — all of them along `angle`, fanned out sideways by spreadX.
 * - `radial` — outwards in every direction, spreadX/spreadY as the radii.
 */
export type ParticleDirection = "directional" | "radial"

export const PARTICLE_DIRECTIONS: readonly ParticleDirection[] = ["directional", "radial"]

/** Sparks thrown off where the playhead crosses a note. */
export type ParticlePreferences = EffectImage & {
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
  /** How big one spark is drawn, as a multiple of its natural size. */
  size: number
  /**
   * How far a spark turns over its whole life, degrees. Which way round is
   * decided per spark, so a spray does not rotate as one piece.
   */
  spin: number
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
export type GlowPreferences = EffectImage & {
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

/**
 * The line the voice leaves behind it: the sung curve, whether or not the other
 * effects follow the pitch — drawing the notes' centres instead would make the
 * line say something the voice never did.
 */
export type TrailPreferences = {
  enabled: boolean
  /** How long a stretch of the line takes to fade out, seconds. */
  life: number
  /** Thickness of the bright core, px. */
  width: number
  /** How far the halo spreads past the core, as a multiple of the width. */
  bloom: number
  /** Sparkles left along the line per second. Zero draws the line alone. */
  sparkle: number
  /** "#rrggbb". */
  color: string
}

/**
 * What the sung pitch is allowed to drive.
 *
 * - `position` — the effect rides the pitch line instead of the note's centre.
 * - `intensity` — glow and sparks swell where the voice moves.
 * - `both` — at once.
 */
export type PitchMode = "position" | "intensity" | "both"

export const PITCH_MODES: readonly PitchMode[] = ["position", "intensity", "both"]

/** Effects following the voice inside the note rather than the note itself. */
export type PitchPreferences = {
  enabled: boolean
  mode: PitchMode
  /**
   * How far the effect may leave the note, in semitones.
   *
   * This is a guard and not a taste knob, which is what sets where it sits.
   * Measured against a sung project, the drawn curve dives past an octave at
   * consonant boundaries — the engine renders those excursions and so they are
   * part of the line the effect is asked to follow — while the failure this
   * exists to catch, an unvoiced frame read as a pitch of zero, lands around
   * seventy semitones. Two octaves sits between the two with room to spare, and
   * costs nothing where the voice stays put: the reach is the curve's own span,
   * so this only ever caps it.
   */
  range: number
  /** How hard pitch movement drives intensity. Zero holds it level. */
  sensitivity: number
}

/** The groups that make up one look. Everything a preset carries. */
export type EffectSettings = {
  particles: ParticlePreferences
  glow: GlowPreferences
  trail: TrailPreferences
  pitch: PitchPreferences
}

/** A named copy of the effect settings, saved by the user. */
export type EffectPreset = EffectSettings & {
  /** Stable identity: the name is the user's to change, this is not. */
  id: string
  name: string
}

export type Preferences = {
  /** Which language the UI speaks; "system" follows the OS. */
  language: LanguagePreference
  /** Draw note bounding boxes on the overlay. */
  debug: boolean
  /**
   * Master switch for the note effects, owned by the toolbar. Off silences
   * every group whatever its own `enabled` says — those stay as the user left
   * them, so flipping this back on restores the same look.
   */
  effects: boolean
  audioMeter: boolean
  particles: ParticlePreferences
  glow: GlowPreferences
  trail: TrailPreferences
  pitch: PitchPreferences
  /**
   * Which effect groups the settings window has open, by group name. Kept as
   * the open ones rather than the closed ones, so a group added later starts
   * folded away like every other one the user has not opened.
   */
  openGroups: string[]
  /** User-saved looks, in the order they appear in the picker. */
  presets: EffectPreset[]
  /**
   * Which preset the effect settings were last loaded from, or null for the
   * built-in defaults. Not the same question as "which preset do the values
   * equal": editing after loading one leaves the values matching nothing, and
   * this is what still says where they came from — so saving knows what to
   * overwrite and reverting knows what to go back to.
   */
  activePreset: string | null
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "system",
  debug: false,
  effects: true,
  audioMeter: false,
  particles: {
    enabled: true,
    rate: 90,
    life: 0.65,
    direction: "directional",
    angle: 0,
    spreadX: 30,
    spreadY: 70,
    originX: 8,
    size: 1,
    spin: 180,
    color: "#ffd27a",
    source: "color",
    asset: null,
    blend: "add",
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
    source: "color",
    asset: null,
    blend: "add",
  },
  trail: {
    enabled: true,
    life: 1.6,
    width: 3,
    bloom: 3,
    sparkle: 24,
    color: "#ffd27a",
  },
  pitch: {
    enabled: false,
    mode: "both",
    range: 24,
    sensitivity: 0.12,
  },
  openGroups: [],
  presets: [],
  activePreset: null,
}

/** What the preset picker offers before any preset exists. */
export const DEFAULT_EFFECTS: EffectSettings = {
  particles: DEFAULT_PREFERENCES.particles,
  glow: DEFAULT_PREFERENCES.glow,
  trail: DEFAULT_PREFERENCES.trail,
  pitch: DEFAULT_PREFERENCES.pitch,
}

/** Ceiling on the stored open groups, so a corrupt file cannot grow unbounded. */
const OPEN_GROUP_LIMITS = { count: 32, nameLength: 40 } as const

/** Ceilings on the preset list, so a corrupt file cannot grow unbounded. */
export const PRESET_LIMITS = { count: 100, nameLength: 60 } as const

/** Same look, field by field. Every preference in a group is a flat scalar. */
export function sameEffects(a: EffectSettings, b: EffectSettings): boolean {
  const same = <T extends object>(x: T, y: T) =>
    (Object.keys(x) as (keyof T)[]).every((key) => x[key] === y[key])
  return (
    same(a.particles, b.particles) &&
    same(a.glow, b.glow) &&
    same(a.trail, b.trail) &&
    same(a.pitch, b.pitch)
  )
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
  size: { min: 0.25, max: 12, step: 0.25 },
  spin: { min: 0, max: 1080, step: 15 },
} as const

export const GLOW_LIMITS = {
  level: { min: 0, max: 1, step: 0.05 },
  flash: { min: 0.02, max: 0.5, step: 0.01 },
  size: { min: 0.5, max: 5, step: 0.1 },
  jitter: { min: 0, max: 1, step: 0.05 },
  jitterRate: { min: 2, max: 30, step: 1 },
} as const

export const TRAIL_LIMITS = {
  life: { min: 0.2, max: 6, step: 0.1 },
  width: { min: 1, max: 16, step: 0.5 },
  bloom: { min: 1, max: 8, step: 0.5 },
  sparkle: { min: 0, max: 120, step: 2 },
} as const

export const PITCH_LIMITS = {
  range: { min: 0.5, max: 24, step: 0.5 },
  sensitivity: { min: 0, max: 0.5, step: 0.01 },
} as const

/** A partial update. Nested groups may be partial too — one slider at a time. */
export type PreferencesPatch = {
  language?: LanguagePreference
  debug?: boolean
  effects?: boolean
  audioMeter?: boolean
  particles?: Partial<ParticlePreferences>
  glow?: Partial<GlowPreferences>
  trail?: Partial<TrailPreferences>
  pitch?: Partial<PitchPreferences>
  /** The whole list, always — a partial one would read as "close the rest". */
  openGroups?: string[]
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
    language: patch.language ?? base.language,
    debug: patch.debug ?? base.debug,
    effects: patch.effects ?? base.effects,
    audioMeter: patch.audioMeter ?? base.audioMeter,
    particles: { ...base.particles, ...patch.particles },
    glow: { ...base.glow, ...patch.glow },
    trail: { ...base.trail, ...patch.trail },
    pitch: { ...base.pitch, ...patch.pitch },
    openGroups: patch.openGroups ?? base.openGroups,
    presets: patch.presets ?? base.presets,
    // Not ??: null is the defaults, and only an absent key means "leave it".
    activePreset: patch.activePreset !== undefined ? patch.activePreset : base.activePreset,
  }
  // Enforced here rather than at each call site, so deleting a preset cannot
  // leave the pointer dangling however the deletion was expressed: an id naming
  // nothing would give saving no target and reverting nowhere to go.
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

type GroupExtras = { color?: string; enabled?: boolean } & Partial<EffectImage>

function sanitizeGroup<K extends string>(
  input: unknown,
  limits: Record<K, { min: number; max: number }>,
): (Partial<Record<K, number>> & GroupExtras) | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined
  }
  const group = input as Record<string, unknown>
  const out: Partial<Record<K, number>> & GroupExtras = clampAll(group, limits)
  if (typeof group.color === "string" && HEX_COLOR.test(group.color)) {
    out.color = group.color
  }
  if (typeof group.enabled === "boolean") {
    out.enabled = group.enabled
  }
  if (EFFECT_SOURCES.includes(group.source as EffectSource)) {
    out.source = group.source as EffectSource
  }
  if (EFFECT_BLENDS.includes(group.blend as EffectBlend)) {
    out.blend = group.blend as EffectBlend
  }
  // A name that is not one we could have written names no file of ours, so it
  // is the same answer as none: the effect draws its built-in look.
  if (group.asset === null || isAssetName(group.asset)) {
    out.asset = group.asset as string | null
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

function sanitizePitch(input: unknown): Partial<PitchPreferences> | undefined {
  const clean = sanitizeGroup(input, PITCH_LIMITS)
  if (!clean) {
    return undefined
  }
  const mode = (input as Record<string, unknown>).mode
  return PITCH_MODES.includes(mode as PitchMode) ? { ...clean, mode: mode as PitchMode } : clean
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
    const { id, name, particles, glow, trail, pitch } = entry as Record<string, unknown>
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) {
      continue
    }
    out.push({
      id,
      name: name.trim().slice(0, PRESET_LIMITS.nameLength),
      particles: { ...DEFAULT_EFFECTS.particles, ...sanitizeParticles(particles) },
      glow: { ...DEFAULT_EFFECTS.glow, ...sanitizeGlow(glow) },
      trail: { ...DEFAULT_EFFECTS.trail, ...sanitizeGroup(trail, TRAIL_LIMITS) },
      pitch: { ...DEFAULT_EFFECTS.pitch, ...sanitizePitch(pitch) },
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
  const {
    language,
    debug,
    effects,
    audioMeter,
    particles,
    glow,
    trail,
    pitch,
    openGroups,
    presets,
    activePreset,
  } = input as Record<string, unknown>
  if (isLanguagePreference(language)) {
    out.language = language
  }
  if (typeof debug === "boolean") {
    out.debug = debug
  }
  if (typeof effects === "boolean") {
    out.effects = effects
  }
  if (typeof audioMeter === "boolean") {
    out.audioMeter = audioMeter
  }
  if (typeof activePreset === "string" || activePreset === null) {
    out.activePreset = activePreset
  }
  if (Array.isArray(openGroups)) {
    out.openGroups = openGroups
      .filter((name): name is string => typeof name === "string")
      .slice(0, OPEN_GROUP_LIMITS.count)
      .map((name) => name.slice(0, OPEN_GROUP_LIMITS.nameLength))
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
  const cleanTrail = sanitizeGroup(trail, TRAIL_LIMITS)
  if (cleanTrail) {
    out.trail = cleanTrail
  }
  const cleanPitch = sanitizePitch(pitch)
  if (cleanPitch) {
    out.pitch = cleanPitch
  }
  return out
}
