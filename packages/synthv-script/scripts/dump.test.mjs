import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { inspectPipeSession } from "./dump.mjs"

const HEARTBEAT = 1_786_171_600
const SESSION = "0123456789abcdef0123456789abcdef"
const DIRECTORY = "/bridge"
const RECORD = Buffer.from(`VPR1\n${HEARTBEAT}\n${SESSION}\n24fef1d5\n${" ".repeat(70)}`, "utf8")

function inspect(options = {}) {
  return inspectPipeSession({
    directory: DIRECTORY,
    platform: "darwin",
    nowSeconds: HEARTBEAT,
    readFile: () => RECORD,
    lstat: () => ({ isFile: () => true, isFIFO: () => true, isSymbolicLink: () => false }),
    ...options,
  })
}

describe("pipe-session inspector", () => {
  it("decodes the canonical 128-byte VPR1 record and derives every endpoint", () => {
    expect(inspect()).toEqual({
      status: "fresh",
      heartbeatSeconds: HEARTBEAT,
      ageSeconds: 0,
      session: SESSION,
      endpoints: [
        { channel: "state", path: `/bridge/pipe-${SESSION}-state`, kind: "fifo" },
        { channel: "scroll", path: `/bridge/pipe-${SESSION}-scroll`, kind: "fifo" },
        { channel: "notes", path: `/bridge/pipe-${SESSION}-notes`, kind: "fifo" },
      ],
    })
  })

  it("classifies an old checksum-valid record as stale", () => {
    expect(inspect({ nowSeconds: HEARTBEAT + 3 })).toMatchObject({
      status: "stale",
      ageSeconds: 3,
      session: SESSION,
    })
  })

  it("rejects a future heartbeat as malformed", () => {
    expect(inspect({ nowSeconds: HEARTBEAT - 1 })).toMatchObject({
      status: "malformed",
      reason: "future heartbeat",
    })
  })

  it("rejects a bad checksum as malformed", () => {
    const corrupt = Buffer.from(RECORD)
    corrupt[49] = "0".charCodeAt(0)

    expect(inspect({ readFile: () => corrupt })).toMatchObject({
      status: "malformed",
      reason: "invalid VPR1 record",
    })
  })

  it("reports an absent app as unavailable without reading its rendezvous path", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" })
    let reads = 0

    expect(
      inspect({
        lstat: () => {
          throw error
        },
        readFile: () => {
          reads += 1
          return RECORD
        },
      }),
    ).toEqual({ status: "unavailable" })
    expect(reads).toBe(0)
  })

  it.each([
    ["symlink", { isFile: () => false, isFIFO: () => false, isSymbolicLink: () => true }],
    ["fifo", { isFile: () => false, isFIFO: () => true, isSymbolicLink: () => false }],
    ["directory", { isFile: () => false, isFIFO: () => false, isSymbolicLink: () => false }],
  ])("rejects a rendezvous %s without reading it", (_kind, stat) => {
    let reads = 0

    expect(
      inspect({
        lstat: () => stat,
        readFile: () => {
          reads += 1
          return RECORD
        },
      }),
    ).toMatchObject({ status: "malformed" })
    expect(reads).toBe(0)
  })

  it("inspects Darwin endpoints with lstat without opening them", () => {
    const inspected = []
    const read = []

    const result = inspect({
      readFile: (path) => {
        read.push(path)
        return RECORD
      },
      lstat: (path) => {
        inspected.push(path)
        if (path === "/bridge/pipe-session") {
          return { isFile: () => true, isFIFO: () => false, isSymbolicLink: () => false }
        }
        return {
          isFile: () => false,
          isFIFO: () => false,
          isSymbolicLink: () => path.endsWith("scroll"),
        }
      },
    })

    expect(result.endpoints).toEqual([
      { channel: "state", path: `/bridge/pipe-${SESSION}-state`, kind: "non-fifo" },
      { channel: "scroll", path: `/bridge/pipe-${SESSION}-scroll`, kind: "symlink" },
      { channel: "notes", path: `/bridge/pipe-${SESSION}-notes`, kind: "non-fifo" },
    ])
    expect(inspected).toEqual([
      "/bridge/pipe-session",
      `/bridge/pipe-${SESSION}-state`,
      `/bridge/pipe-${SESSION}-scroll`,
      `/bridge/pipe-${SESSION}-notes`,
    ])
    expect(read).toEqual(["/bridge/pipe-session"])
  })

  it("derives Windows endpoints without probing them", () => {
    let lstatCalls = 0

    const result = inspect({
      platform: "win32",
      lstat: () => {
        lstatCalls += 1
        return { isFile: () => true, isFIFO: () => false, isSymbolicLink: () => false }
      },
    })

    expect(result.endpoints).toEqual([
      { channel: "state", path: `\\\\.\\pipe\\voxpane-${SESSION}-state`, kind: "named-pipe" },
      { channel: "scroll", path: `\\\\.\\pipe\\voxpane-${SESSION}-scroll`, kind: "named-pipe" },
      { channel: "notes", path: `\\\\.\\pipe\\voxpane-${SESSION}-notes`, kind: "named-pipe" },
    ])
    expect(lstatCalls).toBe(1)
  })

  it("contains no channel endpoint-open API", () => {
    const source = readFileSync(new URL("./dump.mjs", import.meta.url), "utf8")

    expect(source).not.toMatch(/\b(?:openSync|createReadStream|createConnection|net\.connect)\b/)
  })

  it("accepts a custom directory after pnpm's double dash", () => {
    const directory = mkdtempSync(join(tmpdir(), "voxpane-dump-"))
    try {
      writeFileSync(join(directory, "pipe-session"), RECORD)

      const result = spawnSync(process.execPath, ["scripts/dump.mjs", "--", directory], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("pipe-session: stale")
      expect(result.stdout).toContain(`state: ${directory}/pipe-${SESSION}-state (missing)`)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
