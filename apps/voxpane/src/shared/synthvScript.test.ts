import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { scriptsDirectoryCandidates } from "./synthvScript"

describe("scriptsDirectoryCandidates", () => {
  it("points at Application Support on macOS", () => {
    expect(scriptsDirectoryCandidates({ platform: "darwin", home: "/Users/a" })).toEqual([
      "/Users/a/Library/Application Support/Dreamtonics/Synthesizer V Studio 2/scripts",
    ])
  })

  it("tries Documents before roaming AppData on Windows", () => {
    expect(
      scriptsDirectoryCandidates(
        {
          platform: "win32",
          home: "C:\\Users\\a",
          documents: "D:\\Docs",
          appData: "C:\\Users\\a\\AppData\\Roaming",
        },
        "\\",
      ),
    ).toEqual([
      "D:\\Docs\\Dreamtonics\\Synthesizer V Studio 2\\scripts",
      "C:\\Users\\a\\AppData\\Roaming\\Dreamtonics\\Synthesizer V Studio 2\\scripts",
    ])
  })

  it("falls back to the default Windows locations", () => {
    expect(scriptsDirectoryCandidates({ platform: "win32", home: "C:\\Users\\a" }, "\\")).toEqual([
      "C:\\Users\\a\\Documents\\Dreamtonics\\Synthesizer V Studio 2\\scripts",
      "C:\\Users\\a\\AppData\\Roaming\\Dreamtonics\\Synthesizer V Studio 2\\scripts",
    ])
  })

  it("knows of no location on other platforms", () => {
    expect(scriptsDirectoryCandidates({ platform: "linux", home: "/home/a" })).toEqual([])
  })
})

describe("bridge script timing", () => {
  it("publishes hot state faster than one display frame", () => {
    const source = readFileSync(
      new URL("../../../../packages/synthv-script/src/lua/overlay-bridge.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("tickInterval: 4,")
  })
})
