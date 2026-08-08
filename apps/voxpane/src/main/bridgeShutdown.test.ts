import { beforeEach, describe, expect, it, vi } from "vitest"
import { encodeRendezvous, pipeEndpoint } from "../shared/bridgeRendezvous"
import {
  BridgeQuitCoordinator,
  destroyBridgeReceiverOwner,
  requestBridgeReceiverStop,
  withdrawAdvertisedBridge,
} from "./bridgeShutdown"

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
      quiesceReceiverOwner: () => Promise.resolve(),
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      timeoutMs: 1_000,
      quiesceTimeoutMs: 100,
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
        quiesceReceiverOwner: async () => {
          events.push("quiesce")
        },
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => events.push("resume"),
        cleanup: () => events.push("cleanup"),
        timeoutMs: 1_000,
        quiesceTimeoutMs: 100,
      })

      coordinator.beforeQuit(quitEvent())
      await vi.waitFor(() => expect(events).toEqual(["quiesce", "withdraw", "resume"]))
    },
  )

  it("bounds an unresponsive receiver before fallback and resumed quit", async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce")
      },
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      timeoutMs: 50,
      quiesceTimeoutMs: 20,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(49)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual(["quiesce", "withdraw", "resume"])
  })

  it("waits for owner quiescence before final fallback withdrawal", async () => {
    vi.useFakeTimers()
    const quiesced = deferred<void>()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce:start")
        await quiesced.promise
        events.push("quiesce:done")
      },
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      timeoutMs: 50,
      quiesceTimeoutMs: 100,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(50)
    expect(events).toEqual(["quiesce:start"])

    quiesced.resolve()
    await vi.waitFor(() =>
      expect(events).toEqual(["quiesce:start", "quiesce:done", "withdraw", "resume"]),
    )
  })

  it.each(["rejected", "timed out"] as const)(
    "withdraws and resumes once when owner quiescence is %s",
    async (outcome) => {
      vi.useFakeTimers()
      const events: string[] = []
      const coordinator = new BridgeQuitCoordinator({
        requestReceiverStop: () => Promise.resolve(false),
        quiesceReceiverOwner: () =>
          outcome === "rejected"
            ? Promise.reject(new Error("destroy failed"))
            : new Promise(() => {}),
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => events.push("resume"),
        cleanup: () => events.push("cleanup"),
        timeoutMs: 50,
        quiesceTimeoutMs: 20,
      })

      coordinator.beforeQuit(quitEvent())
      coordinator.beforeQuit(quitEvent())
      await vi.advanceTimersByTimeAsync(20)

      expect(events).toEqual(["withdraw", "resume"])
    },
  )

  it("quiesces a recovering owner before the final withdrawal", async () => {
    vi.useFakeTimers()
    const gate = deferred<void>()
    const events: string[] = []
    let ownerAlive = true
    let advertised = true
    const recoveryHeartbeat = (): void => {
      if (ownerAlive) {
        advertised = true
        events.push("heartbeat")
      }
    }
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce:start")
        await gate.promise
        ownerAlive = false
        events.push("quiesce:done")
      },
      withdrawAdvertisement: () => {
        advertised = false
        events.push("withdraw")
      },
      resumeQuit: () => events.push("resume"),
      cleanup: () => {},
      timeoutMs: 50,
      quiesceTimeoutMs: 100,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(50)
    recoveryHeartbeat()
    expect(advertised).toBe(true)
    expect(events).toEqual(["quiesce:start", "heartbeat"])

    gate.resolve()
    await vi.waitFor(() => expect(events.at(-2)).toBe("withdraw"))
    recoveryHeartbeat()

    expect(advertised).toBe(false)
    expect(events).toEqual(["quiesce:start", "heartbeat", "quiesce:done", "withdraw", "resume"])
  })
})

class FakeIpcMain {
  readonly listeners = new Set<(event: { sender: unknown }, stopped: unknown) => void>()

  on(_channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void {
    this.listeners.add(listener)
  }

  off(_channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void {
    this.listeners.delete(listener)
  }

  emit(sender: unknown, stopped: unknown): void {
    for (const listener of [...this.listeners]) listener({ sender }, stopped)
  }
}

class FakeSender {
  readonly sent: string[] = []
  readonly destroyedListeners = new Set<() => void>()
  destroyed = false
  sendError: Error | null = null

  send(channel: string): void {
    if (this.sendError) throw this.sendError
    this.sent.push(channel)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(_event: "destroyed", listener: () => void): void {
    this.destroyedListeners.add(listener)
  }

  off(_event: "destroyed", listener: () => void): void {
    this.destroyedListeners.delete(listener)
  }

  destroy(): void {
    this.destroyed = true
    for (const listener of [...this.destroyedListeners]) listener()
  }
}

describe("requestBridgeReceiverStop", () => {
  it("ignores a wrong sender and accepts the matching acknowledgement", async () => {
    const ipc = new FakeIpcMain()
    const sender = new FakeSender()
    const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 100)

    ipc.emit(new FakeSender(), true)
    expect(ipc.listeners.size).toBe(1)
    ipc.emit(sender, true)

    await expect(stopping).resolves.toBe(true)
    expect(sender.sent).toEqual(["request"])
    expect(ipc.listeners.size).toBe(0)
    expect(sender.destroyedListeners.size).toBe(0)
  })

  it.each(["send throw", "sender destroyed", "timeout"] as const)(
    "resolves false and cleans listeners after %s",
    async (outcome) => {
      vi.useFakeTimers()
      const ipc = new FakeIpcMain()
      const sender = new FakeSender()
      if (outcome === "send throw") sender.sendError = new Error("send failed")
      const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 25)

      if (outcome === "sender destroyed") sender.destroy()
      if (outcome === "timeout") await vi.advanceTimersByTimeAsync(25)

      await expect(stopping).resolves.toBe(false)
      expect(ipc.listeners.size).toBe(0)
      expect(sender.destroyedListeners.size).toBe(0)
    },
  )

  it("ignores late and duplicate acknowledgements after settling", async () => {
    const ipc = new FakeIpcMain()
    const sender = new FakeSender()
    const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 100)
    ipc.emit(sender, true)
    ipc.emit(sender, false)

    await expect(stopping).resolves.toBe(true)
    ipc.emit(sender, false)
    expect(ipc.listeners.size).toBe(0)
  })
})

class FakeReceiverOwner {
  readonly closedListeners = new Set<() => void>()
  readonly webContents = {
    destroyed: false,
    destroyedListeners: new Set<() => void>(),
    isDestroyed: (): boolean => this.webContents.destroyed,
    once: (_event: "destroyed", listener: () => void): void => {
      this.webContents.destroyedListeners.add(listener)
    },
    off: (_event: "destroyed", listener: () => void): void => {
      this.webContents.destroyedListeners.delete(listener)
    },
  }
  destroyed = false
  destroyCalls = 0
  destroyError: Error | null = null

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(_event: "closed", listener: () => void): void {
    this.closedListeners.add(listener)
  }

  off(_event: "closed", listener: () => void): void {
    this.closedListeners.delete(listener)
  }

  destroy(): void {
    this.destroyCalls += 1
    if (this.destroyError) throw this.destroyError
  }

  completeWebContentsDestroy(): void {
    this.webContents.destroyed = true
    for (const listener of [...this.webContents.destroyedListeners]) listener()
  }
}

describe("destroyBridgeReceiverOwner", () => {
  it("waits for owner destruction and cleans both event listeners", async () => {
    const owner = new FakeReceiverOwner()
    let completed = false
    const quiescing = destroyBridgeReceiverOwner(owner).then(() => {
      completed = true
    })

    expect(owner.destroyCalls).toBe(1)
    expect(completed).toBe(false)
    expect(owner.closedListeners.size).toBe(1)
    expect(owner.webContents.destroyedListeners.size).toBe(1)

    owner.completeWebContentsDestroy()
    await quiescing

    expect(completed).toBe(true)
    expect(owner.closedListeners.size).toBe(0)
    expect(owner.webContents.destroyedListeners.size).toBe(0)
  })

  it("rejects a failed destroy and cleans both event listeners", async () => {
    const owner = new FakeReceiverOwner()
    owner.destroyError = new Error("destroy failed")

    await expect(destroyBridgeReceiverOwner(owner)).rejects.toThrow("destroy failed")
    expect(owner.closedListeners.size).toBe(0)
    expect(owner.webContents.destroyedListeners.size).toBe(0)
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
