import { describe, expect, it } from "vitest"
import { glowParams, hexToInt, particleParams } from "../src/renderer/src/render/palette"
import { DEFAULT_EFFECTS } from "../src/shared/preferences"

describe("hexToInt", () => {
  it("reads #rrggbb as 0xRRGGBB", () => {
    expect(hexToInt("#ffffff")).toBe(0xffffff)
    expect(hexToInt("#000000")).toBe(0)
    expect(hexToInt("#ff78c8")).toBe(0xff78c8)
    expect(hexToInt("#FFD27A")).toBe(0xffd27a)
  })

  it("falls back to black on anything unparseable", () => {
    expect(hexToInt("#zzzzzz")).toBe(0)
    expect(hexToInt("")).toBe(0)
    expect(hexToInt("#")).toBe(0)
  })
})

describe("particleParams / glowParams", () => {
  it("carries the preferences through with the color turned into an int", () => {
    const { particles, glow } = DEFAULT_EFFECTS
    expect(particleParams(particles)).toEqual({
      ...particles,
      color: hexToInt(particles.color),
    })
    expect(glowParams(glow)).toEqual({ ...glow, color: hexToInt(glow.color) })
  })
})
