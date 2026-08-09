import { join, sep } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type BridgeGuardian,
  createBridgeGuardian,
  resolveBridgeGuardianExecutable,
} from "./bridgeGuardian"

const SESSION = "0123456789abcdef0123456789abcdef"
const guardians: BridgeGuardian[] = []

function guardian(script: string, onFatal: (error: Error) => void = () => {}): BridgeGuardian {
  const wrapped = `const net = require("node:net");
const control = net.createConnection(process.argv[1]);
control.on("connect", () => { ${script} });`
  const value = createBridgeGuardian(
    {
      rendezvousPath: "/bridge/pipe-session",
      session: SESSION,
      endpointPaths: ["/bridge/state", "/bridge/scroll", "/bridge/notes"],
      onFatal,
    },
    {
      executable: process.execPath,
      argumentsPrefix: ["-e", wrapped],
      startupTimeoutMs: 500,
    },
  )
  guardians.push(value)
  return value
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

afterEach(async () => {
  await Promise.allSettled(guardians.splice(0).map((value) => value.stop()))
})

describe("BridgeGuardian", () => {
  it("requires readiness over the guardian control socket", async () => {
    const value = guardian(`process.stdout.write("READY\\n"); process.exit(0)`)

    await expect(value.start()).rejects.toThrow(/control/i)
  })

  it("does not become ready before the child readiness record", async () => {
    const value = guardian(`setTimeout(() => control.write("READY\\n"), 40)`)
    let ready = false
    const starting = value.start().then(() => {
      ready = true
    })

    await delay(10)
    expect(ready).toBe(false)
    await starting
    expect(ready).toBe(true)
  })

  it("does not report an expected stop as fatal", async () => {
    const failures: Error[] = []
    const value = guardian(
      `control.write("READY\\n"); control.on("end", () => process.exit(0))`,
      (error) => failures.push(error),
    )

    await value.start()
    await value.stop()
    await delay(20)

    expect(failures).toEqual([])
  })

  it("reports loss of the guardian after readiness", async () => {
    const failures: Error[] = []
    const value = guardian(
      `control.write("READY\\n"); setTimeout(() => process.exit(7), 20)`,
      (error) => failures.push(error),
    )

    await value.start()
    await delay(60)

    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toMatch(/control socket closed|code 7/)
  })

  it("rejects an invalid startup record", async () => {
    const value = guardian(`control.write("NOT_READY\\n")`)

    await expect(value.start()).rejects.toThrow("NOT_READY")
  })

  it("resolves packaged executables from the app Helpers directory", () => {
    const entry = join(
      sep,
      "Applications",
      "Voxpane.app",
      "Contents",
      "Resources",
      "app.asar",
      "node_modules",
      "@voxpane",
      "macos-helper",
      "index.js",
    )

    expect(resolveBridgeGuardianExecutable(entry)).toBe(
      join(sep, "Applications", "Voxpane.app", "Contents", "Helpers", "voxpane-bridge-guardian"),
    )
  })
})
