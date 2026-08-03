import { describe, expect, it } from "vitest"
import {
  DEFAULT_EFFECTS,
  DEFAULT_PREFERENCES,
  type EffectPreset,
  GLOW_LIMITS,
  mergePreferences,
  PARTICLE_LIMITS,
  PRESET_LIMITS,
  sameEffects,
  sanitizePreferences,
} from "../src/shared/preferences"

function preset(id: string, name = id): EffectPreset {
  return { id, name, ...DEFAULT_EFFECTS }
}

describe("mergePreferences", () => {
  it("merges a group instead of replacing it", () => {
    const next = mergePreferences(DEFAULT_PREFERENCES, { particles: { rate: 10 } })
    expect(next.particles).toEqual({ ...DEFAULT_PREFERENCES.particles, rate: 10 })
    expect(next.glow).toEqual(DEFAULT_PREFERENCES.glow)
  })

  it("leaves the base untouched", () => {
    const base = { ...DEFAULT_PREFERENCES }
    mergePreferences(base, { debug: true, glow: { level: 0.1 } })
    expect(base).toEqual(DEFAULT_PREFERENCES)
  })

  it("replaces the preset list wholesale", () => {
    const base = { ...DEFAULT_PREFERENCES, presets: [preset("a"), preset("b")] }
    expect(mergePreferences(base, { presets: [preset("b")] }).presets).toEqual([preset("b")])
    expect(mergePreferences(base, {}).presets).toEqual(base.presets)
  })

  it("treats activePreset null as a value and undefined as an absence", () => {
    const base = { ...DEFAULT_PREFERENCES, presets: [preset("a")], activePreset: "a" }
    expect(mergePreferences(base, { activePreset: null }).activePreset).toBeNull()
    expect(mergePreferences(base, {}).activePreset).toBe("a")
    expect(mergePreferences(base, { activePreset: undefined }).activePreset).toBe("a")
  })

  it("resets activePreset when it names no preset in the resulting list", () => {
    const base = { ...DEFAULT_PREFERENCES, presets: [preset("a")], activePreset: "a" }
    expect(mergePreferences(base, { presets: [] }).activePreset).toBeNull()
    expect(mergePreferences(base, { activePreset: "ghost" }).activePreset).toBeNull()
    expect(mergePreferences(base, { presets: [preset("a"), preset("b")] }).activePreset).toBe("a")
  })

  it("accepts a preset that arrives in the same patch as the pointer to it", () => {
    const next = mergePreferences(DEFAULT_PREFERENCES, {
      presets: [preset("new")],
      activePreset: "new",
    })
    expect(next.activePreset).toBe("new")
  })

  it("keeps booleans that are explicitly false", () => {
    const base = { ...DEFAULT_PREFERENCES, debug: true, effects: true }
    expect(mergePreferences(base, { debug: false, effects: false })).toMatchObject({
      debug: false,
      effects: false,
    })
  })
})

describe("sameEffects", () => {
  it("compares every field of both groups", () => {
    expect(sameEffects(DEFAULT_EFFECTS, { ...DEFAULT_EFFECTS })).toBe(true)
    expect(
      sameEffects(DEFAULT_EFFECTS, {
        ...DEFAULT_EFFECTS,
        glow: { ...DEFAULT_EFFECTS.glow, level: 0.9 },
      }),
    ).toBe(false)
    expect(
      sameEffects(DEFAULT_EFFECTS, {
        ...DEFAULT_EFFECTS,
        particles: { ...DEFAULT_EFFECTS.particles, color: "#000000" },
      }),
    ).toBe(false)
  })
})

describe("sanitizePreferences", () => {
  it("returns an empty patch for a non-object", () => {
    for (const value of [null, undefined, 3, "x", true]) {
      expect(sanitizePreferences(value)).toEqual({})
    }
  })

  it("drops keys of the wrong type", () => {
    expect(sanitizePreferences({ debug: "yes", effects: 1, particles: 5, glow: null })).toEqual({})
  })

  it("keeps well-typed scalars", () => {
    expect(sanitizePreferences({ debug: true, effects: false })).toEqual({
      debug: true,
      effects: false,
    })
  })

  it("keeps activePreset as a string or null, but not otherwise", () => {
    expect(sanitizePreferences({ activePreset: "a" }).activePreset).toBe("a")
    expect(sanitizePreferences({ activePreset: null }).activePreset).toBeNull()
    expect(sanitizePreferences({ activePreset: 7 })).toEqual({})
  })

  it("clamps numbers into their limits and drops the unusable ones", () => {
    const patch = sanitizePreferences({
      particles: { rate: 10_000, life: -5, angle: Number.NaN, spreadX: "20", originX: 12 },
      glow: { level: 4, jitterRate: 0, size: Number.POSITIVE_INFINITY },
    })
    expect(patch.particles).toEqual({
      rate: PARTICLE_LIMITS.rate.max,
      life: PARTICLE_LIMITS.life.min,
      originX: 12,
    })
    expect(patch.glow).toEqual({
      level: GLOW_LIMITS.level.max,
      jitterRate: GLOW_LIMITS.jitterRate.min,
    })
  })

  it("keeps only #rrggbb colors", () => {
    expect(sanitizePreferences({ glow: { color: "#AbC123" } }).glow?.color).toBe("#AbC123")
    for (const color of ["#fff", "ffffff", "#gggggg", "#1234567", 0xffffff]) {
      expect(sanitizePreferences({ glow: { color } }).glow?.color).toBeUndefined()
    }
  })

  it("keeps only known enum values", () => {
    expect(sanitizePreferences({ particles: { direction: "radial" } }).particles?.direction).toBe(
      "radial",
    )
    expect(sanitizePreferences({ particles: { direction: "up" } }).particles?.direction).toBe(
      undefined,
    )
    expect(sanitizePreferences({ glow: { shape: "star" } }).glow?.shape).toBe("star")
    expect(sanitizePreferences({ glow: { shape: "blob" } }).glow?.shape).toBeUndefined()
  })

  it("fills a preset's gaps from the defaults rather than leaving it partial", () => {
    const [clean] = sanitizePreferences({
      presets: [{ id: "a", name: "  Neon  ", glow: { level: 0.25 } }],
    }).presets as EffectPreset[]
    expect(clean).toEqual({
      id: "a",
      name: "Neon",
      particles: DEFAULT_EFFECTS.particles,
      glow: { ...DEFAULT_EFFECTS.glow, level: 0.25 },
    })
  })

  it("skips presets without a usable id or name", () => {
    expect(
      sanitizePreferences({
        presets: [null, 5, { name: "no id" }, { id: "", name: "empty" }, { id: "b", name: "   " }],
      }).presets,
    ).toEqual([])
  })

  it("caps the list length and the name length", () => {
    const many = Array.from({ length: PRESET_LIMITS.count + 20 }, (_, i) => preset(`p${i}`))
    const long = { id: "x", name: "n".repeat(PRESET_LIMITS.nameLength + 40) }
    const patch = sanitizePreferences({ presets: [...many, long] })
    expect(patch.presets).toHaveLength(PRESET_LIMITS.count)
    expect(sanitizePreferences({ presets: [long] }).presets?.[0].name).toHaveLength(
      PRESET_LIMITS.nameLength,
    )
  })

  it("drops a presets value that is not an array", () => {
    expect(sanitizePreferences({ presets: { a: 1 } }).presets).toBeUndefined()
  })

  it("round-trips the defaults unchanged", () => {
    expect(mergePreferences(DEFAULT_PREFERENCES, sanitizePreferences(DEFAULT_PREFERENCES))).toEqual(
      DEFAULT_PREFERENCES,
    )
  })
})
