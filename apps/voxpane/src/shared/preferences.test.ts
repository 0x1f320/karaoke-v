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
  TRAIL_LIMITS,
} from "./preferences"

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

  it("carries the language through, and keeps it when the patch is silent", () => {
    expect(mergePreferences(DEFAULT_PREFERENCES, { language: "ja" }).language).toBe("ja")
    const base = { ...DEFAULT_PREFERENCES, language: "ko" as const }
    expect(mergePreferences(base, { debug: true }).language).toBe("ko")
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
    const base = { ...DEFAULT_PREFERENCES, debug: true, effects: true, audioMeter: true }
    expect(
      mergePreferences(base, { debug: false, effects: false, audioMeter: false }),
    ).toMatchObject({
      debug: false,
      effects: false,
      audioMeter: false,
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
    expect(sanitizePreferences({ debug: true, effects: false, audioMeter: true })).toEqual({
      debug: true,
      effects: false,
      audioMeter: true,
    })
  })

  it("keeps only a supported language", () => {
    expect(sanitizePreferences({ language: "ja" }).language).toBe("ja")
    expect(sanitizePreferences({ language: "system" }).language).toBe("system")
    expect(sanitizePreferences({ language: "fr" })).toEqual({})
    expect(sanitizePreferences({ language: "ko-KR" })).toEqual({})
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

  it("clamps the trail into its limits", () => {
    expect(sanitizePreferences({ trail: { life: 99, width: 0, sparkle: 30 } }).trail).toEqual({
      life: TRAIL_LIMITS.life.max,
      width: TRAIL_LIMITS.width.min,
      sparkle: 30,
    })
  })

  it("keeps the open groups as a list of names", () => {
    expect(sanitizePreferences({ openGroups: ["glow", 7, null, "trail"] }).openGroups).toEqual([
      "glow",
      "trail",
    ])
    expect(sanitizePreferences({ openGroups: "glow" }).openGroups).toBeUndefined()
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

  it("keeps only known source and blend values", () => {
    const patch = sanitizePreferences({
      glow: { source: "image", blend: "normal" },
      particles: { source: "sprite", blend: "screen" },
    })
    expect(patch.glow).toEqual({ source: "image", blend: "normal" })
    expect(patch.particles).toEqual({})
  })

  it("keeps an asset name we could have written, and nothing else", () => {
    const name = "0123456789abcdef.png"
    expect(sanitizePreferences({ glow: { asset: name } }).glow?.asset).toBe(name)
    expect(sanitizePreferences({ glow: { asset: null } }).glow?.asset).toBeNull()
    for (const asset of [
      "../escape.png",
      "0123456789abcdef.exe",
      "0123456789abcdeg.png",
      "0123456789abcdef",
      "/tmp/0123456789abcdef.png",
      7,
    ]) {
      expect(sanitizePreferences({ glow: { asset } }).glow?.asset).toBeUndefined()
    }
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
      trail: DEFAULT_EFFECTS.trail,
      pitch: DEFAULT_EFFECTS.pitch,
    })
  })

  it("carries an image-backed preset through a save and a reload", () => {
    const image = {
      source: "image" as const,
      asset: "0123456789abcdef.png",
      blend: "normal" as const,
    }
    const saved: EffectPreset = {
      id: "a",
      name: "Petals",
      particles: { ...DEFAULT_EFFECTS.particles, ...image, spin: 360 },
      glow: { ...DEFAULT_EFFECTS.glow, ...image },
      trail: DEFAULT_EFFECTS.trail,
      pitch: DEFAULT_EFFECTS.pitch,
    }
    const stored = JSON.parse(JSON.stringify({ presets: [saved] }))
    expect(sanitizePreferences(stored).presets).toEqual([saved])
  })

  it("leaves an image-backed preset without its asset rather than dropping the preset", () => {
    const [clean] = sanitizePreferences({
      presets: [{ id: "a", name: "Gone", glow: { source: "image", asset: "../../etc/passwd" } }],
    }).presets as EffectPreset[]
    expect(clean.glow).toEqual({ ...DEFAULT_EFFECTS.glow, source: "image" })
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
