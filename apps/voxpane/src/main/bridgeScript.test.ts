import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BRIDGE_SCRIPT_FILE } from "../shared/synthvScript"

const mocks = vi.hoisted(() => ({
  resourcePath: vi.fn(),
  rescanScripts: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
}))

vi.mock("../shared/native", () => ({
  NATIVE_TARGET: "synth",
  native: {
    rescanScripts: mocks.rescanScripts,
  },
}))

vi.mock("./resources", () => ({
  resourcePath: mocks.resourcePath,
}))

describe("installBridgeScript", () => {
  let tmp: string
  let bundled: string
  let scripts: string
  let previousOverride: string | undefined
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    mocks.resourcePath.mockReset()
    mocks.rescanScripts.mockReset()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voxpane-bridge-script-"))
    bundled = path.join(tmp, "bundled.lua")
    scripts = path.join(tmp, "scripts")
    fs.mkdirSync(scripts)
    fs.writeFileSync(bundled, "bridge script")
    mocks.resourcePath.mockReturnValue(bundled)
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    previousOverride = process.env.SYNTHV_SCRIPTS_DIR
    process.env.SYNTHV_SCRIPTS_DIR = scripts
  })

  afterEach(() => {
    logSpy.mockRestore()
    if (previousOverride === undefined) {
      delete process.env.SYNTHV_SCRIPTS_DIR
    } else {
      process.env.SYNTHV_SCRIPTS_DIR = previousOverride
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("rescans SynthV even when the installed script is already current", async () => {
    fs.writeFileSync(path.join(scripts, BRIDGE_SCRIPT_FILE), "bridge script")
    const { installBridgeScript } = await import("./bridgeScript")

    installBridgeScript()

    expect(mocks.rescanScripts).toHaveBeenCalledWith("synth")
  })

  it("copies a changed script and then rescans SynthV", async () => {
    const target = path.join(scripts, BRIDGE_SCRIPT_FILE)
    fs.writeFileSync(target, "old bridge script")
    const { installBridgeScript } = await import("./bridgeScript")

    installBridgeScript()

    expect(fs.readFileSync(target, "utf8")).toBe("bridge script")
    expect(mocks.rescanScripts).toHaveBeenCalledWith("synth")
  })
})
