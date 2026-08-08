import { beforeEach, describe, expect, it, vi } from "vitest"
import { encodeRendezvous, pipeEndpoint } from "../shared/bridgeRendezvous"
import { BridgeQuitCoordinator, withdrawAdvertisedBridge } from "./bridgeShutdown"

const SESSION = "0123456789abcdef0123456789abcdef"

function quitEvent(): { prevented: boolean; preventDefault(): void } {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe("BridgeQuitCoordinator", () => {
  it("prevents one quit, waits for receiver stop, then cleans up once on final quit", async () => {
    const stopped = deferred<boolean>()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => stopped.promise,
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      timeoutMs: 1_000,
    })
    const first = quitEvent()
    const repeated = quitEvent()

    coordinator.beforeQuit(first)
    coordinator.beforeQuit(repeated)
    expect(first.prevented).toBe(true)
    expect(repeated.prevented).toBe(true)
    expect(events).toEqual([])

    stopped.resolve(true)
    await vi.waitFor(() => expect(events).toEqual(["resume"]))

    const final = quitEvent()
    coordinator.beforeQuit(final)
    coordinator.beforeQuit(quitEvent())
    expect(final.prevented).toBe(false)
    expect(events).toEqual(["resume", "cleanup"])
  })

  it.each(["unavailable", "rejected"] as const)(
    "withdraws synchronously before resuming when receiver stop is %s",
    async (outcome) => {
      const events: string[] = []
      const coordinator = new BridgeQuitCoordinator({
        requestReceiverStop: () =>
          outcome === "unavailable" ? Promise.resolve(false) : Promise.reject(new Error("lost")),
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => events.push("resume"),
        cleanup: () => events.push("cleanup"),
        timeoutMs: 1_000,
      })

      coordinator.beforeQuit(quitEvent())
      await vi.waitFor(() => expect(events).toEqual(["withdraw", "resume"]))
    },
  )

  it("bounds an unresponsive receiver before fallback and resumed quit", async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(49)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual(["withdraw", "resume"])
  })
})

describe("withdrawAdvertisedBridge", () => {
  it("removes a checksum-valid rendezvous before only its FIFO endpoints", () => {
    const rendezvous = "/bridge/pipe-session"
    const state = pipeEndpoint("darwin", "/bridge", SESSION, "state")
    const scroll = pipeEndpoint("darwin", "/bridge", SESSION, "scroll")
    const notes = pipeEndpoint("darwin", "/bridge", SESSION, "notes")
    const entries = new Map([
      [rendezvous, { kind: "file", dev: 1, ino: 1 }],
      [state, { kind: "fifo", dev: 1, ino: 2 }],
      [scroll, { kind: "file", dev: 1, ino: 3 }],
      [notes, { kind: "symlink", dev: 1, ino: 4 }],
    ])
    const unlinked: string[] = []

    expect(
      withdrawAdvertisedBridge("/bridge", "darwin", {
        read: () => encodeRendezvous({ heartbeatSeconds: 1_786_176_000, session: SESSION }),
        lstat: (path) => {
          const entry = entries.get(path)
          if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" })
          return {
            dev: entry.dev,
            ino: entry.ino,
            isFile: () => entry.kind === "file",
            isFIFO: () => entry.kind === "fifo",
            isSymbolicLink: () => entry.kind === "symlink",
          }
        },
        unlink: (path) => {
          unlinked.push(path)
          entries.delete(path)
        },
      }),
    ).toBe(true)

    expect(unlinked).toEqual([rendezvous, state])
    expect(entries.has(scroll)).toBe(true)
    expect(entries.has(notes)).toBe(true)
  })

  it("refuses malformed, symlinked, or identity-replaced rendezvous records", () => {
    const cases = ["malformed", "symlink", "replaced"] as const

    for (const kind of cases) {
      let stats = 0
      const unlinked: string[] = []
      expect(
        withdrawAdvertisedBridge("/bridge", "darwin", {
          read: () =>
            kind === "malformed"
              ? Uint8Array.of(1, 2, 3)
              : encodeRendezvous({ heartbeatSeconds: 1_786_176_000, session: SESSION }),
          lstat: () => {
            stats += 1
            return {
              dev: 1,
              ino: kind === "replaced" && stats > 1 ? 2 : 1,
              isFile: () => kind !== "symlink",
              isFIFO: () => false,
              isSymbolicLink: () => kind === "symlink",
            }
          },
          unlink: (path) => unlinked.push(path),
        }),
      ).toBe(false)
      expect(unlinked).toEqual([])
    }
  })
})
