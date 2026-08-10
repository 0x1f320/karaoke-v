import { describe, expect, it } from "vitest"
import { toolbarTooltipSide } from "./toolbarTooltip"

describe("toolbarTooltipSide", () => {
  it("opens upper toolbar hints downward", () => {
    expect(toolbarTooltipSide(0, 4)).toBe("bottom")
    expect(toolbarTooltipSide(1, 4)).toBe("bottom")
  })

  it("opens lower toolbar hints upward", () => {
    expect(toolbarTooltipSide(2, 4)).toBe("top")
    expect(toolbarTooltipSide(3, 4)).toBe("top")
  })
})
