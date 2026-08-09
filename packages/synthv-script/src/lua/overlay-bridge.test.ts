import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  calls: [] as string[],
  callbacks: [] as Array<() => void>,
  collectFailures: 0,
  prepareResults: [] as Array<"new-session" | "connected" | "disconnected">,
  scheduled: undefined as (() => void) | undefined,
}))

vi.mock("./bridge/model", () => ({
  collectNotes: () => {
    runtime.calls.push("collect-notes")
    if (runtime.collectFailures > 0) {
      runtime.collectFailures -= 1
      throw new Error("collection unavailable")
    }
    return [{ pitch: 60 }]
  },
  currentRevision: () => {
    runtime.calls.push("revision")
    return "rev-1"
  },
  viewMapping: () => {
    runtime.calls.push("view")
    return {
      perBlick: 1,
      perSemitone: 2,
      viewLeft: 0,
      viewRight: 10,
      viewTop: 80,
      viewBottom: 40,
    }
  },
}))

vi.mock("./bridge/publisher", () => ({
  createPublisher: () => ({
    prepare: (elapsedMs: number) => {
      runtime.calls.push(`prepare:${elapsedMs}`)
      return runtime.prepareResults.shift() ?? "connected"
    },
    publishNotes: (rev: string, notes: unknown[]) => {
      runtime.calls.push(`notes:${rev}:${notes.length}`)
      return true
    },
    abortSnapshot: (message: string) => {
      runtime.calls.push(`abort:${message}`)
    },
    publishState: (state: { rev: string }) => {
      runtime.calls.push(`state:${state.rev}`)
    },
    describe: () => "connected",
    close: () => {
      runtime.calls.push("close")
    },
  }),
}))

vi.mock("./client-info", () => ({
  getClientInfoFactory: () => () => ({}),
}))

vi.mock("./ui/button", () => ({ button: () => ({ type: "Button" }) }))
vi.mock("./ui/label", () => ({ label: () => ({ type: "Label" }) }))
vi.mock("./ui/row", () => ({ row: () => ({ type: "Container" }) }))
vi.mock("./version", () => ({ SCRIPT_VERSION: "test" }))

function widget(): Record<string, unknown> {
  return {
    setValueChangeCallback: (callback: () => void) => {
      runtime.callbacks.push(callback)
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  runtime.calls = []
  runtime.callbacks = []
  runtime.collectFailures = 0
  runtime.prepareResults = []
  runtime.scheduled = undefined
  Object.assign(globalThis, {
    tostring: (value: unknown) => String(value),
    string: { format: () => "0" },
    SV: {
      create: widget,
      getPlayback: () => ({
        getStatus: () => "playing",
        getPlayhead: () => 1,
      }),
      refreshSidePanel: () => {},
      setTimeout: (_milliseconds: number, callback: () => void) => {
        runtime.scheduled = callback
      },
    },
  })
})

describe("OverlayBridge", () => {
  it("prepares first and publishes one exact snapshot for a new session", async () => {
    runtime.prepareResults = ["new-session"]

    await import("./overlay-bridge")

    expect(runtime.calls).toEqual([
      "prepare:0",
      "collect-notes",
      "revision",
      "notes:rev-1:1",
      "view",
      "state:rev-1",
    ])
  })

  it("recovers on a later new session while playback remains active", async () => {
    runtime.prepareResults = ["disconnected", "new-session"]
    await import("./overlay-bridge")

    expect(runtime.calls).toEqual(["prepare:0"])
    runtime.scheduled?.()

    expect(runtime.calls).toEqual([
      "prepare:0",
      "prepare:4",
      "collect-notes",
      "revision",
      "notes:rev-1:1",
      "view",
      "state:rev-1",
    ])
  })

  it("disconnects the handle set when the bridge is disabled", async () => {
    runtime.prepareResults = ["new-session"]
    await import("./overlay-bridge")
    runtime.calls = []

    runtime.callbacks[0]()

    expect(runtime.calls).toContain("close")
  })

  it("aborts a failed exact snapshot and recovers with notes, scroll, and state", async () => {
    runtime.collectFailures = 1
    runtime.prepareResults = [
      "new-session",
      ...Array<"disconnected">(59).fill("disconnected"),
      "new-session",
    ]

    await import("./overlay-bridge")

    expect(runtime.calls).toEqual([
      "prepare:0",
      "collect-notes",
      "abort:Error: collection unavailable",
    ])

    for (let tick = 0; tick < 59; tick += 1) {
      runtime.scheduled?.()
    }
    expect(runtime.calls.some((call) => call.startsWith("state:"))).toBe(false)

    runtime.scheduled?.()
    expect(runtime.calls.slice(-6)).toEqual([
      "prepare:240",
      "collect-notes",
      "revision",
      "notes:rev-1:1",
      "view",
      "state:rev-1",
    ])
  })

  it("attempts immediately after disable and re-enable", async () => {
    runtime.prepareResults = ["new-session", "new-session"]
    await import("./overlay-bridge")
    runtime.calls = []

    runtime.callbacks[0]()
    runtime.callbacks[0]()
    runtime.scheduled?.()

    expect(runtime.calls).toContain("close")
    expect(runtime.calls).toContain("prepare:4")
    expect(runtime.calls).toContain("notes:rev-1:1")
  })

  it("lands its 4 ms logical cadence exactly on 240 ms", async () => {
    await import("./overlay-bridge")

    for (let tick = 0; tick < 60; tick += 1) {
      runtime.scheduled?.()
    }

    expect(runtime.calls.filter((call) => call.startsWith("prepare:")).at(-1)).toBe("prepare:240")
  })
})
